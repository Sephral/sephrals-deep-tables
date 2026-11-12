/**
 * The GM's buttons on a result card: give to a character, leave as an Item Pile, add to the Loot Ledger, roll again.
 * The card's content is static HTML, the buttons are added when the message is shown, from the flags.
 */

import {MODULE_ID, esc, setting, t} from "./config.mjs";
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
  const buttons = [
    {action: "give", icon: "fa-hand-holding-hand", label: t("SDT.Card.give")},
    pilesApi() ? {action: "pile", icon: "fa-box-open", label: t("SDT.Card.pile")} : null,
    ledgerApi() ? {action: "ledger", icon: "fa-sack", label: t("SDT.Card.ledger")} : null,
    {action: "again", icon: "fa-dice", label: t("SDT.Card.again")}
  ].filter(Boolean);
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
  const given = card.given ?? [];
  if ( given.length ) {
    const list = document.createElement("ul");
    list.className = "sdt-given";
    list.innerHTML = given.map(g => `<li><i class="fa-solid fa-check" inert></i> ${esc(g.text)}</li>`).join("");
    root.append(list);
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
    else if ( action === "give" ) {
      const choice = await askGive(card.lines);
      if ( !choice ) return;
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
      if ( parts.length ) await noteGiven(message, text);
    }
    else if ( action === "pile" ) {
      if ( await placePile(card.lines, card.table.name) ) {
        countFeature(MODULE_ID, "pileCreated");
        await noteGiven(message, t("SDT.Pile.note"));
      }
    }
    else if ( action === "ledger" ) {
      if ( await addToLedger(card.lines, card.table.name) ) {
        countFeature(MODULE_ID, "ledgerAdded");
        await noteGiven(message, t("SDT.Ledger.note"));
      }
    }
  } catch(err) {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(t("SDT.Error.action"));
  } finally {
    button.disabled = false;
  }
}
