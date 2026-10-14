/*!
 * Daggerheart: Unidentified Items
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

// ============================================================
// dh-unidentified | helpers.js
// Shared helpers used across scripts.
// ============================================================

/**
 * Shows a localized notification with the module prefix.
 * The prefix is the module's name, so it stays out of the translation files.
 * @param {"info"|"warn"|"error"} type
 * @param {string} key  - Key under DH_UNIDENTIFIED.NOTIFY
 * @param {object} [data] - Interpolation values for the string
 * @returns {void}
 */
export function notify(type, key, data) {
  ui.notifications[type](`[DH Unidentified] ${game.i18n.localize(`DH_UNIDENTIFIED.NOTIFY.${key}`, data)}`);
}
