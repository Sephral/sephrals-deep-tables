/**
 * Give the result of a roll to a character: items (stacked when the character has them), coins into the purse.
 */

import {esc, t} from "./config.mjs";
import {coinLabel, coinUpdate, purseKind} from "./coins.mjs";
import {coinsText} from "./draw.mjs";
import {trace} from "./debug.mjs";

/**
 * Plain data of an item to put on an actor.
 * @param {Item} item
 * @returns {object}
 */
export function itemData(item) {
  let data;
  try {
    data = item.constructor.fromCompendium?.(item, {clearOwnership: true, keepId: false});
  } catch {
    data = null;
  }
  data ??= item.toObject();
  delete data._id;
  foundry.utils.setProperty(data, "_stats.compendiumSource", item._stats?.compendiumSource ?? item.uuid);
  return data;
}

/**
 * Does an item have a quantity?
 * @param {object} data
 * @returns {boolean}
 */
function hasQuantity(data) {
  return foundry.utils.hasProperty(data, "system.quantity");
}

/**
 * The item of an actor that new copies of this item add to, if there is one: same type and name, from the same source,
 * outside a container and not worn.
 * @param {Actor} actor
 * @param {object} data
 * @returns {Item|null}
 */
function findStack(actor, data) {
  if ( !hasQuantity(data) || (data.type === "container") ) return null;
  const source = data._stats?.compendiumSource ?? null;
  for ( const item of actor.items ) {
    if ( (item.type !== data.type) || (item._source.name !== data.name) ) continue;
    if ( item.system?.container || item.system?.equipped || item.system?.attuned ) continue;
    const other = item._stats?.compendiumSource ?? null;
    if ( source && other && (source !== other) ) continue;
    if ( !hasQuantity(item._source) ) continue;
    return item;
  }
  return null;
}

/**
 * Give items and coins to an actor.
 * @param {Actor} actor
 * @param {import("./merge.mjs").CardLine[]} lines
 * @returns {Promise<{items: number, coins: Record<string, number>, skippedCoins: Record<string, number>,
 *   failed: string[]}>}
 */
export async function giveToActor(actor, lines) {
  const result = {items: 0, coins: {}, skippedCoins: {}, failed: []};
  for ( const line of lines ) {
    if ( line.kind === "item" ) {
      try {
        const item = await fromUuid(line.uuid);
        if ( !item || (item.documentName !== "Item") ) throw new Error("not an item");
        await addItem(actor, item, Math.max(Math.floor(line.quantity) || 1, 1));
        result.items++;
      } catch(err) {
        console.warn("sephrals-deep-tables | could not give", line.name, err);
        result.failed.push(line.name);
      }
    }
    else if ( line.kind === "coins" ) {
      const {update, given, skipped} = coinUpdate(actor, line.coins);
      if ( update ) await actor.update(update);
      for ( const [key, n] of Object.entries(given) ) result.coins[key] = (result.coins[key] ?? 0) + n;
      for ( const [key, n] of Object.entries(skipped) ) result.skippedCoins[key] = (result.skippedCoins[key] ?? 0) + n;
    }
  }
  trace.add("given", {actor: actor.name, items: result.items, coins: result.coins, failed: result.failed});
  return result;
}

/**
 * Put copies of an item on an actor: one stack when the item has a quantity, else single copies.
 * @param {Actor} actor
 * @param {Item} item
 * @param {number} quantity
 */
export async function addItem(actor, item, quantity) {
  const data = itemData(item);
  if ( (item.type === "container") && (typeof Item.implementation.createWithContents === "function") ) {
    for ( let i = 0; i < Math.min(quantity, 20); i++ ) {
      await Item.implementation.createWithContents([item], {parent: actor});
    }
    return;
  }
  if ( hasQuantity(data) ) {
    const stack = findStack(actor, data);
    if ( stack ) {
      await stack.update({"system.quantity": (Number(stack.system.quantity) || 0) + quantity});
      return;
    }
    foundry.utils.setProperty(data, "system.quantity", quantity);
    await actor.createEmbeddedDocuments("Item", [data]);
    return;
  }
  const copies = Math.min(quantity, 50);
  await actor.createEmbeddedDocuments("Item", Array.from({length: copies}, () => foundry.utils.deepClone(data)));
}

/**
 * The characters the GM can choose from, the selected tokens first.
 * @returns {{label: string, actors: Actor[]}[]}
 */
function actorGroups() {
  const selected = [...new Set((canvas?.tokens?.controlled ?? []).map(token => token.actor).filter(Boolean))];
  const seen = new Set(selected.map(a => a.id));
  const rest = game.actors.contents.filter(a => !seen.has(a.id));
  const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
  const heroes = rest.filter(a => a.hasPlayerOwner).sort(byName);
  const heroIds = new Set(heroes.map(a => a.id));
  const others = rest.filter(a => !heroIds.has(a.id)).sort(byName);
  return [
    {label: t("SDT.Give.selected"), actors: selected},
    {label: t("SDT.Give.heroes"), actors: heroes},
    {label: t("SDT.Give.others"), actors: others}
  ].filter(group => group.actors.length);
}

/**
 * The text of a line for a list.
 * @param {import("./merge.mjs").CardLine} line
 * @returns {string}
 */
export function lineLabel(line) {
  if ( line.kind === "coins" ) return coinsText(line.coins, coinLabel);
  return (line.quantity > 1) ? `${line.name} × ${line.quantity}` : line.name;
}

/**
 * Ask the GM which character gets which lines.
 * @param {import("./merge.mjs").CardLine[]} lines
 * @returns {Promise<{actor: Actor, lines: import("./merge.mjs").CardLine[]}|null>}
 */
export async function askGive(lines) {
  const giveable = lines.filter(line => (line.kind === "item") || (line.kind === "coins"));
  if ( !giveable.length ) {
    ui.notifications.info(t("SDT.Give.nothing"));
    return null;
  }
  const groups = actorGroups();
  if ( !groups.length ) {
    ui.notifications.info(t("SDT.Give.noActors"));
    return null;
  }
  const options = groups.map(group => `<optgroup label="${esc(group.label)}">${group.actors
    .map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</optgroup>`).join("");
  const rows = giveable.map((line, i) => `<label class="sdt-check"><input type="checkbox" name="pick" value="${i}" checked>`
    + `${line.img ? `<img src="${esc(line.img)}" alt="">` : `<i class="fa-solid fa-coins" inert></i>`} ${esc(lineLabel(line))}</label>`).join("");
  const noPurse = !purseKind() && giveable.some(line => line.kind === "coins");
  const content = `<div class="sdt-give"><div class="form-group"><label>${esc(t("SDT.Give.to"))}</label>`
    + `<select name="actorId">${options}</select></div><div class="sdt-give-list">${rows}</div>`
    + (noPurse ? `<p class="hint">${esc(t("SDT.Give.noPurse"))}</p>` : "") + `</div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: {title: t("SDT.Give.title"), icon: "fa-solid fa-hand-holding-hand"},
    position: {width: 420},
    content,
    rejectClose: false,
    ok: {label: t("SDT.Give.ok"), callback: (event, button) => {
      const form = button.form;
      return {actorId: form.elements.actorId.value,
        picks: [...form.querySelectorAll("input[name=pick]:checked")].map(input => Number(input.value))};
    }}
  });
  if ( !result?.picks?.length ) return null;
  const actor = game.actors.get(result.actorId);
  if ( !actor ) return null;
  return {actor, lines: result.picks.map(i => giveable[i])};
}
