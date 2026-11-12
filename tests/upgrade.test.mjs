import assert from "node:assert/strict";
import test from "node:test";
import {ACTION_TYPES, autoRows, describe, isComplete, lineAction, normalizeAction, referenceOf, spreadCells}
  from "../scripts/actions.mjs";
import {drawTable, drawnMarks, newState, parseCoinText} from "../scripts/draw.mjs";
import {mergeLines} from "../scripts/merge.mjs";
import {addUsed, applyMemory, counter, hasMemory, memoryMarks, memoryOf, nestedCounters, removeUsed}
  from "../scripts/memory.mjs";
import {checkRequest, listEntries, playerMode, playersMayRoll, sameEntries} from "../scripts/players.mjs";

const get = flags => path => path.split(".").reduce((o, k) => o?.[k], flags);

/** A table snapshot of text results. */
function table(uuid, count, extra = {}) {
  return {uuid, name: uuid, formula: `1d${count}`, replacement: true, pack: false, distinct: false, draws: "1",
    mode: "foundry", memory: false, ...extra,
    results: Array.from({length: count}, (_, i) => ({id: `${uuid}-${i}`, type: "text", name: `R${i}`, img: "",
      description: "", documentUuid: null, range: [i + 1, i + 1], weight: 1, drawn: false, quantity: "", action: null,
      ...(extra.results?.[i] ?? {})}))};
}

function deps(tables, rolls = []) {
  const queue = [...rolls];
  const byId = new Map(tables.map(t => [t.uuid, t]));
  return {
    roll: async formula => ({total: queue.length ? queue.shift() : 1, roll: {formula}}),
    evaluate: async formula => ({total: Number(formula) || 1, roll: {formula}}),
    loadDoc: async uuid => (byId.has(uuid) ? {uuid, documentName: "RollTable", name: byId.get(uuid).name, img: ""} : null),
    loadTable: async uuid => byId.get(uuid) ?? null,
    findTable: async ref => byId.get(ref) ?? null,
    coinParts: text => parseCoinText(text, [{key: "gp", abbr: "gp"}]),
    coinLabel: key => key,
    newId: (() => { let n = 0; return () => `L${++n}`; })()
  };
}

/* -------------------------------------------- */
/*  Memory                                      */
/* -------------------------------------------- */

test("the memory is read from the flags and cleaned", () => {
  assert.deepEqual(memoryOf(() => undefined), {memory: false, used: []});
  const flags = {"sephrals-deep-tables.memory": true, "sephrals-deep-tables.used": ["a", "a", "", 3, "b"]};
  assert.deepEqual(memoryOf(path => flags[path]), {memory: true, used: ["a", "b"]});
});

test("remembered results count as drawn only while the memory is on", () => {
  const results = [{id: "a", drawn: false}, {id: "b", drawn: false}, {id: "c", drawn: true}];
  assert.deepEqual(applyMemory(results, {memory: true, used: ["a", "c"]}).map(r => r.drawn), [true, false, true]);
  assert.equal(applyMemory(results, {memory: false, used: ["a"]}), results);
});

test("the counter counts Foundry's marks without replacement and the memory", () => {
  const results = [{id: "a", drawn: true}, {id: "b", drawn: false}, {id: "c", drawn: false}];
  assert.deepEqual(counter(results, {memory: false, used: []}, false), {used: 1, total: 3, ids: ["a"]});
  // With replacement Foundry's marks are not used
  assert.deepEqual(counter(results, {memory: false, used: []}, true), {used: 0, total: 3, ids: []});
  assert.deepEqual(counter(results, {memory: true, used: ["b", "a"]}, false), {used: 2, total: 3, ids: ["a", "b"]});
  assert.equal(hasMemory({memory: false}, true), false);
  assert.equal(hasMemory({memory: true}, true), true);
  assert.equal(hasMemory({memory: false}, false), true);
});

test("adding, putting back and dropping unknown ids", () => {
  assert.deepEqual(addUsed(["a"], ["b", "x", "a"], ["a", "b", "c"]), ["a", "b"]);
  assert.deepEqual(removeUsed(["a", "b"], "a"), ["b"]);
});

test("a table with a memory does not draw a remembered result again, even with replacement", async () => {
  const t = table("T", 3, {memory: true, results: [{drawn: true}]});
  // the roll asks for 1 first (drawn), the table rolls again until an available result is hit
  const lines = await drawTable(t, deps([t], [1, 1, 2]), {state: newState()});
  assert.equal(lines.length, 1);
  assert.equal(lines[0].resultId, "T-1");
  assert.deepEqual(lines[0].picks[0], {t: "T", r: "T-1", x: true, m: false, k: true});
});

test("the memory marks come from the picks of tables with the option", async () => {
  const t = table("T", 2, {memory: true});
  const plain = table("P", 2);
  const lines = [...await drawTable(t, deps([t], [2])), ...await drawTable(plain, deps([plain], [1]))];
  assert.deepEqual([...memoryMarks(lines)], [["T", ["T-1"]]]);
  // Foundry's own marks stay for tables without replacement only
  assert.deepEqual([...drawnMarks(lines)], []);
});

test("a table with a memory does not repeat a result inside one roll", async () => {
  const t = table("T", 2, {memory: true});
  const lines = await drawTable(t, deps([t], [1, 1, 2]), {times: 2});
  assert.deepEqual(lines.map(l => l.resultId), ["T-0", "T-1"]);
});

test("tables inside tables with a memory are remembered on their own table", async () => {
  const inner = table("I", 2, {memory: true});
  const outer = table("O", 1, {results: [{type: "document", documentUuid: "I"}]});
  const lines = await drawTable(outer, deps([outer, inner], [1, 2]));
  assert.equal(lines[0].resultId, "I-1");
  assert.deepEqual([...memoryMarks(lines)], [["I", ["I-1"]]]);
});

test("nested counters list the table and nested tables with a memory", async () => {
  const tables = {
    O: {uuid: "O", name: "Outer", replacement: true, memory: false, used: [], results: [{id: "o1", drawn: false}], children: ["I", "P", "O"]},
    I: {uuid: "I", name: "Inner", replacement: true, memory: true, used: ["i1"], results: [{id: "i1", drawn: false}, {id: "i2", drawn: false}], children: []},
    P: {uuid: "P", name: "Plain", replacement: true, memory: false, used: [], results: [], children: []}
  };
  const list = await nestedCounters("O", async uuid => tables[uuid] ?? null);
  assert.deepEqual(list.map(c => [c.name, c.used, c.total]), [["Outer", 0, 1], ["Inner", 1, 2]]);
});

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

test("an action is cleaned to the fields of its type", () => {
  assert.equal(normalizeAction(null), null);
  assert.equal(normalizeAction({type: "fly"}), null);
  assert.deepEqual(normalizeAction({type: "tokens", ref: " Goblin ", count: "1d4", hidden: true, junk: 1, auto: true}),
    {type: "tokens", auto: true, ref: "Goblin", count: "1d4", hidden: true});
  assert.deepEqual(normalizeAction({type: "sound", src: "a.ogg", volume: 5}), {type: "sound", auto: false, ref: "", src: "a.ogg", volume: 1});
  assert.equal(normalizeAction({type: "sound", volume: ""}).volume, 0.8);
  assert.equal(normalizeAction({type: "journal", show: "nope"}).show, "show");
  assert.equal(normalizeAction({type: "effect", target: "targeted"}).target, "targeted");
  assert.equal(ACTION_TYPES.length, 6);
});

test("an action is complete with its own reference or the one of the result", () => {
  assert.equal(isComplete(null), false);
  assert.equal(isComplete(normalizeAction({type: "tokens"})), false);
  assert.equal(isComplete(normalizeAction({type: "tokens"}), "Actor.a"), true);
  assert.equal(isComplete(normalizeAction({type: "effect"}), "Actor.a"), false);
  assert.equal(isComplete(normalizeAction({type: "effect", status: "prone"})), true);
  assert.equal(isComplete(normalizeAction({type: "sound", src: "a.ogg"})), true);
  assert.equal(referenceOf({ref: ""}, "Actor.a"), "Actor.a");
  assert.equal(referenceOf({ref: "X"}, "Actor.a"), "X");
});

test("a card line knows the type of the action, not its settings", () => {
  const act = lineAction(normalizeAction({type: "macro", ref: "Secret macro", auto: true}), "T", "r1");
  assert.deepEqual(act, {type: "macro", auto: true, t: "T", r: "r1"});
  assert.equal(lineAction(null, "T", "r1"), null);
  assert.equal(describe(act, key => key), "SDT.Action.type.macro · SDT.Action.autoShort");
});

test("actions come with the lines of a draw and stay apart in the card", async () => {
  const t = table("T", 2, {results: [{action: normalizeAction({type: "tokens", ref: "Goblin", auto: true})}, {}]});
  const lines = [...await drawTable(t, deps([t], [1])), ...await drawTable(t, deps([t], [2]))];
  assert.equal(lines[0].act.type, "tokens");
  assert.equal(lines[1].act, null);
  const rows = mergeLines(lines);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].act.r, "T-0");
  assert.equal(rows[1].act, null);
  // The same result twice is one row with the count
  const twice = mergeLines([...lines.slice(0, 1), ...await drawTable(t, deps([t], [1]))]);
  assert.equal(twice.length, 1);
  assert.equal(twice[0].quantity, 2);
});

test("only unrun auto actions are picked", () => {
  const rows = [{key: "a", act: {auto: true}}, {key: "b", act: {auto: false}}, {key: "c", act: null}, {key: "d", act: {auto: true}}];
  assert.deepEqual(autoRows(rows, {d: {}}).map(r => r.key), ["a"]);
});

test("tokens are spread in rows around the clicked cell", () => {
  assert.deepEqual(spreadCells(0), []);
  assert.deepEqual(spreadCells(1), [{dx: 0, dy: 0}]);
  const four = spreadCells(4);
  assert.equal(new Set(four.map(c => `${c.dx},${c.dy}`)).size, 4);
  assert.deepEqual(four.map(c => c.dx).sort(), [0, 0, 1, 1]);
  assert.equal(spreadCells(500).length, 50);
  assert.equal(new Set(spreadCells(7).map(c => `${c.dx},${c.dy}`)).size, 7);
});

/* -------------------------------------------- */
/*  Players                                     */
/* -------------------------------------------- */

test("the list for players holds the marked world tables", () => {
  const tables = [
    {uuid: "B", name: "Beta", mode: "gm", players: true},
    {uuid: "A", name: "Alpha", mode: "weird", players: true},
    {uuid: "C", name: "Gamma", players: false},
    {uuid: "P", name: "Pack", players: true, pack: true}
  ];
  assert.deepEqual(listEntries(tables).map(e => [e.uuid, e.mode]), [["A", "foundry"], ["B", "gm"]]);
  assert.equal(sameEntries(listEntries(tables), listEntries([...tables].reverse())), true);
  assert.equal(playersMayRoll(get({"sephrals-deep-tables": {players: true}})), true);
  assert.equal(playersMayRoll(get({})), false);
});

test("a roll of a player is checked against the table", () => {
  assert.equal(playerMode("foundry"), "public");
  assert.equal(playerMode("blind"), "blind");
  assert.deepEqual(checkRequest({uuid: "T"}, {players: true, mode: "gm"}), {ok: true, mode: "gm"});
  assert.deepEqual(checkRequest({uuid: "T"}, {players: true}), {ok: true, mode: "public"});
  assert.equal(checkRequest({uuid: "T"}, {players: false}).reason, "denied");
  assert.equal(checkRequest({uuid: "T"}, {players: true, pack: true}).reason, "denied");
  assert.equal(checkRequest({uuid: "T"}, null).reason, "missing");
  assert.equal(checkRequest({uuid: 4}, {players: true}).reason, "invalid");
  assert.equal(checkRequest(null, {players: true}).reason, "invalid");
});
