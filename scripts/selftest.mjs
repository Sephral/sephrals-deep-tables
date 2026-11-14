/**
 * Self test: what the module relies on in Foundry, its storage and its texts.
 */

import {MODULE_ID, TEMPLATES, TESTED_VERSIONS, esc, isActive, t} from "./config.mjs";
import {coinLabel, denominations, purseKind} from "./coins.mjs";
import {drawTable, parseCoinText} from "./draw.mjs";
import {makeDeps} from "./engine.mjs";
import {ACTION_TYPES, isComplete, normalizeAction, spreadCells} from "./actions.mjs";
import {applyMemory, counter} from "./memory.mjs";
import {checkRequest} from "./players.mjs";
import {PERIODS, check as checkConditions, periodOf, readLevel} from "./conditions.mjs";
import {checkLibrary} from "./library-app.mjs";
import {currentSituation} from "./situation.mjs";

/**
 * Run all checks.
 * @returns {Promise<{problems: string[], checks: number}>}
 */
async function checkAll() {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if ( !ok ) problems.push(game.i18n.has(key) ? t(key, data) : key);
  };
  check(typeof foundry.applications?.api?.DialogV2 === "function", "SDT.SELFTEST.Dialog");
  check(typeof RollTable.prototype.resetResults === "function", "SDT.SELFTEST.Tables");
  check(!!foundry.documents?.TableResult && (typeof foundry.applications?.sheets?.RollTableSheet === "function"), "SDT.SELFTEST.Sheet");
  check(Array.isArray(CONFIG.TextEditor?.enrichers)
    && (typeof foundry.applications?.ux?.TextEditor?.implementation?.enrichHTML === "function"), "SDT.SELFTEST.Enrichers");
  check(game.settings.settings.has("core.messageMode") || game.settings.settings.has("core.rollMode"), "SDT.SELFTEST.Chat");
  check(typeof ChatMessage.implementation?.create === "function" && typeof Roll === "function", "SDT.SELFTEST.Chat");
  let templates = true;
  try {
    await Promise.all(["deep-roll", "import", "action", "players", "conditions", "tags", "library"].map(name => foundry.applications.handlebars.getTemplate(`${TEMPLATES}/${name}.hbs`)));
  } catch {
    templates = false;
  }
  check(templates, "SDT.SELFTEST.Templates");
  let engine = false;
  try {
    const snapshot = {uuid: "selftest", name: "Self test", formula: "1d1", replacement: true, pack: false, distinct: false,
      draws: "1", mode: "foundry", results: [{id: "a", type: "text", name: "3 gp", img: "", description: "[[1d1]]",
        documentUuid: null, range: [1, 1], weight: 1, drawn: false, quantity: ""}]};
    const lines = await drawTable(snapshot, makeDeps(), {});
    engine = lines.length === 1;
  } catch {
    engine = false;
  }
  check(engine, "SDT.SELFTEST.Engine");
  // The new parts: memory, actions, the list for players
  const remembered = applyMemory([{id: "a", drawn: false}, {id: "b", drawn: false}], {memory: true, used: ["a"]});
  check(remembered[0].drawn && !remembered[1].drawn && (counter(remembered, {memory: true, used: ["a"]}, true).used === 1),
    "SDT.SELFTEST.Memory");
  const action = normalizeAction({type: "tokens", ref: "Goblin", count: "1d4"});
  check(!!action && isComplete(action) && (spreadCells(3).length === 3) && (ACTION_TYPES.length === 6), "SDT.SELFTEST.Actions");
  check(checkRequest({uuid: "x"}, {players: true, pack: false, mode: "gm"}).mode === "gm"
    && !!game.socket && (typeof game.socket.emit === "function") && Array.isArray(game.settings.get(MODULE_ID, "playerTables")),
    "SDT.SELFTEST.Players");
  // Rows with conditions: the situation of the world and the check
  let conditions = false;
  try {
    const now = currentSituation();
    conditions = (typeof now.period === "string") && (typeof now.tags === "object") && (typeof game.time?.worldTime === "number")
      && checkConditions({times: [now.period]}, now).ok
      && !checkConditions({times: [PERIODS.find(period => period !== now.period)]}, now).ok
      && (periodOf(12) === "day") && (readLevel("dnd5e", {details: {level: 3}}) === 3)
      && Array.isArray(game.settings.get(MODULE_ID, "storyTags"));
  } catch {
    conditions = false;
  }
  check(conditions, "SDT.SELFTEST.Conditions");
  const libraryProblems = await checkLibrary();
  check(!libraryProblems.length, "SDT.SELFTEST.Library", {problems: libraryProblems.slice(0, 3).join(", ")});
  check((typeof Actor.prototype.getTokenDocument === "function") && (typeof Actor.prototype.toggleStatusEffect === "function")
    && (typeof foundry.audio?.AudioHelper?.play === "function"), "SDT.SELFTEST.Placing");
  if ( isActive("sephrals-saved-encounters") ) {
    const api = game.modules.get("sephrals-saved-encounters").api;
    check((typeof api?.place === "function") && (typeof api?.encounters === "function"), "SDT.SELFTEST.Encounters");
  }
  if ( purseKind() ) {
    check(denominations().length > 0 && !!parseCoinText(`1 ${coinLabel(denominations()[0].key)}`, denominations()), "SDT.SELFTEST.Coins");
  }
  if ( isActive("item-piles") ) {
    const api = game.itempiles?.API;
    check(["createItemPile", "addItems", "addCurrencies"].every(name => typeof api?.[name] === "function"), "SDT.SELFTEST.Piles");
  }
  if ( isActive("sephrals-loot-ledger") ) {
    const api = game.modules.get("sephrals-loot-ledger").api;
    check((typeof api?.request === "function") && (typeof api?.adapter === "function"), "SDT.SELFTEST.Ledger");
  }
  const keys = ["SDT.gear", "SDT.SELFTEST.Title", "SDT.Deep.post", "SDT.Card.give", "SDT.Import.create", "SDT.Action.save",
    "SDT.Memory.counter", "SDT.Players.title"];
  const missing = keys.filter(key => !game.i18n.has(key));
  check(!missing.length, "SDT.SELFTEST.Texts", {keys: missing.join(", ")});
  return {problems, checks};
}

/**
 * Run the self test and report the result.
 * @param {object} [options]
 * @param {boolean} [options.report=true]
 * @returns {Promise<{problems: string[], checks: number}>}
 */
export async function runSelfTest({report = true} = {}) {
  const {problems, checks} = await checkAll();
  const summary = problems.length ? t("SDT.SELFTEST.Problems", {problems: problems.length, checks})
    : t("SDT.SELFTEST.Passed", {checks});
  if ( problems.length ) ui.notifications.warn(summary, {permanent: true});
  else ui.notifications.info(summary);
  if ( report ) {
    const versions = t("SDT.SELFTEST.Version", {current: game.version, tested: TESTED_VERSIONS.core});
    let content = `<h3>${esc(t("SDT.SELFTEST.Title"))}</h3><p>${esc(summary)}</p><p><small>${esc(versions)}</small></p>`;
    if ( problems.length ) content += `<ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
    await ChatMessage.implementation.create({content, whisper: [game.user.id],
      speaker: {alias: game.modules.get(MODULE_ID).title}});
  }
  return {problems, checks};
}

/**
 * Tell the GM once when Foundry is newer than the version the module was verified against.
 */
export function noticeNewVersions() {
  if ( !game.user.isGM ) return;
  if ( !foundry.utils.isNewerVersion(game.version, TESTED_VERSIONS.core) ) return;
  const signature = `core ${game.version}`;
  if ( game.settings.get(MODULE_ID, "acknowledgedVersions") === signature ) return;
  game.settings.set(MODULE_ID, "acknowledgedVersions", signature);
  ui.notifications.info(t("SDT.SELFTEST.NewVersions", {versions: signature}), {permanent: true});
}
