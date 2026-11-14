/**
 * The small window where the GM sets the conditions of a result row: scenes, Regions, time of day, party level and
 * story tags. The conditions are saved in the flags of the result.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, esc, removeKey, replaceKey, setting, t} from "./config.mjs";
import {PERIODS, normalizeConditions} from "./conditions.mjs";
import {conditionsSummary, currentSituation, dayHours, periodName, storyTags} from "./situation.mjs";
import {openStoryTags} from "./tags-app.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Open the conditions window of a result.
 * @param {TableResult} result
 * @returns {Promise<ConditionsEditor|null>}
 */
export async function openConditionsEditor(result) {
  if ( !game.user.isGM || !result ) return null;
  const id = `sdt-conditions-${result.uuid.replace(/[^A-Za-z0-9]/g, "-")}`;
  const open = foundry.applications.instances.get(id);
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new ConditionsEditor(result, {id});
  await app.render({force: true});
  return app;
}

export class ConditionsEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {TableResult} result
   * @param {object} [options]
   */
  constructor(result, options = {}) {
    super(options);
    this.result = result;
    /** What the form holds. */
    this.data = normalizeConditions(foundry.utils.getProperty(result.flags ?? {}, `${MODULE_ID}.conditions`)) ?? {};
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sdt-app", "sdt-conditions-app"],
    window: {icon: "fa-solid fa-filter", resizable: false},
    position: {width: 480, height: "auto"},
    actions: {save: ConditionsEditor.#onSave, remove: ConditionsEditor.#onRemove, editTags: ConditionsEditor.#onEditTags}
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/conditions.hbs`, scrollable: [".sdt-cond-scenes"]}};

  /** @override */
  get title() {
    const name = this.result.name || this.result.description?.replace(/<[^>]*>/g, "").slice(0, 40) || "…";
    return t("SDT.Cond.title", {name});
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const data = this.data;
    context.theme = setting("theme");
    context.scenes = game.scenes.contents.map(scene => ({id: scene.id, name: scene.name,
      checked: !!data.scenes?.includes(scene.id)})).sort((a, b) => a.name.localeCompare(b.name));
    const known = new Set(game.scenes.map(scene => scene.id));
    context.missingScenes = (data.scenes ?? []).filter(id => !known.has(id)).length;
    context.regions = (data.regions ?? []).join(", ");
    const names = new Set();
    for ( const scene of game.scenes ) for ( const region of scene.regions ?? [] ) if ( region.name ) names.add(region.name);
    context.regionNames = [...names].sort((a, b) => a.localeCompare(b));
    const hours = dayHours();
    const order = [...PERIODS].sort((a, b) => hours[a] - hours[b]);
    const clock = hour => `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
    context.times = PERIODS.map(period => {
      const next = order[(order.indexOf(period) + 1) % order.length];
      return {period, label: periodName(period), hours: t("SDT.Cond.hoursRange", {from: clock(hours[period]), to: clock(hours[next])}),
        checked: !!data.times?.includes(period)};
    });
    context.levelMin = data.level?.min ?? "";
    context.levelMax = data.level?.max ?? "";
    const tags = storyTags();
    const stale = Object.keys(data.tags ?? {}).filter(id => !tags.some(tag => tag.id === id)).map(id => ({id, name: id, on: false}));
    context.tags = [...tags, ...stale].map((tag, index) => {
      const want = data.tags?.[tag.id];
      return {index, id: tag.id, name: tag.name, on: tag.on,
        options: [{value: "", label: t("SDT.Cond.tagAny"), selected: want === undefined},
          {value: "on", label: t("SDT.Cond.tagOn"), selected: want === true},
          {value: "off", label: t("SDT.Cond.tagOff"), selected: want === false}]};
    });
    context.noTags = !context.tags.length;
    const now = currentSituation();
    context.now = t("SDT.Cond.now", {period: periodName(now.period), hour: Math.floor(now.hour)});
    context.canRemove = !!foundry.utils.getProperty(this.result.flags ?? {}, `${MODULE_ID}.conditions`);
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
  }

  /** Take the typed values into the data. */
  #read() {
    const form = this.element;
    const all = selector => [...form.querySelectorAll(selector)];
    const number = name => {
      const value = form.querySelector(`[name=${name}]`)?.value;
      return (value === "" || value === undefined) ? null : Number(value);
    };
    const tags = {};
    for ( const select of all("select[name=tag]") ) {
      if ( select.value === "on" ) tags[select.dataset.id] = true;
      else if ( select.value === "off" ) tags[select.dataset.id] = false;
    }
    // Scenes that are not in this world are kept, the checkboxes only know the scenes of this one
    const known = new Set(game.scenes.map(scene => scene.id));
    const scenes = [...(this.data.scenes ?? []).filter(id => !known.has(id)),
      ...all("input[name=scene]:checked").map(input => input.value)];
    this.data = {
      scenes,
      regions: (form.querySelector("[name=regions]")?.value ?? "").split(",").map(name => name.trim()).filter(Boolean),
      times: all("input[name=time]:checked").map(input => input.value),
      level: {min: number("levelMin"), max: number("levelMax")},
      tags
    };
  }

  /** @this {ConditionsEditor} */
  static async #onSave() {
    this.#read();
    const conditions = normalizeConditions(this.data);
    if ( !conditions ) return ConditionsEditor.#onRemove.call(this);
    await this.result.update(replaceKey(`flags.${MODULE_ID}`, "conditions", conditions), {diff: false});
    countFeature(MODULE_ID, "conditionsSet");
    await this.close();
  }

  /** @this {ConditionsEditor} */
  static async #onRemove() {
    if ( foundry.utils.getProperty(this.result.flags ?? {}, `${MODULE_ID}.conditions`) ) {
      await this.result.update(removeKey(`flags.${MODULE_ID}`, "conditions"));
    }
    await this.close();
  }

  /** @this {ConditionsEditor} */
  static async #onEditTags() {
    this.#read();
    await openStoryTags();
    this.render();
  }
}

/**
 * A button for a result row or a result window: opens the conditions window, and shows when conditions are set.
 * @param {TableResult} result
 * @returns {HTMLButtonElement}
 */
export function conditionsButton(result) {
  const stored = normalizeConditions(foundry.utils.getProperty(result.flags ?? {}, `${MODULE_ID}.conditions`));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sdt-cond-edit";
  if ( stored ) button.classList.add("sdt-cond-set");
  const summary = stored ? conditionsSummary(stored) : "";
  const label = stored ? t("SDT.Cond.setShort") : t("SDT.Cond.add");
  button.dataset.tooltip = stored ? `${t("SDT.Cond.edit")}: ${summary}` : t("SDT.Cond.addHint");
  button.innerHTML = `<i class="fa-solid fa-filter" inert></i><span>${esc(label)}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openConditionsEditor(result);
  });
  return button;
}
