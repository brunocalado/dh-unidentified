// ============================================================
// dh-unidentified | sheet-hook.js
// Intercepts item sheet rendering to apply the display layer.
//
// Architecture: non-destructive model.
// item.name / item.img / system.description are ALWAYS real.
// Masked presentation values come from module flags via display helpers.
//
// GM view (item unidentified):
//   - Banner inside .window-content showing the masked alias and a "(use ⋮ to identify)" hint
//   - Eye-toggle button in .window-header to compare mystified vs. real view
//   - Real item data panel (item.name / item.img / real description from document)
//
// GM view (item identified):
//   - Small "Mystify" shortcut in the ⋮ header menu (via getHeaderControlsItemSheetV2)
//
// Player view (item unidentified):
//   - Purple "Unidentified" badge inside .window-content
//   - Window title and visible name/image replaced with masked alias / icon
//   - All inputs inside .window-content are disabled
//   - Transparent overlay inside .window-content blocks interaction
//   - .window-header is NOT touched — close (X) button always works
// ============================================================

import { isUnidentified, isSupported, openMystifyDialog, identifyItem, getFlags, getDisplayName, getDisplayImg } from "./unidentified.js";

// ── Cleanup utilities ─────────────────────────────────────────

/**
 * Remove all DOM nodes previously injected by this module from the frame.
 * Must be called at the top of onRenderItemSheet on every render cycle,
 * because ApplicationV2's render() patches the DOM without clearing dynamic
 * injections — stale banners, toggles, and menu entries would persist otherwise.
 * Called from the renderHandlebarsApplication hook when the item sheet re-renders.
 *
 * @param {HTMLElement} frame - The root application frame element.
 */
function _cleanupInjected(frame) {
  frame.querySelectorAll(".dhui-gm-banner").forEach(el => el.remove());
  frame.querySelectorAll(".dhui-player-badge").forEach(el => el.remove());
  frame.querySelectorAll(".dhui-view-toggle").forEach(el => el.remove());
  frame.querySelectorAll(".dhui-mystified-view").forEach(el => el.remove());
  frame.querySelectorAll(".dhui-menu-sep, .dhui-menu-entry").forEach(el => el.remove());
  frame.classList.remove("dhui-showing-mystified");
  frame.classList.remove("dhui-unidentified-player-view");
}

// ── Main entry point ──────────────────────────────────────────

/**
 * Called from renderHandlebarsApplication for every ApplicationV2 render.
 * Applies GM or player display layer when the sheet is for a supported item.
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} element
 */
export function onRenderItemSheet(app, element) {
  const item = app.document ?? app.item ?? app.object;
  if (!(item instanceof Item)) return;
  if (!isSupported(item)) return;

  const frame = app.element;
  if (!frame) return;

  const controlsMenu = frame.querySelector("menu.controls-dropdown");

  // Clean up all previously injected elements before re-rendering.
  _cleanupInjected(frame);
  // Reset view mode on each render so state changes (identify ↔ mystify) reset correctly.
  app._dhuiViewMode = undefined;

  const content = frame.querySelector("section.window-content, .window-content");

  if (isUnidentified(item)) {
    game.user.isGM ? _applyGMViewUnidentified(app, frame, controlsMenu, content, item)
                   : _applyPlayerView(app, frame, content, item);
  } else {
    if (game.user.isGM) _injectGMMystifyEntry(controlsMenu, app, item);
  }
}

// ── GM View — item IS unidentified ───────────────────────────

/**
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} frame
 * @param {HTMLElement|null} controlsMenu
 * @param {HTMLElement|null} content
 * @param {Item} item
 */
function _applyGMViewUnidentified(app, frame, controlsMenu, content, item) {
  if (content) _injectGMBanner(content, item);
  _injectGMMenuEntries(controlsMenu, app, item, { identified: false });
  _injectViewToggle(app, frame, content, item);
}

/**
 * Injects a banner inside .window-content showing the masked presentation name.
 * The GM sees the real item sheet below; this banner makes it explicit that
 * the item is currently masked as a different identity for players.
 * @param {HTMLElement} content
 * @param {Item} item
 */
function _injectGMBanner(content, item) {
  const flags      = getFlags(item);
  const maskedName = flags.maskedName ?? "?";

  const banner = document.createElement("div");
  banner.className = "dhui-gm-banner";
  banner.innerHTML = `
    <i class="fas fa-eye-slash dhui-gm-banner__icon"></i>
    <div class="dhui-gm-banner__text">
      <span class="dhui-gm-banner__row">
        <strong>Unidentified</strong>
        <span class="dhui-gm-banner__hint">— players see: <em>${_escInner(maskedName)}</em> (use ⋮ to identify)</span>
      </span>
    </div>
  `;

  content.insertBefore(banner, content.firstChild);
}

// ── GM View — item IS identified ─────────────────────────────

/**
 * @param {HTMLElement|null} controlsMenu
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {Item} item
 */
function _injectGMMystifyEntry(controlsMenu, app, item) {
  _injectGMMenuEntries(controlsMenu, app, item, { identified: true });
}

/**
 * No-op: header menu entries are provided natively via getHeaderControlsItemSheetV2
 * registered in scripts/main.js. DOM injection here would create duplicate entries.
 *
 * @param {HTMLElement} _controlsMenu - Unused.
 * @param {foundry.applications.api.ApplicationV2} _app - Unused.
 * @param {Item} _item - Unused.
 * @param {object} _opts - Unused.
 */
function _injectGMMenuEntries(_controlsMenu, _app, _item, _opts) {
  // Header menu entries are provided by getHeaderControlsItemSheetV2 in main.js.
}

// ── GM View Toggle ────────────────────────────────────────────

/**
 * Injects a toggle button into .window-header and a "Real Item Data" preview panel
 * into .window-content, allowing the GM to compare mystified vs. real presentation.
 * Under the non-destructive model, real data is read directly from item.name / item.img
 * (the document fields) rather than from legacy backup flags.
 * State is stored on the app instance so it survives re-renders within the same session.
 *
 * Called from _applyGMViewUnidentified on every renderHandlebarsApplication.
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} frame
 * @param {HTMLElement|null} content
 * @param {Item} item
 */
function _injectViewToggle(app, frame, content, item) {
  if (app._dhuiViewMode === undefined) app._dhuiViewMode = "mystified";

  const header = frame.querySelector(".window-header");
  if (header) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dhui-view-toggle";
    btn.setAttribute("aria-label", "Toggle Mystified / Real View");
    btn.innerHTML = `<i class="fas fa-eye"></i>`;

    const menuBtn = header.querySelector('[data-action="menu"]')
                 ?? header.querySelector(".header-control");
    header.insertBefore(btn, menuBtn ?? null);

    btn.addEventListener("click", () => {
      app._dhuiViewMode = app._dhuiViewMode === "mystified" ? "real" : "mystified";
      _applyViewMode(app, frame);
    });
  }

  // Real item data panel — reads from document fields directly, not legacy flags.
  // In the non-destructive model, item.name and item.img ARE the real data.
  if (content) {
    const realName = item.name;
    const realImg  = item.img ?? "";
    const realDesc = item.system?.description ?? item.system?.details?.description ?? "";

    const panel = document.createElement("div");
    panel.className = "dhui-mystified-view";
    panel.innerHTML = `
      <div class="dhui-mystified-preview">
        <div class="dhui-mystified-preview__header">
          <i class="fas fa-eye"></i>
          <span>Real Item Data</span>
        </div>
        <div class="dhui-mystified-preview__body">
          ${realImg ? `<div class="dhui-mystified-preview__img"><img src="${_escInner(realImg)}" alt="${_escInner(realName)}"></div>` : ""}
          <div class="dhui-mystified-preview__info">
            <h3 class="dhui-mystified-preview__name">${_escInner(realName)}</h3>
            ${realDesc ? `<div class="dhui-mystified-preview__description">${realDesc}</div>` : ""}
          </div>
        </div>
      </div>
    `;
    content.appendChild(panel);
  }

  _applyViewMode(app, frame);
}

/**
 * Toggles the dhui-showing-mystified CSS class on the frame and updates the
 * button icon/tooltip to reflect current view mode. Never re-renders the sheet.
 *
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} frame
 */
function _applyViewMode(app, frame) {
  if (!frame) return;
  const showingReal = app._dhuiViewMode === "real";

  frame.classList.toggle("dhui-showing-mystified", showingReal);

  const btnIcon = frame.querySelector(".dhui-view-toggle i");
  if (btnIcon) btnIcon.className = showingReal ? "fas fa-eye-slash" : "fas fa-eye";

  const btn = frame.querySelector(".dhui-view-toggle");
  if (btn) {
    btn.dataset.tooltip = showingReal
      ? "Showing: Real Item — click to return to mystified view"
      : "Showing: Mystified View — click to reveal real item data";
  }
}

function _makeMenuEntry(iconClass, label, onClick) {
  const li = document.createElement("li");
  li.className = "header-control dhui-menu-entry";
  li.innerHTML = `
    <button type="button" class="control">
      <i class="${iconClass}"></i>
      <span class="control-label">${label}</span>
    </button>
  `;
  li.querySelector("button").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return li;
}

// ── Player View ───────────────────────────────────────────────

/**
 * Applies the player-facing view for an unidentified item sheet.
 * Because real data is now preserved in item.name / item.img / system.description,
 * we must actively replace all visible identity elements with masked equivalents.
 * Content is then locked to prevent any edits that would reveal canonical fields.
 *
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} frame
 * @param {HTMLElement|null} content
 * @param {Item} item
 */
function _applyPlayerView(app, frame, content, item) {
  frame.classList.add("dhui-unidentified-player-view");

  // Mask all visible identity elements BEFORE injecting the badge and locking.
  _maskPlayerIdentityElements(frame, item);

  _injectPlayerBadge(content);
  _lockContent(content);
  _restoreHeaderButtons(app, frame);
}

/**
 * Replaces visible name, image, and form-field values in the sheet with
 * masked presentation values from flags. Without this step players would see
 * real item identity because item.name / item.img are now always canonical.
 * @param {HTMLElement} frame
 * @param {Item} item
 */
function _maskPlayerIdentityElements(frame, item) {
  const maskedName = getDisplayName(item);
  const maskedImg  = getDisplayImg(item);

  // Window title in the application header
  const titleEl = frame.querySelector(".window-title");
  if (titleEl) titleEl.textContent = maskedName;

  // Item image in the header area (common in DH system item sheets)
  frame.querySelectorAll(".window-header img").forEach(img => {
    img.src = maskedImg;
  });

  // Name input inside the form — value replaced; input will be disabled by _lockContent
  const nameInput = frame.querySelector("input[name='name']");
  if (nameInput) nameInput.value = maskedName;

  // Item image inside form content (some sheets show the art in the body)
  frame.querySelectorAll("section.window-content img.item-image, .window-content .item-image").forEach(img => {
    img.src = maskedImg;
  });
}

/**
 * @param {HTMLElement|null} content
 */
function _injectPlayerBadge(content) {
  if (!content) return;
  const badge = document.createElement("div");
  badge.className = "dhui-player-badge";
  badge.innerHTML = `<i class="fas fa-question-circle"></i> Unidentified`;
  content.insertBefore(badge, content.firstChild);
}

/**
 * Disables all interactive elements inside .window-content and adds a
 * transparent click-blocker overlay to prevent any user interaction.
 * Tab navigation is blocked to prevent accessing mechanical stats on other tabs.
 * @param {HTMLElement|null} content
 */
function _lockContent(content) {
  if (!content) return;

  content.querySelectorAll("input, select, textarea").forEach(el => {
    el.disabled = true;
    el.readOnly = true;
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("cursor",          "default", "important");
  });

  content.querySelectorAll("button").forEach(el => {
    el.disabled = true;
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("cursor",          "default", "important");
  });

  content.querySelectorAll("[contenteditable]").forEach(el => {
    el.setAttribute("contenteditable", "false");
    el.style.setProperty("pointer-events", "none", "important");
  });

  // Block tab navigation — player must not switch to stats/actions tabs
  content.querySelectorAll(".tabs .tab, [data-action='tab'], nav.tabs a, .tab-navigation a").forEach(el => {
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("cursor", "default", "important");
  });

  // Hide armor/weapon feature descriptions ("Heavy: -1 to Evasion")
  content.querySelectorAll(".item-description-outer-container, .item-description-container").forEach(el => {
    el.style.setProperty("display", "none", "important");
  });

  // Transparent click-blocker overlay inside content only
  if (!content.querySelector(".dhui-lock-overlay")) {
    content.style.position = "relative";
    const overlay = document.createElement("div");
    overlay.className = "dhui-lock-overlay";
    content.appendChild(overlay);
  }
}

/**
 * Restores any header-area buttons that may have been caught by the lock.
 * Safety net — .window-content is the lock target, but this ensures the
 * close button and system-rendered header controls remain functional.
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} frame
 */
function _restoreHeaderButtons(app, frame) {
  const header = frame.querySelector(".window-header, header");
  if (!header) return;

  header.querySelectorAll("button, a").forEach(btn => {
    btn.disabled = false;
    btn.style.removeProperty("pointer-events");
    btn.style.removeProperty("cursor");
  });

  const closeBtn = header.querySelector("[data-action='close'], .window-close");
  if (closeBtn && !closeBtn.dataset.dhuiRestored) {
    closeBtn.dataset.dhuiRestored = "1";
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      app.close();
    });
  }
}

/**
 * HTML-escapes a string for safe insertion into attribute values or text content.
 * Local variant for this file; _esc in unidentified.js is the canonical export.
 * @param {string|null|undefined} str
 * @returns {string}
 */
function _escInner(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
