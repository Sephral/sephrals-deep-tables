/**
 * Pure logic of rows with conditions: a result row can carry conditions (scene, region, time of day, party level,
 * story tags). A row whose conditions do not hold is left out of the draw. The conditions are stored in the flags of
 * the result, the situation they are checked against is a plain object the Foundry side builds (situation.mjs).
 */

import {SDT} from "./flags.mjs";

/** The parts of the day. */
export const PERIODS = ["dawn", "day", "dusk", "night"];

/** The hour each part of the day starts at, 24 hour clock. */
export const DEFAULT_HOURS = {dawn: 5, day: 8, dusk: 18, night: 21};

/** What to do when a draw finds only rows whose conditions fail. */
export const ON_EMPTY = ["report", "ignore", "reroll"];

/** The system ranks of Savage Worlds, in order. */
const SWADE_RANKS = ["novice", "seasoned", "veteran", "heroic", "legendary"];

/** The most entries of each list a row may hold, so a pasted flag cannot grow without end. */
const MAX_LIST = 40;

/**
 * @param {unknown} value
 * @returns {string}
 */
function str(value) {
  return (value === null || value === undefined || typeof value === "object") ? "" : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function whole(value) {
  if ( (value === "") || (value === null) || (value === undefined) ) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * A list of unique non empty strings.
 * @param {unknown} value
 * @returns {string[]}
 */
function list(value) {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.map(str).filter(Boolean))].slice(0, MAX_LIST);
}

/**
 * Stored conditions made clean: only known fields, empty ones dropped. Null when nothing is left.
 * @param {unknown} raw
 * @returns {{scenes?: string[], regions?: string[], times?: string[], level?: {min: number|null, max: number|null},
 *   tags?: Record<string, boolean>}|null}
 */
export function normalizeConditions(raw) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const out = {};
  const scenes = list(raw.scenes);
  if ( scenes.length ) out.scenes = scenes;
  const regions = list(raw.regions);
  if ( regions.length ) out.regions = regions;
  const times = list(raw.times).filter(p => PERIODS.includes(p));
  if ( times.length ) out.times = times;
  let min = whole(raw.level?.min);
  let max = whole(raw.level?.max);
  if ( (min !== null) && (max !== null) && (min > max) ) [min, max] = [max, min];
  if ( (min !== null) || (max !== null) ) out.level = {min, max};
  if ( raw.tags && (typeof raw.tags === "object") ) {
    const tags = {};
    for ( const [id, want] of Object.entries(raw.tags).slice(0, MAX_LIST) ) {
      if ( (typeof want === "boolean") && str(id) ) tags[str(id)] = want;
    }
    if ( Object.keys(tags).length ) out.tags = tags;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Read the conditions of a result from its flags.
 * @param {(path: string) => unknown} get   Reads a path of the result's flags
 * @returns {ReturnType<typeof normalizeConditions>}
 */
export function conditionsOf(get) {
  return normalizeConditions(get(`${SDT}.conditions`));
}

/**
 * Does a row have conditions?
 * @param {unknown} raw
 * @returns {boolean}
 */
export function hasConditions(raw) {
  return !!normalizeConditions(raw);
}

/**
 * The setting of a table for an empty draw.
 * @param {unknown} value
 * @returns {"report"|"ignore"|"reroll"}
 */
export function onEmptyOf(value) {
  const text = str(value);
  return ON_EMPTY.includes(text) ? text : "report";
}

/* -------------------------------------------- */
/*  Time of day                                 */
/* -------------------------------------------- */

/**
 * The hours the parts of the day start at, repaired when a value is missing or out of range.
 * @param {Partial<Record<string, unknown>>} [hours]
 * @returns {Record<string, number>}
 */
export function cleanHours(hours = {}) {
  const out = {};
  for ( const period of PERIODS ) {
    const n = Number(hours?.[period]);
    out[period] = (Number.isFinite(n) && (n >= 0) && (n < 24)) ? n : DEFAULT_HOURS[period];
  }
  return out;
}

/**
 * The part of the day of an hour: the one that started last before it, around midnight included.
 * @param {number} hour                      0 up to 24
 * @param {Partial<Record<string, number>>} [hours]
 * @returns {"dawn"|"day"|"dusk"|"night"}
 */
export function periodOf(hour, hours = DEFAULT_HOURS) {
  const starts = cleanHours(hours);
  const now = ((Number(hour) % 24) + 24) % 24;
  let best = null;
  let bestGap = Infinity;
  for ( const period of PERIODS ) {
    const gap = (now - starts[period] + 24) % 24;
    if ( gap < bestGap ) {
      bestGap = gap;
      best = period;
    }
  }
  return best;
}

/**
 * The hour of the day from the world time.
 * @param {{hour?: number, minute?: number}|null|undefined} components   game.time.components
 * @param {number} worldTime                                              Seconds
 * @returns {number}
 */
export function hourOf(components, worldTime) {
  if ( Number.isFinite(components?.hour) ) return components.hour + (Number(components.minute) || 0) / 60;
  const seconds = ((Number(worldTime) || 0) % 86400 + 86400) % 86400;
  return seconds / 3600;
}

/* -------------------------------------------- */
/*  Party level                                 */
/* -------------------------------------------- */

/**
 * The level of one character from the data of its game system, or null.
 * @param {string} systemId
 * @param {object} system     actor.system
 * @returns {number|null}
 */
export function readLevel(systemId, system) {
  const number = value => {
    const n = Number(value);
    return (value !== "") && (value !== null) && Number.isFinite(n) ? n : null;
  };
  const sys = system ?? {};
  if ( systemId === "swade" ) {
    const advances = number(sys.advances?.value);
    if ( advances !== null ) return Math.min(Math.floor(Math.max(advances, 0) / 4), 4) + 1;
    const rank = SWADE_RANKS.indexOf(str(sys.advances?.rank).toLowerCase());
    return rank >= 0 ? rank + 1 : null;
  }
  if ( systemId === "crucible" ) return number(sys.advancement?.level);
  if ( systemId === "pf2e" ) return number(sys.details?.level?.value) ?? number(sys.details?.level);
  const places = [sys.details?.level, sys.details?.level?.value, sys.level, sys.level?.value, sys.attributes?.level,
    sys.attributes?.level?.value, sys.advancement?.level, sys.details?.lvl];
  for ( const place of places ) {
    const n = number(place);
    if ( n !== null ) return n;
  }
  return null;
}

/**
 * The level of a party: the average of its members, rounded.
 * @param {(number|null)[]} levels
 * @returns {number|null}
 */
export function partyLevel(levels) {
  const known = levels.filter(level => Number.isFinite(level));
  if ( !known.length ) return null;
  return Math.round(known.reduce((sum, level) => sum + level, 0) / known.length);
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * @typedef Situation
 * @property {string|null} sceneId                  The scene the roller looks at
 * @property {string[]|null} regions                Lowercase names of the Regions the tokens stand in, null when there
 *   is no token to ask
 * @property {string} period                        dawn, day, dusk or night
 * @property {number|null} level                    The party level, null when unknown
 * @property {boolean} [levelOff]                    Level conditions are not checked (setting)
 * @property {Record<string, boolean>} tags         The story tags that are on
 */

/**
 * Check the conditions of a row against the situation.
 * @param {unknown} conditions
 * @param {Situation|null|undefined} situation
 * @returns {{ok: boolean, reasons: object[]}}   The reasons say which conditions fail
 */
export function check(conditions, situation) {
  const rules = normalizeConditions(conditions);
  if ( !rules ) return {ok: true, reasons: []};
  const now = situation ?? {sceneId: null, regions: null, period: "day", level: null, tags: {}};
  const reasons = [];
  if ( rules.scenes && !rules.scenes.includes(now.sceneId) ) reasons.push({kind: "scene", ids: rules.scenes});
  if ( rules.regions ) {
    const wanted = rules.regions.map(name => name.toLowerCase());
    if ( !now.regions || !now.regions.some(name => wanted.includes(name)) ) {
      reasons.push({kind: "region", names: rules.regions, unknown: !now.regions});
    }
  }
  if ( rules.times && !rules.times.includes(now.period) ) reasons.push({kind: "time", periods: rules.times, now: now.period});
  if ( rules.level && !now.levelOff ) {
    const {min, max} = rules.level;
    const level = now.level;
    if ( !Number.isFinite(level) ) reasons.push({kind: "level", min, max, level: null});
    else if ( ((min !== null) && (level < min)) || ((max !== null) && (level > max)) ) {
      reasons.push({kind: "level", min, max, level});
    }
  }
  if ( rules.tags ) {
    for ( const [id, want] of Object.entries(rules.tags) ) {
      if ( (now.tags?.[id] === true) !== want ) reasons.push({kind: "tag", id, want});
    }
  }
  return {ok: !reasons.length, reasons};
}

/* -------------------------------------------- */
/*  Story tags                                  */
/* -------------------------------------------- */

/** The most story tags a world keeps. */
export const MAX_TAGS = 40;

/**
 * The stored list of story tags made clean.
 * @param {unknown} raw
 * @returns {{id: string, name: string, on: boolean}[]}
 */
export function normalizeTags(raw) {
  const seen = new Set();
  const out = [];
  for ( const entry of Array.isArray(raw) ? raw : [] ) {
    const id = str(entry?.id);
    const name = str(entry?.name);
    if ( !id || !name || seen.has(id) ) continue;
    seen.add(id);
    out.push({id, name: name.slice(0, 60), on: entry.on === true});
    if ( out.length >= MAX_TAGS ) break;
  }
  return out;
}

/**
 * An id for a new tag from its name: lowercase letters and digits with dashes, unique in the list.
 * @param {string} name
 * @param {Iterable<string>} taken
 * @returns {string}
 */
export function tagId(name, taken = []) {
  const base = str(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tag";
  const used = new Set(taken);
  let id = base;
  for ( let n = 2; used.has(id); n++ ) id = `${base}-${n}`;
  return id;
}

/**
 * The tags that are on, as the map a situation holds.
 * @param {{id: string, on: boolean}[]} tags
 * @returns {Record<string, boolean>}
 */
export function tagMap(tags) {
  return Object.fromEntries(tags.filter(tag => tag.on).map(tag => [tag.id, true]));
}

/**
 * Add tags a table needs that the world does not have yet (switched off). Names come from the library.
 * @param {{id: string, name: string, on: boolean}[]} tags
 * @param {{id: string, name: string}[]} needed
 * @returns {{id: string, name: string, on: boolean}[]}
 */
export function addMissingTags(tags, needed) {
  const out = [...tags];
  for ( const entry of needed ) {
    if ( !entry?.id || out.some(tag => tag.id === entry.id) || (out.length >= MAX_TAGS) ) continue;
    out.push({id: entry.id, name: entry.name || entry.id, on: false});
  }
  return out;
}
