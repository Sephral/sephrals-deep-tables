/**
 * Settings of the module. Like in every Sephral module, all options appear in Foundry's settings dialog under this
 * module, starting with the module language.
 */

import {MODULE_ID, isShown} from "./config.mjs";
import {FOLLOW_FOUNDRY, applyModuleLanguage} from "./language.mjs";
import {runSelfTest} from "./selftest.mjs";
import {StoryTagsApp} from "./tags-app.mjs";

/**
 * The settings of the module, in the order they appear in the settings dialog.
 * @type {Record<string, object>}
 */
export const SETTINGS = {
  uiLanguage: {type: String, default: FOLLOW_FOUNDRY, scope: "client", onChange: "language", choices: {
    [FOLLOW_FOUNDRY]: "SDT.LANGUAGE.default", de: "SDT.LANGUAGE.de", en: "SDT.LANGUAGE.en"}},
  theme: {type: String, default: "signature", scope: "client", onChange: "redraw", choices: {
    signature: "SDT.SETTINGS.theme.signature", foundry: "SDT.SETTINGS.theme.foundry"}},
  showChances: {type: Boolean, default: true, scope: "client", onChange: "redraw"},
  maxDepth: {type: Number, default: 5, scope: "world", range: {min: 1, max: 10, step: 1}},
  autoActions: {type: Boolean, default: true, scope: "world"},
  hourDawn: {type: Number, default: 5, scope: "world", range: {min: 0, max: 23, step: 1}},
  hourDay: {type: Number, default: 8, scope: "world", range: {min: 0, max: 23, step: 1}},
  hourDusk: {type: Number, default: 18, scope: "world", range: {min: 0, max: 23, step: 1}},
  hourNight: {type: Number, default: 21, scope: "world", range: {min: 0, max: 23, step: 1}},
  levelSource: {type: String, default: "auto", scope: "world", choices: {
    auto: "SDT.SETTINGS.levelSource.auto", manual: "SDT.SETTINGS.levelSource.manual", off: "SDT.SETTINGS.levelSource.off"}},
  levelManual: {type: Number, default: 1, scope: "world", range: {min: 1, max: 30, step: 1}},
  // Only offered while Roll Triggers is active
  triggerTables: {type: Boolean, default: true, scope: "world", needs: "sephrals-roll-triggers"}
};

/**
 * Register all settings of the module and its menus.
 * @param {{language: Function, redraw: Function, players?: Function}} handlers
 */
export function registerSettings(handlers) {
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    game.settings.register(MODULE_ID, key, {
      name: `SDT.SETTINGS.${key}.name`,
      hint: `SDT.SETTINGS.${key}.hint`,
      scope: def.scope ?? "world",
      config: def.needs ? !!game.modules.get(def.needs)?.active : true,
      type: def.type,
      choices: def.choices,
      range: def.range,
      default: def.default,
      onChange: def.onChange ? value => handlers[def.onChange]?.(value) : undefined
    });
  }
  // The list of tables players may roll, kept by the GM
  game.settings.register(MODULE_ID, "playerTables", {scope: "world", config: false, type: Array, default: [],
    onChange: () => handlers.players?.()});
  // The story tags the GM switches on and off: [{id, name, on}]
  game.settings.register(MODULE_ID, "storyTags", {scope: "world", config: false, type: Array, default: [],
    onChange: () => handlers.redraw?.()});
  game.settings.register(MODULE_ID, "acknowledgedVersions", {scope: "client", config: false, type: String, default: ""});
  game.settings.registerMenu(MODULE_ID, "storyTags", {
    name: "SDT.Tags.menu",
    label: "SDT.Tags.open",
    hint: "SDT.Tags.menuHint",
    icon: "fa-solid fa-tags",
    type: StoryTagsApp,
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "SDT.SELFTEST.Title",
    label: "SDT.SELFTEST.Run",
    hint: "SDT.SELFTEST.Hint",
    icon: "fa-solid fa-stethoscope",
    type: SelfTestMenu,
    restricted: true
  });
}

/** The menu button which runs the self test. Foundry only accepts application classes as menus. */
class SelfTestMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await runSelfTest();
    return this;
  }
}

/**
 * Switch the module strings when the user picks another module language, then redraw.
 * @param {string} value
 * @param {Function} redraw
 */
export function changeLanguage(value, redraw) {
  applyModuleLanguage(value).then(() => {
    redraw();
    if ( game.settings.sheet?.rendered ) game.settings.sheet.render();
  });
}
