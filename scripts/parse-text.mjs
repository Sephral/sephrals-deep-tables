/**
 * Pure parser: a pasted list (from a PDF, a forum, notes) becomes the data of a roll table. It reads numbered ranges
 * ("1-4 Goblin", "5: Ork", "12. Treasure"), lists with a weight ("Goblin | 3") and plain lists (weight 1), and a header
 * line with the name and the formula ("d20 Encounters").
 */

/** The dice of a header or the formula: d20, 1d6, 2d6+1, d% */
const DICE = "(?:\\d*d\\d+|d%)(?:\\s*[+-]\\s*\\d+)?";

/** "d20 Encounters", "1d100: Loot" */
const HEADER_FIRST = new RegExp(`^(${DICE})\\s*[:.\\-–—]?\\s+(\\D.*)$`, "i");

/** "Encounters (d20)", "Loot [1d100]" */
const HEADER_LAST = new RegExp(`^(.+?)\\s*[(\\[]\\s*(${DICE})\\s*[)\\]]\\s*$`, "i");

/** "1-4 Goblin", "01 – 04: Orc", "7 to 9 Troll" */
const RANGE = /^(\d{1,4})\s*(?:[-–—−]|\bto\b|\bbis\b|\.\.)\s*(\d{1,4})\s*(?:[:.)\]|]|[-–—])?\s*(.*)$/i;

/** "5: Orc", "12. Treasure", "3) Rope", "8 - Gem" */
const SINGLE = /^(\d{1,4})\s*[:.)\]|–—-]\s*(\S.*)$/;

/** "5 Orc", only counted in a numbered list */
const LOOSE = /^(\d{1,4})\s+(\S.*)$/;

/** "Goblin | 3", "Goblin; 3", "Goblin<tab>3" */
const WEIGHTED = /^(.+?)\s*(?:\||;|\t)\s*(\d{1,4})\s*$/;

/**
 * @typedef ParsedTable
 * @property {string} name        The name of the header, or ""
 * @property {string} formula
 * @property {"ranges"|"list"} mode
 * @property {{text: string, range: number[], weight: number}[]} rows
 * @property {{kind: string, data?: object}[]} problems
 */

/**
 * The formula of a header written in short form: "d20" is "1d20", "d%" is "1d100".
 * @param {string} text
 * @returns {string}
 */
export function normalizeDice(text) {
  return String(text).replace(/\s+/g, "").replace(/^d/i, "1d").replace(/d%/i, "d100").toLowerCase();
}

/**
 * The highest number a plain dice formula can roll, or null.
 * @param {string} formula
 * @returns {number|null}
 */
function maxOf(formula) {
  const match = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(String(formula).replace(/\s+/g, ""));
  if ( !match ) return null;
  return (Number(match[1] || 1) * Number(match[2])) + Number(match[3] || 0);
}

/**
 * Read a pasted list.
 * @param {string} input
 * @returns {ParsedTable}
 */
export function parseTableText(input) {
  const lines = String(input ?? "").split(/\r?\n/).map(line => line.replace(/ /g, " ").trim()).filter(Boolean);
  const problems = [];
  let name = "";
  let formula = "";
  if ( lines.length ) {
    const first = lines[0];
    const a = HEADER_FIRST.exec(first);
    const b = !a && !RANGE.test(first) && !SINGLE.test(first) ? HEADER_LAST.exec(first) : null;
    if ( a ) {
      formula = normalizeDice(a[1]);
      name = a[2].trim();
      lines.shift();
    }
    else if ( b ) {
      formula = normalizeDice(b[2]);
      name = b[1].trim();
      lines.shift();
    }
  }
  const strict = lines.filter(line => RANGE.test(line) || SINGLE.test(line)).length;
  const numbered = strict > 0 && ((strict / lines.length) >= 0.5);
  const rows = numbered ? parseNumbered(lines, problems) : parseList(lines);
  if ( !rows.length ) return {name, formula, mode: numbered ? "ranges" : "list", rows, problems: [{kind: "empty"}]};

  if ( numbered ) {
    const faces = maxOf(formula);
    // Tables of 100 entries often end with "00"
    for ( const row of rows ) {
      if ( (row.range[0] === 0) && (row.range[1] === 0) && ((faces === 100) || rows.some(r => r.range[1] >= 90)) ) {
        row.range = [100, 100];
      }
      else if ( (row.range[1] === 0) && (row.range[0] > 0) && (faces === 100) ) row.range[1] = 100;
    }
    rows.sort((x, y) => x.range[0] - y.range[0]);
    const top = Math.max(...rows.map(r => r.range[1]));
    if ( !formula ) formula = `1d${top}`;
    else if ( faces && (top > faces) ) problems.push({kind: "beyond", data: {top, formula}});
    checkRanges(rows, problems, faces ?? top);
    for ( const row of rows ) row.weight = (row.range[1] - row.range[0]) + 1;
  }
  else {
    let next = 1;
    for ( const row of rows ) {
      row.range = [next, next + row.weight - 1];
      next += row.weight;
    }
    if ( !formula || (maxOf(formula) !== (next - 1)) ) {
      if ( formula ) problems.push({kind: "formula", data: {formula, total: next - 1}});
      formula = `1d${next - 1}`;
    }
  }
  return {name, formula, mode: numbered ? "ranges" : "list", rows, problems};
}

/**
 * Rows of a numbered list. A line without a number continues the row before (text broken by a PDF).
 * @param {string[]} lines
 * @param {object[]} problems
 * @returns {{text: string, range: number[], weight: number}[]}
 */
function parseNumbered(lines, problems) {
  const rows = [];
  for ( const line of lines ) {
    let range;
    let text;
    let match = RANGE.exec(line);
    if ( match && match[3] ) {
      range = [Number(match[1]), Number(match[2])];
      text = match[3];
    }
    else if ( (match = SINGLE.exec(line)) ) {
      range = [Number(match[1]), Number(match[1])];
      text = match[2];
    }
    else if ( (match = LOOSE.exec(line)) ) {
      range = [Number(match[1]), Number(match[1])];
      text = match[2];
    }
    if ( range ) {
      if ( range[1] < range[0] ) {
        problems.push({kind: "backwards", data: {from: range[0], to: range[1]}});
        range = [range[1], range[0]];
      }
      rows.push({text: text.trim(), range, weight: 1});
    }
    else if ( rows.length ) rows.at(-1).text += ` ${line}`;
    else problems.push({kind: "ignored", data: {line}});
  }
  return rows;
}

/**
 * Rows of a plain or weighted list.
 * @param {string[]} lines
 * @returns {{text: string, range: number[], weight: number}[]}
 */
function parseList(lines) {
  return lines.map(raw => {
    const line = raw.replace(/^[-*•·–]\s+/, "");
    const match = WEIGHTED.exec(line);
    if ( match && (Number(match[2]) > 0) ) return {text: match[1].trim(), range: [0, 0], weight: Number(match[2])};
    return {text: line, range: [0, 0], weight: 1};
  });
}

/**
 * Find gaps and overlaps in the ranges of a numbered list.
 * @param {{range: number[]}[]} rows   Sorted
 * @param {object[]} problems
 * @param {number} top               The highest number of the formula
 */
function checkRanges(rows, problems, top) {
  let expected = 1;
  const gaps = [];
  const overlaps = [];
  for ( const row of rows ) {
    const [from, to] = row.range;
    if ( from > expected ) gaps.push(from - 1 > expected ? `${expected}-${from - 1}` : String(expected));
    else if ( from < expected ) overlaps.push(from === to ? String(from) : `${from}-${to}`);
    expected = Math.max(expected, to + 1);
  }
  if ( (expected - 1) < top ) gaps.push((top > expected) ? `${expected}-${top}` : String(expected));
  if ( gaps.length ) problems.push({kind: "gaps", data: {list: gaps.slice(0, 6).join(", ")}});
  if ( overlaps.length ) problems.push({kind: "overlaps", data: {list: overlaps.slice(0, 6).join(", ")}});
}
