/**
 * The flows around a roll: draw now, post the roll of the deep roll window, the empty table.
 */

import {MODULE_ID, t} from "./config.mjs";
import {postCard} from "./card.mjs";
import {markDrawn, resolveTable, rollTable, settingsOf} from "./engine.mjs";
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
 * @returns {Promise<ChatMessage|null>}
 */
export async function postRoll(table, roll, {mode} = {}) {
  const shown = roll.lines.filter(line => line.include);
  if ( !shown.length ) return null;
  await markDrawn(shown);
  return postCard({table, lines: roll.lines, rolls: roll.rolls, problems: roll.state.problems,
    mode: mode ?? settingsOf(table).mode, draws: roll.draws});
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
  await table.resetResults();
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
 * @returns {Promise<{message: ChatMessage|null, lines: object[], problems: object[]}|null>}
 */
export async function drawNow(ref, options = {}) {
  const table = await resolveTable(ref);
  if ( !table || !canRoll(table) ) return null;
  const roll = await rollTable(table, options);
  countFeature(MODULE_ID, "drawNow");
  const shown = roll.lines.filter(line => line.include);
  if ( !shown.length ) {
    if ( roll.state.problems.some(p => p.kind === "empty") ) await emptyTable(table);
    else ui.notifications.info(t("SDT.Draw.nothing", {name: table.name}));
    return {message: null, lines: roll.lines, problems: roll.state.problems};
  }
  const message = await postRoll(table, roll, {mode: options.mode});
  return {message, lines: roll.lines, problems: roll.state.problems};
}
