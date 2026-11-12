/**
 * Pure logic of results that act: a result can carry one action (place a saved encounter or tokens, play a sound,
 * show a journal, apply an effect, run a macro). The action is stored in the flags of the result, a card line only
 * knows its type, so players do not read what a result does.
 */

import {SDT} from "./flags.mjs";

/** The kinds of action. */
export const ACTION_TYPES = ["encounter", "tokens", "sound", "journal", "effect", "macro"];

/** Icon and button text key of every kind. */
export const ACTION_META = {
  encounter: {icon: "fa-people-group", button: "SDT.Action.button.encounter"},
  tokens: {icon: "fa-user-group", button: "SDT.Action.button.tokens"},
  sound: {icon: "fa-volume-high", button: "SDT.Action.button.sound"},
  journal: {icon: "fa-book-open", button: "SDT.Action.button.journal"},
  effect: {icon: "fa-wand-sparkles", button: "SDT.Action.button.effect"},
  macro: {icon: "fa-terminal", button: "SDT.Action.button.macro"}
};

/** The most tokens one action places. */
export const MAX_TOKENS = 50;

/**
 * @param {unknown} value
 * @returns {string}
 */
function str(value) {
  return (value === null || value === undefined || typeof value === "object") ? "" : String(value).trim();
}

/**
 * A stored action made clean: only the fields of its type, empty values dropped. Null when there is no known type.
 * @param {unknown} raw
 * @returns {{type: string, auto: boolean, [key: string]: unknown}|null}
 */
export function normalizeAction(raw) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const type = str(raw.type);
  if ( !ACTION_TYPES.includes(type) ) return null;
  const action = {type, auto: raw.auto === true};
  if ( type === "encounter" ) {
    action.ref = str(raw.ref);
    action.combat = raw.combat === true;
  }
  else if ( type === "tokens" ) {
    action.ref = str(raw.ref);
    action.count = str(raw.count);
    action.hidden = raw.hidden === true;
  }
  else if ( type === "sound" ) {
    action.ref = str(raw.ref);
    action.src = str(raw.src);
    const volume = Number(raw.volume);
    action.volume = (raw.volume !== "") && (raw.volume !== null) && Number.isFinite(volume)
      ? Math.min(Math.max(volume, 0), 1) : 0.8;
  }
  else if ( type === "journal" ) {
    action.ref = str(raw.ref);
    action.show = (str(raw.show) === "open") ? "open" : "show";
  }
  else if ( type === "effect" ) {
    action.status = str(raw.status);
    action.ref = str(raw.ref);
    action.target = (str(raw.target) === "targeted") ? "targeted" : "selected";
  }
  else if ( type === "macro" ) {
    action.ref = str(raw.ref);
  }
  return action;
}

/**
 * The action of a result.
 * @param {(path: string) => unknown} get   Reads a path of the result's flags
 * @returns {object|null}
 */
export function actionOf(get) {
  return normalizeAction(get(`${SDT}.action`));
}

/**
 * Does an action know what to do? A result that links a document can stand in for the reference.
 * @param {object|null} action
 * @param {string|null} [linked]   The document the result links to
 * @returns {boolean}
 */
export function isComplete(action, linked = null) {
  if ( !action ) return false;
  if ( action.type === "sound" ) return !!(action.ref || action.src || linked);
  if ( action.type === "effect" ) return !!(action.status || action.ref);
  return !!(action.ref || linked);
}

/**
 * The reference an action works with: its own, else the document the result links to.
 * @param {object} action
 * @param {string|null} linked
 * @returns {string}
 */
export function referenceOf(action, linked) {
  return action.ref || linked || "";
}

/**
 * The action stored on a card line, without the settings: type, whether it runs on its own, and where it came from.
 * @param {{type: string, auto?: boolean}|null|undefined} action
 * @param {string} tableUuid
 * @param {string} resultId
 * @returns {{type: string, auto: boolean, t: string, r: string}|null}
 */
export function lineAction(action, tableUuid, resultId) {
  if ( !action || !ACTION_TYPES.includes(action.type) ) return null;
  return {type: action.type, auto: !!action.auto, t: tableUuid, r: resultId};
}

/**
 * The card rows whose action runs on its own and has not run yet.
 * @param {{key: string, act?: {auto: boolean}|null}[]} rows
 * @param {Record<string, unknown>} [runs]
 * @returns {object[]}
 */
export function autoRows(rows, runs = {}) {
  return rows.filter(row => row.act?.auto && !runs[row.key]);
}

/**
 * Cells for a group of tokens around a point: rows of equal length, centered on the point.
 * @param {number} count
 * @returns {{dx: number, dy: number}[]}   In cells, relative to the clicked cell
 */
export function spreadCells(count) {
  const n = Math.min(Math.max(Math.floor(Number(count)) || 0, 0), MAX_TOKENS);
  if ( !n ) return [];
  const columns = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / columns);
  const cells = [];
  for ( let i = 0; i < n; i++ ) {
    const row = Math.floor(i / columns);
    const inRow = Math.min(columns, n - (row * columns));
    cells.push({dx: (i % columns) - Math.floor((inRow - 1) / 2), dy: row - Math.floor((rows - 1) / 2)});
  }
  return cells;
}

/**
 * A short text of what an action does, for tooltips.
 * @param {object|null} action
 * @param {(key: string) => string} label   Localizes a key
 * @returns {string}
 */
export function describe(action, label) {
  if ( !action ) return "";
  const parts = [label(`SDT.Action.type.${action.type}`)];
  if ( action.auto ) parts.push(label("SDT.Action.autoShort"));
  return parts.join(" · ");
}
