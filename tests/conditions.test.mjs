import assert from "node:assert/strict";
import test from "node:test";
import {DEFAULT_HOURS, addMissingTags, check, cleanHours, conditionsOf, hourOf, normalizeConditions, normalizeTags,
  onEmptyOf, partyLevel, periodOf, readLevel, tagId, tagMap} from "../scripts/conditions.mjs";
import {drawTable, newState, parseCoinText, pick} from "../scripts/draw.mjs";

const NOW = {sceneId: "S1", regions: ["forest"], period: "night", level: 4, tags: {war: true}};

/** A table snapshot, rows may carry conditions. */
function table(uuid, results, extra = {}) {
  return {uuid, name: uuid, formula: `1d${results.length}`, replacement: true, pack: false, distinct: false, draws: "1",
    mode: "foundry", ...extra,
    results: results.map((r, i) => ({id: `${uuid}-${i}`, type: "text", name: `row${i}`, img: "", description: "",
      documentUuid: null, range: [i + 1, i + 1], weight: 1, drawn: false, quantity: "", ...r}))};
}

/** Dependencies: the roller returns the next scripted value, then keeps cycling through 1..n. */
function deps(tables, rolls = []) {
  const queue = [...rolls];
  const byId = new Map(tables.map(t => [t.uuid, t]));
  let counter = 0;
  return {
    roll: async formula => {
      const sides = Number(/d(\d+)/.exec(formula)?.[1] ?? 1);
      const total = queue.length ? queue.shift() : ((counter++ % sides) + 1);
      return {total, roll: {formula, total}};
    },
    evaluate: async formula => ({total: Number(formula) || 1, roll: {formula}}),
    loadDoc: async uuid => (byId.has(uuid) ? {uuid, documentName: "RollTable", name: byId.get(uuid).name, img: ""} : null),
    loadTable: async uuid => byId.get(uuid) ?? null,
    findTable: async ref => byId.get(ref) ?? null,
    coinParts: text => parseCoinText(text, [{key: "gp", abbr: "gp"}]),
    coinLabel: key => key,
    newId: (() => { let n = 0; return () => `L${++n}`; })()
  };
}

test("conditions are made clean and empty ones vanish", () => {
  assert.equal(normalizeConditions(null), null);
  assert.equal(normalizeConditions({scenes: [], regions: [" "], times: ["noon"], tags: {}}), null);
  assert.deepEqual(normalizeConditions({scenes: ["a", "a", "b"], regions: [" Forest "], times: ["night", "noon"],
    level: {min: "5", max: "3"}, tags: {war: true, peace: false, bad: "yes"}}),
  {scenes: ["a", "b"], regions: ["Forest"], times: ["night"], level: {min: 3, max: 5}, tags: {war: true, peace: false}});
  assert.deepEqual(normalizeConditions({level: {min: "", max: 7}}), {level: {min: null, max: 7}});
});

test("conditions are read from the flags of a result", () => {
  const get = flags => path => path.split(".").reduce((o, k) => o?.[k], flags);
  assert.deepEqual(conditionsOf(get({"sephrals-deep-tables": {conditions: {times: ["day"]}}})), {times: ["day"]});
  assert.equal(conditionsOf(get({})), null);
});

test("what a table does with an empty draw", () => {
  assert.equal(onEmptyOf("ignore"), "ignore");
  assert.equal(onEmptyOf("reroll"), "reroll");
  assert.equal(onEmptyOf("nonsense"), "report");
  assert.equal(onEmptyOf(undefined), "report");
});

test("the part of the day follows the hours, around midnight too", () => {
  assert.equal(periodOf(12), "day");
  assert.equal(periodOf(5), "dawn");
  assert.equal(periodOf(7.99), "dawn");
  assert.equal(periodOf(8), "day");
  assert.equal(periodOf(18), "dusk");
  assert.equal(periodOf(21), "night");
  assert.equal(periodOf(0), "night");
  assert.equal(periodOf(4.5), "night");
  assert.equal(periodOf(23.9), "night");
  // Own hours: a late dawn and a short night
  const hours = {dawn: 6, day: 9, dusk: 17, night: 22};
  assert.equal(periodOf(8, hours), "dawn");
  assert.equal(periodOf(5, hours), "night");
  assert.equal(periodOf(17.5, hours), "dusk");
});

test("broken hours are repaired", () => {
  assert.deepEqual(cleanHours({dawn: "x", day: 30, dusk: -1}), DEFAULT_HOURS);
  assert.equal(cleanHours({dawn: 4.5}).dawn, 4.5);
});

test("the hour comes from the calendar components or the world time", () => {
  assert.equal(hourOf({hour: 14, minute: 30}, 0), 14.5);
  assert.equal(hourOf(null, 3600 * 5), 5);
  assert.equal(hourOf({}, 86400 + 7200), 2);
  assert.equal(hourOf(undefined, -3600), 23);
});

test("levels are read per game system", () => {
  assert.equal(readLevel("dnd5e", {details: {level: 5}}), 5);
  assert.equal(readLevel("dnd5e", {details: {}}), null);
  assert.equal(readLevel("pf2e", {details: {level: {value: 3}}}), 3);
  assert.equal(readLevel("crucible", {advancement: {level: 7}}), 7);
  assert.equal(readLevel("swade", {advances: {value: 0}}), 1);
  assert.equal(readLevel("swade", {advances: {value: 4}}), 2);
  assert.equal(readLevel("swade", {advances: {value: 17}}), 5);
  assert.equal(readLevel("swade", {advances: {rank: "Veteran"}}), 3);
  assert.equal(readLevel("other", {details: {level: {value: 2}}}), 2);
  assert.equal(readLevel("other", {level: 6}), 6);
  assert.equal(readLevel("other", {}), null);
  assert.equal(readLevel("other", null), null);
});

test("the party level is the rounded average", () => {
  assert.equal(partyLevel([3, 4, 4]), 4);
  assert.equal(partyLevel([1, null, 2]), 2);
  assert.equal(partyLevel([]), null);
  assert.equal(partyLevel([null]), null);
});

test("a row without conditions always holds", () => {
  assert.deepEqual(check(null, NOW), {ok: true, reasons: []});
  assert.deepEqual(check({}, null), {ok: true, reasons: []});
});

test("every kind of condition is checked and gives its reason", () => {
  assert.equal(check({scenes: ["S1", "S2"]}, NOW).ok, true);
  assert.deepEqual(check({scenes: ["S9"]}, NOW).reasons, [{kind: "scene", ids: ["S9"]}]);
  assert.equal(check({regions: ["Forest"]}, NOW).ok, true);
  assert.equal(check({regions: ["Market", "forest"]}, NOW).ok, true);
  assert.deepEqual(check({regions: ["Market"]}, NOW).reasons, [{kind: "region", names: ["Market"], unknown: false}]);
  assert.equal(check({regions: ["Market"]}, {...NOW, regions: null}).reasons[0].unknown, true);
  assert.equal(check({times: ["night", "dusk"]}, NOW).ok, true);
  assert.deepEqual(check({times: ["day"]}, NOW).reasons, [{kind: "time", periods: ["day"], now: "night"}]);
  assert.equal(check({level: {min: 3, max: 5}}, NOW).ok, true);
  assert.equal(check({level: {min: 5, max: null}}, NOW).ok, false);
  assert.equal(check({level: {min: null, max: 3}}, NOW).ok, false);
  assert.equal(check({level: {min: 1, max: 1}}, {...NOW, level: null}).reasons[0].level, null);
  assert.equal(check({level: {min: 9, max: 9}}, {...NOW, levelOff: true}).ok, true);
  assert.equal(check({tags: {war: true}}, NOW).ok, true);
  assert.equal(check({tags: {war: false}}, NOW).ok, false);
  assert.equal(check({tags: {peace: false}}, NOW).ok, true);
  assert.deepEqual(check({tags: {peace: true}}, NOW).reasons, [{kind: "tag", id: "peace", want: true}]);
});

test("all conditions of a row have to hold, and all failing ones are named", () => {
  const verdict = check({scenes: ["S9"], times: ["day"], tags: {war: true}}, NOW);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons.map(r => r.kind), ["scene", "time"]);
});

test("story tags are cleaned, named and mapped", () => {
  const tags = normalizeTags([{id: "war", name: "War", on: true}, {id: "war", name: "Again"}, {id: "", name: "x"},
    {id: "peace", name: " Peace ", on: "yes"}, null]);
  assert.deepEqual(tags, [{id: "war", name: "War", on: true}, {id: "peace", name: "Peace", on: false}]);
  assert.deepEqual(tagMap(tags), {war: true});
  assert.equal(tagId("The harbor is closed", []), "the-harbor-is-closed");
  assert.equal(tagId("War", ["war"]), "war-2");
  assert.equal(tagId("Krieg beginnt, Äpfel", []), "krieg-beginnt-apfel");
  assert.equal(tagId("!!!", []), "tag");
  assert.deepEqual(addMissingTags([{id: "war", name: "War", on: true}], [{id: "war", name: "x"}, {id: "fest", name: "Fest"}]),
    [{id: "war", name: "War", on: true}, {id: "fest", name: "Fest", on: false}]);
});

/* -------------------------------------------- */
/*  The draw                                    */
/* -------------------------------------------- */

test("rows whose conditions fail are left out of the draw and listed with the reason", async () => {
  const t = table("T", [{name: "day only", conditions: {times: ["day"]}}, {name: "night only", conditions: {times: ["night"]}},
    {name: "always"}]);
  const state = newState({situation: NOW});
  const names = new Set();
  const d = deps([t]);
  for ( let i = 0; i < 30; i++ ) {
    const lines = await drawTable(t, d, {state});
    for ( const line of lines ) names.add(line.name);
  }
  assert.deepEqual([...names].sort(), ["always", "night only"]);
  assert.equal(state.left.length, 1);
  assert.equal(state.left[0].name, "day only");
  assert.equal(state.left[0].reasons[0].kind, "time");
});

test("without a situation nothing is left out", async () => {
  const t = table("T", [{name: "a", conditions: {times: ["day"]}}]);
  const state = newState();
  const lines = await drawTable(t, deps([t]), {state});
  assert.equal(lines.length, 1);
  assert.equal(state.left.length, 0);
});

test("the table formula rolls again when it lands on a row that is left out", async () => {
  const t = table("T", [{name: "gone", conditions: {tags: {war: false}}}, {name: "here"}]);
  const state = newState({situation: NOW});
  const lines = await drawTable(t, deps([t], [1, 1, 2]), {state});
  assert.deepEqual(lines.map(l => l.name), ["here"]);
});

test("pick reports conditions when everything is left out", async () => {
  const t = table("T", [{conditions: {times: ["day"]}}, {conditions: {times: ["dawn"]}}]);
  const got = await pick(t, deps([t]), new Set(), newState({situation: NOW}));
  assert.equal(got.reason, "conditions");
  assert.equal(got.left.length, 2);
});

test("an empty draw is reported by default", async () => {
  const t = table("T", [{conditions: {times: ["day"]}}]);
  const state = newState({situation: NOW});
  const lines = await drawTable(t, deps([t]), {state});
  assert.equal(lines.length, 0);
  assert.deepEqual(state.problems.map(p => p.kind), ["conditions"]);
});

test("a table can ignore its conditions when nothing fits", async () => {
  const t = table("T", [{name: "a", conditions: {times: ["day"]}}], {onEmpty: "ignore"});
  const state = newState({situation: NOW});
  const lines = await drawTable(t, deps([t]), {state});
  assert.deepEqual(lines.map(l => l.name), ["a"]);
  assert.deepEqual(state.problems.map(p => p.kind), ["conditionsIgnored"]);
});

test("a table that hands back lets the table above pick another row", async () => {
  const inner = table("Inner", [{conditions: {times: ["day"]}}], {onEmpty: "reroll"});
  const outer = table("Outer", [{type: "document", documentUuid: "Inner", name: "inner"}, {name: "plain"}]);
  const state = newState({situation: NOW});
  const lines = await drawTable(outer, deps([outer, inner], [1, 2]), {state});
  assert.deepEqual(lines.map(l => l.name), ["plain"]);
  assert.deepEqual(state.problems, []);
});

test("without handing back an empty table inside another one is reported", async () => {
  const inner = table("Inner", [{conditions: {times: ["day"]}}]);
  const outer = table("Outer", [{type: "document", documentUuid: "Inner", name: "inner"}]);
  const state = newState({situation: NOW});
  const lines = await drawTable(outer, deps([outer, inner]), {state});
  assert.equal(lines.length, 0);
  assert.deepEqual(state.problems.map(p => p.kind), ["conditions"]);
});

test("handing back with nothing above to pick reports at the top", async () => {
  const inner = table("Inner", [{conditions: {times: ["day"]}}], {onEmpty: "reroll"});
  const outer = table("Outer", [{type: "document", documentUuid: "Inner", name: "inner"}]);
  const state = newState({situation: NOW});
  const lines = await drawTable(outer, deps([outer, inner]), {state});
  assert.equal(lines.length, 0);
  assert.deepEqual(state.problems.map(p => p.kind), ["conditions"]);
  assert.equal(state.problems[0].table, "Outer");
});

test("a table drawn from a text with a handing back table reports instead", async () => {
  const inner = table("Inner", [{conditions: {times: ["day"]}}], {onEmpty: "reroll"});
  const outer = table("Outer", [{name: "x @Table[Inner] y"}]);
  const state = newState({situation: NOW});
  const lines = await drawTable(outer, deps([outer, inner]), {state});
  assert.equal(lines.length, 1);
  assert.deepEqual(state.problems.map(p => p.kind), ["conditions"]);
  assert.equal(state.handBack, false);
});
