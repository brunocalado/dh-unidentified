/*!
 * Daggerheart: Unidentified Items
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

// ============================================================
// dh-unidentified | constants.js
// Single source of truth for the module ID and other constants
// shared across all scripts. Import MODULE_ID from here instead
// of defining it locally in each file.
// ============================================================

/** @type {string} The module's unique ID as declared in module.json. */
export const MODULE_ID = "dh-unidentified";

/**
 * Audience modes for an identify-roll result — governs both the chat message
 * and the success/failure sound, which always share the same audience.
 * @enum {string}
 */
export const IDENTIFY_PRIVACY = {
  /** Everyone at the table sees the result and hears the sound. */
  PUBLIC:  "public",
  /** Only the player who rolled and the GMs see the result and hear the sound. */
  PRIVATE: "private",
};
