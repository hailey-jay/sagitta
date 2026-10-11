/// The checks `tests/tikzcd.js` runs, in the context it builds: the sources are already loaded,
/// and `check`, `example`, and `make_ui` are in scope.

/// A diagram loaded from the contents of a `.tikzcd` file, as `DiagramFile.load` does it: the
/// encoded first line is trusted while it still reproduces the file's `tikzcd` environment, and
/// otherwise the tikz-cd is parsed, so that a hand edit wins.
function load(text) {
    const ui = make_ui({ DOM, Quiver, Grid, Settings, Offset });
    DiagramFile.restore_sep(ui, text);
    const encoding = text.match(/^%(?:.*#q=|\s*)([A-Za-z0-9+/=]{8,})\s*$/m);
    let trusted = false;
    if (encoding !== null) {
        try {
            QuiverImportExport.base64.import(ui, encoding[1]);
            trusted = DiagramFile.body(ui.text()) === DiagramFile.body(text);
        } catch (_) {
            // Fall back on the tikz-cd, below.
        }
        if (!trusted) {
            ui.reset();
        }
    }
    let diagnostics = [];
    if (!trusted) {
        ({ diagnostics } = ui.quiver.import(ui, "tikz-cd", text, ui.settings));
    }
    return { ui, trusted, diagnostics };
}

/// A diagram parsed from tikz-cd alone, with no encoded line.
function parse(code) {
    const ui = make_ui({ DOM, Quiver, Grid, Settings, Offset });
    const { diagnostics } = ui.quiver.import(ui, "tikz-cd", code, ui.settings);
    return { ui, diagnostics };
}

/// How many vertices and edges a diagram holds.
const counts = (ui) => [
    ui.quiver.all_cells().filter((cell) => cell.is_vertex()).length,
    ui.quiver.all_cells().filter((cell) => cell.is_edge()).length,
];

/// Every label, in the order the cells were made.
const labels = (ui) => ui.quiver.all_cells().map((cell) => cell.label);

{
    // The round trip a paper depends on: the example opens from its own encoded line, and saving
    // it writes the file back byte for byte.
    const text = example("pullback.tikzcd");
    const { ui, trusted, diagnostics } = load(text);
    check("the example's own line is trusted", trusted, true);
    check("it has no diagnostics", diagnostics.length, 0);
    check("it reads as a square with five arrows", counts(ui), [4, 5]);
    check("and saving it writes the same bytes", ui.text(), text);

    // The same diagram from its tikz-cd alone, with the line taken away.
    const bare = text.replace(/^%.*\n/, "");
    const parsed = parse(bare);
    check("the picture alone reads back", counts(parsed.ui), [4, 5]);
    check("with no diagnostics", parsed.diagnostics.length, 0);
    // The braces the export writes around a label are part of the label the parser reads: the
    // round trip is over the bytes, not over what LaTeX makes of them.
    check("and the same labels",
        labels(parsed.ui).join(" "),
        ["X \\times_Z Y", "Y", "X", "Z", "{\\pr_2}", "{\\pr_1}", "", "g", "f"].join(" "));
    check("the corner survives the parse",
        parsed.ui.quiver.all_cells().filter((cell) => cell.is_edge())
            .map((edge) => edge.options.style.name).sort(),
        ["arrow", "arrow", "arrow", "arrow", "corner"]);

    // A hand edit to the picture beats the encoded line: the line still parses, but it no longer
    // reproduces the environment, so the tikz-cd is what is read.
    const edited = text.replace('"g"', '"g\'"');
    const hand = load(edited);
    check("a hand edit is not trusted", hand.trusted, false);
    check("and the edited label is the one read", labels(hand.ui).includes("g'"), true);

    // A line that decodes to a different diagram is also distrusted, rather than believed over
    // the picture.
    const swapped = text.replace(/^%#q=\S+$/m, `%#q=${
        QuiverImportExport.base64.export(parse("\\begin{tikzcd}\n\tA \\\\\n\tB\n\\end{tikzcd}\n")
            .ui.quiver, new Settings(), {}).data}`);
    check("a line for another diagram is distrusted", load(swapped).trusted, false);
    check("so the picture is what is read", counts(load(swapped).ui), [4, 5]);
}

{
    // The `tikzcd` environment's options carry the separations, which the encoding does not.
    const sep = (options) => {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, Offset });
        DiagramFile.restore_sep(ui, `\\begin{tikzcd}${options}\nA\n\\end{tikzcd}\n`);
        return [ui.sep.column, ui.sep.row];
    };
    check("no options means normal separations", sep(""), [1.8, 1.8]);
    check("a named separation is read", sep("[sep=large]"), [2.7, 2.7]);
    check("one axis at a time", sep("[column sep=tiny, row sep=huge]"), [0.45, 3.6]);
    check("and a length in em", sep("[sep=2.25em]"), [2.25, 2.25]);
    check("a separation that means nothing is ignored", sep("[sep=wide]"), [1.8, 1.8]);
}

{
    // The forms quiver writes, which Sagitta reads the same as its own: the full URL comment, and
    // the bare line.
    const encoded = example("pullback.tikzcd").match(/^%#q=(\S+)$/m)[1];
    for (const [name, line] of [
        ["quiver's URL comment", `% https://q.uiver.app/#q=${encoded}`],
        ["a bare line", `% ${encoded}`],
        ["our own line", `%#q=${encoded}`],
    ]) {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, Offset });
        const match = line.match(/^%(?:.*#q=|\s*)([A-Za-z0-9+/=]{8,})\s*$/m);
        check(`${name} is read`, match !== null, true);
        QuiverImportExport.base64.import(ui, match[1]);
        check(`and gives the same diagram as ${name}`, counts(ui), [4, 5]);
    }

    // A comment too short to be an encoding is left to the parser.
    check("a short comment is not an encoding",
        /^%(?:.*#q=|\s*)([A-Za-z0-9+/=]{8,})\s*$/m.test("% see the paper\n"), false);
}

{
    // Hand-written tikz-cd, in the shapes a paper has: labels above and below the arrow, a loop,
    // a bent arrow, and `\&` for the column separator.
    const triangle = parse(
        "\\begin{tikzcd}\n\tX \\arrow[r, \"f\"] & Y \\arrow[d, \"g\"'] \\\\\n\t& Z\n\\end{tikzcd}\n");
    check("a triangle reads", counts(triangle.ui), [3, 2]);
    check("with no diagnostics", triangle.diagnostics.length, 0);
    check("and the label sides are read",
        triangle.ui.quiver.all_cells().filter((cell) => cell.is_edge())
            .map((edge) => edge.options.label_alignment),
        ["left", "right"]);

    const loop = parse("\\begin{tikzcd}\n\tA \\arrow[\"f\", loop, in=60, out=120, distance=5mm]\n"
        + "\\end{tikzcd}\n");
    check("a loop reads", counts(loop.ui), [1, 1]);
    const [self] = loop.ui.quiver.all_cells().filter((cell) => cell.is_edge());
    check("as an arc from a vertex to itself",
        [self.options.shape, self.source === self.target], ["arc", true]);

    const bent = parse("\\begin{tikzcd}\n\tA \\arrow[r, bend left=30] & B\n\\end{tikzcd}\n");
    check("a bend reads as a curve", bent.ui.quiver.all_cells()
        .filter((cell) => cell.is_edge())[0].options.curve !== 0, true);

    const replaced = parse("\\begin{tikzcd}[ampersand replacement=\\&]\n"
        + "\tA \\arrow[r] \\& B\n\\end{tikzcd}\n");
    check("ampersand replacement reads", counts(replaced.ui), [2, 1]);

    // Something tikz-cd allows and we do not is reported, rather than thrown.
    const unknown = parse("\\begin{tikzcd}\n\tA \\arrow[r, nonsense] & B\n\\end{tikzcd}\n");
    check("an option we do not know is a diagnostic, not a throw",
        [counts(unknown.ui), unknown.diagnostics.length > 0], [[2, 1], true]);
}

{
    // Exporting what the settings ask for.
    const ui = make_ui({ DOM, Quiver, Grid, Settings, Offset });
    QuiverImportExport.base64.import(ui,
        example("pullback.tikzcd").match(/^%#q=(\S+)$/m)[1]);
    const text = () => ui.text();

    check("the export is centred by default", text().startsWith("%#q="), true);
    check("and wrapped in \\[ \\]", text().includes("\\[\\begin{tikzcd}"), true);

    ui.settings.set("export.centre_diagram", false);
    check("centring can be turned off", ui.text().includes("\\[\\begin{tikzcd}"), false);

    ui.settings.set("export.ampersand_replacement", true);
    check("ampersand replacement is written in the options",
        ui.text().includes("ampersand replacement=\\&"), true);
    check("and used between the columns", ui.text().includes(" \\& "), true);
    ui.settings.set("export.ampersand_replacement", false);

    ui.settings.set("export.cramped", true);
    check("cramped is written in the options", ui.text().includes("cramped"), true);
    ui.settings.set("export.cramped", false);

    ui.settings.set("export.standalone", true);
    check("standalone wraps the picture in a document",
        ui.text().includes("\\documentclass"), true);
    ui.settings.set("export.standalone", false);

    // A separation tikz-cd has a name for is written under it, and any other in em. Normal is
    // tikz-cd's own default, so it is written at all only when the other axis differs.
    const written = (column, row) => {
        ui.sep = { column, row };
        return ui.text().match(/\\begin\{tikzcd\}(\[[^\]\n]*\])?/)[1] ?? "";
    };
    check("a named separation is written under its name",
        written(2.7, 0.45), "[column sep=large,row sep=tiny]");
    check("both axes at once are written once", written(2.7, 2.7), "[sep=large]");
    check("a separation with no name is written in em", written(2.25, 2.25), "[sep=2.25em]");
    check("and normal is left to tikz-cd", written(1.8, 1.8), "");
    check("except where the other axis differs", written(1.8, 3.6), "[row sep=huge]");
    check("and every one reads back", (() => {
        ui.sep = { column: 2.7, row: 0.45 };
        const read = make_ui({ DOM, Quiver, Grid, Settings, Offset });
        DiagramFile.restore_sep(read, ui.text());
        return [read.sep.column, read.sep.row];
    })(), [2.7, 0.45]);
}

{
    // `:set`, which parses a value for a setting and says what the setting may be.
    const settings = new Settings();
    check("true and false are spelt several ways", [
        settings.parse("ui.dark_mode", "true"), settings.parse("ui.dark_mode", "on"),
        settings.parse("ui.dark_mode", "yes"), settings.parse("ui.dark_mode", "false"),
        settings.parse("ui.dark_mode", "off"), settings.parse("ui.dark_mode", "no"),
    ], [true, true, true, false, false, false]);
    check("and nothing else is one", settings.parse("ui.dark_mode", "maybe"), undefined);

    check("a number is parsed", settings.parse("ui.zoom", "150"), 150);
    check("a number that is not one is not", settings.parse("ui.zoom", "big"), undefined);
    check("a range is enforced", [
        settings.allows("ui.zoom", 150), settings.allows("ui.zoom", 1000),
    ], [true, false]);
    check("and said in words", settings.expected("ui.zoom"), "a number from 20 to 200");

    check("null is a value where it is allowed", [
        settings.parse("ui.which_key_delay", "null"), settings.allows("ui.which_key_delay", null),
        settings.allows("ui.zoom", null),
    ], [null, true, false]);
    check("which the words say too", settings.expected("ui.which_key_delay"),
        "a number from 0 to 5000, or null");

    check("a preset is checked against the list", [
        settings.allows("diagram.arrow_preset", "equals"),
        settings.allows("diagram.arrow_preset", "wiggly"),
    ], [true, false]);
    check("and the list is what the words name",
        settings.expected("diagram.arrow_preset").startsWith("one of plain, equals,"), true);

    check("the hint characters must be distinct", [
        settings.allows("ui.hint_characters", "ASDF"),
        settings.allows("ui.hint_characters", "AASD"),
        settings.allows("ui.hint_characters", "asdf"),
        settings.allows("ui.hint_characters", "A"),
    ], [true, false, false, false]);

    check("a string setting takes the text as it stands",
        settings.parse("ui.hint_characters", "QWERTY"), "QWERTY");

    // Every setting the layer lists, and every setting at all, can be named on the command line.
    check("every setting parses its own default", Object.keys(settings.data)
        .filter((setting) => !settings.allows(setting, settings.parse(
            setting, `${settings.get(setting)}`))), []);
}

{
    // The rectangle the mark takes (`C-SPC`): every vertex whose column and row lie between the
    // corners, and the arrows between those vertices.
    const { ui } = parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[r, \"f\"] \\arrow[d, \"g\"'] & B \\arrow[d, \"h\"] & E \\\\\n"
        + "\tC \\arrow[r, \"k\"'] & D & F\n"
        + "\\end{tikzcd}\n");
    check("the diagram is a square beside a column", counts(ui), [6, 4]);

    const region = (from, to) => {
        const cells = Keys.cells_between(ui, new Position(...from), new Position(...to));
        return [
            cells.filter((cell) => cell.is_vertex()).map((cell) => cell.label).sort().join(""),
            cells.filter((cell) => cell.is_edge()).map((cell) => cell.label).sort().join(""),
        ];
    };
    check("the square takes its own arrows", region([0, 0], [1, 1]), ["ABCD", "fghk"]);
    check("a row takes the arrow along it", region([0, 0], [1, 0]), ["AB", "f"]);
    check("a column likewise", region([0, 0], [0, 1]), ["AC", "g"]);
    check("one cell takes no arrow", region([0, 0], [0, 0]), ["A", ""]);
    check("the corners may be given either way round",
        region([1, 1], [0, 0]), ["ABCD", "fghk"]);
    check("an arrow needs both its ends", region([1, 0], [1, 1]), ["BD", "h"]);
    check("the whole diagram takes everything", region([0, 0], [2, 1]), ["ABCDEF", "fghk"]);
    check("a region with nothing in it is empty", region([5, 5], [6, 6]), ["", ""]);
}

{
    // A preset with nothing selected sets the preset new arrows take, rather than being refused.
    const ui = make_ui({ DOM, Quiver, Grid, Settings, Offset });
    const commands = new Commands(ui);
    check("new arrows are plain to begin with",
        ui.settings.get("diagram.arrow_preset"), "plain");
    commands.preset("equals");
    check("and a preset with nothing selected sets the default",
        ui.settings.get("diagram.arrow_preset"), "equals");
    commands.preset("dashed");
    check("a modifier is a default as much as a kind is",
        ui.settings.get("diagram.arrow_preset"), "dashed");
    check("every preset is a value the setting allows",
        Object.keys(Commands.PRESETS)
            .filter((name) => !ui.settings.allows("diagram.arrow_preset", name)), []);

    // Styling a component still needs a selection, since there is no default for one alone.
    let refused = "";
    try {
        commands.style("body", "dotted");
    } catch (error) {
        refused = error.message;
    }
    check("a component still asks for a selection",
        refused.startsWith("Select an arrow first"), true);
    check("and says what else the key could do", refused.includes("preset"), true);

    // Every other edge command keeps the short refusal, which the presets have nothing to do with.
    let plain = "";
    try {
        commands.slide("curve", ["2"]);
    } catch (error) {
        plain = error.message;
    }
    check("another edge command says only that", plain, "Select an arrow first.");
}

{
    // `:set`, as the command line runs it.
    const ui = make_ui({ DOM, Quiver, Grid, Settings, Offset });
    const commands = new Commands(ui);
    const set = (...words) => {
        try {
            Commands.TABLE["set"].run(commands, words);
            return null;
        } catch (error) {
            return error.message;
        }
    };
    check("a setting is set by name", [set("ui.zoom", "150"), ui.settings.get("ui.zoom")],
        [null, 150]);
    check("a value out of range is refused, saying what is allowed",
        set("ui.zoom", "1000"), '"1000" is not a value for ui.zoom, which should be a number from'
            + ' 20 to 200.');
    check("and the setting is left alone", ui.settings.get("ui.zoom"), 150);
    check("a setting there is no such thing as is refused",
        set("ui.colour"), 'Unknown setting "ui.colour". Press Tab for a list.');
    check("with no setting at all, likewise",
        set(), 'Unknown setting "". Press Tab for a list.');
    check("a setting with no value is only reported",
        [set("ui.zoom"), ui.settings.get("ui.zoom")], [null, 150]);
    check("true and false are set in words",
        [set("ui.dark_mode", "on"), ui.settings.get("ui.dark_mode")], [null, true]);
    check("and nonsense for them is refused",
        set("ui.dark_mode", "sometimes"),
        '"sometimes" is not a value for ui.dark_mode, which should be true or false.');
    check("null is a value where the setting takes one",
        [set("ui.which_key_delay", "null"), ui.settings.get("ui.which_key_delay")], [null, null]);
    check("a preset is set by name",
        [set("diagram.arrow_preset", "mono"), ui.settings.get("diagram.arrow_preset")],
        [null, "mono"]);
    check("and one there is no such thing as is refused",
        set("diagram.arrow_preset", "wiggly").startsWith('"wiggly" is not a value'), true);
    check("every setting is offered for completion",
        Commands.TABLE["set"].completions(commands).length, Object.keys(ui.settings.data).length);
}
