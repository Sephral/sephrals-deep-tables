import assert from "node:assert/strict";
import test from "node:test";
import {MAX_LINES, drawTable, drawnMarks, excludeFromLines, layout, newState, parseCoinText, resolveQuantity, summarize}
  from "../scripts/draw.mjs";

const COINS = [{key: "gp", abbr: "gp"}, {key: "sp", abbr: "sp"}];

/** A table snapshot with results of text, items, or tables. */
function table(uuid, results, extra = {}) {
  return {uuid, name: uuid, formula: `1d${results.length}`, replacement: true, pack: false, distinct: false, draws: "1",
    mode: "foundry", ...extra,
    results: results.map((r, i) => ({id: `${uuid}-${i}`, type: "text", name: "", img: "", description: "",
      documentUuid: null, range: [i + 1, i + 1], weight: 1, drawn: false, quantity: "", ...r}))};
}

/** Dependencies with a scripted roller: rolls come from a queue, formulas are evaluated by a tiny parser. */
function deps(tables, {rolls = [], docs = {}} = {}) {
  const queue = [...rolls];
  const byId = new Map(tables.map(t => [t.uuid, t]));
  return {
    roll: async formula => {
      const total = queue.length ? queue.shift() : 1;
      return {total, roll: {formula, total}};
    },
    evaluate: async formula => {
      if ( /^\d+$/.test(formula) ) return {total: Number(formula), roll: {formula}};
      const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(formula);
      if ( !m ) throw new Error("bad formula");
      // dice always roll the maximum in these tests
      return {total: (Number(m[1]) * Number(m[2])) + Number(m[3] ?? 0), roll: {formula}};
    },
    loadDoc: async uuid => {
      if ( byId.has(uuid) ) return {uuid, documentName: "RollTable", name: byId.get(uuid).name, img: ""};
      return docs[uuid] ?? null;
    },
    loadTable: async uuid => byId.get(uuid) ?? null,
    findTable: async ref => byId.get(ref) ?? [...byId.values()].find(t => t.name === ref) ?? null,
    coinParts: text => parseCoinText(text, COINS),
    coinLabel: key => key,
    newId: (() => { let n = 0; return () => `L${++n}`; })()
  };
}

test("layout spreads a table without formula by weight", () => {
  const t = table("T", [{weight: 2}, {weight: 3}], {formula: ""});
  const {formula, entries} = layout(t);
  assert.equal(formula, "1d5");
  assert.deepEqual(entries.map(e => e.range), [[1, 2], [3, 5]]);
});

test("a text result gives a text line with its quantity as repeats", async () => {
  const t = table("T", [{name: "Goblin", quantity: "3"}]);
  const lines = await drawTable(t, deps([t]));
  assert.equal(lines.length, 3);
  assert.ok(lines.every(l => l.kind === "text" && l.text === "Goblin"));
});

test("an item result gives its quantity from the formula", async () => {
  const t = table("T", [{type: "document", documentUuid: "Item.a", quantity: "2d4+1"}]);
  const d = deps([t], {docs: {"Item.a": {uuid: "Item.a", documentName: "Item", name: "Rope", img: "r.webp"}}});
  const [line] = await drawTable(t, d);
  assert.equal(line.kind, "item");
  assert.equal(line.quantity, 9);
  assert.equal(line.name, "Rope");
  assert.equal(line.invalid, false);
});

test("an invalid quantity formula counts as 1 and is marked", async () => {
  const t = table("T", [{type: "document", documentUuid: "Item.a", quantity: "banana"}]);
  const d = deps([t], {docs: {"Item.a": {uuid: "Item.a", documentName: "Item", name: "Rope"}}});
  const [line] = await drawTable(t, d);
  assert.equal(line.quantity, 1);
  assert.equal(line.invalid, true);
});

test("quantity 0 on an item keeps the line but leaves it out", async () => {
  const t = table("T", [{type: "document", documentUuid: "Item.a", quantity: "0"}]);
  const d = deps([t], {docs: {"Item.a": {uuid: "Item.a", documentName: "Item", name: "Rope"}}});
  const [line] = await drawTable(t, d);
  assert.equal(line.include, false);
});

test("coin texts become coins, summed over the repeats", async () => {
  const t = table("T", [{name: "3d6 gp", quantity: "2"}]);
  const [line] = await drawTable(t, deps([t]));
  assert.equal(line.kind, "coins");
  assert.deepEqual(line.coins, {gp: 36});
  assert.deepEqual(summarize([line]), {items: 0, coins: {gp: 36}});
});

test("a table in a table is drawn as often as its quantity says", async () => {
  const inner = table("Inner", [{name: "Gem"}]);
  const outer = table("Outer", [{type: "document", documentUuid: "Inner", quantity: "4"}]);
  const lines = await drawTable(outer, deps([inner, outer]));
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0].path, ["Outer", "Inner"]);
  assert.equal(lines[0].depth, 1);
});

test("a circle of tables is stopped and reported", async () => {
  const a = table("A", [{type: "document", documentUuid: "B"}, {name: "x"}], {formula: "1d1"});
  const b = table("B", [{type: "document", documentUuid: "A"}], {formula: "1d1"});
  const state = newState();
  const lines = await drawTable(a, deps([a, b]), {state});
  assert.deepEqual(lines, []);
  assert.equal(state.problems.some(p => p.kind === "cycle"), true);
});

test("the depth limit stops deep chains", async () => {
  const tables = [];
  for ( let i = 0; i < 9; i++ ) {
    tables.push(table(`T${i}`, [i < 8 ? {type: "document", documentUuid: `T${i + 1}`} : {name: "end"}], {formula: "1d1"}));
  }
  const state = newState({maxDepth: 3});
  const lines = await drawTable(tables[0], deps(tables), {state});
  assert.equal(lines.length, 0);
  assert.equal(state.problems.some(p => p.kind === "depth"), true);
  const ok = await drawTable(tables[0], deps(tables), {state: newState({maxDepth: 10})});
  assert.equal(ok.length, 1);
});

test("inline rolls become numbers", async () => {
  const t = table("T", [{name: "Treasure", description: "<p>You find [[2d4]] rings and [[/r 1d6 # luck]] coins.</p>"}]);
  const [line] = await drawTable(t, deps([t]));
  assert.equal(line.text, "Treasure: You find 8 rings and 6 coins.");
});

test("a broken inline roll stays as it was", async () => {
  const t = table("T", [{name: "Odd [[banana]]"}]);
  const [line] = await drawTable(t, deps([t]));
  assert.equal(line.text, "Odd [[banana]]");
});

test("@Table draws from another table into the sentence", async () => {
  const names = table("Names", [{name: "Brom"}]);
  const t = table("T", [{name: "A smith called @Table[Names] lives here"}]);
  const state = newState();
  const [line] = await drawTable(t, deps([names, t]), {state});
  assert.equal(line.text, "A smith called Brom lives here");
  assert.equal(state.problems.length, 0);
});

test("@Table of an unknown table or a circle stays and is reported", async () => {
  const self = table("Self", [{name: "again @Table[Self]"}]);
  const state = newState();
  const [line] = await drawTable(self, deps([self]), {state});
  assert.match(line.text, /@Table\[Self\]/);
  assert.equal(state.problems[0].kind, "cycle");
  const t = table("T", [{name: "x @Table[Nowhere]"}]);
  const state2 = newState();
  await drawTable(t, deps([t]), {state: state2});
  assert.equal(state2.problems[0].kind, "missing");
});

test("a missing item stays visible as text and is reported", async () => {
  const t = table("T", [{type: "document", documentUuid: "Item.gone", name: "Old rope"}]);
  const state = newState();
  const [line] = await drawTable(t, deps([t]), {state});
  assert.equal(line.kind, "text");
  assert.equal(line.text, "Old rope");
  assert.equal(state.problems[0].kind, "missing");
});

test("distinct draws never repeat a result in one roll and stop when the table runs out", async () => {
  const t = table("T", [{name: "a"}, {name: "b"}, {name: "c"}], {distinct: true});
  const d = deps([t], {rolls: [1, 1, 2, 2, 3]});
  const state = newState();
  const lines = await drawTable(t, d, {times: 5, state});
  assert.deepEqual(lines.map(l => l.text), ["a", "b", "c"]);
  assert.equal(state.ranOut, true);
});

test("drawn results are not rolled again", async () => {
  const t = table("T", [{name: "a", drawn: true}, {name: "b"}]);
  const d = deps([t], {rolls: [1, 1, 2]});
  const [line] = await drawTable(t, d);
  assert.equal(line.text, "b");
});

test("an empty table reports itself", async () => {
  const t = table("T", [{name: "a", drawn: true}]);
  const state = newState();
  const lines = await drawTable(t, deps([t]), {state});
  assert.deepEqual(lines, []);
  assert.equal(state.problems[0].kind, "empty");
});

test("tables without replacement mark their picks, compendium tables do not", async () => {
  const t = table("T", [{name: "a"}, {name: "b"}], {replacement: false});
  const lines = await drawTable(t, deps([t], {rolls: [2]}));
  assert.deepEqual([...drawnMarks(lines)], [["T", ["T-1"]]]);
  const p = table("P", [{name: "a"}], {replacement: false, pack: true});
  const more = await drawTable(p, deps([p]));
  assert.equal(drawnMarks(more).size, 0);
});

test("excludeFromLines lets one line be drawn again without the others", async () => {
  const t = table("T", [{name: "a"}, {name: "b"}, {name: "c"}], {distinct: true});
  const lines = await drawTable(t, deps([t], {rolls: [1, 2]}), {times: 2});
  const exclude = excludeFromLines([lines[0]]);
  assert.deepEqual([...exclude.get("T")], ["T-0"]);
});

test("the number of lines is capped", async () => {
  const t = table("T", [{name: "a", quantity: "100"}], {formula: "1d1"});
  const state = newState();
  const lines = await drawTable(t, deps([t]), {times: 100, state});
  assert.ok(lines.length <= MAX_LINES + 100);
  assert.ok(state.count <= MAX_LINES);
});

test("rolls of a draw are collected for the chat message", async () => {
  const t = table("T", [{type: "document", documentUuid: "Item.a", quantity: "1d4"}]);
  const d = deps([t], {docs: {"Item.a": {uuid: "Item.a", documentName: "Item", name: "Rope"}}});
  const [line] = await drawTable(t, d);
  assert.equal(line.rolls.length, 2);
});

test("coin texts: formulas, several coins, abbreviations, and texts that are not coins", () => {
  const coins = [{key: "gp", abbr: "GM"}, {key: "sp", abbr: "SM"}];
  assert.deepEqual(parseCoinText("3d6 gp", coins), [{formula: "3d6", key: "gp"}]);
  assert.deepEqual(parseCoinText("2d4 × 10 gp, 5 sp", coins), [{formula: "2d4*10", key: "gp"}, {formula: "5", key: "sp"}]);
  assert.deepEqual(parseCoinText("50 GM", coins), [{formula: "50", key: "gp"}]);
  assert.equal(parseCoinText("3 goblins", coins), null);
  assert.equal(parseCoinText("a pouch with 3 gp", coins), null);
  assert.equal(parseCoinText("", coins), null);
});

test("a plain number as quantity is not rolled", async () => {
  const never = async () => { throw new Error("rolled"); };
  assert.equal(await resolveQuantity("3", never), 3);
  assert.equal(await resolveQuantity("", never), 1);
  assert.equal(await resolveQuantity("0", never), 0);
  assert.equal(await resolveQuantity("2d4", async () => 5), 5);
  assert.equal(await resolveQuantity("x", never), null);
});

test("a result of a table with several matching ranges gives every match", async () => {
  const t = table("T", [{name: "a", range: [1, 3]}, {name: "b", range: [3, 4]}], {formula: "1d4"});
  const lines = await drawTable(t, deps([t], {rolls: [3]}));
  assert.deepEqual(lines.map(l => l.text).sort(), ["a", "b"]);
});

test("a table without a formula draws by weight", async () => {
  const t = table("T", [{name: "a", weight: 1}, {name: "b", weight: 9}], {formula: ""});
  const lines = await drawTable(t, deps([t], {rolls: [10]}));
  assert.equal(lines[0].text, "b");
});
