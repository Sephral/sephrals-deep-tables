/**
 * The deep roll window: the results of a roll before anybody sees them. Lines can be unticked, quantities changed,
 * single lines drawn again, everything drawn again, the number of draws and the visibility set. "Show in chat"
 * posts the card.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, imageOr, setting, t} from "./config.mjs";
import {coinLabel} from "./coins.mjs";
import {coinsText, summarize} from "./draw.mjs";
import {countersOf, offerReset, putBack, resetTable, resolveTable, rerollLine, rollTable, settingsOf,
  showsCounter} from "./engine.mjs";
import {canRoll, postRoll} from "./flow.mjs";
import {problemText} from "./card.mjs";
import {MODES} from "./modes.mjs";
import {trace} from "./debug.mjs";
import {reasonText, situationText} from "./situation.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Open the deep roll window of a table.
 * @param {RollTable|string} ref
 * @returns {Promise<DeepRoll|null>}
 */
export async function openDeepRoll(ref) {
  const table = await resolveTable(ref);
  if ( !table || !canRoll(table) ) return null;
  const id = `sdt-deep-${table.uuid.replace(/[^A-Za-z0-9]/g, "-")}`;
  const open = foundry.applications.instances.get(id);
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new DeepRoll(table, {id});
  await app.reroll();
  await app.render({force: true});
  countFeature(MODULE_ID, "deepRoll");
  return app;
}

export class DeepRoll extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {RollTable} table
   * @param {object} [options]
   */
  constructor(table, options = {}) {
    super(options);
    this.table = table;
    const saved = settingsOf(table);
    this.inputs = {draws: saved.draws, distinct: saved.distinct, mode: saved.mode};
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sdt-app", "sdt-deep"],
    window: {icon: "fa-solid fa-dice", resizable: true},
    position: {width: 520, height: "auto"},
    actions: {
      rerollAll: DeepRoll.#onRerollAll,
      rerollLine: DeepRoll.#onRerollLine,
      resetTable: DeepRoll.#onResetTable,
      resetMemory: DeepRoll.#onResetMemory,
      putBackOne: DeepRoll.#onPutBack,
      post: DeepRoll.#onPost
    }
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/deep-roll.hbs`, scrollable: [".sdt-lines"]}};

  /** @type {import("./draw.mjs").Line[]} */
  lines = [];

  /** @type {import("./draw.mjs").DrawState|null} */
  state = null;

  /** The rolls of the number of draws. */
  rolls = [];

  /** The number of draws of the last roll. */
  drawCount = 1;

  /** @override */
  get title() {
    return t("SDT.Deep.title", {name: this.table.name});
  }

  /** Draw everything again with the inputs of the window. */
  async reroll() {
    const roll = await rollTable(this.table, {draws: this.inputs.draws, distinct: this.inputs.distinct});
    this.lines = roll.lines;
    this.state = roll.state;
    this.rolls = roll.rolls;
    this.drawCount = roll.draws;
    if ( roll.invalidDraws ) ui.notifications.warn(t("SDT.Deep.invalidDraws"));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const lines = this.lines;
    const sum = summarize(lines);
    const coins = Object.keys(sum.coins).length ? coinsText(sum.coins, coinLabel) : "";
    const empty = this.state?.problems.find(p => (p.kind === "empty") && p.uuid);
    const resetTable = empty ? await fromUuid(empty.uuid).catch(() => null) : null;
    const icons = {coins: "fa-coins", text: "fa-scroll", link: "fa-link", item: "fa-suitcase"};
    context.theme = setting("theme");
    context.name = this.table.name;
    context.img = imageOr(this.table.img);
    context.formulaText = this.table.formula;
    context.draws = this.inputs.draws;
    context.distinct = this.inputs.distinct;
    context.modes = MODES.map(value => ({value, label: t(`SDT.Mode.${value}`), selected: value === this.inputs.mode}));
    context.problems = (this.state?.problems ?? []).filter(p => !((p.kind === "empty") && (lines.length === 0) && !p.uuid))
      .map(p => ({text: problemText(p)}));
    context.left = (this.state?.left ?? []).map(entry => ({name: entry.name,
      table: (entry.tableUuid === this.table.uuid) ? "" : entry.tableName,
      reasons: entry.reasons.map(reasonText).join(" · ")}));
    context.situation = (context.left.length && this.state?.situation) ? situationText(this.state.situation) : "";
    context.counters = await this.#counters();
    context.resetName = (game.user.isGM && resetTable && !resetTable.pack) ? resetTable.name : "";
    context.empty = !lines.length;
    context.rows = lines.map(line => ({
      id: line.id,
      include: line.include,
      img: line.kind === "coins" ? "" : imageOr(line.img),
      icon: icons[line.kind],
      name: line.kind === "coins" ? coinsText(line.coins, coinLabel) : (line.kind === "text" ? line.text : line.name),
      path: (line.path.length > 1) ? line.path.join(" › ") : "",
      invalid: line.invalid,
      formula: line.formula,
      editable: line.kind === "item",
      quantity: line.quantity,
      countText: (line.kind === "link" && line.quantity > 1) ? `× ${line.quantity}` : "",
      canReroll: !!line.tableUuid
    }));
    context.invalidText = t("SDT.Deep.invalidQuantity");
    context.quantityText = t("SDT.Deep.quantity");
    context.rerollText = t("SDT.Deep.rerollLine");
    const parts = [t("SDT.Deep.summary", {items: sum.items, lines: lines.filter(l => l.include).length})];
    if ( coins ) parts.push(coins);
    context.summary = parts.join(" · ");
    context.canPost = lines.some(l => l.include && ((l.kind !== "item") || (l.quantity > 0)));
    return context;
  }

  /**
   * What the table and the tables inside it remember, for the window.
   * @returns {Promise<object[]>}
   */
  async #counters() {
    const all = await countersOf(this.table);
    const out = [];
    for ( const entry of all ) {
      const doc = (entry.uuid === this.table.uuid) ? this.table : await fromUuid(entry.uuid).catch(() => null);
      if ( !doc || doc.pack ) continue;
      if ( (doc === this.table) && !showsCounter(doc) ) continue;
      const names = entry.ids.map(id => {
        const result = doc.results.get(id);
        const text = result?.name || String(result?.description ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return {id, name: text || "…"};
      });
      out.push({uuid: entry.uuid, name: entry.name, used: entry.used, text: t("SDT.Memory.counter", {used: entry.used,
        total: entry.total}), usedResults: names, canEdit: game.user.isGM});
    }
    return out;
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
    const form = this.element;
    form.querySelector("input[name=draws]")?.addEventListener("change", event => {
      this.inputs.draws = event.currentTarget.value;
    });
    form.querySelector("input[name=distinct]")?.addEventListener("change", event => {
      this.inputs.distinct = event.currentTarget.checked;
    });
    form.querySelector("select[name=mode]")?.addEventListener("change", event => {
      this.inputs.mode = event.currentTarget.value;
    });
    for ( const row of form.querySelectorAll("[data-line-id]") ) {
      const line = this.lines.find(l => l.id === row.dataset.lineId);
      if ( !line ) continue;
      row.querySelector("input[name=include]")?.addEventListener("change", event => {
        line.include = event.currentTarget.checked;
        this.render();
      });
      row.querySelector("input[name=quantity]")?.addEventListener("change", event => {
        line.quantity = Math.max(Math.floor(Number(event.currentTarget.value) || 0), 0);
        line.include = line.quantity > 0;
        this.render();
      });
    }
  }

  /**
   * Take the typed values before an action works with them.
   */
  #readInputs() {
    const form = this.element;
    this.inputs.draws = form.querySelector("input[name=draws]")?.value ?? this.inputs.draws;
    this.inputs.distinct = form.querySelector("input[name=distinct]")?.checked ?? this.inputs.distinct;
    this.inputs.mode = form.querySelector("select[name=mode]")?.value ?? this.inputs.mode;
  }

  /* -------------------------------------------- */

  /** @this {DeepRoll} */
  static async #onRerollAll() {
    this.#readInputs();
    await this.reroll();
    this.render();
  }

  /** Draw one line again, from the table it came from. @this {DeepRoll} */
  static async #onRerollLine(event, target) {
    const index = this.lines.findIndex(l => l.id === target.closest("[data-line-id]")?.dataset.lineId);
    const line = this.lines[index];
    if ( !line ) return;
    const others = this.lines.filter((l, i) => i !== index);
    const fresh = await rerollLine(line, others, this.state);
    countFeature(MODULE_ID, "lineRerolled");
    if ( fresh.length ) this.lines.splice(index, 1, ...fresh);
    else ui.notifications.info(t("SDT.Deep.noOther"));
    this.render();
  }

  /** @this {DeepRoll} */
  static async #onResetTable() {
    const empty = this.state?.problems.find(p => (p.kind === "empty") && p.uuid);
    if ( !empty ) return;
    await offerReset(empty.uuid);
    countFeature(MODULE_ID, "tableReset");
    this.#readInputs();
    await this.reroll();
    this.render();
  }

  /** Bring back everything one table remembers. @this {DeepRoll} */
  static async #onResetMemory(event, target) {
    const doc = await fromUuid(target.dataset.uuid).catch(() => null);
    if ( !doc || !await resetTable(doc) ) return;
    countFeature(MODULE_ID, "tableReset");
    this.#readInputs();
    await this.reroll();
    this.render();
  }

  /** Put one remembered result back. @this {DeepRoll} */
  static async #onPutBack(event, target) {
    const doc = await fromUuid(target.dataset.uuid).catch(() => null);
    if ( !doc || !await putBack(doc, target.dataset.result) ) return;
    this.#readInputs();
    await this.reroll();
    this.render();
  }

  /** @this {DeepRoll} */
  static async #onPost() {
    this.#readInputs();
    for ( const button of this.element.querySelectorAll("button") ) button.disabled = true;
    try {
      const message = await postRoll(this.table, {lines: this.lines, rolls: this.rolls, state: this.state,
        draws: this.drawCount}, {mode: this.inputs.mode});
      trace.add("deep roll posted", {table: this.table.name, messageId: message?.id ?? null});
      if ( message ) await this.close();
    } finally {
      for ( const button of this.element?.querySelectorAll("button") ?? [] ) button.disabled = false;
    }
  }
}
