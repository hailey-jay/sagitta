/// Spectral sequences: `:spectral-sequence` (`:ss`) stamps a page, its entries in a grid by
/// bidegree, with a column and a row of ticks, and axes between the ticks and the entries; and
/// `:differential r` (`:d r`, or `; D` for the page's own) draws `d_r` from the selected entries.
///
/// Unlike the other presets, a spectral sequence leaves a frame behind (`UI.frame`): where its
/// origin is, its grading, page, and ranges, which `:d` aims by, the mode line reads bidegrees by,
/// and the axes are drawn by. The entries and ticks stay ordinary cells. The frame is kept in the
/// file as a comment inside the environment, which TeX ignores and Sagitta reads back:
///
///     % sagitta: spectral-sequence grading=coh page=2 origin=4-2 p=0..4 q=0..3
///
/// where `origin` is the row and column, as tikz-cd counts them, of bidegree `(0, 0)`.
///
/// The axes run between the ticks and the entries, from the corner between the tick row and
/// column, to a little past the last tick on each: they are drawn from the tick nodes, by the same
/// rule on the canvas and in TikZ, and only while those ticks are there.
class SpectralSequence {
    /// The cell of bidegree `(p, q)`. `q` grows upwards, where rows grow downwards.
    static cell(frame, p, q) {
        return new Position(frame.origin.x + p, frame.origin.y - q);
    }

    /// The bidegree of the cell at `position`, as `[p, q]`.
    static bidegree(frame, position) {
        return [position.x - frame.origin.x, frame.origin.y - position.y];
    }

    /// The bidegree of the cell at `position`, for the mode line, as `(p,q)=(2,1)`.
    static describe(frame, position) {
        const [p, q] = SpectralSequence.bidegree(frame, position);
        const [x, y] = SpectralSequence.names(frame);
        return `(${x},${y})=(${p},${q})`;
    }

    /// The step `d_r` takes, as `[dp, dq]`: cohomological `E_r^{p,q} → E_r^{p+r,q-r+1}`,
    /// homological `E^r_{p,q} → E^r_{p-r,q+r-1}`, and Adams (`x = t-s`, `y = s`) `(x, s) → (x-1,
    /// s+r)`.
    static step(frame, r) {
        return {
            coh: [r, 1 - r],
            hom: [-r, r - 1],
            adams: [-1, r],
        }[frame.grading];
    }

    /// The names of the axes, horizontal then vertical.
    static names(frame) {
        return frame.grading === "adams" ? ["t-s", "s"] : ["p", "q"];
    }

    /// The cells the axes are drawn from: the ticks at the low and high ends of each range.
    static ticks(frame) {
        const [[p0, p1], [q0, q1]] = [frame.p, frame.q];
        const column = frame.origin.x + p0 - 1;
        const row = frame.origin.y - q0 + 1;
        return {
            // The tick of the lowest q and of the highest, in the tick column.
            q_low: new Position(column, frame.origin.y - q0),
            q_high: new Position(column, frame.origin.y - q1),
            // The tick of the lowest p and of the highest, in the tick row.
            p_low: new Position(frame.origin.x + p0, row),
            p_high: new Position(frame.origin.x + p1, row),
        };
    }

    /// How far, in pt, the axes reach past the last tick.
    static get REACH() {
        return 8;
    }

    /// The axes of `frame`, as offsets on the canvas of `ui`, `{ corner, right, top }`, or `null`
    /// if a tick they are drawn from is not there.
    static axes(ui, frame) {
        if (frame === null || frame === undefined || frame.axes === "none") {
            return null;
        }
        const ticks = SpectralSequence.ticks(frame);
        if (Object.values(ticks).some((position) => !ui.positions.has(`${position}`))) {
            return null;
        }
        const centre = (position) => ui.grid.centre_offset_from_position(position);
        const reach = SpectralSequence.REACH * Edge.PX_PER_PT;
        const corner = centre(ticks.q_low).add(centre(ticks.p_low)).div(2);
        return {
            corner,
            right: new Offset(centre(ticks.p_high).x + reach, corner.y),
            top: new Offset(corner.x, centre(ticks.q_high).y - reach),
        };
    }

    /// The ends of the diagonal `p+q = n` inside the ranges of `frame`, as bidegrees `[[p, q],
    /// [p, q]]` from the top-left, or `null` if it meets fewer than two entries' places.
    static diagonal(frame, n) {
        const [[p0, p1], [q0, q1]] = [frame.p, frame.q];
        const [low, high] = [Math.max(p0, n - q1), Math.min(p1, n - q0)];
        return low >= high ? null : [[low, n - low], [high, n - high]];
    }

    /// The dashed diagonals of `frame` (see `:diagonal`), as pairs of offsets on the canvas of
    /// `ui`, each reaching past its ends as the axes do. A diagonal is drawn through its entries'
    /// maths axes: across from its ticks, which must be there.
    static lines(ui, frame) {
        if (frame === null || frame === undefined) {
            return [];
        }
        const ticks = SpectralSequence.ticks(frame);
        const centre = (position) => ui.grid.centre_offset_from_position(position);
        const reach = SpectralSequence.REACH * Edge.PX_PER_PT;
        const lines = [];
        for (const n of frame.lines ?? []) {
            const ends = SpectralSequence.diagonal(frame, n);
            const positions = ends?.flatMap(([p, q]) => [
                new Position(frame.origin.x + p, ticks.p_low.y),
                new Position(ticks.q_low.x, frame.origin.y - q)]);
            if (ends === null || positions.some((position) => !ui.positions.has(`${position}`))) {
                continue;
            }
            const [a, b] = ends.map(([p, q]) => new Offset(
                centre(new Position(frame.origin.x + p, ticks.p_low.y)).x,
                centre(new Position(ticks.q_low.x, frame.origin.y - q)).y));
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            const along = new Offset((b.x - a.x) / length * reach, (b.y - a.y) / length * reach);
            lines.push([a.sub(along), b.add(along)]);
        }
        return lines;
    }

    /// Draw the axes and diagonals of the frame of `ui` on its canvas, or take them away if it has
    /// none.
    static draw(ui) {
        if (ui.canvas === null || ui.canvas === undefined) {
            return;
        }
        // Most diagrams have no frame, and nothing drawn to take away: panning, which asks on
        // every frame, need not look.
        if ((ui.frame ?? null) === null && !ui.axes_shown) {
            return;
        }
        let svg = ui.canvas.query_selector("svg.frame-axes");
        const tikz = ui.format === "tikz-cd";
        const axes = tikz ? SpectralSequence.axes(ui, ui.frame) : null;
        const lines = tikz ? SpectralSequence.lines(ui, ui.frame) : [];
        // The drawing is in the canvas's own coordinates, so panning and zooming leave it as it
        // is: it is only touched when what it shows changes, as the layout does.
        const shown = JSON.stringify([axes, lines]);
        if (svg !== null && svg.element?.dataset?.shown === shown) {
            return;
        }
        ui.axes_shown = axes !== null || lines.length > 0;
        if (!ui.axes_shown) {
            svg?.remove();
            return;
        }
        if (svg === null) {
            // Pressing on the axes does nothing, rather than reaching the canvas under them, where
            // a drag would draw a new object and arrow from the cell beneath.
            svg = new DOM.SVGElement("svg", { class: "frame-axes" })
                .listen("pointerdown", (event) => {
                    event.stopPropagation();
                    event.preventDefault();
                });
            // First on the canvas, so that the cells are above it, and a press near the axes on
            // the edge of an entry reaches the entry.
            if (typeof ui.canvas.element.prepend === "function") {
                ui.canvas.element.prepend(svg.element);
            } else {
                svg.add_to(ui.canvas);
            }
        }
        const points = [...(axes === null ? [] : [axes.corner, axes.right, axes.top]),
            ...lines.flat()];
        const [left, upper] = [Math.min(...points.map(({ x }) => x)),
            Math.min(...points.map(({ y }) => y))];
        const [width, height] = [Math.max(...points.map(({ x }) => x)) - left,
            Math.max(...points.map(({ y }) => y)) - upper];
        const stroke = 0.4 * Edge.PX_PER_PT;
        svg.set_attributes({ width: width + 2 * stroke, height: height + 2 * stroke,
            "data-shown": shown })
            .set_style({ left: `${left - stroke}px`, top: `${upper - stroke}px` });
        const at = (offset) => `${offset.x - left + stroke},${offset.y - upper + stroke}`;
        svg.clear();
        // Each line has a wider, unseen line under it to press on.
        const hit = 6 * Edge.PX_PER_PT;
        if (axes !== null) {
            const points = `${at(axes.right)} ${at(axes.corner)} ${at(axes.top)}`;
            svg.add(new DOM.SVGElement("polyline", {
                class: "hit", points, fill: "none", "stroke-width": hit,
            }));
            svg.add(new DOM.SVGElement("polyline", {
                points,
                fill: "none",
                "stroke-width": stroke,
            }));
        }
        // TikZ's `dashed`: on 3pt, off 3pt.
        const dash = 3 * Edge.PX_PER_PT;
        for (const [a, b] of lines) {
            svg.add(new DOM.SVGElement("line", {
                class: "hit",
                x1: a.x - left + stroke, y1: a.y - upper + stroke,
                x2: b.x - left + stroke, y2: b.y - upper + stroke,
                "stroke-width": hit,
            }));
            svg.add(new DOM.SVGElement("line", {
                class: "diagonal",
                x1: a.x - left + stroke, y1: a.y - upper + stroke,
                x2: b.x - left + stroke, y2: b.y - upper + stroke,
                "stroke-width": stroke,
                "stroke-dasharray": `${dash} ${dash}`,
            }));
        }
    }

    /// The `execute at end picture` option that draws the axes of `frame` in TikZ, for a diagram
    /// whose top-left cell is `offset`, or `null` if a tick they are drawn from is not there
    /// (`has`, given a position, says whether a node is). Each tick's maths axis is its baseline
    /// raised by the maths axis height, as the canvas centres a cell on it.
    static tikz(frame, offset, has) {
        if (frame === null) {
            return null;
        }
        const ticks = SpectralSequence.ticks(frame);
        if (Object.values(ticks).some((position) => !has(position))) {
            return null;
        }
        const node = (position) => String.raw`\tikzcdmatrixname-${position.y - offset.y + 1}-${
            position.x - offset.x + 1}.base`;
        const axis = String.raw`(0,\the\fontdimen22\textfont2)`;
        const reach = `${SpectralSequence.REACH}pt`;
        const drawn = [];
        if (frame.axes !== "none") {
            drawn.push(String.raw`\draw[line width=0.4pt] ($(${
                node(ticks.p_high)} |- sagitta-corner)+(${reach},0)$) -- (sagitta-corner) -- ($(${
                node(ticks.q_high)} -| sagitta-corner)+${axis}+(0,${reach})$);`);
        }
        for (const n of frame.lines ?? []) {
            const ends = SpectralSequence.diagonal(frame, n);
            const columns = ends?.map(([p]) => new Position(frame.origin.x + p, ticks.p_low.y));
            const rows = ends?.map(([, q]) => new Position(ticks.q_low.x, frame.origin.y - q));
            if (ends === null || [...columns, ...rows].some((position) => !has(position))) {
                continue;
            }
            // Each end is across from its ticks, on the maths axis, as on the canvas.
            const end = (i) => String.raw`\coordinate (sagitta-${"ab"[i]}) at ($(${
                node(columns[i])} |- ${node(rows[i])})+${axis}$);`;
            drawn.push(String.raw`${end(0)}${end(1)}\draw[line width=0.4pt, dashed] ($(sagitta-a)!-${
                reach}!(sagitta-b)$) -- ($(sagitta-b)!-${reach}!(sagitta-a)$);`);
        }
        if (drawn.length === 0) {
            return null;
        }
        return String.raw`execute at end picture={\coordinate (sagitta-corner) at ($(${
            node(ticks.q_low)})!.5!(${node(ticks.p_low)})+${axis}$);${drawn.join("")}}`;
    }

    /// The comment line that keeps `frame` in the file, for a diagram whose top-left cell is
    /// `offset`.
    static directive(frame, offset) {
        const range = ([low, high]) => `${low}..${high}`;
        return `% sagitta: spectral-sequence grading=${frame.grading} page=${frame.page} origin=${
            frame.origin.y - offset.y + 1}-${frame.origin.x - offset.x + 1} p=${range(frame.p)} q=${
            range(frame.q)}${frame.axes === "edge" ? "" : ` axes=${frame.axes}`}${
            (frame.lines ?? []).length === 0 ? "" : ` lines=${frame.lines.join(",")}`}`;
    }

    /// The frame a comment line `text` (without its `%`) keeps, for a diagram read from `(0, 0)`,
    /// or `null` if it is not one. Throws, saying what is wrong, if it is one that cannot be read,
    /// as a hand edit can leave it. Words it does not know are left for later versions.
    static read(text) {
        const match = text.match(/^\s*sagitta:\s*spectral-sequence(?:\s+(.*))?$/);
        if (match === null) {
            return null;
        }
        const values = Object.fromEntries((match[1] ?? "").trim().split(/\s+/)
            .map((word) => {
                const at = word.indexOf("=");
                return at === -1 ? [word, ""] : [word.slice(0, at), word.slice(at + 1)];
            }));
        const wrong = (word, should) => new Error(`${word}=${values[word] ?? ""} should be ${should}.`);
        if (!["coh", "hom", "adams"].includes(values.grading)) {
            throw wrong("grading", "coh, hom, or adams");
        }
        if (values.page !== undefined && !/^\d+$/.test(values.page)) {
            throw wrong("page", "a whole number, as page=2");
        }
        const origin = values.origin?.match(/^(-?\d+)-(-?\d+)$/);
        if (origin === null || origin === undefined) {
            throw wrong("origin", "a row and a column, as origin=4-2");
        }
        const range = (axis) => {
            const parts = values[axis]?.match(/^(-?\d+)\.\.(-?\d+)$/);
            if (parts === null || parts === undefined || Number(parts[1]) > Number(parts[2])) {
                throw wrong(axis, `a range from low to high, as ${axis}=0..4`);
            }
            return [Number(parts[1]), Number(parts[2])];
        };
        const [p, q] = [range("p"), range("q")];
        if (values.axes !== undefined && !["edge", "none"].includes(values.axes)) {
            throw wrong("axes", "edge or none");
        }
        if (values.lines !== undefined && !/^-?\d+(,-?\d+)*$/.test(values.lines)) {
            throw wrong("lines", "total degrees, as lines=2,3");
        }
        return {
            grading: values.grading,
            page: Number(values.page ?? 2),
            origin: new Position(Number(origin[2]) - 1, Number(origin[1]) - 1),
            p, q,
            axes: values.axes ?? "edge",
            // Each once, in order, as `:diagonal` keeps them.
            lines: Array.from(new Set((values.lines?.split(",") ?? []).map(Number)))
                .sort((a, b) => a - b),
        };
    }

    /// `frame` with its origin moved by `delta`.
    static moved(frame, delta) {
        return frame === null ? null : { ...frame, origin: frame.origin.add(delta) };
    }

    /// Every tick's cell of `frame`: the tick column's, then the tick row's.
    static all_ticks(frame) {
        const { origin } = frame;
        const [[p0, p1], [q0, q1]] = [frame.p, frame.q];
        const ticks = [];
        for (let q = q0; q <= q1; ++q) {
            ticks.push(new Position(origin.x + p0 - 1, origin.y - q));
        }
        for (let p = p0; p <= p1; ++p) {
            ticks.push(new Position(origin.x + p, origin.y - q0 + 1));
        }
        return ticks;
    }

    /// The frame step that keeps the frame of `ui` with its page as `displacements` move vertices
    /// (each `{ vertex, from, to }`), as a list of actions: the frame moves as its ticks do, when
    /// they all move alike, and stays when none move. Returns `null` if the move would split
    /// them, some moving and some not, or each its own way, which would leave the bidegrees
    /// meaning nothing.
    static follow(ui, displacements) {
        const frame = ui.frame;
        if (frame === null || frame === undefined) {
            return [];
        }
        const deltas = new Map(displacements.map(({ from, to }) => [`${from}`, to.sub(from)]));
        const moving = new Set(displacements.map(({ vertex }) => vertex));
        const steps = [];
        for (const position of SpectralSequence.all_ticks(frame)) {
            const delta = deltas.get(`${position}`);
            if (delta !== undefined) {
                steps.push(delta);
            } else {
                const cell = ui.positions.get(`${position}`);
                if (cell !== undefined && !moving.has(cell)) {
                    steps.push(Position.zero());
                }
            }
        }
        if (steps.length === 0 || steps.every((step) => step.is_zero())) {
            return [];
        }
        if (steps.some((step) => step.x !== steps[0].x || step.y !== steps[0].y)) {
            return null;
        }
        return [{ kind: "frame", from: frame, to: SpectralSequence.moved(frame, steps[0]) }];
    }

    /// The frame step that deleting `cells` takes, as a list of actions: the frame goes with the
    /// last of the diagram's cells, as Clear takes it.
    static deleting(ui, cells) {
        const frame = ui.frame;
        if (frame === null || frame === undefined
            || ui.quiver.all_cells().some((cell) => !cells.has(cell))) {
            return [];
        }
        return [{ kind: "frame", from: frame, to: null }];
    }
}

/// The ranges of each quadrant (`p` then `q`), which `:ss quadrant=` starts from.
SpectralSequence.QUADRANTS = {
    "1": [[0, 4], [0, 3]],
    "2": [[-4, 0], [0, 3]],
    "3": [[-4, 0], [-3, 0]],
    "4": [[0, 4], [-3, 0]],
    "half": [[0, 4], [-2, 2]],
    "plane": [[-2, 2], [-2, 2]],
};

/// `:spectral-sequence` (`:ss`).
Presets.SPECTRAL_SEQUENCE = {
    quadrant: { kind: "choice", default: "1", values: Object.keys(SpectralSequence.QUADRANTS),
        key: "u", title: "quadrant", resets: ["p", "q"] },
    p: { kind: "range", default: null, key: "p", title: "p up to",
        resolve: (o) => SpectralSequence.ranges(o)[0] },
    q: { kind: "range", default: null, key: "q", title: "q up to",
        resolve: (o) => SpectralSequence.ranges(o)[1] },
    page: { kind: "integer", default: 2, min: 0, key: "r", title: "page" },
    grading: { kind: "choice", default: "coh", values: ["coh", "hom", "adams"], key: "g",
        title: "grading" },
    obj: { kind: "text", default: "", title: "entries",
        suggest: ["\\bullet", "E_#^{#p,#q}", "E^#_{#p,#q}"] },
    axes: { kind: "choice", default: "edge", values: ["edge", "none"], key: "a", title: "axes" },
};

/// The ranges of `:ss` options `o`: those given, or else the quadrant's.
SpectralSequence.ranges = (o) => {
    const [p, q] = SpectralSequence.QUADRANTS[o.quadrant];
    return [o.p ?? p, o.q ?? q];
};

Presets.build["spectral-sequence"] = (o) => {
    const [[p0, p1], [q0, q1]] = SpectralSequence.ranges(o);
    if (p0 > p1 || q0 > q1) {
        throw new Error("A range runs from low to high, as p=0..4.");
    }
    // From the focus point, the top-left entry, `(p0, q1)`.
    const origin = [-p0, q1];
    const at = (p, q) => [origin[0] + p, origin[1] - q];
    const tick = (n) => `\\scriptstyle ${n}`;
    const [p_name, q_name] = SpectralSequence.names({ grading: o.grading });
    const vertices = [];
    for (let q = q0; q <= q1; ++q) {
        vertices.push({ position: [origin[0] + p0 - 1, origin[1] - q], label: tick(q), fixed: true });
    }
    vertices.push({ position: [origin[0] + p0 - 1, origin[1] - q1 - 1], label: tick(q_name),
        fixed: true });
    for (let p = p0; p <= p1; ++p) {
        vertices.push({ position: [origin[0] + p, origin[1] - q0 + 1], label: tick(p), fixed: true });
    }
    vertices.push({ position: [origin[0] + p1 + 1, origin[1] - q0 + 1], label: tick(p_name),
        fixed: true });
    if (o.obj !== "") {
        const template = o.obj;
        for (let q = q1; q >= q0; --q) {
            for (let p = p0; p <= p1; ++p) {
                vertices.push({ position: at(p, q), label: Template.expand(template, new Map([
                    ["#", { offset: o.page }], ["#p", { offset: p }], ["#q", { offset: q }],
                ])) });
            }
        }
    }
    return {
        vertices,
        edges: [],
        frame: { grading: o.grading, page: o.page, origin, p: [p0, p1], q: [q0, q1],
            axes: o.axes },
    };
};

Presets.COMMANDS.push(["spectral-sequence", "ss", Presets.SPECTRAL_SEQUENCE]);
Presets.register("spectral-sequence", "ss", Presets.SPECTRAL_SEQUENCE);

/// `:differential r` (`:d r`), and `; D`: from each selected entry of the spectral sequence, an
/// arrow to the entry `d_r` reaches (see `SpectralSequence.step`), as Space draws one: the target
/// made, as `\bullet`, if there is none, the arrow in the arrow preset, and the targets selected
/// with the arrows, queued for labels, the arrows first. Without `r`, the frame's page. `label`
/// writes `d_r` on the arrows. `all` draws every `d_r` between entries already in the frame's
/// ranges, whatever is selected, and makes no entries. One step to undo.
Commands.TABLE["differential"] = {
    arguments: true,
    completions: ["label", "all"],
    run: (commands, words) => {
        const ui = commands.ui;
        const [first, ...rest] = words;
        const given = first !== undefined && !["label", "all"].includes(first);
        const flags = given ? rest : words;
        if (given && (!/^\d+$/.test(first) || Number(first) < 1)) {
            throw new Error(`differential takes the page, a whole number from 1: not "${first}".`);
        }
        if (flags.some((flag) => !["label", "all"].includes(flag))) {
            throw new Error("differential takes the page, then label or all, or nothing.");
        }
        SpectralSequence.differential(ui, given ? Number(first) : null, flags.includes("label"),
            flags.includes("all"));
    },
};
Commands.ALIASES["d"] = "differential";
Commands.SHORT["d"] = "differential";

/// Whether `position` is in the row or the column of the ticks of `frame`, where the ticks and the
/// axes' names are, which have no bidegree.
SpectralSequence.on_ticks = (frame, position) => position.x === frame.origin.x + frame.p[0] - 1
    || position.y === frame.origin.y - frame.q[0] + 1;

/// Whether `position` is inside the ranges of `frame`.
SpectralSequence.inside = (frame, position) => {
    const [p, q] = SpectralSequence.bidegree(frame, position);
    return p >= frame.p[0] && p <= frame.p[1] && q >= frame.q[0] && q <= frame.q[1];
};

SpectralSequence.differential = (ui, r, label, all = false) => {
    const frame = ui.frame;
    if (frame === null || frame === undefined) {
        throw new Error("There is no spectral sequence here: :ss stamps one.");
    }
    r ??= frame.page;
    if (r < 1) {
        throw new Error(`The page is ${r}, which has no differential: give one, as :d 2.`);
    }
    const [dp, dq] = SpectralSequence.step(frame, r);
    const reach = (cell) => cell.position.add(new Position(dp, -dq));
    // With `all`, the entries in the ranges whose `d_r` lands on another, and is not drawn yet.
    const sources = all
        ? ui.quiver.all_cells().filter((cell) => cell.is_vertex()
            && SpectralSequence.inside(frame, cell.position)
            && SpectralSequence.inside(frame, reach(cell))
            && ui.positions.has(`${reach(cell)}`)
            && !Array.from(ui.quiver.transitive_dependencies([cell], true))
                .some((edge) => edge.is_edge() && edge.source === cell
                    && edge.target === ui.positions.get(`${reach(cell)}`)))
        // Only entries, which may lie past the ranges, where a differential reached: the ticks
        // and the axes' names have no bidegree.
        : Array.from(ui.selection).filter((cell) => cell.is_vertex()
            && !SpectralSequence.on_ticks(frame, cell.position));
    if (sources.length === 0) {
        throw new Error(all ? `There are no d_${r} to draw between the entries in the ranges.`
            : `Select the entries to draw d_${r} from first: the ticks have no bidegree.`);
    }
    const created = new Set();
    const targets = [];
    const edges = [];
    ui.add_cells(() => {
        for (const source of sources) {
            const position = reach(source);
            let target = ui.positions.get(`${position}`);
            if (target === undefined) {
                target = new Vertex(ui, "\\bullet", position);
                created.add(target);
            }
            const edge = Edge.create(ui, source, target);
            if (label) {
                edge.label = `d_${r > 9 ? `{${r}}` : r}`;
            }
            created.add(edge);
            targets.push(target);
            edges.push(edge);
            // Tab goes to the arrow, then its target, as after Space.
            if (created.has(target)) {
                ui.order_before?.(target, edge);
            }
        }
    });
    ui.draw_unrendered?.();
    if (label) {
        ui.render_maths?.(...edges);
    }
    for (const cell of created) {
        cell.element.query_selector("kbd")?.class_list.add("queue");
    }
    ui.history.add(ui, [{ kind: "create", cells: created }]);
    ui.deselect();
    ui.select(...(all ? edges : [...targets, ...edges]));
    // From one entry, the focus point goes on to its target, so that the next differential goes
    // on from there.
    if (!all && targets.length === 1) {
        ui.reposition_focus_point(targets[0].position);
    }
};

/// Grow (`by` 1) or shrink (`by` -1) the range `axis` (`"p"` or `"q"`) of the frame of `ui` at its
/// high end, as one step: the tick for the new end is added where the axis's name was, and the
/// name moves on, or the other way about. The entries are the diagram's own, and are left alone.
SpectralSequence.resize = (ui, axis, by) => {
    const frame = ui.frame;
    const [low, high] = frame[axis];
    const next = high + by;
    if (next < low) {
        throw new Error(`The range of ${axis} is down to one, ${low}..${high}.`);
    }
    const { origin } = frame;
    const tick_row = origin.y - frame.q[0] + 1;
    const tick_column = origin.x + frame.p[0] - 1;
    // The cell of the tick for `n`, which is also where the name is after the last tick.
    const at = (n) => axis === "p" ? new Position(origin.x + n, tick_row)
        : new Position(tick_column, origin.y - n);
    const cell = (n) => ui.positions.get(`${at(n)}`) ?? null;
    const name = cell(high + 1);
    const actions = [];
    const moved = { ...frame, [axis]: [low, next] };
    if (by > 0) {
        const beyond = cell(high + 2);
        if (name !== null && beyond !== null) {
            throw new Error(`There is no room for the name of ${axis}: ${beyond.label} is in the way.`);
        }
        if (name !== null) {
            actions.push({ kind: "move", routes: [],
                displacements: [{ vertex: name, from: at(high + 1), to: at(high + 2) }] });
        }
        // The name makes way before the tick is made where it was.
        ui.history.effect(ui, actions, false);
        const tick = new Vertex(ui, `\\scriptstyle ${next}`, at(high + 1));
        actions.push({ kind: "create", cells: new Set([tick]) });
    } else {
        const last = cell(high);
        if (last !== null) {
            actions.push({ kind: "delete", cells: ui.quiver.transitive_dependencies([last]) });
        }
        ui.history.effect(ui, actions, false);
        if (name !== null) {
            const move = { kind: "move", routes: [],
                displacements: [{ vertex: name, from: at(high + 1), to: at(high) }] };
            ui.history.effect(ui, [move], false);
            actions.push(move);
        }
    }
    const change = { kind: "frame", from: frame, to: moved };
    ui.history.effect(ui, [change], false);
    actions.push(change);
    ui.history.add(ui, actions);
};

/// Move the low end of the range `axis` (`"p"` or `"q"`) of the frame of `ui` up (`by` 1, which
/// shrinks it) or down (`by` -1, which grows it), as one step. The ticks of the other axis (and its
/// name) sit just below the low end, so they move with it: growing, they move out a cell and the
/// new tick takes their old place; shrinking, the lowest tick goes and they move in, onto what
/// were the lowest entries, which must be empty.
SpectralSequence.shift_low = (ui, axis, by) => {
    const frame = ui.frame;
    const [low, high] = frame[axis];
    const next = low + by;
    if (next > high) {
        throw new Error(`The range of ${axis} is down to one, ${low}..${high}.`);
    }
    const { origin } = frame;
    const [p0, p1] = frame.p;
    const [q0, q1] = frame.q;
    // The cells of the other axis's ticks and name, and the way they move (on screen) as the low
    // end of `axis` goes down a step.
    const others = axis === "p"
        ? Array.from({ length: q1 - q0 + 2 }, (_, i) => new Position(origin.x + p0 - 1, origin.y - q0 - i))
        : Array.from({ length: p1 - p0 + 2 }, (_, i) => new Position(origin.x + p0 + i, origin.y - q0 + 1));
    const outwards = axis === "p" ? new Position(-1, 0) : new Position(0, 1);
    const tick = (n) => axis === "p" ? new Position(origin.x + n, origin.y - q0 + 1)
        : new Position(origin.x + p0 - 1, origin.y - n);
    const cell = (position) => ui.positions.get(`${position}`) ?? null;
    const moving = others.map(cell).filter((vertex) => vertex !== null);
    const actions = [];
    if (by < 0) {
        for (const position of others) {
            const beyond = cell(position.add(outwards));
            if (cell(position) !== null && beyond !== null) {
                throw new Error(`There is no room to move the ticks out: ${beyond.label} is in the way.`);
            }
        }
        if (cell(tick(next)) !== null) {
            throw new Error(`There is no room for the tick ${next}: ${cell(tick(next)).label} is in the way.`);
        }
        const move = { kind: "move", routes: [], displacements: moving.map((vertex) => ({
            vertex, from: vertex.position, to: vertex.position.add(outwards) })) };
        ui.history.effect(ui, [move], false);
        actions.push(move);
        const added = new Vertex(ui, `\\scriptstyle ${next}`, tick(next));
        actions.push({ kind: "create", cells: new Set([added]) });
    } else {
        // The entries at the old low end, where the ticks move in to.
        const inwards = new Position(-outwards.x, -outwards.y);
        const blocking = others.map((position) => cell(position.add(inwards)))
            .find((vertex) => vertex !== null);
        if (blocking !== undefined) {
            throw new Error(`The entries of ${axis}=${low} are in the way: ${blocking.label}.`);
        }
        const lowest = cell(tick(low));
        if (lowest !== null) {
            const remove = { kind: "delete", cells: ui.quiver.transitive_dependencies([lowest]) };
            ui.history.effect(ui, [remove], false);
            actions.push(remove);
        }
        const move = { kind: "move", routes: [], displacements: moving.map((vertex) => ({
            vertex, from: vertex.position, to: vertex.position.add(inwards) })) };
        ui.history.effect(ui, [move], false);
        actions.push(move);
    }
    const change = { kind: "frame", from: frame, to: { ...frame, [axis]: [next, high] } };
    ui.history.effect(ui, [change], false);
    actions.push(change);
    ui.history.add(ui, actions);
};

/// Change the frame of `ui` to `frame` (as `{ ...ui.frame, page: 3 }`), as one step.
SpectralSequence.change = (ui, frame) => {
    ui.history.add(ui, [{ kind: "frame", from: ui.frame, to: frame }], true);
};

/// `:frame`: the frame of the diagram's spectral sequence, in a layer that shows it and changes it
/// (see `Layer.Frame`).
Commands.TABLE["frame"] = {
    run: (commands) => {
        const ui = commands.ui;
        if (ui.frame === null) {
            throw new Error("There is no spectral sequence here: :ss stamps one.");
        }
        ui.keymap.layers.frame.enter();
    },
};

/// `:diagonal n` (`:diag n`): select the entries of total degree `n`, those with `p+q = n` inside
/// the frame's ranges. `line` also draws the diagonal dashed (or takes it away, if it is drawn),
/// as the filtration of `H^n` or a vanishing line is: kept in the frame, on the canvas, and in
/// TikZ, as the axes are.
Commands.TABLE["diagonal"] = {
    arguments: true,
    completions: ["line"],
    run: (commands, words) => {
        const ui = commands.ui;
        const frame = ui.frame;
        if (frame === null) {
            throw new Error("There is no spectral sequence here: :ss stamps one.");
        }
        const [first, ...flags] = words;
        if (first === undefined || !/^-?\d+$/.test(first)) {
            throw new Error("diagonal takes the total degree, as :diagonal 3.");
        }
        if (flags.some((flag) => flag !== "line")) {
            throw new Error("diagonal takes the total degree, then line, or nothing.");
        }
        const n = Number(first);
        if (flags.includes("line")) {
            const lines = frame.lines ?? [];
            // One drawn can always be taken away, even once the ranges have shrunk past it.
            if (!lines.includes(n) && SpectralSequence.diagonal(frame, n) === null) {
                throw new Error(`The diagonal ${n} meets the ranges in fewer than two places.`);
            }
            SpectralSequence.change(ui, { ...frame, lines: lines.includes(n)
                ? lines.filter((line) => line !== n) : [...lines, n].sort((a, b) => a - b) });
        }
        const entries = ui.quiver.all_cells().filter((cell) => cell.is_vertex()
            && SpectralSequence.inside(frame, cell.position)
            && SpectralSequence.bidegree(frame, cell.position).reduce((a, b) => a + b) === n);
        ui.deselect();
        ui.select(...entries);
        if (entries.length === 0 && !flags.includes("line")) {
            throw new Error(`There are no entries of total degree ${n}.`);
        }
    },
};
Commands.ALIASES["diag"] = "diagonal";
Commands.SHORT["diag"] = "diagonal";
