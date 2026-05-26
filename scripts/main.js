// ============================================================
// dh-unidentified | main.js
// Module entry point.
// ============================================================

import { MODULE_ID }                   from "./constants.js";
import { onRenderItemSheet }           from "./sheet-hook.js";
import { patchActorSheetContextMenus } from "./context-menu.js";
import {
  isUnidentified, isSupported, getFlags, identifyItem, openMystifyDialog, _esc,
  getDisplayName, getDisplayImg, getDisplayDescription,
  isLegacyDestructiveState, buildLegacyMigrationUpdate,
} from "./unidentified.js";
import { registerSettings, getSfxSettings } from "./settings.js";
import { Identify, IdentifyPromptApp } from "./identify-app.js";

function log(...args) { console.log(`[${MODULE_ID}]`, ...args); }

// ── init ─────────────────────────────────────────────────────

Hooks.once("init", () => {
  log("init");
  registerSettings();
});

// ── ready ─────────────────────────────────────────────────────

Hooks.once("ready", async () => {
  log("ready");
  _registerHooks();
  _registerSocketHandler();
  game.modules.get(MODULE_ID).api = { isUnidentified, getFlags, Identify, getDisplayName, getDisplayImg };

  // One-time GM-only migration: restore items written by the old destructive model.
  // This pass is idempotent — isLegacyDestructiveState returns false after first run.
  if (game.user.isGM) await _runLegacyMigration();
});

// ── Daggerheart Menu button ───────────────────────────────────
// Registered at module level so it fires before the "ready" hook,
// when DaggerheartMenu is first rendered during Foundry's init phase.

/**
 * Injects an "Identify Items" button into the Daggerheart Menu.
 * Triggered by the `renderDaggerheartMenu` hook.
 * @listens Hooks#renderDaggerheartMenu
 * @param {Application} _app - The DaggerheartMenu application instance.
 * @param {HTMLElement|jQuery} element - The rendered HTML element.
 */
Hooks.on("renderDaggerheartMenu", (_app, element) => {
  if (!game.user.isGM) return;

  // DaggerheartMenu uses AppV1 and may pass a jQuery object; unwrap if needed.
  const html = element instanceof jQuery ? element[0] : element;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.innerHTML = `<i class="fas fa-eye"></i> Identify Items`;
  btn.classList.add("dh-custom-btn");
  btn.style.marginTop = "10px";
  btn.style.width = "100%";

  btn.onclick = () => Identify.Open();

  const fieldset = html.querySelector("fieldset");
  if (fieldset) {
    const newFieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.innerText = "Unidentified";
    newFieldset.appendChild(legend);
    newFieldset.appendChild(btn);
    fieldset.after(newFieldset);
  } else {
    html.appendChild(btn);
  }
});

// ── Socket handler ────────────────────────────────────────────

/**
 * Registers the module socket listener that routes all inter-client messages.
 *   - identifyRequest (GM → Player): GM sends the identify-roll prompt payload;
 *     each player client checks targetUserId and opens IdentifyPromptApp if matched.
 *   - identifyResult  (Player → GM): Player sends roll outcome; active GM
 *     applies identification and posts the result chat message.
 * Called once in the "ready" hook.
 */
function _registerSocketHandler() {
  const SOCKET_ID = `module.${MODULE_ID}`;

  // Central socket dispatcher — all module messages arrive here.
  // Message routing is decided by msg.type so both directions share one listener.
  game.socket.on(SOCKET_ID, async (msg) => {

    // ── identifyResult: Player → GM ──────────────────────────────────────────
    // Only the active GM processes the result — identifyItem() and
    // ChatMessage.create() both require GM-level permissions.
    if (msg?.type === "identifyResult") {
      if (game.users.activeGM?.id !== game.user.id) return;

      const { actorId, itemId, success } = msg;
      const actor = game.actors.get(actorId);
      const item  = actor?.items.get(itemId);
      if (!item) return;

      if (success) await identifyItem(item);
      await _sendIdentifyResultMessage(item, success);

      // Rerender the actor sheet so inventory rows reflect the new identified state.
      _rerenderSheetsForItem(item);
      return;
    }

    // ── identifyRequest: GM → Player ─────────────────────────────────────────
    // The GM emits this; every client receives it but only the target player acts.
    // Using socket.emit instead of game.settings.set avoids a pitfall where
    // the updateSetting hook receives a serialised Setting document whose .value
    // may be a raw JSON string rather than a parsed object, causing silent failures.
    if (msg?.type === "identifyRequest") {
      console.log(`[DH Unidentified] socket identifyRequest received — isGM:${game.user.isGM} userId:${game.user.id}`, msg);
      if (game.user.isGM) return;

      const { targetUserId, payload } = msg;
      if (!payload) { console.warn("[DH Unidentified] identifyRequest: payload missing"); return; }
      // Empty targetUserId means "All Players"; otherwise only the target acts.
      if (targetUserId && game.user.id !== targetUserId) {
        console.log(`[DH Unidentified] identifyRequest: not for me (target:${targetUserId} me:${game.user.id})`);
        return;
      }

      console.log("[DH Unidentified] identifyRequest: rendering IdentifyPromptApp for this player", payload);
      // Close any existing identify prompt before showing a new one.
      foundry.applications.instances.get("dhui-identify-prompt")?.close();

      const width = 480;
      new IdentifyPromptApp(payload, {
        position: {
          left: Math.max(0, (window.innerWidth  - width) / 2),
          top:  Math.max(0, (window.innerHeight - 420)   / 2),
        },
      }).render({ force: true });
      return;
    }
  });

  // Expose a global shorthand so GMs can open the dialog with: Identify.open()
  window.Identify = Identify;

  log("identify handler registered.");
}

// ── Runtime hooks ─────────────────────────────────────────────

function _registerHooks() {

  // ── Block right-click context menu for non-GM on unidentified items ──
  // Registered on document in capture phase so it fires before every other handler,
  // regardless of where DH attaches its own contextmenu listener in the DOM.
  // stopImmediatePropagation in document-capture prevents the event from ever
  // reaching any child element, so the DH context menu is never rendered.
  if (!game.user.isGM) {
    // Shared helper: parse the embedded-document UUID on an inventory li and return
    // the unidentified item, or null if the row doesn't represent one.
    // Expected UUID format: "Actor.{actorId}.{DocumentType}.{docId}"
    const _getUnidentifiedItemFromLi = (li) => {
      const uuid = li?.dataset.itemUuid;
      if (!uuid) return null;
      const parts = uuid.split(".");
      if (parts[0] !== "Actor" || parts.length < 4) return null;
      // Action sub-rows share the same li class but are embedded inside items.
      if (parts[2] === "Action") return null;
      const actor = game.actors.get(parts[1]);
      if (!actor) return null;
      const item = actor.items.get(parts[3]);
      if (!item || !isSupported(item) || !isUnidentified(item)) return null;
      return item;
    };

    // Block right-click context menu — DH's listener never sees the event.
    document.addEventListener("contextmenu", (event) => {
      const li = event.target.closest("li.inventory-item");
      if (!_getUnidentifiedItemFromLi(li)) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    }, true);

    // Block clicks on the item icon so players cannot open the item sheet
    // or trigger any click-based action on an unidentified item's icon.
    document.addEventListener("click", (event) => {
      if (event.target.tagName !== "IMG") return;
      const li = event.target.closest("li.inventory-item");
      if (!_getUnidentifiedItemFromLi(li)) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    }, true);
  }

  Hooks.on("renderHandlebarsApplication", (app, element) => {
    onRenderItemSheet(app, element);
    _handleActorSheetRender(app, element);
  });

  // ── Header ⋮ menu: Mystify / Identify buttons on item sheets ──
  // getHeaderControlsItemSheetV2 fires for every class that extends
  // ItemSheetV2, including all Daggerheart item sheets (ArmorSheet,
  // WeaponSheet, ConsumableSheet, LootSheet, etc.).
  Hooks.on("getHeaderControlsItemSheetV2", (app, controls) => {
    const item = app.document ?? app.item ?? app.object;
    if (!(item instanceof Item)) return;
    if (!isSupported(item)) return;
    if (!game.user.isGM) return;

    if (isUnidentified(item)) {
      controls.push({
        icon: "fa-solid fa-eye",
        label: "Identify Item",
        action: "dhuiidentify",
      });
      app.options.actions ??= {};
      // Opens the dialog so the GM can inspect the mask and choose to identify
      // or re-mystify, rather than identifying immediately without confirmation.
      app.options.actions["dhuiidentify"] = async () => {
        await openMystifyDialog(item);
        app.render({ force: true });
        _rerenderSheetsForItem(item);
      };
    } else {
      controls.push({
        icon: "fa-solid fa-eye-slash",
        label: "Mystify Item",
        action: "dhuimystify",
      });
      app.options.actions ??= {};
      app.options.actions["dhuimystify"] = async () => {
        await openMystifyDialog(item);
        app.render({ force: true });
        _rerenderSheetsForItem(item);
      };
    }
  });

  // Data-layer guard: block non-GM edits on unidentified items.
  // Because real data lives in the document, this guard is still needed to
  // prevent players from editing (and inadvertently seeing) canonical fields.
  Hooks.on("preUpdateItem", (item, changes, _options, _userId) => {
    if (game.user.isGM) return true;
    if (!isUnidentified(item)) return true;
    const touchesEquip = changes?.system?.equipped !== undefined;
    ui.notifications.warn(touchesEquip
      ? "[DH Unidentified] Only the GM can equip or unequip unidentified items."
      : "[DH Unidentified] This item cannot be edited while unidentified."
    );
    return false;
  });

  // ── Identify-roll integration ─────────────────────────────

  // Detects the /dr roll result on the player's own client (the only client with
  // _pendingIdentify set) and delegates identification to the GM via module socket.
  Hooks.on("createChatMessage", (message) => {
    const pending = game.modules.get(MODULE_ID)._pendingIdentify;
    if (!pending || Date.now() > pending.expires) return;

    // In Daggerheart v14 the ChatMessage system object is schema-validated and no longer
    // carries a top-level `roll` field. The roll result (including `success`) now lives
    // inside message.rolls[0].options.roll, so we read from there instead.
    if (message.type !== "dualityRoll") return;
    const rollOptions = message.rolls?.[0]?.options?.roll;
    if (rollOptions?.success === undefined) return;

    // Consume immediately to prevent a second roll in the TTL window from re-triggering.
    game.modules.get(MODULE_ID)._pendingIdentify = null;

    const success = rollOptions.success === true;

    // Audible feedback for the rolling player — only this client has _pendingIdentify set.
    const sfx  = getSfxSettings();
    const path = success ? sfx.successPath : sfx.failurePath;
    if (path) foundry.audio.AudioHelper.play({ src: path, volume: 0.8, loop: false });

    // Emit to all clients — the GM-side socket listener filters by activeGM.
    game.socket.emit(`module.${MODULE_ID}`, {
      type:    "identifyResult",
      actorId: pending.actorId,
      itemId:  pending.itemId,
      success,
    });
  });

  // Blocks usage of actions on unidentified items (player only).
  // daggerheart.preUseAction fires for Generic, Attack, Damage, Macro, and any future action.
  Hooks.on("daggerheart.preUseAction", (action, _options) => {
    if (game.user.isGM) return true;
    const item = action.parent;
    if (!item || !isUnidentified(item)) return true;
    ui.notifications.warn("[DH Unidentified] This item cannot be used while unidentified.");
    return false;
  });

  log("hooks registered.");
}

// ── Legacy migration ──────────────────────────────────────────

/**
 * One-time world migration pass for the active GM.
 * Detects items written by the old destructive model (pre-0.0.3) that have
 * their real name/img/description stored in backup flags, restores them, and
 * removes the obsolete backup flags. Batches updates per collection to comply
 * with the module's no-sequential-update rule.
 *
 * Called from Hooks.once("ready").
 * @returns {Promise<void>}
 */
async function _runLegacyMigration() {
  // ── World-level items ──
  const worldUpdates = game.items.contents
    .filter(item => isLegacyDestructiveState(item))
    .map(item => buildLegacyMigrationUpdate(item));

  if (worldUpdates.length) {
    await Item.implementation.updateDocuments(worldUpdates);
  }

  // ── Actor-embedded items — grouped by parent actor for batch updates ──
  /** @type {Map<string, object[]>} actorId → array of item update objects */
  const actorItemUpdates = new Map();

  for (const actor of game.actors.contents) {
    for (const item of actor.items.contents) {
      if (!isLegacyDestructiveState(item)) continue;
      if (!actorItemUpdates.has(actor.id)) actorItemUpdates.set(actor.id, []);
      actorItemUpdates.get(actor.id).push(buildLegacyMigrationUpdate(item));
    }
  }

  // Each batch targets one actor, satisfying the same-collection batch requirement.
  for (const [actorId, updates] of actorItemUpdates) {
    const actor = game.actors.get(actorId);
    if (actor) await Item.implementation.updateDocuments(updates, { parent: actor });
  }

  const total = worldUpdates.length + [...actorItemUpdates.values()].reduce((n, arr) => n + arr.length, 0);
  if (total > 0) {
    log(`Legacy migration complete: ${total} item(s) restored to non-destructive model.`);
    ui.notifications.info(`[DH Unidentified] Migrated ${total} item(s) from the old destructive model. Real item data has been restored.`);
  }
}

// ── Rerender helper ───────────────────────────────────────────

/**
 * Forces a rerender of any open actor sheet that owns this item and any open
 * item sheet for the item itself. Called after identify/mystify so the display
 * layer reflects the new flag state immediately without requiring a manual refresh.
 * @param {Item} item
 * @returns {void}
 */
function _rerenderSheetsForItem(item) {
  // Rerender the item's own sheet if it is open
  if (item.sheet?.rendered) item.sheet.render({ force: true });

  // Rerender the owning actor's sheet so inventory rows update
  if (item.parent instanceof Actor && item.parent.sheet?.rendered) {
    item.parent.sheet.render({ force: true });
  }
}

// ── Actor sheet ───────────────────────────────────────────────

function _handleActorSheetRender(app, element) {
  const actor = app.document ?? app.actor ?? app.object;
  if (!(actor instanceof Actor)) return;

  // GM-only context menu injection (Mystify / Identify entries)
  patchActorSheetContextMenus(app, element);

  // Teal outline on unidentified rows — visible to BOTH GM and player
  _markUnidentifiedRows(actor, element);

  // Hide mechanical details and mask identity — player only
  if (!game.user.isGM) {
    _hideUnidentifiedDetails(actor, element);
  }
}

// ── Teal outline (GM + player) ────────────────────────────────

/**
 * Adds the dhui-unidentified-row CSS class to inventory list items for
 * unidentified items. Pure visual cue; no data reads required.
 * @param {Actor}       actor
 * @param {HTMLElement} element
 */
function _markUnidentifiedRows(actor, element) {
  element.querySelectorAll("li.inventory-item[data-item-id]").forEach(li => {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || !isUnidentified(item)) return;
    li.classList.add("dhui-unidentified-row");
  });
}

// ── Hide details and mask identity (player only) ──────────────

/**
 * For each unidentified item in the actor's inventory:
 *  - Replaces the visible name text and icon with masked equivalents,
 *    because real data now lives in item.name/img (document fields), not in
 *    masked flags. Without this replacement, players would see the real item
 *    identity in the inventory row.
 *  - Hides mechanical detail sections (description, tags, actions, expand icon).
 *
 * @param {Actor}       actor
 * @param {HTMLElement} element
 */
function _hideUnidentifiedDetails(actor, element) {
  element.querySelectorAll("li.inventory-item[data-item-id]").forEach(li => {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || !isUnidentified(item)) return;

    const maskedName = getDisplayName(item);
    const maskedImg  = getDisplayImg(item);

    // ── Replace identity cues with masked equivalents ──
    // Because real data is now preserved in item.name/img, we must actively
    // substitute masked presentation values in every visible identity element.

    // Item icon (may be inside .inventory-item-header or directly in the li)
    li.querySelectorAll("img").forEach(img => {
      if (!img.dataset.dhuiOrigSrc) img.dataset.dhuiOrigSrc = img.src;
      img.src = maskedImg;
      img.style.cursor = "default"; // visual cue: icon is not interactive

      // Intercept the icon tooltip so real item details are never revealed on hover.
      // Strips data-tooltip* attributes (used by Foundry's TooltipManager) from the img
      // and its immediate wrapper, then uses capture-phase stopImmediatePropagation to
      // block any system-level mouseenter listener registered during sheet render.
      if (!img.dataset.dhuiTooltipBound) {
        img.dataset.dhuiTooltipBound = "1";

        [img, img.parentElement].filter(Boolean).forEach(el => {
          if (el === li) return; // never strip from the row element itself
          for (const attr of [...el.attributes]) {
            if (attr.name.startsWith("data-tooltip")) el.removeAttribute(attr.name);
          }
        });

        const maskedDesc = getDisplayDescription(item);
        img.addEventListener("mouseenter", (e) => {
          e.stopImmediatePropagation();
          if (maskedDesc) game.tooltip.activate(img, { text: maskedDesc, direction: "RIGHT" });
        }, true);
        img.addEventListener("mouseleave", () => {
          game.tooltip.deactivate();
        }, true);
      }
    });

    // Item name — target common DH inventory row name selectors
    const nameEl = li.querySelector(
      ".item-name, .inventory-item-name, [class*='item-name'], " +
      ".inventory-item-header span, .inventory-item-header a"
    );
    if (nameEl) {
      if (!nameEl.dataset.dhuiOrigText) nameEl.dataset.dhuiOrigText = nameEl.textContent;
      nameEl.textContent = maskedName;
    }

    // ── Hide mechanical details ──

    // Expandable description row
    li.querySelectorAll(".inventory-item-content, .invetory-description").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Item tags (Base Score, Thresholds, damage dice)
    li.querySelectorAll(".item-tags").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Expand icon (pointless with content hidden)
    li.querySelectorAll(".expanded-icon").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // "More Options" three-dots button — opens context menu with Edit
    li.querySelectorAll("[data-action='triggerContextMenu']").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Action buttons (Generic, Attack, Damage, Macro...)
    li.querySelectorAll(".item-buttons").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Equip / unequip toggle (weapon and armor share the same data-action)
    li.querySelectorAll("[data-action='toggleEquipItem']").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Send to Chat button — target only the <a> anchor in .controls.
    // The img-portait container also carries data-action="toChat" for consumable/loot
    // items (when item.usable is false), so a bare attribute selector would
    // accidentally hide the entire icon area and collapse the row height.
    li.querySelectorAll("a[data-action='toChat']").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Edit button — party actor sheet renders this per item row; hiding it prevents
    // players from opening the real item sheet and bypassing the identity mask.
    li.querySelectorAll("[data-action='editDoc']").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Quantity field (consumable, loot) — must not reveal stack size to players
    li.querySelectorAll(".item-resource").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Remove toggleExtended so clicking the row header does nothing
    const header = li.querySelector(".inventory-item-header[data-action='toggleExtended']");
    if (header) header.removeAttribute("data-action");
  });
}

// ── Identify result chat message ──────────────────────────────

/**
 * Creates a public chat message announcing the outcome of an identify roll.
 * Uses display helpers to derive audience-appropriate name and image:
 *   - On success: identifyItem() has already set identified=true, so
 *     getDisplayName returns item.name (real). Real identity is intentionally revealed.
 *   - On failure: identified=false remains, so getDisplayName returns the masked alias.
 *     True identity is not leaked to chat.
 *
 * @param {Item}    item    - The item (post-update on success, still unidentified on failure)
 * @param {boolean} success - Whether the identification roll succeeded
 * @returns {Promise<void>}
 */
async function _sendIdentifyResultMessage(item, success) {
  // After a successful identifyItem(), identified=true → getDisplayName returns item.name.
  // After a failed roll, identified=false → getDisplayName returns the masked alias.
  const displayName = getDisplayName(item);
  const displayImg  = getDisplayImg(item);

  const borderColor = success ? "#C9A060" : "#666666";
  const headerText  = success ? "Item Identified!" : "Identification Failed";
  const bodyText    = success
    ? `<em>${_esc(displayName)}</em> has been identified — its true nature is now revealed.`
    : `The nature of <em>${_esc(displayName)}</em> remains hidden.`;

  const content = `
  <div style="border:2px solid ${borderColor};border-radius:8px;overflow:hidden;">
    <header style="background:#191919;padding:8px;border-bottom:2px solid ${borderColor};text-align:center;">
      <h3 style="margin:0;font-weight:bold;color:${borderColor};font-family:'Aleo',serif;text-transform:uppercase;letter-spacing:1px;">
        ${headerText}
      </h3>
    </header>
    <div style="background:#111;padding:14px 16px;display:flex;gap:14px;align-items:center;">
      <img src="${_esc(displayImg)}" style="width:54px;height:54px;object-fit:contain;border:none;flex-shrink:0;">
      <span style="color:#ccc;font-family:'Lato',sans-serif;font-size:1em;line-height:1.5;">
        ${bodyText}
      </span>
    </div>
  </div>`;

  await ChatMessage.create({
    user:    game.user.id,
    speaker: ChatMessage.getSpeaker(),
    content,
    style:   CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

// ── Sidebar: unidentified cue in Item Directory ───────────────
//
// Under the non-destructive model, item.name is always the real name.
// For GMs: show real name in the sidebar (as document data) + tooltip showing the masked alias.
// For players: replace the displayed name with the masked alias to prevent leaking real identity.

Hooks.on("renderItemDirectory", (_app, html) => {
  // V14: html may be HTMLElement or jQuery
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  root.querySelectorAll("li.directory-item[data-entry-id]").forEach(li => {
    const itemId = li.dataset.entryId;
    const item   = game.items.get(itemId);
    if (!item || !isUnidentified(item)) return;

    const flags      = getFlags(item);
    const maskedName = flags.maskedName ?? "?";

    // Add teal dot visual cue for everyone who can see this entry
    const nameEl = li.querySelector("a.entry-name span, .document-name");
    if (nameEl && !li.querySelector(".dhui-sidebar-dot")) {
      const dot = document.createElement("i");
      dot.className = "dhui-sidebar-dot fas fa-circle";
      li.querySelector("a.entry-name")?.insertBefore(dot, nameEl);
    }

    if (game.user.isGM) {
      // GM sees real name (item.name) but gets a tooltip showing the masked alias.
      // "Real name" tooltip label is gone — item.name IS the real name now.
      if (!li.dataset.dhuiTooltipBound) {
        li.dataset.dhuiTooltipBound = "1";
        li.addEventListener("mouseenter", () => {
          game.tooltip.activate(li, {
            text: `Masked as: "${maskedName}"`,
            direction: "RIGHT",
          });
        });
        li.addEventListener("mouseleave", () => {
          game.tooltip.deactivate();
        });
      }
    } else {
      // Non-GM: replace the visible name text with the masked alias so real identity
      // is not leaked through the sidebar. This mirrors the inventory-row masking in
      // _hideUnidentifiedDetails for actor sheets.
      if (nameEl && !nameEl.dataset.dhuiMasked) {
        nameEl.dataset.dhuiMasked = "1";
        nameEl.textContent = maskedName;
      }
    }
  });
});
