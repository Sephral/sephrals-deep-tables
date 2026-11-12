/**
 * Pure logic of tables with a memory: a table can remember which of its results were drawn, across sessions, until
 * the GM resets it. The memory is a list of result ids on the table (flag "used"). It is independent of Foundry's own
 * "draw without replacement", which marks results as drawn on the results themselves: a result counts as used when
 * either one says so, and a reset clears both.
 */

import {SDT} from "./flags.mjs";

/** The most nested tables the counter follows. */
const MAX_NESTED = 40;

/**
 * Read the memory of a table.
 * @param {(path: string) => unknown} get   Reads a path of the table's flags
 * @returns {{memory: boolean, used: string[]}}
 */
export function memoryOf(get) {
  const used = get(`${SDT}.used`);
  return {
    memory: get(`${SDT}.memory`) === true,
    used: Array.isArray(used) ? [...new Set(used.filter(id => (typeof id === "string") && id))] : []
  };
}

/**
 * The results of a table as the drawing engine should see them: remembered results count as drawn while the memory
 * is on.
 * @param {{id: string, drawn: boolean}[]} results
 * @param {{memory: boolean, used: string[]}} state
 * @returns {object[]}
 */
export function applyMemory(results, {memory, used}) {
  if ( !memory || !used.length ) return results;
  const set = new Set(used);
  return results.map(result => (set.has(result.id) && !result.drawn ? {...result, drawn: true} : result));
}

/**
 * How many results are used, and which.
 * @param {{id: string, drawn: boolean}[]} results
 * @param {{memory: boolean, used: string[]}} state
 * @param {boolean} replacement   The table draws with replacement (Foundry's drawn marks are not used then)
 * @returns {{used: number, total: number, ids: string[]}}
 */
export function counter(results, {memory, used}, replacement = false) {
  const remembered = new Set(memory ? used : []);
  const ids = results.filter(r => (!replacement && r.drawn) || remembered.has(r.id)).map(r => r.id);
  return {used: ids.length, total: results.length, ids};
}

/**
 * Does the table show a counter? With the memory option, and without replacement, where Foundry's marks are the
 * memory.
 * @param {{memory: boolean}} state
 * @param {boolean} replacement
 * @returns {boolean}
 */
export function hasMemory({memory}, replacement) {
  return !!memory || !replacement;
}

/**
 * Add result ids to the memory. Ids that are not results of the table are dropped.
 * @param {string[]} used
 * @param {string[]} ids
 * @param {Iterable<string>} valid   The ids of the table's results
 * @returns {string[]}
 */
export function addUsed(used, ids, valid) {
  const known = new Set(valid);
  return [...new Set([...used, ...ids])].filter(id => known.has(id));
}

/**
 * Take one result out of the memory.
 * @param {string[]} used
 * @param {string} id
 * @returns {string[]}
 */
export function removeUsed(used, id) {
  return used.filter(entry => entry !== id);
}

/**
 * The results to remember when lines are shown: the picks of tables with the memory option, outside compendiums.
 * @param {{picks?: {t: string, r: string, k?: boolean}[]}[]} lines
 * @returns {Map<string, string[]>}   Result ids by table UUID
 */
export function memoryMarks(lines) {
  const marks = new Map();
  for ( const line of lines ) {
    for ( const pick of line.picks ?? [] ) {
      if ( !pick.k ) continue;
      if ( !marks.has(pick.t) ) marks.set(pick.t, new Set());
      marks.get(pick.t).add(pick.r);
    }
  }
  return new Map([...marks].map(([uuid, ids]) => [uuid, [...ids]]));
}

/**
 * The counters of a table and of the tables inside it that have a memory.
 * @param {string} uuid
 * @param {(uuid: string) => Promise<{uuid: string, name: string, replacement: boolean, memory: boolean,
 *   used: string[], results: {id: string, drawn: boolean}[], children: string[]}|null>} load
 * @returns {Promise<{uuid: string, name: string, used: number, total: number, ids: string[]}[]>}
 */
export async function nestedCounters(uuid, load) {
  const seen = new Set();
  const out = [];
  const walk = async (id, top) => {
    if ( seen.has(id) || (seen.size >= MAX_NESTED) ) return;
    seen.add(id);
    const table = await load(id);
    if ( !table ) return;
    const state = {memory: table.memory, used: table.used};
    if ( top || hasMemory(state, table.replacement) ) {
      out.push({uuid: table.uuid, name: table.name, ...counter(table.results, state, table.replacement)});
    }
    for ( const child of table.children ?? [] ) await walk(child, false);
  };
  await walk(uuid, true);
  return out;
}
