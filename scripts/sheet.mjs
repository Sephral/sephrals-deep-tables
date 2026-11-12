/**
 * What the module adds to Foundry's roll table sheet, sidebar and compendiums: header buttons, the context menu,
 * fields in edit mode (draws, no duplicates, visibility, a quantity per result), and in view mode the chance of every
 * row and a note with the table's settings.
 */

import {MODULE_ID, esc, isActive, setting, t} from "./config.mjs";
import {chances, formatChance} from "./chances.mjs";
import {openDeepRoll} from "./deep-app.mjs";
import {settingsOf} from "./engine.mjs";
import {canRoll, drawNow} from "./flow.mjs";
import {MODES} from "./modes.mjs";
import {openImport} from "./import-app.mjs";

/** The flag names of the table fields. */
const FLAG = `flags.${MODULE_ID}`;

/**
 * A context menu entry that works in Foundry 13 and 14 (both sets of keys, 14 prefers its own).
 * @param {object} entry
 * @param {string} entry.label       Translation key
 * @param {string} entry.icon        Font Awesome classes
 * @param {(li: HTMLElement) => boolean} [entry.visible]
 * @param {(li: HTMLElement) => void} entry.run
 * @returns {object}
 */
function menuEntry({label, icon, visible, run}) {
  const element = li => ((li instanceof HTMLElement) ? li : li?.[0]);
  return {
    name: label,
    label,
    icon: `<i class="${icon}"></i>`,
    condition: li => (visible ? visible(element(li)) : true),
    visible: li => (visible ? visible(element(li)) : true),
    callback: li => run(element(li)),
    onClick: (event, li) => run(element(li))
  };
}

/**
 * The table behind a sidebar or compendium entry.
 * @param {Application} app
 * @param {HTMLElement} li
 * @returns {Promise<RollTable|null>}
 */
async function tableOf(app, li) {
  const id = li?.dataset.entryId ?? li?.dataset.documentId;
  if ( !id ) return null;
  const pack = (app?.collection?.metadata && (typeof app.collection.getDocument === "function")) ? app.collection : null;
  return pack ? pack.getDocument(id) : game.tables.get(id);
}

/**
 * Hook "getRollTableContextOptions": roll from the sidebar or a compendium.
 * @param {Application} app
 * @param {object[]} entries
 */
export function onGetRollTableContextOptions(app, entries) {
  const visible = li => {
    const id = li?.dataset.entryId ?? li?.dataset.documentId;
    const table = id ? game.tables.get(id) : null;
    return table ? canRoll(table) : true;
  };
  entries.push(
    menuEntry({label: "SDT.Menu.deep", icon: "fa-solid fa-dice", visible,
      run: async li => {
        const table = await tableOf(app, li);
        if ( table ) await openDeepRoll(table);
      }}),
    menuEntry({label: "SDT.Menu.now", icon: "fa-solid fa-dice-d20", visible,
      run: async li => {
        const table = await tableOf(app, li);
        if ( table ) await drawNow(table);
      }})
  );
}

/**
 * Hook "getHeaderControlsRollTableSheet": the two ways to roll in the table's window.
 * @param {RollTableSheet} app
 * @param {object[]} controls
 */
export function onGetHeaderControls(app, controls) {
  if ( !Array.isArray(controls) || !canRoll(app.document) ) return;
  controls.push(
    {icon: "fa-solid fa-dice", label: "SDT.Menu.deep", action: "sdtDeepRoll", onClick: () => openDeepRoll(app.document)},
    {icon: "fa-solid fa-dice-d20", label: "SDT.Menu.now", action: "sdtDrawNow", onClick: () => drawNow(app.document)}
  );
}

/**
 * Hook "renderRollTableDirectory": the button that makes a table from pasted text (GM).
 * @param {Application} app
 * @param {HTMLElement} html
 */
export function onRenderRollTableDirectory(app, html) {
  if ( !game.user.isGM ) return;
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const actions = element?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".sdt-import") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sdt-import";
  button.innerHTML = `<i class="fa-solid fa-file-import" inert></i> <span>${esc(t("SDT.Import.button"))}</span>`;
  button.dataset.tooltip = t("SDT.Import.buttonHint");
  button.addEventListener("click", event => {
    event.preventDefault();
    openImport();
  });
  actions.append(button);
}

/* -------------------------------------------- */
/*  The table sheet                             */
/* -------------------------------------------- */

/**
 * Hook "renderRollTableSheet".
 * @param {RollTableSheet} app
 * @param {HTMLElement} html
 */
export function onRenderRollTableSheet(app, html) {
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  if ( !element ) return;
  const table = app.document;
  const edit = !!element.querySelector("[name=displayRoll], input[name='results.0._id'], [name$='._id']");
  if ( edit && app.isEditable ) editFields(app, element, table);
  else viewDetails(element, table);
}

/**
 * Edit mode: the table's fields, a quantity on every row.
 * @param {RollTableSheet} app
 * @param {HTMLElement} element
 * @param {RollTable} table
 */
function editFields(app, element, table) {
  const anchor = element.querySelector("[name=displayRoll]")?.closest(".form-group");
  if ( anchor && !element.querySelector(".sdt-table-fields") ) {
    const saved = settingsOf(table);
    const own = table.flags?.[MODULE_ID] ?? {};
    const group = document.createElement("fieldset");
    group.className = "sdt-table-fields";
    const modes = MODES.map(mode => `<option value="${mode}" ${((own.mode ?? "foundry") === mode) ? "selected" : ""}>${esc(t(`SDT.Mode.${mode}`))}</option>`).join("");
    group.innerHTML = `<legend>${esc(t("SDT.Sheet.legend"))}</legend>`
      + `<div class="form-group"><label>${esc(t("SDT.Sheet.draws"))}</label><div class="form-fields">`
      + `<input type="text" name="${FLAG}.draws" value="${esc(own.draws ?? "")}" placeholder="${esc(saved.draws)}"></div>`
      + `<p class="hint">${esc(t("SDT.Sheet.drawsHint"))}</p></div>`
      + `<div class="form-group"><label>${esc(t("SDT.Sheet.distinct"))}</label><div class="form-fields">`
      + `<input type="checkbox" name="${FLAG}.distinct" ${saved.distinct ? "checked" : ""}></div>`
      + `<p class="hint">${esc(t("SDT.Sheet.distinctHint"))}</p></div>`
      + `<div class="form-group"><label>${esc(t("SDT.Sheet.mode"))}</label><div class="form-fields">`
      + `<select name="${FLAG}.mode">${modes}</select></div><p class="hint">${esc(t("SDT.Sheet.modeHint"))}</p></div>`;
    anchor.after(group);
  }
  // The Loot Ledger has the same field: one is enough
  if ( isActive("sephrals-loot-ledger") ) return;
  for ( const row of element.querySelectorAll("tr[data-result-id]") ) {
    const details = row.querySelector("td.details");
    if ( !details || details.querySelector(".sdt-quantity") ) continue;
    const result = table.results.get(row.dataset.resultId);
    const idInput = row.querySelector("input[name$='._id']");
    if ( !result || !idInput ) continue;
    const prefix = idInput.name.slice(0, -"._id".length);
    const value = result.flags?.[MODULE_ID]?.quantity ?? "";
    const label = document.createElement("label");
    label.className = "sdt-quantity";
    label.dataset.tooltip = t("SDT.Sheet.quantityHint");
    label.innerHTML = `<i class="fa-solid fa-scroll" inert></i><span>${esc(t("SDT.Sheet.quantityShort"))}</span>`
      + `<input type="text" name="${esc(prefix)}.${FLAG}.quantity" value="${esc(value)}" placeholder="1">`;
    details.append(label);
  }
}

/**
 * View mode: the chance of every row, and for the GM the quantities and the table's settings.
 * @param {HTMLElement} element
 * @param {RollTable} table
 */
function viewDetails(element, table) {
  const rows = [...element.querySelectorAll("tr[data-result-id]")];
  if ( !rows.length ) return;
  const owner = game.user.isGM || table.isOwner;
  if ( setting("showChances") ) {
    const list = rows.map(row => table.results.get(row.dataset.resultId));
    let values;
    if ( table._source?.formula ) values = chances(table.formula, list.map(r => r?.range ?? [1, 1]));
    else {
      const total = list.reduce((sum, r) => sum + (r?.weight ?? 1), 0) || 1;
      values = list.map(r => Math.round(1000 * (r?.weight ?? 1) / total) / 10);
    }
    rows.forEach((row, i) => {
      const cell = row.querySelector("td.range");
      if ( !cell || cell.querySelector(".sdt-chance") ) return;
      const small = document.createElement("small");
      small.className = "sdt-chance";
      small.dataset.tooltip = t("SDT.Sheet.chance");
      small.textContent = formatChance(values[i]);
      cell.append(small);
    });
  }
  if ( !owner ) return;
  const slot = isActive("sephrals-loot-ledger");
  for ( const row of rows ) {
    const details = row.querySelector("td.details");
    const result = table.results.get(row.dataset.resultId);
    const value = result?.flags?.[MODULE_ID]?.quantity ?? (slot ? result?.flags?.["sephrals-loot-ledger"]?.quantity : "");
    if ( !details || !value || details.querySelector(".sdt-quantity") || details.querySelector(".sll-quantity") ) continue;
    const note = document.createElement("small");
    note.className = "sdt-quantity";
    note.dataset.tooltip = t("SDT.Sheet.quantityShort");
    note.innerHTML = `<i class="fa-solid fa-scroll" inert></i> × ${esc(value)}`;
    details.append(note);
  }
  const header = element.querySelector(".sheet-header");
  if ( header && !element.querySelector(".sdt-table-note") ) {
    const saved = settingsOf(table);
    const parts = [];
    if ( saved.draws !== "1" ) parts.push(t("SDT.Sheet.noteDraws", {draws: saved.draws}));
    if ( saved.distinct ) parts.push(t("SDT.Sheet.noteDistinct"));
    if ( saved.mode !== "foundry" ) parts.push(t("SDT.Sheet.noteMode", {mode: t(`SDT.Mode.${saved.mode}`)}));
    if ( parts.length ) {
      const note = document.createElement("p");
      note.className = "sdt-table-note";
      note.innerHTML = `<i class="fa-solid fa-dice" inert></i> ${esc(parts.join(" · "))}`;
      header.after(note);
    }
  }
}

/**
 * Hook "renderTableResultConfig": the quantity formula in the result's own window.
 * @param {TableResultConfig} app
 * @param {HTMLElement} html
 */
export function onRenderTableResultConfig(app, html) {
  if ( !game.user.isGM || isActive("sephrals-loot-ledger") ) return;
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const weight = element?.querySelector("[name=weight]")?.closest(".form-group");
  if ( !weight || element.querySelector(".sdt-quantity-group") ) return;
  const value = app.document.flags?.[MODULE_ID]?.quantity ?? "";
  const id = `${app.id}-sdt-quantity`;
  const group = document.createElement("div");
  group.className = "form-group slim sdt-quantity-group";
  group.innerHTML = `<label for="${esc(id)}">${esc(t("SDT.Sheet.quantity"))}</label>`
    + `<div class="form-fields"><input type="text" id="${esc(id)}" name="${FLAG}.quantity" value="${esc(value)}" placeholder="1"></div>`
    + `<p class="hint">${esc(t("SDT.Sheet.quantityHint"))}</p>`;
  weight.after(group);
}
