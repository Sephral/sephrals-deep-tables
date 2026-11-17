/**
 * The drawing engine: pure logic without Foundry globals. A table is passed in as a plain snapshot (see
 * snapshot.mjs), everything that touches Foundry (rolling, loading documents) comes in as functions, so the tests
 * run in Node.
 *
 * A draw gives lines: items with a quantity, coins, texts and links. A result that points to another table is drawn
 * as many times as its quantity says, guarded by a depth limit and against circles. Texts may hold inline rolls
 * ([[1d6]]) and draws from other tables (@Table[Name]).
 */

import {lineAction} from "./actions.mjs";
import {check, onEmptyOf} from "./conditions.mjs";

/** The default depth nested tables are followed. */
export const MAX_DEPTH = 5;

/** The most draws or repeats one formula may ask for, so a typo like "1d1000" does not hang a client. */
export const MAX_DRAWS = 100;

/** The most lines one roll may produce. */
export const MAX_LINES = 400;

/** How often a table formula is rolled while no available result matches. */
const MAX_TRIES = 500;

/**
 * @typedef TableSnapshot
 * @property {string} uuid
 * @property {string} name
 * @property {string} formula        The formula as saved, "" when the table has none
 * @property {boolean} replacement
 * @property {boolean} pack          The table is in a compendium (nothing is marked as drawn there)
 * @property {boolean} distinct      No result twice in one roll
 * @property {boolean} [memory]      The table remembers what was drawn (the results it remembers come as drawn)
 * @property {string} draws          Formula of the number of draws
 * @property {string} mode           Visibility, "foundry" follows the chat setting
 * @property {string} [onEmpty]      What to do when only rows with failing conditions are left: report, ignore, reroll
 * @property {{id: string, type: string, name: string, img: string, description: string, documentUuid: string|null,
 *   range: number[], weight: number, drawn: boolean, quantity: string, action?: object|null,
 *   conditions?: object|null}[]} results
 */

/**
 * @typedef Line
 * @property {string} id
 * @property {"item"|"coins"|"text"|"link"} kind
 * @property {string} name
 * @property {string} [html]          Expanded text of a text result (HTML)
 * @property {string} [text]          The same as plain text
 * @property {string} img
 * @property {string} [uuid]          The item or document
 * @property {number} quantity        Units of an item or link
 * @property {Record<string, number>} coins
 * @property {string} formula         The quantity formula of the result
 * @property {boolean} invalid        The quantity formula could not be rolled
 * @property {string} tableUuid       The table the line was drawn from, to draw it again
 * @property {string} tableName
 * @property {string} resultId
 * @property {number} depth
 * @property {string[]} path          Names of the tables from the top one to this one
 * @property {{t: string, r: string, x: boolean, m: boolean, k: boolean}[]} picks   Every pick on the way: table,
 *   result, exclusive (no repeat in this roll), mark as drawn, remember (tables with a memory)
 * @property {{type: string, auto: boolean, t: string, r: string}|null} act   The action of the result, see actions.mjs
 * @property {object[]} rolls         The dice rolls behind the line (opaque to the engine)
 * @property {boolean} include
 */

/**
 * @typedef DrawDeps
 * @property {(formula: string) => Promise<{total: number, roll: object}>} roll       Roll a table formula
 * @property {(formula: string) => Promise<{total: number, roll: object}>} evaluate   Roll any formula
 * @property {(uuid: string) => Promise<{uuid: string, documentName: string, name: string, img: string}|null>} loadDoc
 * @property {(uuid: string) => Promise<TableSnapshot|null>} loadTable
 * @property {(ref: string) => Promise<TableSnapshot|null>} findTable          By UUID, id or name
 * @property {(text: string) => {formula: string, key: string}[]|null} coinParts
 * @property {(key: string) => string} [coinLabel]
 * @property {() => string} [newId]
 */

/**
 * @typedef DrawState
 * @property {Map<string, Set<string>>} exclude    Results that may not come up again, by table
 * @property {{kind: string, table?: string, ref?: string, uuid?: string}[]} problems
 * @property {boolean} ranOut                      A table had no more results before all draws were made
 * @property {number} count
 * @property {number} maxDepth
 * @property {import("./conditions.mjs").Situation|null} situation   What conditions are checked against, null checks none
 * @property {{tableUuid: string, tableName: string, resultId: string, name: string, reasons: object[]}[]} left
 *   The rows left out because their conditions fail
 * @property {Map<string, Set<string>>} blocked   Rows given up because the table inside them had nothing to give
 * @property {boolean} handBack                    A table inside another had nothing to give and asks for another pick
 */

/**
 * A fresh state for a roll.
 * @param {object} [options]
 * @param {Map<string, Set<string>>} [options.exclude]
 * @param {number} [options.maxDepth]
 * @param {import("./conditions.mjs").Situation|null} [options.situation]
 * @returns {DrawState}
 */
export function newState({exclude, maxDepth=MAX_DEPTH, situation=null}={}) {
  return {exclude: exclude ?? new Map(), problems: [], ranOut: false, count: 0, maxDepth, situation, left: [],
    blocked: new Map(), handBack: false};
}

/**
 * Add a problem once per kind and table.
 * @param {DrawState} state
 * @param {object} problem
 */
function addProblem(state, problem) {
  if ( state.problems.some(p => (p.kind === problem.kind) && (p.uuid === problem.uuid) && (p.table === problem.table)) ) return;
  state.problems.push(problem);
}

/**
 * Remember the rows of a table that were left out.
 * @param {DrawState} state
 * @param {TableSnapshot} table
 * @param {{entry: object, reasons: object[]}[]} left
 */
function recordLeft(state, table, left) {
  for ( const {entry, reasons} of left ?? [] ) {
    if ( state.left.some(l => (l.tableUuid === table.uuid) && (l.resultId === entry.id)) ) continue;
    const name = entry.name || plainText(entry.description);
    state.left.push({tableUuid: table.uuid, tableName: table.name, resultId: entry.id,
      name: String(name || "–").slice(0, 80), reasons});
  }
}

/* -------------------------------------------- */
/*  Texts and formulas                          */
/* -------------------------------------------- */

/**
 * A formula as typed by a GM, made rollable: "2d4 × 10" and "2d4x10" become "2d4*10".
 * @param {string} text
 * @returns {string}
 */
export function normalizeFormula(text) {
  return String(text ?? "").trim().replace(/(\d)\s*[x×]\s*(?=\d)/gi, "$1*").replace(/\s+/g, " ");
}

/**
 * Plain text of a result description (HTML).
 * @param {string} html
 * @returns {string}
 */
export function plainText(html) {
  return String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** A whole text that is one content link. */
const ONLY_LINK = /^@UUID\[([^\]\s]+)\](?:\{([^}]*)\})?$/;

/**
 * The link of a text result that holds nothing but one link, in its name or its description.
 * A name next to a linked description must be empty or the link's own label.
 * @param {{name?: string, description?: string}} result
 * @returns {{uuid: string, label: string}|null}
 */
export function itemLinkOf(result) {
  const read = source => {
    const match = ONLY_LINK.exec(plainText(source));
    return match ? {uuid: match[1], label: (match[2] ?? "").trim()} : null;
  };
  const name = plainText(result.name);
  const description = plainText(result.description);
  const inName = read(name);
  if ( inName ) return description ? null : inName;
  const inDescription = read(description);
  if ( !inDescription ) return null;
  if ( !name ) return inDescription;
  if ( name === inDescription.label ) return inDescription;
  return (inDescription.label ? null : {uuid: inDescription.uuid, label: name});
}

/** One amount of a coin text: a dice or number expression, then the coin. */
const COIN_PART = /\s*((?:\d*d\d+|\d+)(?:\s*[-+*/]\s*(?:\d*d\d+|\d+))*)\s*([a-zäöüß.]+)\s*(?:,|\+|&|\band\b|\bund\b)?/iy;

/**
 * Read a coin text like "3d6 gp", "2d4 × 10 gp, 5 sp" or "50 GM". The whole text must be coins, otherwise it is an
 * ordinary text result.
 * @param {string} text
 * @param {{key: string, abbr?: string}[]} denominations
 * @returns {{formula: string, key: string}[]|null}
 */
export function parseCoinText(text, denominations) {
  const value = normalizeFormula(plainText(text)).replace(/[.!]+$/, "");
  if ( !value || !denominations?.length ) return null;
  const units = new Map();
  for ( const d of denominations ) {
    units.set(String(d.key).toLowerCase(), d.key);
    if ( d.abbr ) units.set(String(d.abbr).toLowerCase().replace(/\./g, ""), d.key);
  }
  const parts = [];
  COIN_PART.lastIndex = 0;
  while ( COIN_PART.lastIndex < value.length ) {
    const start = COIN_PART.lastIndex;
    const match = COIN_PART.exec(value);
    if ( !match || (COIN_PART.lastIndex === start) ) return null;
    const key = units.get(match[2].toLowerCase().replace(/\./g, ""));
    if ( !key ) return null;
    parts.push({formula: match[1].replace(/\s+/g, ""), key});
  }
  return parts.length ? parts : null;
}

/**
 * Roll a quantity formula: empty means 1, the result is a whole number of at least 0.
 * @param {string} formula
 * @param {(formula: string) => Promise<number>} evaluate
 * @returns {Promise<number|null>}   null when the formula cannot be rolled
 */
export async function resolveQuantity(formula, evaluate) {
  const text = normalizeFormula(formula);
  if ( !text ) return 1;
  if ( /^\d+$/.test(text) ) return Math.min(Number(text), 1e6);
  try {
    const total = Number(await evaluate(text));
    if ( !Number.isFinite(total) ) return null;
    return Math.max(Math.floor(total), 0);
  } catch {
    return null;
  }
}

/**
 * Replace every match of a pattern with the result of an async function.
 * @param {string} text
 * @param {RegExp} pattern     With the g flag
 * @param {(...match: string[]) => Promise<string>} replacer
 * @returns {Promise<string>}
 */
async function replaceAsync(text, pattern, replacer) {
  const matches = [...text.matchAll(pattern)];
  let result = "";
  let last = 0;
  for ( const match of matches ) {
    result += text.slice(last, match.index) + await replacer(...match);
    last = match.index + match[0].length;
  }
  return result + text.slice(last);
}

/** [[1d6]], [[/r 1d6]], [[/roll 2d4 # comment]], optionally followed by a {label} which is dropped. */
const INLINE_ROLL = /\[\[\s*(?:\/r(?:oll)?\s+)?([^\]#]+?)\s*(?:#[^\]]*)?\]\](?:\{[^}]*\})?/gi;

/** @Table[Name or UUID], optionally followed by a {label} which is dropped. */
const TABLE_REF = /@Table\[([^\]]+)\](?:\{[^}]*\})?/gi;

/**
 * Does a text contain something the engine expands?
 * @param {string} text
 * @returns {boolean}
 */
export function hasMarkup(text) {
  return /\[\[|@Table\[/i.test(String(text ?? ""));
}

/* -------------------------------------------- */
/*  Picking                                     */
/* -------------------------------------------- */

/**
 * The ranges of a table as the table would have them: the saved ranges, or an even distribution by weight when the
 * table has no formula (Foundry normalizes such a table before it rolls, here nothing is saved).
 * @param {TableSnapshot} table
 * @returns {{formula: string, entries: TableSnapshot["results"]}}
 */
export function layout(table) {
  const results = table.results ?? [];
  if ( String(table.formula ?? "").trim() ) return {formula: table.formula, entries: results};
  let next = 1;
  const entries = results.map(result => {
    const weight = Math.max(Math.floor(Number(result.weight)) || 1, 1);
    const entry = {...result, range: [next, next + weight - 1]};
    next += weight;
    return entry;
  });
  return {formula: `1d${Math.max(next - 1, 1)}`, entries};
}

/**
 * Roll a table once, without nested tables. Rows whose conditions fail are left out (with the situation of the state).
 * @param {TableSnapshot} table
 * @param {DrawDeps} deps
 * @param {Set<string>} [excluded]
 * @param {DrawState} [state]
 * @returns {Promise<{results: object[], roll?: object, reason?: "empty"|"impossible"|"invalid"|"conditions",
 *   left?: {entry: object, reasons: object[]}[], ignored?: boolean}>}
 */
export async function pick(table, deps, excluded, state) {
  const {formula, entries} = layout(table);
  const base = entries.filter(entry => !entry.drawn && !excluded?.has(entry.id));
  if ( !base.length ) return {results: [], reason: "empty"};
  const blocked = state?.blocked?.get(table.uuid);
  const open = base.filter(entry => !blocked?.has(entry.id));
  let available = open;
  const left = [];
  if ( state?.situation ) {
    available = [];
    for ( const entry of open ) {
      const verdict = check(entry.conditions, state.situation);
      if ( verdict.ok ) available.push(entry);
      else left.push({entry, reasons: verdict.reasons});
    }
  }
  let ignored = false;
  if ( !available.length ) {
    if ( left.length && (onEmptyOf(table.onEmpty) === "ignore") ) {
      available = open;
      ignored = true;
    }
    else return {results: [], reason: (left.length || blocked?.size) ? "conditions" : "empty", left};
  }
  for ( let i = 0; i < MAX_TRIES; i++ ) {
    let rolled;
    try {
      rolled = await deps.roll(formula);
    } catch {
      return {results: [], reason: "invalid", left};
    }
    const hits = available.filter(entry => (rolled.total >= entry.range[0]) && (rolled.total <= entry.range[1]));
    if ( hits.length ) return {results: hits, roll: rolled.roll, left, ignored};
  }
  return {results: [], reason: "impossible", left};
}

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

/**
 * @typedef DrawContext
 * @property {number} depth
 * @property {string[]} chain      The UUIDs of the tables above this one
 * @property {string[]} path       Their names
 * @property {object[]} picks
 * @property {object[]} bag        The rolls of the current draw
 * @property {DrawState} state
 */

/**
 * Draw lines from a table.
 * @param {TableSnapshot} table
 * @param {DrawDeps} deps
 * @param {object} [options]
 * @param {number} [options.times=1]
 * @param {DrawState} [options.state]
 * @param {number} [options.depth=0]
 * @param {string[]} [options.chain]
 * @param {string[]} [options.path]
 * @param {object[]} [options.picks]
 * @param {object[]} [options.bag]    The rolls of the parent draw, a new bag per draw at the top
 * @returns {Promise<Line[]>}
 */
export async function drawTable(table, deps, {times=1, state, depth=0, chain=[], path=[], picks=[], bag}={}) {
  state ??= newState();
  const lines = [];
  const count = Math.min(Math.max(Math.floor(times) || 0, 0), MAX_DRAWS);
  for ( let i = 0; i < count; i++ ) {
    if ( state.count >= MAX_LINES ) break;
    const ctx = {depth, chain, path, picks, bag: bag ?? [], state};
    const before = lines.length;
    const empty = await drawOnce(table, deps, ctx, lines);
    if ( empty && (lines.length === before) ) {
      if ( i > 0 ) state.ranOut = true;
      break;
    }
  }
  return lines;
}

/**
 * One draw: roll the table, follow what it gives.
 * @param {TableSnapshot} table
 * @param {DrawDeps} deps
 * @param {DrawContext} ctx
 * @param {Line[]} lines
 * @returns {Promise<boolean>}   True when the table had nothing to give
 */
async function drawOnce(table, deps, ctx, lines) {
  const {state} = ctx;
  if ( !state.exclude.has(table.uuid) ) state.exclude.set(table.uuid, new Set());
  const exclude = state.exclude.get(table.uuid);
  const exclusive = !!(table.distinct || !table.replacement || table.memory);
  for ( let attempt = 0; attempt < MAX_TRIES; attempt++ ) {
    const {results, roll, reason, left, ignored} = await pick(table, deps, exclude, state);
    recordLeft(state, table, left);
    if ( ignored ) addProblem(state, {kind: "conditionsIgnored", table: table.name, uuid: table.uuid});
    if ( reason === "conditions" ) {
      // A table inside another one hands back, the table above picks another row
      if ( (onEmptyOf(table.onEmpty) === "reroll") && (ctx.depth > 0) ) state.handBack = true;
      else addProblem(state, {kind: "conditions", table: table.name, uuid: table.uuid});
      return true;
    }
    if ( reason ) {
      state.problems.push({kind: reason, table: table.name, uuid: table.uuid});
      return true;
    }
    if ( roll ) ctx.bag.push(roll);
    let retry = false;
    let gave = false;
    for ( const result of results ) {
      if ( exclusive ) exclude.add(result.id);
      const picks = [...ctx.picks, {t: table.uuid, r: result.id, x: exclusive, m: !table.replacement && !table.pack,
        k: !!table.memory && !table.pack}];
      const got = await linesFor(result, table, deps, {...ctx, picks});
      if ( state.handBack ) {
        state.handBack = false;
        if ( !got.length ) {
          if ( !state.blocked.has(table.uuid) ) state.blocked.set(table.uuid, new Set());
          state.blocked.get(table.uuid).add(result.id);
          retry = true;
          continue;
        }
      }
      if ( got.length ) gave = true;
      lines.push(...got);
    }
    if ( gave || !retry ) return false;
  }
  return false;
}

/**
 * The lines one result gives.
 * @param {object} result
 * @param {TableSnapshot} table
 * @param {DrawDeps} deps
 * @param {DrawContext} ctx
 * @returns {Promise<Line[]>}
 */
async function linesFor(result, table, deps, ctx) {
  const {state, bag} = ctx;
  const newId = deps.newId ?? (() => Math.random().toString(36).slice(2, 10));
  const track = async formula => {
    const rolled = await deps.evaluate(formula);
    bag.push(rolled.roll);
    return rolled.total;
  };
  const formula = String(result.quantity ?? "").trim();
  const quantity = await resolveQuantity(formula, track);
  const path = [...ctx.path, table.name];
  const base = () => ({id: newId(), tableUuid: table.uuid, tableName: table.name, resultId: result.id,
    depth: ctx.depth, path, picks: ctx.picks, formula, invalid: quantity === null, coins: {}, quantity: 0, include: true,
    img: result.img ?? "", rolls: bag, act: lineAction(result.action, table.uuid, result.id)});
  if ( state.count >= MAX_LINES ) return [];
  const here = [...ctx.chain, table.uuid];

  if ( result.type === "document" ) {
    const doc = result.documentUuid ? await deps.loadDoc(result.documentUuid) : null;
    if ( doc?.documentName === "RollTable" ) {
      if ( ctx.depth + 1 > state.maxDepth ) {
        state.problems.push({kind: "depth", table: doc.name});
        return [];
      }
      if ( here.includes(doc.uuid) ) {
        state.problems.push({kind: "cycle", table: doc.name});
        return [];
      }
      const inner = await deps.loadTable(doc.uuid);
      if ( !inner ) {
        state.problems.push({kind: "missing", ref: result.documentUuid});
        return [];
      }
      return drawTable(inner, deps, {times: quantity ?? 1, state, depth: ctx.depth + 1, chain: here, path,
        picks: ctx.picks, bag});
    }
    if ( doc?.documentName === "Item" ) {
      const amount = quantity ?? 1;
      state.count++;
      return [{...base(), kind: "item", uuid: doc.uuid, name: result.name || doc.name, img: doc.img || result.img || "",
        quantity: amount, include: amount > 0}];
    }
    if ( doc ) {
      state.count++;
      return [{...base(), kind: "link", uuid: doc.uuid, name: result.name || doc.name, img: doc.img || result.img || "",
        quantity: quantity ?? 1}];
    }
    // A broken link stays visible as text
    state.problems.push({kind: "missing", ref: result.documentUuid ?? result.name});
  }

  // A text result that is only a link to an item counts as that item (tables of the game systems are built this way)
  if ( result.type !== "document" ) {
    const linked = itemLinkOf(result);
    const doc = linked ? await deps.loadDoc(linked.uuid) : null;
    if ( doc?.documentName === "Item" ) {
      const amount = quantity ?? 1;
      state.count++;
      return [{...base(), kind: "item", uuid: doc.uuid, name: linked.label || doc.name, img: doc.img || result.img || "",
        quantity: amount, include: amount > 0}];
    }
  }

  // Text results: each repeat is expanded on its own, coin texts are summed
  const times = Math.min(quantity ?? 1, MAX_DRAWS);
  const out = [];
  let coinsLine = null;
  for ( let n = 0; n < times; n++ ) {
    if ( state.count + out.length >= MAX_LINES ) break;
    const extra = [];
    const sub = {...ctx, chain: here, path, extra};
    const name = await expandText(result.name, deps, sub);
    const html = await expandText(result.description, deps, sub);
    const parts = deps.coinParts(name) ?? (name ? null : deps.coinParts(html));
    if ( parts ) {
      coinsLine ??= {...base(), kind: "coins", name: plainText(name || html), include: false};
      for ( const part of parts ) {
        const amount = await resolveQuantity(part.formula, track);
        coinsLine.coins[part.key] = (coinsLine.coins[part.key] ?? 0) + (amount ?? 0);
      }
      coinsLine.picks = [...coinsLine.picks, ...extra.flat()];
      continue;
    }
    const text = [plainText(name), plainText(html)].filter(Boolean).join(": ");
    out.push({...base(), kind: "text", name: plainText(name), html, text: text || "–",
      picks: [...ctx.picks, ...extra.flat()]});
  }
  if ( coinsLine ) {
    coinsLine.include = Object.values(coinsLine.coins).some(n => n > 0);
    out.unshift(coinsLine);
  }
  state.count += out.length;
  return out;
}

/**
 * Expand the markup of a text: inline rolls become numbers, @Table references become the drawn result.
 * @param {string} source
 * @param {DrawDeps} deps
 * @param {DrawContext & {extra?: object[][]}} ctx
 * @returns {Promise<string>}
 */
async function expandText(source, deps, ctx) {
  let text = String(source ?? "");
  if ( !hasMarkup(text) ) return text;
  text = await replaceAsync(text, INLINE_ROLL, async (match, formula) => {
    try {
      const rolled = await deps.evaluate(normalizeFormula(formula));
      if ( !Number.isFinite(Number(rolled.total)) ) return match;
      ctx.bag.push(rolled.roll);
      return String(rolled.total);
    } catch {
      return match;
    }
  });
  text = await replaceAsync(text, TABLE_REF, async (match, ref) => {
    const inner = await deps.findTable(ref.trim());
    if ( !inner ) {
      ctx.state.problems.push({kind: "missing", ref: ref.trim()});
      return match;
    }
    if ( ctx.chain.includes(inner.uuid) ) {
      ctx.state.problems.push({kind: "cycle", table: inner.name});
      return match;
    }
    if ( ctx.depth + 1 > ctx.state.maxDepth ) {
      ctx.state.problems.push({kind: "depth", table: inner.name});
      return match;
    }
    const drawn = await drawTable(inner, deps, {times: 1, state: ctx.state, depth: ctx.depth + 1, chain: ctx.chain,
      path: ctx.path, picks: [], bag: ctx.bag});
    if ( ctx.state.handBack ) {
      ctx.state.handBack = false;
      addProblem(ctx.state, {kind: "conditions", table: inner.name, uuid: inner.uuid});
    }
    ctx.extra?.push(drawn.flatMap(line => line.picks));
    return drawn.map(line => lineText(line, deps)).join(", ");
  });
  return text;
}

/**
 * A line as a short text, for the place of an @Table reference.
 * @param {Line} line
 * @param {DrawDeps} [deps]
 * @returns {string}
 */
export function lineText(line, deps) {
  if ( line.kind === "item" ) return (line.quantity > 1) ? `${line.name} (${line.quantity})` : line.name;
  if ( line.kind === "coins" ) return coinsText(line.coins, deps?.coinLabel);
  if ( line.kind === "link" ) return line.name;
  return line.text ?? line.name;
}

/**
 * Coins as text, for example "12 gp, 5 sp".
 * @param {Record<string, number>} coins
 * @param {(key: string) => string} [label]
 * @returns {string}
 */
export function coinsText(coins, label=k => k) {
  return Object.entries(coins ?? {}).filter(([, n]) => n > 0).map(([key, n]) => `${n} ${label(key)}`).join(", ");
}

/* -------------------------------------------- */
/*  What lines mean for the table               */
/* -------------------------------------------- */

/**
 * The results that may not come up again while these lines stand: used to draw one line again or to draw more.
 * @param {Line[]} lines
 * @returns {Map<string, Set<string>>}
 */
export function excludeFromLines(lines) {
  const exclude = new Map();
  for ( const line of lines ) {
    for ( const pick of line.picks ?? [] ) {
      if ( !pick.x ) continue;
      if ( !exclude.has(pick.t) ) exclude.set(pick.t, new Set());
      exclude.get(pick.t).add(pick.r);
    }
  }
  return exclude;
}

/**
 * The results to mark as drawn when lines are shown: tables without replacement outside compendiums.
 * @param {Line[]} lines
 * @returns {Map<string, string[]>}   Result ids by table UUID
 */
export function drawnMarks(lines) {
  const marks = new Map();
  for ( const line of lines ) {
    for ( const pick of line.picks ?? [] ) {
      if ( !pick.m ) continue;
      if ( !marks.has(pick.t) ) marks.set(pick.t, new Set());
      marks.get(pick.t).add(pick.r);
    }
  }
  return new Map([...marks].map(([uuid, ids]) => [uuid, [...ids]]));
}

/**
 * What the included lines add up to.
 * @param {Line[]} lines
 * @returns {{items: number, coins: Record<string, number>}}
 */
export function summarize(lines) {
  let items = 0;
  const coins = {};
  for ( const line of lines ) {
    if ( !line.include ) continue;
    if ( (line.kind === "item") && (line.quantity > 0) ) items++;
    if ( line.kind === "coins" ) {
      for ( const [key, n] of Object.entries(line.coins) ) coins[key] = (coins[key] ?? 0) + Math.max(Math.floor(n) || 0, 0);
    }
  }
  return {items, coins};
}
