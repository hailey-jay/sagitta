/// How delimiters behave as a label is typed: they pair, wrap what is selected, and are stepped
/// over, as in most editors. Nothing here touches the label input: `Delimiters.type` says what a
/// key should do to a value and a selection, and `UI.create_label_input` does it.
const Delimiters = {};

/// The opening delimiters that wrap the selected part of a label, and otherwise bring the
/// delimiter they close with (see `UI.create_label_input`).
Delimiters.PLAIN = { "(": ")", "[": "]", "{": "}" };

/// The delimiters that pair only after `\left`: `.`, and `|`, which in a label is as often a
/// restriction or "divides" as an absolute value.
Delimiters.LEFT = { ".": ".", "|": "|" };

/// The LaTeX delimiters that pair in a label too. An escaped one pairs as its last character is
/// typed, and a command once a character that cannot continue its name follows it. `\(` and `\[`
/// are left alone, since a label is already mathematics.
Delimiters.LATEX = {
    "\\{": "\\}", "\\|": "\\|", "\\langle": "\\rangle", "\\lvert": "\\rvert",
    "\\lVert": "\\rVert", "\\lceil": "\\rceil", "\\lfloor": "\\rfloor",
};

/// What typing `data` over `value.slice(start, end)` in a label does, as delimiters do in most
/// editors, as `{ value, start, end }` (the new value and selection), or `null` to let it type
/// itself. `data` is `null` for deleting backwards.
/// - An opening delimiter typed over selected text wraps it, leaving it selected, and otherwise
///   brings its closing one, unless that is already next. After `\left`, the closing one comes
///   with `\right`. `.` and `|` pair only after `\left`, so `\left.` brings `\right.`, and `|`
///   alone types itself.
/// - A closing delimiter steps over the same one next (or the same one after `\right`, whether
///   `\right` is typed or not), taking the part of it already typed.
/// - Deleting backwards from inside an empty pair deletes both.
Delimiters.type = (value, start, end, data) => {
    // The pairs, longest first, with those that pair only after `\left`.
    const pairs = Object.entries({ ...Delimiters.PLAIN, ...Delimiters.LATEX, ...Delimiters.LEFT })
        .sort(([a], [b]) => b.length - a.length);
    // Whether `close` closes a pair only after `\right`.
    const after_right = (close) => Object.hasOwn(Delimiters.LEFT, close);
    // Whether `text` ends in a backslash that escapes whatever follows.
    const escaping = (text) => /(^|[^\\])(\\\\)*\\$/.test(text);
    // `close`, or `\right` and `close` if `text`, which comes before the opening delimiter, ends
    // in `\left`.
    const closing = (text, close) => text.endsWith("\\left")
        && !escaping(text.slice(0, -"\\left".length)) ? `\\right${close}` : close;
    const [before, selected, after] =
        [value.slice(0, start), value.slice(start, end), value.slice(end)];
    const insert = (typed, close) => ({
        value: before + typed + selected + close + after,
        start: start + typed.length,
        end: start + typed.length + selected.length,
    });

    // Deleting a pair leaves any `\left`, to take another delimiter.
    if (data === null) {
        for (const [open, close] of start === end ? pairs : []) {
            const preceding = before.slice(0, -open.length);
            if (!before.endsWith(open) || escaping(preceding)) {
                continue;
            }
            const next = [closing(preceding, close), close]
                .find((next) => !after_right(next) && after.startsWith(next));
            if (next !== undefined) {
                return {
                    value: preceding + after.slice(next.length),
                    start: preceding.length,
                    end: preceding.length,
                };
            }
        }
        return null;
    }

    if (start === end) {
        // The closing delimiters that may come next, and what typing each may have begun: all of
        // it, or, after `\right`, only the delimiter. Longer first, to take as much as possible.
        const steps = pairs.flatMap(([, close]) => [
            [`\\right${close}`, `\\right${close}`],
            [`\\right${close}`, close],
            ...!after_right(close) ? [[close, close]] : [],
        ]).sort(([a, x], [b, y]) => y.length - x.length || b.length - a.length);
        const step = steps.find(([close, typed]) => typed.endsWith(data)
            && before.endsWith(typed.slice(0, -1)) && after.startsWith(close));
        if (step) {
            const [close, typed] = step;
            const caret = start - (typed.length - 1);
            return {
                value: before.slice(0, caret) + after,
                start: caret + close.length,
                end: caret + close.length,
            };
        }
    }

    if (Object.hasOwn(Delimiters.PLAIN, data) || Object.hasOwn(Delimiters.LEFT, data)) {
        const escaped = escaping(before);
        const open = escaped ? `\\${data}` : data;
        const partner = Delimiters.LEFT[open] ?? Delimiters.PLAIN[open] ?? Delimiters.LATEX[open];
        if (partner === undefined) {
            return null;
        }
        const close = closing(escaped ? before.slice(0, -1) : before, partner);
        // `.` and `|` are delimiters only after `\left`.
        if (after_right(close) || start === end && after.startsWith(close)) {
            return null;
        }
        return insert(data, close);
    }

    // A command is complete once something other than a letter follows it.
    const command = before.match(/\\[a-zA-Z]+$/)?.[0];
    if (start === end && command && !/[a-zA-Z]/.test(data)
        && Object.hasOwn(Delimiters.LATEX, command)
        && !escaping(before.slice(0, -command.length))
    ) {
        const close = closing(before.slice(0, -command.length), Delimiters.LATEX[command]);
        if (!after.startsWith(close)) {
            return insert(data, close);
        }
    }
    return null;
};

/// `label` with each bare `%` escaped, as `\%`: in a label, which is a line of its own, a comment
/// would only swallow what follows, in the export as on the canvas, so a `%` is the sign.
Delimiters.percent = (label) => {
    let text = "";
    for (let i = 0; i < label.length; ++i) {
        if (label[i] === "\\") {
            // A control symbol, as `\%` or `\\`, is taken whole.
            text += label.slice(i, i + 2);
            ++i;
        } else {
            text += label[i] === "%" ? "\\%" : label[i];
        }
    }
    return text;
};

/// Whether the braces of `label` balance, as TeX needs them to: escaped ones, as `\{`, aside.
Delimiters.balanced = (label) => {
    let depth = 0;
    for (let i = 0; i < label.length; ++i) {
        if (label[i] === "\\") {
            ++i;
        } else if (label[i] === "{") {
            ++depth;
        } else if (label[i] === "}" && --depth < 0) {
            return false;
        }
    }
    return depth === 0;
};

/// The commands whose group is text, in which `$ $` is maths again.
Delimiters.TEXT_COMMANDS = new Set([
    "text", "textnormal", "textrm", "textup", "textit", "textsl", "textsc", "textbf", "textmd",
    "textsf", "texttt", "emph", "mbox", "hbox",
]);

/// `label` with each `$` that would leave maths escaped as `\$`, so that the canvas draws it as
/// the sign, as quiver does, while a `$` inside a text group, as `\textnormal{Hi $\sum$}`, is
/// left to go back into maths there, as it does in TeX.
Delimiters.dollars = (label) => {
    // The mode of each open group, from the outermost: `math`, `text`, or `text-math`, which is
    // text gone back into maths with `$`.
    const modes = ["math"];
    let text_next = false;
    let out = "";
    for (let i = 0; i < label.length; ++i) {
        const c = label[i];
        const mode = modes[modes.length - 1];
        if (c === "\\") {
            const name = label.slice(i + 1).match(/^[a-zA-Z]+|^./)?.[0] ?? "";
            out += c + name;
            i += name.length;
            text_next = Delimiters.TEXT_COMMANDS.has(name);
            continue;
        }
        if (c === "{") {
            modes.push(text_next && mode !== "text" ? "text" : mode === "text-math" ? "math" : mode);
        } else if (c === "}") {
            if (modes.length > 1) {
                modes.pop();
            }
        } else if (c === "$") {
            if (mode === "text") {
                modes[modes.length - 1] = "text-math";
            } else if (mode === "text-math") {
                modes[modes.length - 1] = "text";
            } else {
                out += "\\$";
                text_next = false;
                continue;
            }
        }
        if (!/\s/.test(c)) {
            text_next = false;
        }
        out += c;
    }
    return out;
};

/// Text-label mode (`:text-labels`, `ui.text_labels`): labels are typed as text, and stored
/// wrapped in `ui.text_wrapper`, `\textnormal` by default, which is upright and of the document's
/// own font even in an italic theorem, and shrinks in an arrow's script style as `\text` does. The
/// label input shows a wrapped label without its wrapper, and wraps what is typed; a label that is
/// not one wrapped group is edited as it is.
const TextLabels = {};

/// The wrappers `ui.text_wrapper` may be, all of which a label is unwrapped from.
TextLabels.WRAPPERS = ["\\textnormal", "\\text", "\\textrm"];

/// What typing a character does in text, outside `$ $`, where TeX would otherwise stop or split
/// the cell: the character as text instead.
TextLabels.ESCAPES = {
    "_": "\\_", "&": "\\&", "#": "\\#", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
};

/// The text inside `label`, if it is one group of a wrapper, as `\textnormal{a b}`, or `null`.
/// The group must close at the end, so `\text{a} \text{b}` is two groups, and not unwrapped.
TextLabels.unwrap = (label) => {
    const wrapper = TextLabels.WRAPPERS.find((wrapper) => label.startsWith(`${wrapper}{`));
    if (wrapper === undefined) {
        return null;
    }
    const start = wrapper.length + 1;
    let depth = 1;
    for (let i = start; i < label.length; ++i) {
        if (label[i] === "\\") {
            ++i;
        } else if (label[i] === "{") {
            ++depth;
        } else if (label[i] === "}" && --depth === 0) {
            return i === label.length - 1 ? label.slice(start, i) : null;
        }
    }
    return null;
};

/// `text` wrapped in `wrapper`, unless it is empty, or already one wrapped group.
TextLabels.wrap = (text, wrapper) => text === "" || TextLabels.unwrap(text) !== null ? text
    : `${wrapper}{${text}}`;

/// What typing `data` after `before` should insert in text instead, or `null` to type it as it
/// is: inside `$ $`, or after a backslash, which escapes it already.
TextLabels.escape = (before, data) => {
    const replacement = TextLabels.ESCAPES[data];
    if (replacement === undefined) {
        return null;
    }
    if (before.match(/\\*$/)[0].length % 2 === 1) {
        return null;
    }
    const dollars = (before.replace(/\\./g, "").match(/\$/g) ?? []).length;
    return dollars % 2 === 0 ? replacement : null;
};
