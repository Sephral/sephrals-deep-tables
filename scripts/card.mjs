/**
 * The result card: one chat message for a whole roll, with the dice rolls attached. The content is plain HTML, so it
 * reads without the module; the buttons for the GM are added when the message is shown (toolbar.mjs) from the data
 * kept in the flags, so they work after a reload as well.
 */

import {MODULE_ID, esc, imageOr, t} from "./config.mjs";
import {coinLabel} from "./coins.mjs";
import {coinsText} from "./draw.mjs";
import {mergeLines} from "./merge.mjs";
import {resolveMode, visibility} from "./modes.mjs";
import {trace} from "./debug.mjs";
import {countFeature} from "./usage.mjs";

/** The most dice rolls attached to one message. */
const MAX_ROLLS = 30;

/**
 * The enricher of the running Foundry.
 * @returns {{enrichHTML: Function}}
 */
function editor() {
  return foundry.applications.ux.TextEditor.implementation;
}

/**
 * What Foundry's chat setting says for this user: 13 stores the roll mode, 14 the message mode.
 * @returns {string}
 */
function chatSetting() {
  const key = game.settings.settings.has("core.messageMode") ? "messageMode" : "rollMode";
  return game.settings.get("core", key);
}

/**
 * The text of a problem the roll ran into.
 * @param {{kind: string, table?: string, ref?: string}} problem
 * @returns {string}
 */
export function problemText(problem) {
  const key = `SDT.Problem.${problem.kind}`;
  return game.i18n.has(key) ? t(key, {table: problem.table ?? "", ref: problem.ref ?? ""}) : problem.kind;
}

/**
 * The HTML of one row.
 * @param {import("./merge.mjs").CardLine} line
 * @returns {Promise<string>}
 */
async function rowHtml(line) {
  const qty = (line.quantity > 1) ? `<span class="sdt-qty">× ${line.quantity}</span>` : "";
  if ( line.kind === "coins" ) {
    return `<li class="sdt-row sdt-coins"><span class="sdt-thumb sdt-thumb-icon"><i class="fa-solid fa-coins" inert></i></span>`
      + `<span class="sdt-name">${esc(coinsText(line.coins, coinLabel))}</span></li>`;
  }
  if ( (line.kind === "item") || (line.kind === "link") ) {
    const label = String(line.name).replace(/[\]}]/g, "");
    const link = await editor().enrichHTML(`@UUID[${line.uuid}]{${label}}`);
    return `<li class="sdt-row sdt-${line.kind}"><img class="sdt-thumb" src="${esc(imageOr(line.img))}" alt="">`
      + `<span class="sdt-name">${link}</span>${qty}</li>`;
  }
  const body = line.html ? await editor().enrichHTML(line.html) : "";
  const title = line.name ? `<strong>${esc(line.name)}</strong>` : "";
  const content = (title || body) ? `${title}${title && body ? " " : ""}${body}` : esc(line.text ?? "");
  const qtyText = (line.quantity > 1) ? `<span class="sdt-qty">× ${line.quantity}</span>` : "";
  return `<li class="sdt-row sdt-text"><span class="sdt-thumb sdt-thumb-icon"><i class="fa-solid fa-scroll" inert></i></span>`
    + `<span class="sdt-name sdt-prose">${content}</span>${qtyText}</li>`;
}

/**
 * The content of the card.
 * @param {object} data
 * @param {{name: string, img: string}} data.table
 * @param {import("./merge.mjs").CardLine[]} data.lines
 * @param {string[]} data.notes
 * @param {number} data.draws
 * @returns {Promise<string>}
 */
export async function cardHtml({table, lines, notes, draws}) {
  const rows = (await Promise.all(lines.map(rowHtml))).join("");
  const sub = (draws > 1) ? `<small>${esc(t("SDT.Card.draws", {count: draws}))}</small>` : "";
  const problems = notes.length ? `<ul class="sdt-notes">${notes.map(n => `<li><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(n)}</li>`).join("")}</ul>` : "";
  return `<div class="sdt-card"><header class="sdt-card-head"><img src="${esc(imageOr(table.img))}" alt="">`
    + `<div><strong>${esc(table.name)}</strong>${sub}</div></header><ul class="sdt-rows">${rows}</ul>${problems}</div>`;
}

/**
 * Post the card for a roll.
 * @param {object} data
 * @param {RollTable} data.table
 * @param {import("./draw.mjs").Line[]} data.lines     All lines of the roll, the included ones are shown
 * @param {Roll[]} [data.rolls]                         Rolls outside the lines, like the number of draws
 * @param {{kind: string}[]} [data.problems]
 * @param {string} [data.mode]                          Visibility of the table
 * @param {number} [data.draws]
 * @returns {Promise<ChatMessage|null>}
 */
export async function postCard({table, lines, rolls = [], problems = [], mode = "foundry", draws = 1}) {
  const shown = lines.filter(line => line.include);
  const merged = mergeLines(shown);
  if ( !merged.length ) return null;
  const bags = new Set(shown.map(line => line.rolls));
  const all = [...rolls, ...[...bags].flat()].filter(Boolean).slice(0, MAX_ROLLS);
  const notes = [...new Set(problems.filter(p => !((p.kind === "empty") && (p.uuid === table.uuid))).map(problemText))];
  const content = await cardHtml({table: {name: table.name, img: table.img}, lines: merged, notes, draws});
  const visible = resolveMode(mode, chatSetting());
  const data = {
    content,
    rolls: all,
    speaker: ChatMessage.implementation.getSpeaker(),
    flags: {[MODULE_ID]: {card: {v: 1, table: {uuid: table.uuid, name: table.name, img: table.img}, mode, draws,
      lines: merged.map(({html, ...rest}) => rest), given: []}}},
    ...visibility(visible, {userId: game.user.id, gmIds: game.users.filter(u => u.isGM).map(u => u.id)})
  };
  if ( all.length ) data.sound = CONFIG.sounds?.dice ?? null;
  const message = await ChatMessage.implementation.create(data);
  trace.add("card posted", {table: table.name, rows: merged.length, rolls: all.length, mode: visible,
    messageId: message?.id});
  countFeature(MODULE_ID, "cardPosted");
  return message;
}

/**
 * The card data of a message.
 * @param {ChatMessage} message
 * @returns {object|null}
 */
export function cardOf(message) {
  const card = message?.flags?.[MODULE_ID]?.card;
  return card?.lines ? card : null;
}
