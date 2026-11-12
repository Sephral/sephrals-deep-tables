import {MODULE_ID, TESTED_VERSIONS, setting} from "./config.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {DeepRoll, openDeepRoll} from "./deep-app.mjs";
import {registerEnrichers} from "./enrichers.mjs";
import {resolveTable, rollTable, snapshotTable} from "./engine.mjs";
import {canRoll, drawNow, postRoll} from "./flow.mjs";
import {registerHubModule} from "./hub.mjs";
import {ImportApp, openImport} from "./import-app.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {mergeLines} from "./merge.mjs";
import {parseTableText} from "./parse-text.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {changeLanguage, registerSettings} from "./settings.mjs";
import {onGetHeaderControls, onGetRollTableContextOptions, onRenderRollTableDirectory, onRenderRollTableSheet,
  onRenderTableResultConfig} from "./sheet.mjs";
import {onRenderChatMessage} from "./toolbar.mjs";
import {registerUsage} from "./usage.mjs";

/** Redraw what the module shows after a language or look change. */
function redraw() {
  for ( const app of foundry.applications.instances.values() ) {
    if ( !app.rendered ) continue;
    if ( (app instanceof DeepRoll) || (app instanceof ImportApp) || (app.document instanceof RollTable) ) app.render();
  }
}

/**
 * Roll a table from a macro or another module.
 * @param {RollTable|string} table                       The table, its UUID, id or name
 * @param {object} [options]
 * @param {string} [options.draws]                       Formula of the number of draws (the table's setting)
 * @param {boolean} [options.distinct]                   No result twice (the table's setting)
 * @param {string} [options.mode]                        Visibility: foundry, public, gm, blind, self
 * @param {boolean} [options.post=true]                  Show the card in chat
 * @returns {Promise<{lines: object[], items: object[], problems: object[], message: ChatMessage|null}|null>}
 */
async function apiRoll(table, options = {}) {
  const doc = await resolveTable(table);
  if ( !doc || !canRoll(doc) ) return null;
  if ( options.post !== false ) {
    const done = await drawNow(doc, options);
    return done ? {lines: done.lines, items: mergeLines(done.lines.filter(l => l.include)), problems: done.problems,
      message: done.message} : null;
  }
  const roll = await rollTable(doc, options);
  return {lines: roll.lines, items: mergeLines(roll.lines.filter(l => l.include)), problems: roll.state.problems,
    message: null};
}

Hooks.once("init", () => {
  registerHubModule({moduleId: MODULE_ID, tested: TESTED_VERSIONS});
  registerSettings({
    language: value => changeLanguage(value, redraw),
    redraw
  });
  // Counted only on the active GM's client, like every Sephral module
  registerUsage(MODULE_ID, {
    features: ["deepRoll", "drawNow", "cardPosted", "lineRerolled", "givenToActor", "pileCreated", "ledgerAdded",
      "tableImported", "journalRoll", "tableReset"],
    settings: ["theme", "showChances", "maxDepth"]
  });
  registerDebug();
  registerEnrichers();
  Hooks.on("getRollTableContextOptions", onGetRollTableContextOptions);
  Hooks.on("getHeaderControlsRollTableSheet", onGetHeaderControls);
  Hooks.on("renderRollTableSheet", onRenderRollTableSheet);
  Hooks.on("renderTableResultConfig", onRenderTableResultConfig);
  Hooks.on("renderRollTableDirectory", onRenderRollTableDirectory);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  game.modules.get(MODULE_ID).api = {
    /** Roll a table (a RollTable, UUID, id or name) and show the result card. */
    roll: apiRoll,
    /** Open the deep roll window of a table. */
    open: openDeepRoll,
    /** Draw now: the card at once. */
    drawNow,
    /** Read a pasted list into table data without creating anything. */
    parseText: parseTableText,
    /** Open the window that makes a table from text (GM). */
    openImport,
    /** Show an edited roll as a card (for modules). */
    postRoll,
    /** A plain copy of a table as the engine sees it. */
    snapshot: async table => {
      const doc = await resolveTable(table);
      return doc ? snapshotTable(doc) : null;
    },
    /** Check the module (GM). */
    runSelfTest,
    /** Save the debug file of Sephral's modules (GM). */
    saveDebugFile: messageId => saveDebugFile(messageId ?? null, {moduleId: MODULE_ID})
  };
});

/** Applying a fixed module language loads its file; the rest of "ready" waits for it. */
let languageReady = Promise.resolve();

Hooks.once("i18nInit", () => {
  languageReady = applyModuleLanguage(setting("uiLanguage"));
});

Hooks.once("ready", async () => {
  await languageReady;
  noticeNewVersions();
});
