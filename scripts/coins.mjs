/**
 * Coins by game system. Coin texts like "3d6 gp" are recognized in every system (the usual abbreviations), but only
 * D&D 5e and Crucible have a purse the module can fill. Elsewhere the row stays a text with a hint.
 */

/** The usual coins, for systems without their own. */
const GENERIC = [{key: "pp", abbr: "pp"}, {key: "gp", abbr: "gp"}, {key: "ep", abbr: "ep"}, {key: "sp", abbr: "sp"},
  {key: "cp", abbr: "cp"}];

/**
 * Which purse does the running system have?
 * @returns {"dnd5e"|"crucible"|null}
 */
export function purseKind() {
  if ( (game.system.id === "dnd5e") && CONFIG.DND5E?.currencies ) return "dnd5e";
  if ( (game.system.id === "crucible") && globalThis.crucible?.CONFIG?.currency ) return "crucible";
  return null;
}

/**
 * The coins of the system.
 * @returns {{key: string, abbr: string, multiplier?: number}[]}
 */
export function denominations() {
  const kind = purseKind();
  if ( kind === "dnd5e" ) {
    return Object.entries(CONFIG.DND5E.currencies).map(([key, c]) => ({key, abbr: game.i18n.localize(c.abbreviation ?? key)}));
  }
  if ( kind === "crucible" ) {
    return Object.entries(globalThis.crucible.CONFIG.currency).map(([key, c]) => ({key,
      abbr: game.i18n.localize(c.abbreviation ?? key), multiplier: Number(c.multiplier) || 1}));
  }
  return GENERIC;
}

/**
 * The short name of a coin.
 * @param {string} key
 * @returns {string}
 */
export function coinLabel(key) {
  return denominations().find(d => d.key === key)?.abbr ?? key;
}

/**
 * The update that adds coins to an actor, and what could not be added.
 * @param {Actor} actor
 * @param {Record<string, number>} coins
 * @returns {{update: object|null, given: Record<string, number>, skipped: Record<string, number>}}
 */
export function coinUpdate(actor, coins) {
  const kind = purseKind();
  const given = {};
  const skipped = {};
  if ( kind === "dnd5e" ) {
    const purse = foundry.utils.deepClone(actor.system?.currency ?? {});
    if ( !actor.system || !("currency" in actor.system) ) return {update: null, given, skipped: {...coins}};
    for ( const [key, n] of Object.entries(coins) ) {
      if ( !(n > 0) ) continue;
      if ( key in purse ) {
        purse[key] = (Number(purse[key]) || 0) + n;
        given[key] = n;
      }
      else skipped[key] = n;
    }
    return {update: Object.keys(given).length ? {"system.currency": purse} : null, given, skipped};
  }
  if ( kind === "crucible" ) {
    if ( !actor.system || !("currency" in actor.system) ) return {update: null, given, skipped: {...coins}};
    const table = Object.fromEntries(denominations().map(d => [d.key, d.multiplier]));
    let base = 0;
    for ( const [key, n] of Object.entries(coins) ) {
      if ( !(n > 0) ) continue;
      if ( table[key] ) {
        base += n * table[key];
        given[key] = n;
      }
      else skipped[key] = n;
    }
    return {update: base ? {"system.currency": (Number(actor.system.currency) || 0) + base} : null, given, skipped};
  }
  return {update: null, given, skipped: {...coins}};
}

/**
 * Item Piles takes coins as a text like "12gp 3sp".
 * @param {Record<string, number>} coins
 * @returns {string}
 */
export function coinString(coins) {
  return Object.entries(coins).filter(([, n]) => n > 0).map(([key, n]) => `${n}${key}`).join(" ");
}
