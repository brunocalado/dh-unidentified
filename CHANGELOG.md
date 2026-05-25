# 0.0.3

### [Changed] Non-destructive unidentified state (breaking architectural change)

The module no longer mutates item document fields when mystifying. Previously, `applyMystify` overwrote `item.name`, `item.img`, and `system.description` with masked values and stored the originals in backup flags. This caused items to be permanently renamed in the database and broke when the module was disabled.

**New behaviour:** Mystifying an item writes only to module flags (`flags.dh-unidentified.*`). The item's real `name`, `img`, and description remain unchanged in the document at all times. Masked presentation values are applied at render time by display helpers (`getDisplayName`, `getDisplayImg`, `getDisplayDescription`).

**Migration:** On the first GM load after upgrading, all items previously mystified by the old model are automatically migrated: their real name/img/description are restored from the backup flags, and the obsolete backup flags are deleted. Masked metadata is preserved for re-mystification.

**Breaking change for external integrations:** Any macro, compendium workflow, or companion module that assumed `item.name` or `item.img` held masked values for unidentified items must be updated to use `game.modules.get("dh-unidentified").api.getDisplayName(item)` and `getDisplayImg(item)` instead.

---

# 0.0.2

- v14 only
- [Fixed] Header ⋮ menu buttons ("Mystify Item" / "Identify Item") now appear on Daggerheart item sheets by using the correct v14 hook `getHeaderControlsItemSheetV2` instead of attempting manual DOM injection