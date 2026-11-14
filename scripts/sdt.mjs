import {MODULE_ID, TESTED_VERSIONS, setting} from "./config.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {ActionEditor, openActionEditor} from "./action-app.mjs";
import {ConditionsEditor, openConditionsEditor} from "./conditions-app.mjs";
import {check} from "./conditions.mjs";
import {DeepRoll, openDeepRoll} from "./deep-app.mjs";
import {registerEnrichers} from "./enrichers.mjs";
import {countersOf, putBack, resetTable, resolveTable, rollTable, snapshotTable} from "./engine.mjs";
import {runRowAction, undoRowAction} from "./act.mjs";
import {canRoll, drawNow, postRoll} from "./flow.mjs";
import {registerHubModule} from "./hub.mjs";
import {PlayerTablesApp, openPlayerTables, readyPlayerTables, refreshPlayerTables, rollListed,
  syncPlayerTables} from "./player-tables.mjs";
import {ImportApp, openImport} from "./import-app.mjs";
import {LibraryApp, importLibrary, loadLibrary, openLibrary} from "./library-app.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {mergeLines} from "./merge.mjs";
import {parseTableText} from "./parse-text.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {changeLanguage, registerSettings} from "./settings.mjs";
import {currentSituation, saveStoryTags, setStoryTag, storyTags} from "./situation.mjs";
import {StoryTagsApp, openStoryTags} from "./tags-app.mjs";
import {onGetHeaderControls, onGetRollTableContextOptions, onRenderRollTableDirectory, onRenderRollTableSheet,
  onRenderTableResultActions, onRenderTableResultConfig} from "./sheet.mjs";
import {onRenderChatMessage} from "./toolbar.mjs";
import {registerUsage} from "./usage.mjs";

/** Redraw what the module shows after a language or look change. */
function redraw() {
  for ( const app of foundry.applications.instances.values() ) {
    if ( !app.rendered ) continue;
    if ( (app instanceof DeepRoll) || (app instanceof ImportApp) || (app instanceof ActionEditor)
      || (app instanceof PlayerTablesApp) || (app instanceof LibraryApp) || (app instanceof StoryTagsApp)
      || (app instanceof ConditionsEditor) || (app.document instanceof RollTable) ) app.render();
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
    redraw,
    players: refreshPlayerTables
  });
  // Counted only on the active GM's client, like every Sephral module
  registerUsage(MODULE_ID, {
    features: ["deepRoll", "drawNow", "cardPosted", "lineRerolled", "givenToActor", "pileCreated", "ledgerAdded",
      "tableImported", "journalRoll", "tableReset", "actionRun", "actionUndo", "playerRoll", "triggerRoll", "libraryOpen", "libraryImport", "conditionsSet", "conditionsApplied", "storyTagSet"],
    settings: ["theme", "showChances", "maxDepth", "autoActions", "triggerTables"]
  });
  registerDebug();
  registerEnrichers();
  Hooks.on("getRollTableContextOptions", onGetRollTableContextOptions);
  Hooks.on("getHeaderControlsRollTableSheet", onGetHeaderControls);
  Hooks.on("renderRollTableSheet", onRenderRollTableSheet);
  Hooks.on("renderTableResultConfig", onRenderTableResultConfig);
  Hooks.on("renderTableResultConfig", onRenderTableResultActions);
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
    /** What a table and the tables inside it remember: [{uuid, name, used, total, ids}]. */
    counters: async table => {
      const doc = await resolveTable(table);
      return doc ? countersOf(doc) : [];
    },
    /** GM: bring everything a table remembers back (the marks of Foundry and the memory). */
    resetMemory: async table => {
      const doc = await resolveTable(table);
      return doc ? resetTable(doc) : false;
    },
    /** GM: put one result back into a table so it can come up again. */
    putBack: async (table, resultId) => {
      const doc = await resolveTable(table);
      return doc ? putBack(doc, resultId) : false;
    },
    /** GM: run the action of a result row on a card, or take it back. */
    runAction: (message, key) => {
      const card = message?.flags?.[MODULE_ID]?.card;
      const row = card?.lines?.find(line => line.key === key);
      return row ? runRowAction(message, row) : false;
    },
    undoAction: (message, key) => undoRowAction(message, key),
    /** GM: open the action window of a table result. */
    editAction: openActionEditor,
    /** Open the list of tables players may roll, and roll one of them (a GM rolls at once, a player asks the GM). */
    openPlayerTables,
    rollListed,
    /** GM: write the list of tables players may roll again. */
    syncPlayerTables,
    /** Open the Table library: ready tables to import (GM). */
    openLibrary,
    /** GM: import tables of the library by key, for example ["name-any", "inn-name"]. Options: lang, folder. */
    importLibrary: (keys, options = {}) => importLibrary({...options, keys}),
    /** The tables of the library in a language: [{key, name, group, part}]. */
    library: async lang => {
      const {tables} = await loadLibrary(lang ?? "en");
      return [...tables.values()].map(table => ({key: table.key, name: table.name, group: table.group, part: !!table.part}));
    },
    /** The story tags of the world: [{id, name, on}]. */
    storyTags,
    /** GM: switch a story tag (by id or name) on or off. Without a second argument it toggles. */
    setStoryTag,
    /** GM: replace the list of story tags. */
    saveStoryTags,
    /** GM: open the window of story tags. */
    openStoryTags,
    /** GM: open the conditions window of a table result. */
    editConditions: openConditionsEditor,
    /** The situation conditions are checked against right now: scene, regions, time of day, party level, tags. */
    situation: currentSituation,
    /** Do the conditions of a row hold right now? Returns {ok, reasons}. */
    checkConditions: conditions => check(conditions, currentSituation()),
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
  readyPlayerTables();
  noticeNewVersions();
});
