import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {drawTable, newState, parseCoinText} from "../scripts/draw.mjs";
import {GROUPS, LIB_LANGUAGES, dependencies, formulaOf, linkText, neededTags, planImport, previewText, rowsOf, tableData,
  validateLibrary} from "../scripts/library.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The content of every language, as the library window loads it. */
const content = {};
for ( const lang of LIB_LANGUAGES ) {
  content[lang] = [];
  for ( const group of GROUPS ) {
    const text = await readFile(path.join(root, "lang", "library", lang, `${group.id}.json`), "utf8");
    content[lang].push({...JSON.parse(text), id: group.id});
  }
}
const tablesOf = lang => new Map(content[lang].flatMap(group => group.tables.map(table => [table.key, {...table, group: group.id}])));

test("rows get ranges by weight and the formula covers them", () => {
  const table = {rows: ["a", {text: "b", weight: 3}, {table: "x", quantity: "1d4"}]};
  const rows = rowsOf(table);
  assert.deepEqual(rows.map(r => r.range), [[1, 1], [2, 4], [5, 5]]);
  assert.equal(formulaOf(table), "1d5");
  assert.equal(rows[2].quantity, "1d4");
  assert.equal(formulaOf({rows: []}), "1d1");
});

test("dependencies come from the rows and from the texts", () => {
  const table = {rows: [{table: "a"}, "Meet {{b}} and {{c}}", {text: "x", note: "see {{d}}"}, "{{b}} again"]};
  assert.deepEqual(dependencies(table).sort(), ["a", "b", "c", "d"]);
});

test("links in a text become draws from the new tables", () => {
  const known = new Map([["a", {id: "ID1", name: "First [one]"}]]);
  assert.equal(linkText("Meet {{a}} and {{zz}}", known), "Meet @Table[RollTable.ID1]{First one} and {{zz}}");
  assert.equal(previewText("Meet {{a}}", new Map([["a", {name: "First"}]])), "Meet [First]");
});

test("the import plan makes the building blocks first and skips what is in the world", () => {
  const tables = new Map([
    ["top", {key: "top", rows: [{table: "mid"}]}],
    ["mid", {key: "mid", rows: ["{{leaf}}"]}],
    ["leaf", {key: "leaf", rows: ["x"]}],
    ["other", {key: "other", rows: ["y"]}]
  ]);
  const plan = planImport({tables, selected: ["top"]});
  assert.deepEqual(plan.create, ["leaf", "mid", "top"]);
  assert.deepEqual(plan.added, ["leaf", "mid"]);
  const again = planImport({tables, selected: ["top", "other"], existing: new Map([["top", "RollTable.t"]])});
  assert.deepEqual(again.create, ["other"]);
  assert.deepEqual(again.skipped, ["top"]);
  const reuse = planImport({tables, selected: ["top"], existing: new Map([["leaf", "RollTable.l"]])});
  assert.deepEqual(reuse.create, ["mid", "top"]);
  assert.equal(reuse.reuse.get("leaf"), "RollTable.l");
  assert.deepEqual(planImport({tables, selected: ["nope"]}).missing, ["nope"]);
});

test("a table becomes creation data with links, quantities and conditions", () => {
  const table = {key: "t", name: "T", description: "Fine <b>", rows: [
    {table: "inner", quantity: "1d3", weight: 2},
    {text: "Night: {{inner}}", conditions: {times: ["night"], tags: {war: true}}}
  ]};
  const known = new Map([["inner", {id: "IN", name: "Inner"}], ["t", {id: "TT", name: "T"}]]);
  const data = tableData(table, {id: "TT", known, lang: "en", folder: "F1"});
  assert.equal(data._id, "TT");
  assert.equal(data.formula, "1d3");
  assert.equal(data.folder, "F1");
  assert.equal(data.description, "<p>Fine &lt;b&gt;</p>");
  assert.deepEqual(data.flags["sephrals-deep-tables"].library, {key: "t", lang: "en", v: 1});
  const [first, second] = data.results;
  assert.equal(first.type, "document");
  assert.equal(first.documentUuid, "RollTable.IN");
  assert.deepEqual(first.range, [1, 2]);
  assert.deepEqual(first.flags, {"sephrals-deep-tables": {quantity: "1d3"}});
  assert.equal(second.type, "text");
  assert.equal(second.name, "Night: @Table[RollTable.IN]{Inner}");
  assert.deepEqual(second.flags["sephrals-deep-tables"].conditions, {times: ["night"], tags: {war: true}});
});

test("the tags a table asks for are collected with the names of the library", () => {
  const tables = [{rows: [{text: "a", conditions: {tags: {war: true}}}, {text: "b", conditions: {tags: {fest: false}}}]}];
  assert.deepEqual(neededTags(tables, [{id: "war", name: "War"}]), [{id: "war", name: "War"}, {id: "fest", name: "fest"}]);
});

for ( const lang of LIB_LANGUAGES ) {
  test(`the ${lang} content is sound: keys, links, circles, tags and punctuation`, () => {
    assert.deepEqual(validateLibrary(content[lang]), []);
  });
}

test("English and German have the same tables with the same shape", () => {
  const en = tablesOf("en");
  const de = tablesOf("de");
  assert.deepEqual([...de.keys()].sort(), [...en.keys()].sort());
  for ( const [key, table] of en ) {
    const other = de.get(key);
    assert.equal(!!other.part, !!table.part, `${key}: building block`);
    assert.equal(other.group, table.group, `${key}: group`);
    assert.equal(other.rows.length, table.rows.length, `${key}: number of rows`);
    assert.deepEqual(rowsOf(other).map(r => [r.weight, r.quantity, r.table, r.conditions]),
      rowsOf(table).map(r => [r.weight, r.quantity, r.table, r.conditions]), `${key}: weights, quantities, links, conditions`);
    assert.deepEqual(dependencies(other).sort(), dependencies(table).sort(), `${key}: dependencies`);
  }
  for ( const [index, group] of content.en.entries() ) {
    assert.deepEqual((content.de[index].tags ?? []).map(tag => tag.id), (group.tags ?? []).map(tag => tag.id));
  }
});

test("the library has enough to be useful from the first minute", () => {
  for ( const lang of LIB_LANGUAGES ) {
    const tables = [...tablesOf(lang).values()];
    const mains = tables.filter(table => !table.part);
    assert.ok(mains.length >= 30, `${lang}: ${mains.length} tables`);
    assert.ok(tables.some(table => rowsOf(table).some(row => row.table)), "tables inside tables");
    assert.ok(tables.some(table => rowsOf(table).some(row => row.quantity)), "quantity formulas");
    assert.ok(tables.some(table => rowsOf(table).some(row => /\{\{/.test(row.text))), "table draws in texts");
    assert.ok(tables.some(table => rowsOf(table).some(row => row.conditions)), "rows with conditions");
    assert.ok(tables.some(table => rowsOf(table).some(row => parseCoinText(row.text, [{key: "gp"}, {key: "sp"}, {key: "cp"}]))), "coin texts");
  }
});

test("a bundled table with tables inside tables really draws through the engine", async () => {
  const tables = tablesOf("en");
  const ids = new Map([...tables.keys()].map(key => [key, {id: `ID_${key}`, name: tables.get(key).name}]));
  const made = new Map([...tables].map(([key, table]) => {
    const data = tableData(table, {id: ids.get(key).id, known: ids, lang: "en"});
    return [`RollTable.${data._id}`, {uuid: `RollTable.${data._id}`, name: data.name, formula: data.formula, replacement: true,
      pack: false, distinct: false, draws: "1", mode: "foundry",
      results: data.results.map((r, i) => ({id: `${data._id}_${i}`, ...r, img: r.img ?? "", description: r.description ?? "",
        documentUuid: r.documentUuid ?? null, quantity: r.flags?.["sephrals-deep-tables"]?.quantity ?? "",
        conditions: r.flags?.["sephrals-deep-tables"]?.conditions ?? null}))}];
  }));
  let n = 0;
  let spin = 0;
  const deps = {
    roll: async formula => {
      const sides = Number(/d(\d+)/.exec(formula)?.[1] ?? 1);
      return {total: (spin++ % sides) + 1, roll: {formula}};
    },
    evaluate: async formula => ({total: 2, roll: {formula}}),
    loadDoc: async uuid => (made.has(uuid) ? {uuid, documentName: "RollTable", name: made.get(uuid).name, img: ""} : null),
    loadTable: async uuid => made.get(uuid) ?? null,
    findTable: async ref => made.get(ref) ?? null,
    coinParts: text => parseCoinText(text, [{key: "gp"}, {key: "sp"}, {key: "cp"}]),
    coinLabel: key => key,
    newId: () => `L${++n}`
  };
  const situation = {sceneId: null, regions: null, period: "day", level: null, tags: {}};
  for ( const key of ["name-any", "tavern-crowd", "npc-quick", "shop-type", "finds-small", "rumor-told", "travel-any"] ) {
    for ( let i = 0; i < 6; i++ ) {
      const state = newState({situation});
      const lines = await drawTable(made.get(`RollTable.ID_${key}`), deps, {state});
      assert.ok(lines.length > 0, `${key} gave nothing`);
      assert.deepEqual(state.problems, [], `${key}: ${JSON.stringify(state.problems)}`);
      for ( const line of lines ) assert.ok(!/\{\{|@Table\[/.test(line.text ?? line.name ?? ""), `${key}: ${line.text}`);
    }
  }
});
