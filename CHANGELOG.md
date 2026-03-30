# Changelog

## [Unreleased]

### [Added]
- GM view toggle button on unidentified item sheets: eye icon in the window header lets GMs switch between real item data and a player-view preview (masked name, image, and description) without modifying item data. Toggle state persists across re-renders of the same sheet window.
- Sound effects on identify roll results: success and failure sounds play on the rolling player's client.
- New "Sounds" tab in Default Masks Config dialog to configure success/failure audio file paths.
- Template `identify-player-request.hbs` for player-facing identification roll dialog.

### [Changed]
- Refactored `module.css` into 6 files by feature: `module.css` (tokens/shared), `gm-banner.css`, `mystify-dialog.css`, `cfg-dialog.css`, `identify-app.css`, `guide-dialog.css`.
- Added teal and purple design tokens; migrated hardcoded colors in Identify App and Player Identify dialogs to use CSS custom properties.
- Translated all Portuguese comments to English. Replaced `transition: all` with explicit properties.
- Improved contrast and legibility across Default Masks Config, Mystify, and Player Identify dialogs.
- Labels, tabs, inputs, and buttons now use Montserrat font and high-contrast color palette per style guide.
- Mystify and Save buttons use solid gold background with dark text for maximum contrast.
- Cancel buttons are now visibly distinct as secondary actions.

### [Fixed]
- Stale DOM elements (GM banner, player badge, eye toggle, mystified preview panel, menu entries) no longer persist after identify/mystify operations. Elements are now explicitly cleaned up at the start of each sheet render cycle, preventing visual glitches where UI elements would remain visible despite the item state changing.
