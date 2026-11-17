/**
 * The bridges to other modules, only while they are active: Item Piles (the result becomes a pile on the map) and
 * the Loot Ledger (the result goes into the party's loot).
 */

import {isActive, t} from "./config.mjs";
import {coinString} from "./coins.mjs";
import {rowItemData} from "./give.mjs";
import {trace} from "./debug.mjs";

/**
 * Item Piles' API, if the module is active.
 * @returns {object|null}
 */
export function pilesApi() {
  if ( !isActive("item-piles") ) return null;
  const api = game.itempiles?.API;
  return (api && (typeof api.createItemPile === "function")) ? api : null;
}

/**
 * The Loot Ledger's API, if the module is active.
 * @returns {object|null}
 */
export function ledgerApi() {
  if ( !isActive("sephrals-loot-ledger") ) return null;
  const api = game.modules.get("sephrals-loot-ledger").api;
  return (api && (typeof api.request === "function")) ? api : null;
}

/* -------------------------------------------- */
/*  Item Piles                                  */
/* -------------------------------------------- */

/**
 * Let the GM click a spot on the map. Escape cancels.
 * @returns {Promise<{x: number, y: number}|null>}
 */
export function pickPosition() {
  return new Promise(resolve => {
    const view = canvas?.app?.view;
    if ( !view || !canvas.scene ) return resolve(null);
    const banner = document.createElement("div");
    banner.className = "sdt-pick-banner";
    banner.innerHTML = `<i class="fa-solid fa-hand-pointer" inert></i> ${foundry.utils.escapeHTML(t("SDT.Pile.pick"))}`;
    document.body.append(banner);
    const done = value => {
      view.removeEventListener("pointerdown", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      banner.remove();
      resolve(value);
    };
    const onClick = event => {
      event.preventDefault();
      event.stopPropagation();
      const point = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
      done({x: point.x, y: point.y});
    };
    const onKey = event => {
      if ( event.key !== "Escape" ) return;
      event.preventDefault();
      event.stopPropagation();
      done(null);
    };
    view.addEventListener("pointerdown", onClick, true);
    document.addEventListener("keydown", onKey, true);
  });
}

/**
 * GM: leave the lines as an Item Pile where the GM clicks on the map.
 * @param {import("./merge.mjs").CardLine[]} lines
 * @param {string} name   The table, for the pile's name
 * @returns {Promise<boolean>}
 */
export async function placePile(lines, name) {
  const api = pilesApi();
  if ( !api ) return false;
  if ( !canvas?.scene ) {
    ui.notifications.warn(t("SDT.Pile.noScene"));
    return false;
  }
  const things = lines.filter(line => (line.kind === "item") || (line.kind === "coins"));
  if ( !things.length ) {
    ui.notifications.info(t("SDT.Give.nothing"));
    return false;
  }
  const spot = await pickPosition();
  if ( !spot ) return false;
  const size = canvas.grid?.size ?? 100;
  let position = {x: spot.x - (size / 2), y: spot.y - (size / 2)};
  try {
    position = canvas.grid.getSnappedPoint(position, {mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX});
  } catch {
    position = {x: Math.round(position.x), y: Math.round(position.y)};
  }
  // An empty pile first, then the items through addItems (Item Piles keeps only some of the items handed to
  // createItemPile at once)
  const created = await api.createItemPile({sceneId: canvas.scene.id, position: {x: position.x, y: position.y}});
  const token = created?.tokenUuid ? await fromUuid(created.tokenUuid) : null;
  const pile = token?.actor ?? null;
  if ( !pile ) {
    ui.notifications.warn(t("SDT.Pile.failed"));
    return false;
  }
  let added = 0;
  const coins = {};
  for ( const line of things ) {
    if ( line.kind === "coins" ) {
      for ( const [key, n] of Object.entries(line.coins) ) coins[key] = (coins[key] ?? 0) + n;
      continue;
    }
    try {
      const item = await fromUuid(line.uuid);
      if ( !item ) continue;
      const {data} = rowItemData(item, line);
      if ( foundry.utils.hasProperty(data, "system.quantity") ) foundry.utils.setProperty(data, "system.quantity", 1);
      await api.addItems(pile, [{item: data, quantity: Math.max(Math.floor(line.quantity) || 1, 1)}]);
      added++;
    } catch(err) {
      console.warn("sephrals-deep-tables | item did not go into the pile", line.name, err);
    }
  }
  const text = coinString(coins);
  if ( text ) {
    try {
      await api.addCurrencies(pile, text);
    } catch(err) {
      console.warn("sephrals-deep-tables | coins did not go into the pile", err);
    }
  }
  if ( name ) {
    try {
      await token.update({name});
    } catch {
      // the pile keeps its name
    }
  }
  trace.add("pile", {items: added, coins, scene: canvas.scene.name});
  ui.notifications.info(t("SDT.Pile.done", {count: added}));
  return true;
}

/* -------------------------------------------- */
/*  Loot Ledger                                 */
/* -------------------------------------------- */

/**
 * GM: add the lines to the party's loot.
 * @param {import("./merge.mjs").CardLine[]} lines
 * @param {string} table
 * @returns {Promise<boolean>}
 */
export async function addToLedger(lines, table) {
  const api = ledgerApi();
  if ( !api ) return false;
  const items = lines.filter(line => (line.kind === "item") && line.uuid)
    .map(line => ({uuid: line.uuid, quantity: Math.max(Math.floor(line.quantity) || 1, 1)}));
  let coins = 0;
  const values = new Map(api.adapter().denominations().map(d => [d.key, d.value]));
  for ( const line of lines.filter(l => l.kind === "coins") ) {
    for ( const [key, n] of Object.entries(line.coins) ) coins += n * (values.get(key) ?? 0);
  }
  if ( !items.length && !coins ) {
    ui.notifications.info(t("SDT.Give.nothing"));
    return false;
  }
  const done = await api.request("addRolled", {items, coins, table});
  trace.add("ledger", {items: items.length, coins, done});
  return !!done;
}
