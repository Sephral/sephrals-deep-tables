import assert from "node:assert/strict";
import test from "node:test";
import {ACTION_TYPES, normalizeAction} from "../scripts/actions.mjs";
import {normalizeConditions} from "../scripts/conditions.mjs";
import {PROBLEM_KINDS, sampleActionFlags, sampleCard, sampleConditions, sampleImportText, sampleLines, sampleRoll, sampleTableData,
  sampleTags} from "../scripts/sample-data.mjs";
import {parseTableText} from "../scripts/parse-text.mjs";

const TEXTS = {"SDT.Sample.table.importName": "Bandit loot", "SDT.Sample.table.dagger": "Rusty dagger", "SDT.Sample.table.healing": "Healing potion", "SDT.Sample.table.map": "A map", "SDT.Sample.table.coins": "2d6 gp", "SDT.Sample.table.pelt": "Wolf pelt", "SDT.Sample.table.howl": "A howl"};
const tx = key => TEXTS[key] ?? key;

test("the sample table has unique ids and ranges that cover its formula", () => {
  const data = sampleTableData(tx);
  const ids = data.results.map(result => result._id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => id.length === 16), "ids have 16 characters");
  assert.equal(data._id.length, 16);
  assert.equal(data.results.at(-1).range[1], 10);
  assert.ok(data.flags["sephrals-deep-tables"].used.every(id => ids.includes(id)));
});

test("every kind of action has valid sample settings", () => {
  for ( const type of ACTION_TYPES ) {
    const action = normalizeAction(sampleActionFlags(type, tx).action);
    assert.equal(action?.type, type);
  }
});

test("the sample conditions are kept by the normalizer", () => {
  const rules = normalizeConditions(sampleConditions(tx, "abc"));
  assert.deepEqual(rules.scenes, ["abc"]);
  assert.ok(rules.times && rules.level && rules.tags && rules.regions);
});

test("sample lines point at rows of the table and keep their actions apart", () => {
  const ids = new Set(sampleTableData(tx).results.map(result => result._id));
  const lines = sampleLines(tx);
  assert.ok(lines.every(line => ids.has(line.resultId)));
  assert.ok(lines.some(line => !line.include));
  assert.ok(lines.some(line => line.invalid));
  assert.ok(lines.some(line => line.depth === 1));
});

test("the card has a row for every action kind it shows and a run that matches a row", () => {
  const card = sampleCard(tx, {name: "Ari"});
  const keys = new Set(card.lines.map(line => line.key));
  assert.ok(card.runs.length && card.runs.every(run => keys.has(run.k)));
  assert.ok(card.lines.some(line => line.act?.auto));
  assert.ok(card.lines.some(line => line.kind === "coins"));
  assert.ok(!card.lines.some(line => line.invalid));
});

test("the roll shows rows left out, problems and the empty state", () => {
  const roll = sampleRoll(tx);
  assert.ok(roll.state.left.length && roll.state.problems.length && roll.state.situation);
  const empty = sampleRoll(tx, {empty: true});
  assert.equal(empty.lines.length, 0);
  assert.equal(empty.state.problems[0].kind, "empty");
});

test("the import text is read as a table with several rows", () => {
  const parsed = parseTableText(sampleImportText(tx));
  assert.equal(parsed.rows.length, 5);
  assert.equal(parsed.formula, "1d8");
  assert.equal(parsed.problems[0].kind, "gaps");
});

test("tags and problem kinds", () => {
  assert.ok(sampleTags(tx).some(tag => tag.on) && sampleTags(tx).some(tag => !tag.on));
  assert.equal(new Set(PROBLEM_KINDS).size, PROBLEM_KINDS.length);
});
