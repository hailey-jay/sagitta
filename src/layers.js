/// The layers that take over the keys: import, macros, help, export, settings, and colour. While one is
/// active, `Keymap.intercept` hands it every plain key press, the key list shows its `groups`, and
/// the mode line shows what it `describe`s. Only one is active at a time (see `Keymap.settle`).
class Layer {
    constructor(keymap) {
        this.keymap = keymap;
        this.ui = keymap.ui;
    }

    /// Whether this is the layer the keys go to.
    get active() {
        return this.keymap.layer === this;
    }

    /// Enter the layer, leaving whatever else had the keys.
    enter() {
        this.keymap.enter_layer(this);
    }

    /// Leave the layer.
    leave() {
        this.keymap.leave_layer(this);
    }

    /// Enter the layer, or leave it if it is active.
    toggle() {
        if (this.active) {
            this.leave();
        } else {
            this.enter();
        }
    }

    /// Called as the layer is entered, to reset its state.
    entered() {}

    /// Whether clicking a line of the key list presses its key.
    get clickable() {
        return true;
    }

    /// The layer's name and what it is working on, for the mode line: `[name, detail]`.
    describe() {
        return ["", null];
    }

    /// The layer's bindings and what it has to show, as groups replacing the key list:
    /// `[[title, [[key, description, current, value, swatch]]]]` (see `Keymap.update_which_key`).
    groups() {
        return [];
    }

    /// Handle a key press. Returns whether it was consumed.
    intercept(event) {
        return false;
    }
}

/// The import layer (`C-i`): pasting tikz-cd replaces the diagram, as one undo step, and lists any
/// problems parsing it.
Layer.Import = class extends Layer {
    constructor(keymap) {
        super(keymap);

        // What the last import came to (`{ text, objects, diagnostics }`), or `null`.
        this.result = null;
    }

    describe() {
        return ["IMPORT", "tikz-cd"];
    }

    entered() {
        this.result = null;
    }

    /// Replace the diagram with the tikz-cd `text`, as one undo step. Leaves the layer if the
    /// import had no problems, and otherwise lists them.
    paste(text) {
        const ui = this.ui;
        if (text.trim() === "") {
            UI.display_error("The clipboard is empty.");
            return;
        }
        const since = ui.history.present;
        ui.deselect();
        const existing = ui.quiver.all_cells();
        if (existing.length > 0) {
            ui.history.add(ui, [{ kind: "delete", cells: new Set(existing) }], true);
        }
        // Parse errors do not throw: they are reported in `diagnostics`.
        const { diagnostics } = ui.quiver.import(ui, "tikz-cd", text, ui.settings);
        const cells = new Set(ui.quiver.all_cells());
        if (cells.size > 0) {
            ui.history.add(ui, [{ kind: "create", cells }]);
        }
        ui.history.squash(since);
        ui.history.permanentise();
        this.settle(text, cells, diagnostics);
    }

    /// Finish importing `cells` from the tikz-cd `text`: flash `message` if parsing had no
    /// problems, and otherwise list them in the layer, entering it if `message` is given.
    settle(text, cells, diagnostics, message = null) {
        const ui = this.ui;
        // Some diagnostics (e.g. for `shorten`, which depends on the lengths of edges) are only
        // generated after rendering, so we wait before reporting them.
        delay(() => {
            // Edges are shortened after initial rendering, so we may need to rerender them.
            for (const cell of cells) {
                if (cell.is_edge()
                    && (cell.options.shorten.source > 0 || cell.options.shorten.target > 0)
                ) {
                    cell.render(ui);
                }
            }
            const objects = `${cells.size} object${cells.size === 1 ? "" : "s"}`;
            if (diagnostics.length === 0) {
                if (this.active) {
                    this.leave();
                }
                ui.mode_line.flash(message ?? `imported ${objects}`);
                return;
            }
            if (message !== null && !this.active) {
                this.enter();
            }
            if (this.active) {
                this.result = { text, objects, diagnostics };
                this.keymap.render();
            }
        });
    }

    /// The layer's bindings, and the last import's problems, each with its line and column.
    groups() {
        const { result } = this;
        const groups = [["Import tikz-cd", [
            ["C-v", "paste"],
            ...(result !== null && this.keymap.combinations("undo").length > 0
                ? [[this.keymap.describe_name("undo"), "undo the import"]] : []),
            ["RET ; ESC", "leave"],
        ]]];
        if (result !== null) {
            const errors = result.diagnostics.filter((d) => d instanceof Parser.Error);
            groups[0][1].unshift(["", errors.length > 0 ? "failed partway" : "imported", false,
                result.objects]);
            for (const [title, list] of [
                ["Errors", errors],
                ["Warnings", result.diagnostics.filter((d) => d instanceof Parser.Warning)],
            ]) {
                if (list.length > 0) {
                    groups.push([title, list.map(({ message, range }) => [
                        range !== null
                            ? Layer.Import.describe_position(result.text, range.start) : "",
                        Layer.Import.describe_message(message),
                    ])]);
                }
            }
        }
        return groups;
    }

    /// The line and column of `index` in `text`, e.g. `3:12`.
    static describe_position(text, index) {
        const before = text.slice(0, index);
        return `${before.split("\n").length}:${index - before.lastIndexOf("\n")}`;
    }

    /// A diagnostic's message as text. Messages are strings, or lists of strings and elements.
    static describe_message(message) {
        return (Array.isArray(message) ? message : [message]).map((part) => {
            return part instanceof DOM.Element ? part.element.textContent : `${part}`;
        }).join("");
    }

    intercept(event) {
        const key = event.key;
        switch (key) {
            case "Escape":
                // As elsewhere, Escape first dismisses an error banner.
                if (!UI.dismiss_error()) {
                    this.leave();
                }
                return true;
            case "Enter":
            case ";":
                this.leave();
                return true;
        }
        // Arrow keys still move the focus point; every other key belongs to the layer.
        return !key.startsWith("Arrow");
    }
};

/// The macros layer (`C-m`): pasting LaTeX definitions replaces the macros and colours, which the
/// layer lists; `f` follows another macros file (see `DiagramFile`), and `r` reloads it.
Layer.Macros = class extends Layer {
    describe() {
        return ["MACROS", "LaTeX"];
    }

    /// Replace the macros and colours with the LaTeX definitions in `text`, leaving the layer.
    /// Text without any definitions we recognise leaves the current ones in place.
    paste(text) {
        const ui = this.ui;
        const { macros, colours } = ui;
        ui.load_macros(text);
        if (ui.macros.size === 0 && ui.colours.size === 0 && macros.size + colours.size > 0) {
            ui.macros = macros;
            ui.colours = colours;
            ui.render_maths(...ui.quiver.all_cells());
            ui.colour_picker.update_latex_colours(ui);
            UI.display_error("No definitions found: expected \\newcommand, \\DeclareMathOperator, "
                + "or \\definecolor lines.");
            return;
        }
        if (this.active) {
            this.leave();
        }
        ui.mode_line.flash(`loaded ${Layer.Macros.describe_definitions(ui)}`);
    }

    /// How many macros and colours are defined, e.g. `3 macros and 1 colour`.
    static describe_definitions(ui) {
        const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
        return `${count(ui.macros.size, "macro")} and ${count(ui.colours.size, "colour")}`;
    }

    /// The layer's bindings, and the macros and colours defined.
    groups() {
        const ui = this.ui;
        const { macros } = ui.file;
        const groups = [["Macros", [
            ["", "defined", false, Layer.Macros.describe_definitions(ui)],
            ["", "from", false, macros === null ? "nowhere" : macros],
            ["C-v", "paste definitions, replacing these"],
            ["f", "follow another file"],
            ...(macros !== null ? [["r", `reload ${DiagramFile.basename(macros)}`]] : []),
            ["RET ; ESC", "leave"],
        ]]];
        if (ui.macros.size > 0) {
            // `arity` is the digit parsed from the definition, if any.
            groups.push(["Commands", Array.from(ui.macros, ([name, { arity }]) => [
                "", name, false, Number(arity) > 0 ? `${arity} arg${arity == 1 ? "" : "s"}` : "",
            ])]);
        }
        if (ui.colours.size > 0) {
            groups.push(["Colours", Array.from(ui.colours, ([name, colour]) => [
                "", name, false, "", colour,
            ])]);
        }
        return groups;
    }

    intercept(event) {
        const ui = this.ui;
        const key = event.key;
        switch (key) {
            case "f":
                ui.file.use_macros(undefined, true);
                return true;
            case "r":
                ui.file.load_macros();
                return true;
            case "Escape":
                // As elsewhere, Escape first dismisses an error banner.
                if (!UI.dismiss_error()) {
                    this.leave();
                }
                return true;
            case "Enter":
            case ";":
                this.leave();
                return true;
        }
        // Arrow keys still move the focus point; every other key belongs to the layer.
        return !key.startsWith("Arrow");
    }
};

/// The help layer (`C-/`): the base layer's bindings, how to enter the other layers, and the
/// chords, described by the bindings and actions themselves.
Layer.Help = class extends Layer {
    describe() {
        return ["HELP", "keys"];
    }

    /// The help's lines describe keys rather than being them.
    get clickable() {
        return false;
    }

    /// The bindings of the base layer, how to enter each layer (which list their own bindings),
    /// and the chords. Each section lists the bindings' own
    /// help (`Keymap.BINDINGS`, then `Bindings.HANDLERS`), then the actions (those with plain keys under Typing, and the
    /// rest under Chords, except those entering a layer, which say so under Layers), between the
    /// lines for keys handled elsewhere (`Keymap.HELP_ELSEWHERE`).
    groups() {
        const actions = Array.from(this.ui.mode_line.actions);
        const keys = (combinations, which) => Keymap.describe(combinations.filter(
            ({ modifier, layer }) => !layer && Boolean(modifier) === (which === "chords"),
        ));
        const layers = {
            "import": "import tikz-cd",
            "macros": "macros",
            "export": "export tikz-cd",
            "settings": "settings",
            "shortcuts": null,
        };
        const sections = new Map(
            ["Typing", "Moving", "Mouse", "Layers", "Chords", "Help"].map((section) => [section, []]),
        );
        const elsewhere = (key) => typeof key === "function" ? key(this.keymap) : key;
        for (const [section, description, key] of Keymap.HELP_ELSEWHERE.before) {
            sections.get(section).push([elsewhere(key), description]);
        }
        for (const { combinations, help = [] } of Keymap.BINDINGS) {
            for (const [section, description, key = Keymap.describe(combinations)] of help) {
                sections.get(section).push([key, description]);
            }
        }
        for (const [name, { help = null }] of Object.entries(Bindings.HANDLERS)) {
            const key = keys(this.keymap.combinations(name), "chords");
            if (help !== null && key !== "") {
                sections.get(help[0]).push([key, help[1]]);
            }
        }
        for (const [name, { label, combinations }] of actions) {
            for (const which of ["plain", "chords"]) {
                const key = keys(combinations, which);
                if (key === "") {
                    continue;
                }
                if (Object.hasOwn(layers, name)) {
                    if (layers[name] !== null) {
                        sections.get("Layers").push([key, layers[name]]);
                    }
                } else {
                    sections.get(which === "plain" ? "Typing" : "Chords")
                        .push([key, label.toLowerCase()]);
                }
            }
        }
        for (const [section, description, key] of Keymap.HELP_ELSEWHERE.after) {
            sections.get(section).push([elsewhere(key), description]);
        }
        const shortcuts = keys(this.keymap.combinations("shortcuts"), "chords");
        sections.get("Help").push([`${shortcuts} RET ; ESC`.trim(), "leave"]);
        return Array.from(sections);
    }

    intercept(event) {
        switch (event.key) {
            case ":":
                this.leave();
                this.ui.prompt.open("Command");
                return true;
            case "Escape":
            case "Enter":
            case ";":
                this.leave();
                return true;
        }
        // Arrow keys still move the focus point; every other key belongs to the layer.
        return !event.key.startsWith("Arrow");
    }
};

/// The export layer (`C-e`): the diagram's tikz-cd encoding as an object, whose options are toggled
/// and stepped by key, and which `y` or Enter copies to the clipboard.
Layer.Export = class extends Layer {
    describe() {
        return ["EXPORT", "tikz-cd"];
    }

    /// The diagram's tikz-cd encoding under the current export options: `{ data, metadata }`.
    export() {
        const ui = this.ui;
        return ui.quiver.export("tikz-cd", ui.settings, ui.options(), ui.definitions());
    }

    /// The layer's bindings, with the options' values, and notes on what the output needs
    /// (packages) or cannot express (unsupported features).
    groups() {
        const ui = this.ui;
        const { data, metadata } = this.export();
        const lines = data.split("\n").length;
        const groups = [
            ["Toggles", Layer.Export.TOGGLES.map(([key, description, setting]) => [
                key, description, false, ui.settings.get(setting) ? "on" : "off",
            ])],
            ["Sep (shift: less)", Layer.Export.SEPS.map(([key, axis]) => [
                key, `${axis} sep`, false, Layer.Export.describe_sep(ui.sep[axis]),
            ])],
            ["Result", [
                ["y RET", "copy to clipboard", false, `${lines} line${lines === 1 ? "" : "s"}`],
                ["; ESC", "leave"],
            ]],
        ];
        const needs = Array.from(metadata.dependencies || new Map());
        if (needs.length > 0) {
            groups.push(["Needs", needs.map(([library, reasons]) => [
                "", library, false, Array.from(reasons).join("; "),
            ])]);
        }
        const unsupported = Array.from(metadata.tikz_incompatibilities || []).sort();
        if (unsupported.length > 0) {
            groups.push(["Unsupported", unsupported.map((item) => ["", item])]);
        }
        return groups;
    }

    /// A separation's name in tikz-cd, or its size in em.
    static describe_sep(sep) {
        const size = sep.toFixed(2);
        return Layer.Export.SEP_NAMES[size] || `${size}em`;
    }

    intercept(event) {
        const ui = this.ui;
        const key = event.key;
        const toggle = Layer.Export.TOGGLES.find(([k]) => k === key);
        const sep = Layer.Export.SEPS.find(([k]) => k === key.toLowerCase());
        if (toggle !== undefined) {
            const setting = toggle[2];
            ui.settings.set(setting, !ui.settings.get(setting));
        } else if (sep !== undefined) {
            const axis = sep[1];
            const { SEP_STEP, SEP_TICKS } = Layer.Export;
            const ticks = Math.round(ui.sep[axis] / SEP_STEP)
                + (key === key.toLowerCase() ? 1 : -1);
            ui.sep[axis] = Number(
                (Math.min(Math.max(ticks, 1), SEP_TICKS) * SEP_STEP).toFixed(2)
            );
        } else {
            switch (key) {
                case "y":
                case "Enter":
                    this.copy();
                    break;
                case "Escape":
                    // As elsewhere, Escape first dismisses an error banner (e.g. a failed copy).
                    if (!UI.dismiss_error()) {
                        this.leave();
                    }
                    break;
                case ";":
                    this.leave();
                    break;
                default:
                    // Arrow keys still move the focus point; every other key belongs to the layer
                    // (so that typing never edits a label, nor `DEL` deletes, while exporting).
                    return key.startsWith("Arrow") ? false : true;
            }
        }
        this.keymap.render();
        return true;
    }

    /// Copy the export to the clipboard, leaving the layer.
    async copy() {
        const { data } = this.export();
        const lines = data.split("\n").length;
        await host.write_clipboard(data);
        this.leave();
        this.ui.mode_line.flash(`copied ${lines} line${lines === 1 ? "" : "s"} of tikz-cd`);
    }
};

/// The layer's toggles: `[key, description, setting]`.
Layer.Export.TOGGLES = [
    ["c", "centre diagram", "export.centre_diagram"],
    ["a", "ampersand replacement", "export.ampersand_replacement"],
    ["r", "cramped", "export.cramped"],
    ["s", "standalone", "export.standalone"],
];

/// The layer's separations, stepped up by the key and down by its capital: `[key, axis]`.
Layer.Export.SEPS = [["w", "column"], ["h", "row"]];

/// Separations are multiples of `SEP_STEP` em, from one to `SEP_TICKS` of them, some of which
/// tikz-cd names.
Layer.Export.SEP_STEP = 0.45;
Layer.Export.SEP_TICKS = 8;
Layer.Export.SEP_NAMES = {
    "0.45": "tiny",
    "0.90": "small",
    "1.35": "script",
    "1.80": "normal",
    "2.70": "large",
    "3.60": "huge",
};

/// The settings layer (`C-,`): each setting on a key, as the command layer's are. A setting that is
/// on or off flips; a number is typed and set with RET, or stepped by the arrow keys or its
/// buttons; and the preset new arrows take is chosen from a list. Every change shows straight away
/// (see `UI.change_setting`).
Layer.Settings = class extends Layer {
    constructor(keymap) {
        super(keymap);

        // The setting being typed or listed, or `null`, and the number typed so far.
        this.chosen = null;
        this.count = "";
    }

    describe() {
        if (this.chosen !== null && Object.hasOwn(Layer.Settings.STEPS, this.chosen)) {
            return ["SETTINGS", `${Layer.Settings.description(this.chosen)} ${this.count}_`];
        }
        return ["SETTINGS", "settings.json"];
    }

    entered() {
        this.chosen = null;
        this.count = "";
    }

    /// The description of `setting`, as the layer lists it.
    static description(setting) {
        return Layer.Settings.GROUPS.flatMap(([, lines]) => lines)
            .find(([, name]) => name === setting)[2];
    }

    /// The value of `setting`, as the layer lists it.
    describe_value(setting) {
        const value = this.ui.settings.get(setting);
        if (typeof value === "boolean") {
            return value ? "on" : "off";
        }
        if (value === null) {
            return "never";
        }
        return `${value}${Layer.Settings.UNITS[setting] ?? ""}`;
    }

    /// The settings with their values, then the other bindings; or, while the presets are listed,
    /// those, with their keys.
    groups() {
        const ui = this.ui;
        const preset = "diagram.arrow_preset";
        if (this.chosen === preset) {
            return [["new arrows (again to cancel)", Object.entries(Layer.Settings.PRESET_KEYS)
                .map(([name, key]) => [
                    key, name.replace("-", " "), name === ui.settings.get(preset),
                ])]];
        }
        const groups = Layer.Settings.GROUPS.map(([title, lines]) => [
            title, lines.map(([key, setting, description]) => [
                key, description, setting === this.chosen, this.describe_value(setting), null,
                Object.hasOwn(Layer.Settings.STEPS, setting) ? `setting:${setting}` : null,
            ]),
        ]);
        groups.push(["Other", [
            ["e", "export options"],
            ["o", "open settings.json"],
            ["RET ; ESC", "leave"],
        ]]);
        return groups;
    }

    /// Step the numeric `setting` by `delta` steps, within its range. A setting that may be `null`
    /// (as never) is, one step below its least value.
    step(setting, delta) {
        const ui = this.ui;
        const [least, most] = Settings.RANGES[setting];
        const current = ui.settings.get(setting);
        let value;
        if (current === null) {
            value = delta > 0 ? least : null;
        } else if (delta < 0 && current === least && Settings.NULLABLE.has(setting)) {
            value = null;
        } else {
            value = clamp(least, current + Layer.Settings.STEPS[setting] * delta, most);
        }
        ui.change_setting(setting, value);
        this.keymap.render();
    }

    /// Set the chosen setting to the number typed, if it is in range, and let go of it.
    apply_count() {
        const setting = this.chosen;
        const value = Number(this.count);
        const [least, most] = Settings.RANGES[setting];
        this.chosen = null;
        this.count = "";
        if (value >= least && value <= most) {
            this.ui.change_setting(setting, value);
        } else {
            this.ui.mode_line.flash(`${Layer.Settings.description(setting)}: a number from ${
                least} to ${most}`, true);
        }
    }

    /// Open `settings.json` in the desktop's editor, writing it first if it has never been.
    async open_file() {
        await this.ui.settings.write();
        const error = await host.open_settings();
        if (error !== "") {
            this.ui.mode_line.flash(`could not open settings.json: ${error}`, true);
        }
    }

    intercept(event) {
        const ui = this.ui;
        const key = event.key;
        const numeric = this.chosen !== null && Object.hasOwn(Layer.Settings.STEPS, this.chosen);
        const line = Layer.Settings.GROUPS.flatMap(([, lines]) => lines)
            .find(([line_key]) => line_key === key);
        const preset = this.chosen === "diagram.arrow_preset"
            ? Object.keys(Layer.Settings.PRESET_KEYS)
                .find((name) => Layer.Settings.PRESET_KEYS[name] === key)
            : undefined;
        if (numeric && /^[0-9]$/.test(key)) {
            this.count += key;
        } else if (numeric && key === "Backspace") {
            this.count = this.count.slice(0, -1);
        } else if (numeric && (key === "ArrowLeft" || key === "ArrowRight")) {
            this.count = "";
            this.step(this.chosen, key === "ArrowLeft" ? -1 : 1);
        } else if (preset !== undefined) {
            ui.change_setting(this.chosen, preset);
            this.chosen = null;
        } else if (line !== undefined) {
            // A setting that is on or off flips; any other is chosen, or let go of.
            const setting = line[1];
            const value = ui.settings.get(setting);
            this.count = "";
            if (typeof value === "boolean") {
                ui.change_setting(setting, !value);
                this.chosen = null;
            } else {
                this.chosen = this.chosen === setting ? null : setting;
            }
        } else {
            switch (key) {
                case "e":
                    this.keymap.layers.export.enter();
                    return true;
                case "o":
                    this.open_file();
                    break;
                case "Enter":
                    if (numeric && this.count !== "") {
                        this.apply_count();
                    } else {
                        this.leave();
                    }
                    break;
                case "Escape":
                    // As elsewhere, Escape first dismisses an error banner.
                    if (!UI.dismiss_error()) {
                        this.leave();
                    }
                    break;
                case ";":
                    this.leave();
                    break;
                default:
                    // Arrow keys still move the focus point; every other key belongs to the layer.
                    return !key.startsWith("Arrow");
            }
        }
        this.keymap.render();
        return true;
    }
};

/// The settings the layer lists: `[title, [[key, setting, description]]]`. Those not here
/// (`ui.hint_characters`, and the export options, which the export layer has) are in the file.
Layer.Settings.GROUPS = [
    ["View", [
        ["d", "ui.dark_mode", "dark mode"],
        ["z", "ui.zoom", "zoom to start at"],
        ["c", "ui.cell_size", "cell size"],
        ["l", "ui.label_size", "label size"],
    ]],
    ["Command list", [
        ["w", "ui.which_key_delay", "list keys after"],
        ["k", "ui.which_key_compact", "compact"],
    ]],
    ["Diagram", [
        ["a", "diagram.arrow_preset", "new arrows"],
        ["v", "diagram.var_corner", "corner: var first"],
    ]],
];

/// How far each step moves the numeric settings, which are typed or stepped (see `step`).
Layer.Settings.STEPS = {
    "ui.zoom": 10,
    "ui.cell_size": 16,
    "ui.label_size": 2,
    "ui.which_key_delay": 100,
};

/// The units the numeric settings are listed in.
Layer.Settings.UNITS = {
    "ui.zoom": "%",
    "ui.cell_size": "px",
    "ui.label_size": "px",
    "ui.which_key_delay": " ms",
};

/// The keys of the presets new arrows may take, by name: the command layer's defaults for the
/// presets, and for dotted, which has none there, its key in the body's list.
Layer.Settings.PRESET_KEYS = {
    "plain": "!",
    "equals": "=",
    "inclusion": "(",
    "mono": "<",
    "epi": ">",
    "maps-to": "|",
    "dashed": "-",
    "dotted": ".",
    "squiggly": "~",
};

/// The colour layer (`; c` for arrows, `; C` for labels): the selection's colour as an object,
/// whose hue, saturation, and lightness are stepped by key, and whose palettes' colours are picked
/// by key.
Layer.Colour = class extends Layer {
    describe() {
        return ["COLOUR", this.ui.colour_picker.is_targeting(ColourPicker.TARGET.Edge)
            ? "arrow" : "label"];
    }

    /// Whether the layer is active: its state is the `ColourPicker`'s target, which other parts
    /// of the UI clear (e.g. on deselecting everything) to leave it.
    get active() {
        return this.ui.colour_picker.target !== null;
    }

    /// Enter the layer for `target`, or leave it if already picking that target's colour.
    /// There must be something to colour: an arrow, or for labels, any cell.
    toggle(target) {
        const ui = this.ui;
        if (ui.colour_picker.is_targeting(target)) {
            this.leave();
        } else if (target === ColourPicker.TARGET.Edge
            ? ui.selection_contains_edge() : ui.selection.size > 0
        ) {
            this.enter(target);
        }
    }

    enter(target) {
        const ui = this.ui;
        // Switching between the label and arrow targets keeps the sync setting.
        const switching = this.active;
        if (!switching) {
            this.keymap.settle();
        }
        // Each visit to the layer is one undo step.
        ui.history.permanentise();
        ui.colour_picker.open(ui, target);
        this.keymap.render();
    }

    leave() {
        this.ui.history.permanentise();
        this.ui.colour_picker.close();
    }

    /// The palettes' colours with their keys, `[[group, [[key, colour]]]]`: presets on the digits,
    /// and the LaTeX and diagram colours (less those listed already) on the letters left over.
    swatches() {
        const seen = new Set();
        const letters = [...Layer.Colour.SWATCH_LETTERS];
        return Array.from(this.ui.colour_picker.palettes, ([group, colours]) => {
            const keys = group === "Preset" ? [..."1234567890"] : letters;
            const swatches = [];
            for (const colour of colours) {
                if (keys.length === 0) {
                    break;
                }
                if (!seen.has(`${colour}`)) {
                    seen.add(`${colour}`);
                    swatches.push([keys.shift(), colour]);
                }
            }
            return [group, swatches];
        });
    }

    /// The layer's bindings, with the colour's components and the palettes.
    groups() {
        const ui = this.ui;
        const picker = ui.colour_picker;
        const edge = picker.target === ColourPicker.TARGET.Edge;
        const values = { hue: "°", saturation: "%", lightness: "%" };
        const components = picker.colour.hsla();
        const options = [
            ["x", `sync ${edge ? "label" : "arrow"} colour`, false, picker.sync ? "on" : "off"],
        ];
        if (!edge) {
            if (ui.selection_contains_edge()) {
                options.push(["c", "colour the arrows instead"]);
            }
        } else {
            options.push(["C", "colour the labels instead"]);
        }
        options.push(["#", "type a colour"], ["RET ; ESC", "leave"]);
        const groups = [
            [`${edge ? "arrow" : "label"} colour`, [
                ["", Layer.Colour.name_of(picker.colour), false, "", picker.colour],
            ]],
            ["Step (shift: less)", Layer.Colour.STEPS.map(([key, component], i) => [
                key, component, false, `${components[i]}${values[component]}`,
            ])],
            ["Options", options],
        ];
        for (const [group, swatches] of this.swatches()) {
            if (swatches.length > 0) {
                groups.push([group, swatches.map(([key, colour]) => [
                    key, Layer.Colour.name_of(colour), colour.eq(picker.colour), "", colour,
                ])]);
            }
        }
        return groups;
    }

    /// A colour's name, or its hex code.
    static name_of(colour) {
        if (colour.name !== null) {
            return colour.name;
        }
        return `#${colour.rgba().slice(0, 3).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    }

    /// Parse a colour typed on the command line: a hex code (`#f80`, `#ff8800`), hue, saturation,
    /// and lightness (`30,100,50`), or the name of a palette colour (`red`, a LaTeX colour).
    parse(text) {
        // The colour layer's `#` starts the command line with `#`, which only hex codes keep.
        text = text.replace(/^#(?=.*[^0-9a-f])/i, "");
        const hex = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex !== null) {
            let digits = hex[1];
            if (digits.length === 3) {
                digits = [...digits].map((digit) => digit + digit).join("");
            }
            return Colour.from_rgba(
                ...[0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)),
            );
        }
        const hsl = text.match(/^(\d+),(\d+),(\d+)$/);
        if (hsl !== null) {
            const [h, s, l] = hsl.slice(1).map(Number);
            return new Colour(mod(h, 360), Math.min(s, 100), Math.min(l, 100));
        }
        for (const colours of this.ui.colour_picker.palettes.values()) {
            const colour = colours.find((colour) => {
                return colour.name !== null && colour.name.toLowerCase() === text.toLowerCase();
            });
            if (colour !== undefined) {
                return colour;
            }
        }
        throw new Error(`Unknown colour "${text}": use #rrggbb, h,s,l, or a colour's name.`);
    }

    intercept(event) {
        const ui = this.ui;
        const picker = ui.colour_picker;
        const key = event.key;
        const step = Layer.Colour.STEPS.findIndex(([k]) => k === key.toLowerCase());
        const swatch = this.swatches().flatMap(([, swatches]) => swatches)
            .find(([k]) => k === key);
        if (step !== -1) {
            const components = picker.colour.hsla();
            const size = Layer.Colour.STEPS[step][2] * (key === key.toLowerCase() ? 1 : -1);
            components[step] = step === 0
                ? mod(components[step] + size, 360)
                : Math.min(Math.max(components[step] + size, 0), 100);
            picker.set_selection_colour(ui, new Colour(...components));
        } else if (swatch !== undefined) {
            picker.set_selection_colour(ui, swatch[1]);
        } else {
            switch (key) {
                case "x":
                    picker.toggle_sync(ui);
                    break;
                case "c":
                    if (ui.selection_contains_edge()) {
                        this.enter(ColourPicker.TARGET.Edge);
                    }
                    break;
                case "C":
                    this.enter(ColourPicker.TARGET.Label);
                    break;
                case "#":
                    // Type a colour on the command line, e.g. `colour #ff8800`.
                    const command = picker.target === ColourPicker.TARGET.Edge
                        ? "colour" : "label-colour";
                    this.leave();
                    this.ui.prompt.open("Command");
                    ui.label_input.element.value = `${command} #`;
                    ui.prompt.input();
                    return true;
                case "Escape":
                    // As elsewhere, Escape first dismisses an error banner.
                    if (!UI.dismiss_error()) {
                        this.leave();
                    }
                    break;
                case "Enter":
                case ";":
                    this.leave();
                    break;
                default:
                    // Arrow keys still move the focus point (and so may change the selection
                    // being coloured); every other key belongs to the layer.
                    return key.startsWith("Arrow") ? false : true;
            }
        }
        this.keymap.render();
        return true;
    }
};

/// The layer's bindings stepping the colour's hue, saturation, and lightness (in that order,
/// as in `Colour.hsla`), and by how much.
Layer.Colour.STEPS = [["h", "hue", 30], ["s", "saturation", 10], ["l", "lightness", 10]];

/// The keys for the layer's LaTeX and diagram swatches: the letters not otherwise bound.
Layer.Colour.SWATCH_LETTERS = "abdefgijkmnopqrtuvwyz";
