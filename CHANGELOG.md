# Changelog

## 0.1.0

The first public release. Linux only, as an AppImage or from source.

- Edits `.tikzcd` files that a paper `\input`s directly, with quiver's encoding on the first line
  and a byte-for-byte round trip.
- Keyboard-driven: spreadsheet-style labels, the `;` command layer, the `:` command line, `/`
  search by label or code, and `C-/` help.
- Usable by mouse: right-click or the mode line's `; commands` button opens the command layer,
  whose lines are clickable, and the help lists the mouse's gestures.
- Labels render with the nearest `macros.tex`, reloaded when it changes.
- A keys file (`~/.config/sagitta/keys`) rebinds keys, and `settings.json` holds the settings,
  which the settings layer (`C-,`) changes.
- The command layer lists its keys after a short wait (`?` at once), or in a compact form.
