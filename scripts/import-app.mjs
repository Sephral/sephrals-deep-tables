/**
 * The window that makes a roll table from pasted text: a preview of what was recognized, then the table.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, esc, setting, t} from "./config.mjs";
import {parseTableText} from "./parse-text.mjs";
import {trace} from "./debug.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Open the window.
 * @param {string} [text]
 * @returns {Promise<ImportApp|null>}
 */
export async function openImport(text = "") {
  if ( !game.user.isGM ) return null;
  const open = foundry.applications.instances.get("sdt-import");
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new ImportApp({text});
  await app.render({force: true});
  return app;
}

/**
 * The text of a parse problem.
 * @param {{kind: string, data?: object}} problem
 * @returns {string}
 */
export function parseProblemText(problem) {
  const key = `SDT.Import.problem.${problem.kind}`;
  return game.i18n.has(key) ? t(key, problem.data ?? {}) : problem.kind;
}

/**
 * The index of items by name: the world and optionally the compendiums.
 * @param {"off"|"world"|"all"} mode
 * @returns {Promise<Map<string, string>>}   Lowercase name to UUID
 */
async function itemIndex(mode) {
  const index = new Map();
  if ( mode === "off" ) return index;
  for ( const item of game.items ) {
    const key = item.name.trim().toLowerCase();
    if ( !index.has(key) ) index.set(key, item.uuid);
  }
  if ( mode !== "all" ) return index;
  for ( const pack of game.packs ) {
    if ( pack.documentName !== "Item" ) continue;
    try {
      const entries = await pack.getIndex();
      for ( const entry of entries ) {
        const key = String(entry.name).trim().toLowerCase();
        if ( !index.has(key) ) index.set(key, entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`);
      }
    } catch(err) {
      console.warn(`${MODULE_ID} | could not read ${pack.collection}`, err);
    }
  }
  return index;
}

export class ImportApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {object} [options]
   * @param {string} [options.text]
   */
  constructor({text = "", ...options} = {}) {
    super({...options, id: "sdt-import"});
    this.inputs = {text, name: "", formula: "", items: "off"};
    this.index = new Map();
    this.indexMode = "off";
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sdt-app", "sdt-import-app"],
    window: {icon: "fa-solid fa-file-import", resizable: true},
    position: {width: 600, height: "auto"},
    actions: {create: ImportApp.#onCreate}
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/import.hbs`, scrollable: [".sdt-preview"]}};

  /** @override */
  get title() {
    return t("SDT.Import.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.text = this.inputs.text;
    context.name = this.inputs.name;
    context.formula = this.inputs.formula;
    context.itemModes = ["off", "world", "all"].map(value => ({value, label: t(`SDT.Import.itemMode.${value}`),
      selected: this.inputs.items === value}));
    return context;
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
    this.element.dataset.sdtTheme = setting("theme");
    const el = this.element;
    let timer = null;
    const read = () => {
      this.inputs.text = el.querySelector("[name=text]").value;
      this.inputs.name = el.querySelector("[name=name]").value;
      this.inputs.formula = el.querySelector("[name=formula]").value;
      this.inputs.items = el.querySelector("[name=items]").value;
    };
    el.querySelector("[name=text]").addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        read();
        this.#preview();
      }, 150);
    });
    for ( const name of ["name", "formula"] ) {
      el.querySelector(`[name=${name}]`).addEventListener("input", () => {
        read();
        this.#preview({keepFields: true});
      });
    }
    el.querySelector("[name=items]").addEventListener("change", async () => {
      read();
      await this.#preview();
    });
    await this.#preview();
  }

  /**
   * The parsed table with the changes the user typed into the fields.
   * @returns {import("./parse-text.mjs").ParsedTable}
   */
  #parsed() {
    const parsed = parseTableText(this.inputs.text);
    const formula = this.inputs.formula.trim();
    if ( formula ) parsed.formula = formula;
    return parsed;
  }

  /**
   * Show what was recognized.
   * @param {object} [options]
   * @param {boolean} [options.keepFields]   Leave the name and formula fields alone
   */
  async #preview({keepFields = false} = {}) {
    const el = this.element;
    if ( !el ) return;
    if ( this.inputs.items !== this.indexMode ) {
      this.indexMode = this.inputs.items;
      el.querySelector("[data-summary]").textContent = t("SDT.Import.searching");
      this.index = await itemIndex(this.indexMode);
    }
    const parsed = this.#parsed();
    this.parsed = parsed;
    const nameField = el.querySelector("[name=name]");
    const formulaField = el.querySelector("[name=formula]");
    if ( !keepFields ) {
      if ( !this.inputs.name ) nameField.placeholder = parsed.name || t("SDT.Import.defaultName");
      if ( !this.inputs.formula ) formulaField.placeholder = parsed.formula || "1d20";
    }
    let matched = 0;
    const rows = parsed.rows.map(row => {
      row.match = this.index.get(row.text.trim().toLowerCase()) ?? null;
      if ( row.match ) matched++;
      const range = (row.range[0] === row.range[1]) ? String(row.range[0]) : `${row.range[0]}–${row.range[1]}`;
      return `<tr><td class="sdt-r">${range}</td><td>${row.match ? `<i class="fa-solid fa-suitcase" inert data-tooltip="${esc(t("SDT.Import.itemFound"))}"></i> ` : ""}${esc(row.text)}</td></tr>`;
    }).join("");
    const problems = parsed.problems.map(p => `<li><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(parseProblemText(p))}</li>`).join("");
    el.querySelector("[data-preview]").innerHTML = parsed.rows.length
      ? `${problems ? `<ul class="sdt-notes">${problems}</ul>` : ""}<table class="sdt-table"><thead><tr><th class="sdt-r">${esc(t("SDT.Import.range"))}</th><th>${esc(t("SDT.Import.result"))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="sdt-empty"><i class="fa-solid fa-file-lines" inert></i> ${esc(t("SDT.Import.nothing"))}</p>`;
    el.querySelector("[data-summary]").textContent = parsed.rows.length
      ? t("SDT.Import.summary", {count: parsed.rows.length, formula: parsed.formula, items: matched}) : "";
    el.querySelector("[data-action=create]").disabled = !parsed.rows.length;
  }

  /** @this {ImportApp} */
  static async #onCreate() {
    const parsed = this.parsed ?? this.#parsed();
    if ( !parsed.rows.length ) return;
    const name = this.inputs.name.trim() || parsed.name || t("SDT.Import.defaultName");
    const results = [];
    for ( const row of parsed.rows ) {
      const data = {range: row.range, weight: row.weight};
      const doc = row.match ? await fromUuid(row.match).catch(() => null) : null;
      if ( doc ) results.push({...data, type: "document", documentUuid: doc.uuid, name: doc.name, img: doc.img});
      else results.push({...data, type: "text", name: row.text});
    }
    const table = await RollTable.implementation.create({name, formula: parsed.formula, results});
    trace.add("table imported", {rows: results.length, items: results.filter(r => r.type === "document").length});
    countFeature(MODULE_ID, "tableImported");
    ui.notifications.info(t("SDT.Import.created", {name: table.name}));
    await this.close();
    table.sheet.render(true);
  }
}
