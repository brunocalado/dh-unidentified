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
 * @param {ApplicationV2} app
 * @param {HTMLElement}   element
 */
export function patchActorSheetContextMenus(app, element) {
  if (!game.user.isGM) return;

  const actor = app.document ?? app.actor ?? app.object;
  if (!(actor instanceof Actor)) return;

  // Only character sheets have the inventory
  if (actor.type !== "character") return;

  // Attach to the items-list container (delegated)
  const list = element.querySelector(".items-section, .items-list, section.inventory");
  if (!list) return;

  // Guard: only attach once
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
        // Player: remove "Edit" and any other entries that open the item sheet
        // Context menu entries are <li class="context-item"> with text content
        menu.querySelectorAll("li.context-item").forEach(li => {
          const text = li.textContent?.trim().toLowerCase() ?? "";
          // Block: Edit, Use Item, Send to Chat — anything that reveals data
          // Keep: nothing (overlay already blocks the sheet, but belt+suspenders)
          if (text.includes("edit") || text.includes("use item") || text.includes("send to chat")) {
            li.style.setProperty("display", "none", "important");
          }
        });
      }
    });
  }, true); // capture phase — runs before DH's listener
}

function _injectMenuEntries(menu, item, app) {
  // Avoid duplicate injection
  if (menu.querySelector(".dhui-ctx-entry")) return;

  // ── Separator ──
  const sep = document.createElement("li");
  sep.className = "dhui-ctx-entry dhui-ctx-sep";
  sep.setAttribute("role", "separator");
  menu.appendChild(sep);

  if (!isUnidentified(item)) {
    // ── Mystify ──
    // Only shown when the item is NOT mystified — prevents double-mystify which
    // would corrupt realName/realImg by overwriting them with the masked values.
    const entryMystify = _makeEntry(
      "fas fa-eye-slash", "Mystify Item",
      async () => {
        _closeContextMenu(menu);
        await openMystifyDialog(item);
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
      }
    );
    menu.appendChild(entryIdentify);
  }
}

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

function _closeContextMenu(menu) {
  // Trigger a click outside to let Foundry close the menu cleanly
  menu.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  menu.remove();
}
