// ============================================================
// dh-unidentified | unidentified.js
// Core logic: mystify, identify, flag read/write helpers.
//
// Architecture: non-destructive unidentified state.
// Real item data (name, img, system.description) is NEVER overwritten.
// Masked presentation values live exclusively in module flags.
// Display helpers are the only sanctioned read path for user-facing UI.
// ============================================================

import { MODULE_ID } from "./constants.js";
import { getDefaultsForType } from "./settings.js";

/** Path to the Handlebars template for the Mystify dialog form. */
const MYSTIFY_TEMPLATE = "modules/dh-unidentified/templates/mystify-dialog.hbs";

// Item types that support the unidentified workflow
export const SUPPORTED_TYPES = ["weapon", "armor", "loot", "consumable"];

/**
 * Flag keys used by this module.
 * REAL_NAME / REAL_IMG / REAL_DESC are legacy-only — written by the old
 * destructive model, read only during one-time migration, then deleted.
 */
const FLAG = {
  IDENTIFIED:    "identified",
  MASK_NAME:     "maskedName",
  MASK_IMG:      "maskedImg",
  MASK_DESC:     "maskedDescription",
  // Legacy backup fields (pre-0.0.3) — never written by current code
  REAL_NAME:     "realName",
  REAL_IMG:      "realImg",
  REAL_DESC:     "realDescription",
};

// ── Core helpers ──────────────────────────────────────────────

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isSupported(item) {
  return SUPPORTED_TYPES.includes(item?.type);
}

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isUnidentified(item) {
  const f = item?.flags?.[MODULE_ID];
  return f !== undefined && f[FLAG.IDENTIFIED] === false;
}

/**
 * @param {Item} item
 * @returns {object}
 */
export function getFlags(item) {
  return item?.flags?.[MODULE_ID] ?? {};
}

// ── Display helpers (non-destructive read path) ───────────────
//
// These are the ONLY sanctioned read path for user-facing presentation.
// They return masked values when the item is unidentified, real values otherwise.
// Call sites must never assume item.name / item.img hold audience-appropriate data.

/**
 * Returns the name that should be shown to the current audience.
 * Always returns real item.name for identified items.
 * Returns the masked alias (from flags) for unidentified items.
 * @param {Item} item
 * @returns {string}
 */
export function getDisplayName(item) {
  if (!isUnidentified(item)) return item.name;
  return getFlags(item)[FLAG.MASK_NAME] ?? item.name;
}

/**
 * Returns the icon path appropriate for the current audience.
 * @param {Item} item
 * @returns {string}
 */
export function getDisplayImg(item) {
  if (!isUnidentified(item)) return item.img;
  return getFlags(item)[FLAG.MASK_IMG] ?? item.img;
}

/**
 * Returns the description appropriate for the current audience.
 * @param {Item} item
 * @returns {string}
 */
export function getDisplayDescription(item) {
  if (!isUnidentified(item)) {
    return item.system?.description ?? item.system?.details?.description ?? "";
  }
  return getFlags(item)[FLAG.MASK_DESC] ?? "";
}

// ── Legacy migration helpers ──────────────────────────────────

/**
 * Returns true when this item carries legacy destructive-model data:
 * item fields were overwritten with masked values and originals were stored
 * in realName / realImg / realDescription flags. This condition is used
 * by the migration pass to identify records that need restoration.
 * @param {Item} item
 * @returns {boolean}
 */
export function isLegacyDestructiveState(item) {
  const flags = getFlags(item);
  return flags[FLAG.IDENTIFIED] === false && (
    flags[FLAG.REAL_NAME] !== undefined ||
    flags[FLAG.REAL_IMG]  !== undefined ||
    flags[FLAG.REAL_DESC] !== undefined
  );
}

/**
 * One-time migration: restores item.name / img / system.description from the
 * legacy backup flags, preserves masked metadata for re-mystification reuse,
 * and deletes the now-obsolete backup flags.
 * Safe to call multiple times — isLegacyDestructiveState returns false after
 * the first run so repeated calls are no-ops.
 * @param {Item} item
 * @returns {Promise<object>} The update data object (for batch callers)
 */
export function buildLegacyMigrationUpdate(item) {
  const flags = getFlags(item);

  const updates = { _id: item.id };

  // Restore canonical document fields from the backup flags
  if (flags[FLAG.REAL_NAME] !== undefined) updates.name = flags[FLAG.REAL_NAME];
  if (flags[FLAG.REAL_IMG]  !== undefined) updates.img  = flags[FLAG.REAL_IMG];
  if (flags[FLAG.REAL_DESC] !== undefined) updates["system.description"] = flags[FLAG.REAL_DESC];

  // Delete legacy backup flags using the v14 ForcedDeletion operator.
  // Each key uses the full dot-path so only these three flags are removed —
  // maskedName / maskedImg / maskedDescription are left untouched.
  updates[`flags.${MODULE_ID}.${FLAG.REAL_NAME}`] = foundry.data.operators.ForcedDeletion;
  updates[`flags.${MODULE_ID}.${FLAG.REAL_IMG}`]  = foundry.data.operators.ForcedDeletion;
  updates[`flags.${MODULE_ID}.${FLAG.REAL_DESC}`] = foundry.data.operators.ForcedDeletion;

  return updates;
}

// ── Mystify ───────────────────────────────────────────────────

/**
 * Opens the Mystify dialog for a GM to configure masked presentation values.
 * Pre-fills from existing flags (re-mystification) or per-type settings defaults.
 * @param {Item} item
 * @returns {Promise<void>}
 */
export async function openMystifyDialog(item) {
  if (!game.user.isGM) return;
  if (!isSupported(item)) {
    ui.notifications.warn(`[DH Unidentified] Item type "${item.type}" is not supported.`);
    return;
  }

  const existing     = getFlags(item);
  const typeDefaults = getDefaultsForType(item.type);
  const defaultMaskedName = existing[FLAG.MASK_NAME] ?? typeDefaults.maskedName;
  const defaultMaskedDesc = existing[FLAG.MASK_DESC] ?? typeDefaults.maskedDesc;

  // When useSettingsImg is true, use the settings-configured masked icon.
  // When false, start with the item's own real image so the GM sees the real art.
  // Existing mask flags always take priority so re-mystification keeps last values.
  const useSettingsImg = typeDefaults.useSettingsImg ?? true;
  const defaultMaskedImg = existing[FLAG.MASK_IMG]
    ?? (useSettingsImg ? typeDefaults.maskedImg : item.img)
    ?? typeDefaults.maskedImg;

  const content = await foundry.applications.handlebars.renderTemplate(MYSTIFY_TEMPLATE, {
    maskedName: defaultMaskedName,
    maskedImg:  defaultMaskedImg,
    maskedDesc: defaultMaskedDesc,
  });

  // Label the confirm button contextually: re-mystifying keeps the mask,
  // mystifying an identified item is the initial application.
  const confirmLabel = isUnidentified(item) ? "Apply Mask" : "Mystify";

  const result = await foundry.applications.api.DialogV2.wait({
    window:   { title: "Item Identity — DH Unidentified" },
    classes:  ["dhui-mystify-outer"],
    position: { width: 440 },
    content,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        default: true,
        callback: (_event, button) => {
          const els = button.form.elements;
          return {
            maskedName: els.maskedName?.value?.trim() || defaultMaskedName,
            maskedImg:  els.maskedImg?.value?.trim()  || defaultMaskedImg,
            maskedDesc: els.maskedDesc?.value?.trim() || defaultMaskedDesc,
          };
        },
      },
      {
        // Sentinel string lets the caller distinguish identify from cancel.
        action: "identify",
        label: "Identify",
        callback: () => "identify",
      },
      { action: "cancel", label: "Cancel", callback: () => null },
    ],
    render: (_event, dialog) => {
      const input = dialog.element.querySelector("input[name='maskedImg']");
      // CLAUDE.md §2: resolve FilePicker implementation so host environments can substitute
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation
        ?? foundry.applications.apps.FilePicker;

      dialog.element.querySelector("[data-action='browse']")?.addEventListener("click", () => {
        new FilePickerClass({
          type: "imagevideo",
          current: input?.value ?? "",
          callback: path => {
            if (input) input.value = path;
            // Update icon preview immediately after FilePicker selection
            const preview = dialog.element.querySelector(".dhui-icon-preview");
            if (preview) preview.src = path;
          },
        }).render(true);
      });

      // Also update preview when the user types a path directly
      input?.addEventListener("input", () => {
        const preview = dialog.element.querySelector(".dhui-icon-preview");
        if (preview) preview.src = input.value;
      });
    },
  }).catch(() => null);

  // "identify" sentinel → reveal the item without touching the mask fields.
  if (result === "identify") {
    await identifyItem(item);
    return;
  }
  if (!result) return;
  await applyMystify(item, result);
}

/**
 * Marks an item as unidentified by writing masked metadata into module flags only.
 * Does NOT modify item.name, item.img, or system.description.
 * Real item data is preserved in the document and remains unchanged.
 * @param {Item} item
 * @param {{ maskedName: string, maskedImg: string, maskedDesc: string }} masks
 * @returns {Promise<void>}
 */
export async function applyMystify(item, { maskedName, maskedImg, maskedDesc }) {
  await item.update({
    [`flags.${MODULE_ID}.${FLAG.IDENTIFIED}`]: false,
    [`flags.${MODULE_ID}.${FLAG.MASK_NAME}`]:  maskedName,
    [`flags.${MODULE_ID}.${FLAG.MASK_IMG}`]:   maskedImg,
    [`flags.${MODULE_ID}.${FLAG.MASK_DESC}`]:  maskedDesc,
  });

  ui.notifications.info(`[DH Unidentified] "${item.name}" is now unidentified (masked as "${maskedName}").`);
}

// ── Identify ──────────────────────────────────────────────────

/**
 * Marks an item as identified by setting the identified flag to true.
 * Does NOT restore any document fields — real data was never overwritten.
 * Masked metadata is preserved in flags for potential future re-mystification.
 * @param {Item} item
 * @returns {Promise<void>}
 */
export async function identifyItem(item) {
  if (!game.user.isGM) return;

  const flags = getFlags(item);
  if (!flags || flags[FLAG.IDENTIFIED] !== false) {
    ui.notifications.warn("[DH Unidentified] This item is already identified.");
    return;
  }

  await item.update({
    [`flags.${MODULE_ID}.${FLAG.IDENTIFIED}`]: true,
  });

  ui.notifications.info(`[DH Unidentified] "${item.name}" has been identified!`);
}

// ── Internal utilities ────────────────────────────────────────

/**
 * HTML-escapes a string for safe insertion into attribute values or text nodes.
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
