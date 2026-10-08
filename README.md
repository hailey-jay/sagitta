# Sagitta

A keyboard-driven editor for tikz-cd commutative diagrams, grown from [quiver](https://q.uiver.app) and run as a desktop app on Electron.
It edits `.tikzcd` files that a paper `\input`s directly.

Status: Sagitta runs only on Linux for now.
It is in daily use there, but the file format and keys may still change before 1.0.

## Install

### AppImage

Download `Sagitta-<version>-x86_64.AppImage` from the latest release, then:

```
chmod +x Sagitta-*.AppImage
./Sagitta-*.AppImage
```

It bundles Electron and needs only FUSE 3 (`fusermount3`), which most distributions install.
Older AppImages need FUSE 2 instead.
It takes the same options as `sagitta`, but does not register `.tikzcd` files with the desktop.
An AppImage manager such as Gear Lever or AppImageLauncher adds it to the application menu.

On Ubuntu 24.04 and later, AppArmor stops Chromium's sandbox inside an AppImage, and Sagitta exits at once.
Run it with `-- --no-sandbox` to start it without the sandbox.
Sagitta loads only its own pages, so the sandbox guards little here.

### From source

You need git and Node.js (for npm).
Clone the repository and let npm fetch Electron into `node_modules`:

```
git clone <this repository> sagitta
cd sagitta
npm install
./sagitta
```

There is no build step: KaTeX and its fonts are vendored.
To put `sagitta` on PATH and open `.tikzcd` files from the file manager:

```
./install.sh [--bin=DIR] [--docs=DIR] [--dry-run]
```

This links the launcher into `--bin` (default `~/.local/bin`) and the icon into the hicolor theme.
It also renders `sagitta.desktop` and registers `text/x-tikzcd`, so `.tikzcd` files open in Sagitta.
`--docs` also links the manual into a directory of your choice.

If your distribution packages Electron 43 (`electron43` on Arch), the launcher uses that instead of the copy in `node_modules`, and you can skip `npm install`.
The launcher looks at `$SAGITTA_ELECTRON` first, then `electron43` and `electron` on PATH, then the local copy.

## Usage

```
sagitta [--macros FILE] [--devtools] [DIAGRAM.tikzcd] [-- SWITCHES]
```

`sagitta --help` explains the options.
`DIAGRAM` need not exist yet.

Typing labels the cell under the cursor, spreadsheet-style.
The `;` key opens the command layer, `:` the command line, and `C-/` the help, which lists every key.
If you mean to put a `;` or `:` as the first character in a cell, `<ret>` focuses the text interface.
With a mouse, right-click or the `; commands` button opens the command layer, and clicking a line of its list runs it.
`C-s` saves.

### In a paper

`examples/` contains a diagram, its macros, and a paper:

```
examples/
├── macros.tex        \newcommand{\pr}{\mathrm{pr}}
├── pullback.tikzcd   the diagram, as Sagitta saves it
└── paper.tex         \usepackage{quiver}, \input{macros}, \input{pullback.tikzcd}
```

Open the diagram with `sagitta examples/pullback.tikzcd`.
Its labels render with `examples/macros.tex`, since Sagitta uses the nearest `macros.tex` at or above the diagram, stopping at the git repository's root.
Sagitta reloads that file when it changes.

A paper needs the `quiver.sty` package, which loads tikz-cd and defines the arrow styles that Sagitta's export uses (curves, shortened arrows, and some heads and tails).
It is distributed on CTAN and in TeX Live, so `\usepackage{quiver}` usually works as is.
If not, copy [`quiver.sty`](https://github.com/varkor/quiver/blob/master/package/quiver.sty) beside the paper.

A `.tikzcd` file is the export verbatim, so `\input{pullback.tikzcd}` typesets it, centred on its own line.
Its first line, `%#q=...`, is a comment holding the diagram exactly.
As Sagitta is a fork of quiver, this hash is the same.
Navigating to `https://q.uiver.com/#q=...` yields the same diagram.
Hand edits to the rest of the file still win: Sagitta reads the tikz-cd whenever that line no longer matches it.

## Documentation

- `docs/sagitta.md`: the manual.
  It covers the file format, macros, keys, the keys file, and settings.
- `CHANGELOG.md`: what each release changed.
- `CONTRIBUTING.md`: the source, the tests, and how to report a bug.
- `LICENSE`, `NOTICE`: the licence, and quiver's and KaTeX's notices.

## Licence

Sagitta is free software, under the GNU General Public License, version 3 or later (`LICENSE`).
It is a fork of [quiver](https://github.com/varkor/quiver) and bundles [KaTeX](https://katex.org), both MIT-licensed; their notices are in `NOTICE`.
