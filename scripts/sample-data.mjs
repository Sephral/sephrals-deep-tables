// Made-up data for the sample windows (api.samples, see samples.mjs): one small table with rows that act, have
// conditions and nest another table, the lines of a roll over it and the data of the result card. Pure functions without
// Foundry globals, so they run in the unit tests. `tx(key, data)` gives a text of the user's language.
import {mergeLines} from "./merge.mjs";
import {sampleText} from "./samples.mjs";

const SDT = "sephrals-deep-tables";

/** Ids are fixed: the sample documents are never saved, so they cannot collide with anything. */
export const TABLE_ID = "sdtSampleLoot001";
export const INNER_ID = "sdtSamplePotion1";
export const TABLE_UUID = `RollTable.${TABLE_ID}`;
export const INNER_UUID = `RollTable.${INNER_ID}`;
const RESULT = n => `sdtSampleRes${String(n).padStart(4, "0")}`;
const ITEM_BOW = "Item.sdtSampleItem001";
const ITEM_POTION = "Item.sdtSampleItem002";
const ITEM_GEM = "Item.sdtSampleItem003";
const ITEM_SWORD = "Item.sdtSampleItem004";
const JOURNAL = "JournalEntry.sdtSampleJour001";

const IMG = {
  table: "icons/svg/chest.svg",
  bow: "weapons/bows/shortbow-recurve.webp",
  potion: "consumables/potions/bottle-round-corked-red.webp",
  sword: "weapons/swords/sword-guard-purple.webp",
  gem: "icons/svg/item-bag.svg"
};
const icon = name => (name.startsWith("icons/") ? name : `icons/${name}`);

/**
 * The data of the sample table (for `new RollTable.implementation(data)`): ten rows, a memory with one used row, a
 * table inside it, rows that act and rows with conditions.
 * @param {(key: string, data?: object) => string} tx
 * @param {object} [options]
 * @param {boolean} [options.empty]   A table without results left
 * @returns {object}
 */
export function sampleTableData(tx, {empty = false} = {}) {
  const text = (n, range, name, flags = {}) => ({_id: RESULT(n), type: "text", name, description: name, range, weight: 1, flags: {[SDT]: flags}});
  return {
    _id: TABLE_ID,
    name: tx("SDT.Sample.table.name"),
    img: IMG.table,
    formula: "1d10",
    replacement: true,
    flags: {[SDT]: {memory: true, used: empty ? [RESULT(1), RESULT(2), RESULT(3)] : [RESULT(1)], draws: "1d3", distinct: true, mode: "gm", players: true,
      onEmpty: "reroll"}},
    results: [
      {_id: RESULT(1), type: "document", name: sampleText("shortbow"), img: icon(IMG.bow), documentUuid: ITEM_BOW, range: [1, 1], weight: 1, flags: {[SDT]: {quantity: "1"}}},
      {_id: RESULT(2), type: "document", name: tx("SDT.Sample.table.potions"), img: IMG.table, documentUuid: INNER_UUID, range: [2, 3], weight: 1, flags: {[SDT]: {quantity: "1d3"}}},
      text(3, [4, 4], tx("SDT.Sample.table.coins")),
      text(4, [5, 5], tx("SDT.Sample.table.map")),
      text(5, [6, 6], tx("SDT.Sample.table.pelt"), {conditions: {times: ["dusk", "night"], level: {min: 3, max: 5}, tags: {[tag(tx, "war")]: true, [tag(tx, "festival")]: false}}}),
      text(6, [7, 7], tx("SDT.Sample.table.cart"), {action: {type: "encounter", ref: "", combat: true, auto: false}}),
      text(7, [8, 8], tx("SDT.Sample.table.howl"), {action: {type: "sound", ref: "", src: "sounds/lock.wav", volume: 0.6, auto: true}}),
      text(8, [9, 10], tx("SDT.Sample.table.wolves"), {action: {type: "tokens", ref: sampleText("wolf"), count: "1d4+1", hidden: false, auto: false}})
    ]
  };
}

/** The id of a sample story tag. A world without the tag shows the id as its name, so the id is the name. */
function tag(tx, key) {
  return tx(`SDT.Sample.table.${key}`);
}

/**
 * One result of a window that edits a result, as table data with a single row.
 * @param {(key: string, data?: object) => string} tx
 * @param {string} name
 * @param {object} flags   The flags of the module on the result (action, conditions)
 * @returns {object}
 */
export function sampleResultTable(tx, name, flags) {
  return {_id: TABLE_ID, name: tx("SDT.Sample.table.name"), img: IMG.table, formula: "1d4", replacement: true,
    results: [{_id: RESULT(1), type: "text", name, description: name, range: [1, 4], weight: 1, flags: {[SDT]: flags}}]};
}

/** The made-up settings of a window for every kind of action. */
export function sampleActionFlags(type, tx) {
  const data = {
    encounter: {type: "encounter", ref: "", combat: true, auto: false},
    tokens: {type: "tokens", ref: sampleText("wolf"), count: "1d4+1", hidden: false, auto: true},
    sound: {type: "sound", ref: "", src: "sounds/lock.wav", volume: 0.6, auto: false},
    journal: {type: "journal", ref: tx("SDT.Sample.table.mapLink"), show: "open", auto: false},
    effect: {type: "effect", status: "poisoned", ref: "", target: "targeted", auto: false},
    macro: {type: "macro", ref: "", auto: false}
  };
  return {action: data[type] ?? {type, auto: false}};
}

/** The conditions of a row for the conditions window (a scene id may be added by the window). */
export function sampleConditions(tx, sceneId = null) {
  return {...(sceneId ? {scenes: [sceneId]} : {}), regions: [sampleText("place")], times: ["dusk", "night"], level: {min: 3, max: 5},
    tags: {[tag(tx, "war")]: true, [tag(tx, "festival")]: false}};
}

/**
 * The lines of a roll over the sample table.
 * @param {(key: string, data?: object) => string} tx
 * @returns {object[]}
 */
export function sampleLines(tx) {
  const tableName = tx("SDT.Sample.table.name");
  const potions = tx("SDT.Sample.table.potions");
  const base = {name: "", img: "", quantity: 1, coins: {}, formula: "1", invalid: false, tableUuid: TABLE_UUID, tableName, depth: 0, path: [tableName],
    picks: [], act: null, rolls: [], include: true};
  let n = 0;
  const line = (extra, resultNumber) => ({...base, id: `sdtl${++n}`, resultId: RESULT(resultNumber), ...extra});
  const act = (type, auto, resultNumber) => ({type, auto, t: TABLE_UUID, r: RESULT(resultNumber)});
  return [
    line({kind: "coins", coins: {gp: 9, sp: 5}, formula: "2d6 gp, 5 sp"}, 3),
    line({kind: "item", name: sampleText("shortbow"), img: icon(IMG.bow), uuid: ITEM_BOW, formula: "1"}, 1),
    line({kind: "item", name: tx("SDT.Sample.table.healing"), img: icon(IMG.potion), uuid: ITEM_POTION, quantity: 3, formula: "1d3", tableUuid: INNER_UUID,
      tableName: potions, depth: 1, path: [tableName, potions]}, 2),
    line({kind: "text", text: tx("SDT.Sample.table.map"), html: tx("SDT.Sample.table.map")}, 4),
    line({kind: "link", name: tx("SDT.Sample.table.mapLink"), uuid: JOURNAL, quantity: 2, formula: "1d2"}, 4),
    line({kind: "item", name: tx("SDT.Sample.table.gem"), img: IMG.gem, uuid: ITEM_GEM, formula: "2d", invalid: true}, 2),
    line({kind: "item", name: sampleText("longsword"), img: icon(IMG.sword), uuid: ITEM_SWORD, include: false}, 1),
    line({kind: "text", text: tx("SDT.Sample.table.howl"), html: tx("SDT.Sample.table.howl"), act: act("sound", true, 7)}, 7),
    line({kind: "text", text: tx("SDT.Sample.table.cart"), html: tx("SDT.Sample.table.cart"), act: act("encounter", false, 6)}, 6),
    line({kind: "text", text: tx("SDT.Sample.table.wolves"), html: tx("SDT.Sample.table.wolves"), act: act("tokens", false, 8)}, 8)
  ];
}

/**
 * What a roll over the sample table gave: the lines, the state with the problems, the rows left out and the situation.
 * @param {(key: string, data?: object) => string} tx
 * @param {object} [options]
 * @param {boolean} [options.empty]
 * @returns {{lines: object[], state: object, draws: number}}
 */
export function sampleRoll(tx, {empty = false} = {}) {
  const tableName = tx("SDT.Sample.table.name");
  const potions = tx("SDT.Sample.table.potions");
  if ( empty ) {
    return {lines: [], draws: 1, state: {problems: [{kind: "empty", table: tableName, uuid: TABLE_UUID}], left: [], situation: null, ranOut: true}};
  }
  const lines = sampleLines(tx).filter(entry => entry.act?.type !== "encounter" && entry.act?.type !== "tokens");
  return {
    lines,
    draws: 2,
    state: {
      problems: [{kind: "ranOut", table: potions}, {kind: "depth", table: tx("SDT.Sample.table.cyclePart")}],
      left: [{name: tx("SDT.Sample.table.pelt"), tableUuid: TABLE_UUID, tableName: potions,
        reasons: [{kind: "time", periods: ["dusk", "night"], now: "day"}, {kind: "level", min: 3, max: 5, level: 7}, {kind: "tag", id: tag(tx, "war"), want: true}]}],
      situation: {sceneId: null, regions: [sampleText("place")], period: "day", hour: 14, level: 7, levelOff: false, tags: {[tag(tx, "festival")]: true}}
    }
  };
}

/**
 * The data of the result card: merged lines, what was run and given.
 * @param {(key: string, data?: object) => string} tx
 * @param {{name: string, name2?: string}} names   Names for the texts of what was done
 * @returns {{table: object, lines: object[], runs: object[], given: object[], draws: number, notes: string[]}}
 */
export function sampleCard(tx, names) {
  const lines = mergeLines(sampleLines(tx).filter(entry => entry.include && !entry.invalid));
  const tokens = lines.find(row => row.act?.type === "tokens");
  const runs = tokens ? [{k: tokens.key, text: tx("SDT.Action.done.tokens", {count: 3, name: sampleText("wolf")}), undo: {tokens: ["sdtSampleToken01"]}, at: 0}] : [];
  const given = [{text: tx("SDT.Give.done", {name: names.name, what: `${tx("SDT.Give.items", {count: 2})}`})}];
  return {table: {uuid: TABLE_UUID, name: tx("SDT.Sample.table.name"), img: IMG.table}, lines, runs, given, draws: 2, notes: []};
}

/** The kinds of problems a roll can report, for the card with notes. */
export const PROBLEM_KINDS = ["cycle", "depth", "missing", "empty", "impossible", "invalid", "ranOut", "conditions", "conditionsIgnored"];

/**
 * The problems of a card of every kind.
 * @param {(key: string, data?: object) => string} tx
 * @returns {{kind: string, table: string, ref: string}[]}
 */
export function sampleProblems(tx) {
  const table = tx("SDT.Sample.table.name");
  return PROBLEM_KINDS.map(kind => ({kind, table, ref: tx("SDT.Sample.table.missingName")}));
}

/** The pasted text of the import window. */
export function sampleImportText(tx) {
  // the last number is missing on purpose: the preview shows its note about the gap
  return `d8 ${tx("SDT.Sample.table.importName")}
1: ${tx("SDT.Sample.table.dagger")}
2: ${tx("SDT.Sample.table.healing")}
3-4: ${tx("SDT.Sample.table.map")}
`
    + `5-6: ${tx("SDT.Sample.table.coins")}
7: ${tx("SDT.Sample.table.pelt")}`;
}

/** The story tags of the sample world. */
export function sampleTags(tx) {
  return [{id: "war", name: tx("SDT.Sample.table.war"), on: true}, {id: "festival", name: tx("SDT.Sample.table.festival"), on: false}];
}

/** The tables of the player list. */
export function samplePlayerTables(tx) {
  return [
    {uuid: TABLE_UUID, name: tx("SDT.Sample.table.name"), img: IMG.table, shown: tx("SDT.Mode.gm")},
    {uuid: `RollTable.${RESULT(51)}`, name: tx("SDT.Sample.table.rumors"), img: IMG.table, shown: tx("SDT.Mode.public")},
    {uuid: `RollTable.${RESULT(52)}`, name: tx("SDT.Sample.table.weather"), img: IMG.table, shown: tx("SDT.Mode.self")}
  ];
}

export const __test__ = {RESULT, IMG};
