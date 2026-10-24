# Changelog

## 0.7.1

### Arrow options

- A curve is set in pt, as the export writes it (`curve={height=Hpt}`), rather than in steps of 6pt from -30pt to 30pt. The arrow keys still bend it 6pt at a time, `:curve 18` sets what `:curve 3` did, and any height up to TeX's largest dimension, fractions too, is read and written as it was given.
- A route's rounding is set in pt (the arrow keys still step it 2pt, and it starts at 6pt), a loop's radius in mm (its distance, negative for anticlockwise, stepped 5mm, and turning round rather than stopping at 0), and a loop's angle to the degree (stepped 45°). `:rounding 16` sets what `:rounding 8` did, and `:radius 10` what `:radius 3` did.
- A loop's `distance` is read in the unit it is given in (pt, em, mm, or cm), rather than always as mm.
- A fractional `shift left`, `shift right`, `shorten <`, or `shorten >` is read, rather than stopping the parse.
- A length is set to the percent, as `:length 5`, rather than in steps of 10%, which the arrow keys still take.
- `; o` sets a loop's angle while only loops are selected, as `; b` sets its radius, and the key list says so.
- The mode line gives each with its unit, as `curve 12pt`.
- Links still give a curve and a loop's radius in quiver's own units, so they open in quiver as before, and a route's rounding in steps of 2pt, so older links open as they did. A value between those units is written as a fraction, which quiver itself refuses.

## 0.7.0

### Presets

- `:chain-complex` (`:cc`), `:exact-sequence` (`:es`), `:short-exact-sequence` (`:ses`), and `:long-exact-sequence` (`:les`) stamp a chain complex, or an exact sequence, at the focus point, as one step to undo, selected and queued for labelling, so that Tab walks its cells. Options set the number of terms, the direction, chain or cochain, the indices (from a number, or about a symbol, as `C_{n+1}, C_n, C_{n-1}`), the ends (`0` or `\cdots`), the labels (templates such as `C_#` and `\partial_#{#-1}`), the spacing, and, for a long exact sequence, the rows, with the connecting map routed between them.
- Each opens a setup layer, with a ghost of what it would stamp at the focus point, laid out as the diagram's format lays it out: the keys change the options, the arrow keys move it, and RET stamps it. Where it would land on cells, or amscd cannot draw it, the layer says why instead.
- `:triangle` (`:tri`) stamps a distinguished triangle, its third arrow marked `+1`, or in a row with `row`.
- `:continue` (`:cont`) adds the next term at the end of a sequence, its indices stepped as they step along the last arrow, and `:reindex K` moves the indices of the selected labels by `K`.
- On the command line, double quotes hold spaces and `;` in an argument, and Tab offers the presets' short names and options, and the values of each.
- `:cc aug=M` ends a resolution with `\varepsilon` onto `M`, then `0`.
- Tab walks a stamp in the order it reads: each object, then the arrows from it.
- A complex going up or down ends in `\vdots` where it is unbounded.
- `:ses split` curves the section over the epi, or under it with `under`.
- Where a stamp would land on cells, they are outlined in red.
- In amscd, the setup layer says which options to change (as `wrap=0`), and dims those whose keys could only step away from what amscd draws.
- While the ghost shows, a press on the mode line (save, undo, the command line) leaves the setup layer first, so nothing acts on the ghost. On a command line, a preset goes last, since it opens its layer.
- `:continue` with several ends refuses where two would go on to the same cell, and draws each new arrow in the last one's colour and curve.
- `:reindex` moves only indices: not a subscript inside brackets (the `2` of `H^n(X;\mathbb{Z}_2)`), a capital (the `X` of `\Omega^n_X`), or a letter a script binds (the `i` of `\sum_{i=1}^n x_i`). It takes `+1` as well as `1`.
- `at=` takes a symbol with a number or a multiple, as `at=n+1` or `at=2k`, and refuses what is neither. `\#` in a template is TeX's `#`.
- With `wrap=1`, each arrow runs straight to the next row, rather than through a doubled route.
- Tab starts on the stamp just made, rather than on an older one still queued.

### Spectral sequences

- `:spectral-sequence` (`:ss`) stamps a page: entries by bidegree (from a template such as `E_#^{#p,#q}`, or none), ticks, and axes, by quadrant or by ranges, graded cohomologically, homologically, or as an Adams chart. The axes are drawn in TikZ from the tick nodes, and on the canvas by the same rule.
- The page's frame is kept in the file as a comment, `% sagitta: spectral-sequence ...`, and read back: the mode line shows the page and grading and reads bidegrees, and opening a column or row before the origin moves it.
- `; D` draws the page's differential from the selected entries, as Space draws arrows, to the entries it reaches (made as `\bullet` where there are none), and `:differential r` (`:d r`) draws `d_r` for any page. The key list shows `D` only while there is a spectral sequence.
- Clear takes a spectral sequence's frame and axes with its cells.
- `:frame` shows the frame and changes it: its grading, its page, its axes, and both ends of its ranges.
- `:d r all` draws every `d_r` between the entries in the ranges.
- `:diagonal n` selects the entries of total degree `n`, and `line` draws the diagonal dashed, on the canvas and in TikZ.
- With nothing selected, the mode line reads the focus point's bidegree.
- The axes are redrawn only when they change, rather than on every pan, and at once when a tick goes.
- The frame moves with its ticks: by the arrow keys, by dragging, or by opening a column or row before the page. A gap inside the page is refused, as are flipping and rotating it. Deleting the last cells takes the frame, as Clear does, and undoing a paste over a page brings its frame back.
- A diagram keeps one spectral sequence: a second `:ss` is refused, rather than taking over the first's axes.
- A spectral-sequence comment that cannot be read (as `page=two`, or `p=2..0`) is listed among the problems on opening, and left out, rather than read as nonsense. Axes left without their comment are listed too.
- `; D` draws only from entries in the page, not from ticks or the axes' names, and the mode line gives bidegrees only inside the page.
- The ticks and the axes' names are not queued for Tab.
- `:diagonal n line` takes a drawn diagonal away even once the ranges no longer reach it.
- After undo takes the frame away under `:frame`, its keys say so.
- The axes lie under the cells, so a press at the edge of an entry reaches the entry.

### Speed

- Deleting many cells together (a selection, Clear, or undoing a paste or a stamp) lays the grid out, recodes the diagram, and deselects them once, rather than once for each cell: on a 13 by 11 spectral sequence page, each key press in the setup layer takes about 170ms, where it took 500ms, and deleting a 41 by 41 page takes 0.1s, where it took 8s.
- Cells added together (a stamp, a paste, a file) are measured together, so that the page is laid out once: each key press on a 41 by 41 page takes under 2s, where it took 6.6s.
- A very large stamp (`:cc 1000`) no longer fails with "Maximum call stack size exceeded".

### Files

- An arrow label holding a quote, as `\text{"}`, is read back, as TikZ reads it; the arrow was lost.
- A `%` in a label is typed, drawn, and written as the sign, `\%`, rather than as a comment, which stopped TeX.
- A label whose braces do not balance is selected and named, and the diagram is not saved, rather than written as a file neither TeX nor Sagitta could read.
- Saving over a file that could not all be read asks first, since what was not read would be left out.
- A file with Windows line endings (CRLF) is saved with them.
- A file whose arrow has a coloured label opens; since 0.6.0, opening it failed.

### Errors

- An error sits just above the mode line, and whatever opens there (a layer's list of keys, or the command line and its completions) sits above the error, pushed up, rather than either covering the other.
- A problem in a key list (a preset that cannot land, an import's errors and warnings) runs across the list and wraps, rather than being cut short.
- Pressing on a spectral sequence's axes does nothing, rather than starting a new object and arrow in the cell under them.

### Moving around

- `; g`, or `:home`, moves the focus point to the diagram's first object (the top row's leftmost) and centres the view on it, for finding the way back on a large canvas.

## 0.6.0

### Files

- A diagram's file holds its export alone: the `%#q=...` line that encoded the diagram is gone, and opening a file reads the tikz-cd itself, so hand edits are read as any others. A file written earlier, or by quiver, still opens from its line while that reproduces the picture, and saving leaves the line out. `q` in the export layer still copies the `#q=` hash, which opens the diagram in quiver.
- New diagrams are saved as `.cd.tex`, which a paper inputs as `\input{diagram.cd}`, and which editors highlight as TeX; `.tikzcd` files open and save as before, under their own names. On Linux, `install.sh` registers both, while other `.tex` files keep opening in the TeX editor; on Windows, Explorer opens only `.tikzcd` files in Sagitta, as it goes by the last extension alone. A dropped `.cd.tex` file opens as a diagram, where any other `.tex` file gives macros.
- The examples are `.cd.tex` files, and `examples/five-lemma.cd.tex` is an amscd diagram, which `examples/paper.tex` inputs too.
- Opening a diagram, pasting, and undoing a deletion add their cells together: the codes, the stacking of arrows crossing over, and the palette of the diagram's colours are worked out once, rather than once for each cell added, and opening or pasting draws each arrow once fewer. A grid of 400 objects and 760 arrows opens in about 1.2s, where it took 4.9s, and a 6 by 6 one in 0.1s, where it took 0.3s.

### Formats

- A diagram can be written in amscd's `CD` environment, as well as in tikz-cd. A file holding a `CD` environment opens in amscd, and `f` in the export layer, or `:format amscd` and `:format tikz-cd`, switches format, as one step to undo. Pasting a `CD` environment in the import layer switches to amscd too. The mode line shows `[amscd]` after the file's name.
- The canvas lays an amscd diagram out as amscd sets it: a horizontal arrow at least 30pt long, or as long as its label, centred in a column as wide as the longest arrow in it; rows two baselines apart, or further for tall labels; vertical arrows 18pt long; and labels set where amscd sets them, above or below an arrow, or beside it.
- Switching to amscd first selects what it cannot draw (diagonal arrows, loops, arrows on arrows, curves, offsets, styles other than plain and equals, colours on arrows, and the like) and asks before converting, which deletes the arrows it cannot draw at all and draws the rest plainly.
- In amscd, the command layer's list dims what amscd cannot draw, and a step that would draw it is undone at once, with an error saying why. A move that would leave an arrow diagonal, or between cells that are not neighbours, is refused before it is made, from the keyboard or by inserting a row or column, and a dragged object only goes where amscd can still draw its arrows.
- `S` in the export layer saves, as `C-s` does.
- `m` and `M` in the export layer copy a row of objects and arrows as inline maths, as in `0 \to A \xhookrightarrow{f} B`, or display maths in `\[ \]`, saying which packages it needs (`amsmath`, `amssymb`, `mathtools`, or `extpfeil`, for labelled two-headed and equals arrows) and what it leaves out. Anything but a row is refused, with why, and the export layer greys `m` and `M` out.

### Reading tikz-cd

Reading a diagram's tikz-cd now gives back the diagram it was written from, so that saving it writes the same text: the fast suite checks this over hundreds of generated diagrams. Before, the encoded line hid these:

- A coloured object's label, if it was not a single word, gained a pair of braces each time it was read.
- A barred or bulleted arrow lost its mark when it was also double (`Rightarrow`), or equals.
- A hollow bullet at the middle of an arrow, with no position written, stopped the arrow being read.
- A label `\bullet` or `\shortmid` set over its arrow was read as a mark on it.
- A colour by name (`white`, say, or one the macros file defines) was not read.
- A colour read could come back a shade off, from rounding to whole degrees and percents.
- A label of several lines split its row of objects in two.
- A route's rounded corners came back a step less where its legs had kept them short, and its shortening a point or two off.
- An arrow between arrows could be written before an arrow crossing over that it followed.
- An empty cell a route passed through could take its centre from another node after reading.
- An arrow with several arrows on it, not all on its middle, was written with a phantom for each, and read back with an extra arrow.

## 0.5.0

### Breaking changes

- Keys work as in quiver, and only so: the command layer stays open by itself, so its keys work without `;`, and a label is typed only after RET. Spreadsheet mode, where typing edited the label, is gone, with `ui.quiver_mode`, `:quiver-mode`, and `ui.which_key_delay`, since `;` lists the command layer's keys at once. A settings file's old settings are ignored, and dropped the next time it is written.
- `:snake` is gone. A routed arrow (`; w`, `; k`) draws a connecting morphism as one arrow, with one label, where the snake's chain of arrows through new empty cells needed tidying by hand.
- `ui.cell_size` is gone, since the separations and `ui.label_size` now set the grid; an old `ui.cell_size` is ignored, and dropped the next time the settings file is written.

### The canvas

- The canvas is drawn to look like the PDF. It lays the diagram out as tikz-cd does, scaled to the labels: a column is its widest label, with tikz-cd's padding, and a gap that follows the column separation, and an empty column or row between the diagram's outermost cells and checkpoints is the gap alone, as in the PDF. Beyond them, an empty one is as big as one holding a bullet, so the space around a diagram keeps still as it is drawn into; when a column or row changes between the two, it grows or shrinks over a moment, unless the system asks for reduced motion. Changing the separations in the export layer redraws it. Curves, offsets, and a route's rounding are drawn at the size the export writes, so a curve on the canvas bends as much as in the PDF. Saved files are unchanged.
- Curves and loops are drawn on the canvas as TikZ draws them: a curve as quiver's `curve` cubic, and a loop as TikZ's `loop`, from the cell's border at the angles and distance the export writes, so their shapes match the PDF and not only their size. An arrow's label is set in script style, as tikz-cd sets it, and sits against the line as its node does in the PDF: by the box TeX sets it in, with tikz-cd's padding, rather than the taller line KaTeX draws it on, with 8px round that.
- Arrows meet a cell where they meet its node in the PDF: tikz-cd's, the box TeX sets the label in with tikz-cd's padding, centred on the maths axis rather than the middle of the box, as tikz-cd's asymmetrical rectangle is. The label sits on the axis to match. Loops in particular leave and come back where TikZ draws them, and arrows stop closer to small labels such as `\bullet`.
- A loop's label sits where TikZ puts it: TikZ picks a corner or side of the label's node from the loop's direction and sets it on the loop, so a label inside a loop (`'`) sits in the loop rather than over the cell.
- A route's rounded corners are exported no larger than tikz-cd's shortest legs allow. TikZ rounds a corner by the full radius however short its legs, so a route next to an empty row or column overshot, and its arrowhead pointed back along the curve.
- An arrow between wide labels shows its label when the diagram opens. Before the columns were sized, such labels overlapped, so the arrow could not be drawn and had no label to render into, and the label stayed blank until it was edited.
- The first label of a session is measured once KaTeX's font has loaded, so its column fits it: the first `\bullet` of a new diagram was measured in a fallback font, and its column was a few pixels narrower than the empty ones round it.
- Dark mode's canvas is a darker grey, `#303030` (it was `#3c3c3c`), so that dark colours, such as the preset blue and grey, show a little better against it. White strokes stay well short of bleeding.

### Keys

- RET selects the whole label, so typing replaces it (a new cell's `\bullet`, say), and an arrow key goes to either end of it to edit it in place. It put the caret at the end.
- RET after stepping a slider, or with a style list open, lets go of it, rather than going on to edit the label.
- `SPC` selects the arrows it draws along with their new target, so a preset or a style applies to them at once. RET on such a selection labels the cell alone, and the arrows are selected again once the label is put down.
- With nothing selected, DEL and `<delete>` delete the cell under the focus point, so a lone cell needs no selecting first. They did nothing.
- `; i` lists the rows and columns to insert at the focus point, chosen by the arrow keys: `↑` and `↓` a row above or below, `←` and `→` a column left or right.
- The mode line shows `MARK` while a mark waits for its other corner, and `CHECKPOINT` while one is carried, with the command layer open, as it did outside it.
- A key the command layer has no command on says so in the mode line (`x unbound`).
- The Tab marker on the next queued cell goes once the label is finished, until the next Tab, and ESC can then still unqueue the cells.
- While the keys are in use, the cell or arrow the pointer rests on is not highlighted, until the pointer moves.
- A key alone in the keys file, as in `flip q`, is the command layer's, as `; q` is, since the layer stays open. It was refused.
- While an arrow is drawn, its source is tinted blue and its target pink, over the selection's grey, so its ends are told apart from the selected cells.

### Files, settings, and export

- Saving writes the export layer's options, which now show: saving a new file, or saving as, opens the export layer first, where RET goes on to save, and the layer lists `C-s` to save with them. The mode line follows the file's name with any export option that differs from its default.
- In the export layer, `q` copies the diagram's `#q=` hash, and `v` saves the diagram as an SVG image, drawn as the canvas draws it, with the fonts its labels use inside it.
- `:keys-file` opens the keys file in the desktop's editor, starting it with a few lines of comments if there is none, and `:settings-file` opens the settings file, as `o` in the settings layer does.
- A problem with the keys or settings file is reported in a few words, without the folder the file is in, and names the command that opens the file: `keys line 1: no command "sav" (+1 more, :keys-file)`.
- A name in the settings file that is not a setting, such as a typo or a newer version's setting, is reported, and kept the next time the file is written. Only the settings earlier versions had are dropped.
- Dark mode follows the system's colour scheme, as it changes, until it is set by `:dark-mode`, the settings layer, or `:set`. A settings file already holding `ui.dark_mode`, as every file written so far does, keeps it: remove the line to follow the system.

### The interface

- The help, and the tip on an empty diagram, describe the keys as they now work, in a word or two each: `;` "list the commands", RET "edit the label", DEL "delete", and C-arrows "move, bend, or turn the selection", say. The docs give the detail.
- `:help` opens the help, for a browser where `C-/` and `<f1>` never reach the page. The command line's completions list it.
- In a browser, the help says to use `:new` for a new diagram, since the browser keeps `C-n`.
- In a browser that gives a page no folders, such as Firefox, `:open-folder` says only "open-folder not available on this browser", in the mode line.
- A message in the mode line keeps its room: the file, the target, and the arrow give way first, the key hints other than `; commands` drop off whole, from the right, only where there is no room for them, and an error sits on a line of its own above the mode line, wrapping rather than being cut short, and above the label input and the command line while they are open.
- Each of the interface's colours means one thing: pink marks keys and what has the focus, blue prompts, cell codes, and values, and yellow what waits. The mode line's badge names the state: `NORMAL` at rest, in grey, rather than a lone `;` in pink; `;` and the layers in pink while they await a key; `EDIT` while a label is edited; `MARK` or `CHECKPOINT` in yellow while one waits; and `MOVE`, `CONNECT`, and `PAN` apart from the layers. Unsaved changes are marked `●` after the file's name, rather than only by its colour, and messages are white.
- The interface dims what is secondary by one amount, and what is unavailable by another. The mode line's hints are a shade dimmer, and the completions' keys a shade brighter.
- The label input's `label` box is white, as the mode line's `EDIT` is, leaving pink to keys and the focus.
- The label input's box reads `label` again after a code prompt. It kept the prompt's name after it, as `labelToggle`, cut short.

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
