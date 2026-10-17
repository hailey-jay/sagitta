# Sagitta manual

Sagitta is a keyboard-driven editor for tikz-cd commutative diagrams, grown from quiver (q.uiver.app) and run as a desktop app on Electron 43 (`$SAGITTA_ELECTRON`, else `electron43` or `electron` on PATH, else `npm install`'s).
It edits `.tikzcd` files that a paper `\input`s directly.

## Command line

```
sagitta [--macros FILE] [--devtools] [DIAGRAM.tikzcd] [-- SWITCHES]
```

`DIAGRAM` need not exist yet.
`sagitta --help` lists the options, and `--version` gives the version.
Anything after `--` goes to Electron and Chromium, such as `-- --ozone-platform=wayland`.
`.tikzcd` files are registered as `text/x-tikzcd` and open in Sagitta from the file manager.

## The file

A `.tikzcd` file is the tikz-cd export verbatim, so LaTeX can `\input` it.
Its first line, `%#q=...`, encodes the diagram exactly.
Opening a file trusts that line only while it still reproduces the `tikzcd` environment; otherwise, the tikz-cd is parsed, so hand edits win.
quiver's own `% https://q.uiver.app/#q=...` first line is read too, and prefixing Sagitta's line with `https://q.uiver.app/` opens it in quiver.

Opening and saving an unchanged file leaves it byte-for-byte the same.

Since the file is the export, saving writes it with the export layer's options (`C-e`).
Saving a new file, or saving as, opens that layer first, so the options can be checked: RET goes on to save, and `C-s` there saves too.
In the export layer, `q` copies the diagram's `#q=...` hash, which opens it after `https://q.uiver.app/` or the address of Sagitta's page, and `v` saves it as an SVG image, beside the diagram by default.
The SVG is drawn as the canvas draws it in light mode, with KaTeX's styles and the fonts its labels use inside it, so it shows the same anywhere a browser draws it; editors that ignore `foreignObject` show its arrows without their labels.
The mode line follows the file's name with any option that differs from its default, as in `square.tikzcd [no centre, column sep large]`.

The file is centred in `\[ \]` by default (`export.centre_diagram`), which a paper wants.
A `\documentclass{standalone}` document typesets what it inputs in a box, where display math is not allowed, so it stops with "Bad math environment delimiter": turn centring off (`c` in the export layer) for a diagram such a document inputs.

## Macros

Labels render with the nearest `macros.tex`, searched from the diagram's directory upward, stopping at the git repository's root and never reaching the home directory.
There are no global macros, by design.
`--macros FILE`, `f` in the macros layer, or `:macros FILE` choose another file.
The macros reload whenever the file changes.

## Keys

Sagitta's keys work as quiver's do, in quiver mode, the default: the command layer stays open by itself, so its keys work without `;`, and a label is typed only after RET, which selects the whole label, so that typing replaces it and an arrow key edits it in place; RET again, or ESC, puts it down.
Backspace deletes, as in the layer, and ESC does what it does outside the layer once there is nothing in the layer to let go of.
The layer's keys are listed only on `;`, never by waiting, though a list of choices, such as after `t`, shows at once.

Spreadsheet mode (`:spreadsheet-mode`, or `s` in the settings layer) works the other way round.
Typing edits the label of the targeted cell, spreadsheet-style, except that `(`, `[`, and `{` wrap the label (or the selected part of it) instead of replacing it.
Elsewhere they bring their closing delimiter, as in most editors, unless it is already next; typing the closing one steps over it, and Backspace in an empty pair deletes both.
RET selects the whole label to edit instead, and on an empty cell with nothing selected, makes a cell there to label, in either mode.
`\{` and `\|` pair the same way, and `\langle`, `\lvert`, `\lVert`, `\lceil`, and `\lfloor` once something other than a letter follows them.
After `\left`, the closing delimiter comes with `\right`.
`|` pairs only there, since it is as often a restriction or "divides" as an absolute value: elsewhere it types itself, and `\|` or `\lvert` gives a pair.
The commands live one key away:

- `;` the command layer: arrow styles and label alignment (a key, then the choice's own key, as listed), sliders (a key, then a number and RET), and presets.
  In spreadsheet mode, its keys are listed once it has waited 300ms for one, so a key typed straight after `;` does not flash the list up, and `?` shows or hides the list at once.
  Its capitals act on the label, and curve sets a loop's radius instead.
  A preset with no arrow selected sets `diagram.arrow_preset`, the preset new arrows take, and the list marks the one they take now; a style still needs an arrow to apply to.
- `:` the command line: named commands, with Tab completion.
- `/` (or `C-f`) search: selects the cells whose label is (or else contains) what is typed, or else the cells whose codes are typed.
  Each vertex has a code of one character, given out row by row (`asdfghjkl`, `zxcvbnm`, `qwertyuiop`, then the digits), and two once those run out; removing a vertex frees its code.
  An arrow's code is its source's then its target's, so the arrow from `A` to `S` is `AS`, and a second one `AS2`.
  An arrow whose code would be longer than three characters, as between arrows, takes one of its own, as a vertex does.
- `C-/` (or `<f1>`) help, which ends with what Sagitta is made from and where its source is, `C-e` export, `C-i` import (paste tikz-cd), `C-m` macros (paste definitions), `C-,` settings, and `C-s` save.
- `:dark-mode`: a grey canvas, with the default colour drawn in white.
  Other colours are drawn exactly, and nothing saved changes.
- `C-arrows` move the selection; on arrows alone they bend or shift them, and on loops alone they resize or turn them.
- `SPC` makes a cell at the focus point, or takes the one there, joined by arrows from the selected cells, and `S-SPC` selects or deselects the cell there.
  The new cell is selected with the arrows just drawn to it, so a preset or a style restyles them at once, while RET labels the cell alone; the arrows are selected again once the label is put down.
- `C-SPC` marks one corner of a rectangle of cells, as Emacs sets a mark: press it, move the focus point, and press it again to select every cell between the two corners, along with the arrows whose both ends are among them.
  `C-S-SPC` adds that rectangle to the selection rather than replacing it, and ESC lets go of the mark.
  While there is a mark, the mode line shows `MARK`, and a dashed rectangle runs from it to the focus point, over the cells it would take.
  `:mark` and `:mark-add` do the same from the command line.
  The keys file can move it (`mark`, and `mark-add` for a key of its own that adds); Space alone cannot be bound, but its chords can.
  Input methods such as IBus and Fcitx take Control-Space to switch input method, so where one runs, `C-SPC` never reaches Sagitta: bind `mark` to another key in the keys file (`mark C-g`, say, which is free), or change the input method's own key.

`:`, `/`, and the chords work the same in either mode.

The mouse works too.
Click a cell to select it, and again to edit its label; click an empty space twice for a new cell; drag from a cell to draw an arrow, by the edge of its space to move it, an arrow's end to reconnect it, and a selected arrow's checkpoint, by its ring, to move it.
The wheel pans, and zooms with Shift or Control held; dragging with the middle button pans, over a cell as well as over empty space, as does dragging with Control or Option held.
Right-click, or the `; commands` button in the mode line, opens the command layer, listing its keys at once, and clicking a line of its list presses that key; the sliders have `−` and `+` buttons.
The mode line's `⚙` button opens the settings.
The help lists all this under Mouse.
While the diagram is empty, a line of tips runs along the top.

## The keys file

`~/.config/sagitta/keys`, if it exists, rebinds keys.
On Windows the file is `%APPDATA%\sagitta\keys`.
In a browser it lives in the browser's storage, and opening the settings file (`o` in the settings layer) edits it beside the settings.
It is read at startup, and Sagitta never writes it.
Each line names something, then its keys, which replace all of its defaults:

```
# Comments start with #, except as a key after ;.
flip          ; e  C-S-f
curve         ; k
dotted        ; .
zoom-in       C-+  <f5>
hide-mode-line
unbind        C-n
```

Keys are written as the help shows them:

- `; b` is `b` in the command layer, and `; F` is Shift-f there.
  Digits, `;`, `:`, `/`, and `?` keep their meaning there.
- `C-s` is a chord, and `C-S-s` the same with Shift.
  A capital letter means Shift too.
  Other characters are written as typed, as in `C-+`, without `S-`.
- `<delete>`, `<insert>`, `<home>`, `<end>`, `<prior>`, `<next>`, and `<f1>` to `<f12>` work alone or with `C-` and `S-`.
  Printable keys alone need `;` or `C-`: in quiver mode, `; b` works without the `;`, since the command layer stays open, and in spreadsheet mode, `b` alone types.
- RET, TAB, SPC (with any modifier), ESC, DEL, and the arrows cannot be rebound.

A key that a line binds is taken from whatever had it by default.
A name alone unbinds it, and `unbind` frees keys from whatever has them.
A line with a problem is skipped whole, and the mode line reports the first problem and how many others there are.
Choosing a slider, a component, or `align` with a chord enters the command layer, which then takes the number, or the key choosing a style or an alignment.

The names and their defaults:

| Names | Defaults |
|---|---|
| `import`, `export`, `macros` | `C-i`, `C-e`, `C-m` |
| `save`, `save-as`, `open`, `new`, `open-folder` | `C-s`, `C-S-s`, `C-o`, `C-n`, none (in a browser only) |
| `undo`, `redo` | `C-z`, `C-S-z` |
| `select-all`, `select-connected`, `deselect-all` | `C-a`, `C-S-c`, `C-S-a` |
| `copy`, `cut`, `paste` | `C-c`, `C-x`, `C-v` |
| `delete`, `clear` | `<delete>`, none |
| `reverse`, `flip`, `flip-labels` | `; r` `C-r`, `; f`, none |
| `search` | `C-f` (and `/`, which cannot be rebound) |
| `flip-hor`, `flip-ver`, `rotate` | none |
| `centre-view`, `hide-grid` | `; z`, `; #` |
| `zoom-out`, `zoom-in`, `reset-zoom` | `C--`, `C-=`, `C-0` |
| `dark-mode`, `spreadsheet-mode`, `hide-mode-line`, `shortcuts`, `settings` | none, none, `C-\`, `C-/` `<f1>`, `C-,` |
| `level`, `curve`, `offset`, `radius`, `length`, `position` | `; n`, `; b` (on loops alone, the radius; on routes alone, the rounding), `; o`, none, `; l`, `; P` |
| `tail`, `body`, `head` | `; t`, `; d`, `; h` |
| `arrow`, `adjunction`, `corner` | `; a`, `; j`, `; p` |
| `align`, then `l`, `r`, `c`, or `o` for left, right, centre, or over | `; A` |
| `insert`, then `r`, `R`, `c`, or `C` for a row above or below, or a column left or right | `; i` |
| `align-left`, `align-centre`, `align-over` | none |
| `plain`, `equals`, `inclusion`, `mono`, `epi` | `; !`, `; =`, `; (`, `; <`, `; >` |
| `maps-to`, `dashed`, `dotted`, `squiggly` | `; \|`, `; -`, none, `; ~` |
| `align-source`, `align-target` | `; [`, `; ]` |
| `crossing-over` | `; x` |
| `route`, `checkpoint`, `move-checkpoint`, `rounding` | `; w`, `; k`, `; m`, none |
| `mark`, `mark-add` | `C-SPC` (with `S-`, adding), none |
| `colour`, `label-colour` | `; c`, `; C` |
| `select-at-focus`, `toggle-selection`, `create-arrows` | none (`S-SPC` does it), `; s`, `; e` |
| `change-source`, `change-target` | `; ,`, `; .` |

Any other command (Tab at `:` lists them) can be bound too, and its keys run it with no arguments.

## Crossing over

`; x`, or `:crossing-over`, makes the selected arrows cut a gap in the arrows they cross, as tikz-cd's `crossing over` does; pressed again, it turns that off.
`:crossing-over on` brings them to the front even if they cross over already, and `:crossing-over off` turns it off.

tikz-cd draws arrows in the order they are written, and an arrow crossing over cuts a gap only in those drawn before it, so the arrows crossing over stack in layers:

- Each turned on goes on top of those already crossing over, so the last one pressed is above the rest.
  Arrows brought to the front together share a layer, and among themselves the one whose source is lower, or further right, is above.
- The export writes the plain arrows first, then each layer in turn, and the canvas stacks them in the same order, so it cuts the gaps the PDF does.
- An arrow between arrows is drawn in the layer of the highest arrow it attaches to, since tikz-cd needs that arrow written first.
- Hand-written `crossing over` is read back, each one above those written before it, and a paste lands on top.

The gap also cuts any label it runs over, in the PDF as on the canvas, and the mode line says `crossing over`.
Only an arrow has it: an adjunction or a corner draws no line for a gap to follow.
Layers order arrows as a whole, so three arrows each crossing over the next, around a triangle, cannot be drawn.

## Routes

An arrow can be routed through cells instead of drawn as a curve: it runs straight from cell centre to cell centre, and each turn is rounded.

- `; w`, or `:route`, bends the selected arrows round one corner, along the row first.
  Pressed again, it goes along the column first, and a third time it straightens them.
  `:route x`, `:route y`, and `:route none` name the step.
- `; k`, or `:checkpoint`, adds the cell at the focus point to the selected arrows' routes, or, if any of them already passes through it, takes it out of those.
  With the pointer resting on a selected arrow's checkpoint ring, it takes out that checkpoint instead, wherever the focus point is.
  The arrow passes through its checkpoints in the order they were added, and while it is selected, each is marked by a ring.
  A cell an arrow joins is no checkpoint.
- `; m`, or `:move-checkpoint`, picks up the checkpoint at the focus point, which then follows the focus point.
  RET puts it down, as one undo step, and ESC puts it back; any other change to the diagram puts it down first.
  With the mouse, drag a selected arrow's checkpoint by its ring; letting go puts it down, and ESC, before then, puts it back.
  It skips over the arrow's own ends; while one is carried, its ring is filled, and the mode line shows `CHECKPOINT`.
- `; b` rounds the corners of a route, from 0 (sharp) to 8, as `:rounding` does; it is 3 to begin with.

A route takes the place of the arrow's curve and offset, which come back when it is straightened.
Loops, and arrows with an arrow at an end, have no route.
A route moves with its arrow when the whole arrow moves, and a gap opened across it moves the cells beyond the gap.
Reversing an arrow passes through its route the other way.

The export writes a route as a `to path` through the centres of the nodes in its cells, with `rounded corners`.
TikZ rounds a corner by the same radius however short its legs are, so the export rounds no more than tikz-cd's shortest legs allow, which can be less than the canvas shows; otherwise a corner on a short leg overshoots, and turns the arrowhead back.
An empty cell takes its centre from a node in its column and one in its row; a cell with neither is written out empty, and the diagram gets an `execute at empty cell` option, which is TikZ's `nodes in empty cells` with nodes of no size, so that the spacing is what it would be without the route.
tikz-cd puts all an arrow's labels on one leg of a route, so the label goes on the leg its position falls on, and `pos` is measured along that leg.
A shortened route is written with `shorten` lengths, since quiver's `between` does not follow a `to path`.
Routes written this way are read back from the picture alone; any other `to path` is reported and left out.
quiver itself ignores a route, so the diagram opens there with straight arrows.

## Building a diagram outwards

A figure can grow after it is drawn.

`; i` lists the gaps it can open at the focus point: `r` a row above, `R` a row below, `c` a column to the left, and `C` a column to the right.
The focus point can still move while the list is open, and `; i` again closes it.
`:insert-row-above`, `:insert-row-below`, `:insert-column-left`, and `:insert-column-right` do the same from the command line.
Everything at or beyond the gap moves one cell on, and the arrows come with their ends, since an arrow is held by the cells it joins rather than by a position.
`above` and `left` put the gap where the focus point is; `below` and `right` just after it.
One undo closes the gap.
A gap with nothing at or beyond it is refused, rather than doing nothing quietly.

A connecting morphism is one arrow: curved (`; b`, and `; -` for dashed), or routed round the diagram (see Routes), as `examples/snake-lemma.tikzcd` draws $\delta$.

## The canvas

The canvas is drawn to look like the PDF: it lays the diagram out as tikz-cd does in a 10pt document, scaled so that labels are the size `ui.label_size` draws them.
A column is as wide as its widest label, with the padding tikz-cd puts round it, and a gap: a third more than the column separation, as tikz-cd draws it.
A row is the same, with the row separation as its gap.
An empty column or row between the diagram's outermost cells and checkpoints is the gap alone, as in the PDF, so a route through one has the short legs it will have there.
Beyond them, an empty column or row is as big as one holding a bullet, so the space around a diagram keeps still as it is drawn into, and only shrinks to the gap once the diagram reaches past it.
That change, and its reverse, take a moment rather than happening at once, so that what moves is seen to move, unless the system asks for reduced motion, or the diagram has more than 300 cells.
The separations are the export layer's (`w` and `h` there), so changing them redraws the canvas.
Curves, offsets, and a route's rounding are drawn at the size the export writes them.
Loops are not yet.

## Settings

Settings live in `~/.config/sagitta/settings.json`, or in `%APPDATA%\sagitta\settings.json` on Windows.
In a browser they live in the browser's storage, for that browser alone.
Sagitta writes the file with every default the first time a setting changes, so the file shows each setting there is.
It can be edited by hand, and is read at startup.

The settings layer (`C-,`, or the mode line's `⚙`) lists them, each on a key, and shows every change straight away.
A setting that is on or off flips; a number is typed and set with RET, or stepped with the arrow keys or its `−` and `+` buttons; and `a` lists the presets for new arrows.
`e` opens the export layer, and `o` opens the file itself, for the settings the layer does not list.

`:set SETTING VALUE` names any setting and the value to give it, which the layer cannot: it steps numbers by key, and lists only some of them.
Tab lists the settings.
`true`, `on`, and `yes` all mean true, as `false`, `off`, and `no` mean false, and `null` is a value where the table below allows one.
`:set SETTING` alone reports what the setting holds.
A value the setting cannot take is refused, with what it may be.

| Setting | Default | |
|---|---|---|
| `export.centre_diagram` | `true` | wrap the export in `\[ \]` |
| `export.ampersand_replacement` | `false` | separate columns with `\&` |
| `export.cramped` | `false` | export with `cramped` |
| `export.standalone` | `false` | wrap the export in a standalone document |
| `diagram.var_corner` | `false` | the corner `; p` gives first, which follows the last one used |
| `diagram.arrow_preset` | `"plain"` | the preset new arrows take, from `plain`, `equals`, `inclusion`, `mono`, `epi`, `maps-to`, `dashed`, `dotted`, and `squiggly` |
| `ui.dark_mode` | `false` | the grey canvas |
| `ui.spreadsheet_mode` | `false` | spreadsheet mode (see Keys): typing edits the label, and the command layer's keys need `;` |
| `ui.zoom` | `100` | the zoom the view starts at, and `reset-zoom` returns to, in percent (20 to 200) |
| `ui.label_size` | `26` | the size of labels, in pixels (8 to 72), which the whole diagram is drawn to the scale of (see The canvas) |
| `ui.which_key_delay` | `300` | how long `;` waits for a key before listing its keys in spreadsheet mode, in milliseconds (0 to 5000), or `null` for only on `?` |
| `ui.which_key_compact` | `false` | list only the command layer's keys and their values, with what each does on hovering |
| `ui.hint_characters` | `"ASDF...7890"` | the characters of the codes `/` selects cells by, in order |

The export layer (`C-e`) toggles the `export.` settings, `:dark-mode` toggles dark mode, and the corners set `diagram.var_corner`.
A setting of the wrong kind or out of range is reported in the mode line and left at its default.
A file that is not valid JSON is reported, and is not overwritten until it is fixed.
