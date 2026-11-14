/**
 * The situation conditions are checked against, read from the world: the scene the roller looks at, the Regions of
 * the selected tokens or the party, the time of day from the world time, the party level and the story tags. Also the
 * texts that explain a condition or the reason a row was left out.
 */

import {MODULE_ID, setting, t} from "./config.mjs";
import {PERIODS, cleanHours, hourOf, normalizeConditions, normalizeTags, partyLevel, periodOf, readLevel, tagMap}
  from "./conditions.mjs";

/** The settings of the parts of the day. */
const HOUR_SETTINGS = {dawn: "hourDawn", day: "hourDay", dusk: "hourDusk", night: "hourNight"};

/** Actor types that stand for a player character in the supported systems. */
const CHARACTER_TYPES = ["character", "hero", "pc", "player"];

/* -------------------------------------------- */
/*  Story tags                                  */
/* -------------------------------------------- */

/**
 * The story tags of the world.
 * @returns {{id: string, name: string, on: boolean}[]}
 */
export function storyTags() {
  return normalizeTags(setting("storyTags"));
}

/**
 * GM: save the story tags.
 * @param {{id: string, name: string, on: boolean}[]} tags
 * @returns {Promise<boolean>}
 */
export async function saveStoryTags(tags) {
  if ( !game.user.isGM ) return false;
  await game.settings.set(MODULE_ID, "storyTags", normalizeTags(tags));
  return true;
}

/**
 * GM: switch one story tag on or off.
 * @param {string} id
 * @param {boolean} [on]   Missing toggles
 * @returns {Promise<boolean>}   False when the tag does not exist
 */
export async function setStoryTag(id, on) {
  const tags = storyTags();
  const tag = tags.find(entry => entry.id === id || entry.name.toLowerCase() === String(id).toLowerCase());
  if ( !tag || !game.user.isGM ) return false;
  tag.on = (on === undefined) ? !tag.on : !!on;
  await saveStoryTags(tags);
  return true;
}

/* -------------------------------------------- */
/*  Time, party, regions                        */
/* -------------------------------------------- */

/**
 * The hours the parts of the day start at.
 * @returns {Record<string, number>}
 */
export function dayHours() {
  return cleanHours(Object.fromEntries(Object.entries(HOUR_SETTINGS).map(([period, key]) => [period, setting(key)])));
}

/**
 * The player characters of the party: the characters the users are assigned to, else the ones players own.
 * @returns {Actor[]}
 */
export function partyActors() {
  const assigned = game.users.filter(user => !user.isGM).map(user => user.character).filter(Boolean);
  if ( assigned.length ) return [...new Set(assigned)];
  const owned = game.actors.filter(actor => actor.hasPlayerOwner && CHARACTER_TYPES.includes(actor.type));
  if ( owned.length ) return owned;
  return game.actors.filter(actor => actor.hasPlayerOwner && !["npc", "party", "group", "vehicle", "loot"].includes(actor.type));
}

/**
 * The party level, from the setting: read from the characters, typed in, or not checked at all.
 * @returns {{level: number|null, off: boolean}}
 */
export function currentLevel() {
  const source = setting("levelSource");
  if ( source === "off" ) return {level: null, off: true};
  if ( source === "manual" ) return {level: Math.floor(Number(setting("levelManual"))) || 1, off: false};
  const levels = partyActors().map(actor => readLevel(game.system.id, actor.system));
  return {level: partyLevel(levels), off: false};
}

/**
 * The names (lowercase) of the Regions the selected tokens stand in, or the party tokens when none is selected.
 * @returns {string[]|null}   Null when there is no token to ask
 */
export function currentRegions() {
  let tokens = canvas?.tokens?.controlled ?? [];
  if ( !tokens.length ) {
    const party = new Set(partyActors().map(actor => actor.id));
    tokens = (canvas?.tokens?.placeables ?? []).filter(token => token.actor && party.has(token.actor.id));
  }
  if ( !tokens.length ) return null;
  const names = new Set();
  for ( const token of tokens ) {
    for ( const region of token.document?.regions ?? [] ) {
      if ( region?.name ) names.add(String(region.name).trim().toLowerCase());
    }
  }
  return [...names];
}

/**
 * The situation of this moment.
 * @returns {import("./conditions.mjs").Situation}
 */
export function currentSituation() {
  const scene = game.scenes?.viewed ?? game.scenes?.active ?? null;
  const {level, off} = currentLevel();
  const hour = hourOf(game.time?.components, game.time?.worldTime);
  return {
    sceneId: scene?.id ?? null,
    regions: currentRegions(),
    period: periodOf(hour, dayHours()),
    hour,
    level,
    levelOff: off,
    tags: tagMap(storyTags())
  };
}

/* -------------------------------------------- */
/*  Texts                                       */
/* -------------------------------------------- */

/**
 * @param {string} period
 * @returns {string}
 */
export function periodName(period) {
  return t(`SDT.Cond.period.${period}`);
}

/**
 * The name of a story tag by its id.
 * @param {string} id
 * @returns {string}
 */
function tagName(id) {
  return storyTags().find(tag => tag.id === id)?.name ?? id;
}

/**
 * A level range as text.
 * @param {number|null} min
 * @param {number|null} max
 * @returns {string}
 */
export function rangeText(min, max) {
  if ( (min !== null) && (max !== null) ) return (min === max) ? String(min) : t("SDT.Cond.range.both", {min, max});
  if ( min !== null ) return t("SDT.Cond.range.min", {min});
  return t("SDT.Cond.range.max", {max});
}

/**
 * Why a row was left out, one condition.
 * @param {object} reason   An entry of the reasons check() gives
 * @returns {string}
 */
export function reasonText(reason) {
  switch ( reason.kind ) {
    case "scene": {
      const names = reason.ids.map(id => game.scenes.get(id)?.name ?? "?").join(", ");
      return t("SDT.Cond.reason.scene", {names});
    }
    case "region":
      return t(reason.unknown ? "SDT.Cond.reason.regionUnknown" : "SDT.Cond.reason.region", {names: reason.names.join(", ")});
    case "time":
      return t("SDT.Cond.reason.time", {periods: reason.periods.map(periodName).join(", "), now: periodName(reason.now)});
    case "level":
      return t((reason.level === null) ? "SDT.Cond.reason.levelUnknown" : "SDT.Cond.reason.level",
        {range: rangeText(reason.min, reason.max), level: reason.level});
    case "tag":
      return t(reason.want ? "SDT.Cond.reason.tagOn" : "SDT.Cond.reason.tagOff", {name: tagName(reason.id)});
    default:
      return reason.kind;
  }
}

/**
 * The conditions of a row as one short line, for the table sheet.
 * @param {unknown} conditions
 * @returns {string}
 */
export function conditionsSummary(conditions) {
  const rules = normalizeConditions(conditions);
  if ( !rules ) return "";
  const parts = [];
  if ( rules.scenes ) parts.push(rules.scenes.map(id => game.scenes.get(id)?.name ?? "?").join(" / "));
  if ( rules.regions ) parts.push(rules.regions.join(" / "));
  if ( rules.times ) parts.push(PERIODS.filter(p => rules.times.includes(p)).map(periodName).join(" / "));
  if ( rules.level ) parts.push(t("SDT.Cond.levelShort", {range: rangeText(rules.level.min, rules.level.max)}));
  if ( rules.tags ) {
    parts.push(Object.entries(rules.tags).map(([id, want]) => (want ? tagName(id) : t("SDT.Cond.notTag", {name: tagName(id)})))
      .join(" / "));
  }
  return parts.join(" · ");
}

/**
 * The situation as one line, for the deep roll window.
 * @param {import("./conditions.mjs").Situation} situation
 * @returns {string}
 */
export function situationText(situation) {
  const parts = [periodName(situation.period)];
  const scene = game.scenes.get(situation.sceneId);
  if ( scene ) parts.push(scene.name);
  if ( situation.regions?.length ) parts.push(situation.regions.join(", "));
  if ( !situation.levelOff ) {
    parts.push(Number.isFinite(situation.level) ? t("SDT.Cond.levelShort", {range: situation.level}) : t("SDT.Cond.levelNone"));
  }
  const on = Object.keys(situation.tags ?? {}).map(tagName);
  if ( on.length ) parts.push(on.join(", "));
  return parts.join(" · ");
}
