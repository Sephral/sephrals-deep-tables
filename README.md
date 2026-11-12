# Sephral’s Deep Tables

**You roll on the treasure table and get "a chest". So you roll on the chest table, then on the gem table, then for how many gems, and you write it all down for the players. Deep Tables does it in one go: tables inside tables, quantities like 2d4+1 and one clear card, and a click puts the result where it belongs.**

[![Install by link](https://img.shields.io/badge/Foundry%20VTT-Install%20by%20link-fe6a1f?logo=foundryvirtualtabletop&logoColor=white)](#install)
[![Join Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/7BjCgDYaBP)
[![More modules by Sephral](https://img.shields.io/badge/GitHub-More%20modules%20by%20Sephral-181717?logo=github&logoColor=white)](https://github.com/Sephral)

![Deep Tables demo](media/demo.gif)

## Highlights

* **Deep roll:** look at the result before anybody sees it. Untick rows, change a quantity, draw one row again or everything again, then show it in chat.
* **Draw now:** one click on any table gives the card at once, with the settings of the table.
* **Tables inside tables:** a result that points to another table is rolled on, as often as its quantity says. Circles and runaway depth are stopped.
* **Quantities and several draws:** every result can carry a formula like 2d4+1, every table a number of draws like 1d4+1, with an option for no duplicates.
* **Living texts:** `[[1d6]]` in a result becomes a number, `@Table[Names]` draws a name from another table into the sentence. Texts like 3d6 gp become coins.
* **One clear card:** a single chat message with pictures, item links you can drag, equal results added up and the dice attached.
* **Where it goes:** with one click the GM gives the result to a character, leaves it as a loot pile on the map or adds it to the Loot Ledger.
* **Table from text:** paste a list from a PDF or a forum and get a roll table, with ranges, weights and items found by name.
* **Your tables keep working:** quantities and draws stored by older table modules are read, those modules do not have to be active.

## How it works

1. Right click a roll table in the sidebar or a compendium and choose *Deep roll* or *Draw now*. The table window has both as well.
2. In the deep roll window change what you like, then click *Show in chat*.
3. On the card the GM clicks *Give to character*, *Leave as loot pile* or *Add to loot*.

## Good to know

Players can roll every table they can see. Marking results as drawn, giving and the other buttons are for the GM.

## Install

Deep Tables is not in Foundry's module search. Copy this link:

```text
https://github.com/Sephral/sephrals-deep-tables/releases/latest/download/module.json
```

1. In Foundry's setup screen open **Add-on Modules** and click **Install Module**.
2. Paste the link into **Manifest URL** at the bottom of the window.
3. Click **Install**, then enable the module in your world.

On The Forge open the Bazaar, click **Install From Manifest** and paste the link.

![How to install a module by its link](https://raw.githubusercontent.com/Sephral/Sephral/main/media/install.gif)

Foundry VTT 13 and 14 · any game system · English and German

## Learn more

Every button, setting and the macro API are explained in the [manual](MANUAL.md). Questions or ideas? Join us on [Discord](https://discord.gg/7BjCgDYaBP). Looking for more? See [all modules by Sephral](https://github.com/Sephral).

## License

See [LICENSE.md](LICENSE.md).
