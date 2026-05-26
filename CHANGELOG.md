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