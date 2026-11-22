/**
 * Tables for players and for Roll Triggers. The GM marks a table "players may roll"; a world setting keeps the list
 * for the players (they often cannot see the tables themselves), and a roll of a player goes over the module socket
 * to the active GM, who rolls and posts the card with the table's visibility. With Roll Triggers active, its "roll
 * table" action rolls with Deep Tables.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, imageOr, isActive, setting, t} from "./config.mjs";
import {checkRequest, listEntries, playersMayRoll, sameEntries} from "./players.mjs";
import {drawNow} from "./flow.mjs";
import {rollTable} from "./engine.mjs";
import {countFeature} from "./usage.mjs";
import {trace} from "./debug.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** The socket of the module. */
const SOCKET = `module.${MODULE_ID}`;

/** The id of Roll Triggers. */
export const TRIGGERS = "sephrals-roll-triggers";

/**
 * Is Roll Triggers active?
 * @returns {boolean}
 */
export function triggersActive() {
  return isActive(TRIGGERS);
}

/* -------------------------------------------- */
/*  The list for the players                    */
/* -------------------------------------------- */

/**
 * The tables players may roll, as the GM sees them.
 * @returns {object[]}
 */
function currentEntries() {
  return listEntries(game.tables.map(table => ({
    uuid: table.uuid,
    name: table.name,
    img: table.img,
    mode: table.flags?.[MODULE_ID]?.mode,
    players: playersMayRoll(path => foundry.utils.getProperty(table.flags ?? {}, path)),
    pack: !!table.pack
  })));
}

/**
 * GM: write the list for the players when it changed.
 * @returns {Promise<boolean>}
 */
export async function syncPlayerTables() {
  if ( !game.user.isGM ) return false;
  const entries = currentEntries();
  if ( sameEntries(entries, setting("playerTables")) ) return false;
  await game.settings.set(MODULE_ID, "playerTables", entries);
  return true;
}

/**
 * The tables a player may roll.
 * @returns {{uuid: string, name: string, img: string, mode: string}[]}
 */
export function playerTables() {
  const list = game.user.isGM ? currentEntries() : setting("playerTables");
  return Array.isArray(list) ? list : [];
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * GM: roll a table for a player.
 * @param {string} uuid
 * @param {string} userId
 * @returns {Promise<"ok"|"empty"|"nothing"|"denied"|"missing"|"invalid">}
 */
async function rollForPlayer(uuid, userId) {
  const table = (typeof uuid === "string") ? await fromUuid(uuid).catch(() => null) : null;
  const doc = (table instanceof RollTable) ? table : null;
  const check = checkRequest({uuid}, doc ? {players: playersMayRoll(path => foundry.utils.getProperty(doc.flags ?? {}, path)),
    pack: !!doc.pack, mode: doc.flags?.[MODULE_ID]?.mode} : null);
  if ( !check.ok ) return check.reason;
  const done = await drawNow(doc, {mode: check.mode, userId, force: true});
  countFeature(MODULE_ID, "playerRoll");
  trace.add("player roll", {table: doc.name, user: game.users.get(userId)?.name, mode: check.mode, ok: !!done?.message});
  if ( done?.message ) return "ok";
  return done?.problems?.some(p => p.kind === "empty") ? "empty" : "nothing";
}

/**
 * Roll a table of the list. A GM rolls at once, a player asks the active GM.
 * @param {string} uuid
 * @returns {Promise<boolean>}   Whether the roll was made or asked for
 */
export async function rollListed(uuid) {
  if ( game.user.isGM ) {
    const status = await rollForPlayer(uuid, game.user.id);
    if ( status !== "ok" ) ui.notifications.info(t(`SDT.Players.status.${status}`));
    return status === "ok";
  }
  if ( !game.users.activeGM ) {
    ui.notifications.warn(t("SDT.Players.noGM"));
    return false;
  }
  game.socket.emit(SOCKET, {type: "roll", uuid, userId: game.user.id});
  return true;
}

/**
 * Handle a message of the socket.
 * @param {object} data
 */
async function onSocket(data) {
  if ( data?.type === "roll" ) {
    if ( !game.user.isGM || !game.users.activeGM?.isSelf ) return;
    const user = game.users.get(data.userId);
    if ( !user?.active ) return;
    let status = "invalid";
    try {
      status = await rollForPlayer(data.uuid, user.id);
    } catch(err) {
      console.error(`${MODULE_ID} |`, err);
    }
    game.socket.emit(SOCKET, {type: "ack", userId: user.id, uuid: data.uuid, status});
  }
  else if ( (data?.type === "ack") && (data.userId === game.user.id) && !game.user.isGM ) {
    const key = `SDT.Players.status.${data.status}`;
    if ( game.i18n.has(key) ) ui.notifications.info(t(key));
  }
}

/* -------------------------------------------- */
/*  Roll Triggers                               */
/* -------------------------------------------- */

/**
 * Hook "sephrals-roll-triggers.rollTable": roll the table of a trigger with Deep Tables. Roll Triggers runs actions
 * only on the active GM.
 * @param {object} claim
 */
function onTriggerRollTable(claim) {
  if ( claim.handled || !setting("triggerTables") || !game.user.isGM ) return;
  claim.handled = true;
  countFeature(MODULE_ID, "triggerRoll");
  claim.result = (async () => {
    const note = t("SDT.Players.triggerNote", {name: claim.trigger?.name ?? ""});
    if ( claim.postResult ) {
      const done = await drawNow(claim.table, {force: true, whisper: claim.whisper ?? [], flags: claim.flags, note});
      return done ? {roll: null, results: (done.lines ?? []).filter(l => l.include).map(l => ({text: l.text ?? l.name}))} : null;
    }
    const roll = await rollTable(claim.table, {});
    return {roll: roll.rolls[0] ?? null, results: roll.lines.filter(l => l.include).map(l => ({text: l.text ?? l.name}))};
  })();
}

/* -------------------------------------------- */
/*  Wiring                                      */
/* -------------------------------------------- */

/** Keep the list in step with the tables (the GM who changed a table writes it). */
function watchTables() {
  const sync = (doc, ...rest) => {
    const userId = rest.at(-1);
    if ( game.user.isGM && ((typeof userId !== "string") || (userId === game.user.id)) ) syncPlayerTables().catch(() => {});
  };
  for ( const hook of ["createRollTable", "updateRollTable", "deleteRollTable"] ) Hooks.on(hook, sync);
}

/** At "ready": the socket, the watch, the first sync, the link to Roll Triggers. */
export function readyPlayerTables() {
  game.socket.on(SOCKET, onSocket);
  watchTables();
  if ( game.user.isGM && game.users.activeGM?.isSelf ) syncPlayerTables().catch(err => console.warn(`${MODULE_ID} |`, err));
  Hooks.on("sephrals-roll-triggers.rollTable", onTriggerRollTable);
  Hooks.on("renderChatInput", syncChatButton);
  syncChatButton();
}

/**
 * Put the button that opens the list into the chat controls (beside the buttons for the message mode), or take it
 * away when no table is released. The chat controls move between the sidebar and the notifications, so this looks
 * them up by id.
 */
export function syncChatButton() {
  const controls = document.getElementById("chat-controls");
  if ( !controls ) return;
  const existing = controls.querySelector(".sdt-chat-tables");
  if ( !playerTables().length ) {
    existing?.remove();
    return;
  }
  if ( existing ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sdt-chat-tables ui-control icon fa-solid fa-dice-d20";
  button.dataset.tooltip = t("SDT.Players.open");
  button.setAttribute("aria-label", t("SDT.Players.open"));
  button.addEventListener("click", event => {
    event.preventDefault();
    openPlayerTables();
  });
  controls.prepend(button);
}

/** Redraw the open list, and the chat button, after the list changed. */
export function refreshPlayerTables() {
  const open = foundry.applications.instances.get("sdt-player-tables");
  if ( open?.rendered ) open.render();
  syncChatButton();
}

/* -------------------------------------------- */
/*  The list window                             */
/* -------------------------------------------- */

/**
 * Open the list of tables players may roll.
 * @returns {Promise<PlayerTablesApp>}
 */
export async function openPlayerTables() {
  const open = foundry.applications.instances.get("sdt-player-tables");
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new PlayerTablesApp();
  await app.render({force: true});
  return app;
}

export class PlayerTablesApp extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(options = {}) {
    super({id: "sdt-player-tables", ...options});
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sdt-app", "sdt-players-app"],
    window: {icon: "fa-solid fa-dice-d20", resizable: true},
    position: {width: 340, height: "auto"},
    actions: {roll: PlayerTablesApp.#onRoll}
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/players.hbs`, scrollable: [".sdt-lines"]}};

  /** @override */
  get title() {
    return t("SDT.Players.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tables = playerTables().map(entry => ({uuid: entry.uuid, name: entry.name, img: imageOr(entry.img),
      shown: t(`SDT.Mode.${entry.mode === "foundry" ? "public" : entry.mode}`)}));
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

  /** @this {PlayerTablesApp} */
  static async #onRoll(event, target) {
    const uuid = target.dataset.uuid;
    target.disabled = true;
    try {
      await rollListed(uuid);
    } finally {
      target.disabled = false;
    }
  }
}
