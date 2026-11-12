/**
 * Results that act: what happens when the GM clicks the button of a result on a card, or when the card is shown and
 * the action is set to run on its own. Only GMs run actions. Every run is written to the card (flag "runs"), with what
 * is needed to take it back where that is cheap: placed tokens and applied effects.
 */

import {MODULE_ID, isActive, setting, t} from "./config.mjs";
import {actionOf, autoRows, isComplete, referenceOf, spreadCells, MAX_TOKENS} from "./actions.mjs";
import {pickPosition} from "./bridges.mjs";
import {cardOf} from "./card.mjs";
import {trace} from "./debug.mjs";
import {countFeature} from "./usage.mjs";

/** The id of Saved Encounters. */
const ENCOUNTERS = "sephrals-saved-encounters";

/**
 * Saved Encounters' API, if the module is active and can place a group.
 * @returns {object|null}
 */
export function encountersApi() {
  if ( !isActive(ENCOUNTERS) ) return null;
  const api = game.modules.get(ENCOUNTERS).api;
  return (api && (typeof api.place === "function")) ? api : null;
}

/**
 * The runs written on a card.
 * @param {ChatMessage} message
 * @returns {{k: string, text: string, undo: object, at: number}[]}
 */
export function runsOf(message) {
  const runs = message?.flags?.[MODULE_ID]?.card?.runs;
  return Array.isArray(runs) ? runs : [];
}

/**
 * The action behind a card row, read from its result.
 * @param {{act: {t: string, r: string}}} row
 * @returns {Promise<{action: object, result: TableResult, table: RollTable, linked: string|null}|null>}
 */
async function actionOfRow(row) {
  const table = await fromUuid(row.act.t).catch(() => null);
  const result = table?.results?.get(row.act.r);
  if ( !result ) return null;
  const linked = result.documentUuid ?? null;
  const action = actionOf(path => foundry.utils.getProperty(result.flags ?? {}, path));
  return isComplete(action, linked) ? {action, result, table, linked} : null;
}

/**
 * Roll a count formula, a plain number or a dice formula.
 * @param {string} formula
 * @param {number} fallback
 * @returns {Promise<number>}
 */
async function countOf(formula, fallback) {
  const text = String(formula ?? "").trim();
  if ( !text ) return fallback;
  try {
    const roll = new Roll(text);
    await roll.evaluate({allowInteractive: false});
    return Math.min(Math.max(Math.floor(roll.total) || 0, 0), MAX_TOKENS);
  } catch {
    return fallback;
  }
}

/**
 * An actor of the world for a reference: a UUID (world or compendium), an id or a name. A compendium actor comes into
 * the world first, once, tokens cannot point into a compendium.
 * @param {string} ref
 * @returns {Promise<Actor|null>}
 */
export async function worldActor(ref) {
  let actor = null;
  if ( ref.includes(".") ) actor = await fromUuid(ref).catch(() => null);
  actor ??= game.actors.get(ref) ?? game.actors.getName(ref) ?? null;
  if ( !actor || (actor.documentName !== "Actor") ) return null;
  if ( !actor.pack ) return actor;
  const source = actor.uuid;
  const known = game.actors.find(a => (a._stats?.compendiumSource === source) || (a.flags?.core?.sourceId === source));
  if ( known ) return known;
  return game.actors.importFromCompendium(game.packs.get(actor.pack), actor.id, {}, {keepId: false});
}

/**
 * Place tokens of an actor around a clicked spot (a simple placing, without Saved Encounters).
 * @param {object} action
 * @param {{linked: string|null, quantity: number}} ctx
 * @returns {Promise<{text: string, undo: object}|null>}
 */
async function placeTokens(action, ctx) {
  if ( !canvas?.scene || !canvas.ready ) {
    ui.notifications.warn(t("SDT.Action.noScene"));
    return null;
  }
  const actor = await worldActor(referenceOf(action, ctx.linked));
  if ( !actor ) {
    ui.notifications.warn(t("SDT.Action.noActor"));
    return null;
  }
  const count = await countOf(action.count, ctx.quantity);
  if ( !count ) {
    ui.notifications.info(t("SDT.Action.nothingToPlace", {name: actor.name}));
    return null;
  }
  const spot = await pickPosition();
  if ( !spot ) return null;
  const size = canvas.grid?.size ?? 100;
  let origin = {x: spot.x - (size / 2), y: spot.y - (size / 2)};
  try {
    origin = canvas.grid.getSnappedPoint(origin, {mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX});
  } catch {
    origin = {x: Math.round(origin.x), y: Math.round(origin.y)};
  }
  const docs = [];
  for ( const cell of spreadCells(count) ) {
    const doc = await actor.getTokenDocument({x: origin.x + (cell.dx * size), y: origin.y + (cell.dy * size),
      hidden: action.hidden === true});
    docs.push(doc.toObject());
  }
  const created = await canvas.scene.createEmbeddedDocuments("Token", docs);
  return {text: t("SDT.Action.done.tokens", {count: created.length, name: actor.name}),
    undo: {tokens: created.map(token => token.uuid)}};
}

/**
 * Place a saved encounter with Saved Encounters, which shows its ghost preview. The quantity of the result counts the
 * group several times where that module supports it.
 * @param {object} action
 * @param {{linked: string|null, quantity: number}} ctx
 * @returns {Promise<{text: string, undo: object}|null>}
 */
async function placeEncounter(action, ctx) {
  const api = encountersApi();
  if ( !api ) {
    ui.notifications.warn(t("SDT.Action.noEncounters"));
    return null;
  }
  const ref = referenceOf(action, ctx.linked);
  const entry = await fromUuid(ref).catch(() => null);
  if ( !entry ) {
    ui.notifications.warn(t("SDT.Action.noEncounter"));
    return null;
  }
  const created = await api.place(entry, {combat: action.combat === true, multiply: Math.max(ctx.quantity, 1)});
  if ( !created?.length ) return null;
  return {text: t("SDT.Action.done.encounter", {count: created.length, name: entry.name}),
    undo: {tokens: created.map(token => token.uuid)}};
}

/**
 * Play a sound, a sound of a playlist or a whole playlist.
 * @param {object} action
 * @param {{linked: string|null}} ctx
 * @returns {Promise<{text: string, undo: object}|null>}
 */
async function playSound(action, ctx) {
  const ref = action.ref || ((action.src) ? "" : (ctx.linked ?? ""));
  const volume = action.volume ?? 0.8;
  if ( ref ) {
    const doc = await fromUuid(ref).catch(() => null);
    if ( doc?.documentName === "Playlist" ) {
      await doc.playAll();
      return {text: t("SDT.Action.done.sound", {name: doc.name}), undo: {}};
    }
    if ( doc?.documentName === "PlaylistSound" ) {
      await doc.parent.playSound(doc);
      return {text: t("SDT.Action.done.sound", {name: doc.name}), undo: {}};
    }
    ui.notifications.warn(t("SDT.Action.noSound"));
    return null;
  }
  if ( !action.src ) return null;
  await foundry.audio.AudioHelper.play({src: action.src, volume, autoplay: true, loop: false}, true);
  return {text: t("SDT.Action.done.sound", {name: action.src.split("/").pop()}), undo: {}};
}

/**
 * Show a journal entry or page to the players, or only open it for the GM.
 * @param {object} action
 * @param {{linked: string|null}} ctx
 * @returns {Promise<{text: string, undo: object}|null>}
 */
async function showJournal(action, ctx) {
  const doc = await fromUuid(referenceOf(action, ctx.linked)).catch(() => null);
  const entry = (doc?.documentName === "JournalEntryPage") ? doc.parent : doc;
  if ( entry?.documentName !== "JournalEntry" ) {
    ui.notifications.warn(t("SDT.Action.noJournal"));
    return null;
  }
  const options = (doc === entry) ? {} : {pageId: doc.id};
  if ( action.show === "open" ) {
    await entry.sheet.render({force: true, ...options});
    return {text: t("SDT.Action.done.opened", {name: doc.name}), undo: {}};
  }
  await entry.show("text", true);
  if ( options.pageId ) entry.sheet?.render({force: true, ...options});
  return {text: t("SDT.Action.done.shown", {name: doc.name}), undo: {}};
}

/**
 * The tokens an effect goes to.
 * @param {object} action
 * @returns {Token[]}
 */
function effectTargets(action) {
  const tokens = (action.target === "targeted") ? [...game.user.targets] : [...(canvas?.tokens?.controlled ?? [])];
  return tokens.filter(token => token.actor);
}

/**
 * Apply a status or an effect to the selected or targeted tokens.
 * @param {object} action
 * @returns {Promise<{text: string, undo: object}|null>}
 */
async function applyEffect(action) {
  const tokens = effectTargets(action);
  const actors = [...new Map(tokens.map(token => [token.actor.uuid, token.actor])).values()];
  if ( !actors.length ) {
    ui.notifications.warn(t(action.target === "targeted" ? "SDT.Action.noTargets" : "SDT.Action.noSelection"));
    return null;
  }
  let source = null;
  if ( !action.status && action.ref ) {
    source = await fromUuid(action.ref).catch(() => null);
    if ( source?.documentName !== "ActiveEffect" ) {
      ui.notifications.warn(t("SDT.Action.noEffect"));
      return null;
    }
  }
  const made = [];
  let label = action.status;
  for ( const actor of actors ) {
    if ( source ) {
      const data = source.toObject();
      delete data._id;
      data.origin = source.uuid;
      data.disabled = false;
      const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
      if ( effect ) made.push({actor: actor.uuid, id: effect.id});
      label = source.name;
    }
    else {
      const status = CONFIG.statusEffects?.find(s => s.id === action.status);
      label = status ? game.i18n.localize(status.name ?? status.label ?? action.status) : action.status;
      const result = await actor.toggleStatusEffect(action.status, {active: true});
      if ( result?.id ) made.push({actor: actor.uuid, id: result.id});
    }
  }
  return {text: t("SDT.Action.done.effect", {name: label, count: actors.length}), undo: {effects: made}};
}

/**
 * Run a macro of the world.
 * @param {object} action
 * @param {{linked: string|null, quantity: number, table: RollTable, result: TableResult}} ctx
 * @returns {Promise<{text: string, undo: object}|null>}
 */
async function runMacro(action, ctx) {
  const ref = referenceOf(action, ctx.linked);
  let macro = ref.includes(".") ? await fromUuid(ref).catch(() => null) : null;
  macro ??= game.macros.get(ref) ?? game.macros.getName(ref) ?? null;
  if ( !macro || (typeof macro.execute !== "function") ) {
    ui.notifications.warn(t("SDT.Action.noMacro"));
    return null;
  }
  const first = canvas?.tokens?.controlled?.[0] ?? null;
  await macro.execute({actor: first?.actor ?? undefined, token: first?.document ?? undefined,
    args: [{table: ctx.table.name, tableUuid: ctx.table.uuid, result: ctx.result.name ?? "", quantity: ctx.quantity}]});
  return {text: t("SDT.Action.done.macro", {name: macro.name}), undo: {}};
}

const RUNNERS = {
  encounter: placeEncounter,
  tokens: placeTokens,
  sound: playSound,
  journal: showJournal,
  effect: applyEffect,
  macro: runMacro
};

/**
 * Run the action behind a row of a card (GM) and write the run on the card.
 * @param {ChatMessage} message
 * @param {{key: string, quantity?: number, act: {type: string, t: string, r: string}}} row
 * @returns {Promise<boolean>}   Whether the action ran
 */
export async function runRowAction(message, row) {
  if ( !game.user.isGM || !row?.act ) return false;
  if ( runsOf(message).some(run => run.k === row.key) ) return false;
  const found = await actionOfRow(row);
  if ( !found ) {
    ui.notifications.warn(t("SDT.Action.gone"));
    return false;
  }
  const ctx = {linked: found.linked, quantity: Math.max(Math.floor(row.quantity) || 1, 1), table: found.table,
    result: found.result};
  const done = await RUNNERS[found.action.type](found.action, ctx);
  if ( !done ) return false;
  const runs = [...runsOf(message).filter(run => run.k !== row.key), {k: row.key, text: done.text, undo: done.undo ?? {},
    at: Date.now()}];
  await message.update({[`flags.${MODULE_ID}.card.runs`]: runs});
  countFeature(MODULE_ID, "actionRun");
  trace.add("action", {type: found.action.type, table: found.table.name, result: found.result.id, text: done.text});
  return true;
}

/**
 * Run the actions of a card that are set to run on their own (GM, the world setting must allow it).
 * @param {ChatMessage|null} message
 * @returns {Promise<number>}   How many ran
 */
export async function runAutoActions(message) {
  if ( !message || !game.user.isGM || !setting("autoActions") ) return 0;
  const card = cardOf(message);
  if ( !card ) return 0;
  let ran = 0;
  for ( const row of autoRows(card.lines, Object.fromEntries(runsOf(message).map(run => [run.k, run]))) ) {
    try {
      if ( await runRowAction(message, row) ) ran++;
    } catch(err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(t("SDT.Error.action"));
    }
  }
  return ran;
}

/**
 * Take a run back: remove the placed tokens and the applied effects, and let the button come back.
 * @param {ChatMessage} message
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function undoRowAction(message, key) {
  if ( !game.user.isGM ) return false;
  const run = runsOf(message).find(entry => entry.k === key);
  if ( !run ) return false;
  for ( const uuid of run.undo?.tokens ?? [] ) {
    const token = await fromUuid(uuid).catch(() => null);
    if ( token ) await token.delete();
  }
  for ( const {actor, id} of run.undo?.effects ?? [] ) {
    const doc = await fromUuid(actor).catch(() => null);
    const owner = doc?.actor ?? doc;
    if ( owner?.effects?.get(id) ) await owner.deleteEmbeddedDocuments("ActiveEffect", [id]);
  }
  await message.update({[`flags.${MODULE_ID}.card.runs`]: runsOf(message).filter(entry => entry.k !== key)});
  countFeature(MODULE_ID, "actionUndo");
  trace.add("action undone", {key});
  return true;
}
