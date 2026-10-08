/// The LaTeX definitions a `macros.tex` holds: the macros that labels are rendered with, and the
/// colours offered in the colour layer. Nothing here touches the UI (see `UI.load_macros`).
class Macros {
    /// Parse the macros and colours defined in a string, as `{ macros, colours }`: a map from
    /// each `\name` to its `{ definition, arity }`, and a map from each colour's name to its
    /// `Colour`. Lines that are not recognised are skipped with a warning.
    static parse(definitions) {
        // Here, we ignore `{` and `}` around the command name, but later we check that
        // the brackets at least match.
        const newcommand = /^\\((?:re)?newcommand|DeclareMathOperator)(\*?)\{?\\([a-zA-Z]+)\}?(?:\[(\d)\])?\{(.*)\}$/;
        // It's not clear exactly what the rules for colour names is, so we accept a sensible
        // subset. We don't accept `cmyk` for now. We don't validate values in the regex.
        const definecolor = /^\\definecolor\{([a-zA-Z0-9\-]+)\}\{(rgb|RGB|gray|HTML)\}\{((?:\d+(?:\.\d+)?)(?:,(?:\d+(?:\.\d+)?))*|[a-fA-F\d]{6})\}$/;

        const macros = new Map();
        const colours = new Map();

        for (let line of definitions.split("\n")) {
            line = line.trim();
            if (line === "" || line.startsWith("%")) {
                // Skip empty lines and comments.
                continue;
            }

            let match = line.match(newcommand);
            // Check we either have ``{\commandname}` or `\commandname`, but not mismatched
            // brackets.
            if (match !== null && /^\\((re)?newcommand|DeclareMathOperator)\*?(\{\\[a-zA-Z]+\}|\\[a-zA-Z]+[^\}])/.test(line)) {
                const [, kind, star, command, arity = 0, definition] = match;
                if (kind === "DeclareMathOperator" && typeof match[4] !== "undefined") {
                    console.warn(`Operators defined with \`\\DeclareMathOperator\` may take no arguments.`);
                } else {
                    macros.set(`\\${command}`, {
                        definition: kind === "DeclareMathOperator" ? `\\operatorname${star}{${definition}}` : definition,
                        arity,
                    });
                    continue;
                }
            }

            match = line.replace(/\s/g, "").match(definecolor);
            if (match !== null) {
                const [, name, model, value] = match;
                const values = value.split(",").map((x) => parseFloat(x));
                let colour = null;
                switch (model) {
                    case "rgb":
                        if (values.length === 3 && values.every((x) => x <= 1)) {
                            colour = Colour.from_rgba(...values.map((x) => Math.round(x * 255)));
                        }
                        break;
                    case "RGB":
                        if (values.length === 3 && values.every((x) => {
                            return x <= 255 && Number.isInteger(x);
                        })) {
                            colour = Colour.from_rgba(...values);
                        }
                        break;
                    case "gray":
                        if (values.length === 1 && values[0] <= 1) {
                            colour = new Colour(0, 0, Math.round(values[0] * 100));
                        }
                        break;
                    case "HTML":
                        const hex = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;
                        const components = value.match(hex);
                        if (components !== null) {
                            colour = Colour.from_rgba(
                                parseInt(components[1], 16),
                                parseInt(components[2], 16),
                                parseInt(components[3], 16),
                            );
                        }
                        break;
                    default:
                        console.warn(`Encountered unrecognised colour model: \`${model}\``);
                        continue;
                }
                if (colour !== null) {
                    colour.name = name;
                    colours.set(name, colour);
                } else {
                    console.warn(`Ignoring invalid colour specification for \`${name}\``);
                }
                continue;
            }

            // We should have hit a `continue` by now, unless we couldn't parse the line.
            console.warn(`Ignoring unrecognised definition: \`${line}\``);
        }
        return { macros, colours };
    }

    /// The names of the macros whose expansions differ between the definitions `before` and
    /// `after`: those added, removed, or redefined, and those defined in terms of one of those. A
    /// name counts as used wherever it appears, even as the start of a longer name, which errs on
    /// the side of rerendering a label.
    static changed(before, after) {
        const changed = new Set();
        for (const name of new Set([...before.keys(), ...after.keys()])) {
            const [a, b] = [before.get(name), after.get(name)];
            if (a?.definition !== b?.definition || a?.arity !== b?.arity) {
                changed.add(name);
            }
        }
        for (let grew = true; grew;) {
            grew = false;
            for (const definitions of [before, after]) {
                for (const [name, { definition }] of definitions) {
                    if (!changed.has(name)
                        && Array.from(changed).some((used) => definition.includes(used))
                    ) {
                        changed.add(name);
                        grew = true;
                    }
                }
            }
        }
        return changed;
    }

    /// Returns `macros` in a format amenable to passing to KaTeX.
    static for_katex(macros) {
        const katex_macros = {
            // By default, we override these built-in KaTeX macros, as they are typically
            // undesirable for category theory.
            "\\set": null,
            "\\Set": null,
        };
        for (const [name, { definition }] of macros) {
            // Arities are implicit in KaTeX.
            katex_macros[name] = definition;
        }
        // Disable newlines in KaTeX.
        // This doesn't work as intended, because we want to be able to use newlines in some
        // commands like `\substack`, but KaTeX doesn't redefine newlines for such commands.
        // macros["\\\\"] = "\\";
        return katex_macros;
    }
}
