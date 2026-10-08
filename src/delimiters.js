/// How delimiters behave as a label is typed: they pair, wrap what is selected, and are stepped
/// over, as in most editors. Nothing here touches the label input: `Delimiters.type` says what a
/// key should do to a value and a selection, and `UI.create_label_input` does it.
const Delimiters = {};

/// The opening delimiters that wrap a label, or the selected part of one, rather than replacing
/// it, and otherwise bring the delimiter they close with (see `UI.create_label_input`).
Delimiters.PLAIN = { "(": ")", "[": "]", "{": "}", "|": "|" };

/// `text` between the delimiter `open` and its closing one.
Delimiters.wrap = (text, open) => `${open}${text}${Delimiters.PLAIN[open]}`;

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
///   with `\right`, and `\left.` brings `\right.`.
/// - A closing delimiter steps over the same one next (or the same one after `\right`, whether
///   `\right` is typed or not), taking the part of it already typed.
/// - Deleting backwards from inside an empty pair deletes both.
Delimiters.type = (value, start, end, data) => {
    // The pairs, longest first, with `.`, which pairs only after `\left`.
    const pairs = [
        ...Object.entries({ ...Delimiters.PLAIN, ...Delimiters.LATEX }),
        [".", "."],
    ].sort(([a], [b]) => b.length - a.length);
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
                .find((next) => next !== "." && after.startsWith(next));
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
            ...close !== "." ? [[close, close]] : [],
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

    if (Object.hasOwn(Delimiters.PLAIN, data) || data === ".") {
        const escaped = escaping(before);
        const open = escaped ? `\\${data}` : data;
        const partner = open === "."
            ? "." : Delimiters.PLAIN[open] ?? Delimiters.LATEX[open];
        if (partner === undefined) {
            return null;
        }
        const close = closing(escaped ? before.slice(0, -1) : before, partner);
        // `.` is a delimiter only after `\left`.
        if (close === "." || start === end && after.startsWith(close)) {
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
