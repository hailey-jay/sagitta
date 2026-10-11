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

    /// Throw unless an edge is selected, saying `hint` instead of the usual message.
    require_edges(hint = "Select an arrow first.") {
        if (!this.ui.selection_contains_edge()) {
            throw new Error(hint);
        }
    }

    /// Switch the selected edges to plain arrows (rather than adjunctions, etc.), if necessary.
    ensure_arrow() {
        const ui = this.ui;
        if (ui.arrow_options.edge_type(ui) !== "arrow") {
            ui.arrow_options.set_edge_type(ui, "arrow");
        }
    }

    /// Set the arrow component `component` (`tail`, `body`, or `head`) to `style`. Unlike a
    /// preset, a component has no default of its own to set, so this always needs a selection.
    style(component, style) {
        this.require_edges("Select an arrow first, or press a preset key to set what new arrows"
            + " take.");
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

    /// Open a gap at `index` along `axis` (`"x"` for a column, `"y"` for a row): every vertex at
    /// or beyond it moves one step on, and the arrows come with them, since an arrow is held by its
    /// endpoints rather than by a position. Building a diagram outwards (the snake lemma puts the
    /// kernels above a row that is already there) is what this is for.
    ///
    /// The move goes in the undo history as one step, which `kind: "move"` already knows how to
    /// undo. No vertex ends up where another was: everything that moves is beyond the gap, and
    /// everything that stays is before it.
    insert(axis, index) {
        const ui = this.ui;
        const beyond = ui.quiver.all_cells()
            .filter((cell) => cell.is_vertex() && cell.position[axis] >= index);
        if (beyond.length === 0) {
            throw new Error(`There is no ${axis === "x" ? "column" : "row"} at or after ${
                axis === "x" ? "column" : "row"} ${index + 1} to move.`);
        }
        const delta = axis === "x" ? new Position(1, 0) : new Position(0, 1);
        const move = (position) => position[axis] >= index ? position.add(delta) : position;
        const displacements = beyond.map((vertex) => ({
            vertex,
            from: vertex.position,
            to: move(vertex.position),
        }));
        ui.history.add(ui, [{
            kind: "move",
            displacements,
            // A route's cells beyond the gap move on with the vertices there.
            routes: ui.quiver.moved_routes(displacements, move),
        }], true);
    }

    /// Replace the selected arrow with a chain of arrows through new empty cells along the
    /// staircase between its ends, so that a connecting morphism drawn step by step (the snake
    /// lemma marks four: lift, apply, pull back, project) is one command rather than a placement
    /// apiece.
    ///
    /// The staircase steps one cell at a time, alternating between the axes and starting with
    /// `first` (`"x"`, `"y"`, or `null` for whichever has further to go), so it is the Manhattan
    /// path between the ends rather than a curve: sagitta has no waypoints on a single arrow, and
    /// adding them would need a field the quiver round trip does not have.
    ///
    /// A cell the staircase passes through that already holds a vertex is used as it stands, rather
    /// than displaced, so a staircase may be drawn through a diagram as well as around it.
    snake(first = null) {
        const ui = this.ui;
        const edges = Array.from(ui.selection).filter((cell) => cell.is_edge());
        if (edges.length !== 1) {
            throw new Error("Select one arrow to draw as a staircase.");
        }
        const [edge] = edges;
        const { source, target } = edge;
        if (!source.is_vertex() || !target.is_vertex()) {
            throw new Error("A staircase runs between two cells, not between arrows.");
        }
        if (source === target) {
            throw new Error("A loop has no staircase.");
        }
        const corners = Commands.staircase(source.position, target.position, first);
        if (corners.length === 0) {
            throw new Error("The two cells are already next to each other.");
        }
        // The arrow being replaced is deleted, and the chain created, as one undoable step.
        const created = new Set();
        let previous = source;
        for (const position of corners) {
            const held = ui.positions.get(`${position}`);
            const vertex = held ?? new Vertex(ui, "", position);
            if (held === undefined) {
                created.add(vertex);
            }
            created.add(Edge.create(ui, previous, vertex));
            previous = vertex;
        }
        created.add(Edge.create(ui, previous, target));
        ui.history.add(ui, [
            { kind: "create", cells: created },
            { kind: "delete", cells: ui.quiver.transitive_dependencies(new Set([edge])) },
        ]);
        ui.remove_cell(edge, ui.history.present);
        ui.deselect();
        ui.select(...created);
    }

    /// The cells a staircase from `from` to `to` passes through, excluding both ends: one step at a
    /// time, alternating between the axes, starting with `first` (or the axis with further to go).
    static staircase(from, to, first = null) {
        const step = {
            x: Math.sign(to.x - from.x),
            y: Math.sign(to.y - from.y),
        };
        const left = { x: Math.abs(to.x - from.x), y: Math.abs(to.y - from.y) };
        let axis = first ?? (left.y > left.x ? "y" : "x");
        const corners = [];
        let at = from;
        while (left.x + left.y > 1) {
            // An axis with nothing left to go is skipped, so the tail of the path is a straight run.
            if (left[axis] === 0) {
                axis = axis === "x" ? "y" : "x";
            }
            at = axis === "x"
                ? new Position(at.x + step.x, at.y) : new Position(at.x, at.y + step.y);
            --left[axis];
            corners.push(at);
            axis = axis === "x" ? "y" : "x";
        }
        return corners;
    }

    /// The selected edges a route can be given: not loops, and only those with a vertex at each
    /// end, since a route is a path between cells. Throws if there are none.
    routable() {
        this.require_edges();
        const edges = ArrowOptions.edges(this.ui)
            .filter((edge) => !edge.is_loop()
                && edge.source.is_vertex() && edge.target.is_vertex());
        if (edges.length === 0) {
            throw new Error("A route runs between two cells: select an arrow that is not a loop,"
                + " and whose ends are not arrows.");
        }
        return edges;
    }

    /// Route the selected arrows round one corner, going along `first` (`"x"` or `"y"`) and then
    /// the other axis, or straighten them again (`first` `null`). An arrow whose ends share a row
    /// or a column has no corner to turn, and is left alone.
    route(first) {
        const ui = this.ui;
        const edges = new Set(this.routable());
        const corner = (edge) => {
            const { source: { position: source }, target: { position: target } } = edge;
            return first === "x" ? [target.x, source.y] : [source.x, target.y];
        };
        const bends = (edge) => edge.source.position.x !== edge.target.position.x
            && edge.source.position.y !== edge.target.position.y;
        if (first !== null && !Array.from(edges).some(bends)) {
            throw new Error("The arrow is already straight along a row or a column, so it has no"
                + " corner to turn: add checkpoints for a route round something.");
        }
        ui.arrow_options.set_route(ui, (edge) => !edges.has(edge) ? edge.options.route
            : first === null ? [] : bends(edge) ? [corner(edge)] : edge.options.route);
    }

    /// The next route `route` with no argument gives: a straight arrow bends along a row first,
    /// that bend goes along a column first instead, and any other route is straightened.
    next_route() {
        const edges = this.routable();
        const route = ArrowOptions.common(edges, (edge) => edge.options.route);
        if (route === null || route.length === 0) {
            return "x";
        }
        if (route.length === 1 && edges.every((edge) => JSON.stringify(edge.options.route)
            === JSON.stringify([[edge.target.position.x, edge.source.position.y]]))
        ) {
            return "y";
        }
        return null;
    }

    /// Add the cell at the focus point to the routes of the selected arrows, as their last
    /// checkpoint before the target, or take it out of the routes that already pass through it.
    checkpoint() {
        const ui = this.ui;
        const edges = this.routable();
        const at = ui.focus_position.toArray();
        const has = (edge) => edge.options.route.some(([x, y]) => x === at[0] && y === at[1]);
        const ends = (edge) => [edge.source, edge.target]
            .some((end) => end.position.x === at[0] && end.position.y === at[1]);
        if (edges.every(ends)) {
            throw new Error("The focus point is on an end of the arrow: move it to a cell the"
                + " arrow should pass through.");
        }
        const remove = edges.every((edge) => has(edge) || ends(edge));
        const routing = new Set(edges);
        ui.arrow_options.set_route(ui, (edge) => {
            if (!routing.has(edge) || ends(edge)) {
                return edge.options.route;
            }
            return remove
                ? edge.options.route.filter(([x, y]) => x !== at[0] || y !== at[1])
                : has(edge) ? edge.options.route : [...edge.options.route, at];
        });
        ui.mode_line.flash(remove ? "checkpoint removed" : "checkpoint added");
    }

    /// Apply an arrow preset to the selected arrows, or, with none selected, make it the preset
    /// new arrows take (`diagram.arrow_preset`), which is the only thing the key press can
    /// sensibly mean when there is nothing to restyle. The setting is not part of the diagram, so
    /// this does not go in the undo history; the command layer and `C-,` show the new default.
    preset(name) {
        const ui = this.ui;
        const preset = Commands.PRESETS[name];
        if (!ui.selection_contains_edge()) {
            ui.change_setting("diagram.arrow_preset", name);
            ui.mode_line.flash(`new arrows: ${name.replace("-", " ")}`);
            return;
        }
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

for (const property of ["level", "curve", "offset", "radius", "angle", "length", "rounding"]) {
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

/// `:set SETTING VALUE` names a setting and the value to give it, which the settings layer (`C-,`)
/// cannot: it steps a number by key. With no value, the line says what the setting holds. Settings
/// are not part of the diagram, so a change here is not undoable, as it is not in the layer.
Commands.TABLE["set"] = {
    arguments: true,
    completions: (commands) => commands.ui.settings.names().sort(),
    run: (commands, [setting, ...words]) => {
        const ui = commands.ui;
        if (setting === undefined || !ui.settings.has(setting)) {
            throw new Error(`Unknown setting "${setting ?? ""}". Press Tab for a list.`);
        }
        if (words.length === 0) {
            ui.mode_line.flash(`${setting} is ${JSON.stringify(ui.settings.get(setting))}`);
            return;
        }
        // The words are joined, rather than only the first being taken, so that `set ui.zoom 1 0`
        // is refused with what was typed instead of quietly setting the zoom to 1.
        const text = words.join(" ");
        const value = ui.settings.parse(setting, text);
        if (value === undefined || !ui.settings.allows(setting, value)) {
            throw new Error(`"${text}" is not a value for ${setting}, which should be ${
                ui.settings.expected(setting)}.`);
        }
        ui.change_setting(setting, value);
        ui.mode_line.flash(`${setting} is now ${JSON.stringify(value)}`);
    },
};

/// Opening a gap for a row or a column, anchored on the focus point: `above` and `left` put the gap
/// where the focus point is, and `below` and `right` just after it. These have no keys by default;
/// the keys file can bind them, as it can any command.
for (const [name, axis, after] of [
    ["insert-row-above", "y", 0],
    ["insert-row-below", "y", 1],
    ["insert-column-left", "x", 0],
    ["insert-column-right", "x", 1],
]) {
    Commands.TABLE[name] = {
        run: (commands) => commands.insert(axis, commands.ui.focus_position[axis] + after),
    };
}

Commands.TABLE["snake"] = {
    arguments: true,
    completions: ["x", "y"],
    run: (commands, [first]) => {
        if (first !== undefined && !["x", "y"].includes(first.toLowerCase())) {
            throw new Error(`"${first}" is not an axis: snake takes x, y, or nothing.`);
        }
        commands.snake(first === undefined ? null : first.toLowerCase());
    },
};

/// `route x` and `route y` bend the selected arrows round one corner, going along a row or a column
/// first, and `route none` straightens them. With nothing, it steps through those three.
Commands.TABLE["route"] = {
    arguments: true,
    completions: ["x", "y", "none"],
    run: (commands, [first]) => {
        commands.require_edges();
        if (first === undefined) {
            commands.route(commands.next_route());
            return;
        }
        const values = { x: "x", y: "y", none: null };
        if (!Object.hasOwn(values, first.toLowerCase())) {
            throw new Error(`"${first}" is not x, y, or none, which route takes, or nothing.`);
        }
        commands.route(values[first.toLowerCase()]);
    },
};

/// `checkpoint` adds the cell at the focus point to the selected arrows' routes, or takes it out.
Commands.TABLE["checkpoint"] = {
    run: (commands) => {
        commands.checkpoint();
    },
};

/// `move-checkpoint` picks up the checkpoint at the focus point, which then follows the focus point
/// until RET puts it down or ESC puts it back (see `Keys.carry`). Again puts it down.
Commands.TABLE["move-checkpoint"] = {
    run: (commands) => commands.ui.keys.carry(),
};

/// `mark` and `mark-add` do what their keys do (see `Keys.mark`), from the command line.
for (const [name, add] of [["mark", false], ["mark-add", true]]) {
    Commands.TABLE[name] = {
        run: (commands) => {
            const ui = commands.ui;
            if (!ui.keys.mark(add)) {
                throw new Error(`The mark cannot be set in the ${ui.mode.name} mode.`);
            }
        },
    };
}

/// `crossing-over` toggles whether the selected arrows cut a gap in the arrows they cross, and
/// `crossing-over on` or `off` sets it.
Commands.TABLE["crossing-over"] = {
    arguments: true,
    completions: ["on", "off"],
    run: (commands, [value]) => {
        const ui = commands.ui;
        commands.require_edges();
        const values = { on: true, off: false };
        if (value !== undefined && !Object.hasOwn(values, value.toLowerCase())) {
            throw new Error(`"${value}" is not on or off: crossing-over takes on, off, or nothing.`);
        }
        commands.ensure_arrow();
        ui.arrow_options.set_crossing_over(
            ui, value === undefined ? null : values[value.toLowerCase()]);
    },
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
    "cross": "crossing-over",
    "waypoint": "checkpoint",
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
