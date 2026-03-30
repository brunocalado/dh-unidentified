// ============================================================
// dh-unidentified | main.js
// Module entry point.
// ============================================================

import { onRenderItemSheet }           from "./sheet-hook.js";
import { patchActorSheetContextMenus } from "./context-menu.js";
import { isUnidentified, getFlags, identifyItem, _esc } from "./unidentified.js";
import { registerSettings, getSfxSettings } from "./settings.js";
import { Identify, IdentifyPromptApp } from "./identify-app.js";

const MODULE_ID = "dh-unidentified";

function log(...args) { console.log(`[${MODULE_ID}]`, ...args); }

// ── init ─────────────────────────────────────────────────────

Hooks.once("init", () => {
  log("init");
  registerSettings();
});

// ── ready ─────────────────────────────────────────────────────

Hooks.once("ready", () => {
  log("ready");
  _registerHooks();
  _registerSocketHandler();
  game.modules.get(MODULE_ID).api = { isUnidentified, getFlags, Identify };
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
 * Listens for changes to the "identifyRequest" world setting.
 * The GM writes the setting; Foundry broadcasts the updateSetting hook to every client.
 * Each client checks whether it is the intended target before opening the prompt.
 * Called once in the "ready" hook.
 *
 * @listens Hooks#updateSetting
 */
function _registerSocketHandler() {
  const SOCKET_ID = `module.${MODULE_ID}`;

  // Handles socket messages from players requesting identify-roll resolution.
  // Only the active GM processes the request — identifyItem() and ChatMessage.create()
  // both require GM-level permissions. Uses game.socket (declared in module.json)
  // because CONFIG.queries does not reliably pass payload data in Foundry V13.
  game.socket.on(SOCKET_ID, async (payload) => {
    if (payload?.type !== "identifyResult") return;
    if (game.users.activeGM?.id !== game.user.id) return;

    const { actorId, itemId, success } = payload;
    const actor = game.actors.get(actorId);
    const item  = actor?.items.get(itemId);
    if (!item) return;

    if (success) await identifyItem(item);
    await _sendIdentifyResultMessage(item, success);
  });

  Hooks.on("updateSetting", (setting) => {
    if (setting.key !== `${MODULE_ID}.identifyRequest`) return;
    if (game.user.isGM) return;

    const { targetUserId, payload } = setting.value ?? {};
    if (!payload) return;
    // Empty targetUserId means "All Players"; otherwise check for a match.
    if (targetUserId && game.user.id !== targetUserId) return;

    // Close any existing identify prompt before showing a new one.
    foundry.applications.instances.get("dhui-identify-prompt")?.close();

    const width = 480;
    new IdentifyPromptApp(payload, {
      position: {
        left: Math.max(0, (window.innerWidth  - width) / 2),
        top:  Math.max(0, (window.innerHeight - 420)   / 2),
      },
    }).render({ force: true });
  });

  // Expose a global shorthand so GMs can open the dialog with: Identify.open()
  window.Identify = Identify;

  log("identify handler registered.");
}

// ── Runtime hooks ─────────────────────────────────────────────

function _registerHooks() {

  Hooks.on("renderHandlebarsApplication", (app, element) => {
    onRenderItemSheet(app, element);
    _handleActorSheetRender(app, element);
  });

  // Data-layer guard: block non-GM edits on unidentified items
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
  // Using createChatMessage instead of preCreateChatMessage avoids the race where
  // Daggerheart creates preliminary messages before the roll result, which would
  // consume _pendingIdentify too early and leave the actual result unhandled.
  Hooks.on("createChatMessage", (message) => {
    const pending = game.modules.get(MODULE_ID)._pendingIdentify;
    if (!pending || Date.now() > pending.expires) return;

    // Skip messages without a roll result (system notices, flavor text, etc.)
    if (message.system?.roll?.success === undefined) return;

    // Consume immediately to prevent a second roll in the TTL window from re-triggering.
    game.modules.get(MODULE_ID)._pendingIdentify = null;

    const success = message.system.roll.success === true;

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

  // Bloqueia uso de actions em itens não identificados (player only).
  // daggerheart.preUseAction dispara para Generic, Attack, Damage, Macro
  // e qualquer action futura — um único hook cobre tudo.
  // DHEffectAction.parent aponta para o Item pai.
  Hooks.on("daggerheart.preUseAction", (action, _options) => {
    if (game.user.isGM) return true;
    const item = action.parent;
    if (!item || !isUnidentified(item)) return true;
    ui.notifications.warn("[DH Unidentified] This item cannot be used while unidentified.");
    return false;
  });

  log("hooks registered.");
}

// ── Actor sheet ───────────────────────────────────────────────

function _handleActorSheetRender(app, element) {
  const actor = app.document ?? app.actor ?? app.object;
  if (!(actor instanceof Actor)) return;

  // GM-only context menu injection (Mystify / Identify entries)
  patchActorSheetContextMenus(app, element);

  // Teal outline on unidentified rows — visible to BOTH GM and player
  _markUnidentifiedRows(actor, element);

  // Hide mechanical details — player only
  if (!game.user.isGM) {
    _hideUnidentifiedDetails(actor, element);
  }
}

// ── Teal outline (GM + player) ────────────────────────────────

function _markUnidentifiedRows(actor, element) {
  element.querySelectorAll("li.inventory-item[data-item-id]").forEach(li => {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || !isUnidentified(item)) return;
    li.classList.add("dhui-unidentified-row");
  });
}

// ── Hide details (player only) ────────────────────────────────

function _hideUnidentifiedDetails(actor, element) {
  element.querySelectorAll("li.inventory-item[data-item-id]").forEach(li => {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || !isUnidentified(item)) return;

    // Expandable description row ("Heavy: -1 to Evasion", invetory-description)
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
    // Selector confirmed from template inventory-item-V2.hbs line 127
    li.querySelectorAll("[data-action='triggerContextMenu']").forEach(el => {
      el.style.setProperty("display", "none", "important");
    });

    // Esconde o container de actions da linha de inventário.
    // .item-buttons contém N botões (Generic, Attack, Damage, Macro...).
    // Esconder o container cobre qualquer quantidade de actions presentes.
    li.querySelectorAll(".item-buttons").forEach(el => {
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
 * Called by the GM's socket handler after identification is processed.
 * On success, identifyItem() has already restored item.name and item.img to
 * their real values, so the card always shows the most relevant display state.
 *
 * @param {Item}    item    - The item (post-update on success, still masked on failure)
 * @param {boolean} success - Whether the identification roll succeeded
 * @returns {Promise<void>}
 */
async function _sendIdentifyResultMessage(item, success) {
  const borderColor = success ? "#C9A060" : "#666666";
  const headerText  = success ? "Item Identified!" : "Identification Failed";
  const bodyText    = success
    ? `<em>${_esc(item.name)}</em> has been identified — its true nature is now revealed.`
    : `The nature of <em>${_esc(item.name)}</em> remains hidden.`;

  const content = `
  <div style="border:2px solid ${borderColor};border-radius:8px;overflow:hidden;">
    <header style="background:#191919;padding:8px;border-bottom:2px solid ${borderColor};text-align:center;">
      <h3 style="margin:0;font-weight:bold;color:${borderColor};font-family:'Aleo',serif;text-transform:uppercase;letter-spacing:1px;">
        ${headerText}
      </h3>
    </header>
    <div style="background:#111;padding:14px 16px;display:flex;gap:14px;align-items:center;">
      <img src="${_esc(item.img)}" style="width:54px;height:54px;object-fit:contain;border:none;flex-shrink:0;">
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

// ── Sidebar tooltip: real name for GM ────────────────────────
//
// The ItemDirectory sidebar uses data-entry-id (confirmed from
// actor-document-partial.hbs). The name lives inside a.entry-name > span.
// We use mouseenter to activate the Foundry tooltip manually via game.tooltip,
// which is more reliable than data-tooltip in the sidebar context.

Hooks.on("renderItemDirectory", (_app, html) => {
  if (!game.user.isGM) return;

  // V13: html may be HTMLElement or jQuery
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  // Foundry core ItemDirectory uses data-entry-id on the li
  root.querySelectorAll("li.directory-item[data-entry-id]").forEach(li => {
    const itemId = li.dataset.entryId;
    const item   = game.items.get(itemId);
    if (!item || !isUnidentified(item)) return;

    const flags    = getFlags(item);
    const realName = flags.realName ?? "?";

    // Add teal dot visual cue before the item name
    const nameEl = li.querySelector("a.entry-name span, .document-name");
    if (nameEl && !li.querySelector(".dhui-sidebar-dot")) {
      const dot = document.createElement("i");
      dot.className = "dhui-sidebar-dot fas fa-circle";
      li.querySelector("a.entry-name")?.insertBefore(dot, nameEl);
    }

    // Use mouseenter + game.tooltip.activate for reliable tooltip display
    // data-tooltip alone may not fire in sidebar due to DhTooltipManager
    if (!li.dataset.dhuiTooltipBound) {
      li.dataset.dhuiTooltipBound = "1";
      li.addEventListener("mouseenter", () => {
        game.tooltip.activate(li, {
          text: `Real name: "${realName}"`,
          direction: "RIGHT",
        });
      });
      li.addEventListener("mouseleave", () => {
        game.tooltip.deactivate();
      });
    }
  });
});
