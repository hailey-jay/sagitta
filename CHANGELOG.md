# Changelog

## Unreleased

- Quiver mode is the default. The setting is now `ui.spreadsheet_mode`, off unless set, with `:spreadsheet-mode` and `s` in the settings layer to switch it; `ui.quiver_mode` and `:quiver-mode` are gone, so a settings file that turned quiver mode on needs nothing, and one that relied on spreadsheet mode sets `ui.spreadsheet_mode`.
- `ui.which_key_delay` matters only in spreadsheet mode, since quiver mode lists the command layer's keys on `;` alone.
- In quiver mode, the mode line shows `MARK` while a mark waits for its other corner, and `CHECKPOINT` while one is carried, as spreadsheet mode always has.
- RET selects the whole label, so typing replaces it (a new cell's `\bullet`, say), and an arrow key goes to either end of it to edit it in place. It put the caret at the end.
- In quiver mode, RET after stepping a slider, or with a style list open, lets go of it, as in spreadsheet mode, rather than going on to edit the label.
- A key the command layer has no command on says so in the mode line (`x unbound`).
- The help and the tip on an empty diagram describe the mode in force: in quiver mode, DEL deletes and RET labels.
- The Tab marker on the next queued cell goes once the label is finished, until the next Tab, and ESC can then still unqueue the cells.
- While the keys are in use, the cell or arrow the pointer rests on is not highlighted, until the pointer moves.
- `SPC` selects the arrows it draws along with their new target, so a preset or a style applies to them at once. RET on such a selection labels the cell alone, and the arrows are selected again once the label is put down.
- The keys file's complaint about a key alone no longer says it would type, which it does only in spreadsheet mode.

## 0.4.1

- In Firefox, a label typed onto an arrow is drawn. Firefox does not lay out an arrow's label in the frame the arrow redraws it, so such a label measured nothing and never showed; it is now measured again in the next frame. Labels read from a file, and the desktop app, were not affected.

## 0.4.0

- Sagitta runs in a browser, as a page served from any static host. In Chrome, Edge, and other Chromium browsers, opening a diagram keeps hold of the file, so saving writes it back and a macros file is reloaded when it changes. Other browsers open a copy and save by downloading. In Chromium, `:open-folder` hands over a folder, in which the nearest `macros.tex` is found and relative paths work, and the last diagram and its folder reopen on the next visit, once the user agrees. Elsewhere, macros come from `f` in the macros layer or a dropped `.tex` file. Settings and the keys file live in the browser's storage, and opening the settings file edits both in the page.
- In a browser, an address ending in `#q=...` opens the diagram it encodes, untitled, as quiver's links do, and so does pasting one into the address bar of the open page. The encoding is a `.tikzcd` file's `%#q=` line.
- In a browser, the page opens without a network once it has loaded, and installs as an app where the browser offers that. It asks in dialogs of its own, rather than the browser's. A device with no mouse or trackpad is told that little works by touch, and a page served insecurely, where the browser withholds files, says so.
- `npm run web` serves the repository on 127.0.0.1, which browsers treat as secure, to try the page.
- Quiver mode, `:quiver-mode` or `q` in the settings layer, keeps the command layer open, so its keys work without `;`, and a label is typed only after RET, as in quiver. The layer's keys are listed only on `;`, though a list of choices, such as after `t`, shows at once. Spreadsheet mode, where typing edits the label, stays the default. The choice is `ui.quiver_mode` in the settings.
- RET on an empty cell with nothing selected makes a cell there and edits its label, in either mode. It used to do nothing.
- `; k` takes a checkpoint out of the selected arrows that pass through it, rather than adding it to the others when only some do, and with the pointer resting on a checkpoint's ring, it takes out that one, wherever the focus point is.
- A key the command layer does not use is kept from the browser, which otherwise acted on it (Firefox's quick find, on `'`).
- A message about a file names it as the host can best name it: by its path on the desktop, and by its name in a browser.
- The help (`C-/`) ends with About: the version, the licence, and links to the source, quiver, KaTeX, and `NOTICE`, which open in the desktop's browser from the app. In a browser, it also says that nothing drawn or opened leaves the browser. The desktop packages now carry `LICENSE` and `NOTICE`.

## 0.3.0

- `; x`, or `:crossing-over`, makes an arrow cut a gap in the arrows it crosses, as tikz-cd's `crossing over` does, and stacks it above any others already crossing over. The export writes the arrows in that stacking order, since tikz-cd only cuts a gap in arrows drawn before the crossing one, and the canvas stacks them the same way, so the gaps match the PDF. `:crossing-over on` brings an arrow to the front, `off` turns it off, and hand-written `crossing over` is read back in the order it is written.
- The mark is a named binding, `mark` (`C-SPC`, adding with Shift), with `mark-add` for a key of its own that adds, so the keys file can move it.
- While a mark is set, a dashed rectangle runs from it to the focus point, and the cells it would take are highlighted, so the rectangle is seen before it is taken. `:mark` and `:mark-add` set and use the mark from the command line.
- A chord a keyboard layout reports as `Unidentified` (Control with Space, in some) is matched by its physical key, so `C-SPC` reaches the mark on such layouts.
- An arrow can be routed through cells, straight from centre to centre with rounded corners, instead of drawn as a curve. `; w` (`:route`) bends it round one corner, along the row and then along the column, and straightens it again; `; k` (`:checkpoint`) adds the cell at the focus point to the end of the route, or takes it out; `; m` (`:move-checkpoint`) carries a checkpoint with the focus point until RET; and `; b` rounds the corners. A selected arrow marks its checkpoints with rings, which the mouse can drag. The export writes a `to path` through the nodes' centres, which reads back, and the encoded line keeps the route, which quiver ignores. A cell with no node in its row or column gets an empty node of no size, so a route leaves the spacing as it was, and the canvas puts a label on the leg the PDF does.
- An arrow's label in braces (`"{f'}"`, as the export writes any label that is not one word) is read without them. It kept them, so a file read from its picture, after a hand edit, gained another pair of braces round every such label each time it was saved.
- A command that changes nothing (a label alignment the arrows already have, a route they already take) leaves no undo step, and so no longer throws away what redo would bring back.
- A pan held by Control or Option ends with the next key, or when the window loses the focus, if the key came up unseen, as it can behind a file dialog. It used to hold until the next click, taking the arrow keys, and the mark with them.
- `C-SPC` marks a corner of a rectangle of cells: press it, move the focus point, and press it again to select every cell between the two corners, along with the arrows whose ends are both among them. `C-S-SPC` adds that rectangle to the selection instead of replacing it, ESC drops the mark, and the mode line shows `MARK` while there is one.
- `:set SETTING VALUE` names any setting and the value to give it, which the settings layer cannot: it steps numbers by key, and lists only some of them. Tab lists the settings, `:set SETTING` alone reports what it holds, and a value the setting cannot take is refused with what it may be.
- A preset with no arrow selected sets `diagram.arrow_preset`, the preset new arrows take, rather than being refused, so a style can be chosen before anything is drawn as well as after. The command layer marks the preset in force, and the change is not undoable, since it is not part of the diagram. A style still needs an arrow to apply to.
- `:insert-row-above`, `:insert-row-below`, `:insert-column-left`, and `:insert-column-right` open a gap at the focus point: everything at or beyond it moves one cell on, and the arrows come with their ends. One undo closes the gap.
- `:snake` replaces the selected arrow with a chain of arrows through new empty cells, along the staircase between its ends, so a map drawn step by step is one command rather than a placement apiece. `:snake x` or `:snake y` chooses which axis steps first.
- Control with the wheel zooms, as Shift already did, since that is what every browser and editor uses.
- Dragging with the middle button pans, over a cell as well as over empty space, which dragging with Control or Option held cannot.
- `examples/snake-lemma.tikzcd`, which the example paper inputs beside the pullback. Its connecting morphism is one dashed arrow routed round the outside of the figure. The paper loads `amsmath`, for the `\coker` of `macros.tex`.
- The settings and the bindings are now tables (`src/schema.js` and `Bindings.TABLE`) that readers naming nothing in them take as arguments, so adding a setting or a binding means editing a table. Nothing about the app changes.
- A second test suite, `npm run test:fast`, checks the `.tikzcd` round trip, the parser, the export, the settings, and the keys file in about a second, with neither Electron nor a display, so a regression in them shows before the full suite starts.

## 0.2.0

- Runs on Windows, as a per-user installer that registers `.tikzcd`, or as a portable executable. Neither is signed, so SmartScreen warns the first time.
- A windowed program on Windows has no console, so `--help` and `--version` open a dialog there.
- Saving retries the rename over the diagram. Windows can refuse the rename for a moment while an indexer, a scanner, or a sync client holds the file open.
- The `macros.tex` search stops at the home directory on Windows too. The same path can be spelt in more than one case there, and the old comparison missed it.
- A complaint about `settings.json` or `keys` names the directory holding them, rather than always `~/.config/sagitta`.
- `|` types itself instead of wrapping the label or bringing a closing `|`, since it is as often a restriction or "divides" as an absolute value. It still pairs after `\left`, and `\|` and `\lvert` still pair.

## 0.1.0

First public release, for Linux only, as an AppImage or from source.

- Edits `.tikzcd` files that a paper `\input`s directly, with quiver's encoding on the first line and a byte-for-byte round trip.
- Keyboard-driven: spreadsheet-style labels, the `;` command layer, the `:` command line, `/` search by label or code, and `C-/` help.
- Usable by mouse: right-click or the mode line's `; commands` button opens the command layer, whose lines are clickable, and the help lists the mouse's gestures.
- Labels render with the nearest `macros.tex`, reloaded when it changes.
- A keys file (`~/.config/sagitta/keys`) rebinds keys, and `settings.json` holds the settings, which the settings layer (`C-,`) changes.
- The command layer lists its keys after a short wait (`?` at once), or in a compact form.
