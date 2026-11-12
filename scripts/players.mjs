/**
 * Pure logic of tables players may roll: the GM marks tables, a world setting keeps the list for the players (who
 * often cannot see the tables themselves), a roll goes to the active GM as a request.
 */

import {SDT} from "./flags.mjs";
import {MODES} from "./modes.mjs";

/** The most tables the list holds. */
export const MAX_LISTED = 100;

/**
 * May players roll a table?
 * @param {(path: string) => unknown} get   Reads a path of the table's flags
 * @returns {boolean}
 */
export function playersMayRoll(get) {
  return get(`${SDT}.players`) === true;
}

/**
 * The list for the players, from plain table data.
 * @param {{uuid: string, name: string, img?: string, mode?: string, players: boolean, pack?: boolean}[]} tables
 * @returns {{uuid: string, name: string, img: string, mode: string}[]}
 */
export function listEntries(tables) {
  return tables.filter(table => table.players && !table.pack && table.uuid)
    .map(table => ({uuid: table.uuid, name: String(table.name ?? ""), img: table.img ?? "",
      mode: MODES.includes(table.mode) ? table.mode : "foundry"}))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_LISTED);
}

/**
 * Are two lists the same? (the GM writes the setting only when something changed)
 * @param {object[]} a
 * @param {object[]} b
 * @returns {boolean}
 */
export function sameEntries(a, b) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/**
 * The visibility of a card rolled for a player: what the GM chose for the table. "Like in Foundry" would follow the
 * GM's chat setting here, so players' rolls are public then.
 * @param {string} mode
 * @returns {"public"|"gm"|"blind"|"self"}
 */
export function playerMode(mode) {
  return (MODES.includes(mode) && (mode !== "foundry")) ? mode : "public";
}

/**
 * Check a request of a player against the table's current settings.
 * @param {{uuid?: unknown}} request
 * @param {{players: boolean, pack?: boolean, mode?: string}|null} table   The table as the GM sees it
 * @returns {{ok: boolean, mode?: string, reason?: string}}
 */
export function checkRequest(request, table) {
  if ( !request || (typeof request.uuid !== "string") ) return {ok: false, reason: "invalid"};
  if ( !table ) return {ok: false, reason: "missing"};
  if ( !table.players || table.pack ) return {ok: false, reason: "denied"};
  return {ok: true, mode: playerMode(table.mode ?? "foundry")};
}
