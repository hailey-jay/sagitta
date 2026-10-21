# Sagitta manual

Sagitta is a keyboard-driven editor for commutative diagrams in tikz-cd and amscd, grown from quiver (q.uiver.app) and run as a desktop app on Electron 43 (`$SAGITTA_ELECTRON`, else `electron43` or `electron` on PATH, else `npm install`'s).
It edits `.cd.tex` files that a paper `\input`s directly.

## Command line

```
sagitta [--macros FILE] [--devtools] [DIAGRAM.cd.tex] [-- SWITCHES]
```

`DIAGRAM` need not exist yet.
`sagitta --help` lists the options, and `--version` gives the version.
Anything after `--` goes to Electron and Chromium, such as `-- --ozone-platform=wayland`.
`.cd.tex` files, and the `.tikzcd` files of earlier versions, are registered as `text/x-tikzcd` and open in Sagitta from the file manager; other `.tex` files do not.

## The file

A diagram's file is its export verbatim, so LaTeX can `\input` it, and opening it reads the export, so hand edits are read as any others.
A new diagram is saved as `diagram.cd.tex`, which a paper inputs as `\input{diagram.cd}` or `\input{diagram.cd.tex}`.
Files named `.tikzcd`, as earlier versions saved them, open and save as before, under their own names.

Opening and saving an unchanged file leaves it byte-for-byte the same, Windows line endings (CRLF) included.
Where part of a file could not be read, the problems are listed on opening, and saving over it asks first, since what was not read would be left out.
A label whose braces do not balance stops TeX, so saving refuses while there is one, and selects it.
A `%` in a label is the sign, `\%`: typing `%` types `\%`, and a bare one is drawn and written so.

Files written before 0.6.0, and quiver's, begin with a line encoding the diagram: `%#q=...`, or quiver's `% https://q.uiver.app/#q=...`.
Opening such a file trusts the line while it still reproduces the `tikzcd` environment; otherwise, the tikz-cd is read, so hand edits win.
Saving leaves the line out.

Since the file is the export, saving writes it with the export layer's options (`C-e`).
Saving a new file, or saving as, opens that layer first, so the options can be checked: RET goes on to save, and `S` or `C-s` there saves too; `S` in the export layer saves at any time.
In the export layer, `q` copies the diagram's `#q=...` hash, which opens it after `https://q.uiver.app/` or the address of Sagitta's page, and `v` saves it as an SVG image, beside the diagram by default.
The SVG is drawn as the canvas draws it in light mode, with KaTeX's styles and the fonts its labels use inside it, so it shows the same anywhere a browser draws it; editors that ignore `foreignObject` show its arrows without their labels.
The mode line follows the file's name with its format, if it is not tikz-cd, and any option that differs from its default, as in `square.cd.tex [amscd, no centre]`.

The file is centred in `\[ \]` by default (`export.centre_diagram`), which a paper wants.
A `\documentclass{standalone}` document typesets what it inputs in a box, where display math is not allowed, so it stops with "Bad math environment delimiter": turn centring off (`c` in the export layer) for a diagram such a document inputs.

## Formats

A diagram is written in tikz-cd or amscd, and the canvas lays it out as that format sets it, so that it looks like the PDF in either.
The file's environment says which: a `CD` environment is amscd, and anything else tikz-cd.
A new diagram is tikz-cd.

`f` in the export layer, or `:format amscd` and `:format tikz-cd`, switches the diagram's format, as one step to undo; `:format` alone says which it is in.
Pasting a `CD` environment in the import layer (`C-i`) switches to amscd too.

amscd's `CD` environment holds a grid of objects, with straight arrows between neighbours in a row or a column, each plain (`@>>>`, `@<<<`, `@VVV`, `@AAA`) or equals (`@=`, `@|`), and labelled on either side; tikz-cd holds all of that and more.
A paper that inputs an amscd diagram needs `\usepackage{amscd}`, and `xcolor` for coloured objects.

- Switching to amscd first lists what it cannot draw, such as diagonal arrows, loops, curves, or styles other than plain and equals, and selects it.
  Converting drops it: the arrows amscd cannot draw at all are deleted, and the rest are drawn plainly, straight, black, and with their labels to one side.
  Undo brings it all back, in tikz-cd.
- In amscd, the command layer's list dims what amscd cannot draw, and anything that would draw it is undone at once, with an error saying why, so that a step taken by mistake leaves the diagram as amscd can write it.
  Moves are refused before they are made: moving vertices with `C-arrows`, or inserting a row or column (`; i`), is refused if it would leave an arrow diagonal or between cells that are not neighbours, and a dragged vertex only goes where its arrows stay drawable.
- amscd sets the arrows and labels itself: a horizontal arrow is at least 30pt long, or as long as its label, in a column as wide as the longest arrow in it; the rows are two baselines apart, or further for tall labels; and a vertical arrow is `\Big\downarrow`, 18pt long.
  The canvas lays the diagram out by the same rules, so the separations (`w` and `h` in the export layer), ampersand replacement, and cramped, which are tikz-cd's, are not offered.

`m` in the export layer copies the diagram as inline maths, as in `0 \to A \xhookrightarrow{f} B \to C \to 0`, for `$ $`, and `M` as display maths, in `\[ \]`.
Only a row of objects side by side, with one arrow between each two neighbours, is a formula; anything else is refused, with why, and `m` and `M` are greyed out.
Labelled arrows stretch over their labels, which `amsmath` does for plain arrows, `mathtools` for hooked, maps-to, and double ones, and `extpfeil` for two-headed and equals ones (`\xtwoheadrightarrow`, `\xlongequal`); a paper that loads `stmaryrd` must load it after `extpfeil`, which loads part of it; the mode line says which packages the formula needs, and anything it leaves out, such as colours.
Formulas are only copied: a diagram's file stays in its format.

## Macros

Labels render with the nearest `macros.tex`, searched from the diagram's directory upward, stopping at the git repository's root and never reaching the home directory.
There are no global macros, by design.
`--macros FILE`, `f` in the macros layer, or `:macros FILE` choose another file.
The macros reload whenever the file changes.

## Keys

Sagitta's keys work as quiver's do: the command layer stays open by itself, so its keys work without `;`, and a label is typed only after RET, which selects the whole label, so that typing replaces it and an arrow key edits it in place; RET again, or ESC, puts it down.
On an empty cell with nothing selected, RET makes a cell there to label.
Backspace, like `<delete>`, deletes the selection, or, with nothing selected, the cell under the focus point, and ESC lets go of whatever the layer holds, then does what it does outside the layer.
The layer's keys are listed only on `;`, never by waiting, though a list of choices, such as after `t`, shows at once.
The mode line's badge says what the keys do now: `NORMAL` at rest; `;`, or what the layer is setting, such as `; CURVE`, while it awaits a key; `EDIT` while a label is edited; and `MARK` or `CHECKPOINT`, in yellow, while one waits.
A `●` after the file's name marks unsaved changes.

The rest live one key away:

- `;` lists the command layer's keys: arrow styles and label alignment (a key, then the choice's own key, as listed), sliders (a key, then a number and RET), and presets.
  `?` shows or hides the list too.
  Its capitals act on the label, and curve sets a loop's radius instead.
  A preset with no arrow selected sets `diagram.arrow_preset`, the preset new arrows take, and the list marks the one they take now; a style still needs an arrow to apply to.
- `:` the command line: named commands, with Tab completion.
- `/` (or `C-f`) search: selects the cells whose label is (or else contains) what is typed, or else the cells whose codes are typed.
  Each vertex has a code of one character, given out row by row (`asdfghjkl`, `zxcvbnm`, `qwertyuiop`, then the digits), and two once those run out; removing a vertex frees its code.
  An arrow's code is its source's then its target's, so the arrow from `A` to `S` is `AS`, and a second one `AS2`.
  An arrow whose code would be longer than three characters, as between arrows, takes one of its own, as a vertex does.
- `C-/` (or `<f1>`, or `:help`, where a browser or one of its extensions keeps the keys) help, which ends with what Sagitta is made from and where its source is, `C-e` export, `C-i` import (paste tikz-cd), `C-m` macros (paste definitions), `C-,` settings, and `C-s` save.
- `:dark-mode`: a grey canvas, with the default colour drawn in white.
  Other colours are drawn exactly, and nothing saved changes.
  It follows the system's colour scheme until it is first set.
- `C-arrows` move the selection; on arrows alone they bend or shift them, and on loops alone they resize or turn them.
- `SPC` makes a cell at the focus point, or takes the one there, joined by arrows from the selected cells, and `S-SPC` selects or deselects the cell there.
  The new cell is selected with the arrows just drawn to it, so a preset or a style restyles them at once, while RET labels the cell alone; the arrows are selected again once the label is put down.
- `C-SPC` marks one corner of a rectangle of cells, as Emacs sets a mark: press it, move the focus point, and press it again to select every cell between the two corners, along with the arrows whose both ends are among them.
  `C-S-SPC` adds that rectangle to the selection rather than replacing it, and ESC lets go of the mark.
  While there is a mark, the mode line shows `MARK`, and a dashed rectangle runs from it to the focus point, over the cells it would take.
  `:mark` and `:mark-add` do the same from the command line.
  The keys file can move it (`mark`, and `mark-add` for a key of its own that adds); Space alone cannot be bound, but its chords can.
  Input methods such as IBus and Fcitx take Control-Space to switch input method, so where one runs, `C-SPC` never reaches Sagitta: bind `mark` to another key in the keys file (`mark C-g`, say, which is free), or change the input method's own key.

In a label, `(`, `[`, and `{` wrap the selected part of it, and otherwise bring their closing delimiter, as in most editors, unless it is already next; typing the closing one steps over it, and Backspace in an empty pair deletes both.
`\{` and `\|` pair the same way, and `\langle`, `\lvert`, `\lVert`, `\lceil`, and `\lfloor` once something other than a letter follows them.
After `\left`, the closing delimiter comes with `\right`.
`|` pairs only there, since it is as often a restriction or "divides" as an absolute value: elsewhere it types itself, and `\|` or `\lvert` gives a pair.

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
`:keys-file` opens it in the desktop's editor, starting it with a few lines of comments if there is none.
In a browser it lives in the browser's storage, and `:keys-file`, `:settings-file`, or `o` in the settings layer edits it beside the settings.
It is read at startup, and Sagitta writes nothing else into it.
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
  The layer stays open, so `; b` is pressed without the `;`, and `b` alone means the same; `#` alone starts a comment, though, so write `; #`.
  Digits, `;`, `:`, `/`, and `?` keep their meaning there.
- `C-s` is a chord, and `C-S-s` the same with Shift.
  A capital letter means Shift too.
  Other characters are written as typed, as in `C-+`, without `S-`.
- `<delete>`, `<insert>`, `<home>`, `<end>`, `<prior>`, `<next>`, and `<f1>` to `<f12>` work alone or with `C-` and `S-`.
- RET, TAB, SPC (with any modifier), ESC, DEL, and the arrows cannot be rebound.

A key that a line binds is taken from whatever had it by default.
A name alone unbinds it, and `unbind` frees keys from whatever has them.
A line with a problem is skipped whole, and the mode line reports the first problem, how many others there are, and `:keys-file`, which opens the file to fix it.
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
| `centre-view`, `go-home`, `hide-grid` | `; z`, `; g`, `; #` |
| `zoom-out`, `zoom-in`, `reset-zoom` | `C--`, `C-=`, `C-0` |
| `dark-mode`, `hide-mode-line`, `shortcuts`, `settings` | none, `C-\`, `C-/` `<f1>`, `C-,` |
| `level`, `curve`, `offset`, `radius`, `length`, `position` | `; n`, `; b` (on loops alone, the radius; on routes alone, the rounding), `; o`, none, `; l`, `; P` |
| `tail`, `body`, `head` | `; t`, `; d`, `; h` |
| `arrow`, `adjunction`, `corner` | `; a`, `; j`, `; p` |
| `align`, then `l`, `r`, `c`, or `o` for left, right, centre, or over | `; A` |
| `insert`, then `↑`, `↓`, `←`, or `→` for a row above or below, or a column left or right | `; i` |
| `differential`, of a spectral sequence's page (see Spectral sequences) | `; D` |
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

`go-home` (`:home`) moves the focus point to the diagram's first object, the top row's leftmost, or to `(0,0)` in an empty diagram, and centres the view there.

A browser keeps `C-n` for a new window, so there `:new` starts a new diagram.

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

`; i` lists the gaps it can open at the focus point, by the way they open: `↑` a row above, `↓` a row below, `←` a column to the left, and `→` a column to the right.
Choosing one closes the list, and `; i` again closes it without choosing; while it is open, the arrows choose rather than move the focus point.
`:insert-row-above`, `:insert-row-below`, `:insert-column-left`, and `:insert-column-right` do the same from the command line.
Everything at or beyond the gap moves one cell on, and the arrows come with their ends, since an arrow is held by the cells it joins rather than by a position.
`above` and `left` put the gap where the focus point is; `below` and `right` just after it.
One undo closes the gap.
A gap with nothing at or beyond it is refused, rather than doing nothing quietly.

A connecting morphism is one arrow: curved (`; b`, and `; -` for dashed), or routed round the diagram (see Routes), as `examples/snake-lemma.cd.tex` draws $\delta$.

## Presets

A preset stamps a ready-made diagram at the focus point: a chain complex, or an exact sequence.
What it stamps is ordinary cells, selected, as one step to undo; nothing remembers the preset afterwards.
Its cells are queued for labelling, as cells just drawn are: Tab goes to the first of them, and on through the rest in the order the diagram reads, each object followed by the arrows from it, each leaving the queue once labelled.

| Command | Stamps |
|---|---|
| `:chain-complex N` (`:cc`) | `\cdots → C_2 → C_1 → C_0 → \cdots`, with `\partial_n` on the arrows |
| `:exact-sequence N` (`:es`) | `0 → A_1 → A_2 → A_3 → 0` |
| `:short-exact-sequence` (`:ses`) | `0 → A ↪ B ↠ C → 0` |
| `:long-exact-sequence N` (`:les`) | `H_n(A) → H_n(B) → H_n(C)`, a row for each `n`, `\delta` routed from each row to the next |
| `:triangle` (`:tri`) | `X → Y → Z`, with `Z → X` marked `+1`; `row` for `X → Y → Z → X[1]` |
| `:spectral-sequence` (`:ss`) | a page of a spectral sequence, with ticks and axes (see Spectral sequences) |

Each opens its setup layer, which draws a ghost of what it would stamp, laid out as the diagram's format lays it out.
The arrow keys move the focus point, and the ghost with it; RET stamps it; ESC or `;` leaves without stamping.
Each option is on a key, listed in the layer: a number steps up with its key and down with the capital, a choice steps through its values, and a flag turns on and off.
`:` opens the command line on the options so far, for those that are text, and RET there opens the layer again.
Where the ghost would land on cells already there, or the format cannot draw it (in amscd, a routed or stretched arrow), there is no ghost, the cells in the way are outlined in red, and the layer says why, naming the options amscd can draw (as `wrap=0`). In amscd, an option already at the one value amscd can draw, whose keys could only step away from it, is dimmed.
Tab after an option's `=` offers its values, and some likely ones for text, as `obj=\bullet`.

The options, as `key=value` after the command, quoted (`obj="H_#(X; Y)"`) where they hold a space or `;`:

- `N`, first: how many terms, not counting the `0` or `\cdots` at the ends.
- `dir`: which way the arrows point, `r`, `d`, `l`, or `u`.
- `type`: `chain`, whose indices fall along it (`C_n → C_{n-1}`, with `\partial_n`), or `cochain`, whose indices rise (`C^n → C^{n+1}`, with `d^n`).
- `from`: where the indices end (chain) or start (cochain); `at=n` centres them on a symbol instead, as `C_{n+1}, C_n, C_{n-1}`, and `at=n+1` or `at=2k` on a symbol with a number or a multiple.
- `bounded`: `none`, `start`, `end`, or `both`: `0` at a bounded end, `\cdots` at the other (`\vdots` going up or down).
- `obj` and `d` (`maps` for `:ses`): the labels, as templates. `#` is the index, `#{#-1}` arithmetic on it (`+`, `-`, `*`, brackets), and after `_` or `^` an index longer than a character is braced. A comma list cycles, keeping one index for each cycle through it, as the long exact sequence does; commas inside brackets do not split. `\#` is TeX's own `#`. `d=none` leaves the arrows unlabelled.
- `aug`: an augmentation `\varepsilon` onto `aug` and then `0` where the indices start, as `:cc obj=P_# aug=M` gives `\cdots → P_1 → P_0 → M → 0`; a cochain complex starts `0 → M → I^0`.
- `step`: cells between terms. `wrap`: terms a row, the next row two cells on, with the arrow between rows routed through the row between.
- `:ses` takes `plain` for plain arrows, and `split` for a dashed section `s` back from `C` to `B`, curving over the epi, or under it with `under`; `:les` takes `cohom` for `H^n`, with the indices rising.

Two commands carry on from what is there:

- `:continue` (`:cont`) adds the next term after each selected cell at the end of a sequence (a cell with one arrow), along that arrow, with the indices stepped as they step along it: from `C_2 → C_1`, it adds `C_1 → C_0`, the arrow drawn and labelled as the last, `\partial_2` stepping to `\partial_1`. Where the labels do not step so, the new cell is empty, for Tab. Where two selected ends would go on to the same cell, it refuses.
- `:reindex K` moves every index of the selected labels by `K`: `C_{n+1}` to `C_{n+2}` for `K = 1`. An index is a subscript or superscript that is a number, a lower-case letter, or a multiple of one plus a number; anything else, as `X_\alpha` or `\Omega^n_X`, is left alone, as is one inside brackets (the `2` of `H^n(X;\mathbb{Z}_2)`, the `0` of `\pi_n(X,x_0)`) or a letter a script binds (the `i` of `\sum_{i=1}^n x_i`).

## Spectral sequences

`:spectral-sequence` (`:ss`) stamps a page at the focus point, which takes its top-left entry: a column of ticks for `q` on its left, a row of ticks for `p` below it, and axes between the ticks and the entries.
Its options, after the command, or on keys in its setup layer:

- `quadrant`: `1`, `2`, `3`, `4`, `half` (`p ≥ 0`), or `plane`, which give the ranges unless `p` and `q` do.
- `p` and `q`: the ranges, as `p=0..4`; in the layer, `p` and `q` reach a step further, and `P` and `Q` a step less.
- `page`: the page `r`, written as `#` in the entries.
- `grading`: `coh` (`E_r^{p,q}`), `hom` (`E^r_{p,q}`), or `adams` (`t-s` across, `s` up).
- `obj`: the entries, as a template with `#p` and `#q` for the bidegree, as `obj="E_#^{#p,#q}"`; without it, there are none, and the cells are made as they are typed or reached.
- `axes`: `edge`, or `none`.

The page leaves a frame behind, which the file keeps in a comment inside the environment, as `% sagitta: spectral-sequence grading=coh page=2 origin=4-2 p=0..4 q=0..3`:

- The mode line follows the file's name with the page and grading, as `[E_2 coh]`, and reads a cell's bidegree beside its position, as `(p,q)=(2,1)`, inside the ranges; with nothing selected, it reads the focus point's there, as `focus  (p,q)=(2,1)`.
- `; D`, or `:differential` (`:d`), draws the page's differential from each selected entry (inside the ranges: not the ticks), as Space draws an arrow: to the entry it reaches, made as `\bullet` if there is none, in the arrow preset, the targets selected with the arrows and queued for labels, and the focus point on the target, so that `D` again goes on from there. `:d r` draws `d_r` for another page, `label` writes `d_r` on the arrows, and `all` draws every `d_r` between entries already in the ranges, whatever is selected, making none and drawing none twice. `d_r` goes right `r` and down `r-1` cohomologically, left `r` and up `r-1` homologically, and left 1 and up `r` in an Adams chart. The key list shows `D` only while there is a spectral sequence. Clear takes the frame and axes with the cells, in one undo step.
- `:frame` shows the frame in a layer, with keys that change it, each a step to undo: `g` the grading, `r` and `R` the page, `a` the axes, `p`, `P`, `q`, and `Q` how far each range reaches, adding or taking away its last tick and moving the axis's name, and `x`, `X`, `y`, and `Y` where each range starts, the other axis's ticks moving with it (onto the lowest entries only where those are empty); the entries are left as they are.
- The axes run from the corner between the ticks and the entries to a little past the last tick on each, drawn from the tick nodes in TikZ (`execute at end picture`, with `calc`, which `quiver.sty` loads) and by the same rule on the canvas; deleting a tick at either end of a range drops them.
- `:diagonal n` (`:diag n`) selects the entries of total degree `n`, those with `p+q = n` in the ranges; `:diagonal n line` also draws that diagonal dashed through them, a little past each end (or takes it away, if it is drawn), kept in the frame as `lines=n` and drawn in TikZ beside the axes.
- The frame moves with its ticks, by the arrow keys, by dragging, or by opening a column or row before the page; opening one inside the page (or between its ticks and its entries) is refused, as are flipping and rotating it. Deleting the last cells takes the frame, as Clear does.
- A diagram keeps one spectral sequence, so a second `:ss` in it is refused: put the next page in a diagram of its own.
- A comment Sagitta cannot read (as `page=two`) is listed among the problems on opening, and left out; so are the axes, without their comment. An edit by hand inside Sagitta's `execute at end picture` is not kept: the axes are written afresh from the frame.
- amscd has no axes: switching to it drops the frame, after asking, and leaves the entries and ticks.

## The canvas

The canvas is drawn to look like the PDF: it lays the diagram out as tikz-cd does in a 10pt document, scaled so that labels are the size `ui.label_size` draws them.
A column is as wide as its widest label, with the padding tikz-cd puts round it, and a gap: a third more than the column separation, as tikz-cd draws it.
A row is the same, with the row separation as its gap.
An empty column or row between the diagram's outermost cells and checkpoints is the gap alone, as in the PDF, so a route through one has the short legs it will have there.
Beyond them, an empty column or row is as big as one holding a bullet, so the space around a diagram keeps still as it is drawn into, and only shrinks to the gap once the diagram reaches past it.
That change, and its reverse, take a moment rather than happening at once, so that what moves is seen to move, unless the system asks for reduced motion, or the diagram has more than 300 cells.
The separations are the export layer's (`w` and `h` there), so changing them redraws the canvas.
Curves, offsets, loops, and a route's rounding are drawn as the export writes them: a curve as quiver's `curve` cubic, and a loop as TikZ's `loop`, leaving and coming back to its cell's border at the angles, and with the distance, the export gives it.
An arrow's label is set in script style, as tikz-cd sets it, and placed by the box TeX sets it in, with tikz-cd's padding round it, against the middle of the line, as in the PDF.
A diagram in amscd is laid out as amscd sets it instead (see Formats): its columns and rows by the arrows between them as well as the objects in them, and each arrow, and its label, where amscd draws them.

## Settings

Settings live in `~/.config/sagitta/settings.json`, or in `%APPDATA%\sagitta\settings.json` on Windows.
In a browser they live in the browser's storage, for that browser alone.
Sagitta writes the file with every default the first time a setting changes, so the file shows each setting there is.
It can be edited by hand, and is read at startup.
A name that is not a setting, such as a typo or a newer version's setting, is reported, and kept in the file; one that earlier versions had is dropped.

The settings layer (`C-,`, or the mode line's `⚙`) lists them, each on a key, and shows every change straight away.
A setting that is on or off flips; a number is typed and set with RET, or stepped with the arrow keys or its `−` and `+` buttons; and `a` lists the presets for new arrows.
`e` opens the export layer, and `o` (or `:settings-file`) opens the file itself, for the settings the layer does not list.

`:set SETTING VALUE` names any setting and the value to give it, which the layer cannot: it steps numbers by key, and lists only some of them.
Tab lists the settings.
`true`, `on`, and `yes` all mean true, as `false`, `off`, and `no` mean false.
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
| `ui.dark_mode` | the system's | the grey canvas, which follows the system's colour scheme, and is left out of the file, until it is set |
| `ui.zoom` | `100` | the zoom the view starts at, and `reset-zoom` returns to, in percent (20 to 200) |
| `ui.label_size` | `26` | the size of labels, in pixels (8 to 72), which the whole diagram is drawn to the scale of (see The canvas) |
| `ui.which_key_compact` | `false` | list only the command layer's keys and their values, with what each does on hovering |
| `ui.hint_characters` | `"ASDF...7890"` | the characters of the codes `/` selects cells by, in order |

The export layer (`C-e`) toggles the `export.` settings, `:dark-mode` toggles dark mode, and the corners set `diagram.var_corner`.
A setting of the wrong kind or out of range is reported in the mode line and left at its default.
A file that is not valid JSON is reported, and is not overwritten until it is fixed.
