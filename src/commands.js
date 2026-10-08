/// The named commands: what the command line (`:`) runs, and what a named binding runs when it is
/// neither an action nor one of `Bindings.HANDLERS`, as the presets and endpoints are. Every named
/// action of the mode line is a command too (see `Keymap.initialise`).
class Commands {
    constructor(ui) {
        this.ui = ui;
    }

    /// Resolve a command name or alias.
    static canonical(name) {
        name = name.toLowerCase();
        return Commands.ALIASES[name] || name;
    }

    /// Run a command line: commands separated by `;`, which undo together. Returns whether every
    /// command succeeded; an error banner explains the first failure.
    run(line) {
        const ui = this.ui;
        const since = ui.history.present;
        try {
            for (const statement of line.split(";")) {
                const [name, ...args] = statement.trim().split(/\s+/);
                if (name === "") {
                    continue;
                }
                const command = Commands.TABLE[Commands.canonical(name)];
                if (command === undefined) {
                    throw new Error(`Unknown command "${name}". Press Tab for a list.`);
                }
                command.run(this, args);
            }
            return true;
        } catch (error) {
            UI.display_error(error.message);
            return false;
        } finally {
            ui.history.squash(since);
            ui.update_selection();
        }
    }

    /// Throw unless an edge is selected.
    require_edges() {
        if (!this.ui.selection_contains_edge()) {
            throw new Error("Select an arrow first.");
        }
    }

    /// Switch the selected edges to plain arrows (rather than adjunctions, etc.), if necessary.
    ensure_arrow() {
        const ui = this.ui;
        if (ui.arrow_options.edge_type(ui) !== "arrow") {
            ui.arrow_options.set_edge_type(ui, "arrow");
        }
    }

    /// Set the arrow component `component` (`tail`, `body`, or `head`) to `style`.
    style(component, style) {
        this.require_edges();
        this.ensure_arrow();
        const value = Commands.STYLES[component][style];
        if (value === undefined) {
            throw new Error(`Unknown ${component} "${style}". Options: ${
                Object.keys(Commands.STYLES[component]).join(", ")}.`);
        }
        this.ui.arrow_options.set_style(
            this.ui, component, ArrowOptions.style_data(component, value));
    }

    /// Set `property` to `values` (one per thumb) across the selected edges.
    slide(property, values) {
        const ui = this.ui;
        this.require_edges();
        if (!ui.arrow_options.applies(ui, property)) {
            throw new Error(`${property} does not apply to the selection.`);
        }
        const { min, max, thumbs, default: fallback } = ArrowOptions.PROPERTIES[property];
        if (values.length === 0 || values.length > thumbs
            || values.some((value) => !Number.isFinite(Number(value)))
        ) {
            throw new Error(`${property} takes ${
                thumbs === 1 ? "a number" : `up to ${thumbs} numbers`
            } (${min} to ${max}).`);
        }
        // A pair given one number keeps the other where the selection has it.
        const current = thumbs === 1 ? [] : Array.from(ui.arrow_options.value(ui, property)
            ?? fallback);
        current.splice(0, values.length, ...values.map(Number));
        ui.arrow_options.set(ui, property, current);
    }

    /// Apply an arrow preset.
    preset(name) {
        const preset = Commands.PRESETS[name];
        this.require_edges();
        for (const component of ["tail", "body", "head"]) {
            if (preset[component] !== undefined) {
                this.style(component, preset[component]);
            }
        }
        if (preset.level !== undefined) {
            this.slide("level", [preset.level]);
        }
    }
}

/// The option values for each arrow component, by the names the command line accepts.
Commands.STYLES = {
    tail: {
        "none": "none",
        "mono": "mono",
        "maps-to": "maps to",
        "hook": "top-hook",
        "top-hook": "top-hook",
        "bottom-hook": "bottom-hook",
        "arrowhead": "arrowhead",
    },
    body: {
        "solid": "solid",
        "none": "none",
        "dashed": "dashed",
        "dotted": "dotted",
        "squiggly": "squiggly",
        "barred": "barred",
        "double-barred": "double barred",
        "bullet-solid": "bullet solid",
        "bullet-hollow": "bullet hollow",
    },
    head: {
        "arrowhead": "arrowhead",
        "none": "none",
        "epi": "epi",
        "harpoon": "top-harpoon",
        "top-harpoon": "top-harpoon",
        "bottom-harpoon": "bottom-harpoon",
    },
};

/// Arrow presets. Kinds of arrow set every component; modifiers set only the body.
Commands.PRESETS = {
    "plain": { tail: "none", body: "solid", head: "arrowhead", level: 1 },
    "equals": { tail: "none", body: "solid", head: "none", level: 2 },
    "inclusion": { tail: "hook", body: "solid", head: "arrowhead", level: 1 },
    "mono": { tail: "mono", body: "solid", head: "arrowhead", level: 1 },
    "epi": { tail: "none", body: "solid", head: "epi", level: 1 },
    "maps-to": { tail: "maps-to", body: "solid", head: "arrowhead", level: 1 },
    "dashed": { body: "dashed" },
    "dotted": { body: "dotted" },
    "squiggly": { body: "squiggly" },
};

/// The command line's commands. `completions` lists the arguments offered by Tab.
Commands.TABLE = {};

for (const component of ["tail", "body", "head"]) {
    Commands.TABLE[component] = {
        arguments: true,
        completions: Object.keys(Commands.STYLES[component]),
        run: (commands, [style = ""]) => commands.style(component, style.toLowerCase()),
    };
}

for (const property of ["level", "curve", "offset", "radius", "angle", "length"]) {
    Commands.TABLE[property] = {
        arguments: true,
        run: (commands, values) => {
            commands.require_edges();
            if (property !== "offset") {
                commands.ensure_arrow();
            }
            commands.slide(property, values);
        },
    };
}
Commands.TABLE["position"] = {
    arguments: true,
    run: (commands, values) => commands.slide("label_position", values),
};

for (const name of Object.keys(Commands.PRESETS)) {
    Commands.TABLE[name] = { run: (commands) => commands.preset(name) };
}

for (const [name, value] of [
    ["arrow", "arrow"],
    ["adjunction", "adjunction"],
    // `corner` alternates between the two kinds, and remembers which was last used; `corner-var`
    // names the inverse outright.
    ["corner", null],
    ["corner-var", "corner-inverse"],
]) {
    Commands.TABLE[name] = {
        run: (commands) => {
            const ui = commands.ui;
            commands.require_edges();
            if (value === null) {
                ui.arrow_options.toggle_corner(ui);
                return;
            }
            ui.arrow_options.set_edge_type(ui, value);
            if (value === "corner-inverse") {
                ui.settings.set("diagram.var_corner", true);
            }
        },
    };
}

Commands.TABLE["macros"] = {
    arguments: true,
    // With no argument, enter the macros layer; otherwise, follow the macros file at the path.
    run: (commands, words) => {
        if (words.length === 0) {
            commands.ui.keymap.layers.macros.enter();
        } else {
            commands.ui.file.use_macros(words.join(" "), true);
        }
    },
};

// With a path (relative to the diagram's directory), open or save the diagram there.
Commands.TABLE["open"] = {
    arguments: true,
    run: (commands, words) => commands.ui.file.open(words.length > 0 ? words.join(" ") : null),
};
Commands.TABLE["save"] = {
    arguments: true,
    run: (commands, words) => commands.ui.file.save(words.length > 0 ? words.join(" ") : undefined),
};

Commands.TABLE["align"] = {
    arguments: true,
    completions: ["left", "centre", "over", "right"],
    run: (commands, [alignment = ""]) => {
        const ui = commands.ui;
        commands.require_edges();
        const value = alignment.toLowerCase().replace("center", "centre");
        const values = Commands.TABLE["align"].completions;
        if (!values.includes(value)) {
            throw new Error(`Unknown alignment "${alignment}". Options: ${values.join(", ")}.`);
        }
        ui.arrow_options.set_label_alignment(ui, value);
    },
};

for (const [name, target] of [["colour", "Edge"], ["label-colour", "Label"]]) {
    Commands.TABLE[name] = {
        arguments: true,
        // The palettes' named colours.
        completions: (commands) => Array.from(commands.ui.colour_picker.palettes.values())
            .flat().map((colour) => colour.name).filter((name) => name !== null),
        // With no argument, enter the colour layer; otherwise, set the colour.
        run: (commands, [text]) => {
            const ui = commands.ui;
            if (ui.selection.size === 0) {
                throw new Error("Select something first.");
            }
            if (target === "Edge") {
                commands.require_edges();
            }
            if (text === undefined) {
                ui.keymap.layers.colour.enter(ColourPicker.TARGET[target]);
                return;
            }
            const colour = ui.keymap.layers.colour.parse(text);
            const picker = ui.colour_picker;
            picker.open(ui, ColourPicker.TARGET[target]);
            picker.set_selection_colour(ui, colour);
            picker.close();
        },
    };
}

for (const [name, end] of [["align-source", "source"], ["align-target", "target"]]) {
    Commands.TABLE[name] = {
        run: (commands) => {
            const ui = commands.ui;
            if (ui.arrow_options.endpoint(ui, end) === null) {
                throw new Error(`The selection has no arrow whose ${
                    name.replace("align-", "")} is an arrow.`);
            }
            // Toggle whether the endpoint aligns to the centre of the arrow it attaches to.
            ui.arrow_options.toggle_endpoint(ui, end);
        },
    };
}

/// Alternative names for commands (not offered by completion).
Commands.ALIASES = {
    "lvl": "level",
    "pos": "position",
    "len": "length",
    "color": "colour",
    "label-color": "label-colour",
    "pullback": "corner",
    "pushout": "corner",
    "eq": "equals",
    "incl": "inclusion",
    "mapsto": "maps-to",
    "flip-label": "flip-labels",
    "all": "select-all",
    "connected": "select-connected",
    "deselect": "deselect-all",
    "centre": "centre-view",
    "center": "centre-view",
    "grid": "hide-grid",
    "help": "shortcuts",
    "w": "save",
    "u": "undo",
};
