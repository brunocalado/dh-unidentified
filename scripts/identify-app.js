/*!
 * Daggerheart: Unidentified Items
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * @file identify-app.js
 * Provides the GM-facing IdentifyApp dialog and the player-facing IdentifyPromptApp,
 * both required for the identify-roll request workflow.
 *
 * Flow:
 *   GM opens Identify.Open()  →  IdentifyApp  →  sends socket payload to player
 *   Player receives payload   →  IdentifyPromptApp  →  player clicks → ui.chat.processMessage
 */

import { MODULE_ID } from "./constants.js";
import { isUnidentified, getDisplayName, getDisplayImg, _esc } from "./unidentified.js";
import { getLastIdentifyTrait, setLastIdentifyTrait } from "./settings.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/identify-request.hbs`;

/** Trait names supported by the Daggerheart /dr command. */
const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

/** Actor type the Daggerheart system uses for the shared party sheet. */
const PARTY_ACTOR_TYPE = "party";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Collects every world actor of type "party" that all players fully own.
 *
 * Two ownership configurations qualify, because both mean "everyone owns this sheet":
 *   - default ownership set to OWNER (the common "all players" setup), or
 *   - an explicit per-user OWNER grant covering every non-GM user.
 *
 * Items sitting on such an actor belong to the group rather than to one character,
 * so they are offered alongside the selected player's own unidentified items.
 * @returns {Actor[]} Qualifying party actors, empty when none is configured.
 */
function getSharedPartyActors() {
    const OWNER   = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const players = game.users.filter(u => !u.isGM);

    return game.actors.filter(actor => {
        if (actor.type !== PARTY_ACTOR_TYPE) return false;
        if ((actor.ownership?.default ?? 0) >= OWNER) return true;
        return players.length > 0 && players.every(u => (actor.ownership?.[u.id] ?? 0) >= OWNER);
    });
}

// ==================================================================
// IDENTIFY APP — GM dialog
// ==================================================================

/**
 * GM-facing dialog for requesting an identify roll from a player.
 *
 * NOTE: BASE_APPLICATION is intentionally NOT set on this class.
 * Setting BASE_APPLICATION on a HandlebarsApplicationMixin subclass stops
 * DEFAULT_OPTIONS merging from parent classes, which prevents the ApplicationV2
 * base defaults (window.frame, window.positioned, window.draggable, etc.) from
 * being inherited — causing the window to render without its chrome (title bar,
 * close button, drag handle). The reference pattern (see demo/request_roll.js)
 * confirms that HandlebarsApplicationMixin apps must not set BASE_APPLICATION.
 */
export class IdentifyApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @type {string|null} ID of the user whose items are currently listed. */
    #selectedUserId = null;

    static DEFAULT_OPTIONS = {
        id:       "dhui-identify-app",
        tag:      "form",
        classes:  ["dh-unidentified", "dhui-identify-app"],
        window:   { title: "Request Identify Roll", icon: "fas fa-eye", resizable: false },
        position: { width: 600, height: "auto" },
        actions:  {},
    };

    static PARTS = {
        form: { template: TEMPLATE },
    };

    /**
     * Builds template context. Only surfaces users who are active, non-GM,
     * and have a linked character actor — the only actors we can query for items.
     * Called automatically by HandlebarsApplicationMixin before rendering each PART.
     * @override
     * @param {object} _options
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        const users = game.users
            .filter(u => u.active && !u.isGM && u.character)
            .map(u => ({ id: u.id, name: u.name, color: u.color.css }));

        // Auto-select the first eligible user on first open.
        if (!this.#selectedUserId && users.length) {
            this.#selectedUserId = users[0].id;
        }

        return {
            users,
            selectedUserId: this.#selectedUserId,
            traits:      TRAITS,
            difficulty:  15,
            activeTrait: getLastIdentifyTrait(),
        };
    }

    /**
     * Wires all interactive elements after each render.
     * Called by the AppV2 lifecycle after the template is injected into the DOM.
     * @override
     * @param {object} _context
     * @param {object} _options
     */
    _onRender(_context, _options) {
        const html = this.element;

        // ── User selector ──────────────────────────────────────────
        const userSelect = html.querySelector("select[name='targetUser']");
        if (userSelect) {
            userSelect.addEventListener("change", () => {
                this.#selectedUserId = userSelect.value;
                const actor = game.users.get(this.#selectedUserId)?.character ?? null;
                this._refreshItemList(actor);
            });
            // Populate list immediately for the initially selected user.
            const initialActor = game.users.get(this.#selectedUserId)?.character ?? null;
            this._refreshItemList(initialActor);
        }

        // ── Trait buttons — mutually exclusive, last selection persisted ──
        const traitInput   = html.querySelector("input[name='trait']");
        const traitButtons = html.querySelectorAll(".dhui-identify-trait-btn");
        const initialTrait = getLastIdentifyTrait();

        traitButtons.forEach(btn => {
            // Restore the saved (or default) trait on open.
            if (btn.dataset.trait === initialTrait) {
                btn.classList.add("active");
                if (traitInput) traitInput.value = initialTrait;
            }
            btn.addEventListener("click", () => {
                traitButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                if (traitInput) traitInput.value = btn.dataset.trait;
                // Persist so the next dialog open restores this choice.
                setLastIdentifyTrait(btn.dataset.trait);
            });
        });

        // ── Difficulty +/− buttons ─────────────────────────────────
        const dcInput = html.querySelector("input[name='difficulty']");
        html.querySelectorAll("[data-action='mod-dc']").forEach(btn => {
            btn.addEventListener("click", () => {
                const mod = parseInt(btn.dataset.value, 10);
                let val   = parseInt(dcInput?.value, 10) || 0;
                val       = Math.max(0, val + mod);
                if (dcInput) dcInput.value = val;
            });
        });

        // ── Advantage / Disadvantage — mutually exclusive ─────────
        const advCb  = html.querySelector("input[name='advantage']");
        const disaCb = html.querySelector("input[name='disadvantage']");
        advCb?.addEventListener("change",  () => { if (advCb.checked)  disaCb.checked = false; });
        disaCb?.addEventListener("change", () => { if (disaCb.checked) advCb.checked  = false; });

        // ── Send button ────────────────────────────────────────────
        html.querySelector("[data-action='send']")
            ?.addEventListener("click", () => this._onSend());
    }

    /**
     * Rebuilds only the item-list element without triggering a full app re-render.
     * Called on initial render and whenever the user selector changes.
     *
     * The list merges two sources: the selected player's own character and every
     * shared party actor (see getSharedPartyActors). Party rows carry a badge so the
     * GM can tell at a glance that the item lives on the group sheet, not the character.
     *
     * Rows show the item's REAL name and icon: this dialog is GM-only, and the point
     * of the list is to let the GM identify which item they are handing out. The masked
     * presentation values are still what the player receives in the prompt.
     *
     * @param {Actor|null} actor - The linked character actor of the selected user.
     */
    _refreshItemList(actor) {
        const listEl = this.element?.querySelector(".dhui-identify-item-list");
        if (!listEl) return;

        listEl.innerHTML = "";

        /** @type {{ item: Item, party: Actor|null }[]} */
        const entries = [];
        for (const item of actor?.items ?? []) {
            if (isUnidentified(item)) entries.push({ item, party: null });
        }
        for (const partyActor of getSharedPartyActors()) {
            for (const item of partyActor.items) {
                if (isUnidentified(item)) entries.push({ item, party: partyActor });
            }
        }

        if (!entries.length) {
            const li = document.createElement("li");
            li.className   = "dhui-identify-empty";
            li.textContent = actor
                ? "No unidentified items on this actor or the party sheet."
                : "Select a player above.";
            listEl.appendChild(li);
            return;
        }

        for (const { item, party } of entries) {
            // Under the non-destructive model, real data lives in the document fields.
            const realName = item.name;
            const realImg  = item.img;

            const li = document.createElement("li");
            li.className       = party ? "dhui-identify-item dhui-identify-item--party" : "dhui-identify-item";
            li.dataset.itemId  = item.id;
            // The owning actor is stored explicitly: party items do not live on the
            // selected player's character, so _onSend cannot assume a single source.
            li.dataset.actorId = item.parent?.id ?? "";
            li.innerHTML = `
                <img src="${_esc(realImg)}" class="dhui-identify-item__img" alt="">
                <span class="dhui-identify-item__name">${_esc(realName)}</span>
                ${party ? `<i class="fas fa-users dhui-identify-item__party-badge"
                              title="On the party sheet: ${_esc(party.name)}"></i>` : ""}
                <div class="dhui-identify-item__actions">
                    <button type="button"
                            class="dhui-identify-item__peek-btn"
                            aria-label="Open sheet for ${_esc(realName)}">
                        <i class="fas fa-search"></i>
                    </button>
                </div>
            `;

            // Prevent peek button clicks from also selecting the row.
            const actionArea = li.querySelector(".dhui-identify-item__actions");
            actionArea?.addEventListener("click", e => e.stopPropagation());

            // ── Peek button (lupa): open the real item sheet on click ──
            const peekBtn = li.querySelector(".dhui-identify-item__peek-btn");
            peekBtn?.addEventListener("click", () => {
                item.sheet.render({ force: true });
            });

            li.addEventListener("click", () => {
                listEl.querySelectorAll(".dhui-identify-item")
                    .forEach(el => el.classList.remove("dhui-identify-item--selected"));
                li.classList.add("dhui-identify-item--selected");
            });
            listEl.appendChild(li);
        }
    }

    /**
     * Validates the form state, builds the identify-roll payload,
     * and emits it to the target player via the module socket.
     * @returns {Promise<void>}
     */
    async _onSend() {
        const html = this.element;

        const targetUserId = html.querySelector("select[name='targetUser']")?.value;
        const selectedLi   = html.querySelector(".dhui-identify-item--selected");
        const trait        = html.querySelector("input[name='trait']")?.value;
        const difficulty   = parseInt(html.querySelector("input[name='difficulty']")?.value, 10) || 15;
        const advantage    = html.querySelector("input[name='advantage']")?.checked   ?? false;
        const disadvantage = html.querySelector("input[name='disadvantage']")?.checked ?? false;

        if (!targetUserId) {
            ui.notifications.warn("[DH Unidentified] Select a player first.");
            return;
        }
        if (!selectedLi) {
            ui.notifications.warn("[DH Unidentified] Select an unidentified item first.");
            return;
        }
        if (!trait) {
            ui.notifications.warn("[DH Unidentified] Select a trait first.");
            return;
        }

        const targetUser = game.users.get(targetUserId);
        // Resolve through the row's own actor id: the selection may be a party-sheet
        // item, which is not owned by the target player's character.
        const actor      = game.actors.get(selectedLi.dataset.actorId) ?? targetUser?.character;
        const item       = actor?.items.get(selectedLi.dataset.itemId);

        if (!item) {
            ui.notifications.warn("[DH Unidentified] Item not found — it may have been removed.");
            return;
        }

        // Build the /dr command the player will execute on their end.
        // Use display helpers so the player prompt shows masked presentation values,
        // not the real item identity that would leak the answer before identification.
        const maskedName = getDisplayName(item);
        const maskedImg  = getDisplayImg(item);

        // grantResources=true is intentionally excluded: an identify roll is a
        // knowledge check, not a combat action, so no Hope/Fear resources should
        // be granted. Including it also triggers an uninitialised SYSTEM reference
        // inside Daggerheart's /dr handler that crashes the roll.
        const params = [`trait=${trait}`, `difficulty=${difficulty}`];
        if (advantage)    params.push("advantage=true");
        if (disadvantage) params.push("disadvantage=true");

        const payload = {
            maskedName,
            maskedImg,
            trait,
            difficulty,
            label:   `Identify: ${maskedName}`,
            command: "/dr " + params.join(" "),
            // Required by the preCreateChatMessage hook to tag the roll and trigger identification.
            actorId: actor.id,
            itemId:  item.id,
        };

        // Emit directly via module socket so the targeted player client receives
        // the prompt immediately. Using socket.emit avoids the updateSetting pathway,
        // whose hook delivers a serialised Setting document whose .value can be a
        // raw JSON string rather than a parsed object — causing silent failures on
        // the receiving client. The socket approach is the same pattern used for
        // the reverse (player → GM) identifyResult message and is proven reliable.
        console.log(`[DH Unidentified] GM emitting identifyRequest →`, { targetUserId, payload });
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "identifyRequest",
            targetUserId,
            payload,
        });

        ui.notifications.info(`[DH Unidentified] Identify request sent to ${targetUser.name}.`);
        this.close();
    }
}

// ==================================================================
// IDENTIFY PROMPT APP — player-facing
// ==================================================================

/**
 * Player-facing identify-roll prompt.
 *
 * Uses HandlebarsApplicationMixin so the `renderHandlebarsApplication` hook fires —
 * Daggerheart listens on that hook to bind its click handler on `.duality-roll-button`
 * elements via `enricherRenderSetup`. Without the mixin, the enriched button is in the
 * DOM but the system never sees it, so even a trusted click is silently ignored.
 */
export class IdentifyPromptApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /**
     * @param {object} data - Payload received from the GM's identify request.
     * @param {object} [options]
     */
    constructor(data, options = {}) {
        super(options);
        this.data = data;
    }

    static DEFAULT_OPTIONS = {
        id:       "dhui-identify-prompt",
        tag:      "div",
        classes:  ["dh-unidentified", "dhui-identify-prompt", "dhui-player-identify-dialog"],
        window:   { title: "Action Required", icon: "fas fa-eye", resizable: false },
        position: { width: 480, height: "auto" },
        actions:  {},
    };

    static PARTS = {
        form: { template: `modules/${MODULE_ID}/templates/identify-prompt.hbs` },
    };

    /**
     * Builds the template context. Enriches `[[/dr ...]]` through the namespaced
     * TextEditor so Daggerheart's enricher emits a real `.duality-roll-button`
     * with all required data-* attributes; the system's renderHandlebarsApplication
     * hook then binds the click handler to it after this render.
     * @override
     * @param {object} _options
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        const { maskedName, maskedImg, trait, difficulty, label } = this.data;

        const traitLabel = trait
            ? trait.charAt(0).toUpperCase() + trait.slice(1)
            : "Duality Roll";

        const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;
        const enrichedRoll   = await TextEditorImpl.enrichHTML(
            `[[/dr trait=${trait} difficulty=${difficulty}]]`
        );

        return { maskedName, maskedImg, label, traitLabel, difficulty, enrichedRoll };
    }

    /**
     * Wires the identify-roll container after each render.
     * Uses pointerdown (fires before click) to set _pendingIdentify so the flag is in
     * place when Daggerheart's duality-roll-button click handler creates the ChatMessage,
     * which is then consumed by the createChatMessage hook in main.js to emit the result.
     * @override
     * @param {object} _context
     * @param {object} _options
     */
    _onRender(_context, _options) {
        const container = this.element.querySelector(".dhui-ip-roll-container");
        if (!container) return;

        container.addEventListener("pointerdown", () => {
            game.modules.get(MODULE_ID)._pendingIdentify = {
                actorId: this.data.actorId,
                itemId:  this.data.itemId,
                expires: Date.now() + 15_000,
            };
        });

        // Capture phase is required: Daggerheart's handler sits on the enriched
        // .duality-roll-button and stops propagation, so a bubble-phase listener here
        // never fired and the prompt stayed open after rolling. Capture runs on the way
        // down, before the target's own handler, so it cannot be suppressed.
        // The delay still lets that handler start the roll before the app is torn down.
        container.addEventListener("click", () => {
            setTimeout(() => this.close(), 100);
        }, true);
    }
}

// ==================================================================
// IDENTIFY — public entry point
// ==================================================================

/**
 * Public namespace for the identify-request workflow.
 * Exposed via game.modules.get("dh-unidentified").api.Identify.
 */
export class Identify {
    /**
     * Opens the GM identify-request dialog.
     * No-ops silently when called by a non-GM user.
     * @returns {void}
     */
    static Open() {
        if (!game.user.isGM) return;
        new IdentifyApp().render({ force: true });
    }
}
