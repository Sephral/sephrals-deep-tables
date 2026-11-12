import assert from "node:assert/strict";
import test from "node:test";
import {chances, distribution, formatChance} from "../scripts/chances.mjs";
import {resultQuantity, tableSettings} from "../scripts/flags.mjs";
import {mergeLines} from "../scripts/merge.mjs";
import {foundryMode, resolveMode, visibility} from "../scripts/modes.mjs";

const get = flags => path => path.split(".").reduce((o, k) => o?.[k], flags);

test("chances of a d20 follow the ranges", () => {
  assert.deepEqual(chances("1d20", [[1, 5], [6, 20]]), [25, 75]);
});

test("chances of 2d6 are exact", () => {
  const dist = distribution("2d6");
  assert.equal(Math.round(dist.get(7) * 36), 6);
  const [low, seven, high] = chances("2d6", [[2, 6], [7, 7], [8, 12]]);
  assert.equal(seven, 16.7);
  assert.equal(low, 41.7);
  assert.equal(high, 41.7);
});

test("chances with a modifier and an unknown formula", () => {
  assert.deepEqual(chances("1d4+1", [[2, 3], [4, 5]]), [50, 50]);
  assert.deepEqual(chances("(1d4)*2", [[1, 2], [3, 8]]), [25, 75]);
  assert.equal(distribution("1d6 + @mod"), null);
});

test("chance texts", () => {
  assert.equal(formatChance(25), "25 %");
  assert.equal(formatChance(16.7), "16.7 %");
  assert.equal(formatChance(0.04), "<0.1 %");
});

test("merge adds equal items and texts and joins coins", () => {
  const lines = [
    {kind: "item", uuid: "I", name: "Rope", quantity: 2, include: true},
    {kind: "text", text: "Rain", name: "", include: true},
    {kind: "item", uuid: "I", name: "Rope", quantity: 3, include: true},
    {kind: "coins", coins: {gp: 5}, include: true},
    {kind: "text", text: "Rain", name: "", include: true},
    {kind: "coins", coins: {gp: 2, sp: 4}, include: true},
    {kind: "item", uuid: "J", name: "Gem", quantity: 1, include: false},
    {kind: "item", uuid: "K", name: "Zero", quantity: 0, include: true}
  ];
  const merged = mergeLines(lines);
  assert.deepEqual(merged.map(m => [m.kind, m.name || m.text, m.quantity]), [["item", "Rope", 5], ["text", "Rain", 2],
    ["coins", undefined, 0]]);
  assert.deepEqual(merged[2].coins, {gp: 7, sp: 4});
});

test("table settings read the module's flags first and an older table module as a fallback", () => {
  assert.deepEqual(tableSettings(get({})), {draws: "1", distinct: false, mode: "foundry"});
  assert.deepEqual(tableSettings(get({"better-rolltables": {"loot-amount-key": "1d4", "brt-distinct-result": true}})),
    {draws: "1d4", distinct: true, mode: "foundry"});
  assert.deepEqual(tableSettings(get({"sephrals-deep-tables": {draws: "2", distinct: false, mode: "gm"},
    "better-rolltables": {"loot-amount-key": "1d4", "brt-distinct-result": true}})),
  {draws: "2", distinct: false, mode: "gm"});
  assert.equal(tableSettings(get({"sephrals-deep-tables": {mode: "nonsense"}})).mode, "foundry");
});

test("result quantity: own, Loot Ledger, older table module (new and old), none for text", () => {
  assert.equal(resultQuantity(get({}), "document"), "");
  assert.equal(resultQuantity(get({"sephrals-deep-tables": {quantity: "2d4"}, "sephrals-loot-ledger": {quantity: "9"}}),
    "document"), "2d4");
  assert.equal(resultQuantity(get({"sephrals-loot-ledger": {quantity: "9"}}), "text"), "9");
  assert.equal(resultQuantity(get({"better-rolltables": {"brt-result-custom-quantity": "1d6"}}), "document"), "1d6");
  assert.equal(resultQuantity(get({"better-rolltables": {"brt-result-formula": {formula: "3"}}}), "document"), "3");
  assert.equal(resultQuantity(get({"better-rolltables": {"brt-result-custom-quantity": "1d6"}}), "text"), "");
  assert.equal(resultQuantity(get({"better-rolltables": {"brt-result-custom-quantity": 4}}), "document"), "4");
});

test("modes", () => {
  assert.equal(foundryMode("gmroll"), "gm");
  assert.equal(foundryMode("ic"), "public");
  assert.equal(resolveMode("foundry", "blindroll"), "blind");
  assert.equal(resolveMode("self", "publicroll"), "self");
  const users = {userId: "u", gmIds: ["g1", "g2"]};
  assert.deepEqual(visibility("public", users), {whisper: [], blind: false});
  assert.deepEqual(visibility("gm", users), {whisper: ["u", "g1", "g2"], blind: false});
  assert.deepEqual(visibility("blind", users), {whisper: ["g1", "g2"], blind: true});
  assert.deepEqual(visibility("self", users), {whisper: ["u"], blind: false});
  assert.deepEqual(visibility("gm", {userId: "g1", gmIds: ["g1", "g2"]}).whisper, ["g1", "g2"]);
});
