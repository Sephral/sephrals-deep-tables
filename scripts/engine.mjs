/**
 * The bridge between the pure drawing engine (draw.mjs) and Foundry: table snapshots, dependencies, rolling a table
 * with its settings, marking results as drawn.
 */

import {MODULE_ID, setting} from "./config.mjs";
import {actionOf, isComplete} from "./actions.mjs";
import {denominations, coinLabel} from "./coins.mjs";
import {drawTable, drawnMarks, excludeFromLines, newState, parseCoinText, resolveQuantity} from "./draw.mjs";
import {resultQuantity, tableSettings} from "./flags.mjs";
import {addUsed, applyMemory, hasMemory, memoryMarks, memoryOf, nestedCounters, removeUsed} from "./memory.mjs";
import {trace} from "./debug.mjs";

/**
 * The settings of a table (draws, no duplicates, visibility), with an older table module's flags as a fallback.
 * @param {RollTable} table
 * @returns {{draws: string, distinct: boolean, mode: string}}
 */
export function settingsOf(table) {
  const flags = table.flags ?? {};
  return tableSettings(path => foundry.utils.getProperty(flags, path));
}

/**
 * The quantity formula of a result.
 * @param {TableResult} result
 * @returns {string}
 */
export function quantityOf(result) {
  const flags = result.flags ?? {};
  return resultQuantity(path => foundry.utils.getProperty(flags, path), result.type);
}

/**
 * The action of a result, or null when it has none or does not know what to do.
 * @param {TableResult} result
 * @returns {object|null}
 */
export function actionOfResult(result) {
  const flags = result.flags ?? {};
  const action = actionOf(path => foundry.utils.getProperty(flags, path));
  return isComplete(action, result.documentUuid ?? null) ? action : null;
}

/**
 * What the table remembers: the option and the ids of the results.
 * @param {RollTable} table
 * @returns {{memory: boolean, used: string[]}}
 */
export function memoryOfTable(table) {
  const flags = table.flags ?? {};
  return memoryOf(path => foundry.utils.getProperty(flags, path));
}

/**
 * A plain copy of a table for the engine.
 * @param {RollTable} table
 * @param {object} [overrides]   Settings for this roll instead of the saved ones
 * @returns {import("./draw.mjs").TableSnapshot}
 */
export function snapshotTable(table, overrides = {}) {
  const saved = settingsOf(table);
  const results = [...table.results.contents].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
  const remembered = memoryOfTable(table);
  const list = results.map(result => ({
    id: result.id,
    type: result.type === "text" ? "text" : "document",
    name: result.name ?? "",
    img: result.img ?? "",
    description: result.description ?? "",
    documentUuid: result.documentUuid ?? null,
    range: [...(result.range ?? [1, 1])],
    weight: result.weight ?? 1,
    drawn: !!result.drawn,
    quantity: quantityOf(result),
    action: actionOfResult(result)
  }));
  return {
    uuid: table.uuid,
    name: table.name,
    formula: table._source?.formula ?? "",
    replacement: !!table.replacement,
    pack: !!table.pack,
    memory: remembered.memory && !table.pack,
    distinct: overrides.distinct ?? saved.distinct,
    draws: overrides.draws ?? saved.draws,
    mode: overrides.mode ?? saved.mode,
    results: applyMemory(list, remembered)
  };
}

/**
 * Find a table by RollTable, UUID, id or name.
 * @param {RollTable|string} ref
 * @returns {Promise<RollTable|null>}
 */
export async function resolveTable(ref) {
  if ( ref instanceof RollTable ) return ref;
  const text = String(ref ?? "").trim();
  if ( !text ) return null;
  if ( text.includes(".") ) {
    const doc = await fromUuid(text).catch(() => null);
    if ( doc instanceof RollTable ) return doc;
  }
  return game.tables.get(text) ?? game.tables.getName(text) ?? null;
}

/**
 * Roll a formula without showing dice.
 * @param {string} formula
 * @returns {Promise<{total: number, roll: Roll}>}
 */
async function evaluate(formula) {
  const roll = new Roll(formula);
  await roll.evaluate({allowInteractive: false});
  return {total: roll.total, roll};
}

/**
 * The dependencies of the drawing engine in Foundry.
 * @returns {import("./draw.mjs").DrawDeps}
 */
export function makeDeps() {
  const coins = denominations();
  return {
    roll: evaluate,
    evaluate,
    loadDoc: async uuid => {
      const doc = await fromUuid(uuid).catch(() => null);
      if ( !doc ) return null;
      return {uuid: doc.uuid, documentName: doc.documentName, name: doc.name ?? "", img: doc.img ?? ""};
    },
    loadTable: async uuid => {
      const table = await fromUuid(uuid).catch(() => null);
      return (table instanceof RollTable) ? snapshotTable(table) : null;
    },
    findTable: async ref => {
      const table = await resolveTable(ref);
      return table ? snapshotTable(table) : null;
    },
    coinParts: text => parseCoinText(text, coins),
    coinLabel,
    newId: () => foundry.utils.randomID()
  };
}

/**
 * Roll a table: the number of draws, then the draws, with the table's settings or the ones passed in.
 * @param {RollTable} table
 * @param {object} [options]
 * @param {string} [options.draws]       Formula of the number of draws
 * @param {boolean} [options.distinct]
 * @param {Map<string, Set<string>>} [options.exclude]
 * @returns {Promise<{lines: import("./draw.mjs").Line[], state: import("./draw.mjs").DrawState, rolls: Roll[],
 *   draws: number}>}
 */
export async function rollTable(table, options = {}) {
  const snapshot = snapshotTable(table, {draws: options.draws, distinct: options.distinct});
  const deps = makeDeps();
  const state = newState({exclude: options.exclude, maxDepth: setting("maxDepth")});
  const rolls = [];
  const draws = await resolveQuantity(snapshot.draws, async formula => {
    const rolled = await deps.evaluate(formula);
    rolls.push(rolled.roll);
    return rolled.total;
  });
  const times = draws ?? 1;
  const lines = await drawTable(snapshot, deps, {times, state});
  if ( state.ranOut ) state.problems.push({kind: "ranOut", table: table.name});
  trace.add("roll", {table: table.name, draws: times, lines: lines.length, problems: state.problems.map(p => p.kind),
    ranOut: state.ranOut, invalidDraws: draws === null});
  return {lines, state, rolls, draws: times, invalidDraws: draws === null};
}

/**
 * Draw one line again from the table it came from, keeping the rest of the lines.
 * @param {import("./draw.mjs").Line} line
 * @param {import("./draw.mjs").Line[]} others   The other lines of the roll
 * @param {import("./draw.mjs").DrawState} state
 * @returns {Promise<import("./draw.mjs").Line[]>}
 */
export async function rerollLine(line, others, state) {
  const table = await fromUuid(line.tableUuid).catch(() => null);
  if ( !(table instanceof RollTable) ) return [];
  const index = line.picks.findIndex(p => (p.t === line.tableUuid) && (p.r === line.resultId));
  const prefix = index > 0 ? line.picks.slice(0, index) : [];
  const fresh = newState({exclude: excludeFromLines(others), maxDepth: state.maxDepth});
  const lines = await drawTable(snapshotTable(table), makeDeps(), {times: 1, state: fresh, depth: line.depth,
    chain: prefix.map(p => p.t), path: line.path.slice(0, -1), picks: prefix});
  state.problems.push(...fresh.problems);
  return lines;
}

/**
 * GM: mark the results behind the shown lines as drawn (tables without replacement, not in compendiums) and
 * remember them (tables with a memory).
 * @param {import("./draw.mjs").Line[]} lines
 * @returns {Promise<void>}
 */
export async function markDrawn(lines) {
  if ( !game.user.isGM ) return;
  for ( const [uuid, ids] of drawnMarks(lines) ) {
    const table = await fromUuid(uuid).catch(() => null);
    if ( !(table instanceof RollTable) || table.pack ) continue;
    const updates = ids.filter(id => table.results.get(id) && !table.results.get(id).drawn).map(id => ({_id: id, drawn: true}));
    if ( updates.length ) await table.updateEmbeddedDocuments("TableResult", updates, {diff: false});
  }
  for ( const [uuid, ids] of memoryMarks(lines) ) {
    const table = await fromUuid(uuid).catch(() => null);
    if ( !(table instanceof RollTable) || table.pack ) continue;
    const state = memoryOfTable(table);
    if ( !state.memory ) continue;
    const used = addUsed(state.used, ids, table.results.map(r => r.id));
    if ( used.length !== state.used.length ) await table.update({[`flags.${MODULE_ID}.used`]: used});
  }
}

/**
 * GM: bring all results of a table back, the marks of Foundry and the memory.
 * @param {RollTable} table
 * @returns {Promise<boolean>}
 */
export async function resetTable(table) {
  if ( !(table instanceof RollTable) || !game.user.isGM || table.pack ) return false;
  if ( table.results.some(result => result.drawn) ) await table.resetResults();
  if ( memoryOfTable(table).used.length ) await table.update({[`flags.${MODULE_ID}.used`]: []});
  return true;
}

/**
 * GM: put one result back into the table, so it can be drawn again.
 * @param {RollTable} table
 * @param {string} resultId
 * @returns {Promise<boolean>}
 */
export async function putBack(table, resultId) {
  if ( !(table instanceof RollTable) || !game.user.isGM || table.pack ) return false;
  const result = table.results.get(resultId);
  if ( !result ) return false;
  if ( result.drawn ) await table.updateEmbeddedDocuments("TableResult", [{_id: resultId, drawn: false}], {diff: false});
  const state = memoryOfTable(table);
  if ( state.used.includes(resultId) ) await table.update({[`flags.${MODULE_ID}.used`]: removeUsed(state.used, resultId)});
  return true;
}

/**
 * Ask the GM whether to bring all results of an empty table back, and do it.
 * @param {string} uuid
 * @returns {Promise<boolean>}
 */
export async function offerReset(uuid) {
  const table = await fromUuid(uuid).catch(() => null);
  return resetTable(table);
}

/**
 * The counters of a table and the tables inside it that have a memory or draw without replacement.
 * @param {RollTable} table
 * @returns {Promise<{uuid: string, name: string, used: number, total: number, ids: string[]}[]>}
 */
export async function countersOf(table) {
  const load = async uuid => {
    const doc = (uuid === table.uuid) ? table : await fromUuid(uuid).catch(() => null);
    if ( !(doc instanceof RollTable) ) return null;
    const state = memoryOfTable(doc);
    return {
      uuid: doc.uuid,
      name: doc.name,
      replacement: !!doc.replacement,
      memory: state.memory && !doc.pack,
      used: state.used,
      results: doc.results.map(result => ({id: result.id, drawn: !!result.drawn})),
      children: doc.results.filter(r => r.type !== "text" && r.documentUuid && /RollTable\./.test(r.documentUuid))
        .map(r => r.documentUuid)
    };
  };
  return nestedCounters(table.uuid, load);
}

/**
 * Does a table show a counter?
 * @param {RollTable} table
 * @returns {boolean}
 */
export function showsCounter(table) {
  return hasMemory(memoryOfTable(table), !!table.replacement) && !table.pack;
}
