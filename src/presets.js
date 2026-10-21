/// Presets: commands that stamp a ready-made diagram at the focus point, as one step to undo, such
/// as a chain complex (`:chain-complex`) or a short exact sequence (`:ses`). What they stamp is
/// ordinary cells: once it is down, nothing remembers the preset.
///
/// A preset is described by options (`Presets.parse`), laid out as a sequence of terms with arrows
/// between them (`Presets.sequence`), and stamped (`Presets.stamp`) as a paste is, through the
/// encoding `QuiverImportExport.base64` reads, so that it lands on the focus point and is refused
/// if it would land on cells already there.

/// A label with places for an index, as `C_#`: `#` is the index, `#{#-1}` arithmetic on it, and
/// `#p` and `#q` the bidegree, where there is one. An index is a number, or a symbol and an offset,
/// as `n+1`; after `_` or `^`, an index of more than one character is braced, as `C_{n+1}`.
class Template {
    /// Split `text` at its commas, except those inside brackets or braces, as `A,B,\hom(X,Y)`.
    static list(text) {
        const parts = [""];
        let depth = 0;
        for (const c of text) {
            if ("({[".includes(c)) {
                ++depth;
            } else if (")}]".includes(c)) {
                --depth;
            }
            if (c === "," && depth === 0) {
                parts.push("");
            } else {
                parts[parts.length - 1] += c;
            }
        }
        return parts;
    }

    /// An index as text: `coefficient` times the symbol `base` (if any) plus `offset`, as `3`,
    /// `n`, `n+1`, `-n`, or `2n-1`.
    static index({ coefficient = 1, offset }, base = null) {
        if (base === null || coefficient === 0) {
            return `${offset}`;
        }
        const symbol = coefficient === 1 ? base : coefficient === -1 ? `-${base}`
            : `${coefficient}${base}`;
        return offset === 0 ? symbol : `${symbol}${offset > 0 ? "+" : "-"}${Math.abs(offset)}`;
    }

    /// `template` with its places filled from `values`: a map from `#`, and `#p` and `#q` if the
    /// preset has them, to `{ offset }` (and `base`, a symbol, for `#` alone). `#p` is read as
    /// `#` followed by `p` where there is no `#p`.
    static expand(template, values) {
        const base = values.get("#").base ?? null;
        const place = (name) => Template.evaluate(name, values);
        let text = "";
        for (let i = 0; i < template.length;) {
            // `\#` is TeX's own `#`, not a place.
            if (template[i] === "\\") {
                text += template.slice(i, i + 2);
                i += 2;
                continue;
            }
            if (template[i] !== "#") {
                text += template[i++];
                continue;
            }
            let value;
            if (template[i + 1] === "{") {
                const close = Template.closing(template, i + 1);
                value = Template.evaluate(template.slice(i + 2, close), values);
                i = close + 1;
            } else if (values.has(template.slice(i, i + 2))) {
                value = place(template.slice(i, i + 2));
                i += 2;
            } else {
                value = place("#");
                i += 1;
            }
            const filled = Template.index(value, base);
            // `C_n+1` would subscript the `n` alone.
            text += /[_^]$/.test(text) && filled.length > 1 ? `{${filled}}` : filled;
        }
        return text;
    }

    /// The index of the brace closing the one at `open` in `text`.
    static closing(text, open) {
        const close = Index.closing(text, open);
        if (close === -1) {
            throw new Error(`The brace after # in "${text}" is never closed.`);
        }
        return close;
    }

    /// The value of `expression`, a sum of integers and the places in `values` (`#`, `#p`, `#q`),
    /// each perhaps times an integer, as `#-1` or `2#p+#q`, as `{ coefficient, offset }`: so much
    /// of the symbol of `#`, if it has one, and so much besides.
    static evaluate(expression, values) {
        const tokens = expression.replace(/\s+/g, "").match(/#[pq]?|\d+|[-+*()]/g) ?? [];
        if (tokens.join("") !== expression.replace(/\s+/g, "")) {
            throw new Error(`"#{${expression}}" is not arithmetic on #: use numbers, +, -, *,`
                + " and brackets.");
        }
        let at = 0;
        // A value is `{ coefficient, offset }`: the symbol's multiple, and the rest.
        const place = (name) => {
            const value = values.get(name);
            if (value === undefined) {
                throw new Error(`There is no ${name} here.`);
            }
            // Only `#` can have a symbol; the bidegree is a number.
            return name === "#" && value.base !== undefined && value.base !== null
                ? { coefficient: value.coefficient ?? 1, offset: value.offset }
                : { coefficient: 0, offset: value.offset };
        };
        const atom = () => {
            const token = tokens[at++];
            if (token === "(") {
                const value = sum();
                if (tokens[at++] !== ")") {
                    throw new Error(`"#{${expression}}" has a bracket left open.`);
                }
                return value;
            }
            if (token === "-") {
                const value = atom();
                return { coefficient: -value.coefficient, offset: -value.offset };
            }
            if (token !== undefined && /^\d+$/.test(token)) {
                return { coefficient: 0, offset: Number(token) };
            }
            if (token !== undefined && token.startsWith("#")) {
                return place(token);
            }
            throw new Error(`"#{${expression}}" is not arithmetic on #.`);
        };
        const product = () => {
            let value = atom();
            while (tokens[at] === "*") {
                ++at;
                const other = atom();
                if (value.coefficient !== 0 && other.coefficient !== 0) {
                    throw new Error(`"#{${expression}}" multiplies the index by itself.`);
                }
                value = value.coefficient === 0
                    ? { coefficient: value.offset * other.coefficient,
                        offset: value.offset * other.offset }
                    : { coefficient: value.coefficient * other.offset,
                        offset: value.offset * other.offset };
            }
            return value;
        };
        const sum = () => {
            let value = product();
            while (tokens[at] === "+" || tokens[at] === "-") {
                const sign = tokens[at++] === "+" ? 1 : -1;
                const other = product();
                value = { coefficient: value.coefficient + sign * other.coefficient,
                    offset: value.offset + sign * other.offset };
            }
            return value;
        };
        const value = sum();
        if (at !== tokens.length) {
            throw new Error(`"#{${expression}}" is not arithmetic on #.`);
        }
        return value;
    }
}

/// The indices of a label: its subscripts and superscripts that are a number, a lower-case
/// letter, or a multiple of one plus or minus a number, as the `2`, `n`, and `n-1` of `C_2`,
/// `H^n`, and `\partial_{n-1}`. A script that is anything else, such as `\alpha`, `X`, or
/// `{p,q}`, is not an index. Nor is one inside brackets, as the `2` of `H^n(X; \mathbb{Z}_2)` or
/// the `0` of `\pi_n(X, x_0)`, which are arguments, or inside another script, or one whose
/// letter a script binds, as the `i` of `\sum_{i=1}^n x_i`.
class Index {
    /// The indices of `label`, as `{ start, end, braced, value, base }`: where the script's
    /// contents start and end (inside its braces, if `braced`), and its value (see `parse`).
    static scan(label) {
        const scripts = [];
        // How deep in brackets, `(` or `[`, the script is.
        let depth = 0;
        for (let i = 0; i < label.length; ++i) {
            const c = label[i];
            if (c === "\\") {
                // A control symbol, as `\{` or `\_`, is not a bracket or a script.
                ++i;
                continue;
            }
            if (c === "(" || c === "[") {
                ++depth;
                continue;
            }
            if (c === ")" || c === "]") {
                depth = Math.max(0, depth - 1);
                continue;
            }
            if (c !== "_" && c !== "^") {
                continue;
            }
            const braced = label[i + 1] === "{";
            const start = i + (braced ? 2 : 1);
            let end = braced ? Index.closing(label, i + 1) : start + 1;
            // An unbraced control word is the script whole, as `\alpha` is.
            if (!braced && label[start] === "\\") {
                end = start + 1 + (label.slice(start + 1).match(/^[a-zA-Z]+|^./)?.[0].length ?? 0);
            }
            if (end === -1 || end > label.length) {
                continue;
            }
            scripts.push({ start, end, braced, depth, text: label.slice(start, end) });
            // What is inside a script is not looked at again.
            i = braced ? end : end - 1;
        }
        // The letters a script binds, as `\sum_{i=1}` binds `i`.
        const bound = new Set(scripts.map(({ text }) => text.match(/^\s*([a-z])\s*=/)?.[1])
            .filter((letter) => letter !== undefined));
        const found = [];
        for (const { start, end, braced, depth, text } of scripts) {
            const parsed = depth === 0 ? Index.parse(text) : null;
            if (parsed !== null && !bound.has(parsed.base)) {
                found.push({ start, end, braced, ...parsed });
            }
        }
        return found;
    }

    /// The index of the brace closing the one at `open` in `text`, or -1.
    static closing(text, open) {
        let depth = 0;
        for (let i = open; i < text.length; ++i) {
            if (text[i] === "{") {
                ++depth;
            } else if (text[i] === "}" && --depth === 0) {
                return i;
            }
        }
        return -1;
    }

    /// `text` as an index, `{ value: { coefficient, offset }, base }`, or `null` if it is not one.
    static parse(text) {
        const match = text.replace(/\s+/g, "").match(/^(?:(-?\d*)([a-z]))?([+-]?\d+)?$/);
        if (match === null || text.trim() === "" || (match[2] === undefined && match[1] !== undefined)) {
            return null;
        }
        const [, multiple = "", base = null, offset = "0"] = match;
        if (base !== null && match[3] !== undefined && !/^[+-]/.test(match[3])) {
            return null;
        }
        const coefficient = base === null ? 0
            : multiple === "" ? 1 : multiple === "-" ? -1 : Number(multiple);
        return { value: { coefficient, offset: Number(offset) }, base };
    }

    /// `label` with each of its indices moved by `k`.
    static shift(label, k) {
        let text = label;
        for (const { start, end, braced, value, base } of Index.scan(label).reverse()) {
            const moved = Template.index({ ...value, offset: value.offset + k }, base);
            const brace = !braced && moved.length > 1;
            text = text.slice(0, start) + (brace ? `{${moved}}` : moved) + text.slice(end);
        }
        return text;
    }

    /// How far the indices of `to` are from those of `from`, where the labels are alike but for
    /// their indices, and every index has moved the same way, as `C_2` to `C_1` (-1); or `null`.
    static step(from, to) {
        const skeleton = (label, indices) => indices.reduceRight((text, { start, end }) =>
            text.slice(0, start) + "#" + text.slice(end), label).replace(/[{}]/g, "");
        const [a, b] = [Index.scan(from), Index.scan(to)];
        if (a.length === 0 || a.length !== b.length || skeleton(from, a) !== skeleton(to, b)) {
            return null;
        }
        const steps = new Set(a.map((index, i) => index.base === b[i].base
            && index.value.coefficient === b[i].value.coefficient
            ? b[i].value.offset - index.value.offset : NaN));
        const [step] = steps;
        return steps.size === 1 && Number.isFinite(step) && step !== 0 ? step : null;
    }
}

class Presets {
    /// Read a preset's arguments, `words`, by `schema`: a map from each option's name to `{ kind,
    /// default, values }`, where `kind` is `integer`, `text`, or `choice` (one of `values`). The
    /// first word may be the number `N`, if the schema has it; the rest are `key=value`, or a bare
    /// `flag` for an option of kind `flag`. Returns the options, defaults filled in.
    static parse(words, schema, command) {
        const options = {};
        for (const [name, { default: fallback }] of Object.entries(schema)) {
            options[name] = fallback;
        }
        const keys = () => Object.keys(schema).filter((name) => name !== "N")
            .map((name) => schema[name].kind === "flag" ? name : `${name}=`).join(", ");
        for (const [i, word] of words.entries()) {
            const equals = word.indexOf("=");
            let [name, value] = equals === -1 ? [word, null]
                : [word.slice(0, equals), word.slice(equals + 1)];
            if (i === 0 && value === null && schema.N !== undefined && /^-?\d+$/.test(word)) {
                [name, value] = ["N", word];
            }
            const option = schema[name];
            if (option === undefined || (value === null) !== (option.kind === "flag")) {
                throw new Error(`${command} takes ${schema.N !== undefined ? "a number of terms,"
                    + " then " : ""}${keys()}: not "${word}".`);
            }
            switch (option.kind) {
                case "flag":
                    options[name] = true;
                    break;
                case "integer":
                    if (!/^-?\d+$/.test(value) || (option.min !== undefined
                        && Number(value) < option.min)) {
                        throw new Error(`${name} takes a whole number${option.min !== undefined
                            ? ` of at least ${option.min}` : ""}: not "${value}".`);
                    }
                    options[name] = Number(value);
                    break;
                case "choice": {
                    const choice = option.aliases?.[value] ?? value;
                    if (!option.values.includes(choice)) {
                        throw new Error(`${name} takes ${Presets.or(option.values)}: not "${
                            value}".`);
                    }
                    options[name] = choice;
                    break;
                }
                case "range": {
                    const range = value.match(/^(-?\d+)\.\.(-?\d+)$/);
                    if (range === null || Number(range[1]) > Number(range[2])) {
                        throw new Error(`${name} takes a range from low to high, as ${name}=0..4: not "${
                            value}".`);
                    }
                    options[name] = [Number(range[1]), Number(range[2])];
                    break;
                }
                default:
                    options[name] = value;
            }
        }
        return options;
    }

    /// An option's value as the command line writes it: a range as `0..4`.
    static show(option, value) {
        return option.kind === "range" && value !== null ? `${value[0]}..${value[1]}` : `${value}`;
    }

    /// `values` as words joined by "or".
    static or(values) {
        return values.length < 3 ? values.join(" or ")
            : `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
    }

    /// The completions of a preset's arguments: each choice as `key=value`, each flag, the other
    /// keys as `key=`, and after those, any values an option suggests, as `obj=\bullet`.
    static completions(schema) {
        return Object.entries(schema).filter(([name]) => name !== "N")
            .flatMap(([name, option]) => option.kind === "flag" ? [name]
                : option.kind === "choice" ? option.values.map((value) => `${name}=${value}`)
                    : [`${name}=`, ...(option.suggest ?? []).map((value) => `${name}=${value}`)]);
    }

    /// Lay out a sequence of `terms` (labels) with an arrow between each two (`arrows`, each `{
    /// label, preset }`), as `{ vertices, edges }` (see `stamp`), from `(0, 0)`:
    ///
    /// - `dir` (`r`, `l`, `d`, `u`) is the way the arrows point, with `step` cells between terms;
    /// - `wrap`, if not 0, puts so many terms in each row (or column, going up or down), the next
    ///   one an empty row further on, with the arrow from each to the next routed through it,
    ///   back to the start: the snake of a long exact sequence;
    /// - `before` and `after`, if not `null`, are labels set at either end, beyond the wrap, as
    ///   `0` or `\cdots`, with an arrow from or to them.
    static sequence({ terms, arrows, dir = "r", step = 1, wrap = 0, before = null, after = null }) {
        // Along the sequence, and across it to the next row of a wrap.
        const along = { r: [1, 0], l: [-1, 0], d: [0, 1], u: [0, -1] }[dir];
        const across = dir === "r" || dir === "l" ? [0, 2] : [2, 0];
        const per = wrap > 0 ? wrap : terms.length;
        const at = (i, row = Math.floor(i / per)) => {
            const column = i - row * per;
            return [along[0] * column * step + across[0] * row,
                along[1] * column * step + across[1] * row];
        };
        const vertices = terms.map((label, i) => ({ position: at(i), label }));
        const edges = arrows.map((arrow, i) => {
            const edge = { source: i, target: i + 1, ...arrow };
            // An arrow to the next row turns into the empty row between, runs back along it, and
            // turns again into the next row's first term.
            if (wrap > 0 && Math.floor(i / per) !== Math.floor((i + 1) / per)) {
                const [from, to] = [at(i), at(i + 1)];
                const between = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
                // With one term to a row, the next is straight across: no route is needed.
                if (across[1] !== 0 ? from[0] !== to[0] : from[1] !== to[1]) {
                    edge.route = across[1] !== 0
                        ? [[from[0], between[1]], [to[0], between[1]]]
                        : [[between[0], from[1]], [between[0], to[1]]];
                }
            }
            return edge;
        });
        if (before !== null) {
            const first = at(0);
            vertices.unshift({ position: [first[0] - along[0] * step, first[1] - along[1] * step],
                label: before });
            for (const edge of edges) {
                ++edge.source;
                ++edge.target;
            }
            edges.unshift({ source: 0, target: 1, label: "", preset: "plain" });
        }
        if (after !== null) {
            const last = at(terms.length - 1);
            vertices.push({ position: [last[0] + along[0] * step, last[1] + along[1] * step],
                label: after });
            edges.push({ source: vertices.length - 2, target: vertices.length - 1, label: "",
                preset: "plain" });
        }
        return { vertices, edges };
    }

    /// Stamp `{ vertices, edges }` at the focus point of `ui`, as one step to undo, and select it
    /// (see `place`). Its cells are queued for labelling, as cells just drawn are, so that Tab
    /// walks them (see `Keys.next_queued`) until each is labelled or the queue is let go.
    static stamp(ui, spec) {
        Presets.one_frame(ui, spec);
        const cells = Presets.place(ui, spec);
        Presets.order(ui, cells);
        // A spectral sequence's ticks and axis names are set, so Tab passes them by.
        const placed = Array.from(cells);
        for (const [i, cell] of placed.entries()) {
            if (!(i < spec.vertices.length && spec.vertices[i].fixed)) {
                cell.element.query_selector("kbd")?.class_list.add("queue");
            }
        }
        // A spectral sequence's frame comes with it, in the same step (see `SpectralSequence`).
        const frame = spec.frame === undefined ? []
            : [{ kind: "frame", from: ui.frame ?? null, to: Presets.frame(ui, spec.frame) }];
        if (frame.length > 0) {
            ui.history.effect(ui, frame, false);
        }
        ui.history.add(ui, [{ kind: "create", cells }, ...frame]);
        ui.deselect();
        ui.select(...cells);
        return cells;
    }

    /// Order `cells`, just stamped, for Tab as they are read along the diagram: each object, then
    /// the arrows from it (each followed by those on it), so that a sequence goes `C_2`, `\partial_2`,
    /// `C_1`, `\partial_1`, `C_0`, rather than all its objects before any arrow.
    static order(ui, cells) {
        const stamped = Array.from(cells);
        const ordered = [];
        const visit = (cell) => {
            if (ordered.includes(cell)) {
                return;
            }
            ordered.push(cell);
            for (const edge of stamped) {
                if (edge.is_edge() && edge.source === cell) {
                    visit(edge);
                }
            }
        };
        stamped.filter((cell) => cell.is_vertex()).forEach(visit);
        stamped.forEach(visit);
        const serials = ordered.map((cell) => cell.serial).sort((a, b) => a - b);
        ordered.forEach((cell, i) => cell.serial = serials[i]);
        ui.recode();
    }

    /// Throw if `spec` brings a spectral sequence's frame to a diagram that has one: a diagram
    /// keeps one frame, and a second would take the first's axes and bidegrees.
    static one_frame(ui, spec) {
        if (spec.frame !== undefined && ui.frame !== null && ui.frame !== undefined) {
            throw new Error("This diagram has a spectral sequence already, and keeps only one:"
                + " put the next page in a diagram of its own.");
        }
    }

    /// The cells already in `ui` that `{ vertices }`, stamped at its focus point, would land on.
    static in_the_way(ui, { vertices }) {
        return vertices.map(({ position }) => ui.positions.get(`${
            ui.focus_position.add(new Position(...position))}`)).filter((cell) => cell !== undefined);
    }

    /// Add `{ vertices, edges }` at the focus point of `ui`, outside the history, returning the
    /// cells. Each vertex is `{ position: [x, y], label }`, its position relative to the focus
    /// point, and each edge `{ source, target, label, preset, alignment, route, options }`, its
    /// ends indices into `vertices` (or, past them, into `edges`). Throws, adding nothing, if a
    /// vertex would land on a cell already there.
    static place(ui, { vertices, edges }) {
        const origin = ui.focus_position;
        const xs = vertices.map(({ position }) => position[0]);
        const ys = vertices.map(({ position }) => position[1]);
        // The encoding counts from the top-left cell, so the stamp is moved there and back.
        const corner = new Position(Math.min(...xs), Math.min(...ys));
        for (const { position, label } of vertices) {
            const at = origin.add(new Position(...position));
            const there = ui.positions.get(`${at}`);
            if (there !== undefined) {
                // A tick's label is set small, which says nothing here.
                const name = (text) => text === "" ? "a cell" : text.replace(/^\\scriptstyle\s*/, "");
                throw new Error(`That would land ${name(label)} on ${name(there.label)} already at (${
                    at.x}, ${at.y}): move the focus point somewhere with room.`);
            }
        }
        const encoded = [0, vertices.length,
            ...vertices.map(({ position, label }) => [
                position[0] - corner.x, position[1] - corner.y, label,
            ]),
            ...edges.map(({ source, target, label = "", preset = "plain", alignment = "left",
                route = [], options = {} }) => {
                const delta = { ...Presets.style(preset), ...options };
                if (route.length > 0) {
                    delta.route = route.map(([x, y]) => [x - corner.x, y - corner.y]);
                }
                return [source, target, label,
                    { left: 0, centre: 1, right: 2, over: 3 }[alignment], delta];
            }),
        ];
        const bytes = new TextEncoder().encode(JSON.stringify(encoded));
        // In pieces, since spreading a large stamp's bytes into one call overflows the stack.
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return new Set(QuiverImportExport.base64.import(ui, btoa(binary), origin.add(corner),
            false));
    }

    /// A preset's frame, its origin given from the focus point of `ui`, with its origin where it
    /// lands.
    static frame(ui, frame) {
        return { ...frame, origin: ui.focus_position.add(new Position(...frame.origin)) };
    }

    /// Stamp the preset `name` (one of `COMMANDS`) with the options `words` give, as the command
    /// line runs it without the setup layer.
    static run(ui, name, words) {
        return Presets.stamp(ui, Presets.build[name](Presets.parse(words, Presets.schema(name), name)));
    }

    /// The values the setup layer's keys for `option` step to from `value`, other than itself.
    static steps(option, value) {
        switch (option.kind) {
            case "integer":
                return [value + 1, Math.max(option.min ?? -Infinity, value - 1)]
                    .filter((next) => next !== value);
            case "flag":
                return [!value];
            case "choice":
                return option.values.filter((next) => next !== value);
            default:
                return [];
        }
    }

    /// How the command line writes `option` (named `name`) at its value amscd can draw, as
    /// `wrap=0`, `row`, or `no split`.
    static amscd(name, option) {
        return option.kind === "flag" ? `${option.amscd ? "" : "no "}${name}`
            : `${name}=${Presets.show(option, option.amscd)}`;
    }

    /// The short name of the preset `name`, as `cc`.
    static short(name) {
        return Presets.COMMANDS.find(([command]) => command === name)[1];
    }

    /// The options the preset `name` takes.
    static schema(name) {
        return Presets.COMMANDS.find(([command]) => command === name)[2];
    }

    /// The words that give `options` to the preset `name`: those that differ from the defaults,
    /// the number of terms first, quoted where they hold a space or a semicolon.
    static words(name, options) {
        const schema = Presets.schema(name);
        const words = [];
        for (const [key, option] of Object.entries(schema)) {
            const value = options[key];
            if (value === option.default) {
                continue;
            }
            const text = option.kind === "flag" ? key : key === "N" ? `${value}`
                : `${key}=${Presets.show(option, value)}`;
            words.push(/[\s;"]/.test(text) ? `"${text.replace(/"/g, "\\\"")}"` : text);
        }
        return words;
    }

    /// The options of an arrow drawn as `preset` (one of `Commands.PRESETS`), as the encoding
    /// writes them: its style, and its level if not 1.
    static style(preset) {
        const { level = 1, ...components } = Commands.PRESETS[preset];
        const style = {};
        for (const [component, value] of Object.entries(components)) {
            style[component] = ArrowOptions.style_data(component, Commands.STYLES[component][value]);
        }
        return level === 1 ? { style } : { style, level };
    }

    /// The terms and arrows of a complex of `count` terms, labelled from `obj` and `d` (templates,
    /// or comma lists of them, which cycle), with the index falling along it for a chain complex
    /// and rising for a cochain complex. A comma list keeps one index for a whole cycle through it,
    /// as a long exact sequence does. The indices end at `from` (a chain complex) or start there
    /// (a cochain complex); or, given a symbol `at`, are centred on it, as `n+1, n, n-1`.
    static complex({ count, type, from, at, obj, d }) {
        const objects = Template.list(obj);
        const differentials = d === "none" ? null : Template.list(d);
        const cycles = Math.ceil(count / objects.length);
        const falling = type === "chain";
        // `at` is a symbol, perhaps a multiple of one and a number, as `n`, `2k`, or `n+1`.
        const about = at === null || at === undefined ? null : Index.parse(at);
        if (about === null && at !== null && at !== undefined || about?.base === null) {
            throw new Error(`at takes a lower-case letter, as at=n, or one with a number, as`
                + ` at=n+1: not "${at}".`);
        }
        const first = about !== null
            ? about.value.offset + (falling ? 1 : -1) * Math.floor((cycles - 1) / 2)
            : falling ? from + cycles - 1 : from;
        const base = about?.base ?? null;
        const coefficient = about?.value.coefficient ?? 1;
        const index = (i) => ({ base, coefficient, offset: first + (falling ? -1 : 1)
            * Math.floor(i / objects.length) });
        const values = (i) => new Map([["#", index(i)]]);
        const terms = Array.from({ length: count },
            (_, i) => Template.expand(objects[i % objects.length], values(i)));
        const arrows = Array.from({ length: count - 1 }, (_, i) => ({
            label: differentials === null ? ""
                : Template.expand(differentials[i % differentials.length], values(i)),
            preset: "plain",
        }));
        return { terms, arrows, index };
    }

    /// The labels at the ends of a complex laid out in the direction `dir`: `0` where it is
    /// bounded, and where it is not, `\cdots` along a row or `\vdots` down a column.
    static ends(bounded, dir = "r") {
        const dots = dir === "d" || dir === "u" ? "\\vdots" : "\\cdots";
        const at = (end) => ["both", end].includes(bounded) ? "0" : dots;
        return { before: at("start"), after: at("end") };
    }
}

/// `:chain-complex N` (`:cc`): see `scratch/0.7.0/presets.md` and `docs/sagitta.md`.
///
/// Each option has its key in the setup layer: a number steps up with it and down with its
/// capital, a choice steps through its values, and a flag turns on and off. Text is typed on the
/// command line, which `:` in the layer opens on the options so far. An option with `amscd` has
/// that one value amscd can draw (as `wrap=0`): the setup layer suggests it, and dims the option
/// where its keys could only step away from it.
Presets.CHAIN_COMPLEX = {
    N: { kind: "integer", default: 3, min: 1, key: "n", title: "terms" },
    dir: { kind: "choice", default: "r", values: ["r", "d", "l", "u"], key: "o",
        title: "direction" },
    type: { kind: "choice", default: "chain", values: ["chain", "cochain"], key: "t",
        title: "type" },
    from: { kind: "integer", default: 0, key: "f", title: "indices from" },
    at: { kind: "text", default: null, title: "indices about", suggest: ["n", "k"] },
    bounded: { kind: "choice", default: "none", values: ["none", "start", "end", "both"],
        aliases: { left: "start", right: "end" }, key: "b", title: "bounded" },
    obj: { kind: "text", default: null, title: "objects" },
    d: { kind: "text", default: null, title: "differentials" },
    step: { kind: "integer", default: 1, min: 1, key: "s", title: "cells apart", amscd: 1 },
    wrap: { kind: "integer", default: 0, min: 0, key: "w", title: "terms a row", amscd: 0 },
    aug: { kind: "text", default: null, title: "augmented to", suggest: ["M"] },
};

/// `:exact-sequence N` (`:es`): a complex bounded at both ends by `0`, its indices rising from 1,
/// and its arrows unlabelled.
Presets.EXACT_SEQUENCE = {
    ...Presets.CHAIN_COMPLEX,
    type: { ...Presets.CHAIN_COMPLEX.type, default: "cochain" },
    from: { ...Presets.CHAIN_COMPLEX.from, default: 1 },
    bounded: { ...Presets.CHAIN_COMPLEX.bounded, default: "both" },
    obj: { kind: "text", default: "A_#", title: "objects" },
    d: { kind: "text", default: "none", title: "maps" },
};

/// `:short-exact-sequence` (`:ses`): `0 → A ↪ B ↠ C → 0`.
Presets.SHORT_EXACT_SEQUENCE = {
    dir: Presets.CHAIN_COMPLEX.dir,
    obj: { kind: "text", default: "A,B,C", title: "objects" },
    maps: { kind: "text", default: "", title: "maps" },
    plain: { kind: "flag", default: false, key: "p", title: "plain arrows", amscd: true },
    split: { kind: "flag", default: false, key: "s", title: "split", amscd: false },
    under: { kind: "flag", default: false, key: "u", title: "section under" },
};

/// `:long-exact-sequence N` (`:les`): the long exact sequence of a short exact sequence, three
/// terms a row, the connecting map `\delta` routed from each row to the next.
Presets.LONG_EXACT_SEQUENCE = {
    N: { ...Presets.CHAIN_COMPLEX.N, default: 6, min: 2 },
    dir: Presets.CHAIN_COMPLEX.dir,
    obj: { kind: "text", default: null, title: "objects" },
    from: Presets.CHAIN_COMPLEX.from,
    at: Presets.CHAIN_COMPLEX.at,
    wrap: { ...Presets.CHAIN_COMPLEX.wrap, default: 3 },
    cohom: { kind: "flag", default: false, key: "c", title: "cohomology" },
    bounded: Presets.CHAIN_COMPLEX.bounded,
};

/// The diagram each preset stamps, from its options.
Presets.build = {
    "chain-complex": (o) => {
        const cochain = o.type === "cochain";
        const { terms, arrows } = Presets.complex({
            count: o.N, type: o.type, from: o.from, at: o.at,
            obj: o.obj ?? (cochain ? "C^#" : "C_#"),
            d: o.d ?? (cochain ? "d^#" : "\\partial_#"),
        });
        const ends = Presets.ends(o.bounded, o.dir);
        // An augmentation `ε` to (or, for a cochain complex, from) `aug`, at the end where the
        // indices start, then `0`: a resolution of `aug`.
        if ((o.aug ?? "") !== "") {
            const arrow = { label: "\\varepsilon", preset: "plain" };
            if (cochain) {
                terms.unshift(o.aug);
                arrows.unshift(arrow);
                ends.before = "0";
            } else {
                terms.push(o.aug);
                arrows.push(arrow);
                ends.after = "0";
            }
        }
        return Presets.sequence({ terms, arrows, dir: o.dir, step: o.step, wrap: o.wrap,
            ...ends });
    },
    "exact-sequence": (o) => Presets.build["chain-complex"](o),
    "short-exact-sequence": (o) => {
        const terms = Template.list(o.obj);
        if (terms.length !== 3) {
            throw new Error(`A short exact sequence has three terms: obj gives ${terms.length}.`);
        }
        const maps = o.maps === "" ? ["", ""] : Template.list(o.maps);
        if (maps.length !== 2) {
            throw new Error(`A short exact sequence has two maps: maps gives ${maps.length}.`);
        }
        const { vertices, edges } = Presets.sequence({
            terms,
            arrows: [
                { label: maps[0], preset: o.plain ? "plain" : "inclusion" },
                { label: maps[1], preset: o.plain ? "plain" : "epi" },
            ],
            dir: o.dir, before: "0", after: "0",
        });
        if (o.split) {
            // A section of the epi, dashed, curving back over it (on the side of the maps' labels,
            // above a row), or under it with `under`, its label outside the curve.
            edges.push({ source: 3, target: 2, label: "s", preset: "plain",
                alignment: o.under ? "left" : "right",
                options: { curve: o.under ? -2 : 2, style: Presets.style("dashed").style } });
        }
        return { vertices, edges };
    },
    "long-exact-sequence": (o) => {
        const script = o.cohom ? "^" : "_";
        const { terms, arrows } = Presets.complex({
            count: o.N, type: o.cohom ? "cochain" : "chain", from: o.from, at: o.at,
            obj: o.obj ?? `H${script}#(A),H${script}#(B),H${script}#(C)`, d: "none",
        });
        const cycle = Template.list(o.obj ?? "A,B,C").length;
        // The connecting maps run from the last term of each cycle to the first of the next.
        arrows.forEach((arrow, i) => {
            if ((i + 1) % cycle === 0) {
                arrow.label = "\\delta";
            }
        });
        return Presets.sequence({ terms, arrows, dir: o.dir, wrap: o.wrap,
            ...Presets.ends(o.bounded, o.dir) });
    },
};

/// `:triangle`: a distinguished triangle `X → Y → Z → X[1]`, in a row, or as a triangle whose
/// third arrow, back from `Z` to `X`, is marked `+1`.
Presets.TRIANGLE = {
    obj: { kind: "text", default: "X,Y,Z", title: "objects" },
    maps: { kind: "text", default: "", title: "maps" },
    row: { kind: "flag", default: false, key: "r", title: "in a row", amscd: true },
};

Presets.build["triangle"] = (o) => {
    const terms = Template.list(o.obj);
    if (terms.length !== 3) {
        throw new Error(`A triangle has three objects: obj gives ${terms.length}.`);
    }
    const maps = o.maps === "" ? ["", "", ""] : Template.list(o.maps);
    if (maps.length !== 3) {
        throw new Error(`A triangle has three maps: maps gives ${maps.length}.`);
    }
    if (o.row) {
        return Presets.sequence({
            terms: [...terms, `${terms[0]}[1]`],
            arrows: maps.map((label) => ({ label, preset: "plain" })),
        });
    }
    return {
        vertices: [
            { position: [0, 0], label: terms[0] },
            { position: [2, 0], label: terms[1] },
            { position: [1, 1], label: terms[2] },
        ],
        edges: [
            { source: 0, target: 1, label: maps[0] },
            { source: 1, target: 2, label: maps[1] },
            { source: 2, target: 0, label: maps[2] === "" ? "+1" : maps[2] },
        ],
    };
};

/// The presets' names and schemas, and their short names, which completion offers too.
Presets.COMMANDS = [
    ["chain-complex", "cc", Presets.CHAIN_COMPLEX],
    ["exact-sequence", "es", Presets.EXACT_SEQUENCE],
    ["short-exact-sequence", "ses", Presets.SHORT_EXACT_SEQUENCE],
    ["long-exact-sequence", "les", Presets.LONG_EXACT_SEQUENCE],
    ["triangle", "tri", Presets.TRIANGLE],
];

/// Each preset opens the setup layer (see `Layer.Preset`), its arguments filling it in, where the
/// keys change the options while a ghost of the result follows the focus point, and RET stamps it.
/// Without the layer (the fast suite has none), it stamps at once.
Presets.register = (name, short, schema) => {
    Commands.TABLE[name] = {
        arguments: true,
        completions: Presets.completions(schema),
        run: (commands, words) => {
            const layer = commands.ui.keymap?.layers.preset;
            if (layer === undefined) {
                Presets.run(commands.ui, name, words);
            } else {
                layer.open(name, Presets.parse(words, schema, name));
            }
        },
    };
    Commands.ALIASES[short] = name;
    Commands.SHORT[short] = name;
};
for (const [name, short, schema] of Presets.COMMANDS) {
    Presets.register(name, short, schema);
}

/// `:continue` (`:cont`): add the next term after each selected cell at the end of a sequence, a
/// cell with one arrow, along that arrow, a step further on, with its label's indices stepped as
/// they step along the arrow (`C_2 → C_1` continues to `C_0`), and the arrow drawn as that one is,
/// its label's indices stepped the same way. Where the indices do not step, the new label is
/// empty, for Tab to fill. The new cells are one step to undo, selected and queued.
Commands.TABLE["continue"] = {
    run: (commands) => Presets.continue(commands.ui),
};
Commands.ALIASES["cont"] = "continue";
Commands.SHORT["cont"] = "continue";

/// `:reindex K`: move every index of the selected labels by `K` (see `Index`), as one step.
Commands.TABLE["reindex"] = {
    arguments: true,
    run: (commands, [k]) => {
        if (k === undefined || !/^[+-]?\d+$/.test(k)) {
            throw new Error(`reindex takes a whole number to move the indices by: not "${
                k ?? ""}".`);
        }
        Presets.reindex(commands.ui, Number(k));
    },
};

Presets.continue = (ui) => {
    const ends = Array.from(ui.selection).filter((cell) => cell.is_vertex());
    if (ends.length === 0) {
        throw new Error("Select the cell at the end of a sequence first.");
    }
    const added = new Set();
    const plans = ends.map((end) => {
        // The arrows between the cell and another, leaving aside loops and arrows on arrows.
        const arrows = Array.from(ui.quiver.dependencies_of(end).keys())
            .filter((edge) => !edge.is_loop() && edge.source.is_vertex()
                && edge.target.is_vertex());
        if (arrows.length !== 1) {
            throw new Error(`${end.label === "" ? "A selected cell" : end.label} has ${
                arrows.length} arrows: :continue goes on from a cell with one.`);
        }
        const [arrow] = arrows;
        const other = arrow.source === end ? arrow.target : arrow.source;
        const position = end.position.add(end.position.sub(other.position));
        const there = ui.positions.get(`${position}`);
        if (there !== undefined) {
            throw new Error(`There is no room after ${end.label === "" ? "the cell" : end.label}: ${
                there.label === "" ? "a cell" : there.label} is in the way.`);
        }
        return { end, arrow, other, position };
    });
    // Two ends cannot go on to the same cell.
    for (const [i, plan] of plans.entries()) {
        const clash = plans.slice(0, i).find(({ position }) => position.eq(plan.position));
        if (clash !== undefined) {
            const name = (cell) => cell.label === "" ? "a cell" : cell.label;
            throw new Error(`${name(clash.end)} and ${name(plan.end)} would both go on to (${
                plan.position.x}, ${plan.position.y}): continue them one at a time.`);
        }
    }
    ui.add_cells(() => {
        for (const { end, arrow, other, position } of plans) {
            const step = Index.step(other.label, end.label);
            const vertex = new Vertex(ui, step === null ? "" : Index.shift(end.label, step),
                position);
            const forward = arrow.target === end;
            const label = step === null || Index.scan(arrow.label).length === 0 ? ""
                : Index.shift(arrow.label, step);
            // The arrow is drawn as the last was, but for a route, which is that arrow's own way.
            const { style, level, label_alignment, label_position, offset, curve, shorten, shape,
                colour, rounding, edge_alignment } = arrow.options;
            const edge = new Edge(ui, label, forward ? end : vertex, forward ? vertex : end,
                Edge.default_options({ level, label_alignment, label_position, offset, curve,
                    shorten, shape, colour, rounding, edge_alignment }, style),
                arrow.label_colour);
            added.add(vertex).add(edge);
        }
    });
    ui.draw_unrendered?.();
    for (const cell of added) {
        cell.element.query_selector("kbd")?.class_list.add("queue");
    }
    ui.history.add(ui, [{ kind: "create", cells: added }]);
    ui.deselect();
    ui.select(...added);
};

Presets.reindex = (ui, k) => {
    const labels = Array.from(ui.selection)
        .map((cell) => ({ cell, from: cell.label, to: Index.shift(cell.label, k) }))
        .filter(({ from, to }) => from !== to);
    if (labels.length === 0) {
        throw new Error("No selected label has an index to move.");
    }
    ui.history.add(ui, [{ kind: "label", labels }], true);
};
