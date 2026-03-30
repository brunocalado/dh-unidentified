// ============================================================
// dh-unidentified | sheet-hook.js
// Intercepts item sheet rendering:
//
// GM view (item unidentified):
//   - Banner inside .window-content showing masked name
//   - Action buttons inside that banner (Identify / Re-mystify)
//   - Banner is NOT in .window-header — avoids the z-index/overflow
//     clipping issue caused by position:absolute on .window-header
//
// GM view (item identified):
//   - Small "Mystify" button inside the sheet content area
//
// Player view (item unidentified):
//   - Purple "Unidentified" badge inside .window-content
//   - All inputs inside .window-content are disabled
//   - Transparent overlay inside .window-content blocks interaction
//   - .window-header is NOT touched — close (X) button always works
// ============================================================

import { isUnidentified, isSupported, openMystifyDialog, identifyItem, getFlags } from "./unidentified.js";

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
  // Banner inside .window-content
  frame.querySelectorAll(".dhui-gm-banner").forEach(el => el.remove());
  // Player badge inside .window-content
  frame.querySelectorAll(".dhui-player-badge").forEach(el => el.remove());
  // Eye toggle button inside .window-header
  frame.querySelectorAll(".dhui-view-toggle").forEach(el => el.remove());
  // Mystified preview panel inside .window-content
  frame.querySelectorAll(".dhui-mystified-view").forEach(el => el.remove());
  // Menu separator + entries inside .controls-dropdown
  frame.querySelectorAll(".dhui-menu-sep, .dhui-menu-entry").forEach(el => el.remove());
  // CSS class that drives show/hide of real vs. mystified view
  frame.classList.remove("dhui-showing-mystified");
  // CSS class for player view locking
  frame.classList.remove("dhui-unidentified-player-view");
}

// ── Main entry point ──────────────────────────────────────────

export function onRenderItemSheet(app, element) {
  const item = app.document ?? app.item ?? app.object;
  if (!(item instanceof Item)) return;
  if (!isSupported(item)) return;

  // app.element = the full application frame (form).
  // menu.controls-dropdown is the native Foundry/DH dropdown (the three-dots
  // menu) — it already contains "Configure Sheet" and "Configure Attribution".
  // We inject our GM entries there so they sit naturally alongside the others,
  // with no z-index or overflow issues.
  const frame = app.element;
  if (!frame) return;

  // Guard: only act when the frame is fully in the DOM
  const controlsMenu = frame.querySelector("menu.controls-dropdown");
  if (!controlsMenu) return;

  // Clean up all previously injected elements before re-rendering
  // This prevents stale banners, toggles, and menu entries from persisting
  _cleanupInjected(frame);
  // Reset the view mode for this render cycle — if the item state changed
  // (identified ↔ unidentified), the mode should reset to default
  app._dhuiViewMode = undefined;

  const content = frame.querySelector("section.window-content, .window-content");

  if (isUnidentified(item)) {
    game.user.isGM ? _applyGMViewUnidentified(app, frame, controlsMenu, content, item)
                   : _applyPlayerView(app, frame, content);
  } else {
    if (game.user.isGM) _injectGMMystifyEntry(controlsMenu, app, item);
  }
}

// ── GM View — item IS unidentified ───────────────────────────

function _applyGMViewUnidentified(app, frame, controlsMenu, content, item) {
  // Banner inside window-content (shows masked name to GM)
  if (content) _injectGMBanner(app, content, item);
  // Action entries inside the controls-dropdown menu
  _injectGMMenuEntries(controlsMenu, app, item, { identified: false });
  // Toggle button + player-view preview panel
  _injectViewToggle(app, frame, content, item);
}

function _injectGMBanner(app, content, item) {
  const banner = document.createElement("div");
  banner.className = "dhui-gm-banner";
  // Names row removed — the eye toggle button in the header replaces this info
  banner.innerHTML = `
    <i class="fas fa-eye-slash dhui-gm-banner__icon"></i>
    <div class="dhui-gm-banner__text">
      <span class="dhui-gm-banner__row">
        <strong>Unidentified</strong>
        <span class="dhui-gm-banner__hint">(use the ⋮ menu to identify)</span>
      </span>
    </div>
  `;

  content.insertBefore(banner, content.firstChild);
}

// ── GM View — item IS identified (just a small Mystify shortcut) ─

function _injectGMMystifyEntry(controlsMenu, app, item) {
  _injectGMMenuEntries(controlsMenu, app, item, { identified: true });
}

/**
 * Inject GM entries into menu.controls-dropdown.
 * The menu already contains li.header-control items ("Configure Sheet", etc).
 * We append a separator + our entries in the same format.
 */
function _injectGMMenuEntries(controlsMenu, app, item, { identified }) {
  // Separator
  const sep = document.createElement("li");
  sep.className = "dhui-menu-sep";
  sep.setAttribute("role", "separator");
  controlsMenu.appendChild(sep);

  if (!identified) {
    // Identify only — Re-mystify is intentionally absent to prevent double-mystify
    // which would corrupt realName/realImg by overwriting them with the masked values.
    controlsMenu.appendChild(_makeMenuEntry(
      "fas fa-eye", "Identify Item",
      async () => { await identifyItem(item); app.render({ force: true }); }
    ));
  } else {
    // Mystify
    controlsMenu.appendChild(_makeMenuEntry(
      "fas fa-eye-slash", "Mystify Item",
      async () => { await openMystifyDialog(item); app.render({ force: true }); }
    ));
  }
}

// ── GM View Toggle ────────────────────────────────────────────

/**
 * Injects a toggle button into .window-header and a mystified-preview panel
 * into .window-content, allowing the GM to compare real vs. player view.
 * State is stored on the app instance so it survives re-renders.
 * Called from _applyGMViewUnidentified on every renderHandlebarsApplication.
 *
 * @param {ApplicationV2} app     - The sheet application instance.
 * @param {HTMLElement}   frame   - The root application frame element.
 * @param {HTMLElement}   content - The .window-content element.
 * @param {Item}          item    - The unidentified item document.
 */
function _injectViewToggle(app, frame, content, item) {
  // Default: the native sheet already shows the mystified (masked) item data.
  // Persists across re-renders on the same app instance.
  if (app._dhuiViewMode === undefined) app._dhuiViewMode = "mystified";

  // Inject the toggle button into .window-header (before .header-controls)
  const header = frame.querySelector(".window-header");
  if (header) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dhui-view-toggle";
    btn.setAttribute("aria-label", "Toggle GM / Player View");
    btn.innerHTML = `<i class="fas fa-eye"></i>`;

    // Insert immediately before the ⋮ menu button so order is: [eye] [⋮] [×]
    const menuBtn = header.querySelector('[data-action="menu"]')
                 ?? header.querySelector(".header-control");
    header.insertBefore(btn, menuBtn ?? null);

    btn.addEventListener("click", () => {
      app._dhuiViewMode = app._dhuiViewMode === "mystified" ? "real" : "mystified";
      _applyViewMode(app, frame);
    });
  }

  // Inject the real-item preview panel (rebuilt each render; DOM is fresh).
  // Shows the true name/image/description stored in flags — the data that was
  // overwritten in item.name/img/system.description when the item was mystified.
  if (content) {
    const flags    = getFlags(item);
    const realName = flags.realName        ?? "?";
    const realImg  = flags.realImg         ?? "";
    // realDescription is stored as HTML by the rich-text editor — render raw
    const realDesc = flags.realDescription ?? "";

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
 * @param {ApplicationV2} app   - The sheet application instance.
 * @param {HTMLElement}   frame - The root application frame element.
 */
function _applyViewMode(app, frame) {
  if (!frame) return;
  // "real" mode = showing real item panel; "mystified" = native sheet (masked data)
  const showingReal = app._dhuiViewMode === "real";

  // CSS class drives all show/hide logic — no inline style manipulation needed
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

function _applyPlayerView(app, frame, content) {
  // Scoping class used by CSS to hide weapon/armor header stats (.item-description)
  // without touching other UI elements outside .window-content.
  frame.classList.add("dhui-unidentified-player-view");
  _injectPlayerBadge(content);
  _lockContent(content);
  // .window-header is outside .window-content — not locked.
  // Safety net: restore header buttons using the full frame.
  _restoreHeaderButtons(app, frame);
}

function _injectPlayerBadge(content) {
  const badge = document.createElement("div");
  badge.className = "dhui-player-badge";
  badge.innerHTML = `<i class="fas fa-question-circle"></i> Unidentified`;
  content.insertBefore(badge, content.firstChild);
}

function _lockContent(content) {
  if (!content) return;

  // Disable all form controls
  content.querySelectorAll("input, select, textarea").forEach(el => {
    el.disabled = true;
    el.readOnly = true;
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("cursor",          "default", "important");
  });

  // Disable buttons inside content
  content.querySelectorAll("button").forEach(el => {
    el.disabled = true;
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("cursor",          "default", "important");
  });

  // Disable rich-text editors
  content.querySelectorAll("[contenteditable]").forEach(el => {
    el.setAttribute("contenteditable", "false");
    el.style.setProperty("pointer-events", "none", "important");
  });

  // Remove tab navigation (Description / Settings / Actions / Effects)
  // Player must not switch tabs and see mechanical stats
  content.querySelectorAll(".tabs .tab, [data-action='tab'], nav.tabs a, .tab-navigation a").forEach(el => {
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("cursor", "default", "important");
  });

  // Hide armor/weapon feature descriptions ("Heavy: -1 to Evasion")
  // Generated by getDescriptionData() and injected before the main description
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
 * Restore any header-area buttons that may have been caught by the lock.
 * This is a safety net — since we only lock .window-content the header
 * should already be untouched, but if the system renders close/controls
 * inside the content area this fixes it.
 */
function _restoreHeaderButtons(app, frame) {
  const header = frame.querySelector(".window-header, header");
  if (!header) return;

  if (!header) return;
  header.querySelectorAll("button, a").forEach(btn => {
    btn.disabled = false;
    btn.style.removeProperty("pointer-events");
    btn.style.removeProperty("cursor");
  });

  // Re-attach close action in case
  const closeBtn = header.querySelector("[data-action='close'], .window-close");
  if (closeBtn && !closeBtn.dataset.dhuiRestored) {
    closeBtn.dataset.dhuiRestored = "1";
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      app.close();
    });
  }
}

function _escInner(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
