/**
 * The GM's buttons on a result card: give to a character, leave as an Item Pile, add to the Loot Ledger, roll again.
 * The card's content is static HTML, the buttons are added when the message is shown, from the flags.
 */

import {MODULE_ID, esc, setting, t} from "./config.mjs";
import {ACTION_META} from "./actions.mjs";
import {runRowAction, runsOf, undoRowAction} from "./act.mjs";
import {addToLedger, ledgerApi, pilesApi, placePile} from "./bridges.mjs";
import {cardOf} from "./card.mjs";
import {coinLabel} from "./coins.mjs";
import {coinsText} from "./draw.mjs";
import {drawNow} from "./flow.mjs";
import {askGive, giveToActor} from "./give.mjs";
import {countFeature} from "./usage.mjs";

/**
 * Hook "renderChatMessageHTML": theme for everybody, buttons for the GM.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function onRenderChatMessage(message, html) {
  const card = cardOf(message);
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const root = card ? element?.querySelector(".sdt-card") : null;
  if ( !root ) return;
  root.dataset.sdtTheme = setting("theme");
  if ( !game.user.isGM || root.querySelector(".sdt-toolbar") ) return;
  const buttons = [...handOverButtons(), {action: "again", icon: "fa-dice", label: t("SDT.Card.again")}];
  const bar = document.createElement("div");
  bar.className = "sdt-toolbar";
  bar.innerHTML = buttons.map(b => `<button type="button" data-sdt-action="${b.action}" data-tooltip="${esc(b.label)}"`
    + ` aria-label="${esc(b.label)}"><i class="fa-solid ${b.icon}" inert></i><span>${esc(b.label)}</span></button>`).join("");
  root.append(bar);
  for ( const button of bar.querySelectorAll("button") ) {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      run(message, button.dataset.sdtAction, button);
    });
  }
  addActionButtons(message, root, card);
  const given = card.given ?? [];
  if ( given.length ) {
    const list = document.createElement("ul");
    list.className = "sdt-given";
    list.innerHTML = given.map(g => `<li><i class="fa-solid fa-check" inert></i> ${esc(g.text)}</li>`).join("");
    root.append(list);
  }
}

/**
 * The buttons of the results that act: one beside the row, or what it did with a button to take it back.
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 * @param {object} card
 */
function addActionButtons(message, root, card) {
  const runs = runsOf(message);
  for ( const li of root.querySelectorAll("li[data-sdt-key]") ) {
    const row = card.lines.find(line => line.key === li.dataset.sdtKey);
    if ( !row?.act || li.querySelector(".sdt-act") ) continue;
    const meta = ACTION_META[row.act.type];
    if ( !meta ) continue;
    const run = runs.find(entry => entry.k === row.key);
    const box = document.createElement("span");
    box.className = "sdt-act";
    if ( run ) {
      const undoable = !!((run.undo?.tokens?.length) || (run.undo?.effects?.length));
      box.innerHTML = `<span class="sdt-act-done"><i class="fa-solid fa-check" inert></i> ${esc(run.text)}</span>`
        + (undoable ? `<button type="button" class="sdt-act-undo" data-tooltip="${esc(t("SDT.Action.undoHint"))}">`
        + `<i class="fa-solid fa-rotate-left" inert></i><span>${esc(t("SDT.Action.undo"))}</span></button>` : "");
    }
    else {
      const label = t(meta.button);
      box.innerHTML = `<button type="button" class="sdt-act-run" data-tooltip="${esc(t(`SDT.Action.type.${row.act.type}`))}">`
        + `<i class="fa-solid ${meta.icon}" inert></i><span>${esc(label)}</span></button>`
        + (row.act.auto ? `<small class="sdt-act-auto">${esc(t("SDT.Action.autoShort"))}</small>` : "");
    }
    li.append(box);
    box.querySelector(".sdt-act-run")?.addEventListener("click", event => runActionButton(event, message, row));
    box.querySelector(".sdt-act-undo")?.addEventListener("click", event => runActionButton(event, message, row, true));
  }
}

/**
 * A click on the button of a result that acts.
 * @param {Event} event
 * @param {ChatMessage} message
 * @param {object} row
 * @param {boolean} [undo]
 */
async function runActionButton(event, message, row, undo = false) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if ( undo ) await undoRowAction(message, row.key);
    else await runRowAction(message, row);
  } catch(err) {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(t("SDT.Error.action"));
  } finally {
    button.disabled = false;
  }
}

/**
 * Remember where the result went.
 * @param {ChatMessage} message
 * @param {string} text
 */
async function noteGiven(message, text) {
  const card = cardOf(message);
  const given = [...(card?.given ?? []), {text}];
  await message.update({[`flags.${MODULE_ID}.card.given`]: given});
}

/**
 * The ways to hand results over that this world offers: give to a character, Item Pile, Loot Ledger.
 * @returns {{action: string, icon: string, label: string}[]}
 */
export function handOverButtons() {
  return [
    {action: "give", icon: "fa-hand-holding-hand", label: t("SDT.Card.give")},
    pilesApi() ? {action: "pile", icon: "fa-box-open", label: t("SDT.Card.pile")} : null,
    ledgerApi() ? {action: "ledger", icon: "fa-sack", label: t("SDT.Card.ledger")} : null
  ].filter(Boolean);
}

/**
 * Hand rows over: give them to a character, leave them as an Item Pile or add them to the Loot Ledger.
 * @param {"give"|"pile"|"ledger"} action
 * @param {import("./merge.mjs").CardLine[]} lines
 * @param {string} tableName
 * @returns {Promise<string|null>}   What happened, for the card, or null when nothing was handed over
 */
export async function handOver(action, lines, tableName) {
  if ( action === "give" ) {
    const choice = await askGive(lines);
    if ( !choice ) return null;
    const result = await giveToActor(choice.actor, choice.lines);
    countFeature(MODULE_ID, "givenToActor");
    const parts = [];
    if ( result.items ) parts.push(t("SDT.Give.items", {count: result.items}));
    if ( Object.keys(result.coins).length ) parts.push(coinsText(result.coins, coinLabel));
    const text = t("SDT.Give.done", {name: choice.actor.name, what: parts.join(", ") || "–"});
    ui.notifications.info(text);
    if ( Object.keys(result.skippedCoins).length ) {
      ui.notifications.warn(t("SDT.Give.coinsSkipped", {coins: coinsText(result.skippedCoins, coinLabel)}));
    }
    if ( result.failed.length ) ui.notifications.warn(t("SDT.Give.failed", {names: result.failed.join(", ")}));
    return parts.length ? text : null;
  }
  if ( action === "pile" ) {
    if ( !await placePile(lines, tableName) ) return null;
    countFeature(MODULE_ID, "pileCreated");
    return t("SDT.Pile.note");
  }
  if ( action === "ledger" ) {
    if ( !await addToLedger(lines, tableName) ) return null;
    countFeature(MODULE_ID, "ledgerAdded");
    return t("SDT.Ledger.note");
  }
  return null;
}

/**
 * Run a button of the toolbar.
 * @param {ChatMessage} message
 * @param {string} action
 * @param {HTMLElement} button
 */
async function run(message, action, button) {
  const card = cardOf(message);
  if ( !card ) return;
  button.disabled = true;
  try {
    if ( action === "again" ) {
      await drawNow(card.table.uuid, {mode: card.mode});
    }
    else {
      const text = await handOver(action, card.lines, card.table.name);
      if ( text ) await noteGiven(message, text);
    }
  } catch(err) {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(t("SDT.Error.action"));
  } finally {
    button.disabled = false;
  }
}
