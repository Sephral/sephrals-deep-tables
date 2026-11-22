/**
 * The Table library window: browse the ready tables the module ships, preview them and import the chosen ones into the
 * world, in the language of the module, into a folder, skipping the ones that are in the world already.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, setting, t} from "./config.mjs";
import {addMissingTags} from "./conditions.mjs";
import {forcedLanguage} from "./language.mjs";
import {GROUPS, LIB_LANGUAGES, formulaOf, isPart, neededTags, planImport, previewText, rowsOf, tableData, validateLibrary}
  from "./library.mjs";
import {periodName, rangeText, saveStoryTags, storyTags} from "./situation.mjs";
import {trace} from "./debug.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** Loaded content by language. */
const cache = new Map();

/**
 * The language the library opens in: the module language, else Foundry's.
 * @returns {"en"|"de"}
 */
export function libraryLanguage() {
  const fixed = forcedLanguage(setting("uiLanguage"));
  const lang = fixed ?? String(game.i18n.lang ?? "en").slice(0, 2);
  return LIB_LANGUAGES.includes(lang) ? lang : "en";
}

/**
 * Load the library of one language.
 * @param {string} lang
 * @returns {Promise<{groups: object[], tables: Map<string, object>, tags: object[]}>}
 */
export async function loadLibrary(lang) {
  if ( !cache.has(lang) ) {
    cache.set(lang, (async () => {
      const groups = [];
      for ( const entry of GROUPS ) {
        const url = new URL(`../lang/library/${lang}/${entry.id}.json`, import.meta.url);
        const response = await fetch(url);
        if ( !response.ok ) throw new Error(`${url} ${response.status}`);
        const data = await response.json();
        groups.push({...data, id: entry.id, icon: entry.icon});
      }
      const tables = new Map();
      for ( const group of groups ) for ( const table of group.tables ) tables.set(table.key, {...table, group: group.id});
      return {groups, tables, tags: groups.flatMap(group => group.tags ?? [])};
    })().catch(err => {
      cache.delete(lang);
      throw err;
    }));
  }
  return cache.get(lang);
}

/**
 * The library tables that are in the world already, by key.
 * @param {string} lang
 * @returns {Map<string, string>}   Key to UUID
 */
export function importedKeys(lang) {
  const found = new Map();
  for ( const table of game.tables ) {
    const info = table.flags?.[MODULE_ID]?.library;
    if ( info?.key && (info.lang === lang) && !found.has(info.key) ) found.set(info.key, table.uuid);
  }
  return found;
}

/**
 * Find or make a folder for roll tables.
 * @param {string} name
 * @param {string|null} parent   The id of the parent folder
 * @returns {Promise<Folder>}
 */
async function ensureFolder(name, parent) {
  const found = game.folders.find(folder => (folder.type === "RollTable") && (folder.name === name)
    && ((folder.folder?.id ?? null) === parent));
  return found ?? Folder.implementation.create({name, type: "RollTable", folder: parent});
}

/**
 * Import tables of the library into the world.
 * @param {object} [options]
 * @param {string[]} options.keys           The tables to import (building blocks they need come along)
 * @param {string} [options.lang]           The language of the content
 * @param {string} [options.folder]         Name of the folder, empty for no folder
 * @returns {Promise<{created: RollTable[], added: number, skipped: number}|null>}
 */
export async function importLibrary({keys = [], lang = libraryLanguage(), folder = ""} = {}) {
  if ( !game.user.isGM ) return null;
  const library = await loadLibrary(lang);
  const existing = importedKeys(lang);
  const plan = planImport({tables: library.tables, selected: keys, existing});
  if ( !plan.create.length ) return {created: [], added: 0, skipped: plan.skipped.length};
  // Folders: one for the library, one inside it for every group
  const folders = new Map();
  const parentName = String(folder ?? "").trim();
  if ( parentName ) {
    const parent = await ensureFolder(parentName, null);
    for ( const key of new Set(plan.create.map(k => library.tables.get(k).group)) ) {
      const group = library.groups.find(g => g.id === key);
      folders.set(key, (await ensureFolder(group.title, parent.id)).id);
    }
  }
  // Ids first, so tables can link to each other in one batch
  const known = new Map();
  for ( const [key, uuid] of plan.reuse ) {
    const doc = await fromUuid(uuid).catch(() => null);
    if ( doc ) known.set(key, {id: doc.id, name: doc.name});
  }
  for ( const key of plan.create ) known.set(key, {id: foundry.utils.randomID(), name: library.tables.get(key).name});
  const data = plan.create.map(key => {
    const table = library.tables.get(key);
    return tableData(table, {id: known.get(key).id, known, lang, folder: folders.get(table.group) ?? null});
  });
  const created = await RollTable.implementation.createDocuments(data, {keepId: true});
  // Story tags the new rows ask for
  const needed = neededTags(plan.create.map(key => library.tables.get(key)), library.tags);
  if ( needed.length ) {
    const before = storyTags();
    const after = addMissingTags(before, needed.map(tag => ({id: tag.id, name: tag.name})));
    if ( after.length !== before.length ) await saveStoryTags(after);
  }
  trace.add("library imported", {lang, created: created.length, added: plan.added.length, skipped: plan.skipped.length});
  countFeature(MODULE_ID, "libraryImport", created.length);
  return {created, added: plan.added.length, skipped: plan.skipped.length};
}

/**
 * Open the window (GM).
 * @returns {Promise<LibraryApp|null>}
 */
export async function openLibrary() {
  if ( !game.user.isGM ) return null;
  const open = foundry.applications.instances.get("sdt-library");
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new LibraryApp();
  await app.render({force: true});
  countFeature(MODULE_ID, "libraryOpen");
  return app;
}

export class LibraryApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {object} [options] */
  constructor(options = {}) {
    super({id: "sdt-library", ...options});
    this.lang = libraryLanguage();
    this.folder = t("SDT.Library.folderDefault");
    this.selected = new Set();
    this.preview = null;
    this.library = null;
    this.error = false;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sdt-app", "sdt-library-app"],
    window: {icon: "fa-solid fa-book-atlas", resizable: true},
    position: {width: 760, height: 560},
    actions: {import: LibraryApp.#onImport, show: LibraryApp.#onShow, all: LibraryApp.#onAll, none: LibraryApp.#onNone}
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/library.hbs`, scrollable: [".sdt-lib-list", ".sdt-lib-preview"]}};

  /** @override */
  get title() {
    return t("SDT.Library.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.theme = setting("theme");
    try {
      this.library = await loadLibrary(this.lang);
      this.error = false;
    } catch(err) {
      console.error(`${MODULE_ID} | The table library could not be loaded`, err);
      this.error = true;
    }
    context.error = this.error;
    context.languages = LIB_LANGUAGES.map(value => ({value, label: t(`SDT.LANGUAGE.${value}`), selected: value === this.lang}));
    context.folder = this.folder;
    if ( this.error ) return context;
    const existing = importedKeys(this.lang);
    const library = this.library;
    context.groups = library.groups.map(group => {
      const row = table => ({key: table.key, name: table.name, needle: table.name.toLowerCase(), rows: rowsOf(table).length, part: isPart(table),
        imported: existing.has(table.key), checked: this.selected.has(table.key) && !existing.has(table.key),
        shown: this.preview === table.key,
        conditions: rowsOf(table).some(r => r.conditions)});
      const mains = group.tables.filter(table => !isPart(table)).map(row);
      const parts = group.tables.filter(isPart).map(row);
      const todo = [...mains, ...parts].filter(entry => !entry.imported);
      return {id: group.id, icon: group.icon, title: group.title, summary: group.summary, mains, parts,
        hasParts: !!parts.length, partCount: parts.length, count: mains.length + parts.length,
        allChecked: !!todo.length && todo.every(entry => entry.checked), importedCount: [...mains, ...parts].length - todo.length};
    });
    context.preview = this.#previewContext(existing);
    Object.assign(context, this.#summary());
    return context;
  }

  /**
   * The data of the preview of the clicked table.
   * @param {Map<string, string>} existing
   * @returns {object|null}
   */
  #previewContext(existing) {
    const table = this.preview ? this.library.tables.get(this.preview) : null;
    if ( !table ) return null;
    const tags = new Map(this.library.tags.map(tag => [tag.id, tag.name]));
    const conditionText = rules => {
      if ( !rules ) return "";
      const parts = [];
      if ( rules.times ) parts.push(rules.times.map(periodName).join(" / "));
      if ( rules.level ) parts.push(t("SDT.Cond.levelShort", {range: rangeText(rules.level.min, rules.level.max)}));
      if ( rules.tags ) {
        parts.push(Object.entries(rules.tags).map(([id, want]) => (want ? tags.get(id) ?? id
          : t("SDT.Cond.notTag", {name: tags.get(id) ?? id}))).join(" / "));
      }
      return parts.join(" · ");
    };
    return {
      name: table.name,
      description: table.description ?? "",
      formula: formulaOf(table),
      imported: existing.has(table.key),
      rows: rowsOf(table).map(row => {
        const range = (row.range[0] === row.range[1]) ? String(row.range[0]) : t("SDT.Library.range", {from: row.range[0], to: row.range[1]});
        const inner = row.table ? this.library.tables.get(row.table) : null;
        return {range, text: inner ? `[${inner.name}]` : previewText(row.text, this.library.tables),
          note: previewText(row.note, this.library.tables), quantity: row.quantity ? `× ${row.quantity}` : "",
          table: !!inner, condition: conditionText(row.conditions)};
      })
    };
  }

  /**
   * What the footer says: how many tables are ticked, how many building blocks come along.
   * @returns {{summary: string, canImport: boolean}}
   */
  #summary() {
    if ( !this.library ) return {summary: "", canImport: false};
    const existing = importedKeys(this.lang);
    const keys = [...this.selected].filter(key => !existing.has(key) && this.library.tables.has(key));
    const plan = planImport({tables: this.library.tables, selected: keys, existing});
    const summary = keys.length
      ? t("SDT.Library.summary", {count: plan.create.length, extra: plan.added.length})
      : t("SDT.Library.nothingTicked");
    return {summary, canImport: plan.create.length > 0};
  }

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    addSettingsGear(frame);
    return frame;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.dataset.sdtTheme = setting("theme");
    el.querySelector("select[name=lang]")?.addEventListener("change", event => {
      this.lang = event.currentTarget.value;
      this.selected.clear();
      this.preview = null;
      this.folder = t("SDT.Library.folderDefault");
      this.render();
    });
    el.querySelector("input[name=folder]")?.addEventListener("input", event => {
      this.folder = event.currentTarget.value;
    });
    el.querySelector("input[name=search]")?.addEventListener("input", event => this.#filter(event.currentTarget.value));
    for ( const box of el.querySelectorAll("input[data-pick]") ) {
      box.addEventListener("change", event => {
        const key = event.currentTarget.dataset.pick;
        if ( event.currentTarget.checked ) this.selected.add(key);
        else this.selected.delete(key);
        this.#refresh();
      });
    }
    for ( const box of el.querySelectorAll("input[data-group]") ) {
      box.addEventListener("change", event => {
        const group = event.currentTarget.dataset.group;
        for ( const input of el.querySelectorAll(`input[data-pick][data-in="${group}"]:not(:disabled)`) ) {
          input.checked = event.currentTarget.checked;
          if ( input.checked ) this.selected.add(input.dataset.pick);
          else this.selected.delete(input.dataset.pick);
        }
        this.#refresh();
      });
    }
  }

  /** Update the footer without drawing the window again. */
  #refresh() {
    const {summary, canImport} = this.#summary();
    const el = this.element;
    el.querySelector("[data-summary]").textContent = summary;
    el.querySelector("[data-action=import]").disabled = !canImport;
    for ( const box of el.querySelectorAll("input[data-group]") ) {
      const inputs = [...el.querySelectorAll(`input[data-pick][data-in="${box.dataset.group}"]:not(:disabled)`)];
      box.checked = !!inputs.length && inputs.every(input => input.checked);
    }
  }

  /**
   * Hide the rows that do not match the search.
   * @param {string} value
   */
  #filter(value) {
    const needle = String(value ?? "").trim().toLowerCase();
    for ( const item of this.element.querySelectorAll(".sdt-lib-item") ) {
      item.hidden = !!needle && !item.dataset.name.includes(needle);
    }
    for ( const details of this.element.querySelectorAll(".sdt-lib-parts") ) {
      if ( needle && [...details.querySelectorAll(".sdt-lib-item")].some(item => !item.hidden) ) details.open = true;
    }
  }

  /** @this {LibraryApp} */
  static async #onShow(event, target) {
    this.preview = target.dataset.key;
    await this.render();
  }

  /** @this {LibraryApp} */
  static async #onAll() {
    const existing = importedKeys(this.lang);
    for ( const table of this.library?.tables.values() ?? [] ) if ( !existing.has(table.key) && !isPart(table) ) this.selected.add(table.key);
    await this.render();
  }

  /** @this {LibraryApp} */
  static async #onNone() {
    this.selected.clear();
    await this.render();
  }

  /** @this {LibraryApp} */
  static async #onImport() {
    const keys = [...this.selected];
    for ( const button of this.element.querySelectorAll("button") ) button.disabled = true;
    try {
      const done = await importLibrary({keys, lang: this.lang, folder: this.folder});
      if ( !done ) return;
      this.selected.clear();
      ui.notifications.info(t("SDT.Library.done", {count: done.created.length, skipped: done.skipped}));
    } catch(err) {
      console.error(`${MODULE_ID} | The import from the library failed`, err);
      ui.notifications.error(t("SDT.Library.failed"));
    }
    await this.render();
  }
}

/**
 * Check the shipped content: for the self test and the tests. Resolves to the problems found.
 * @returns {Promise<string[]>}
 */
export async function checkLibrary() {
  const problems = [];
  for ( const lang of LIB_LANGUAGES ) {
    try {
      const library = await loadLibrary(lang);
      problems.push(...validateLibrary(library.groups).map(line => `${lang}: ${line}`));
    } catch(err) {
      problems.push(`${lang}: ${err.message}`);
    }
  }
  return problems;
}
