import assert from "node:assert/strict";
import test from "node:test";
import {parseTableText} from "../scripts/parse-text.mjs";

test("ranges with a header line", () => {
  const t = parseTableText("d20 Encounters\n1-4 Goblin\n5-10: Orc\n11. Dragon\n12 - 20 Nothing");
  assert.equal(t.name, "Encounters");
  assert.equal(t.formula, "1d20");
  assert.equal(t.mode, "ranges");
  assert.deepEqual(t.rows.map(r => [r.range, r.text]), [[[1, 4], "Goblin"], [[5, 10], "Orc"], [[11, 11], "Dragon"],
    [[12, 20], "Nothing"]]);
  assert.deepEqual(t.rows.map(r => r.weight), [4, 6, 1, 9]);
  assert.deepEqual(t.problems, []);
});

test("single numbers with a colon, dot or bracket", () => {
  const t = parseTableText("1: a\n2. b\n3) c\n4 - d");
  assert.deepEqual(t.rows.map(r => r.text), ["a", "b", "c", "d"]);
  assert.equal(t.formula, "1d4");
});

test("loose numbers count when the list is numbered", () => {
  const t = parseTableText("1: a\n2 b\n3 c");
  assert.equal(t.rows.length, 3);
});

test("a PDF line break continues the row before", () => {
  const t = parseTableText("1-2 A very long entry that\nbroke across lines\n3-4 Short");
  assert.equal(t.rows[0].text, "A very long entry that broke across lines");
  assert.equal(t.rows.length, 2);
});

test("a header with the formula last", () => {
  const t = parseTableText("Rumors (d6)\n1 a\n2: b\n3: c\n4: d\n5: e\n6: f");
  assert.equal(t.name, "Rumors");
  assert.equal(t.formula, "1d6");
  assert.equal(t.rows.length, 6);
});

test("a plain list has weight 1 and an even formula", () => {
  const t = parseTableText("Goblin\nOrc\n- Troll\n* Ogre");
  assert.equal(t.mode, "list");
  assert.equal(t.formula, "1d4");
  assert.deepEqual(t.rows.map(r => r.text), ["Goblin", "Orc", "Troll", "Ogre"]);
  assert.deepEqual(t.rows.map(r => r.range), [[1, 1], [2, 2], [3, 3], [4, 4]]);
});

test("a weighted list", () => {
  const t = parseTableText("Goblin | 3\nOrc | 1\nTroll");
  assert.deepEqual(t.rows.map(r => r.weight), [3, 1, 1]);
  assert.equal(t.formula, "1d5");
  assert.deepEqual(t.rows[0].range, [1, 3]);
  assert.deepEqual(t.rows[2].range, [5, 5]);
});

test("a name that starts with a number is still a list", () => {
  const t = parseTableText("Goblin\nOrc\n3 Ogres\nTroll");
  assert.equal(t.mode, "list");
  assert.equal(t.rows.length, 4);
});

test("gaps and overlaps are reported", () => {
  const t = parseTableText("1-3 a\n5-6 b\n6-8 c");
  const kinds = t.problems.map(p => p.kind);
  assert.ok(kinds.includes("gaps"));
  assert.ok(kinds.includes("overlaps"));
});

test("a header formula that is smaller than the rows is reported", () => {
  const t = parseTableText("d6 Things\n1-4 a\n5-8 b");
  assert.ok(t.problems.some(p => p.kind === "beyond"));
});

test("d100 tables end with 00", () => {
  const t = parseTableText("d100 Loot\n01-50 a\n51-99 b\n00 c");
  assert.deepEqual(t.rows.at(-1).range, [100, 100]);
  assert.deepEqual(t.problems, []);
});

test("an empty text is reported", () => {
  assert.deepEqual(parseTableText("  \n \n").problems, [{kind: "empty"}]);
});

test("windows line ends and en dashes", () => {
  const t = parseTableText("1–2 a\r\n3–4 b\r\n");
  assert.deepEqual(t.rows.map(r => r.range), [[1, 2], [3, 4]]);
});
