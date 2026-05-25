// ============================================================
// dh-unidentified | context-menu.js
// Injects Mystify / Identify into the Foundryborne character
// sheet context menus.
//
// Uses the renderHandlebarsApplication hook on the CHARACTER sheet
// and intercepts the contextmenu event directly on inventory items.
// This avoids touching private internals of the CharacterSheet class.
// ============================================================

import { isSupported, isUnidentified, openMystifyDialog, identifyItem } from "./unidentified.js";

/**
 * Called from renderHandlebarsApplication for actor sheets.
 * Attaches a contextmenu listener on inventory items that appends
 * our GM-only entries to the Foundryborne context menu after it opens.
 *
 * Strategy: listen for the contextmenu event on the li.inventory-item,
 * wait one microtask for the DH ContextMenu to render its DOM, then
 * inject our entries into the rendered .context-menu element.
 *
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} element
 */
export function patchActorSheetContextMenus(app, element) {
  if (!game.user.isGM) return;

  const actor = app.document ?? app.actor ?? app.object;
  if (!(actor instanceof Actor)) return;

  if (actor.type !== "character") return;

  const list = element.querySelector(".items-section, .items-list, section.inventory");
  if (!list) return;

  // Guard: only attach once per rendered instance
  if (list.dataset.dhuiPatched) return;
  list.dataset.dhuiPatched = "1";

  list.addEventListener("contextmenu", (event) => {
    const li = event.target.closest("li.inventory-item[data-item-uuid]");
    if (!li) return;

    const itemUuid = li.dataset.itemUuid;
    const item = actor.items.find(i => i.uuid === itemUuid || i.id === li.dataset.itemId);
    if (!item || !isSupported(item)) return;

    // Wait for DH's ContextMenu to render (it runs synchronously on contextmenu)
    // then inject our entries into the .context-menu DOM element
    requestAnimationFrame(() => {
      const menu = document.querySelector("#context-menu, .context-menu");
      if (!menu) return;

      if (game.user.isGM) {
        _injectMenuEntries(menu, item, app);
      } else {
        // Player: remove context menu entries that would reveal item identity or allow edits
        menu.querySelectorAll("li.context-item").forEach(li => {
          const text = li.textContent?.trim().toLowerCase() ?? "";
          if (text.includes("edit") || text.includes("use item") || text.includes("send to chat")) {
            li.style.setProperty("display", "none", "important");
          }
        });
      }
    });
  }, true); // capture phase — runs before DH's listener
}

/**
 * Injects Mystify or Identify context menu entries for the GM.
 * After identify/mystify, forces a re-render of the actor sheet so inventory
 * rows reflect the new flag state without requiring a manual page refresh.
 * @param {HTMLElement} menu
 * @param {Item} item
 * @param {foundry.applications.api.ApplicationV2} app
 */
function _injectMenuEntries(menu, item, app) {
  // Avoid duplicate injection
  if (menu.querySelector(".dhui-ctx-entry")) return;

  const sep = document.createElement("li");
  sep.className = "dhui-ctx-entry dhui-ctx-sep";
  sep.setAttribute("role", "separator");
  menu.appendChild(sep);

  if (!isUnidentified(item)) {
    // ── Mystify ──
    // Only shown when the item is NOT mystified — prevents double-mystify which
    // would corrupt the masked values by overwriting them with themselves.
    const entryMystify = _makeEntry(
      "fas fa-eye-slash", "Mystify Item",
      async () => {
        _closeContextMenu(menu);
        await openMystifyDialog(item);
        // Force rerender so inventory rows show masked identity immediately.
        app.render({ force: true });
      }
    );
    menu.appendChild(entryMystify);
  } else {
    // ── Identify ──
    const entryIdentify = _makeEntry(
      "fas fa-eye", "Identify Item",
      async () => {
        _closeContextMenu(menu);
        await identifyItem(item);
        // Force rerender so inventory rows show real identity immediately.
        // Under the non-destructive model, a rerender is required because the
        // display layer (not document mutation) drives what is visible.
        app.render({ force: true });
      }
    );
    menu.appendChild(entryIdentify);
  }
}

/**
 * @param {string} iconClass
 * @param {string} label
 * @param {Function} onClick
 * @returns {HTMLLIElement}
 */
function _makeEntry(iconClass, label, onClick) {
  const li = document.createElement("li");
  li.className = "context-item dhui-ctx-entry";
  li.innerHTML = `<i class="${iconClass}"></i> ${label}`;
  li.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return li;
}

/**
 * Closes the context menu by triggering a mouseleave event and removing the element.
 * @param {HTMLElement} menu
 */
function _closeContextMenu(menu) {
  menu.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  menu.remove();
}
