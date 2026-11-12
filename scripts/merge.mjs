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
 * @property {number} quantity
 * @property {Record<string, number>} coins
 * @property {string} [html]
 * @property {string} [text]
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
    else key = `${line.kind}:${line.uuid}:${line.name}`;
    let row = merged.get(key);
    if ( !row ) {
      row = {key, kind: line.kind, name: line.name, img: line.img ?? "", uuid: line.uuid, quantity: 0, coins: {},
        html: line.html, text: line.text};
      merged.set(key, row);
    }
    if ( line.kind === "coins" ) {
      for ( const [coin, n] of Object.entries(line.coins ?? {}) ) row.coins[coin] = (row.coins[coin] ?? 0) + n;
    }
    else row.quantity += (line.kind === "text") ? 1 : Math.max(line.quantity || 1, 1);
  }
  return [...merged.values()].filter(row => (row.kind !== "coins") || Object.values(row.coins).some(n => n > 0));
}
