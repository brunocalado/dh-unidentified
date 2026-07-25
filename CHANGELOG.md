# 0.1.5

### [Added] Identify result privacy

New GM-only world setting **Identify Result Privacy**, defaulting to **Public**.

- **Public** — everyone connected sees the result chat message and hears the success/failure sound.
- **Private** — only the player who rolled and the GMs see the result and hear the sound.

Private mode also whispers Daggerheart's own duality-roll message, via `preCreateChatMessage` on the roller's client. Without that, the module stayed silent but the system still posted the roll publicly, and any player could read the total against the visible difficulty.

The GM resolves a single audience per result and drives both channels from it, so chat and audio can never disagree about who is allowed to learn the outcome. The chat audience is enforced server-side through `whisper`; the sound is broadcast on a new `identifySfx` socket message and filtered client-side, as Foundry offers no server-side audience control for audio.

The result sound no longer plays locally on the roller's client the instant the roll lands — it now arrives with the GM broadcast, which also syncs it to the chat message instead of firing slightly ahead of it.

### [Added] Party sheet items in the Identify Roll dialog

Unidentified items held on a **party actor** are now listed alongside the selected player's own items, marked with a purple edge and a group icon. Any player can be asked to identify one, so shared loot no longer has to be moved onto a character sheet first.

A party actor qualifies when every player owns it — either default ownership set to Owner, or an explicit Owner grant for each player. Each row carries its owning actor id, so the request resolves against the party sheet rather than assuming the target player's character.

### [Fixed] Player prompt stayed open after rolling

The identify prompt closed on a bubble-phase click listener, but Daggerheart's handler on the enriched `.duality-roll-button` stops propagation, so the listener never fired. Moved to the capture phase, which runs before the target's own handler and cannot be suppressed.

### [Changed] Identify Roll dialog

- **Advantage / Disadvantage** are now iOS-style toggle switches instead of checkboxes. Still mutually exclusive.
- **Items show their real name and icon.** The dialog is GM-only, and its purpose is to identify which item is being handed out; the player still receives the masked name and image in their prompt.
- **Removed the Cancel button** and the `Target` / `Roll Configuration` column headings.
- **Removed the scroll button** on each item row, which showed a masked-description tooltip and served no purpose for the GM.
- **Selected rows are redrawn.** The selection ring was an `outline`, painted outside the row's border box, and the item list clips on both axes — so its left and right edges were cut off. It is now an inset `box-shadow`, closed on all four sides, with a leading accent bar, an inner glow, and the item name in teal.

### [Changed] Module guide

Rewritten to cover the current feature set: mask defaults, the request workflow, party sheet items, result privacy, and sound configuration. The redundant Close button is gone — the window's own close control dismisses it.

# 0.1.4

### [Removed] Automatic legacy migration

The one-time automatic migration that ran on GM load (restoring items written by the old pre-0.1.0 destructive model) has been removed entirely — it was leaving migrated items in a broken, empty-looking state. There is no longer any automatic migration or fallback on world load.

### [Added] Manual legacy cleanup macro

Worlds that still hold items mystified by the old destructive model can now clean them up on demand with an optional GM-only script macro. Run once as GM, it restores each affected item's real name/image/description from the backup flags and removes all `dh-unidentified` data from it, returning the item to its exact pre-module state. It is opt-in, irreversible (a confirmation is shown first), and leaves current new-model unidentified items untouched. The macro and full instructions live on the [Legacy Cleanup wiki page](https://github.com/brunocalado/dh-unidentified/wiki/Legacy-Cleanup).

# 0.1.3

### [Fixed] Edit button visible on unidentified items in party actor sheets

The party actor sheet renders an edit button (`data-action="editDoc"`) on each item row. For unidentified items, this button allowed players to open the real item sheet directly, bypassing the identity mask. Now hidden for players (GMs still see it).

# 0.1.2

### [Fixed] Masked icon not displaying for consumable and loot items

Consumable and loot items render with `data-action="toChat"` on their `img-portait` container (when `item.usable` is false). The module's selector for hiding the "Send to Chat" button was `[data-action='toChat']` — a bare attribute selector matching any element with that attribute, which accidentally hid the entire icon area. Changed selector to `a[data-action='toChat']` to target only the anchor button in `.controls`, leaving the icon container visible. This also fixes the row height difference for these item types.

# 0.1.1

### [Fixed] Identify roll not revealing item on successful roll

In Daggerheart v14, the ChatMessage `system` object is now schema-validated (DataModel), and the `roll` field was removed from it. The identify-roll hook was checking `message.system.roll.success` which is now always `undefined`, preventing the GM from receiving the roll result and thus never calling `identifyItem()`. Now reads the roll result from `message.rolls[0].options.roll.success` (where Daggerheart v14 stores it) and filters by message type to avoid false positives.

### [Added] Trait persistence in Identify Roll dialog

The last trait selected in the "Request Identify Roll" dialog is now saved and automatically restored on next open. Default trait is "knowledge". Setting is client-scoped (per-user preference).

### [Changed] Improve Identify Roll dialog item buttons

- **Magnifying glass icon (lupa)** now opens the real item sheet on click (previously showed a tooltip on hover).
- **Scroll icon** now displays a tooltip with the masked/unidentified description on hover (previously opened the item sheet).
- This swap makes the interactions more intuitive: peek-then-identify (lupa opens sheet) vs. description-preview (scroll shows summary).

### [Changed] Center Advantage/Disadvantage checkboxes in Identify Roll dialog

The advantage and disadvantage checkboxes are now horizontally centered in their container instead of left-aligned.

# 0.1.0

- v14 only
- https://github.com/brunocalado/dh-unidentified/issues/2
- https://github.com/brunocalado/dh-unidentified/issues/1
- This new version has undergone a massive refactoring. Previously, the way an item was hidden was destructive, as the paths for both the item and its image were altered within the item itself. Now, the item remains untouched, and a mask is simply applied to modify it. This ensures that if the module is deactivated, the items immediately return to normal. If you have items created in the older version, a migration will automatically run to update them to the new workflow.

### [Fixed] Player identify-roll prompt not appearing after GM sends request

Replaced `game.settings.set` + `updateSetting` hook with a direct `game.socket.emit` for the GM→Player identify-request path. The `updateSetting` hook delivers a Setting document whose `.value` can be a raw JSON string instead of a parsed object, causing `payload` to be `undefined` and the prompt to silently not render on the player's screen.

### [Changed] Non-destructive unidentified state (breaking architectural change)

The module no longer mutates item document fields when mystifying. Previously, `applyMystify` overwrote `item.name`, `item.img`, and `system.description` with masked values and stored the originals in backup flags. This caused items to be permanently renamed in the database and broke when the module was disabled.

**New behaviour:** Mystifying an item writes only to module flags (`flags.dh-unidentified.*`). The item's real `name`, `img`, and description remain unchanged in the document at all times. Masked presentation values are applied at render time by display helpers (`getDisplayName`, `getDisplayImg`, `getDisplayDescription`).

**Migration:** On the first GM load after upgrading, all items previously mystified by the old model are automatically migrated: their real name/img/description are restored from the backup flags, and the obsolete backup flags are deleted. Masked metadata is preserved for re-mystification.

**Breaking change for external integrations:** Any macro, compendium workflow, or companion module that assumed `item.name` or `item.img` held masked values for unidentified items must be updated to use `game.modules.get("dh-unidentified").api.getDisplayName(item)` and `getDisplayImg(item)` instead.

---

# 0.0.2

- v14 only
- [Fixed] Header ⋮ menu buttons ("Mystify Item" / "Identify Item") now appear on Daggerheart item sheets by using the correct v14 hook `getHeaderControlsItemSheetV2` instead of attempting manual DOM injection