/// The diagram's file on disk, and the macros file that goes with it, by way of the desktop shell's
/// `window.host` (see `electron/`).
///
/// A `.tikzcd` file is the tikz-cd export verbatim, so that LaTeX can `\input` it. Its first line,
/// `%#q=...`, encodes the diagram exactly: opening a file trusts it when it still reproduces the
/// file's `tikzcd` environment, and otherwise parses the tikz-cd, so that edits made by hand win.
/// Files written by quiver (`% https://q.uiver.app/#q=...`) and the bare `% ...` form are read
/// just the same, and prefixing our own line with `https://q.uiver.app/` opens it in quiver.
///
/// Macros come from the nearest `macros.tex` in the diagram's directory or its ancestors, up to the
/// git repository's root and short of the home directory, unless one was chosen explicitly
/// (`--macros`, `f` in the macros layer, or `:macros FILE`), and are reloaded whenever the file
/// changes.
///
/// Dropping a file on the window opens it, or, for a `.tex` or `.sty` file, takes macros from it.
class DiagramFile {
    constructor(ui) {
        this.ui = ui;

        // The diagram's path, or `null` until it is first saved.
        this.path = null;

        // The directory of the last diagram opened or saved, which an untitled diagram keeps, so
        // that saving it (and relative paths) start where the last one was.
        this.base = null;

        // The text last read or written, against which unsaved changes are judged.
        this.saved = "";

        // Whether the diagram has unsaved changes, as last reported to the shell.
        this.dirty = false;

        // The macros file's path, or `null` if there is none.
        this.macros = null;

        // Whether the macros file was chosen explicitly, rather than found beside the diagram.
        this.chosen = false;
    }

    async initialise() {
        host.on_changed((file) => {
            if (file === this.macros) {
                this.load_macros();
            }
        });
        host.on_save_and_close(async () => {
            if (await this.save()) {
                host.close();
            }
        });
        document.addEventListener("dragover", (event) => event.preventDefault());
        document.addEventListener("drop", (event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            const path = file === undefined ? "" : host.path_of(file);
            if (path === "") {
                return;
            }
            if (/\.(tex|sty)$/.test(path)) {
                this.use_macros(path, true);
            } else {
                this.open(path);
            }
        });

        const { diagram, macros } = await host.arguments();
        if (macros !== null) {
            await this.use_macros(macros, true);
        }
        if (diagram !== null) {
            await this.open(diagram, true);
        } else {
            this.mark_saved();
        }
    }

    /// The diagram's file name, for display.
    name() {
        return this.path === null ? "untitled" : DiagramFile.basename(this.path);
    }

    /// The directory relative paths are resolved against: the diagram's, or the last one's.
    directory() {
        return this.path === null ? this.base : DiagramFile.dirname(this.path);
    }

    /// The diagram as it would be saved.
    text() {
        const ui = this.ui;
        return `${ui.quiver.export("tikz-cd", ui.settings, ui.options(), ui.definitions()).data}\n`;
    }

    mark_saved(text = this.text()) {
        this.saved = text;
        // The mode line shows whether there are unsaved changes, and calls `update`.
        this.ui.mode_line.update(this.ui);
    }

    /// Recompute whether there are unsaved changes, telling the shell (which asks before closing)
    /// and the window title.
    update() {
        const dirty = this.text() !== this.saved;
        if (dirty !== this.dirty) {
            this.dirty = dirty;
            host.set_dirty(dirty);
        }
        document.title = `${this.name()}${dirty ? " +" : ""} - Sagitta`;
    }

    /// Open the diagram at `path` (asking for one if `null`), which need not exist yet. Unless
    /// `force`, asks before discarding unsaved changes.
    async open(path = null, force = false) {
        try {
            path = path === null
                ? await host.open_dialog("diagram", this.directory())
                : await host.resolve(this.directory(), path);
            if (path === null
                || !force && this.dirty && !await host.confirm(`Discard the changes to ${this.name()}?`)
            ) {
                return;
            }
            const text = await host.read(path);
            this.path = path;
            this.base = this.directory();
            if (!this.chosen) {
                await this.use_macros(await host.find_up(this.directory(), "macros.tex"), false,
                    false);
            }
            this.ui.reset();
            DiagramFile.restore_sep(this.ui, text ?? "");
            this.mark_saved();
            if (text === null) {
                this.ui.mode_line.flash(`new file ${this.name()}${this.describe_macros()}`);
            } else {
                this.load(text);
            }
        } catch (error) {
            UI.display_error(`Could not open ${path}: ${error.message}`);
        }
    }

    /// Start an untitled diagram, keeping the macros, asking before discarding unsaved changes.
    async new_diagram() {
        if (this.dirty && !await host.confirm(`Discard the changes to ${this.name()}?`)) {
            return;
        }
        this.path = null;
        this.ui.reset();
        DiagramFile.restore_sep(this.ui, "");
        this.mark_saved();
        this.ui.mode_line.flash("new diagram");
    }

    /// Load the diagram from the contents of a `.tikzcd` file, into an empty quiver (whose
    /// separations `restore_sep` has already set).
    load(text) {
        const ui = this.ui;
        // `%#q=...`, quiver's `% https://q.uiver.app/#q=...`, or a bare `% ...`, which must be
        // the whole line, and long enough not to be an ordinary comment.
        const encoding = text.match(/^%(?:.*#q=|\s*)([A-Za-z0-9+/=]{8,})\s*$/m);
        if (encoding !== null) {
            try {
                QuiverImportExport.base64.import(ui, encoding[1]);
                if (DiagramFile.body(this.text()) === DiagramFile.body(text)) {
                    // Store what we would write, so that the file is only rewritten after a change.
                    this.mark_saved();
                    ui.mode_line.flash(`opened ${this.name()}${this.describe_macros()}`);
                    return;
                }
            } catch (_) {
                // Fall back on the tikz-cd, below.
            }
            ui.reset();
        }
        // Parse errors do not throw: they are reported in `diagnostics`.
        const { diagnostics } = ui.quiver.import(ui, "tikz-cd", text, ui.settings);
        this.mark_saved();
        ui.keymap.layers.import.settle(text, new Set(ui.quiver.all_cells()), diagnostics, `opened ${
            this.name()
        } (${encoding === null ? "parsed" : "edited by hand, so parsed"})${this.describe_macros()}`);
    }

    /// Save the diagram to `path`, or to its own path, asking for one if it has none. Returns
    /// whether the diagram was saved.
    async save(path = this.path) {
        try {
            path = path === null
                ? await host.save_dialog(this.path
                    ?? (this.base === null ? "diagram.tikzcd" : `${this.base}/diagram.tikzcd`))
                : await host.resolve(this.directory(), path);
            if (path === null) {
                return false;
            }
            const text = this.text();
            await host.write(path, text);
            const moved = DiagramFile.dirname(path) !== this.directory();
            this.path = path;
            this.base = this.directory();
            this.mark_saved(text);
            this.ui.mode_line.flash(`wrote ${this.name()}`);
            // A diagram saved somewhere new takes that project's macros.
            if (moved && !this.chosen) {
                await this.use_macros(await host.find_up(this.directory(), "macros.tex"));
            }
            return true;
        } catch (error) {
            UI.display_error(`Could not save ${path}: ${error.message}`);
            return false;
        }
    }

    /// Ask where to save the diagram, then save it there.
    save_as() {
        return this.save(null);
    }

    /// Take macros from `path` (resolved against the diagram's directory; asking for one if
    /// `undefined`), following it for changes, or define none if `null`. `chosen` marks the file as
    /// chosen explicitly, so that opening another diagram keeps it. Unless `announce`, the caller
    /// reports what was loaded (see `describe_macros`).
    async use_macros(path = undefined, chosen = false, announce = true) {
        if (path === undefined) {
            path = await host.open_dialog("macros", this.directory());
            if (path === null) {
                return;
            }
        } else if (path !== null) {
            path = await host.resolve(this.directory(), path);
        }
        if (this.macros !== null) {
            host.unwatch(this.macros);
        }
        this.macros = path;
        this.chosen = chosen;
        if (path === null) {
            this.ui.load_macros("");
            return;
        }
        host.watch(path);
        await this.load_macros(announce);
    }

    /// Reload the macros file, flashing what it defines if `announce`.
    async load_macros(announce = true) {
        const ui = this.ui;
        if (this.macros === null) {
            UI.display_error("There is no macros file.");
            return;
        }
        const text = await host.read(this.macros);
        if (text === null) {
            UI.display_error(`${this.macros} does not exist.`);
            return;
        }
        ui.load_macros(text);
        if (announce) {
            ui.mode_line.flash(this.describe_macros().slice(2));
        }
    }

    /// What the macros file defines, to follow another message, e.g. `; macros.tex: 3 macros and
    /// 1 colour`.
    describe_macros() {
        return this.macros === null
            ? "; no macros.tex"
            : `; ${DiagramFile.basename(this.macros)}: ${
                Layer.Macros.describe_definitions(this.ui)}`;
    }

    /// The contents of the `tikzcd` environment in `text`, without its options (which carry the
    /// separations and export settings, rather than the diagram) or whitespace, or `null` if there
    /// is none.
    static body(text) {
        const match = text.match(/\\begin\{tikzcd\}(?:\[[^\]\n]*\])?([\s\S]*?)\\end\{tikzcd\}/);
        return match === null ? null : match[1].replace(/\s+/g, "");
    }

    /// Set the column and row separations from the `tikzcd` environment's options in `text`, which
    /// the encoding does not record.
    static restore_sep(ui, text) {
        const sep = { column: DiagramFile.SEPS.normal, row: DiagramFile.SEPS.normal };
        const options = text.match(/\\begin\{tikzcd\}\[([^\]\n]*)\]/);
        for (const option of options === null ? [] : options[1].split(",")) {
            const match = option.trim().match(/^(column |row )?sep\s*=\s*(\w+|[\d.]+em)$/);
            if (match === null) {
                continue;
            }
            const value = DiagramFile.SEPS[match[2]] ?? parseFloat(match[2]);
            if (Number.isNaN(value)) {
                continue;
            }
            for (const axis of match[1] === undefined ? ["column", "row"] : [match[1].trim()]) {
                sep[axis] = value;
            }
        }
        ui.sep = sep;
    }

    static basename(path) {
        return path.slice(path.lastIndexOf("/") + 1);
    }

    static dirname(path) {
        return path.slice(0, path.lastIndexOf("/")) || "/";
    }
}

/// tikz-cd's named separations, in `em` (as `QuiverImportExport.tikz_cd` writes them).
DiagramFile.SEPS = {
    tiny: 0.45,
    small: 0.9,
    scriptsize: 1.35,
    normal: 1.8,
    large: 2.7,
    huge: 3.6,
};
