# Changelog

## 0.3.0

- `; x`, or `:crossing-over`, makes an arrow cut a gap in the arrows it crosses, as tikz-cd's `crossing over` does, and stacks it above any others already crossing over. The export writes the arrows in that stacking order, since tikz-cd only cuts a gap in arrows drawn before the crossing one, and the canvas stacks them the same way, so the gaps match the PDF. `:crossing-over on` brings an arrow to the front, `off` turns it off, and hand-written `crossing over` is read back in the order it is written.
- The mark is a named binding, `mark` (`C-SPC`, adding with Shift), with `mark-add` for a key of its own that adds, so the keys file can move it.
- While a mark is set, a dashed rectangle runs from it to the focus point, and the cells it would take are highlighted, so the rectangle is seen before it is taken. `:mark` and `:mark-add` set and use the mark from the command line.
- A chord a keyboard layout reports as `Unidentified` (Control with Space, in some) is matched by its physical key, so `C-SPC` reaches the mark on such layouts.
- An arrow can be routed through cells, straight from centre to centre with rounded corners, instead of drawn as a curve. `; w` (`:route`) bends it round one corner, along the row and then along the column, and straightens it again; `; k` (`:checkpoint`) adds the cell at the focus point to the end of the route, or takes it out; `; m` (`:move-checkpoint`) carries a checkpoint with the focus point until RET; and `; b` rounds the corners. The export writes a `to path` through the nodes' centres, which reads back, and the encoded line keeps the route, which quiver ignores.
- A pan held by Control or Option ends with the next key, or when the window loses the focus, if the key came up unseen, as it can behind a file dialog. It used to hold until the next click, taking the arrow keys, and the mark with them.
- `C-SPC` marks a corner of a rectangle of cells: press it, move the focus point, and press it again to select every cell between the two corners, along with the arrows whose ends are both among them. `C-S-SPC` adds that rectangle to the selection instead of replacing it, ESC drops the mark, and the mode line shows `MARK` while there is one.
- `:set SETTING VALUE` names any setting and the value to give it, which the settings layer cannot: it steps numbers by key, and lists only some of them. Tab lists the settings, `:set SETTING` alone reports what it holds, and a value the setting cannot take is refused with what it may be.
- A preset with no arrow selected sets `diagram.arrow_preset`, the preset new arrows take, rather than being refused, so a style can be chosen before anything is drawn as well as after. The command layer marks the preset in force, and the change is not undoable, since it is not part of the diagram. A style still needs an arrow to apply to.
- `:insert-row-above`, `:insert-row-below`, `:insert-column-left`, and `:insert-column-right` open a gap at the focus point: everything at or beyond it moves one cell on, and the arrows come with their ends. One undo closes the gap.
- `:snake` replaces the selected arrow with a chain of arrows through new empty cells, along the staircase between its ends, so a map drawn step by step is one command rather than a placement apiece. `:snake x` or `:snake y` chooses which axis steps first.
- Control with the wheel zooms, as Shift already did, since that is what every browser and editor uses.
- Dragging with the middle button pans, over a cell as well as over empty space, which dragging with Control or Option held cannot.
- `examples/snake-lemma.tikzcd`, which the example paper inputs beside the pullback. Its connecting morphism is one curved dashed arrow: an arrow has a single curve, and giving it waypoints would need a field the encoded first line has no room for.
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
