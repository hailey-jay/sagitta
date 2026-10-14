# Contributing

## Reporting a bug

Open work is in the issue tracker.
To report a bug, open an issue with:

- your distribution, and the Electron the launcher picked (`sagitta --version`, and the first of `$SAGITTA_ELECTRON`, `electron43`, `electron`, and `node_modules` that you have);
- what you did, what you expected, and what happened, including any message in the mode line;
- the `.tikzcd` file, and the `macros.tex` beside it if labels are involved.

A diagram that does not round-trip (opening and saving changes it) is a bug worth reporting even if nothing else goes wrong.

## Source

There is no build step.
`index.html` loads the scripts in `src/` in dependency order, each after what it uses:

- `katex.js`: KaTeX, vendored.
- `ds.js`, `dom.js`: points, colours, and DOM wrappers.
- `grid.js`: column and row sizes, and positions to and from pixels.
- `curve.js`, `arrow.js`, `constants.js`: curves, drawing arrows, and the editor's parameters.
- `parser.js`, `quiver.js`: reading and writing tikz-cd, and the diagram's cells and dependencies.
- `settings.js`, `macros.js`, `delimiters.js`: saved settings, `macros.tex`, and delimiter pairing.
- `history.js`, `colours.js`, `cell.js`, `modes.js`, `options.js`: undo, the colour picker, vertices and edges, the UI's modes, and the selection's arrow options.
- `modeline.js`: the mode line and the named actions.
- `layers.js`, `keymap.js`, `bindings.js`, `commands.js`, `prompt.js`, `keys.js`: the keyboard, and the named bindings the keys file rebinds.
- `pointer.js`: the pointer and the scroll wheel.
- `file.js`: the diagram's file and its macros file.
- `ui.js`, `main.js`: the `UI` that holds the rest, and the startup.

`electron/` is the desktop shell, which the page reaches through `window.host`.
`web/host.js` is the same `window.host` for a browser, and does nothing under the shell, which defines it first.
To try the page in a browser, run `npm run web` and open <http://127.0.0.1:8000>.
To publish it, serve `index.html`, `main.css`, `katex.css`, `icon.svg`, `icon.png`, `manifest.webmanifest`, `service-worker.js`, `src/`, `fonts/`, `icons/`, and `web/` from one directory of a static host.
`service-worker.js` keeps what the page fetches, for opening without a network, and must sit beside `index.html` to cover it.
`sagitta` is the launcher, which checks the arguments and picks an Electron.

Match the code around a change: `///` doc comments on functions, `//` comments in full sentences, snake_case names, and lines of about 100 characters at most.

## Tests

```
npm test
```

This runs both suites, the fast one first.

```
npm run test:fast
```

The fast suite (`node tests/tikzcd.js`) is the `.tikzcd` round trip, the encoded first line, the parser, the export settings, and the command line's settings, in about a second.
It loads the sources that touch the diagram into a `vm` over a stub DOM (`tests/stub.js`), so it needs neither Electron nor a display, and the checks are in `tests/tikzcd-checks.js`.
A parser or export regression shows here before the slow suite starts.

```
python3 -m pytest tests
```

The full suite (install pytest first) runs the app headless and drives it with trusted key and mouse events (`tests/sagitta/`), one scenario per process, with HOME pointed at a temporary directory.
A scenario in `tests/sagitta/scenarios.js` does something in the app and returns what to check, and a test in `tests/test_sagitta.py` checks it.
It takes a few minutes.
Both run on GitHub for every push and pull request.

A change in behaviour comes with a test, and a new key, command, or setting with a line in `docs/sagitta.md`.
Anything that can be checked without the app belongs in the fast suite.

## Tables and readers

Two files hold tables and nothing else, and the code that reads them names nothing in them:

- `src/schema.js` is every setting and what each may hold. `src/settings.js` reads, writes, parses, checks, and reports without naming a setting: it takes the schema in its constructor.
- `Bindings.TABLE`, at the foot of `src/bindings.js`, is what there is to bind and its default keys. `Bindings.resolve` takes it as an argument, so the notation, the overriding, and the problem reporting know nothing of this diagram.

Adding a setting or a binding means editing the table, not the reader.
The fast suite builds each reader over an invented table and checks that its words come back, which is what keeps the two apart.

## Releasing

1. Set `version` in `package.json`, and add a `## <version>` section at the top of `CHANGELOG.md` saying what changed.
2. Commit both, then tag and push the tag:

   ```
   git tag v<version>
   git push origin v<version>
   ```

`.github/workflows/release.yml` checks that the tag matches `package.json`, runs the tests, builds the AppImage, and publishes a release with that section of the changelog as its notes.
To build the AppImage locally, run `npm run dist`; it lands in `dist/`.
