/**
 * @DeepTable[UUID or name]{Text} in journals, chat and item descriptions: a link that draws from the table when clicked
 * (Shift opens the deep roll). Players only get a working link for tables they can see.
 */

import {MODULE_ID, esc, t} from "./config.mjs";
import {openDeepRoll} from "./deep-app.mjs";
import {resolveTable} from "./engine.mjs";
import {canRoll, drawNow} from "./flow.mjs";
import {countFeature} from "./usage.mjs";

/** @DeepTable[ref]{label} */
const PATTERN = /@DeepTable\[([^\]]+)\](?:\{([^}]*)\})?/gi;

/**
 * The table of a reference that can be read at once: a UUID of a loaded document, an id or a name.
 * @param {string} ref
 * @returns {RollTable|object|null}
 */
function lookup(ref) {
  const text = ref.trim();
  if ( text.includes(".") ) {
    const doc = fromUuidSync(text, {strict: false});
    if ( doc ) return doc;
  }
  return game.tables.get(text) ?? game.tables.getName(text) ?? null;
}

/**
 * The enricher of the pattern.
 * @param {RegExpMatchArray} match
 * @returns {Promise<HTMLElement>}
 */
async function enrich(match) {
  const ref = match[1].trim();
  const label = (match[2] || "").trim();
  const found = lookup(ref);
  const name = label || found?.name || ref;
  const span = document.createElement("a");
  const visible = found && (game.user.isGM || found.pack || found.testUserPermission?.(game.user, "OBSERVER")
    || (found.visible ?? false));
  if ( !found || !visible ) {
    span.className = "sdt-roll sdt-disabled";
    span.dataset.tooltip = t("SDT.Journal.unavailable");
  }
  else {
    span.className = "sdt-roll";
    span.dataset.sdtTable = found.uuid;
    span.dataset.tooltip = t("SDT.Journal.tooltip");
  }
  span.innerHTML = `<i class="fa-solid fa-dice" inert></i> ${esc(name)}`;
  return span;
}

/**
 * Register the enricher and the click handler. Call in "init".
 */
export function registerEnrichers() {
  CONFIG.TextEditor.enrichers.push({pattern: PATTERN, enricher: enrich});
  document.addEventListener("click", async event => {
    const link = event.target?.closest?.(".sdt-roll[data-sdt-table]");
    if ( !link ) return;
    event.preventDefault();
    event.stopPropagation();
    const table = await resolveTable(link.dataset.sdtTable);
    if ( !table || !canRoll(table) ) return;
    countFeature(MODULE_ID, "journalRoll");
    if ( event.shiftKey ) await openDeepRoll(table);
    else await drawNow(table);
  }, true);
}
