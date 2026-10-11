/// The arrow options behind the palette: what the selection currently holds, and the edits that
/// change it. The command line, the command layer, and the mode line all go through here (see
/// `src/keymap.js`), and every edit records its own history action, so an edit made from a key
/// binding undoes exactly like one made from a command.
///
/// Nothing here draws: the mode line reads the values back to report them, and rendering is the
/// history's business (see `History.effect`).
class ArrowOptions {
    constructor() {
        // The edge and label colours of the selection, which the colour picker edits. These may
        // differ from the colour in the picker itself.
        this.colour = Colour.black();
        this.label_colour = Colour.black();

        // The arrow options of edges switched to a non-arrow style (adjunction, corner), so that
        // switching back to an arrow restores what they had rather than the defaults. Weak, so an
        // edge that is deleted takes its memory with it.
        this.remembered = new WeakMap();
    }

    /// The selected edges.
    static edges(ui) {
        return Array.from(ui.selection).filter((cell) => cell.is_edge());
    }

    /// The value `get` takes over every cell in `cells`, or `null` if they do not agree. Cells for
    /// which `get` returns `undefined` are not counted.
    static common(cells, get) {
        let common;
        for (const cell of cells) {
            const value = get(cell);
            if (value === undefined) {
                continue;
            }
            if (common === undefined) {
                common = value;
                continue;
            }
            // Good enough for our purposes: the only object values are `shorten` and the styles.
            if (JSON.stringify(common) !== JSON.stringify(value)) {
                return null;
            }
        }
        return common === undefined ? null : common;
    }

    /// Whether `property` applies to the selection at all: the loop-only and non-loop-only
    /// properties need an edge of that kind, and most need every selected edge to be an arrow,
    /// since adjunctions and corners have no curve, level, or length.
    applies(ui, property) {
        const edges = ArrowOptions.edges(ui);
        if (edges.length === 0) {
            return false;
        }
        const { only = null, arrow_only = false } = ArrowOptions.PROPERTIES[property];
        if (only !== null && !edges.some(ArrowOptions.KINDS[only])) {
            return false;
        }
        return !arrow_only || edges.every((edge) => edge.options.style.name === "arrow");
    }

    /// The value of `property` across the selection: a number, a pair for `length`, or `null` if
    /// the selected edges disagree or it does not apply to them.
    value(ui, property) {
        if (!this.applies(ui, property)) {
            return null;
        }
        const { only = null } = ArrowOptions.PROPERTIES[property];
        return ArrowOptions.common(ArrowOptions.edges(ui), (edge) => {
            if (only !== null && !ArrowOptions.KINDS[only](edge)) {
                return undefined;
            }
            if (property === "length") {
                return [edge.options.shorten.source, 100 - edge.options.shorten.target];
            }
            return edge.options[property];
        });
    }

    /// `values` (one per thumb) brought inside `property`'s range, rounded to its step counted from
    /// `min` (so that a loop's radius stays odd), and, for `length`, kept in order and far enough
    /// apart.
    static clamp(property, values) {
        const { min, max, step, spacing = 0, wraps = false } = ArrowOptions.PROPERTIES[property];
        const clamped = values.map((value) => {
            let result = min + Math.round((Number(value) - min) / step) * step;
            if (wraps) {
                result = (result - min) % (max - min);
                result += result < 0 ? max : min;
                return result;
            }
            return Math.min(Math.max(result, min), max);
        });
        if (clamped.length === 2 && clamped[1] - clamped[0] < spacing) {
            clamped[1] = Math.min(clamped[0] + spacing, max);
            clamped[0] = Math.min(clamped[0], clamped[1] - spacing);
        }
        // A single value rounds to a number; `length` stays a pair, as the history expects.
        return ArrowOptions.PROPERTIES[property].thumbs === 1 ? clamped[0] : clamped;
    }

    /// Set `property` across the selected edges, collapsing into the previous history event if it
    /// changed the same property, so that holding a key down undoes in one step.
    set(ui, property, values) {
        const value = ArrowOptions.clamp(property, values);
        const { only = null } = ArrowOptions.PROPERTIES[property];
        ui.unqueue_selected();
        ui.history.add_or_modify_previous(ui, [property, ui.selection], [{
            kind: property,
            value,
            cells: ArrowOptions.edges(ui)
                .filter((edge) => only === null || ArrowOptions.KINDS[only](edge))
                .map((edge) => ({
                    edge,
                    from: property !== "length" ? edge.options[property]
                        : [edge.options.shorten.source, 100 - edge.options.shorten.target],
                    to: value,
                })),
        }]);
    }

    /// Step `property` by `delta` of its own step, from where the selection currently sits.
    step(ui, property, delta) {
        const { thumbs, default: fallback } = ArrowOptions.PROPERTIES[property];
        const current = this.value(ui, property) ?? fallback;
        const values = thumbs === 1 ? [current] : Array.from(current);
        const { step } = ArrowOptions.PROPERTIES[property];
        this.set(ui, property, values.map((value) => value + step * delta));
    }

    /// Nudge the selected edges with an arrow key. For arrows, `↑`/`↓` bend them toward their
    /// left/right (curve), which for a left-to-right arrow is up/down, and `←`/`→` shift them to
    /// their left/right (offset). For loops, `↑`/`↓` grow and shrink them (radius), and `←`/`→`
    /// turn them (angle, which wraps around). For routes, `↑`/`↓` round their corners more and
    /// less. Loops and routes take their own properties only when nothing else is selected.
    nudge(ui, position_delta) {
        const edges = ArrowOptions.edges(ui);
        const loops_only = edges.length > 0 && edges.every((edge) => edge.is_loop());
        const routes_only = edges.length > 0 && edges.every((edge) => edge.is_routed());
        let [property, delta] = position_delta.x !== 0
            ? ["offset", position_delta.x] : ["curve", position_delta.y];
        if (loops_only) {
            [property, delta] = position_delta.x !== 0
                ? ["angle", position_delta.x] : ["radius", -position_delta.y];
        } else if (routes_only && property === "curve") {
            // `↑` rounds a route's corners more. A route has no offset, so `←`/`→` do nothing.
            [property, delta] = ["rounding", -position_delta.y];
        }
        if (!this.applies(ui, property)) {
            return;
        }
        this.step(ui, property, delta);
    }

    /// The style of the arrow component `component` (`tail`, `body`, or `head`) across the
    /// selection, by the name the palette and `Commands.STYLES` use, or `null` if they disagree or
    /// the selection is not all arrows.
    style(ui, component) {
        const edges = ArrowOptions.edges(ui);
        if (edges.length === 0 || !edges.every((edge) => edge.options.style.name === "arrow")) {
            return null;
        }
        return ArrowOptions.common(edges, (edge) => {
            const style = edge.options.style[component];
            // `cell`, `hook`, and `harpoon` are distinguished names, and unique between components.
            switch (style.name) {
                case "cell":
                    return "solid";
                case "hook":
                case "harpoon":
                    return `${style.side}-${style.name}`;
                default:
                    return style.name;
            }
        });
    }

    /// Set the arrow component `component` to `data` (a style object, as in `Edge.default_options`)
    /// across the selected edges, which must already be arrows (see `ensure_arrow`).
    set_style(ui, component, data) {
        this.record(ui, (edge) => edge.options.style[component] = data);
    }

    /// The style data for `component`'s `value` (`top-hook`, `dashed`, ...), or `undefined`.
    static style_data(component, value) {
        const entry = ArrowOptions.STYLES[component].find(([name]) => name === value);
        return entry === undefined ? undefined : entry[2];
    }

    /// How the mode line reports `component`'s `value`, or `""`.
    static style_title(component, value) {
        const entry = ArrowOptions.STYLES[component].find(([name]) => name === value);
        return entry === undefined ? "" : entry[1];
    }

    /// How the mode line reports the edge type `value`, or `""`.
    static edge_type_title(value) {
        const entry = ArrowOptions.EDGE_TYPES.find(([name]) => name === value);
        return entry === undefined ? "" : entry[1];
    }

    /// The edge type (`arrow`, `adjunction`, `corner`, `corner-inverse`) across the selection, or
    /// `null` if the selected edges disagree.
    edge_type(ui) {
        return ArrowOptions.common(ArrowOptions.edges(ui), (edge) => edge.options.style.name);
    }

    /// Switch the selected edges to `name`, remembering the arrow options of those leaving an arrow
    /// style and restoring them for those returning to one. Loops have no edge type but `arrow`, so
    /// they are left alone.
    set_edge_type(ui, name) {
        this.record(ui, (edge) => {
            if (edge.is_loop() && name !== "arrow") {
                return;
            }
            const was_arrow = edge.options.style.name === "arrow";
            if (was_arrow && name !== "arrow") {
                // Keep what the arrow had, and clear what the other styles have no use for.
                this.remembered.set(edge, {
                    style: edge.options.style,
                    curve: edge.options.curve,
                    level: edge.options.level,
                    shorten: edge.options.shorten,
                });
                edge.options.curve = 0;
                edge.options.level = 1;
                edge.options.shorten = { source: 0, target: 0 };
            }
            if (name === "arrow") {
                if (was_arrow) {
                    // Switching an arrow to an arrow keeps its components: the selection may hold
                    // one arrow with a style the user set and another that is not an arrow at all.
                    return;
                }
                const remembered = this.remembered.get(edge);
                if (remembered !== undefined) {
                    Object.assign(edge.options, remembered);
                    this.remembered.delete(edge);
                    return;
                }
                edge.options.style = Edge.default_options().style;
                return;
            }
            edge.options.style = { name };
        });
    }

    /// Apply a corner, alternating between the two kinds when the selection is already all corners
    /// of one kind, and otherwise taking the kind last used (`diagram.var_corner`). This is what
    /// the `p` binding and the `corner` command do; `corner-var` names the inverse outright.
    toggle_corner(ui) {
        const current = this.edge_type(ui);
        let name;
        if (current === "corner") {
            name = "corner-inverse";
        } else if (current === "corner-inverse") {
            name = "corner";
        } else {
            name = ui.settings.get("diagram.var_corner") ? "corner-inverse" : "corner";
        }
        this.set_edge_type(ui, name);
        ui.settings.set("diagram.var_corner", name === "corner-inverse");
    }

    /// Whether the selected edges attach at the centre of the arrow at `end` (`source` or
    /// `target`), `false` if they attach at its midpoint, or `null` if the option does not apply,
    /// which is the usual case: only an arrow into an arrow that has a vertex at either end has it.
    endpoint(ui, end) {
        let checked = null;
        for (const edge of ArrowOptions.edges(ui)) {
            const other = edge[end];
            if (!other.is_edge() || !(other.source.is_vertex() || other.target.is_vertex())) {
                continue;
            }
            checked = (checked ?? true) && edge.options.edge_alignment[end];
        }
        return checked;
    }

    /// Flip whether the selected edges attach at the centre of the arrow at `end`.
    toggle_endpoint(ui, end) {
        const cells = new Set();
        for (const edge of ArrowOptions.edges(ui)) {
            if (edge[end].is_edge() && edge.options.edge_alignment[end] === this.endpoint(ui, end)) {
                cells.add(edge);
            }
        }
        ui.history.add(ui, [{ kind: "edge_alignment", cells, end }], true);
    }

    /// Whether the selected edges cross over the arrows drawn before them, or `null` if they
    /// disagree or are not all arrows, as only an arrow is drawn to cut a gap.
    crossing_over(ui) {
        const edges = ArrowOptions.edges(ui);
        if (edges.length === 0 || !edges.every((edge) => edge.options.style.name === "arrow")) {
            return null;
        }
        return ArrowOptions.common(edges, (edge) => edge.options.crossing_over > 0);
    }

    /// Bring the selected edges to the front of those crossing over others (`value` `true`), or
    /// stop them crossing over (`false`). With `value` `null`, bring them to the front unless
    /// every one crosses over already, in which case stop them. Brought to the front together,
    /// they share a rank, and stack among themselves as the export orders them. Returns whether
    /// anything changed.
    set_crossing_over(ui, value = null) {
        const edges = ArrowOptions.edges(ui);
        const on = value ?? !edges.every((edge) => edge.options.crossing_over > 0);
        const all = ui.quiver.all_cells().filter((cell) => cell.is_edge());
        const top = Math.max(0, ...all.map((edge) => edge.options.crossing_over));
        // Edges that are the front layer already, and alone in it, stay where they are.
        const in_front = top > 0 && all.every((edge) =>
            (edge.options.crossing_over === top) === edges.includes(edge));
        const rank = !on ? 0 : in_front ? top : top + 1;
        return ui.history.add(ui, [{
            kind: "crossing_over",
            crossings: edges.map((edge) => ({ edge, from: edge.options.crossing_over, to: rank })),
        }], true);
    }

    /// The route across the selection, as a list of `[x, y]` cells, or `null` if the selected
    /// edges disagree.
    route(ui) {
        return ArrowOptions.common(ArrowOptions.edges(ui), (edge) => edge.options.route);
    }

    /// Set the route of each selected edge, other than loops, to what `route` gives for it.
    /// Returns whether any changed.
    set_route(ui, route) {
        return ui.history.add(ui, [{
            kind: "route",
            routes: ArrowOptions.edges(ui).filter((edge) => !edge.is_loop()).map((edge) => ({
                edge,
                from: edge.options.route,
                to: route(edge),
            })),
        }], true);
    }

    /// The label alignment across the selection, or `null` if the selected edges disagree.
    label_alignment(ui) {
        return ArrowOptions.common(
            ArrowOptions.edges(ui), (edge) => edge.options.label_alignment);
    }

    /// Set the label alignment across the selected edges.
    set_label_alignment(ui, value) {
        ui.history.add(ui, [{
            kind: "label_alignment",
            alignments: ArrowOptions.edges(ui).map((edge) => ({
                edge,
                from: edge.options.label_alignment,
                to: value,
            })),
        }], true);
    }

    /// Apply `modify` to each selected edge, recording the difference it makes to their styles as
    /// one history action. The arrow options that go with a style (`curve` and friends) travel with
    /// it, so `modify` may change those too.
    record(ui, modify) {
        const clone = (value) => JSON.parse(JSON.stringify(value));
        const edges = ArrowOptions.edges(ui);
        const before = new Map(edges.map((edge) => [edge, clone(edge.options.style)]));
        ui.unqueue_selected();
        for (const edge of edges) {
            modify(edge);
        }
        ui.history.add(ui, [{
            kind: "style",
            styles: edges.map((edge) => ({
                edge,
                from: before.get(edge),
                to: clone(edge.options.style),
            })),
        }], true);
    }
}

/// The arrow components' styles, in the order the palette offers them: `[value, title, data]`,
/// where `value` is the name `Commands.STYLES` maps a word to, `title` is how the mode line reports
/// it, and `data` is what goes into an edge's `options.style`.
ArrowOptions.STYLES = {
    tail: [
        ["mono", "mono", { name: "mono" }],
        ["none", "no tail", { name: "none" }],
        ["maps to", "maps to", { name: "maps to" }],
        ["top-hook", "top hook", { name: "hook", side: "top" }],
        ["bottom-hook", "bottom hook", { name: "hook", side: "bottom" }],
        ["arrowhead", "arrowhead", { name: "arrowhead" }],
    ],
    body: [
        ["solid", "solid", { name: "cell" }],
        ["none", "no body", { name: "none" }],
        ["dashed", "dashed", { name: "dashed" }],
        ["dotted", "dotted", { name: "dotted" }],
        ["squiggly", "squiggly", { name: "squiggly" }],
        ["barred", "barred", { name: "barred" }],
        ["double barred", "double barred", { name: "double barred" }],
        ["bullet solid", "solid bullet", { name: "bullet solid" }],
        ["bullet hollow", "hollow bullet", { name: "bullet hollow" }],
    ],
    head: [
        ["arrowhead", "arrowhead", { name: "arrowhead" }],
        ["none", "no arrowhead", { name: "none" }],
        ["epi", "epi", { name: "epi" }],
        ["top-harpoon", "top harpoon", { name: "harpoon", side: "top" }],
        ["bottom-harpoon", "bottom harpoon", { name: "harpoon", side: "bottom" }],
    ],
};

/// The edge types, as `[value, title]`, in the order the palette offers them.
ArrowOptions.EDGE_TYPES = [
    ["arrow", "arrow"],
    ["adjunction", "adjunction"],
    ["corner", "corner"],
    ["corner-inverse", "corner (var)"],
];

/// The numeric arrow options, with the range each takes. `only` limits a property to one of
/// `ArrowOptions.KINDS`; `arrow_only` marks those that mean nothing to an adjunction or a corner;
/// `wraps` marks the one that turns rather than stopping at its ends; `spacing` is the least gap
/// between a pair of values; and `default` is what the palette reports for a selection that has
/// no value.
ArrowOptions.PROPERTIES = {
    label_position: { min: 0, max: 100, step: 10, thumbs: 1, default: 50 },
    offset: { min: -5, max: 5, step: 1, thumbs: 1, default: 0, only: "unrouted" },
    rounding: { min: 0, max: 8, step: 1, thumbs: 1, default: 3, only: "routed", arrow_only: true },
    curve: { min: -5, max: 5, step: 1, thumbs: 1, default: 0, only: "curved", arrow_only: true },
    radius: { min: -5, max: 5, step: 2, thumbs: 1, default: 0, only: "loop", arrow_only: true },
    angle: {
        min: -180, max: 180, step: 45, thumbs: 1, default: 0,
        only: "loop", arrow_only: true, wraps: true,
    },
    length: {
        min: 0, max: 100, step: 10, thumbs: 2, spacing: 20, default: [0, 100], arrow_only: true,
    },
    level: {
        min: 1, max: CONSTANTS.MAXIMUM_CELL_LEVEL, step: 1, thumbs: 1, default: 1,
        arrow_only: true,
    },
};

/// The kinds of edge a property may be limited to (see `ArrowOptions.PROPERTIES`): a route has no
/// curve or offset, and only a route has corners to round.
ArrowOptions.KINDS = {
    loop: (edge) => edge.is_loop(),
    curved: (edge) => !edge.is_loop() && !edge.is_routed(),
    routed: (edge) => edge.is_routed(),
    unrouted: (edge) => !edge.is_routed(),
};
