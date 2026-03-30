// ============================================================
// dh-unidentified | settings.js
// Module settings registration and DefaultMasksConfig dialog (ApplicationV2)
// ============================================================

const MODULE_ID    = "dh-unidentified";
const SETTING_KEY  = "typeDefaults";
const SFX_KEY      = "identifySfx";
const TEMPLATE_PATH       = `modules/${MODULE_ID}/templates/default-masks-config.hbs`;
const GUIDE_TEMPLATE_PATH = `modules/${MODULE_ID}/templates/module-guide.hbs`;

// Item types that have configurable mask defaults (must stay in sync with SUPPORTED_TYPES)
const TABS = ["weapon", "armor", "loot", "consumable"];

/** Built-in fallback defaults for identify-roll sound effects. */
const DEFAULT_SFX = {
  successPath: `modules/${MODULE_ID}/assets/sfx/success.mp3`,
  failurePath: `modules/${MODULE_ID}/assets/sfx/failure.mp3`,
};

/** Built-in fallback defaults — used when no saved value exists for a type. */
const DEFAULT_TYPE_DEFAULTS = {
  weapon: {
    maskedName:     "Unidentified Weapon",
    maskedDesc:     "The nature of this item is unknown.",
    maskedImg:      "icons/magic/symbols/question-stone-yellow.webp",
    useSettingsImg: true,
  },
  armor: {
    maskedName:     "Unidentified Armor",
    maskedDesc:     "The nature of this item is unknown.",
    maskedImg:      "icons/magic/symbols/question-stone-yellow.webp",
    useSettingsImg: true,
  },
  loot: {
    maskedName:     "Unidentified Loot",
    maskedDesc:     "The nature of this item is unknown.",
    maskedImg:      "icons/magic/symbols/question-stone-yellow.webp",
    useSettingsImg: true,
  },
  consumable: {
    maskedName:     "Unidentified Consumable",
    maskedDesc:     "The nature of this item is unknown.",
    maskedImg:      "icons/magic/symbols/question-stone-yellow.webp",
    useSettingsImg: true,
  },
};

// ── Public API ────────────────────────────────────────────────

/**
 * Registers the world-scoped setting store and the GM-only settings menu button.
 * Called inside Hooks.once("init") from main.js.
 * @returns {void}
 */
export function registerSettings() {
  // Invisible store — UI is provided exclusively by DefaultMasksConfig
  game.settings.register(MODULE_ID, SETTING_KEY, {
    scope:   "world",
    config:  false,
    type:    Object,
    default: DEFAULT_TYPE_DEFAULTS,
  });

  // Sound effects for identify rolls (success / failure)
  game.settings.register(MODULE_ID, SFX_KEY, {
    scope:   "world",
    config:  false,
    type:    Object,
    default: DEFAULT_SFX,
  });

  // Broadcast channel for identify-roll requests.
  // The GM writes here; the updateSetting hook on every client fires the player prompt.
  game.settings.register(MODULE_ID, "identifyRequest", {
    scope:   "world",
    config:  false,
    type:    Object,
    default: {},
  });

  // Usage guide button — visible to all users (restricted: false)
  game.settings.registerMenu(MODULE_ID, "moduleGuideMenu", {
    name:       "Module Guide",
    label:      "Open Module Guide",
    hint:       "How to use DH Unidentified: linked actors, hiding items, and identifying them.",
    icon:       "fas fa-book-open",
    type:       ModuleGuideApp,
    restricted: false,
  });

  // Settings menu button visible only to GM (restricted: true)
  game.settings.registerMenu(MODULE_ID, "typeDefaultsMenu", {
    name:       "Default Masks",
    label:      "Configure Default Masks",
    hint:       "Set default masked name, description, and icon per item type.",
    icon:       "fas fa-eye-slash",
    type:       DefaultMasksConfig,
    restricted: true,
  });
}

/**
 * Returns the stored mask defaults for the given item type, merged with built-in fallbacks.
 * Consumed by openMystifyDialog() in unidentified.js to pre-fill the dialog.
 * @param {string} type - The item type key (e.g. "weapon", "armor")
 * @returns {{ maskedName: string, maskedDesc: string, maskedImg: string }}
 */
export function getDefaultsForType(type) {
  const stored  = game.settings.get(MODULE_ID, SETTING_KEY) ?? {};
  const saved   = stored[type] ?? {};
  const builtin = DEFAULT_TYPE_DEFAULTS[type] ?? {
    maskedName:     `Unidentified ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    maskedDesc:     "The nature of this item is unknown.",
    maskedImg:      "icons/magic/symbols/question-stone-yellow.webp",
    useSettingsImg: true,
  };

  return {
    maskedName:     saved.maskedName || builtin.maskedName,
    maskedDesc:     saved.maskedDesc || builtin.maskedDesc,
    maskedImg:      saved.maskedImg  || builtin.maskedImg,
    // Explicit boolean check: saved value wins, falls back to builtin (always true by default)
    useSettingsImg: saved.useSettingsImg ?? builtin.useSettingsImg,
  };
}

/**
 * Returns the stored sound-effect paths for identify rolls, merged with built-in fallbacks.
 * Consumed by the createChatMessage hook in main.js to play audio on roll results.
 * @returns {{ successPath: string, failurePath: string }}
 */
export function getSfxSettings() {
  const stored = game.settings.get(MODULE_ID, SFX_KEY) ?? {};
  return {
    successPath: stored.successPath || DEFAULT_SFX.successPath,
    failurePath: stored.failurePath || DEFAULT_SFX.failurePath,
  };
}

// ── DefaultMasksConfig — ApplicationV2 ───────────────────────

/**
 * GM-only settings dialog for configuring per-type mask defaults.
 * Opened via the Module Settings menu button registered in registerSettings().
 * Renders four tabs (weapon / armor / loot / consumable), each with three fields:
 * masked name, masked icon path (with FilePicker), and masked description.
 */
class DefaultMasksConfig extends foundry.applications.api.ApplicationV2 {

  /** @override */
  static DEFAULT_OPTIONS = {
    id:       "dhui-cfg-dialog",
    tag:      "form",
    classes:  ["dhui-cfg"],
    window:   { title: "Default Masks — DH Unidentified", resizable: false },
    position: { width: 520, height: "auto" },
  };

  // ── Rendering lifecycle ───────────────────────────────────

  /**
   * Builds the dialog's inner HTML via Handlebars using the pre-loaded module template.
   * Called by the ApplicationV2 render pipeline; result is passed to _replaceHTML.
   * @override
   * @param {object} _context - Render context (unused — data read directly from settings)
   * @param {object} _options - Render options
   * @returns {Promise<DocumentFragment>}
   */
  async _renderHTML(_context, _options) {
    const stored = game.settings.get(MODULE_ID, SETTING_KEY) ?? {};

    const tabs = TABS.map((type, i) => ({
      type,
      label:          type.charAt(0).toUpperCase() + type.slice(1),
      isFirst:        i === 0,
      maskedName:     stored[type]?.maskedName     ?? DEFAULT_TYPE_DEFAULTS[type]?.maskedName     ?? "",
      maskedDesc:     stored[type]?.maskedDesc     ?? DEFAULT_TYPE_DEFAULTS[type]?.maskedDesc     ?? "",
      maskedImg:      stored[type]?.maskedImg      ?? DEFAULT_TYPE_DEFAULTS[type]?.maskedImg      ?? "",
      useSettingsImg: stored[type]?.useSettingsImg ?? DEFAULT_TYPE_DEFAULTS[type]?.useSettingsImg ?? true,
    }));

    const storedSfx = game.settings.get(MODULE_ID, SFX_KEY) ?? {};
    const sfx = {
      successPath: storedSfx.successPath ?? DEFAULT_SFX.successPath,
      failurePath: storedSfx.failurePath ?? DEFAULT_SFX.failurePath,
    };

    const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATH, { tabs, sfx });
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    return tpl.content.cloneNode(true);
  }

  /**
   * Injects the rendered DocumentFragment into the .window-content area.
   * Called by ApplicationV2 after _renderHTML.
   * @override
   * @param {DocumentFragment} result  - Output of _renderHTML
   * @param {HTMLElement}      content - The .window-content element provided by ApplicationV2
   * @param {object}          _options - Render options
   */
  _replaceHTML(result, content, _options) {
    content.replaceChildren(...result.childNodes);
  }

  /**
   * Attaches all interactive listeners after the DOM is live.
   * Called by the ApplicationV2 lifecycle after _replaceHTML.
   * @override
   * @param {object} _context - Render context
   * @param {object} _options - Render options
   */
  _onRender(_context, _options) {
    const el = this.element;

    // Tab switching — toggle active class on both buttons and panels
    el.querySelectorAll(".dhui-cfg-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        el.querySelectorAll(".dhui-cfg-tab")
          .forEach(b => b.classList.toggle("dhui-cfg-tab--active", b === btn));
        el.querySelectorAll(".dhui-cfg-panel")
          .forEach(p => p.classList.toggle("dhui-cfg-panel--active", p.dataset.panel === tab));
      });
    });

    // FilePicker button per tab — writes the chosen path back to the sibling input
    // Use .implementation so hosts like The Forge can substitute their own subclass.
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation
      ?? foundry.applications.apps.FilePicker;
    el.querySelectorAll(".dhui-cfg-pick-img").forEach(btn => {
      btn.addEventListener("click", () => {
        const type  = btn.dataset.type;
        const input = el.querySelector(`input[name="${type}.maskedImg"]`);
        new FilePickerClass({
          type:     "imagevideo",
          current:  input?.value ?? "",
          callback: path => { if (input) input.value = path; },
        }).render(true);
      });
    });

    // FilePicker for sound-effect fields — uses "audio" type for sound file browsing
    el.querySelectorAll(".dhui-cfg-pick-sfx").forEach(btn => {
      btn.addEventListener("click", () => {
        const key   = btn.dataset.sfx;
        const input = el.querySelector(`input[name="sfx.${key}"]`);
        new FilePickerClass({
          type:     "audio",
          current:  input?.value ?? "",
          callback: path => { if (input) input.value = path; },
        }).render(true);
      });
    });

    el.querySelector(".dhui-cfg-btn--save")?.addEventListener("click", () => this._save());
    el.querySelector(".dhui-cfg-btn--cancel")?.addEventListener("click", () => this.close());
  }

  // ── Save ──────────────────────────────────────────────────

  /**
   * Reads every field via direct querySelector (avoids FormDataExtended edge cases),
   * persists the result to the world setting, and closes the dialog.
   * @returns {Promise<void>}
   */
  async _save() {
    const el      = this.element;
    const updated = {};

    for (const type of TABS) {
      const nameInput    = el.querySelector(`input[name="${type}.maskedName"]`);
      const imgInput     = el.querySelector(`input[name="${type}.maskedImg"]`);
      const descArea     = el.querySelector(`textarea[name="${type}.maskedDesc"]`);
      // Unchecked checkboxes return false via .checked — no FormDataExtended ambiguity
      const toggleInput  = el.querySelector(`input[name="${type}.useSettingsImg"]`);

      updated[type] = {
        maskedName:     nameInput?.value?.trim()  || DEFAULT_TYPE_DEFAULTS[type].maskedName,
        maskedImg:      imgInput?.value?.trim()   || DEFAULT_TYPE_DEFAULTS[type].maskedImg,
        maskedDesc:     descArea?.value?.trim()   || DEFAULT_TYPE_DEFAULTS[type].maskedDesc,
        useSettingsImg: toggleInput?.checked ?? true,
      };
    }

    // Sound-effect paths
    const successInput = el.querySelector('input[name="sfx.successPath"]');
    const failureInput = el.querySelector('input[name="sfx.failurePath"]');
    const sfxUpdate = {
      successPath: successInput?.value?.trim() || DEFAULT_SFX.successPath,
      failurePath: failureInput?.value?.trim() || DEFAULT_SFX.failurePath,
    };

    await game.settings.set(MODULE_ID, SETTING_KEY, updated);
    await game.settings.set(MODULE_ID, SFX_KEY, sfxUpdate);
    ui.notifications.info("[DH Unidentified] Default masks saved.");
    this.close();
  }
}

// ── ModuleGuideApp — ApplicationV2 ───────────────────────────

/**
 * Read-only usage guide dialog accessible from the Module Settings panel.
 * Explains the linked-actor requirement, the mystify workflow, and the identify workflow.
 * Available to all users (restricted: false in registerMenu).
 */
class ModuleGuideApp extends foundry.applications.api.ApplicationV2 {

  /** @override */
  static DEFAULT_OPTIONS = {
    id:       "dhui-guide-dialog",
    tag:      "div",
    classes:  ["dhui-guide-outer"],
    window:   { title: "DH Unidentified — Module Guide", resizable: false, singleton: true },
    position: { width: 560, height: "auto" },
  };

  // ── Rendering lifecycle ───────────────────────────────────

  /**
   * Builds the dialog's inner HTML from the guide template.
   * Called by the ApplicationV2 render pipeline.
   * @override
   * @param {object} _context - Render context (unused — guide is static content)
   * @param {object} _options - Render options
   * @returns {Promise<DocumentFragment>}
   */
  async _renderHTML(_context, _options) {
    const html = await foundry.applications.handlebars.renderTemplate(GUIDE_TEMPLATE_PATH, {});
    const tpl  = document.createElement("template");
    tpl.innerHTML = html;
    return tpl.content.cloneNode(true);
  }

  /**
   * Injects the rendered DocumentFragment into the .window-content area.
   * @override
   * @param {DocumentFragment} result  - Output of _renderHTML
   * @param {HTMLElement}      content - The .window-content element
   * @param {object}          _options - Render options
   */
  _replaceHTML(result, content, _options) {
    content.replaceChildren(...result.childNodes);
  }

  /**
   * Attaches the Close button listener after the DOM is live.
   * Called by the ApplicationV2 lifecycle after _replaceHTML.
   * @override
   * @param {object} _context - Render context
   * @param {object} _options - Render options
   */
  _onRender(_context, _options) {
    this.element.querySelector(".dhui-guide-btn--close")
      ?.addEventListener("click", () => this.close());
  }
}
