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

## Macros

Labels render with the nearest `macros.tex`, searched from the diagram's directory upward, stopping at the git repository's root and never reaching the home directory.
There are no global macros, by design.
`--macros FILE`, `f` in the macros layer, or `:macros FILE` choose another file.
The macros reload whenever the file changes.

## Keys

Typing edits the label of the targeted cell, spreadsheet-style, except that `(`, `[`, `{`, and `|` wrap the label (or the selected part of it) instead of replacing it.
Elsewhere they bring their closing delimiter, as in most editors, unless it is already next; typing the closing one steps over it, and Backspace in an empty pair deletes both.
`\{` and `\|` pair the same way, and `\langle`, `\lvert`, `\lVert`, `\lceil`, and `\lfloor` once something other than a letter follows them.
After `\left`, the closing delimiter comes with `\right`.
The commands live one key away:

- `;` the command layer: arrow styles and label alignment (a key, then the choice's own key, as listed), sliders (a key, then a number and RET), and presets.
  Its keys are listed once it has waited 300ms for one, so a key typed straight after `;` does not flash the list up, and `?` shows or hides the list at once.
  Its capitals act on the label, and curve sets a loop's radius instead.
- `:` the command line: named commands, with Tab completion.
- `/` (or `C-f`) search: selects the cells whose label is (or else contains) what is typed, or else the cells whose codes are typed.
  Each vertex has a code of one character, given out row by row (`asdfghjkl`, `zxcvbnm`, `qwertyuiop`, then the digits), and two once those run out; removing a vertex frees its code.
  An arrow's code is its source's then its target's, so the arrow from `A` to `S` is `AS`, and a second one `AS2`.
  An arrow whose code would be longer than three characters, as between arrows, takes one of its own, as a vertex does.
- `C-/` (or `<f1>`) help, `C-e` export, `C-i` import (paste tikz-cd), `C-m` macros (paste definitions), `C-,` settings, and `C-s` save.
- `:dark-mode`: a grey canvas, with the default colour drawn in white.
  Other colours are drawn exactly, and nothing saved changes.
- `C-arrows` move the selection; on arrows alone they bend or shift them, and on loops alone they resize or turn them.

The mouse works too.
Click a cell to select it, and again to edit its label; click an empty space twice for a new cell; drag from a cell to draw an arrow, by the edge of its space to move it, and an arrow's end to reconnect it.
Right-click, or the `; commands` button in the mode line, opens the command layer, listing its keys at once, and clicking a line of its list presses that key; the sliders have `−` and `+` buttons.
The mode line's `⚙` button opens the settings.
The help lists all this under Mouse.
While the diagram is empty, a line of tips runs along the top.

## The keys file

`~/.config/sagitta/keys`, if it exists, rebinds keys.
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
  Printable keys alone would type, so they need `;` or `C-`.
- RET, TAB, SPC, ESC, DEL, and the arrows cannot be rebound.

A key that a line binds is taken from whatever had it by default.
A name alone unbinds it, and `unbind` frees keys from whatever has them.
A line with a problem is skipped whole, and the mode line reports the first problem and how many others there are.
Choosing a slider, a component, or `align` with a chord enters the command layer, which then takes the number, or the key choosing a style or an alignment.

The names and their defaults:

| Names | Defaults |
|---|---|
| `import`, `export`, `macros` | `C-i`, `C-e`, `C-m` |
| `save`, `save-as`, `open`, `new` | `C-s`, `C-S-s`, `C-o`, `C-n` |
| `undo`, `redo` | `C-z`, `C-S-z` |
| `select-all`, `select-connected`, `deselect-all` | `C-a`, `C-S-c`, `C-S-a` |
| `copy`, `cut`, `paste` | `C-c`, `C-x`, `C-v` |
| `delete`, `clear` | `<delete>`, none |
| `reverse`, `flip`, `flip-labels` | `; r` `C-r`, `; f`, none |
| `search` | `C-f` (and `/`, which cannot be rebound) |
| `flip-hor`, `flip-ver`, `rotate` | none |
| `centre-view`, `hide-grid` | `; z`, `; #` |
| `zoom-out`, `zoom-in`, `reset-zoom` | `C--`, `C-=`, `C-0` |
| `dark-mode`, `hide-mode-line`, `shortcuts`, `settings` | none, `C-\`, `C-/` `<f1>`, `C-,` |
| `level`, `curve`, `offset`, `radius`, `length`, `position` | `; n`, `; b` (on loops alone, the radius), `; o`, none, `; l`, `; P` |
| `tail`, `body`, `head` | `; t`, `; d`, `; h` |
| `arrow`, `adjunction`, `corner` | `; a`, `; j`, `; p` |
| `align`, then `l`, `r`, `c`, or `o` for left, right, centre, or over | `; A` |
| `align-left`, `align-centre`, `align-over` | none |
| `plain`, `equals`, `inclusion`, `mono`, `epi` | `; !`, `; =`, `; (`, `; <`, `; >` |
| `maps-to`, `dashed`, `dotted`, `squiggly` | `; \|`, `; -`, none, `; ~` |
| `align-source`, `align-target` | `; [`, `; ]` |
| `colour`, `label-colour` | `; c`, `; C` |
| `select-at-focus`, `toggle-selection`, `create-arrows` | none (`S-SPC` does it), `; s`, `; e` |
| `change-source`, `change-target` | `; ,`, `; .` |

Any other command (Tab at `:` lists them) can be bound too, and its keys run it with no arguments.

## Settings

Settings live in `~/.config/sagitta/settings.json`, written with every default the first time a setting changes, so the file shows each setting there is.
It can be edited by hand, and is read at startup.

The settings layer (`C-,`, or the mode line's `⚙`) lists them, each on a key, and shows every change straight away.
A setting that is on or off flips; a number is typed and set with RET, or stepped with the arrow keys or its `−` and `+` buttons; and `a` lists the presets for new arrows.
`e` opens the export layer, and `o` opens the file itself, for the settings the layer does not list.

| Setting | Default | |
|---|---|---|
| `export.centre_diagram` | `true` | wrap the export in `\[ \]` |
| `export.ampersand_replacement` | `false` | separate columns with `\&` |
| `export.cramped` | `false` | export with `cramped` |
| `export.standalone` | `false` | wrap the export in a standalone document |
| `diagram.var_corner` | `false` | the corner `; p` gives first, which follows the last one used |
| `diagram.arrow_preset` | `"plain"` | the preset new arrows take, from `plain`, `equals`, `inclusion`, `mono`, `epi`, `maps-to`, `dashed`, `dotted`, and `squiggly` |
| `ui.dark_mode` | `false` | the grey canvas |
| `ui.zoom` | `100` | the zoom the view starts at, and `reset-zoom` returns to, in percent (20 to 200) |
| `ui.cell_size` | `128` | the size of an empty column or row, in pixels (48 to 512) |
| `ui.label_size` | `26` | the size of labels, in pixels (8 to 72) |
| `ui.which_key_delay` | `300` | how long `;` waits for a key before listing its keys, in milliseconds (0 to 5000), or `null` for only on `?` |
| `ui.which_key_compact` | `false` | list only the command layer's keys and their values, with what each does on hovering |
| `ui.hint_characters` | `"ASDF...7890"` | the characters of the codes `/` selects cells by, in order |

The export layer (`C-e`) toggles the `export.` settings, `:dark-mode` toggles dark mode, and the corners set `diagram.var_corner`.
A setting of the wrong kind or out of range is reported in the mode line and left at its default.
A file that is not valid JSON is reported, and is not overwritten until it is fixed.
