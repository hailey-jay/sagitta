/// The formats a diagram's file is written in, and what each can express. A diagram is in one of
/// them at a time (`UI.format`), which its file's contents decide when it is opened (`detect`):
///
/// - tikz-cd (`QuiverImportExport.tikz_cd`), which holds anything the editor draws;
/// - amscd's `CD` environment (`QuiverImportExport.amscd`), which holds only a grid of objects
///   with straight arrows between neighbours, plain or equals, labelled on either side.
///
/// The canvas lays a diagram out as its format's output is laid out, so that it looks like the PDF
/// in either (see `AmsCD.layout`). Switching to a format that cannot hold the diagram first lists
/// what would be lost (`AmsCD.problems`), and converting drops it (`AmsCD.convert`).
///
/// Inline maths (`InlineMaths`), a row of objects and arrows as a formula, is written only to the
/// clipboard, from the export layer.
class Formats {
    /// The format of the diagram in `text`, the contents of its file: `amscd` for a `CD`
    /// environment, and tikz-cd for anything else, which reports a file with neither as it always
    /// has.
    static detect(text) {
        const cd = text.indexOf("\\begin{CD}");
        const tikzcd = text.indexOf("\\begin{tikzcd}");
        return cd !== -1 && (tikzcd === -1 || cd < tikzcd) ? "amscd" : "tikz-cd";
    }

    /// What `format` cannot express of `quiver`, as `[description, cells]` pairs, briefly and in
    /// the order the confirmation lists them; none for tikz-cd.
    static problems(format, quiver) {
        return format === "amscd" ? AmsCD.problems(quiver) : [];
    }

    /// What `format` could not draw of `quiver` if its vertices moved as `displacements` (`{
    /// vertex, to }`) say, briefly (as `problems` describes it), or `null` if it could draw it
    /// all. Moves are refused before they are made, rather than taken back after, so that no
    /// sequence of them, however quick, leaves the diagram in a state the format cannot draw.
    static refuses_move(format, quiver, displacements) {
        if (format === "tikz-cd") {
            return null;
        }
        const before = displacements.map(({ vertex }) => vertex.position);
        displacements.forEach(({ vertex, to }) => vertex.position = to);
        try {
            const problems = Formats.problems(format, quiver);
            return problems.length === 0 ? null : problems[0][0];
        } finally {
            displacements.forEach(({ vertex }, i) => vertex.position = before[i]);
        }
    }
}

/// `problems` (see `Formats.problems`) briefly, each with how many cells it holds, as
/// `curves (2) and loops (1)`.
Formats.describe = (problems) => {
    const parts = problems.map(([description, cells]) => `${description} (${cells.length})`);
    return parts.length < 3 ? parts.join(" and ")
        : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
};

/// The formats, in the order the export layer offers them, with what the mode line calls them.
Formats.NAMES = ["tikz-cd", "amscd"];

/// amscd's `CD` environment: objects in a grid, and between neighbours in a row `@>a>b>` (right),
/// `@<a<b<` (left), `@=` (equals), or `@.` (nothing), and between neighbours in a column, on a row
/// of their own, `@VaVbV` (down), `@AaAbA` (up), `@|` (equals), or `@.`. An arrow's first label
/// is above it, or to its left, and the second below, or to its right.
class AmsCD {
    /// How `edge` is written in a `CD` environment, as `{ axis, letter, from, labels }`, or the
    /// reason it cannot be, as a string. `axis` is `"x"` for an arrow along a row and `"y"` for one
    /// down a column; `letter` is amscd's (`>`, `<`, `=`, `V`, `A`, `|`); `from` is the position of
    /// the end above or to the left, whose slot the arrow takes; `labels` is the label above or to
    /// the left, and the one below or to the right.
    static slot(edge) {
        if (edge.source.is_edge() || edge.target.is_edge()) {
            return "arrows on arrows";
        }
        if (edge.is_loop()) {
            return "loops";
        }
        const name = edge.options.style.name;
        if (name === "adjunction") {
            return "adjunctions";
        }
        if (name !== "arrow") {
            return "corners";
        }
        const [source, target] = [edge.source.position, edge.target.position];
        const [dx, dy] = [target.x - source.x, target.y - source.y];
        if (Math.abs(dx) + Math.abs(dy) !== 1) {
            return "arrows that are not between neighbours";
        }
        const { tail, body, head } = edge.options.style;
        const plain = edge.options.level === 1 && tail.name === "none" && body.name === "cell"
            && head.name === "arrowhead";
        const equals = edge.options.level === 2 && tail.name === "none" && body.name === "cell"
            && head.name === "none";
        if (!plain && !equals) {
            return "styles other than plain and equals";
        }
        const axis = dx !== 0 ? "x" : "y";
        // Left of an arrow going right, or up, is above it, or to its left; going left or down,
        // it is the other side.
        const forward = dx > 0 || dy < 0;
        const sides = forward ? ["left", "right"] : ["right", "left"];
        const label = edge.label;
        const alignment = edge.options.label_alignment;
        const labels = sides.map((side) => alignment === side ? label : "");
        const letter = equals ? (axis === "x" ? "=" : "|")
            : axis === "x" ? (dx > 0 ? ">" : "<") : (dy > 0 ? "V" : "A");
        return {
            axis,
            letter,
            from: dx > 0 || dy > 0 ? source : target,
            labels,
        };
    }

    /// What a `CD` environment cannot express of `quiver`, as `[description, cells]` pairs: the
    /// arrows it cannot draw at all, which converting deletes, then what it cannot draw of those it
    /// can, which converting resets.
    static problems(quiver) {
        const found = new Map();
        const add = (description, cell) => {
            if (!found.has(description)) {
                found.set(description, []);
            }
            found.get(description).push(cell);
        };
        const slots = new Map();
        for (const edge of quiver.all_cells().filter((cell) => cell.is_edge())) {
            const slot = AmsCD.slot(edge);
            if (typeof slot === "string") {
                add(slot, edge);
                continue;
            }
            const key = `${slot.axis} ${slot.from}`;
            if (slots.has(key)) {
                add("more than one arrow between neighbours", edge);
                continue;
            }
            slots.set(key, edge);
            const { options } = edge;
            if (options.curve !== 0) {
                add("curves", edge);
            }
            if (options.offset !== 0) {
                add("offsets", edge);
            }
            if (options.route.length > 0) {
                add("routes", edge);
            }
            if (options.shorten.source !== 0 || options.shorten.target !== 0) {
                add("shortening", edge);
            }
            if (options.crossing_over > 0) {
                add("crossing over", edge);
            }
            if (edge.label !== "" && options.label_position !== 50) {
                add("label positions", edge);
            }
            if (edge.label !== "" && ["centre", "over"].includes(options.label_alignment)) {
                add("labels centred on the arrow", edge);
            }
            if (edge.label !== "" && "=|".includes(slot.letter)) {
                add("labels on equals", edge);
            }
            if (options.colour.is_not_black() || edge.label !== ""
                && edge.label_colour.is_not_black()) {
                add("arrow colours", edge);
            }
        }
        return Array.from(found);
    }

    /// Convert the diagram of `ui` to one a `CD` environment can hold, as one step to undo with
    /// the switch to amscd: the arrows it cannot draw are deleted, and the rest drawn as it draws
    /// them. Returns the history actions, already done.
    static convert(ui) {
        const actions = [];
        const problems = AmsCD.problems(ui.quiver);
        const dropped = new Set();
        for (const [, cells] of problems) {
            for (const cell of cells) {
                const slot = AmsCD.slot(cell);
                if (typeof slot === "string") {
                    dropped.add(cell);
                }
            }
        }
        // The second of two arrows between the same neighbours goes too.
        for (const [description, cells] of problems) {
            if (description === "more than one arrow between neighbours") {
                cells.forEach((cell) => dropped.add(cell));
            }
        }
        // Whatever depends on a dropped arrow (an arrow on it) goes with it.
        const deleted = ui.quiver.transitive_dependencies(dropped);
        if (deleted.size > 0) {
            const action = { kind: "delete", cells: deleted };
            ui.history.effect(ui, [action], false);
            actions.push(action);
        }
        // The rest keep their ends and labels, drawn plainly.
        const kept = ui.quiver.all_cells().filter((cell) => cell.is_edge());
        const modifications = (property, value, get = (edge) => edge.options[property]) => kept
            .filter((edge) => JSON.stringify(get(edge)) !== JSON.stringify(value(edge)))
            .map((edge) => ({ edge, from: get(edge), to: value(edge) }));
        const changed = [
            { kind: "curve", curves: modifications("curve", () => 0) },
            { kind: "offset", offsets: modifications("offset", () => 0) },
            { kind: "route", routes: modifications("route", () => []) },
            // A length is the pair of where the arrow starts and ends, in percent of the way.
            { kind: "length", lengths: modifications("shorten", () => [0, 100],
                (edge) => [edge.options.shorten.source, 100 - edge.options.shorten.target]) },
            { kind: "crossing_over", crossings: modifications("crossing_over", () => 0) },
            { kind: "label_position", label_positions: modifications("label_position", () => 50) },
            { kind: "label_alignment", alignments: modifications("label_alignment",
                (edge) => ["centre", "over"].includes(edge.options.label_alignment)
                    ? "left" : edge.options.label_alignment) },
            { kind: "colour", colours: modifications("colour", () => Colour.black()) },
        ];
        // Labels on equals, which amscd cannot set, and colours on labels, which it cannot draw.
        const labels = kept.filter((edge) => edge.label !== "" && "=|".includes(
            AmsCD.slot(edge).letter)).map((edge) => ({ cell: edge, from: edge.label, to: "" }));
        const label_colours = kept.filter((edge) => edge.label_colour.is_not_black())
            .map((edge) => ({ cell: edge, from: edge.label_colour, to: Colour.black() }));
        changed.push({ kind: "label", labels }, { kind: "label_colour", label_colours });
        for (const action of changed.filter(History.changes)) {
            ui.history.effect(ui, [action], false);
            actions.push(action);
        }
        return actions;
    }

    /// The label `label` as an argument of an amscd arrow ending at `delimiter`, braced unless it
    /// is a single word that holds no delimiter.
    static argument(label, delimiter) {
        return /^[a-zA-Z0-9]*$/.test(label) && !label.includes(delimiter) ? label : `{${label}}`;
    }
}

/// amscd's dimensions in a 10pt document, in pt, which the canvas lays the diagram out by (see
/// `AmsCD.layout`), measured from what pdfTeX sets.
AmsCD.TEX = {
    // The baselines of the rows are `BASELINE` apart, or a row's depth, the next one's height, and
    // `LINESKIP` apart, if that is more (`\baselineskip20\ex@`, `\lineskip3\ex@`).
    BASELINE: 20,
    LINESKIP: 3,
    // The maths axis, which a horizontal arrow and the middle of a vertical one are on.
    AXIS: 2.5,
    // A horizontal arrow is `\minCDarrowwidth` long, or as long as a label and three thick spaces
    // (`\;{#1}\;\;` in script style), and has an `\enskip` either side.
    ARROW: 30,
    LABEL_SPACE: 3 * 2.27623,
    ENSKIP: 5,
    // How high the arrow's box is, which a label above it is set over, as a `\mathop` with
    // `\limits`, the label a gap above it: `BIGOP1`, or less the label's depth from `BIGOP3`.
    // A label below it is `BIGOP2` below the baseline, or its height less from `BIGOP4`.
    ARROW_HEIGHT: 3.66875,
    BIGOP1: 1.11111,
    BIGOP2: 1.66667,
    BIGOP3: 1.99998,
    BIGOP4: 6,
    BIGOP5: 1,
    // `@=`: two rules 2pt apart, over the baseline, so that their middle is 1.4pt above it.
    EQUALS_MIDDLE: 1.4,
    EQUALS_HEIGHT: 2.8,
    // A vertical arrow is `\Big\downarrow`, centred on the axis: 18pt from end to end, in a box
    // 6.67pt wide, against whose sides its labels are set, centred on the axis too.
    VERTICAL_HEIGHT: 11.5,
    VERTICAL_DEPTH: 6.5,
    VERTICAL_WIDTH: 6.66669,
    // `@|`, `\Big\Vert`, is a little narrower.
    VERT_WIDTH: 5.55557,
};

/// Lay the diagram of `ui` out as amscd sets it, in pixels: each column's centre and the space
/// between it and the next, each row's axis, and where each arrow starts and ends, against the
/// position of its source's centre, which `Grid.fix` and `Edge.render` draw from.
///
/// amscd sets the diagram as one `\halign`: a column for each column of objects, with a column for
/// the horizontal arrows between each two, as wide as the widest arrow in it, and a row for each
/// row of objects, with a row for the vertical arrows between each two that have any.
AmsCD.layout = (ui) => {
    const T = AmsCD.TEX;
    const px = Edge.PX_PER_PT;
    const vertices = ui.quiver.all_cells().filter((cell) => cell.is_vertex());
    if (vertices.length === 0) {
        return null;
    }
    const xs = vertices.map((vertex) => vertex.position.x);
    const ys = vertices.map((vertex) => vertex.position.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // A label's box, in pt: its width, and how far it reaches above and below its baseline.
    const vertex_box = (vertex) => vertex.box === null || vertex.box === undefined
        ? { width: 0, height: 0, depth: 0 }
        : { width: vertex.box.width / px, height: vertex.box.height / px,
            depth: vertex.box.depth / px };
    const label_box = (edge) => edge.label === "" || edge.tex === undefined
        ? { width: 0, height: 0, depth: 0 }
        : { width: edge.tex.width / px, height: edge.tex.ascent / px,
            depth: edge.tex.descent / px };

    const slots = new Map();
    for (const edge of ui.quiver.all_cells().filter((cell) => cell.is_edge())) {
        const slot = AmsCD.slot(edge);
        if (typeof slot !== "string" && !slots.has(`${slot.axis} ${slot.from}`)) {
            slots.set(`${slot.axis} ${slot.from}`, { edge, ...slot });
        }
    }
    const slot_at = (axis, x, y) => slots.get(`${axis} ${new Position(x, y)}`) ?? null;

    // How long a horizontal arrow is, and how high and deep its cell is with its labels.
    const horizontal = (slot) => {
        if (slot.letter === "=") {
            return { length: T.ARROW, height: T.EQUALS_HEIGHT, depth: 0 };
        }
        const [above, below] = [slot.labels[0] !== "", slot.labels[1] !== ""]
            .map((labelled) => labelled ? label_box(slot.edge) : null);
        const length = Math.max(T.ARROW, ...[above, below].filter((box) => box !== null)
            .map((box) => box.width + T.LABEL_SPACE));
        const height = above === null ? T.ARROW_HEIGHT : T.ARROW_HEIGHT
            + Math.max(T.BIGOP1, T.BIGOP3 - above.depth) + above.depth + above.height + T.BIGOP5;
        const depth = below === null ? 0
            : Math.max(T.BIGOP2, T.BIGOP4 - below.height) + below.height + below.depth + T.BIGOP5;
        return { length, height, depth };
    };

    // The columns: each column of objects, and after it the column of arrows to the next.
    const width = new Map();
    const arrows = new Map();
    for (let x = x0; x <= x1; ++x) {
        let w = 0;
        for (const vertex of vertices.filter((vertex) => vertex.position.x === x)) {
            w = Math.max(w, vertex_box(vertex).width);
        }
        for (let y = y0; y < y1; ++y) {
            const slot = slot_at("y", x, y);
            if (slot !== null) {
                w = Math.max(w, slot.letter === "|" ? T.VERT_WIDTH : T.VERTICAL_WIDTH);
            }
        }
        width.set(x, w);
        let a = 0;
        for (let y = y0; y <= y1; ++y) {
            const slot = slot_at("x", x, y);
            if (slot !== null) {
                a = Math.max(a, horizontal(slot).length + 2 * T.ENSKIP);
            }
        }
        arrows.set(x, a);
    }
    const centre = new Map();
    let left = 0;
    for (let x = x0; x <= x1; ++x) {
        centre.set(x, left + width.get(x) / 2);
        left += width.get(x) + arrows.get(x);
    }

    // The rows: each row of objects, and after it a row of vertical arrows, if it has any.
    const row = (y) => {
        let [height, depth] = [0, 0];
        for (const vertex of vertices.filter((vertex) => vertex.position.y === y)) {
            const box = vertex_box(vertex);
            [height, depth] = [Math.max(height, box.height), Math.max(depth, box.depth)];
        }
        for (let x = x0; x < x1; ++x) {
            const slot = slot_at("x", x, y);
            if (slot !== null) {
                const cell = horizontal(slot);
                [height, depth] = [Math.max(height, cell.height), Math.max(depth, cell.depth)];
            }
        }
        return { height, depth };
    };
    const verticals = (y) => {
        let found = false;
        let [height, depth] = [T.VERTICAL_HEIGHT, T.VERTICAL_DEPTH];
        for (let x = x0; x <= x1; ++x) {
            const slot = slot_at("y", x, y);
            if (slot === null) {
                continue;
            }
            found = true;
            for (const labelled of slot.labels.filter((label) => label !== "")) {
                const box = label_box(slot.edge);
                const half = (box.height + box.depth) / 2;
                [height, depth] = [Math.max(height, T.AXIS + half),
                    Math.max(depth, half - T.AXIS)];
            }
        }
        return found ? { height, depth } : null;
    };
    // Each row's baseline, downwards from the first's.
    const baseline = new Map();
    const middle = new Map();
    let previous = null;
    let y_at = 0;
    const next = (box) => {
        if (previous !== null) {
            y_at += Math.max(T.BASELINE, previous.depth + box.height + T.LINESKIP);
        }
        previous = box;
        return y_at;
    };
    for (let y = y0; y <= y1; ++y) {
        baseline.set(y, next(row(y)));
        const between = y < y1 ? verticals(y) : null;
        if (between !== null) {
            middle.set(y, next(between) - T.AXIS);
        }
    }

    // Where each arrow starts and ends, against its source's centre, in pt.
    const ends = new Map();
    for (const slot of slots.values()) {
        const { edge, axis, letter, from } = slot;
        const source = edge.source.position;
        // The source's centre, on its row's axis.
        const origin = new Point(centre.get(source.x), baseline.get(source.y) - T.AXIS);
        let [start, end] = [null, null];
        if (axis === "x") {
            const length = horizontal(slot).length;
            const mid = centre.get(from.x) + width.get(from.x) / 2 + arrows.get(from.x) / 2;
            // `@=` sits on the baseline, a little below the axis.
            const level = baseline.get(from.y)
                - (letter === "=" ? T.EQUALS_MIDDLE : T.AXIS);
            [start, end] = [new Point(mid - length / 2, level), new Point(mid + length / 2, level)];
        } else {
            const mid = middle.get(from.y);
            const half = (T.VERTICAL_HEIGHT + T.VERTICAL_DEPTH) / 2;
            [start, end] = [new Point(centre.get(from.x), mid - half),
                new Point(centre.get(from.x), mid + half)];
        }
        // An arrow going left or up starts at the right or the bottom.
        if (edge.source.position.x > edge.target.position.x
            || edge.source.position.y > edge.target.position.y) {
            [start, end] = [end, start];
        }
        ends.set(edge, {
            start: start.sub(origin).mul(px),
            end: end.sub(origin).mul(px),
            // A label is set a gap from the line: above a horizontal arrow, over its box, and
            // below, under the baseline; beside a vertical one, against its glyph's box.
            gap: (() => {
                if (axis === "y") {
                    return { x: T.VERTICAL_WIDTH / 2 * px, y: 0 };
                }
                const box = label_box(edge);
                const above = slot.labels[0] !== "";
                return {
                    x: 0,
                    y: (above ? T.ARROW_HEIGHT - T.AXIS
                        + Math.max(T.BIGOP1, T.BIGOP3 - box.depth)
                        : T.AXIS + Math.max(T.BIGOP2, T.BIGOP4 - box.height)) * px,
                };
            })(),
        });
    }

    // The grid's columns and rows run halfway between the centres of the objects', so that a
    // click lands on the nearest, and those at the ends reach as far beyond as the next is.
    const bounds = (indices, centres) => {
        const result = new Map();
        for (const [i, index] of indices.entries()) {
            const c = centres.get(index);
            const before = i > 0 ? (centres.get(indices[i - 1]) + c) / 2 : null;
            const after = i < indices.length - 1 ? (centres.get(indices[i + 1]) + c) / 2 : null;
            const reach = before === null && after === null ? null
                : before === null ? after - c : c - before;
            const low = before ?? c - (reach ?? 0);
            const high = after ?? c + (reach ?? 0);
            result.set(index, { size: (high - low) * px, centre: (c - low) * px });
        }
        return result;
    };
    const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const axes = new Map(range(y0, y1).map((y) => [y, baseline.get(y) - T.AXIS]));
    return {
        columns: bounds(range(x0, x1), centre),
        rows: bounds(range(y0, y1), axes),
        ends,
    };
};

/// The `CD` environment, written and read.
QuiverImportExport.amscd = new class extends QuiverImportExport {
    export(quiver, settings, options, definitions) {
        const dependencies = new Map([["amscd", new Set(["the CD environment"])]]);
        const incompatibilities = new Set(AmsCD.problems(quiver)
            .map(([description]) => description));
        const vertices = quiver.all_cells().filter((cell) => cell.is_vertex());
        const wrap = (body) => {
            const cd = `\\begin{CD}\n${body.length > 0 ? `${body}\n` : ""}\\end{CD}`;
            if (settings.get("export.standalone")) {
                return `\\documentclass{standalone}\n\\usepackage{amscd}\n\\begin{document}\n$${
                    cd}$\n\\end{document}`;
            }
            // `CD` is maths, so it is set in `$ $` when it is not centred.
            return settings.get("export.centre_diagram") ? `\\[${cd}\\]` : `$${cd}$`;
        };
        if (vertices.length === 0) {
            return { data: wrap(""), metadata: { tikz_incompatibilities: incompatibilities,
                dependencies } };
        }
        const xs = vertices.map((vertex) => vertex.position.x);
        const ys = vertices.map((vertex) => vertex.position.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys),
            Math.max(...ys)];
        const at = new Map(vertices.map((vertex) => [`${vertex.position}`, vertex]));
        const slots = new Map();
        for (const edge of quiver.all_cells().filter((cell) => cell.is_edge())) {
            const slot = AmsCD.slot(edge);
            if (typeof slot !== "string" && !slots.has(`${slot.axis} ${slot.from}`)) {
                slots.set(`${slot.axis} ${slot.from}`, slot);
            }
        }
        const slot_at = (axis, x, y) => slots.get(`${axis} ${new Position(x, y)}`) ?? null;

        const object = (vertex) => {
            if (vertex === undefined || vertex.label === "") {
                return "";
            }
            const label = AmsCD.object(vertex.label);
            if (vertex.label_colour.is_not_black()) {
                dependencies.set("xcolor", new Set(["coloured labels"]));
                return `\\textcolor${vertex.label_colour.latex(definitions.colours, true)}{${
                    label}}`;
            }
            return label;
        };
        const arrow = (slot) => {
            if (slot === null) {
                return "@.";
            }
            const { letter, labels: [first, second] } = slot;
            if ("=|".includes(letter)) {
                return `@${letter}`;
            }
            return `@${letter}${AmsCD.argument(first, letter)}${letter}${
                AmsCD.argument(second, letter)}${letter}`;
        };
        // Each row's cells, with the empty ones at its end left off.
        const trim = (cells, empty) => {
            while (cells.length > 0 && cells[cells.length - 1] === empty) {
                cells.pop();
            }
            return cells;
        };
        const rows = [];
        for (let y = y0; y <= y1; ++y) {
            const cells = [];
            for (let x = x0; x <= x1; ++x) {
                cells.push(object(at.get(`${new Position(x, y)}`)));
                if (x < x1) {
                    cells.push(arrow(slot_at("x", x, y)));
                }
            }
            // The row ends after its last object or arrow.
            while (cells.length > 0 && (cells[cells.length - 1] === ""
                || cells[cells.length - 1] === "@.")) {
                cells.pop();
            }
            rows.push(cells.filter((cell) => cell !== "").join(" "));
            if (y < y1) {
                const below = [];
                for (let x = x0; x <= x1; ++x) {
                    below.push(arrow(slot_at("y", x, y)));
                }
                if (below.some((cell) => cell !== "@.")) {
                    rows.push(trim(below, "@.").join(" "));
                }
            }
        }
        return {
            data: wrap(rows.map((row) => `\t${row}`).join(" \\\\\n")),
            metadata: { tikz_incompatibilities: incompatibilities, dependencies },
        };
    }

    import(ui, data) {
        this.begin_import(ui);
        const diagnostics = ui.add_cells(() => AmsCD.parse(ui, data), false);
        this.end_import(ui, ui.quiver.all_cells());
        return { diagnostics };
    }
};

/// An object's label as a cell of a `CD` environment: braced unless it is a single word, and set
/// in a table if it has several lines, as tikz-cd's are.
AmsCD.object = (label) => {
    if (label.includes("\\\\")) {
        return `{\\begin{array}{c} ${label} \\end{array}}`;
    }
    return /^\\?[a-zA-Z0-9]+$/.test(label) ? label : `{${label}}`;
};

/// Read the `CD` environment in `text` into the diagram of `ui`, returning the problems found
/// (`Parser.Error` and `Parser.Warning`), which do not throw.
AmsCD.parse = (ui, text) => {
    const diagnostics = [];
    const begin = text.indexOf("\\begin{CD}");
    const end = text.indexOf("\\end{CD}", begin);
    if (begin === -1 || end === -1) {
        diagnostics.push(new Parser.Error("Expected \\begin{CD} and \\end{CD}.", null));
        return diagnostics;
    }
    // The body, without comments.
    const body = text.slice(begin + "\\begin{CD}".length, end)
        .replace(/(^|[^\\])%.*$/gm, "$1");

    // Split `source` at `separator` where it is outside braces, and not escaped.
    const split = (source, separator) => {
        const parts = [];
        let depth = 0;
        let start = 0;
        for (let i = 0; i < source.length; ++i) {
            if (source[i] === "\\" && source.startsWith(separator, i) && depth === 0) {
                parts.push(source.slice(start, i));
                i += separator.length - 1;
                start = i + 1;
            } else if (source[i] === "\\") {
                ++i;
            } else if (source[i] === "{") {
                ++depth;
            } else if (source[i] === "}") {
                --depth;
            }
        }
        parts.push(source.slice(start));
        return parts;
    };
    // Read up to `delimiter` from `source` at `i`, outside braces, as a macro's delimited
    // argument is read: `[argument, index after the delimiter]`, or `null` if there is none.
    const delimited = (source, i, delimiter) => {
        let depth = 0;
        for (let j = i; j < source.length; ++j) {
            if (source[j] === "\\") {
                ++j;
            } else if (source[j] === "{") {
                ++depth;
            } else if (source[j] === "}") {
                --depth;
            } else if (source[j] === delimiter && depth === 0) {
                return [source.slice(i, j).trim(), j + 1];
            }
        }
        return null;
    };
    const label = (argument) => Parser.unarray(Parser.unbrace(argument.trim()));

    // A row's cells: the text of each object, and the `@` commands between them, each as
    // `{ letter, labels }`.
    const tokens = (source) => {
        const result = [];
        let text = "";
        let depth = 0;
        for (let i = 0; i < source.length; ++i) {
            const character = source[i];
            if (character === "\\") {
                text += source.slice(i, i + 2);
                ++i;
                continue;
            }
            if (character === "{") {
                ++depth;
            } else if (character === "}") {
                --depth;
            }
            if (character !== "@" || depth > 0) {
                text += character;
                continue;
            }
            result.push({ object: text.trim() });
            text = "";
            let letter = source[i + 1] ?? "";
            const aliases = { ")": ">", "(": "<" };
            letter = aliases[letter] ?? letter;
            if (source.startsWith("\\vert", i + 1)) {
                result.push({ letter: "|", labels: ["", ""] });
                i += "\\vert".length;
                continue;
            }
            if ("><VA".includes(letter) && letter !== "") {
                const delimiter = source[i + 1];
                const first = delimited(source, i + 2, delimiter);
                const second = first === null ? null : delimited(source, first[1], delimiter);
                if (second === null) {
                    diagnostics.push(new Parser.Error(
                        `Expected the labels of @${letter}, ending at ${delimiter}.`, null));
                    i = source.length;
                    continue;
                }
                result.push({ letter, labels: [label(first[0]), label(second[0])] });
                i = second[1] - 1;
                continue;
            }
            if ("=|.".includes(letter) && letter !== "") {
                result.push({ letter, labels: ["", ""] });
                ++i;
                continue;
            }
            diagnostics.push(new Parser.Warning(`Unknown amscd arrow "@${letter}".`, null));
            ++i;
        }
        result.push({ object: text.trim() });
        return result;
    };

    const vertices = new Map();
    const vertex = (x, y, text = "") => {
        const key = `${x},${y}`;
        if (!vertices.has(key)) {
            let colour = Colour.black();
            let content = text;
            const coloured = text.match(/^\\textcolor\s*/);
            if (coloured !== null) {
                const parser = new Parser(ui, text.slice(coloured[0].length));
                try {
                    colour = parser.parse_colour(true);
                    // The label is braced once by `\textcolor`, and again if it is not one word.
                    content = Parser.unbrace(parser.code.trim());
                } catch (_) {
                    diagnostics.push(new Parser.Warning("Malformed colour specification.", null));
                }
            }
            vertices.set(key, new Vertex(ui, label(content), new Position(x, y), colour));
        }
        return vertices.get(key);
    };
    const arrows = [];

    let y = 0;
    for (const source of split(body, "\\\\")) {
        const cells = tokens(source);
        const commands = cells.filter((cell) => cell.object === undefined);
        const objects = cells.filter((cell) => cell.object !== undefined && cell.object !== "");
        if (source.trim() === "" && y === 0 && vertices.size === 0) {
            continue;
        }
        const vertical = objects.length === 0 && commands.length > 0
            && commands.every(({ letter }) => "VA|.".includes(letter));
        if (vertical) {
            // A row of vertical arrows, between the row of objects above it and the next.
            let x = 0;
            for (const { letter, labels } of commands) {
                if (letter !== ".") {
                    arrows.push({ letter, labels, from: [x, y - 1], to: [x, y] });
                }
                ++x;
            }
            continue;
        }
        // A row of objects, with the horizontal arrows between them.
        let x = 0;
        for (const cell of cells) {
            if (cell.object !== undefined) {
                if (cell.object !== "") {
                    vertex(x, y, cell.object);
                }
                continue;
            }
            if ("VA|".includes(cell.letter)) {
                diagnostics.push(new Parser.Warning(
                    `@${cell.letter} belongs on a row of vertical arrows.`, null));
            } else if (cell.letter !== ".") {
                arrows.push({ ...cell, from: [x, y], to: [x + 1, y] });
            }
            ++x;
        }
        ++y;
    }
    // A row of vertical arrows above the first row of objects reaches up to an empty one.
    const top = Math.min(0, ...arrows.map(({ from }) => from[1]));
    for (const { from, to } of arrows) {
        vertex(from[0], from[1]);
        vertex(to[0], to[1]);
    }
    for (const { letter, labels, from, to } of arrows) {
        const [a, b] = [vertex(...from), vertex(...to)];
        // `>` and `V` go from the first to the second, `<` and `A` back, and the equals either.
        const forward = ">=V|".includes(letter);
        const [source, target] = forward ? [a, b] : [b, a];
        const equals = "=|".includes(letter);
        // The first label is above or to the left, which is left of an arrow going right or up.
        const sides = letter === ">" || letter === "A" || equals ? ["left", "right"]
            : ["right", "left"];
        const which = labels[0] !== "" ? 0 : labels[1] !== "" ? 1 : null;
        if (labels[0] !== "" && labels[1] !== "") {
            diagnostics.push(new Parser.Warning(
                "An arrow with labels on both sides keeps only the first.", null));
        }
        new Edge(ui, which === null ? "" : labels[which], source, target, Edge.default_options({
            level: equals ? 2 : 1,
            label_alignment: which === null ? "left" : sides[which],
        }, equals ? { head: { name: "none" } } : null), Colour.black());
    }
    if (top < 0) {
        diagnostics.push(new Parser.Warning(
            "A row of vertical arrows comes before the first row of objects.", null));
    }
    return diagnostics;
};

/// A row of objects and arrows written as a formula, for the clipboard: `0 \to A
/// \xrightarrow{f} B \to C \to 0`. A labelled arrow stretches over its label, which `amsmath`
/// does for plain arrows (`\xrightarrow`), and `mathtools` for hooked, maps-to, and double ones.
class InlineMaths {
    /// The formula for the diagram of `quiver`, as `{ text, needs, dropped }`, or a reason it
    /// cannot be written so, as a string. `display` sets it in `\[ \]`.
    static export(quiver, display = false) {
        const vertices = quiver.all_cells().filter((cell) => cell.is_vertex())
            .sort((a, b) => a.position.x - b.position.x);
        const edges = quiver.all_cells().filter((cell) => cell.is_edge());
        if (vertices.length === 0) {
            return "the diagram is empty";
        }
        if (new Set(vertices.map((vertex) => vertex.position.y)).size > 1) {
            return "a formula is one row: the objects are on several";
        }
        for (const [i, vertex] of vertices.entries()) {
            if (i > 0 && vertex.position.x !== vertices[i - 1].position.x + 1) {
                return "a formula has no gaps: the objects are not side by side";
            }
        }
        const dropped = new Set();
        const needs = new Set();
        const between = new Map();
        for (const edge of edges) {
            const slot = edge.source.is_vertex() && edge.target.is_vertex() && !edge.is_loop()
                ? Math.min(edge.source.position.x, edge.target.position.x) : null;
            if (slot === null || edge.options.style.name !== "arrow"
                || Math.abs(edge.source.position.x - edge.target.position.x) !== 1) {
                return "a formula has arrows only between neighbours in the row";
            }
            if (between.has(slot)) {
                return "a formula has one arrow between neighbours";
            }
            between.set(slot, edge);
        }
        if (between.size !== vertices.length - 1) {
            return "a formula needs an arrow between each two neighbours";
        }
        const parts = [];
        for (const [i, vertex] of vertices.entries()) {
            if (vertex.label_colour.is_not_black()) {
                dropped.add("colours");
            }
            parts.push(vertex.label);
            if (i === vertices.length - 1) {
                break;
            }
            const edge = between.get(vertex.position.x);
            const arrow = InlineMaths.arrow(edge, dropped, needs);
            if (typeof arrow !== "string") {
                return arrow.reason;
            }
            parts.push(arrow);
        }
        const formula = parts.filter((part) => part !== "").join(" ");
        return {
            text: display ? `\\[${formula}\\]` : formula,
            needs: Array.from(needs),
            dropped: Array.from(dropped),
        };
    }

    /// The arrow `edge` in a formula: a symbol, or one that stretches over its labels; or
    /// `{ reason }` if it has no such symbol. What it cannot show is added to `dropped`, and the
    /// packages it needs to `needs`.
    static arrow(edge, dropped, needs) {
        const { tail, body, head } = edge.options.style;
        const level = edge.options.level;
        const right = edge.target.position.x > edge.source.position.x;
        const name = `${level} ${tail.name} ${body.name} ${head.name}`;
        // `[symbol right, symbol left, package, labelled right, labelled left, package]`, where
        // a symbol is `null` if neither package has one.
        const symbols = {
            "1 none cell arrowhead": ["\\to", "\\leftarrow", null,
                "\\xrightarrow", "\\xleftarrow", "amsmath"],
            "1 hook cell arrowhead": ["\\hookrightarrow", "\\hookleftarrow", null,
                "\\xhookrightarrow", "\\xhookleftarrow", "mathtools"],
            "1 none cell epi": ["\\twoheadrightarrow", "\\twoheadleftarrow", "amssymb",
                null, null, null],
            "1 mono cell arrowhead": ["\\rightarrowtail", "\\leftarrowtail", "amssymb",
                null, null, null],
            "1 maps to cell arrowhead": ["\\mapsto", null, null, "\\xmapsto", null, "mathtools"],
            "2 none cell arrowhead": ["\\Rightarrow", "\\Leftarrow", null,
                "\\xRightarrow", "\\xLeftarrow", "mathtools"],
            "2 none cell none": ["=", "=", null, null, null, null],
        }[name];
        if (symbols === undefined) {
            return { reason: "a formula has plain, hooked, two-headed, tailed, maps-to, double,"
                + " and equals arrows only" };
        }
        const [plain_right, plain_left, plain_package, labelled_right, labelled_left,
            labelled_package] = symbols;
        if (edge.options.curve !== 0 || edge.options.offset !== 0 || edge.options.route.length > 0
            || edge.options.shorten.source !== 0 || edge.options.shorten.target !== 0) {
            dropped.add("curves, offsets, and shortening");
        }
        if (edge.options.colour.is_not_black() || edge.label_colour.is_not_black()) {
            dropped.add("colours");
        }
        if (edge.label === "") {
            const symbol = right ? plain_right : plain_left;
            if (symbol === null) {
                return { reason: "amsmath and amssymb have no maps-to arrow going left" };
            }
            if (plain_package !== null) {
                needs.add(plain_package);
            }
            return symbol;
        }
        const symbol = right ? labelled_right : labelled_left;
        if (symbol === null) {
            return { reason: "amsmath and mathtools stretch no two-headed, tailed, or equals"
                + " arrow over a label, nor a maps-to arrow going left" };
        }
        needs.add(labelled_package);
        if (["centre", "over"].includes(edge.options.label_alignment)) {
            dropped.add("labels centred on the arrow");
        }
        if (edge.options.label_position !== 50) {
            dropped.add("label positions");
        }
        // Left of an arrow going right is above it; going left, below it.
        const above = (edge.options.label_alignment === "right") !== right
            || ["centre", "over"].includes(edge.options.label_alignment);
        return above ? `${symbol}{${edge.label}}` : `${symbol}[${edge.label}]{}`;
    }
}
