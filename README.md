# 🔍 Unidentified Items


[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-Donate-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/mestredigital) [![More Modules](https://img.shields.io/badge/Foundry%20VTT-More%20Modules-red?style=for-the-badge&logo=gamepad)](https://mestredigital.online/pages/projetos-en)

## for Daggerheart

**Hide items from your players. Reveal them when the moment is right.**

Running a mystery? Handing out cursed loot? Keeping players guessing about that strange artifact they just found? **Unidentified Items** is a Foundry VTT module for **Daggerheart** that lets you disguise any item — weapon, consumable, piece of loot — so players only see a masked name and icon until *you* decide to reveal the truth.

No more accidentally spoiling the twist. No more players metagaming because they recognized an item name in their inventory.

---

## What It Does

When you mark an item as unidentified, your players see a generic placeholder — something like *"Unidentified Weapon"* or *"Unidentified Consumable"* — instead of the real item. You control what gets revealed and when.

Here's the full loop:

- **Disguise any item** — give it a fake name, a fake image, or both
- **Request an Identify Roll** — send a roll request to a specific player, choosing the trait and difficulty yourself
- **Reveal on success** — the item shows its true identity the moment the roll lands
- **Keep secrets on failure** — the item stays masked, mystery intact
- **Keep it quiet** — optionally confine the whole result to the player who rolled and you

As the GM, you always see what things really are. Players only see the mask.

Nothing is written over the item itself. The real name, image and description stay in the document at all times — the mask is presentation only, applied when the sheet renders. Turn the module off and every item is immediately back to normal.

---

## How It Looks in Play

> *Your players enter a dungeon and find a glowing blade on the floor. In their inventory, it appears as "Unidentified Weapon" with a question mark icon. Later, when they try to figure out what it is, you open the Identify Request dialog — pick the player, pick the trait (maybe Knowledge? Instinct?), set a difficulty, and send it. The dice roll. On a success, the item reveals itself as "Sword of Eternal Light" complete with its full description. The table reacts.*

That's the experience this module creates.

### GM View

<p align="center">
  <img width="700" src="docs/preview-gm.webp">
</p>

### Player View

<p align="center">
  <img width="700" src="docs/preview-player.webp">
</p>

### Identify

<p align="center">
  <img width="700" src="docs/preview-identify.webp">
</p>

---

## Features at a Glance

| Feature | Description |
|---|---|
| **Mark items as unidentified** | Works on weapons, armor, loot, and consumables |
| **Custom mask** | Set a fake name, description, and image per item |
| **Mask defaults per type** | Configure once, then mystify in a single click |
| **Identify Roll request** | Send a roll to any player from a clean dialog |
| **Trait & difficulty control** | You pick the trait (Agility, Knowledge, etc.) and the DC |
| **Advantage / Disadvantage** | Toggles in the roll request, mutually exclusive |
| **Party sheet items** | Items on a shared party actor can be handed to any player to identify |
| **Result privacy** | Keep the roll, the message, and the sound between the roller and you |
| **Success / failure sounds** | Custom audio cues when a roll resolves |
| **Auto-reveal on success** | Item updates automatically when the roll passes |
| **GM always sees real data** | Peek at the true item name and description at any time |

---

## How to Use

**Step 1 — Mystify an item**

Right-click any item in an actor's inventory and choose **Mystify Item**, or open the item's sheet and use the **⋮** header menu. A dialog lets you set the masked name, description, and icon the players will see. Works on weapons, armor, loot, and consumables.

**Step 2 — Request an Identify Roll**

When the player wants to examine the item, open **Identify Items** from the Daggerheart Menu, or run `Identify.Open();`. Choose the player, select the item, pick a trait and difficulty, optionally toggle Advantage or Disadvantage, then click **Send to Player**.

The player needs a character assigned to their user account — the dialog only lists connected non-GM users who have one.

**Step 3 — Watch the roll**

The player rolls. If they succeed, the item reveals itself automatically. If they fail, it stays hidden — you can try again later, or just tell them what it is if the story calls for it.

**Step 4 — Manual reveal (optional)**

You can also reveal any item at any time, no roll needed. Right-click it and choose **Identify Item**, or use the **⋮** menu on its sheet and confirm with **Identify**.

---

## Party Sheet Items

Unidentified items sitting on a **party actor** show up in the request dialog alongside the selected player's own items, marked with a purple edge and a group icon. That lets you ask any player to identify shared loot — the item never has to be on their character.

A party actor qualifies when **every player owns it**: either its default ownership is set to Owner, or each player has an explicit Owner grant.

---

## Result Privacy

Module settings carry an **Identify Result Privacy** option, GM-only, that decides who learns the outcome of a roll:

- **Public** *(default)* — the whole table sees the roll and the result message, and everyone hears the sound.
- **Private** — the duality roll, the result message, and the sound stay between the player who rolled and the GM.

The chat side of privacy is enforced by Foundry itself, so a player genuinely cannot read a result that wasn't addressed to them. The sound cue is filtered on each client, which is the same trust model Foundry uses for its own audio broadcasts.

---

## Legacy Cleanup (old-version items)

Used this module before version 0.1.0? Those older versions hid items in a way that changed the item itself. If you still have items from back then, there's an optional, GM-only cleanup macro that restores them to their original state. See the **[Legacy Cleanup guide](https://github.com/brunocalado/dh-unidentified/wiki/Legacy-Cleanup)** on the wiki for the macro and instructions.

---

## Installation

Install via the Foundry VTT Module browser or use this manifest link:

```
https://raw.githubusercontent.com/brunocalado/dh-unidentified/main/module.json
```

## Credits & License

* **Code License:** GNU GPLv3.

* **banner.webp and thumbnail.webp:** [Question mark icons created by Freepik - Flaticon](https://www.flaticon.com/free-icons/question-mark).

* **failure.mp3, success.mp3:** [License](https://pixabay.com/service/license-summary/)

* **This is a fork from:** [Link](https://github.com/jacksands/dh-unidentified)

**Disclaimer:** This module is an independent creation and is not affiliated with Darrington Press.


# 🧰 My Daggerheart Modules

| Module | Description |
| :--- | :--- |
| 💀 [**Adversary Manager**](https://github.com/brunocalado/daggerheart-advmanager) | Scale adversaries instantly and build balanced encounters in Foundry VTT. |
| 🐉 [**Colossus**](https://github.com/brunocalado/dh-colossus) | Manage massive multi-part boss encounters with independent HP per part and a single shared stress pool. |
| 💥 [**Critical**](https://github.com/brunocalado/daggerheart-critical) | Animated Critical. |
| 💠 [**Custom Stat Tracker**](https://github.com/brunocalado/dh-new-stat-tracker) | Add custom trackers to actors. |
| ☠️ [**Death Moves**](https://github.com/brunocalado/daggerheart-death-moves) | Enhances the Death Move moment with a dramatic interface and full automation. |
| 📏 [**Distances**](https://github.com/brunocalado/daggerheart-distances) | Visualizes combat ranges with customizable rings and hover calculations. |
| 📦 [**Extra Content**](https://github.com/brunocalado/daggerheart-extra-content) | Homebrew for Daggerheart. |
| 🤖 [**Resource Macros**](https://github.com/brunocalado/daggerheart-fear-macros) | Automatically executes macros when the Fear or Hope resources are changed. |
| 😱 [**Fear Tracker**](https://github.com/brunocalado/daggerheart-fear-tracker) | Adds an animated slider bar with configurable fear tokens to the UI. |
| 🧟 [**Horde**](https://github.com/brunocalado/dh-horde) | Explode single horde tokens into dozens of individual tokens and manage their movement and stats automatically. |
| 🎁 [**Mystery Box**](https://github.com/brunocalado/dh-mystery-box) | Introduces mystery box mechanics for random loot and surprises. |
| ⚡ [**Quick Actions**](https://github.com/brunocalado/daggerheart-quickactions) | Quick access to common mechanics like Falling Damage, Downtime, etc. |
| 📜 [**Quick Rules**](https://github.com/brunocalado/daggerheart-quickrules) | Fast and accessible reference guide for the core rules. |
| 🎲 [**Stats**](https://github.com/brunocalado/daggerheart-stats) | Tracks dice rolls from GM and Players. |
| 🧠 [**Stats Toolbox**](https://github.com/brunocalado/dh-statblock-importer) | Import using a statblock. |
| 🛒 [**Store**](https://github.com/brunocalado/daggerheart-store) | A dynamic, interactive, and fully configurable store for Foundry VTT. |
| 🔍 [**Unidentified**](https://github.com/brunocalado/dh-unidentified) | Obfuscates item names and descriptions until they are identified by the players. |

# 🗺️ Adventures

| Adventure | Description |
| :--- | :--- |
| ✨ [**I Wish**](https://github.com/brunocalado/i-wish-daggerheart-adventure) | A wealthy merchant is cursed; one final expedition may be the only hope. |
| 💣 [**Suicide Squad**](https://github.com/brunocalado/suicide-squad-daggerheart-adventure) | Criminals forced to serve a ruthless master in a land on the brink of war. |