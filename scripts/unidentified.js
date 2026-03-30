// ============================================================
// dh-unidentified | unidentified.js
// Core logic: mystify, identify, flag read/write helpers
// ============================================================

import { getDefaultsForType } from "./settings.js";

const MODULE_ID = "dh-unidentified";

/** Path to the Handlebars template for the Mystify dialog form. */
const MYSTIFY_TEMPLATE = "modules/dh-unidentified/templates/mystify-dialog.hbs";

// Item types that support the unidentified workflow
export const SUPPORTED_TYPES = ["weapon", "armor", "loot", "consumable"];

const FLAG = {
  IDENTIFIED: "identified",
  REAL_NAME:  "realName",
  REAL_IMG:   "realImg",
  REAL_DESC:  "realDescription",
  MASK_NAME:  "maskedName",
  MASK_IMG:   "maskedImg",
  MASK_DESC:  "maskedDescription",
};

// ── Helpers ──────────────────────────────────────────────────

export function isSupported(item) {
  return SUPPORTED_TYPES.includes(item?.type);
}

export function isUnidentified(item) {
  const f = item?.flags?.[MODULE_ID];
  return f !== undefined && f[FLAG.IDENTIFIED] === false;
}

export function getFlags(item) {
  return item?.flags?.[MODULE_ID] ?? {};
}

// ── Mystify ──────────────────────────────────────────────────

export async function openMystifyDialog(item) {
  if (!game.user.isGM) return;
  if (!isSupported(item)) {
    ui.notifications.warn(`[DH Unidentified] Item type "${item.type}" is not supported.`);
    return;
  }

  const existing     = getFlags(item);
  // Fall back to GM-configured per-type defaults when the item has not been mystified before
  const typeDefaults = getDefaultsForType(item.type);
  const defaultMaskedName = existing[FLAG.MASK_NAME] ?? typeDefaults.maskedName;
  const defaultMaskedDesc = existing[FLAG.MASK_DESC] ?? typeDefaults.maskedDesc;

  // When useSettingsImg is true, use the settings-configured masked icon as the initial value.
  // When false, use the item's own image so the GM sees the real art as starting point.
  // Existing flags (already-mystified items) always take priority over both settings.
  const useSettingsImg = typeDefaults.useSettingsImg ?? true;
  const defaultMaskedImg = existing[FLAG.MASK_IMG]
    ?? (useSettingsImg ? typeDefaults.maskedImg : item.img)
    ?? typeDefaults.maskedImg;

  // Render the Handlebars template so CSS class selectors remain stable across re-renders.
  const content = await foundry.applications.handlebars.renderTemplate(MYSTIFY_TEMPLATE, {
    maskedName: defaultMaskedName,
    maskedImg:  defaultMaskedImg,
    maskedDesc: defaultMaskedDesc,
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window:   { title: "Mystify Item — DH Unidentified" },
    classes:  ["dhui-mystify-outer"],
    position: { width: 440 },
    content,
    buttons: [
      {
        action: "confirm",
        label: "Mystify",
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
      { action: "cancel", label: "Cancel", callback: () => null },
    ],
    render: (_event, dialog) => {
      dialog.element.querySelector("[data-action='browse']")?.addEventListener("click", () => {
        const input = dialog.element.querySelector("input[name='maskedImg']");
        new foundry.applications.apps.FilePicker({
          type: "imagevideo",
          current: input?.value ?? "",
          callback: path => { if (input) input.value = path; },
        }).render(true);
      });
    },
  }).catch(() => null);

  if (!result) return;
  await applyMystify(item, result);
}

export async function applyMystify(item, { maskedName, maskedImg, maskedDesc }) {
  // Capture real description from system data
  const realDesc = item.system?.description ?? item.system?.details?.description ?? "";

  await item.update({
    name: maskedName,
    img:  maskedImg,
    "system.description": maskedDesc,
    [`flags.${MODULE_ID}.${FLAG.IDENTIFIED}`]: false,
    [`flags.${MODULE_ID}.${FLAG.REAL_NAME}`]:  item.name,
    [`flags.${MODULE_ID}.${FLAG.REAL_IMG}`]:   item.img,
    [`flags.${MODULE_ID}.${FLAG.REAL_DESC}`]:  realDesc,
    [`flags.${MODULE_ID}.${FLAG.MASK_NAME}`]:  maskedName,
    [`flags.${MODULE_ID}.${FLAG.MASK_IMG}`]:   maskedImg,
    [`flags.${MODULE_ID}.${FLAG.MASK_DESC}`]:  maskedDesc,
  });

  ui.notifications.info(`[DH Unidentified] "${maskedName}" is now unidentified.`);
}

// ── Identify ─────────────────────────────────────────────────

export async function identifyItem(item) {
  if (!game.user.isGM) return;

  const flags = getFlags(item);
  if (!flags || flags[FLAG.IDENTIFIED] !== false) {
    ui.notifications.warn("[DH Unidentified] This item is already identified.");
    return;
  }

  const realName = flags[FLAG.REAL_NAME] ?? item.name;
  const realImg  = flags[FLAG.REAL_IMG]  ?? item.img;
  const realDesc = flags[FLAG.REAL_DESC] ?? "";

  await item.update({
    name: realName,
    img:  realImg,
    "system.description": realDesc,
    [`flags.${MODULE_ID}.${FLAG.IDENTIFIED}`]: true,
  });

  ui.notifications.info(`[DH Unidentified] "${realName}" has been identified!`);
}

// ── Internal ─────────────────────────────────────────────────

export function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
