# Contributing

## Reporting a bug

Open an issue with:

- your distribution, and the Electron the launcher picked (`sagitta --version`, and the first of
  `$SAGITTA_ELECTRON`, `electron43`, `electron`, and `node_modules` that you have);
- what you did, what you expected, and what happened, including any message in the mode line;
- the `.tikzcd` file, and the `macros.tex` beside it if labels are involved.

A diagram that does not round-trip (opening and saving changes it) is a bug worth reporting even
if nothing else goes wrong.

## Source

There is no build step. `index.html` loads the scripts in `src/` in dependency order, each after
what it uses:

- `katex.js`: KaTeX, vendored.
- `ds.js`, `dom.js`: points, colours, and DOM wrappers.
- `grid.js`: column and row sizes, and positions to and from pixels.
- `curve.js`, `arrow.js`, `constants.js`: curves, drawing arrows, and the editor's parameters.
- `parser.js`, `quiver.js`: reading and writing tikz-cd, and the diagram's cells and dependencies.
- `settings.js`, `macros.js`, `delimiters.js`: saved settings, `macros.tex`, and delimiter pairing.
- `history.js`, `colours.js`, `cell.js`, `modes.js`, `options.js`: undo, the colour picker,
  vertices and edges, the UI's modes, and the selection's arrow options.
- `modeline.js`: the mode line and the named actions.
- `layers.js`, `keymap.js`, `bindings.js`, `commands.js`, `prompt.js`, `keys.js`: the keyboard,
  and the named bindings the keys file rebinds.
- `pointer.js`: the pointer and the scroll wheel.
- `file.js`: the diagram's file and its macros file.
- `ui.js`, `main.js`: the `UI` that holds the rest, and the startup.

`electron/` is the desktop shell, which the page reaches through `window.host`. `sagitta` is the
launcher, which checks the arguments and picks an Electron.

Match the code around a change: `///` doc comments on functions, `//` comments in full
sentences, snake_case names, and lines of about 100 characters at most.

## Tests

```
npm test
```

This runs `python3 -m pytest tests` (install pytest first). It runs the app headless and drives it
with trusted key and mouse events (`tests/sagitta/`), one scenario per process, with HOME pointed
at a temporary directory. A scenario in `tests/sagitta/scenarios.js` does something in the app
and returns what to check, and a test in `tests/test_sagitta.py` checks it. The suite takes a few
minutes, and runs on GitHub for every push and pull request.

A change in behaviour comes with a test, and a new key, command, or setting with a line in
`docs/sagitta.md`.

## Releasing

1. Set `version` in `package.json`, and add a `## <version>` section at the top of
   `CHANGELOG.md` saying what changed.
2. Commit both, then tag and push the tag:

   ```
   git tag v<version>
   git push origin v<version>
   ```

`.github/workflows/release.yml` checks that the tag matches `package.json`, runs the tests, builds
the AppImage, and publishes a release with that section of the changelog as its notes. To build
the AppImage locally, run `npm run dist`; it lands in `dist/`.
