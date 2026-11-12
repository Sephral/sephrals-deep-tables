/**
 * Pure helpers for the visibility of a result card. The module sets whisper and blind itself, so the same code runs on
 * Foundry 13 (roll modes) and 14 (message modes).
 */

/** The visibilities a table can have; "foundry" follows the chat setting of the user who rolls. */
export const MODES = ["foundry", "public", "gm", "blind", "self"];

/**
 * The visibility of Foundry's chat setting: 13 stores "publicroll", "gmroll", "blindroll" and "selfroll", 14 stores
 * "public", "gm", "blind", "self" or "ic".
 * @param {string} value
 * @returns {"public"|"gm"|"blind"|"self"}
 */
export function foundryMode(value) {
  const map = {publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self", public: "public", gm: "gm",
    blind: "blind", self: "self"};
  return map[value] ?? "public";
}

/**
 * The real visibility for a table setting.
 * @param {string} mode
 * @param {string} chatSetting   The user's chat setting
 * @returns {"public"|"gm"|"blind"|"self"}
 */
export function resolveMode(mode, chatSetting) {
  return (MODES.includes(mode) && (mode !== "foundry")) ? mode : foundryMode(chatSetting);
}

/**
 * Whisper and blind for a visibility.
 * @param {"public"|"gm"|"blind"|"self"} mode
 * @param {{userId: string, gmIds: string[]}} users
 * @returns {{whisper: string[], blind: boolean}}
 */
export function visibility(mode, {userId, gmIds}) {
  if ( mode === "self" ) return {whisper: [userId], blind: false};
  if ( mode === "gm" ) return {whisper: [...new Set([userId, ...gmIds])], blind: false};
  if ( mode === "blind" ) return {whisper: [...gmIds], blind: true};
  return {whisper: [], blind: false};
}
