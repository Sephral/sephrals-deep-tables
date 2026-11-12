/**
 * Deep Tables' part of the debug file of Sephral's modules. Fill describeState with what helps a bug report, without
 * personal texts.
 */

import {MODULE_ID, isActive, setting, t} from "./config.mjs";
import {purseKind} from "./coins.mjs";
import {DebugTrace, registerDebugMenu, registerDebugProvider} from "./debug-file.mjs";

/** The recent decisions of the module. */
export const trace = new DebugTrace();

/**
 * What the module knows right now.
 * @returns {object}
 */
export function describeState() {
  const tables = game.tables?.contents ?? [];
  const own = tables.filter(table => table.flags?.[MODULE_ID] && Object.keys(table.flags[MODULE_ID]).length).length;
  const older = tables.filter(table => table.flags?.["better-rolltables"] && Object.keys(table.flags["better-rolltables"]).length).length;
  const ownResults = tables.reduce((n, table) => n + table.results.filter(r => r.flags?.[MODULE_ID]?.quantity).length, 0);
  return {
    tables: tables.length,
    tablesWithOwnSettings: own,
    resultsWithQuantity: ownResults,
    tablesWithOlderFlags: older,
    purse: purseKind(),
    modules: {itemPiles: isActive("item-piles"), lootLedger: isActive("sephrals-loot-ledger"),
      olderTables: isActive("better-rolltables")},
    settings: {theme: setting("theme"), showChances: setting("showChances"), maxDepth: setting("maxDepth"),
      language: setting("uiLanguage")},
    chatSetting: game.settings.settings.has("core.messageMode") ? "messageMode" : "rollMode",
    openWindows: [...foundry.applications.instances.values()].filter(app => app.id?.startsWith("sdt-")).map(app => app.id)
  };
}

/**
 * The button in the settings and the module's part of the file. Call in "init".
 */
export function registerDebug() {
  registerDebugMenu(MODULE_ID, {name: "SDT.DEBUG.Title", label: "SDT.DEBUG.Save", hint: "SDT.DEBUG.Hint"});
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => t("SDT.DEBUG.Entry"),
    notice: file => t("SDT.DEBUG.Saved", {file}),
    recent: () => ({details: describeState()}),
    trace
  });
}
