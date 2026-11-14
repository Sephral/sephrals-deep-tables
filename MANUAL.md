# Sephral’s Deep Tables: Manual

Deep Tables works with every roll table of Foundry. Nothing has to be set up: a table you never touched behaves as it always did and the module only adds ways to roll it. Players can roll every table they can see, and the tables the GM releases for them. Marking results as drawn, giving, actions and the card buttons are for the GM.

## Rolling

Right click a table in the sidebar or in a compendium, or open the menu of the table's own window (the three dots), and choose:

* **Deep roll** opens a window with the result before anybody sees it. You can untick rows, change the quantity of an item, draw a single row again with the round arrow, draw everything again, change the number of draws, switch *No duplicates* and choose who sees the card. *Show in chat* posts the card with the rows that are ticked.
* **Draw now** posts the card at once, with the settings of the table.

The same two entries exist for tables in compendiums. A table in a compendium can be rolled as often as you like, nothing is marked there.

### Draws

A table can be drawn several times with one roll. Give the number of draws a number or a formula like `1d4+1`, in the deep roll window or in the table's edit mode. *No duplicates* means a result comes up only once in one roll. If a table has fewer results than draws, the card says that the table ran out.

### Tables inside tables

A result that points to another table is rolled on, and what comes out is what you see. The quantity of such a result says how often the other table is drawn. The depth is limited by the setting *Depth of tables inside tables* (5 by default). A table that leads back to itself is stopped, and the card or the window tells you.

### Quantities

Every result can have a quantity: a number or a formula like `2d4+1`. It means how many for an item, how often for a table and how often for a text. Texts and coins are rolled again for every repeat. You find the field in the edit mode of the table next to every result and in the window of a single result. If the formula cannot be rolled, 1 is used and the deep roll window shows a note. If you use Sephral’s Loot Ledger, its quantity field is used and Deep Tables does not add a second one.

### Living texts

* `[[1d6]]` in the text of a result is rolled once and replaced by the number. `[[/r 2d4]]` works too.
* `@Table[Name]` in a text draws from another table of the world and puts the result into the sentence. Use the name of the table or its UUID. This makes name, rumor and loot generators.
* A text like `3d6 gp` or `2d4 x 10 gp, 5 sp` is read as coins. On D&D 5e and Crucible the coins can go into the purse of a character.

### Marking what was drawn

Tables without replacement behave like in Foundry: what was drawn is marked, and the GM marks results when the card is shown. A table with nothing left tells you so, and the GM is asked whether all results should come back. Players do not mark results.

### Tables with a memory

*Remember what was drawn* in the edit mode of a table (under *Deep Tables*) makes the table keep what it gave. A result that came up is not drawn again, in later rolls, later sessions and after a restart, until you reset the table. The memory is stored on the table, as a list of result ids in its flags, and only rolls of Deep Tables write to it: when the card is shown, the GM's browser remembers the results, like it marks them above. Nothing is remembered in a compendium.

How it relates to the other options:

* *No duplicates* only keeps results apart inside one roll. The memory works across rolls. A table with a memory never repeats a result inside one roll either.
* *Draw with replacement* of Foundry stays as it is. The memory works with it on or off. Foundry's own draw button does not know the memory, rolls of Deep Tables do.
* A table without replacement already marks what came up. It shows the same counter and the same buttons, and the memory option adds nothing there. A result counts as used when Foundry's mark or the memory says so, and *Reset* clears both.

Where you see it:

* The deep roll window shows a counter like *3 of 12 used* for the table and for every table inside it that has a memory or draws without replacement. *Used results* lists them, a round arrow puts one back, *Reset* brings all back.
* The table window shows the counter in view and edit mode, dims the used rows and has the same buttons for the GM.
* When everything is used, the table says it is empty and the GM is asked whether to reset it.

### Who sees the card

Every table has a setting *Shown to*: like in Foundry (the chat setting of whoever rolls), everyone, GM only, blind or only me. You can change it in the deep roll window. Like with every private roll in Foundry, other people see a short note that something was rolled privately.

## The card

One chat message holds the whole roll: the table with its picture, a row for every result with a picture, the name and the quantity. Equal results are added up. Items are links you can open and drag onto a sheet. The dice are attached to the message, so dice animations show them.

The GM sees buttons below the card, and they work after a reload as well:

| Button | Does |
| --- | --- |
| Give to character | Asks for a character (the selected tokens first) and the rows to give. Items are added with their quantity, and when the character already has the same item the quantity grows. Coins go into the purse on D&D 5e and Crucible. In other systems coins stay text and you are told. |
| Leave as loot pile | Only with a module for loot piles active. Click on the map where the pile goes, Escape cancels. The items and coins end up in a new pile. |
| Add to loot | Only with Sephral’s Loot Ledger active. The items and coins go into the party's loot. |
| Roll again | Rolls the same table again and posts a new card. |

Under the buttons the card notes where the result went.

## Table from text

*Table from text* above the list of roll tables (GM) turns a pasted list into a table. The window shows what was recognized before anything is made. It reads:

* ranges and numbers such as `1 to 4 Goblin` written with a dash, `5: Wolf` or `12. Treasure`, also when a PDF broke a long entry over two lines
* lists with a weight such as `Goblin | 3`
* plain lists with one entry per line, every entry equally likely
* a first line like `d20 Encounters` or `Encounters (d20)` with the name and the formula

Gaps and overlaps in the numbers are listed. *Find items* turns rows whose text is exactly the name of an item of the world, or of any compendium, into real item results. You can change the name and the formula before you create the table.

## Table library

The module ships a library of ready tables, so it is useful from the first minute. Open it with *Table library* in the header of the roll table directory (GM only), or with the macro `openLibrary()`.

The tables come in groups:

* **Names:** first names and family names for five peoples (Northfolk, Sunlanders, Imperials, Silvans, Deep folk), a full name table for each, and *Name: any people*, which picks the people for you.
* **Taverns and shops:** inn names built from a describing word and a sign, what stands out in an inn, who is in the tavern tonight, shops with their owners and an odd thing in the window.
* **People:** occupation, looks, quirk and wish, and *Person in one roll*, which draws all of them into one line.
* **Rumors:** rumors for the tavern, with a teller. A few rows only come up when a story tag or the time of day fits.
* **Travel events:** the road, the forest, the mountains and the sea, and one table that picks the terrain.
* **Weather:** the weather of the day for each season, with a temperature that rolls itself.
* **Encounters by terrain:** short texts for plains and roads, forest, hills and mountains, swamp, coast and desert, with numbers that roll themselves.
* **Trinkets and small finds:** pocket trinkets, small purses written as coin texts, small finds and hiding places.

The library shows how the module works: tables inside tables with quantity formulas (*Tavern: who is here tonight* draws a number of guests), `@Table` draws inside sentences (a shop and its owner), `[[1d6]]` rolls, coin texts and rows with conditions.

Click a table to see its rows, tick the ones you want and click *Import*. A table with building blocks (the first name and family name tables behind a full name) brings them along, the summary tells how many. The building blocks sit under *Building blocks* in every group and can be imported alone as well.

* **Language:** the window opens in the language of the module, English or German. Both are complete, and a world can have both.
* **Folder:** the tables go into the folder you name, with a subfolder per group. Empty means no folder. A folder that exists already is reused.
* **Already imported:** a table is only imported once per language. The window marks the ones that are in the world and does not let you tick them again. When a later import needs a table that is in the world, the new table links to it.
* **Links:** a link between library tables is a normal `@Table[RollTable.id]{Name}` draw or a result that points to a table. They keep working when you rename a table, and you can edit everything like any other table.
* **Story tags:** rows that ask for a story tag (*War has started*, *A festival is on*) add the tag to your list, switched off.

The texts are part of the module in `lang/library/<language>/<group>.json`, one file per group and language, readable and without any code. The tables are imported as plain roll tables, so nothing of the library stays active afterwards. The coin rows use the coin keys `gp`, `sp` and `cp`, which every system with a purse of the module understands.

## Rows with conditions

A result row can carry conditions. A row whose conditions do not hold is left out of the draw, as if it were not on the table. The table then rolls its formula again until it lands on a row that is allowed, so the chances of the other rows grow in proportion. A deep roll shows the rows that were left out, each with its reason.

Click *Conditions* next to a row in the edit mode of the table, or in the window of a single result. A row can combine any of these, and all of them have to hold:

* **Scenes:** the scene the person who rolls is looking at, one or more.
* **Regions:** names of Regions, separated by commas, not case sensitive. It holds when a selected token stands in a Region with one of the names. Without a selected token, the tokens of the player characters on the map count. Without any token the Regions are unknown and the condition fails.
* **Time of day:** dawn, day, dusk and night, taken from the world time. The hours are world settings (dawn 5, day 8, dusk 18, night 21 by default). With a calendar of another length of day the hours are still the hours of the calendar clock.
* **Party level:** a range from and to, either end can stay empty. The party level is the average, rounded, of the characters the players are assigned to (else the characters players own). It is read per game system: D&D 5e and PF2e the character level, Crucible the level, SWADE the rank from 1 (Novice) to 5 (Legendary), other systems the usual level fields. The setting *Party level for rows with a level range* switches to a number you type, or off, which ignores level conditions. When the level cannot be read the condition fails and says so.
* **Story tags:** a small list of names the GM switches on and off, for example *War has started*. A row can ask for a tag to be on or off or not care. Open the list with *Story tags* in the header of the roll table directory, in the module settings, or from the conditions window. Every change is saved at once, rows react at the next draw. A tag keeps its id when you rename it.

In view mode the GM sees a note with the conditions under every row, struck through while the row is left out, and the tooltip names the reason.

### When no row fits

If every row that is left fails its conditions, the table setting *When no row fits* (edit mode, under Deep Tables) decides:

* **Report it** (default): nothing is drawn, the GM gets a notification, and the card or the window says that no row fits.
* **Ignore the conditions:** the table is drawn from all of its rows and the card says so.
* **Pick again above:** only for a table inside another table. It hands back to the table it sits in, which picks another row. A table at the top reports instead.

The situation is read on the computer of the person who rolls. A roll a player asks for goes through the GM, so it uses the GM's scene and tokens.

## Results that act

A result can carry one action that happens when the GM clicks its button on the card, or on its own when the card is shown. In the edit mode of a table every row has an *Action* button next to its quantity (the window of a single result has it too). The window offers:

| Action | Does |
| --- | --- |
| Place a saved encounter | Needs Sephral’s Saved Encounters. The button opens its placing with the ghost preview. A quantity on the result places the group that many times over (unique characters stay single). Optionally starts a fight |
| Place tokens | A world actor or a compendium actor (it is imported once), by name, UUID or by dropping it on the field. *How many* is a number or a formula like `1d4+1`, empty uses the quantity of the result. You click a spot, the tokens stand in rows around it, up to 50. Works without Saved Encounters |
| Play a sound | A playlist, a sound of a playlist or an audio file, for everyone |
| Show a journal | Shows a journal entry to the players, or only opens it for you. A page opens at its place for you and is shown as its journal |
| Apply a status or effect | A status of the game system, or an active effect by UUID, to the selected or the targeted tokens |
| Run a macro | A macro of the world. It gets the table, its UUID, the result and the quantity as the first argument, and the selected token as `token` and `actor` |

A result that links to a document uses that document when the action's field is empty, so an actor result can place itself and a journal result can show itself.

On the card the GM sees a button (*Place*, *Play*, *Show*, *Apply* or *Run*) under the row. After the run the button gives way to what happened. Placed tokens and applied effects can be taken back with *Undo*, which brings the button back. Sounds, shown journals and macros cannot be undone. The run is written on the card, so it survives a reload and cannot run twice by accident.

*Run on its own when the card is shown* runs the action as soon as the GM's browser posts the card, one after the other. The world setting *Results may act on their own* switches this off for all actions, they then wait for their button.

Only GMs run actions. Players see the card and its outcome: the tokens on the map, the sound, the journal. The card holds only the type of the action. The settings of the action stay on the result, so players do not read what a result does. If the action of a result is changed or removed after the card was posted, the card uses what the result says now.

## Tables for players

*Players may roll* in the edit mode of a table (under *Deep Tables*) releases the table. It then appears in a small list, *Tables to roll*, that players open with the dice button in the chat controls. Each row shows the visibility the GM chose in *Shown to* (*Like in Foundry* counts as everyone here). The roll goes over the module socket to the active GM, whose browser rolls the table and posts the card. So the players need no permission on the table, the memory and the actions work as usual, and the card says *for Player* below its title. A table in a compendium cannot be released.

* Who sees the card is exactly what the GM chose: everyone, GM only (the player sees it too), blind or only the player.
* The active GM checks every request against the table's flags again, so a table that is not released cannot be rolled by sending a request.
* Without a GM online the player is told so. A table with nothing left tells the player, and no card is posted.
* The list is kept in a hidden world setting, written by the GM whenever a table is released, renamed or removed, because players often cannot see the tables themselves.

## Roll Triggers

With Sephral’s Roll Triggers active, its action *Roll table* uses the Deep Tables card: quantities, tables inside tables, the memory and actions of results all work, and the card names the trigger below its title. For example a natural 20 can roll a table of critical hits. The card is flagged as trigger output, so it never triggers again. Deep Tables does this through the hook `sephrals-roll-triggers.rollTable` that Roll Triggers calls before it draws a table. The setting *Roll tables of Roll Triggers with Deep Tables* (shown only while Roll Triggers is active) switches it off, Roll Triggers then posts Foundry's own card. Without Roll Triggers this part is hidden and does nothing.

## In journals and chat

`@DeepTable[Name or UUID]{Text}` writes a button into a journal page, an item description or a chat message. A click draws from the table and posts the card, Shift and a click opens the deep roll window. Players get a working button for tables they can see, and a grayed out one for the others.

## The table window

In edit mode, under the table settings, you find *Deep Tables*: the number of draws, *No duplicates*, *Shown to*, *Remember what was drawn* with its counter, *Players may roll* and *When no row fits*. Next to every result are its quantity, its action and its conditions. In view mode every row shows its chance, calculated from the table formula (switch it off with *Show chances in tables*), and the GM sees a note with the draws, duplicates and visibility of the table and the quantity of each row.

## Tables from other modules

Tables set up with an older table module keep working without it. Its quantity of a result, its number of draws and its no duplicates option are used when the table has no setting of Deep Tables. The quantity of Sephral’s Loot Ledger is used as well. The older module is not needed and nothing of it is changed.

## Settings

| Setting | Scope | Does |
| --- | --- | --- |
| Module language | This device | Like Foundry, English or German |
| Look | This device | Signature (warm paper) or Foundry (dark) for the windows and the card |
| Show chances in tables | This device | The chance of every row in the table window |
| Depth of tables inside tables | World | How many levels are followed, 1 to 10 |
| Results may act on their own | World | Lets actions that are set to run on their own do so when the card is shown. Off, every action waits for its button |
| Dawn, day, dusk, night start at | World | The hour (0 to 23) each part of the day begins, for rows with a time of day |
| Party level for rows with a level range | World | Auto from the characters, Manual (the number below) or Off, which ignores level conditions |
| Party level, set by hand | World | Used with Manual |
| Roll tables of Roll Triggers with Deep Tables | World | Only while Roll Triggers is active. A trigger that rolls a table posts the Deep Tables card |
| Story tags | GM | Opens the list of story tags |
| Run self test | GM | See below |
| Save debug file | GM | See below |

## Self test

*Run self test* in the module settings checks what the module needs in Foundry: roll tables, the table window, text enrichers, chat, its windows, a test draw, the memory of tables, the actions, the list for players and the module socket, the placing of tokens, statuses and audio, the situation and the check of rows with conditions, the shipped table library, the coins of the game system and, when active, Saved Encounters, the module for loot piles and the Loot Ledger. The result comes as a notification and a chat message only you see, with the Foundry version the module was verified with. After a Foundry update you get a one time notice to run it.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message.

The file contains chat text and whispers. Check it before you share it.

## Sephral’s Modules

The first button in the module settings, *Sephral’s Modules* (GMs only), opens one window for all of Sephral's modules in the world: the version, self test, settings, manual and demo video of each, a button that switches on an installed module that is off (Foundry then reloads the world for everyone), and the debug file. Below, *More from Sephral* lists other modules that fit the game system of the world, shown only after a click, each with its demo video and an *Install* button. Foundry installs modules only on its setup screen, so the button copies the module's link (manifest URL) and shows the steps with a short clip. When the GM launches the world again, the window opens once with the new module and its *Enable* button. The list is part of the module. Only a video you start is loaded, from the module page on GitHub.

## Limits

* One roll gives at most 400 rows and one formula at most 100 draws or repeats.
* A card holds at most 30 dice rolls.
* The coins of a card go into a purse only on D&D 5e and Crucible.
* A private card hides its content from other players on screen, like every private roll of Foundry does.

## Macro API

`game.modules.get("sephrals-deep-tables").api` offers:

| Function | What it does |
| --- | --- |
| `roll(table, options)` | Rolls a table (the table, its UUID, id or name) and posts the card. Options: `draws` (formula), `distinct`, `mode` (`foundry`, `public`, `gm`, `blind`, `self`), `post: false` to roll without a card. Returns the lines, the merged items, notes about problems and the message |
| `drawNow(table, options)` | The same as the menu entry Draw now |
| `open(table)` | Opens the deep roll window |
| `parseText(text)` | Reads a pasted list and returns name, formula and rows without making a table |
| `openImport()` | Opens the window Table from text (GM) |
| `snapshot(table)` | A plain copy of a table as the module sees it |
| `counters(table)` | What the table and the tables inside it remember: `[{uuid, name, used, total, ids}]` |
| `resetMemory(table)` | GM: brings everything back, the marks of Foundry and the memory |
| `putBack(table, resultId)` | GM: puts one result back |
| `runAction(message, key)` / `undoAction(message, key)` | GM: runs or takes back the action of a card row (`key` is the row's key in the message flags) |
| `editAction(result)` | GM: opens the action window of a table result |
| `openPlayerTables()` / `rollListed(uuid)` | Opens the list of tables players may roll, rolls one of them (a GM at once, a player through the GM) |
| `syncPlayerTables()` | GM: writes the list for players again |
| `openLibrary()` | GM: opens the Table library |
| `importLibrary(keys, options)` | GM: imports tables of the library by key, for example `["name-any", "inn-name"]`, with the building blocks they need. Options: `lang` (`en` or `de`), `folder` (name, empty for none). Returns the new tables and the number skipped because they are in the world already |
| `library(lang)` | The tables of the library in a language: `[{key, name, group, part}]` |
| `storyTags()` | The story tags: `[{id, name, on}]` |
| `setStoryTag(idOrName, on)` | GM: switches a story tag on or off, without `on` it toggles. Returns false when the tag does not exist |
| `saveStoryTags(tags)` / `openStoryTags()` | GM: replaces the list, opens the window |
| `editConditions(result)` | GM: opens the conditions window of a table result |
| `situation()` | What conditions are checked against right now: `{sceneId, regions, period, hour, level, levelOff, tags}` |
| `checkConditions(conditions)` | `{ok, reasons}` for a conditions object, as stored in the flag `flags.sephrals-deep-tables.conditions` of a result (`scenes`, `regions`, `times`, `level: {min, max}`, `tags: {id: true or false}`) |
| `runSelfTest()` | Runs the self test (GM) |
| `saveDebugFile()` | Saves the debug file (GM) |

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Deep Tables it holds:

* on how many of the last 30 days the module was used
* how often a deep roll is opened, a table is drawn now, a card is posted, a single row is drawn again, a result is given to a character, left as a loot pile or added to the loot, a table is made from text, a journal button is used, a table is brought back, an action runs or is taken back, a player rolls a table, a trigger rolls one, the Table library is opened, tables are imported from it, conditions are saved on a row, a draw leaves rows out because of their conditions and a story tag is switched
* the settings *Look*, *Show chances in tables*, *Depth of tables inside tables*, *Results may act on their own* and *Roll tables of Roll Triggers with Deep Tables* (only the chosen option)
* where errors occur in the module code: file, line, error type and whether the error arose in the module itself, in Foundry, in the game system or in another module, never the error message or the name of another module

No names, notes, pictures or other content of the world are sent.
