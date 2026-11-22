// Sample windows (api.samples, contract in samples.mjs): the windows, cards and questions of the module filled with a made-up
// table, so translators and testers see every text in its place without building tables first. Nothing here writes: the
// documents are built in memory and never created, buttons that would change, post or give something only say that they do
// nothing, no usage counter counts.
import {MODULE_ID, esc, setting, t} from "./config.mjs";
import {ActionEditor} from "./action-app.mjs";
import {cardHtml, problemText} from "./card.mjs";
import {ConditionsEditor} from "./conditions-app.mjs";
import {DeepRoll} from "./deep-app.mjs";
import {tableLink} from "./enrichers.mjs";
import {giveFormHtml} from "./give.mjs";
import {ImportApp} from "./import-app.mjs";
import {LibraryApp, loadLibrary} from "./library-app.mjs";
import {PlayerTablesApp} from "./player-tables.mjs";
import {ACTION_TYPES} from "./actions.mjs";
import {StoryTagsApp} from "./tags-app.mjs";
import {onRenderRollTableSheet, onRenderTableResultActions, onRenderTableResultConfig} from "./sheet.mjs";
import {closeSample, markSample, openSampleChat, openSampleHtml, sampleActions, sampleCast, sampleId} from "./samples.mjs";
import {sampleActionFlags, sampleCard, sampleConditions, sampleImportText, samplePlayerTables, sampleProblems,
  sampleResultTable, sampleRoll, sampleTableData, sampleTags} from "./sample-data.mjs";

const tx = (key, data) => t(key, data);

/** The sample table, built in memory (never created). */
function makeTable(data = sampleTableData(tx)) {
  return new RollTable.implementation(data);
}

/** A result of a table of one row, for the windows that edit a result. */
function makeResult(name, flags) {
  return makeTable(sampleResultTable(tx, name, flags)).results.contents[0];
}

/** Open a sample window of a class: marked, actions blocked except the ones that only look. */
async function openApp(id, make) {
  const appId = sampleId(MODULE_ID, id);
  await closeSample(appId);
  const app = markSample(make(appId));
  await app.render({force: true});
  return app;
}

/* -------------------------------------------- */
/*  Windows of the module over sample data      */
/* -------------------------------------------- */

class SampleDeepRoll extends DeepRoll {
  constructor(table, {empty = false, ...options} = {}) {
    super(table, options);
    this.sampleEmpty = empty;
  }

  /** The roll is always the same made-up one, drawing again gives it back. */
  async reroll() {
    const roll = sampleRoll(tx, {empty: this.sampleEmpty});
    this.lines = roll.lines;
    this.state = roll.state;
    this.rolls = [];
    this.drawCount = roll.draws;
  }

  /** @override */
  async _prepareContext(options) {
    if ( !this.sampleRolled ) {
      this.sampleRolled = true;
      await this.reroll();
    }
    const context = await super._prepareContext(options);
    // the table of the empty roll is not in the world, so the window cannot find it for the reset button
    if ( this.sampleEmpty && game.user.isGM ) context.resetName = this.table.name;
    return context;
  }
}

class SampleStoryTags extends StoryTagsApp {
  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tags = sampleTags(tx);
    context.empty = false;
    context.full = false;
    return context;
  }
}

class SamplePlayerTables extends PlayerTablesApp {
  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tables = samplePlayerTables(tx);
    return context;
  }
}

class SampleLibrary extends LibraryApp {
  /** Some tables ticked and one open in the preview, so the footer and the preview show their texts. */
  async #prime() {
    if ( this.primed ) return;
    this.primed = true;
    const library = await loadLibrary(this.lang).catch(() => null);
    if ( !library ) return;
    for ( const key of ["enc-forest", "trinkets", "name-any"] ) if ( library.tables.has(key) ) this.selected.add(key);
    this.preview = library.tables.has("enc-forest") ? "enc-forest" : [...library.tables.keys()][0];
  }

  /** @override */
  async _prepareContext(options) {
    await this.#prime();
    return super._prepareContext(options);
  }
}

/* -------------------------------------------- */
/*  Parts of the core table windows             */
/* -------------------------------------------- */

/** A frame of the module's stylesheet around a piece of HTML built the way Foundry's table windows build theirs. */
function frame(html) {
  const wrap = document.createElement("div");
  wrap.className = "sdt-sample-sheet";
  wrap.dataset.sdtTheme = setting("theme");
  wrap.style.padding = "8px";
  wrap.innerHTML = html;
  return wrap;
}

/**
 * The rows of a table window the way Foundry draws them, so the module's own code adds its fields to them. The module's
 * code runs on the element while it is part of the page (it fills in the memory counter a moment later).
 */
async function tableSheet(table, edit) {
  const rows = table.results.contents.map((result, index) => {
    const range = (result.range[0] === result.range[1]) ? String(result.range[0]) : `${result.range[0]}–${result.range[1]}`;
    return `<tr data-result-id="${esc(result.id)}"><td class="range" style="display:flex;flex-direction:column;align-items:center;gap:2px">${esc(range)}</td><td class="name">${esc(result.name)}`
      + `<input type="hidden" name="results.${index}._id" value="${esc(result.id)}"></td><td class="details"></td></tr>`;
  }).join("");
  const label = game.i18n.has("TABLE.DisplayRoll") ? game.i18n.localize("TABLE.DisplayRoll") : table.formula;
  const options = edit ? `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><input type="checkbox" name="displayRoll"></div></div>` : "";
  const element = frame(`<form class="standard-form"><header class="sheet-header"><h1>${esc(table.name)}</h1></header>${options}`
    + `<table class="sdt-sample-rows"><tbody>${rows}</tbody></table></form>`);
  element.style.visibility = "hidden";
  element.style.position = "fixed";
  document.body.append(element);
  try {
    onRenderRollTableSheet({document: table, isEditable: edit}, element);
    await new Promise(resolve => setTimeout(resolve, 60));
  } finally {
    element.remove();
    element.style.visibility = "";
    element.style.position = "";
  }
  return element;
}

/** The window of one result with the fields the module adds to it. */
function resultWindow(result) {
  const element = frame(`<form class="standard-form"><div class="form-group slim"><label>${esc(result.name)}</label>`
    + `<div class="form-fields"><input type="number" name="weight" value="1"></div></div></form>`);
  const app = {id: "sdt-sample-result", document: result};
  onRenderTableResultConfig(app, element);
  onRenderTableResultActions(app, element);
  return element;
}

/** The link buttons of a journal text. */
function journalPage(table) {
  const wrap = frame(`<div class="journal-entry-page"><p></p><p></p></div>`);
  const [first, second] = wrap.querySelectorAll("p");
  first.append(`${tx("SDT.Sample.table.intro")} `, tableLink(table, table.name));
  second.append(`${tx("SDT.Sample.table.introMissing")} `, tableLink(null, tx("SDT.Sample.table.missingName")));
  return wrap;
}

/** The question of "give to a character" with sample heroes and loot. */
function giveQuestion() {
  const cast = sampleCast();
  const groups = [
    {label: t("SDT.Give.selected"), actors: [cast[0]]},
    {label: t("SDT.Give.heroes"), actors: cast.filter(member => member.side === "party")},
    {label: t("SDT.Give.others"), actors: cast.filter(member => member.side !== "party").slice(0, 2)}
  ];
  const lines = sampleCard(tx, {name: cast[0].name}).lines.filter(line => line.kind === "item" || line.kind === "coins");
  return `<div class="sdt-sample-dialog" data-sdt-theme="${esc(setting("theme"))}">${giveFormHtml(groups, lines, true)}`
    + `<footer class="form-footer"><button type="button">${esc(t("SDT.Give.ok"))}</button></footer></div>`;
}

/* -------------------------------------------- */
/*  The list of samples                         */
/* -------------------------------------------- */

/**
 * The entries of `api.samples()`.
 * @returns {{id: string, label: string, group: string, open: () => Promise<object>}[]}
 */
export function sampleWindows() {
  const gm = game.user.isGM;
  const entries = [];
  const add = (id, group, label, open) => entries.push({id, label, group: t(`SDT.Sample.group.${group}`), open});
  const cast = sampleCast();
  const html = (id, title, body, width = 460) => openSampleHtml({moduleId: MODULE_ID, id, title, body, width, classes: ["sdt-sample"]});

  add("deep", "roll", t("SDT.Sample.label.deep"), () => openApp("deep", appId => new SampleDeepRoll(makeTable(), {id: appId,
    actions: sampleActions(DeepRoll, ["rerollAll"])})));
  add("deep-empty", "roll", t("SDT.Sample.label.deepEmpty"), () => openApp("deep-empty", appId => new SampleDeepRoll(
    makeTable(sampleTableData(tx, {empty: true})), {id: appId, empty: true, actions: sampleActions(DeepRoll, ["rerollAll"])})));

  const card = async (id, title, options = () => ({})) => openSampleChat({moduleId: MODULE_ID, id, title, width: 380,
    content: async () => {
      const data = options();
      return cardHtml({table: data.table, lines: data.lines, notes: data.notes ?? [], draws: data.draws, by: data.by ?? "", note: data.note ?? ""});
    },
    flags: () => {
      const data = options();
      return {[MODULE_ID]: {card: {v: 1, table: data.table, mode: "public", draws: data.draws, lines: data.lines, given: data.given ?? [], runs: data.runs ?? []}}};
    },
    rolls: async () => {
      const roll = new Roll("1d10");
      await roll.evaluate({allowInteractive: false});
      return [roll];
    }});
  add("card", "card", t("SDT.Sample.label.card"), () => card("card", t("SDT.Sample.label.card"), () => sampleCard(tx, {name: cast[0].name})));
  add("card-notes", "card", t("SDT.Sample.label.cardNotes"), () => card("card-notes", t("SDT.Sample.label.cardNotes"), () => {
    const data = sampleCard(tx, {name: cast[0].name});
    return {...data, lines: data.lines.slice(0, 3).map(line => ({...line, act: null})), runs: [], given: [], draws: 3, by: cast[0].player,
      note: t("SDT.Players.triggerNote", {name: t("SDT.Sample.trigger")}), notes: sampleProblems(tx).map(problemText)};
  }));

  if ( gm ) {
    for ( const type of ACTION_TYPES ) {
      add(`action-${type}`, "results", t("SDT.Sample.label.action", {type: t(`SDT.Action.type.${type}`)}), () => openApp(`action-${type}`, appId => {
        const result = makeResult(t("SDT.Sample.table.howl"), sampleActionFlags(type, tx));
        return new ActionEditor(result, {id: appId, actions: sampleActions(ActionEditor)});
      }));
    }
    add("conditions", "results", t("SDT.Sample.label.conditions"), () => openApp("conditions", appId => {
      const result = makeResult(t("SDT.Sample.table.pelt"), {conditions: sampleConditions(tx, game.scenes.contents[0]?.id ?? null)});
      return new ConditionsEditor(result, {id: appId, actions: sampleActions(ConditionsEditor)});
    }));
    add("library", "tables", t("SDT.Sample.label.library"), () => openApp("library", appId => new SampleLibrary({id: appId,
      actions: sampleActions(LibraryApp, ["show", "all", "none"])})));
    add("import", "tables", t("SDT.Sample.label.import"), () => openApp("import", appId => new ImportApp({id: appId, text: sampleImportText(tx),
      actions: sampleActions(ImportApp)})));
    add("tags", "tables", t("SDT.Sample.label.tags"), () => openApp("tags", appId => new SampleStoryTags({id: appId, actions: sampleActions(StoryTagsApp)})));
    add("sheet-edit", "tables", t("SDT.Sample.label.sheetEdit"), async () => html("sheet-edit", t("SDT.Sample.label.sheetEdit"),
      async () => tableSheet(makeTable(), true), 560));
    add("result", "tables", t("SDT.Sample.label.resultConfig"), () => html("result", t("SDT.Sample.label.resultConfig"),
      () => resultWindow(makeTable().results.contents[7]), 440));
    add("give", "tables", t("SDT.Sample.label.give"), () => html("give", t("SDT.Give.title"), giveQuestion, 420));
    add("empty-ask", "tables", t("SDT.Sample.label.emptyAsk"), () => html("empty-ask", t("SDT.Draw.emptyTitle"),
      () => `<div class="sdt-sample-dialog"><p>${esc(t("SDT.Draw.emptyAsk", {name: t("SDT.Sample.table.name")}))}</p></div>`, 380));
  }
  add("players", "tables", t("SDT.Sample.label.players"), () => openApp("players", appId => new SamplePlayerTables({id: appId,
    actions: sampleActions(PlayerTablesApp)})));
  add("sheet-view", "tables", t("SDT.Sample.label.sheetView"), () => html("sheet-view", t("SDT.Sample.label.sheetView"),
    async () => tableSheet(makeTable(), false), 560));
  add("journal", "tables", t("SDT.Sample.label.journal"), () => html("journal", t("SDT.Sample.label.journal"), () => journalPage(makeTable()), 420));
  return entries;
}
