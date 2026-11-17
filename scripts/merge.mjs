/**
 * Pure helpers for the result card: equal results are merged into one row.
 */

/**
 * @typedef CardLine
 * @property {string} key
 * @property {"item"|"coins"|"text"|"link"} kind
 * @property {string} name
 * @property {string} img
 * @property {string} [uuid]
 * @property {string} [enchantment]
 * @property {number} quantity
 * @property {Record<string, number>} coins
 * @property {string} [html]
 * @property {string} [text]
 * @property {{type: string, auto: boolean, t: string, r: string}|null} [act]   The action of the result
 */

/**
 * Merge the included lines of a roll: the same item adds up its quantity, the same text counts how often it came up,
 * all coins become one row. The order of the first appearance stays.
 * @param {import("./draw.mjs").Line[]} lines
 * @returns {CardLine[]}
 */
export function mergeLines(lines) {
  const merged = new Map();
  for ( const line of lines ) {
    if ( !line.include ) continue;
    if ( (line.kind === "item") && !(line.quantity > 0) ) continue;
    let key;
    if ( line.kind === "coins" ) key = "coins";
    else if ( line.kind === "text" ) key = `text:${line.text}`;
    else key = `${line.kind}:${line.uuid}:${line.enchantment ?? ""}:${line.name}`;
    // Results with an action stay apart from equal ones without, and from other results' actions
    if ( line.act && (line.kind !== "coins") ) key += `|act:${line.act.t}:${line.act.r}`;
    let row = merged.get(key);
    if ( !row ) {
      row = {key, kind: line.kind, name: line.name, img: line.img ?? "", uuid: line.uuid, enchantment: line.enchantment, quantity: 0, coins: {},
        html: line.html, text: line.text, act: (line.kind === "coins") ? null : (line.act ?? null)};
      merged.set(key, row);
    }
    if ( line.kind === "coins" ) {
      for ( const [coin, n] of Object.entries(line.coins ?? {}) ) row.coins[coin] = (row.coins[coin] ?? 0) + n;
    }
    else row.quantity += (line.kind === "text") ? 1 : Math.max(line.quantity || 1, 1);
  }
  return [...merged.values()].filter(row => (row.kind !== "coins") || Object.values(row.coins).some(n => n > 0));
}
