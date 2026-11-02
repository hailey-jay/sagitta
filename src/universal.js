/// `:limit` (`:lim`) and `:colimit` (`:colim`): the cone, or cocone, over the selected objects
/// (and the ends of selected arrows), with the arrows among them as the diagram. One object is
/// added, beyond the diagram's top-left corner for a limit and its bottom-right for a colimit (or
/// completing the square of a pullback or pushout), with a leg to (or from) each object no arrow
/// of the diagram reaches (or leaves), since the others' legs are composites; `all` draws every
/// leg. Its label is guessed from the shape (see `Universal.guess`), and `universal` adds a
/// second cone `X` and the unique arrow from it, dashed. The new cells are one step to undo,
/// selected and queued for labels.
class Universal {
    /// The diagram the selection of `ui` gives: its objects, in reading order, and its arrows.
    static diagram(ui) {
        const objects = new Set();
        for (const cell of ui.selection) {
            for (const end of cell.is_vertex() ? [cell] : [cell.source, cell.target]) {
                if (end.is_vertex()) {
                    objects.add(end);
                }
            }
        }
        const vertices = Array.from(objects).sort((a, b) =>
            a.position.y - b.position.y || a.position.x - b.position.x);
        const arrows = ui.quiver.all_cells().filter((cell) => cell.is_edge() && !cell.is_loop()
            && objects.has(cell.source) && objects.has(cell.target)
            && cell.options.style.name === "arrow");
        return { vertices, arrows };
    }

    /// A label set beside others in a product, in brackets if it is more than one symbol.
    static factor(label) {
        const trimmed = label.trim();
        return /^\\?[A-Za-z]+(?:[_^](?:\{[^{}]*\}|\w))*'*$/.test(trimmed) ? trimmed
            : `(${trimmed})`;
    }

    /// What the (co)limit of `{ vertices, arrows }` is called, and how its legs are labelled and
    /// drawn, by its shape: `{ label, legs, corner, place }`, where `legs` maps each object that
    /// takes a leg to `{ label, preset }`, `corner` is the object a pullback or pushout's corner
    /// mark points to, and `place` the cell that completes its square.
    static guess({ vertices, arrows }, colimit, additive) {
        const labels = vertices.map((vertex) => vertex.label.trim());
        const named = labels.every((label) => label !== "");
        const into = (vertex) => arrows.filter((arrow) => arrow.target === vertex);
        const out_of = (vertex) => arrows.filter((arrow) => arrow.source === vertex);
        // The objects that need a leg: those no arrow reaches, for a limit, or leaves, for a
        // colimit. A diagram where every object has one (a cycle) takes a leg to each.
        const ends = vertices.filter((vertex) => (colimit ? out_of : into)(vertex).length === 0);
        const legs = new Map((ends.length > 0 ? ends : vertices)
            .map((vertex) => [vertex, { label: "", preset: "plain" }]));
        const numbered = (i) => `\\${colimit ? "iota" : "pi"}_${i}`;
        if (arrows.length === 0 && vertices.length >= 2 && named) {
            // A product, or coproduct, with its projections or injections numbered.
            const sign = additive ? " \\oplus " : colimit ? " \\sqcup " : " \\times ";
            vertices.forEach((vertex, i) => legs.set(vertex,
                { label: numbered(i + 1), preset: "plain" }));
            return { label: labels.map(Universal.factor).join(sign), legs };
        }
        if (vertices.length === 2 && arrows.length >= 2
            && arrows.every((arrow) => arrow.source === arrows[0].source)) {
            // A parallel pair: its equaliser, a mono into the source, or its coequaliser, an epi
            // out of the target.
            const maps = arrows.map((arrow) => arrow.label.trim());
            const of = maps.every((map) => map !== "") ? `(${maps.join(", ")})` : "";
            const [vertex] = legs.keys();
            legs.set(vertex, { label: "", preset: colimit ? "epi" : "mono" });
            return { label: `\\mathrm{${colimit ? "coeq" : "eq"}}${of}`, legs };
        }
        if (vertices.length === 2 && arrows.length === 1 && additive) {
            // A kernel, a mono into the source, or a cokernel, an epi out of the target.
            const map = arrows[0].label.trim();
            const [vertex] = legs.keys();
            legs.set(vertex, { label: "", preset: colimit ? "epi" : "mono" });
            return { label: `${colimit ? "\\operatorname{coker}" : "\\ker"}${
                map === "" ? "" : ` ${Universal.factor(map)}`}`, legs };
        }
        if (vertices.length === 3 && arrows.length === 2 && named) {
            // A cospan `A → C ← B` has a pullback, and a span `A ← C → B` a pushout.
            const middle = vertices.find((vertex) =>
                (colimit ? out_of : into)(vertex).length === 2);
            if (middle !== undefined) {
                // The factor across the square from the row the new object shares comes first,
                // as `X \times_Z Y` for `X` below it and `Y` beside it.
                const [a, b] = vertices.filter((vertex) => vertex !== middle).sort((a, b) =>
                    a.position.x - b.position.x || b.position.y - a.position.y);
                const over = middle.label.trim();
                legs.clear();
                legs.set(a, { label: numbered(1), preset: "plain" });
                legs.set(b, { label: numbered(2), preset: "plain" });
                return {
                    label: `${Universal.factor(a.label)} ${colimit ? "\\sqcup" : "\\times"}_${
                        /^\w$/.test(over) ? over : `{${over}}`} ${Universal.factor(b.label)}`,
                    legs,
                    corner: middle,
                    place: a.position.add(b.position).sub(middle.position),
                };
            }
        }
        return { label: colimit ? "\\operatorname{colim}" : "\\lim", legs };
    }

    /// The first free cell of `ui` from `start`, stepping by `step`, leaving out `taken`.
    static free(ui, start, step, taken = []) {
        let at = start;
        while (ui.positions.has(`${at}`) || taken.some((position) => position.eq(at))) {
            at = at.add(step);
        }
        return at;
    }

    /// Add the limit, or with `colimit` the colimit, of the selection of `ui`, by `options`
    /// (`all`, `universal`, and `additive`, as `Universal.SCHEMA` describes them).
    static add(ui, colimit, { all = false, universal = false, additive = false } = {}) {
        const diagram = Universal.diagram(ui);
        const amscd = ui.format === "amscd";
        if (diagram.vertices.length === 0) {
            // The limit of nothing: a terminal object, or an initial one, at the focus point.
            const at = ui.focus_position;
            if (ui.positions.has(`${at}`)) {
                throw new Error(`Select the diagram to take the ${colimit ? "colimit" : "limit"
                } of, or move the focus point to an empty cell for ${colimit ? "an initial"
                    : "a terminal"} object.`);
            }
            return Universal.place(ui, [{ label: colimit ? "0" : "1", position: at }], []);
        }
        const guess = Universal.guess(diagram, colimit, additive);
        if (all) {
            for (const vertex of diagram.vertices) {
                if (!guess.legs.has(vertex)) {
                    guess.legs.set(vertex, { label: "", preset: "plain" });
                }
            }
        }
        const xs = diagram.vertices.map((vertex) => vertex.position.x);
        const ys = diagram.vertices.map((vertex) => vertex.position.y);
        const step = colimit ? new Position(1, 1) : new Position(-1, -1);
        const corner = colimit ? new Position(Math.max(...xs), Math.max(...ys))
            : new Position(Math.min(...xs), Math.min(...ys));
        const at = guess.place !== undefined && !ui.positions.has(`${guess.place}`)
            ? guess.place : Universal.free(ui, corner.add(step), step);
        const vertices = [{ label: guess.label, position: at }];
        // Each edge is `{ source, target, label, preset }`, or `{ ..., type }` for a corner mark,
        // an end being a vertex already there or an index into `vertices`.
        const edges = Array.from(guess.legs).map(([vertex, { label, preset }]) => colimit
            ? { source: vertex, target: 0, label, preset }
            : { source: 0, target: vertex, label, preset });
        if (guess.corner !== undefined && !amscd) {
            edges.push({ source: 0, target: guess.corner, label: "",
                type: ui.settings.get("diagram.var_corner") ? "corner-inverse" : "corner" });
        }
        if (universal) {
            const away = Universal.free(ui, at.add(step), step, [at]);
            vertices.push({ label: "X", position: away });
            for (const vertex of guess.legs.keys()) {
                edges.push(colimit ? { source: vertex, target: 1, label: "", preset: "plain" }
                    : { source: 1, target: vertex, label: "", preset: "plain" });
            }
            edges.push({ source: colimit ? 0 : 1, target: colimit ? 1 : 0, label: "\\exists !",
                preset: "dashed" });
        }
        if (amscd) {
            const position = (end) => typeof end === "number" ? vertices[end].position
                : end.position;
            for (const edge of edges) {
                const [from, to] = [position(edge.source), position(edge.target)];
                if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1) {
                    throw new Error(`amscd has no diagonal or long arrows, which this ${
                        colimit ? "colimit" : "limit"} needs: switch to tikz-cd for it.`);
                }
            }
        }
        return Universal.place(ui, vertices, edges);
    }

    /// Add `vertices` and `edges` (see `add`) to `ui` as one step, select them, and queue them.
    static place(ui, vertices, edges) {
        const added = [];
        ui.add_cells(() => {
            const made = vertices.map(({ label, position }) => new Vertex(ui, label, position));
            added.push(...made);
            const end = (end) => typeof end === "number" ? made[end] : end;
            for (const { source, target, label, preset, type } of edges) {
                let options;
                if (type !== undefined) {
                    options = Edge.default_options(null, { name: type });
                } else {
                    const { style, level = 1 } = Presets.style(preset);
                    options = Edge.default_options({ level }, style);
                }
                added.push(new Edge(ui, label, end(source), end(target), options));
            }
        });
        ui.draw_unrendered?.();
        for (const cell of added) {
            cell.element.query_selector("kbd")?.class_list.add("queue");
        }
        const cells = new Set(added);
        ui.history.add(ui, [{ kind: "create", cells }]);
        ui.deselect();
        ui.select(...cells);
        return cells;
    }
}

/// The options `:limit` and `:colimit` take, as `Presets.parse` reads them.
Universal.SCHEMA = {
    all: { kind: "flag", default: false, title: "every leg" },
    universal: { kind: "flag", default: false, title: "the universal property" },
    additive: { kind: "flag", default: false, title: "additive: direct sums, kernels, cokernels" },
};

for (const [name, short, colimit] of [["limit", "lim", false], ["colimit", "colim", true]]) {
    Commands.TABLE[name] = {
        arguments: true,
        completions: Presets.completions(Universal.SCHEMA),
        run: (commands, words) => Universal.add(commands.ui, colimit,
            Presets.parse(words, Universal.SCHEMA, name)),
    };
    Commands.ALIASES[short] = name;
    Commands.SHORT[short] = name;
}
