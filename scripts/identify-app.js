/**
 * @file identify-app.js
 * Provides the GM-facing IdentifyApp dialog and the player-facing IdentifyPromptApp,
 * both required for the identify-roll request workflow.
 *
 * Flow:
 *   GM opens Identify.Open()  →  IdentifyApp  →  sends socket payload to player
 *   Player receives payload   →  IdentifyPromptApp  →  player clicks → ui.chat.processMessage
 */

import { isUnidentified, getFlags, _esc } from "./unidentified.js";

const MODULE_ID = "dh-unidentified";
const TEMPLATE  = `modules/${MODULE_ID}/templates/identify-request.hbs`;

/** Trait names supported by the Daggerheart /dr command. */
const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ==================================================================
// IDENTIFY APP — GM dialog
// ==================================================================

export class IdentifyApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @type {string|null} ID of the user whose items are currently listed. */
    #selectedUserId = null;

    static DEFAULT_OPTIONS = {
        id:       "dhui-identify-app",
        tag:      "form",
        classes:  ["dhui-identify-app"],
        window:   { title: "Request Identify Roll", icon: "fas fa-eye", resizable: false, controls: [] },
        position: { width: 600, height: "auto" },
        actions:  { cancel: IdentifyApp.prototype._onCancel },
    };

    static PARTS = {
        form: { template: TEMPLATE },
    };

    /**
     * Builds template context. Only surfaces users who are active, non-GM,
     * and have a linked character actor — the only actors we can query for items.
     * @override
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
            traits: TRAITS,
            difficulty: 15,
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

        // ── Trait buttons — mutually exclusive ────────────────────
        const traitInput   = html.querySelector("input[name='trait']");
        const traitButtons = html.querySelectorAll(".dhui-identify-trait-btn");
        traitButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                traitButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                if (traitInput) traitInput.value = btn.dataset.trait;
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
     * @param {Actor|null} actor - The linked character actor of the selected user.
     */
    _refreshItemList(actor) {
        const listEl = this.element?.querySelector(".dhui-identify-item-list");
        if (!listEl) return;

        listEl.innerHTML = "";

        const items = (actor?.items ?? []).filter(i => isUnidentified(i));

        if (!items.length) {
            const li = document.createElement("li");
            li.className   = "dhui-identify-empty";
            li.textContent = actor
                ? "No unidentified items on this actor."
                : "Select a player above.";
            listEl.appendChild(li);
            return;
        }

        for (const item of items) {
            const flags    = getFlags(item);
            const realName = flags.realName ?? item.name;
            const realImg  = flags.realImg  ?? item.img;
            const realDesc = flags.realDescription ?? item.system?.description ?? item.system?.details?.description ?? "";

            const li = document.createElement("li");
            li.className      = "dhui-identify-item";
            li.dataset.itemId = item.id;
            li.innerHTML = `
                <img src="${_esc(flags.maskedImg ?? item.img)}" class="dhui-identify-item__img" alt="">
                <span class="dhui-identify-item__name">${_esc(flags.maskedName ?? item.name)}</span>
                <div class="dhui-identify-item__actions">
                    <button type="button"
                            class="dhui-identify-item__peek-btn"
                            title="${_esc(realName)}"
                            data-real-name="${_esc(realName)}"
                            data-real-img="${_esc(realImg)}"
                            data-real-desc="${_esc(realDesc)}"
                            aria-label="Peek: ${_esc(realName)}">
                        <i class="fas fa-search"></i>
                    </button>
                    <button type="button"
                            class="dhui-identify-item__sheet-btn"
                            aria-label="Open sheet for ${_esc(realName)}">
                        <i class="fas fa-scroll"></i>
                    </button>
                </div>
            `;

            // Prevent peek/sheet button clicks from also selecting the row.
            const actionArea = li.querySelector(".dhui-identify-item__actions");
            actionArea?.addEventListener("click", e => e.stopPropagation());

            // ── Peek button: show tooltip with real name, image, and description ──
            // Appended to this.element (dialog root) to keep CSS scope (.dhui-identify-app
            // nesting), but uses position:fixed with viewport coords to escape the
            // overflow-clipped scroll container (.dhui-identify-item-list).
            const peekBtn = li.querySelector(".dhui-identify-item__peek-btn");
            peekBtn?.addEventListener("mouseenter", e => {
                const btn  = e.currentTarget;
                const name = btn.dataset.realName;
                const img  = btn.dataset.realImg;
                const desc = btn.dataset.realDesc;

                this.element.querySelector(".dhui-identify-item__tooltip")?.remove();

                const tip = document.createElement("div");
                tip.className = "dhui-identify-item__tooltip";
                tip.innerHTML = `
                    <div class="dhui-peek-tip__header">
                        <img src="${_esc(img)}" class="dhui-peek-tip__img" alt="">
                        <strong class="dhui-peek-tip__name">${_esc(name)}</strong>
                    </div>
                    ${desc ? `<div class="dhui-peek-tip__desc">${desc}</div>` : ""}
                `;

                // Append to dialog root, position above the button via viewport coords.
                this.element.appendChild(tip);
                const rect = btn.getBoundingClientRect();
                tip.style.left   = `${rect.left}px`;
                tip.style.bottom = `${window.innerHeight - rect.top + 6}px`;
            });
            peekBtn?.addEventListener("mouseleave", () => {
                this.element.querySelector(".dhui-identify-item__tooltip")?.remove();
            });

            // ── Sheet button: open the real item sheet ──
            const sheetBtn = li.querySelector(".dhui-identify-item__sheet-btn");
            sheetBtn?.addEventListener("click", () => {
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
        const actor      = targetUser?.character;
        const item       = actor?.items.get(selectedLi.dataset.itemId);

        if (!item) {
            ui.notifications.warn("[DH Unidentified] Item not found — it may have been removed.");
            return;
        }

        const flags = getFlags(item);

        // Build the /dr command the player will execute on their end.
        const params = [`trait=${trait}`, `difficulty=${difficulty}`, "grantResources=true"];
        if (advantage)    params.push("advantage=true");
        if (disadvantage) params.push("disadvantage=true");

        const payload = {
            maskedName: flags.maskedName ?? item.name,
            maskedImg:  flags.maskedImg  ?? item.img,
            trait,
            difficulty,
            label:   `Identify: ${flags.maskedName ?? item.name}`,
            command: "/dr " + params.join(" "),
            // Required by the preCreateChatMessage hook to tag the roll and trigger identification.
            actorId: actor.id,
            itemId:  item.id,
        };

        // Broadcast via world setting — all clients receive the updateSetting hook.
        // The handler in main.js filters by targetUserId on each client.
        // A timestamp is appended so repeated requests to the same player always
        // trigger the hook even when the payload content is identical.
        await game.settings.set(MODULE_ID, "identifyRequest", {
            targetUserId,
            payload,
            timestamp: Date.now(),
        });

        ui.notifications.info(`[DH Unidentified] Identify request sent to ${targetUser.name}.`);
        this.close();
    }

    /**
     * Closes the dialog without sending.
     * Triggered by the Cancel button's data-action="cancel".
     */
    _onCancel() {
        this.close();
    }
}

// ==================================================================
// IDENTIFY PROMPT APP — player-facing
// ==================================================================

export class IdentifyPromptApp extends ApplicationV2 {

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
        classes:  ["dhui-identify-prompt", "dhui-player-identify-dialog"],
        window:   { title: "Action Required", icon: "fas fa-eye", resizable: false, controls: [] },
        position: { width: 480, height: "auto" },
        actions:  { resolveRoll: IdentifyPromptApp.prototype._onResolveRoll },
    };

    /**
     * Returns the full prompt HTML as a string. No .hbs template is used —
     * all data is known at construction time and the prompt is single-use.
     * Scoped styles are embedded so the prompt is self-contained.
     * @override
     * @returns {Promise<string>}
     */
    async _renderHTML(_context, _options) {
        const { maskedName, maskedImg, trait, difficulty, label, command } = this.data;

        const traitLabel = trait
            ? trait.charAt(0).toUpperCase() + trait.slice(1)
            : "Duality Roll";

        const difficultyHtml = difficulty
            ? `Difficulty: <span style="color:#C9A060;font-weight:bold;">${_esc(String(difficulty))}</span><br>`
            : "";

        return `
        <style>
            #dhui-identify-prompt .dhui-ip-wrapper {
                background: linear-gradient(135deg, #1a1a1a 0%, #000000 100%);
                border: 2px solid #C9A060;
                padding: 25px;
                text-align: center;
                color: #fff;
                display: flex;
                flex-direction: column;
                gap: 15px;
                align-items: center;
            }
            #dhui-identify-prompt .dhui-ip-title {
                font-family: 'Aleo', serif;
                font-size: 1.8em;
                color: #C9A060;
                text-transform: uppercase;
                text-shadow: 0 0 10px #C9A060;
                margin: 0;
            }
            #dhui-identify-prompt .dhui-ip-img {
                max-width: 200px;
                border: none;
                filter: drop-shadow(0 0 10px rgba(201,160,96,0.5));
            }
            #dhui-identify-prompt .dhui-ip-details {
                font-size: 1.1em;
                color: #ccc;
                margin: 0;
                line-height: 1.6;
            }
            #dhui-identify-prompt .dhui-ip-roll-btn {
                background: #C9A060 !important;
                color: #000 !important;
                border: 2px solid #8a6d3b !important;
                padding: 12px 20px !important;
                font-size: 1.4em !important;
                font-family: 'Aleo', serif !important;
                font-weight: bold !important;
                text-transform: uppercase !important;
                cursor: pointer;
                border-radius: 4px;
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                gap: 8px;
                box-shadow: 0 0 15px rgba(201,160,96,0.6) !important;
                transition: transform 0.1s, box-shadow 0.2s;
                animation: dhui-pulse-gold 2s infinite;
                width: 100%;
            }
            #dhui-identify-prompt .dhui-ip-roll-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 0 25px rgba(201,160,96,0.8) !important;
                color: #000 !important;
            }
            @keyframes dhui-pulse-gold {
                0%   { box-shadow: 0 0 0 0    rgba(201,160,96,0.4); }
                70%  { box-shadow: 0 0 0 10px rgba(201,160,96,0);   }
                100% { box-shadow: 0 0 0 0    rgba(201,160,96,0);   }
            }
        </style>
        <div class="dhui-ip-wrapper">
            <h1 class="dhui-ip-title">${_esc(label)}</h1>
            <img src="${_esc(maskedImg)}" class="dhui-ip-img" alt="${_esc(maskedName)}">
            <p class="dhui-ip-details">
                ${difficultyHtml}
                Check: <span style="color:#C9A060;font-weight:bold;">${_esc(traitLabel)}</span>
            </p>
            <div style="margin-top:10px;width:100%;">
                <button type="button"
                        class="dhui-ip-roll-btn"
                        data-action="resolveRoll"
                        data-command="${_esc(command)}">
                    <i class="fas fa-eye"></i> ROLL TO IDENTIFY
                </button>
            </div>
        </div>`;
    }

    /**
     * Replaces the application content with the rendered HTML string.
     * Required because _renderHTML returns a raw string, not a DocumentFragment.
     * @override
     */
    _replaceHTML(result, content, _options) {
        content.innerHTML = result;
    }

    /**
     * Stores the pending identify context, executes the /dr command, and closes the prompt.
     * The _pendingIdentify state is consumed by the preCreateChatMessage hook in main.js
     * to tag the resulting chat message before it is persisted to the database.
     * TTL of 15 s prevents stale state from leaking into unrelated rolls.
     * Triggered by the "ROLL TO IDENTIFY" button's data-action="resolveRoll".
     * @param {PointerEvent} _event
     * @param {HTMLButtonElement} target
     */
    _onResolveRoll(_event, target) {
        const command = target.dataset.command || this.data.command;
        if (!command) return this.close();

        game.modules.get(MODULE_ID)._pendingIdentify = {
            actorId: this.data.actorId,
            itemId:  this.data.itemId,
            expires: Date.now() + 15_000,
        };

        ui.chat.processMessage(command);
        this.close();
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
