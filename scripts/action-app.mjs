/**
 * The small window where the GM sets what a result does: its action and whether it runs on its own. The action is
 * saved in the flags of the result.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, esc, removeKey, setting, t} from "./config.mjs";
import {ACTION_TYPES, isComplete, normalizeAction} from "./actions.mjs";
import {encountersApi} from "./act.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Open the action window of a result.
 * @param {TableResult} result
 * @returns {Promise<ActionEditor|null>}
 */
export async function openActionEditor(result) {
  if ( !game.user.isGM || !result ) return null;
  const id = `sdt-action-${result.uuid.replace(/[^A-Za-z0-9]/g, "-")}`;
  const open = foundry.applications.instances.get(id);
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new ActionEditor(result, {id});
  await app.render({force: true});
  return app;
}

export class ActionEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {TableResult} result
   * @param {object} [options]
   */
  constructor(result, options = {}) {
    super(options);
    this.result = result;
    const stored = foundry.utils.getProperty(result.flags ?? {}, `${MODULE_ID}.action`);
    /** What the form holds. */
    this.data = normalizeAction(stored) ?? {type: "", auto: false};
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sdt-app", "sdt-action-app"],
    window: {icon: "fa-solid fa-bolt", resizable: false},
    position: {width: 460, height: "auto"},
    actions: {save: ActionEditor.#onSave, remove: ActionEditor.#onRemove, pickFile: ActionEditor.#onPickFile}
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/action.hbs`}};

  /** @override */
  get title() {
    return t("SDT.Action.title", {name: this.result.name || this.result.description?.replace(/<[^>]*>/g, "").slice(0, 40) || "…"});
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const data = this.data;
    const linked = this.result.documentUuid ?? "";
    context.theme = setting("theme");
    context.types = [{value: "", label: t("SDT.Action.type.none"), selected: !data.type},
      ...ACTION_TYPES.map(value => ({value, label: t(`SDT.Action.type.${value}`), selected: data.type === value}))];
    context.type = data.type;
    context.is = Object.fromEntries(ACTION_TYPES.map(value => [value, data.type === value]));
    context.hint = data.type ? t(`SDT.Action.hint.${data.type}`) : t("SDT.Action.hint.none");
    context.linkedHint = linked ? t("SDT.Action.linkedHint") : "";
    context.ref = data.ref ?? "";
    context.auto = !!data.auto;
    context.combat = !!data.combat;
    context.hidden = !!data.hidden;
    context.count = data.count ?? "";
    context.src = data.src ?? "";
    context.volume = data.volume ?? 0.8;
    context.complete = isComplete(data, linked);
    // Encounters of Saved Encounters
    const api = encountersApi();
    context.encountersOn = !!api;
    const entries = api ? api.encounters() : [];
    const known = entries.some(entry => entry.uuid === data.ref);
    context.encounters = [{value: "", label: linked ? t("SDT.Action.ownLink") : "–", selected: !data.ref},
      ...entries.map(entry => ({value: entry.uuid, label: entry.name, selected: entry.uuid === data.ref})),
      ...((data.ref && !known) ? [{value: data.ref, label: data.ref, selected: true}] : [])];
    // Actors, for the suggestions of the token field
    context.actorNames = game.actors.map(actor => actor.name).sort((a, b) => a.localeCompare(b));
    context.shows = ["show", "open"].map(value => ({value, label: t(`SDT.Action.show.${value}`),
      selected: (data.show ?? "show") === value}));
    context.targets = ["selected", "targeted"].map(value => ({value, label: t(`SDT.Action.target.${value}`),
      selected: (data.target ?? "selected") === value}));
    const statuses = (CONFIG.statusEffects ?? []).map(status => ({value: status.id,
      label: game.i18n.localize(status.name ?? status.label ?? status.id), selected: status.id === data.status}));
    context.statuses = [{value: "", label: t("SDT.Action.noStatus"), selected: !data.status}, ...statuses.sort((a, b) => a.label.localeCompare(b.label))];
    // Macros of the world
    const macros = game.macros.contents.map(macro => ({value: macro.uuid, label: macro.name, selected: macro.uuid === data.ref}));
    const macroKnown = macros.some(macro => macro.selected);
    context.macros = [{value: "", label: linked ? t("SDT.Action.ownLink") : "–", selected: !data.ref},
      ...macros.sort((a, b) => a.label.localeCompare(b.label)),
      ...((data.ref && !macroKnown) ? [{value: data.ref, label: data.ref, selected: true}] : [])];
    context.canRemove = !!foundry.utils.getProperty(this.result.flags ?? {}, `${MODULE_ID}.action`);
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
    const form = this.element;
    // Changing the type shows its fields
    form.querySelector("select[name=type]")?.addEventListener("change", event => {
      this.#read();
      this.data = {...this.data, type: event.currentTarget.value};
      this.render();
    });
    // Documents dropped on a reference field
    for ( const input of form.querySelectorAll("input[data-drop]") ) {
      input.addEventListener("dragover", event => event.preventDefault());
      input.addEventListener("drop", event => {
        event.preventDefault();
        const dropped = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if ( dropped?.uuid ) input.value = dropped.uuid;
      });
    }
  }

  /** Take the typed values into the data. */
  #read() {
    const form = this.element;
    const get = name => form.querySelector(`[name=${name}]`);
    const data = {type: get("type")?.value ?? this.data.type};
    for ( const name of ["ref", "count", "src", "status", "show", "target"] ) {
      const field = get(name);
      if ( field ) data[name] = field.value;
    }
    for ( const name of ["auto", "combat", "hidden"] ) {
      const field = get(name);
      if ( field ) data[name] = field.checked;
    }
    const volume = get("volume");
    if ( volume ) data.volume = Number(volume.value);
    this.data = {...this.data, ...data};
  }

  /** @this {ActionEditor} */
  static async #onSave() {
    this.#read();
    const action = normalizeAction(this.data);
    if ( !action ) return ActionEditor.#onRemove.call(this);
    if ( !isComplete(action, this.result.documentUuid ?? null) ) {
      ui.notifications.warn(t("SDT.Action.incomplete"));
      return;
    }
    await this.result.update({[`flags.${MODULE_ID}.action`]: action});
    await this.close();
  }

  /** @this {ActionEditor} */
  static async #onRemove() {
    if ( foundry.utils.getProperty(this.result.flags ?? {}, `${MODULE_ID}.action`) ) {
      await this.result.update(removeKey(`flags.${MODULE_ID}`, "action"));
    }
    await this.close();
  }

  /** The file browser for a sound. @this {ActionEditor} */
  static async #onPickFile() {
    this.#read();
    const picker = new foundry.applications.apps.FilePicker.implementation({type: "audio", current: this.data.src ?? "",
      callback: path => {
        this.data = {...this.data, src: path};
        this.render();
      }});
    picker.render({force: true});
  }
}

/**
 * A button for a result row or a result window: opens the action window, and shows that an action is set.
 * @param {TableResult} result
 * @returns {HTMLButtonElement}
 */
export function actionButton(result) {
  const stored = normalizeAction(foundry.utils.getProperty(result.flags ?? {}, `${MODULE_ID}.action`));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sdt-act-edit";
  if ( stored ) button.classList.add("sdt-act-set");
  const label = stored ? t(`SDT.Action.type.${stored.type}`) : t("SDT.Action.add");
  button.dataset.tooltip = stored ? `${t("SDT.Action.edit")}: ${label}` : t("SDT.Action.addHint");
  button.innerHTML = `<i class="fa-solid fa-bolt" inert></i><span>${esc(label)}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openActionEditor(result);
  });
  return button;
}
