/**
 * The flows around a roll: draw now, post the roll of the deep roll window, the empty table.
 */

import {MODULE_ID, t} from "./config.mjs";
import {postCard} from "./card.mjs";
import {markDrawn, resetTable, resolveTable, rollTable, settingsOf} from "./engine.mjs";
import {runAutoActions} from "./act.mjs";
import {countFeature} from "./usage.mjs";

/**
 * May this user roll on the table? Players roll tables they can see.
 * @param {RollTable} table
 * @returns {boolean}
 */
export function canRoll(table) {
  if ( !table ) return false;
  if ( game.user.isGM || table.pack ) return true;
  return table.testUserPermission(game.user, "OBSERVER");
}

/**
 * Show the result of a roll as a card, after marking what was drawn.
 * @param {RollTable} table
 * @param {object} roll                       What rollTable gave, with the lines as the user edited them
 * @param {object} [options]
 * @param {string} [options.mode]
 * @param {string} [options.userId]           The user the roll is made for
 * @param {string[]} [options.whisper]        Exact recipients
 * @param {object} [options.flags]            More flags for the card
 * @param {string} [options.note]             A line under the title of the card
 * @returns {Promise<ChatMessage|null>}
 */
export async function postRoll(table, roll, {mode, userId, whisper, flags, note} = {}) {
  const shown = roll.lines.filter(line => line.include);
  if ( !shown.length ) return null;
  await markDrawn(shown);
  const message = await postCard({table, lines: roll.lines, rolls: roll.rolls, problems: roll.state.problems,
    mode: mode ?? settingsOf(table).mode, draws: roll.draws, userId, whisper, flags, note});
  // Actions set to run on their own run when the GM shows the card
  await runAutoActions(message);
  return message;
}

/**
 * Tell the user a table has no more results, and let the GM bring them back.
 * @param {RollTable} table
 * @returns {Promise<void>}
 */
export async function emptyTable(table) {
  const name = table.name;
  if ( !game.user.isGM || table.pack ) {
    ui.notifications.info(t("SDT.Draw.empty", {name}));
    return;
  }
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: {title: t("SDT.Draw.emptyTitle"), icon: "fa-solid fa-rotate-left"},
    content: `<p>${foundry.utils.escapeHTML(t("SDT.Draw.emptyAsk", {name}))}</p>`,
    rejectClose: false
  });
  if ( !yes ) return;
  await resetTable(table);
  countFeature(MODULE_ID, "tableReset");
  ui.notifications.info(t("SDT.Draw.reset", {name}));
}

/**
 * Draw now: roll with the table's settings and show the card at once.
 * @param {RollTable|string} ref
 * @param {object} [options]
 * @param {string} [options.draws]
 * @param {boolean} [options.distinct]
 * @param {string} [options.mode]
 * @param {string} [options.userId]      Roll for this user (a GM rolls a table a player may roll)
 * @param {string[]} [options.whisper]   Exact recipients
 * @param {object} [options.flags]       More flags for the card
 * @param {string} [options.note]        A line under the title of the card
 * @param {boolean} [options.force]      Skip the permission check (the GM rolls for a player)
 * @returns {Promise<{message: ChatMessage|null, lines: object[], problems: object[]}|null>}
 */
export async function drawNow(ref, options = {}) {
  const table = await resolveTable(ref);
  if ( !table || !(options.force && game.user.isGM) && !canRoll(table) ) return null;
  const roll = await rollTable(table, options);
  countFeature(MODULE_ID, "drawNow");
  const shown = roll.lines.filter(line => line.include);
  if ( !shown.length ) {
    // Rolled for a player: the player is told, the GM is not asked
    const forOther = !!options.userId && (options.userId !== game.user.id);
    if ( forOther ) return {message: null, lines: roll.lines, problems: roll.state.problems};
    if ( roll.state.problems.some(p => p.kind === "empty") ) await emptyTable(table);
    else if ( roll.state.problems.some(p => p.kind === "conditions") ) ui.notifications.info(t("SDT.Draw.conditions", {name: table.name}));
    else ui.notifications.info(t("SDT.Draw.nothing", {name: table.name}));
    return {message: null, lines: roll.lines, problems: roll.state.problems};
  }
  const message = await postRoll(table, roll, {mode: options.mode, userId: options.userId, whisper: options.whisper,
    flags: options.flags, note: options.note});
  return {message, lines: roll.lines, problems: roll.state.problems};
}
