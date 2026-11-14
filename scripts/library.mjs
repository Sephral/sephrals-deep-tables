/**
 * Pure logic of the table library: the ready tables the module ships as readable JSON files (one per group and
 * language), how a table is read, which tables an import needs, and the data of the roll tables an import creates.
 * Nothing here touches Foundry, so the tests run in Node and can check the content files themselves.
 */

import {SDT} from "./flags.mjs";
import {normalizeConditions} from "./conditions.mjs";

/** The version stored on imported tables, so a later module version can tell which content they came from. */
export const LIB_VERSION = 1;

/** The languages the library ships. */
export const LIB_LANGUAGES = ["en", "de"];

/** The groups of the library, in the order of the window, with their icon. The content is in lang/library/<lang>/<id>.json. */
export const GROUPS = [
  {id: "names", icon: "fa-signature"},
  {id: "places", icon: "fa-beer-mug-empty"},
  {id: "people", icon: "fa-user-group"},
  {id: "rumors", icon: "fa-comments"},
  {id: "travel", icon: "fa-route"},
  {id: "weather", icon: "fa-cloud-sun-rain"},
  {id: "encounters", icon: "fa-skull"},
  {id: "loot", icon: "fa-gem"}
];

/** The icon of a result that leads to another table. */
export const TABLE_ICON = "icons/svg/d20-grey.svg";

/** A reference to another table of the library inside a text. */
const REF = /\{\{([a-z0-9-]+)\}\}/g;

/**
 * @typedef LibraryRow
 * @property {string} text         The result name (may hold {{key}} references and [[1d6]] rolls)
 * @property {string} note         The description of the result
 * @property {number} weight
 * @property {string} quantity     Quantity formula, "" for one
 * @property {string} table        The key of a table of the library this row leads to, "" for a text row
 * @property {object|null} conditions
 * @property {number[]} range
 */

/**
 * The rows of a library table with ranges assigned by weight.
 * @param {{rows: (string|object)[]}} table
 * @returns {LibraryRow[]}
 */
export function rowsOf(table) {
  let next = 1;
  return (table?.rows ?? []).map(raw => {
    const row = (typeof raw === "string") ? {text: raw} : (raw ?? {});
    const weight = Math.max(Math.floor(Number(row.weight)) || 1, 1);
    const range = [next, next + weight - 1];
    next += weight;
    return {
      text: String(row.text ?? "").trim(),
      note: String(row.note ?? "").trim(),
      weight,
      quantity: String(row.quantity ?? "").trim(),
      table: String(row.table ?? "").trim(),
      conditions: normalizeConditions(row.conditions),
      range
    };
  });
}

/**
 * The formula of a library table: one die with a side for every point of weight.
 * @param {{rows: (string|object)[]}} table
 * @returns {string}
 */
export function formulaOf(table) {
  const rows = rowsOf(table);
  return `1d${Math.max(rows.at(-1)?.range[1] ?? 1, 1)}`;
}

/**
 * The keys of the tables a table refers to, in its rows and in its texts.
 * @param {{rows: (string|object)[]}} table
 * @returns {string[]}
 */
export function dependencies(table) {
  const keys = new Set();
  for ( const row of rowsOf(table) ) {
    if ( row.table ) keys.add(row.table);
    for ( const source of [row.text, row.note] ) for ( const match of source.matchAll(REF) ) keys.add(match[1]);
  }
  return [...keys];
}

/**
 * Does a table make sense on its own, or is it a building block of other tables?
 * @param {{part?: boolean}} table
 * @returns {boolean}
 */
export function isPart(table) {
  return table?.part === true;
}

/* -------------------------------------------- */
/*  Import plan                                 */
/* -------------------------------------------- */

/**
 * What an import has to do.
 * @param {object} options
 * @param {Map<string, object>} options.tables       Every table of the library in the language, by key
 * @param {Iterable<string>} options.selected        The keys the user ticked
 * @param {Map<string, string>} [options.existing]   Keys already in the world, with the UUID of the table
 * @returns {{create: string[], added: string[], skipped: string[], reuse: Map<string, string>, missing: string[]}}
 *   create: the keys to make, building blocks first. added: the ones of them nobody ticked. skipped: ticked keys that
 *   are in the world already. reuse: tables in the world a new table links to. missing: keys the library does not know.
 */
export function planImport({tables, selected, existing = new Map()}) {
  const create = [];
  const picked = new Set(selected);
  const seen = new Set();
  const reuse = new Map();
  const missing = [];
  const skipped = [];
  const visit = key => {
    if ( !tables.has(key) ) {
      if ( !missing.includes(key) ) missing.push(key);
      return;
    }
    if ( existing.has(key) ) {
      if ( !picked.has(key) ) reuse.set(key, existing.get(key));
      else if ( !skipped.includes(key) ) skipped.push(key);
      return;
    }
    if ( seen.has(key) ) return;
    seen.add(key);
    for ( const dependency of dependencies(tables.get(key)) ) {
      if ( existing.has(dependency) && !picked.has(dependency) ) reuse.set(dependency, existing.get(dependency));
      else visit(dependency);
    }
    create.push(key);
  };
  for ( const key of picked ) visit(key);
  return {create, added: create.filter(key => !picked.has(key)), skipped, reuse, missing};
}

/* -------------------------------------------- */
/*  Table data                                  */
/* -------------------------------------------- */

/**
 * Replace the {{key}} references of a text with draws from the world tables.
 * @param {string} text
 * @param {Map<string, {id: string, name: string}>} known   The tables of the library as they are in the world
 * @returns {string}
 */
export function linkText(text, known) {
  return String(text ?? "").replace(REF, (match, key) => {
    const table = known.get(key);
    if ( !table ) return match;
    return `@Table[RollTable.${table.id}]{${String(table.name).replace(/[\[\]{}]/g, "")}}`;
  });
}

/**
 * The flags of a result: its quantity and its conditions.
 * @param {LibraryRow} row
 * @returns {object}
 */
function resultFlags(row) {
  const own = {};
  if ( row.quantity ) own.quantity = row.quantity;
  if ( row.conditions ) own.conditions = row.conditions;
  return Object.keys(own).length ? {[SDT]: own} : {};
}

/**
 * The creation data of one roll table of the library.
 * @param {object} table                                    The table as written in the file
 * @param {object} options
 * @param {string} options.id                               The id the new table gets
 * @param {Map<string, {id: string, name: string}>} options.known   Library tables in the world and being made, by key
 * @param {string} options.lang
 * @param {string|null} [options.folder]                    The folder id
 * @returns {object}
 */
export function tableData(table, {id, known, lang, folder = null}) {
  const rows = rowsOf(table);
  const flags = {library: {key: table.key, lang, v: LIB_VERSION}};
  for ( const field of ["draws", "distinct", "memory", "onEmpty"] ) if ( table[field] !== undefined ) flags[field] = table[field];
  return {
    _id: id,
    name: table.name,
    description: table.description ? `<p>${String(table.description).replace(/[&<>]/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"})[ch])}</p>` : "",
    formula: formulaOf(table),
    replacement: true,
    displayRoll: true,
    folder,
    flags: {[SDT]: flags},
    results: rows.map(row => {
      const base = {range: row.range, weight: row.weight, drawn: false, flags: resultFlags(row)};
      const target = row.table ? known.get(row.table) : null;
      if ( target ) return {...base, type: "document", documentUuid: `RollTable.${target.id}`, name: target.name, img: TABLE_ICON};
      return {...base, type: "text", name: linkText(row.text, known), description: linkText(row.note, known)};
    })
  };
}

/**
 * The story tags the tables to make ask for, with the names of the library.
 * @param {object[]} tables                          The tables as written in the files
 * @param {{id: string, name: string}[]} definitions Tags the groups define
 * @returns {{id: string, name: string}[]}
 */
export function neededTags(tables, definitions) {
  const ids = new Set();
  for ( const table of tables ) for ( const row of rowsOf(table) ) for ( const id of Object.keys(row.conditions?.tags ?? {}) ) ids.add(id);
  return [...ids].map(id => ({id, name: definitions.find(tag => tag.id === id)?.name ?? id}));
}

/**
 * A text for the preview: references show as the name of the table in brackets.
 * @param {string} text
 * @param {Map<string, object>} tables
 * @returns {string}
 */
export function previewText(text, tables) {
  return String(text ?? "").replace(REF, (match, key) => (tables.has(key) ? `[${tables.get(key).name}]` : match));
}

/* -------------------------------------------- */
/*  Checking the content                        */
/* -------------------------------------------- */

/** Punctuation the public texts avoid: semicolons and dashes. */
const FORBIDDEN = /;|[–—]|\s-\s/;

/**
 * Check the content of one language: the problems found, as readable lines.
 * @param {{group: string, title?: string, tags?: object[], tables: object[]}[]} groups
 * @returns {string[]}
 */
export function validateLibrary(groups) {
  const problems = [];
  const tables = new Map();
  for ( const group of groups ) {
    if ( !group.title ) problems.push(`${group.group}: no title`);
    for ( const table of group.tables ?? [] ) {
      if ( !/^[a-z0-9-]+$/.test(table.key ?? "") ) problems.push(`${table.key}: bad key`);
      if ( tables.has(table.key) ) problems.push(`${table.key}: key used twice`);
      tables.set(table.key, {...table, group: group.group});
    }
  }
  const tagIds = new Set(groups.flatMap(group => (group.tags ?? []).map(tag => tag.id)));
  for ( const [key, table] of tables ) {
    if ( !table.name ) problems.push(`${key}: no name`);
    if ( !(table.rows?.length) ) problems.push(`${key}: no rows`);
    const strings = [table.name, table.description, ...(table.rows ?? []).flatMap(row => (typeof row === "string" ? [row]
      : [row.text, row.note, row.quantity]))];
    for ( const text of strings ) if ( text && FORBIDDEN.test(text) ) problems.push(`${key}: forbidden punctuation in "${text.slice(0, 40)}"`);
    for ( const [index, row] of rowsOf(table).entries() ) {
      if ( !row.text && !row.table ) problems.push(`${key} row ${index + 1}: empty`);
      if ( row.table && !tables.has(row.table) ) problems.push(`${key} row ${index + 1}: unknown table ${row.table}`);
      for ( const id of Object.keys(row.conditions?.tags ?? {}) ) if ( !tagIds.has(id) ) problems.push(`${key} row ${index + 1}: unknown tag ${id}`);
    }
    for ( const dependency of dependencies(table) ) if ( !tables.has(dependency) ) problems.push(`${key}: refers to ${dependency}`);
  }
  // Circles
  const state = new Map();
  const walk = (key, path) => {
    if ( state.get(key) === "done" || !tables.has(key) ) return;
    if ( state.get(key) === "open" ) {
      problems.push(`circle: ${[...path, key].join(" > ")}`);
      return;
    }
    state.set(key, "open");
    for ( const dependency of dependencies(tables.get(key)) ) walk(dependency, [...path, key]);
    state.set(key, "done");
  };
  for ( const key of tables.keys() ) walk(key, []);
  return problems;
}
