/**
 * Pure readers for the settings stored in the flags of tables and results: the module's own and, as a fallback, the
 * ones an older table module and the Loot Ledger write. They are read without the other modules being active.
 */

import {MODES} from "./modes.mjs";

/** The flag scope of this module. */
export const SDT = "sephrals-deep-tables";

/** The Loot Ledger keeps the quantity formula of a result in its flags. */
export const SLL = "sephrals-loot-ledger";

/** The older table module: the flag scope and the names of the flags the module reads. */
export const OLDER = {
  scope: "better-rolltables",
  draws: "loot-amount-key",
  distinct: "brt-distinct-result",
  quantity: "brt-result-custom-quantity",
  quantityOld: "brt-result-formula.formula"
};

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  if ( value === null || value === undefined ) return "";
  return (typeof value === "object") ? "" : String(value).trim();
}

/**
 * The settings of a table.
 * @param {(path: string) => unknown} get   Reads a path of the table's flags, for example "sephrals-deep-tables.draws"
 * @returns {{draws: string, distinct: boolean, mode: string}}
 */
export function tableSettings(get) {
  const draws = text(get(`${SDT}.draws`)) || text(get(`${OLDER.scope}.${OLDER.draws}`));
  const own = get(`${SDT}.distinct`);
  const distinct = (typeof own === "boolean") ? own : (get(`${OLDER.scope}.${OLDER.distinct}`) === true);
  const mode = text(get(`${SDT}.mode`));
  return {draws: draws || "1", distinct, mode: MODES.includes(mode) ? mode : "foundry"};
}

/**
 * The quantity formula of a result: its own, then the Loot Ledger's, then the older table module's.
 * The older table module does not give text results a quantity, so those are not read there.
 * @param {(path: string) => unknown} get   Reads a path of the result's flags
 * @param {string} type                     The result type, "text" or "document"
 * @returns {string}
 */
export function resultQuantity(get, type) {
  const own = text(get(`${SDT}.quantity`)) || text(get(`${SLL}.quantity`));
  if ( own ) return own;
  if ( type === "text" ) return "";
  return text(get(`${OLDER.scope}.${OLDER.quantity}`)) || text(get(`${OLDER.scope}.${OLDER.quantityOld}`));
}
