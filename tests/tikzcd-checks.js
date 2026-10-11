/// The checks `tests/tikzcd.js` runs, in the context it builds: the sources are already loaded,
/// and `check`, `example`, and `make_ui` are in scope.

/// A diagram loaded from the contents of a `.tikzcd` file, as `DiagramFile.load` does it: the
/// encoded first line is trusted while it still reproduces the file's `tikzcd` environment, and
/// otherwise the tikz-cd is parsed, so that a hand edit wins.
function load(text) {
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
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
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
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

/// Checks that cannot finish at once, because reading a settings file is asynchronous as the shell
/// does it. `tests/tikzcd.js` waits for these before it counts the failures.
const pending = [];

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
            .ui.quiver, new Settings(SETTINGS), {}).data}`);
    check("a line for another diagram is distrusted", load(swapped).trusted, false);
    check("so the picture is what is read", counts(load(swapped).ui), [4, 5]);
}

{
    // The snake lemma example, which the paper `\input`s beside the pullback: a wider figure, with
    // empty cells, a curved dashed arrow between non-adjacent cells, and labels that need the
    // `\coker` of `examples/macros.tex`.
    const text = example("snake-lemma.tikzcd");
    const { ui, trusted, diagnostics } = load(text);
    check("the snake lemma opens from its own line", trusted, true);
    check("with no diagnostics", diagnostics.length, 0);
    check("as four rows of terms and the arrows between them", counts(ui), [17, 23]);
    check("and saving it writes the same bytes", ui.text(), text);

    // The empty cells of the figure are empty cells, not absent ones: the first row has no fifth
    // term, and the first and last rows have no first term.
    check("the corners of the figure are left out",
        ui.quiver.all_cells().filter((cell) => cell.is_vertex())
            .map((cell) => `${cell.position.x}${cell.position.y}`).sort().join(" "),
        "01 02 10 11 12 13 20 21 22 23 30 31 32 33 41 42 43");

    // The connecting morphism is one arrow across the whole figure, curved and dashed.
    const [delta] = ui.quiver.all_cells().filter((cell) => cell.label === "\\delta");
    check("the connecting morphism runs from ker c to coker a",
        [`${delta.source.position.x}${delta.source.position.y}`,
            `${delta.target.position.x}${delta.target.position.y}`], ["30", "13"]);
    check("and is drawn curved and dashed",
        [delta.options.curve !== 0, delta.options.style.body.name], [true, "dashed"]);

    // Its tikz-cd says so too, which is what LaTeX reads.
    check("the export says as much",
        ui.text().includes('\\arrow["\\delta", curve={height=-6pt}, dashed, from=1-4, to=4-2]'),
        true);

}

{
    // The `tikzcd` environment's options carry the separations, which the encoding does not.
    const sep = (options) => {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
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
        const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
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
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
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
        const read = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
        DiagramFile.restore_sep(read, ui.text());
        return [read.sep.column, read.sep.row];
    })(), [2.7, 0.45]);
}

{
    // `:set`, which parses a value for a setting and says what the setting may be.
    const settings = new Settings(SETTINGS);
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
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
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
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
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

{
    // The staircase a `:snake` draws: one step at a time, alternating between the axes, starting
    // with the axis that has further to go.
    const path = (from, to, first = null) =>
        Commands.staircase(new Position(...from), new Position(...to), first)
            .map((position) => [position.x, position.y]);

    // The snake lemma's connecting morphism: from `ker c` at the top right down and left to
    // `coker a` at the bottom left, as four corners and so five arrows.
    check("the snake lemma's staircase", path([2, 0], [0, 3]),
        [[2, 1], [1, 1], [1, 2], [0, 2]]);
    check("which axis goes first can be asked for", path([2, 0], [0, 3], "x"),
        [[1, 0], [1, 1], [0, 1], [0, 2]]);
    check("a straight run has a corner for every cell between", path([0, 0], [3, 0]),
        [[1, 0], [2, 0]]);
    check("and the axis with nothing left is skipped", path([0, 0], [1, 3]),
        [[0, 1], [1, 1], [1, 2]]);
    check("neighbours have no staircase", path([0, 0], [1, 0]), []);
    check("and nor do cells a row apart", path([0, 0], [0, 1]), []);
    // With the same distance either way, x goes first.
    check("a diagonal step is one corner", path([0, 0], [1, 1]), [[1, 0]]);
    check("the direction is taken from the ends", path([3, 3], [1, 2]),
        [[2, 3], [2, 2]]);
    check("a staircase is as long as the Manhattan distance, less one",
        [[[0, 0], [4, 2]], [[0, 0], [1, 5]], [[2, 2], [0, 0]]].map(([from, to]) =>
            path(from, to).length === Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]) - 1),
        [true, true, true]);
    check("and every step of one moves exactly one cell",
        (() => {
            const corners = [[0, 0], ...path([0, 0], [4, 3]), [4, 3]];
            return corners.slice(1).every(([x, y], i) =>
                Math.abs(x - corners[i][0]) + Math.abs(y - corners[i][1]) === 1);
        })(), true);
}

{
    // Opening a gap for a row or a column moves everything at or beyond it, and the arrows come
    // with their endpoints.
    const square = () => parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[r, \"f\"] \\arrow[d, \"g\"'] & B \\arrow[d, \"h\"] \\\\\n"
        + "\tC \\arrow[r, \"k\"'] & D\n"
        + "\\end{tikzcd}\n").ui;
    const grid = (ui) => ui.quiver.all_cells().filter((cell) => cell.is_vertex())
        .map((cell) => `${cell.label}${cell.position.x}${cell.position.y}`).join(" ");

    let ui = square();
    check("the square starts where the file puts it", grid(ui), "A00 B10 C01 D11");

    // A row above the second row: `C` and `D` move down, `A` and `B` stay.
    ui = square();
    new Commands(ui).insert("y", 1);
    check("a row moves what is at or below it", grid(ui), "A00 B10 C02 D12");
    check("and the arrows are still there", counts(ui), [4, 4]);

    // A column before the first: everything moves right.
    ui = square();
    new Commands(ui).insert("x", 0);
    check("a column before the first moves everything", grid(ui), "A10 B20 C11 D21");

    // A gap past the last row has nothing to move, which is said rather than done silently.
    ui = square();
    let refused = "";
    try {
        new Commands(ui).insert("y", 2);
    } catch (error) {
        refused = error.message;
    }
    check("a gap past the end is refused", refused, "There is no row at or after row 3 to move.");
    check("and nothing moved", grid(ui), "A00 B10 C01 D11");

    // The gap survives the round trip, as an empty row in the matrix.
    ui = square();
    new Commands(ui).insert("y", 1);
    check("the gap is written as an empty row",
        ui.text().includes("\\\\\n\t\\\\\n\t"), true);
    check("and reads back the same way", grid(parse(ui.text()).ui), "A00 B10 C02 D12");
}

{
    // `:snake` replaces one arrow with a chain through new empty cells, and one undo puts the
    // single arrow back.
    const diagonal = () => parse("\\begin{tikzcd}\n"
        + "\tP \\arrow[dr, \"c\"] & \\\\\n\t& Q\n\\end{tikzcd}\n").ui;

    let ui = diagonal();
    check("the diagram is two cells and an arrow between them", counts(ui), [2, 1]);
    let commands = new Commands(ui);

    // With nothing selected, or with more than one arrow, there is nothing to draw.
    let refused = "";
    try {
        commands.snake();
    } catch (error) {
        refused = error.message;
    }
    check("a staircase needs one arrow selected",
        refused, "Select one arrow to draw as a staircase.");

    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    commands.snake();
    // The corner between `P` at (0,0) and `Q` at (1,1) is one new cell, so two arrows.
    check("the arrow becomes a chain through the corner", counts(ui), [3, 2]);
    check("the new cell is empty, and at the corner",
        ui.quiver.all_cells().filter((cell) => cell.is_vertex())
            .map((cell) => `${cell.label || "-"}${cell.position.x}${cell.position.y}`).join(" "),
        "P00 Q11 -10");
    check("and the chain is what is now selected", ui.selection.size, 3);

    ui.history.undo(ui);
    check("one undo puts the single arrow back", counts(ui), [2, 1]);
    check("with its own label", ui.quiver.all_cells()
        .filter((cell) => cell.is_edge()).map((cell) => cell.label), ["c"]);
    ui.history.redo(ui);
    check("and redo draws the chain again", counts(ui), [3, 2]);

    // Neighbours have no staircase, and nor does a loop.
    ui = parse("\\begin{tikzcd}\n\tA \\arrow[r, \"f\"] & B\n\\end{tikzcd}\n").ui;
    commands = new Commands(ui);
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    refused = "";
    try {
        commands.snake();
    } catch (error) {
        refused = error.message;
    }
    check("neighbours are refused", refused, "The two cells are already next to each other.");

    ui = parse("\\begin{tikzcd}\n\tA \\arrow[\"f\", loop]\n\\end{tikzcd}\n").ui;
    commands = new Commands(ui);
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    refused = "";
    try {
        commands.snake();
    } catch (error) {
        refused = error.message;
    }
    check("and a loop is too", refused, "A loop has no staircase.");

    // A cell the staircase passes through that is already occupied is used rather than displaced.
    ui = parse("\\begin{tikzcd}\n"
        + "\tP \\arrow[drr, \"c\"] & M & \\\\\n\t& & Q\n\\end{tikzcd}\n").ui;
    commands = new Commands(ui);
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    commands.snake("x");
    check("a cell on the way is used as it stands",
        ui.quiver.all_cells().filter((cell) => cell.is_vertex())
            .map((cell) => cell.label || "-").sort().join(" "), "- M P Q");
    check("so the chain runs through it", counts(ui), [4, 3]);
}

{
    // `:snake` through the command line, which is how the manual spells it.
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    const commands = new Commands(ui);
    let refused = "";
    try {
        Commands.TABLE["snake"].run(commands, ["z"]);
    } catch (error) {
        refused = error.message;
    }
    check("an axis that is not one is refused",
        refused, '"z" is not an axis: snake takes x, y, or nothing.');
    check("and x and y are what it offers", Commands.TABLE["snake"].completions, ["x", "y"]);
}

{
    // The reader names no setting: given another schema, the same class reads, parses, checks, and
    // reports for it. This is what lets another kind of diagram keep the file handling and `:set`.
    const schema = {
        defaults: { "a.flag": true, "a.count": 3, "a.name": "x", "a.maybe": 1 },
        ranges: { "a.count": [1, 10], "a.maybe": [0, 5] },
        nullable: new Set(["a.maybe"]),
        checks: {
            "a.name": [(value) => /^[a-z]$/.test(value), "one lower-case letter"],
        },
    };
    for (const [setting, [least, most]] of Object.entries(schema.ranges)) {
        const nullable = schema.nullable.has(setting);
        schema.checks[setting] = [
            (value) => nullable && value === null || value >= least && value <= most,
            `a number from ${least} to ${most}${nullable ? ", or null" : ""}`,
        ];
    }
    const other = new Settings(schema);

    check("another schema's settings are the ones it has",
        other.names(), ["a.flag", "a.count", "a.name", "a.maybe"]);
    check("and nothing else is a setting",
        [other.has("a.flag"), other.has("ui.zoom")], [true, false]);
    check("its defaults are what it starts at",
        [other.get("a.flag"), other.get("a.count"), other.get("a.name")], [true, 3, "x"]);
    check("booleans are spelt the same way", other.parse("a.flag", "off"), false);
    check("its ranges are enforced",
        [other.allows("a.count", 5), other.allows("a.count", 50)], [true, false]);
    check("and said in its own words", other.expected("a.count"), "a number from 1 to 10");
    check("its own checks are asked", [
        other.allows("a.name", "q"), other.allows("a.name", "Q"),
    ], [true, false]);
    check("with its own words", other.expected("a.name"), "one lower-case letter");
    check("null is allowed where it says so",
        [other.allows("a.maybe", null), other.allows("a.count", null)], [true, false]);
    check("the range and nullability are what the layer steps by",
        [other.range("a.count"), other.nullable("a.maybe")], [[1, 10], true]);
    check("a setting it does not have has no range", other.range("ui.zoom"), undefined);

    // And the diagram's own schema is untouched by any of that.
    check("the two do not share a table",
        [new Settings(SETTINGS).get("ui.zoom"), other.get("a.count")], [100, 3]);
    other.set("a.count", 7);
    check("nor their values", new Settings(SETTINGS).get("ui.zoom"), 100);
}

{
    // Reading a settings file: a value the schema allows is taken, and anything else is left at
    // its default and reported, setting by setting, for the mode line.
    //
    // These share the one stub shell, so they run one after another rather than at once.
    const read = async (text) => {
        host.settings_text = text;
        host.written = [];
        const settings = new Settings(SETTINGS);
        await settings.load();
        return settings;
    };

    pending.push((async () => {
        let settings = await read(null);
        check("no file leaves every default", settings.get("ui.zoom"), 100);
        check("and nothing to report", settings.problems, []);

        settings = await read('{"ui.zoom": 150, "ui.dark_mode": true}');
        check("a file's values are taken",
            [settings.get("ui.zoom"), settings.get("ui.dark_mode")], [150, true]);
        check("with nothing to report", settings.problems, []);

        settings = await read(
            '{"ui.zoom": 500, "diagram.arrow_preset": "fancy", "ui.dark_mode": "yes"}');
        check("a value out of range is left at its default", settings.get("ui.zoom"), 100);
        check("as is one that is not in the list", settings.get("diagram.arrow_preset"), "plain");
        check("and one of the wrong kind", settings.get("ui.dark_mode"), false);
        check("each is reported in the schema's own words", settings.problems, [
            "ui.zoom should be a number from 20 to 200",
            "diagram.arrow_preset should be one of plain, equals, inclusion, mono, epi, maps-to,"
                + " dashed, dotted, squiggly",
            "ui.dark_mode should be true or false",
        ]);

        settings = await read("{not json");
        check("a malformed file leaves the defaults", settings.get("ui.zoom"), 100);
        check("says so once", settings.problems,
            ["not valid JSON, so ignored, and left alone until it is fixed"]);
        check("and is not overwritten", settings.writable, false);
        settings.set("ui.zoom", 150);
        await settings.write();
        check("so a change writes nothing", host.written.length, 0);

        settings = await read('{"ui.gone": 1, "ui.zoom": 120}');
        check("a setting the app no longer has is ignored",
            [settings.has("ui.gone"), settings.get("ui.zoom")], [false, 120]);
        check("without being reported", settings.problems, []);
        await settings.write();
        check("and the next write drops it",
            Object.hasOwn(JSON.parse(host.written.at(-1)), "ui.gone"), false);
    })());
}

{
    // The keys loader names nothing of this diagram either: given another table, the same loader
    // reads the same notation, overrides the same way, and reports the same kinds of problem.
    const table = {
        defaults: { "walk": ["C-w"], "run": ["; r", "C-S-r"], "stop": [] },
        contexts: { "walk": Keymap.CONTEXT.Defer },
        known: (name) => Object.hasOwn(table.defaults, name) || name === "jump",
        canonical: (word) => ({ "w": "walk" })[word] ?? word,
    };
    const resolve = (text) => Bindings.resolve(text, table);
    const of = (keys, name) => (keys.get(name) ?? []).map((combination) =>
        Bindings.signature(combination)).join(" ");

    let { keys, problems } = resolve(null);
    check("another table's defaults are what it starts with",
        [of(keys, "walk"), of(keys, "run"), of(keys, "stop")], ["C-w", ";r C-S-r", ""]);
    check("with nothing to report", problems, []);
    check("a name's context comes from the table",
        keys.get("walk")[0].context, Keymap.CONTEXT.Defer);
    check("and a chord with none is always live",
        keys.get("run")[1].context, Keymap.CONTEXT.Always);

    ({ keys, problems } = resolve("run ; k"));
    check("a line replaces all of a name's defaults", of(keys, "run"), ";k");
    check("and nothing is reported", problems, []);

    // A key a line binds is taken from whatever held it by default.
    ({ keys, problems } = resolve("run C-w"));
    check("a key is taken from whatever held it",
        [of(keys, "walk"), of(keys, "run")], ["", "C-w"]);
    check("with nothing to report", problems, []);

    // Two lines claiming the same key is a mistake in the file, not a silent preference for the
    // later one, so the second line is skipped and said.
    ({ keys, problems } = resolve("walk C-w\nrun C-w"));
    check("two lines claiming one key is reported",
        problems, ["line 2: C-w is already bound on line 1"]);
    check("and the skipped line changes nothing",
        [of(keys, "walk"), of(keys, "run")], ["C-w", ";r C-S-r"]);

    ({ keys } = resolve("w ; j"));
    check("the table says what a word is short for", of(keys, "walk"), ";j");

    ({ keys, problems } = resolve("stop"));
    check("a name alone unbinds it", of(keys, "stop"), "");
    ({ keys } = resolve("unbind C-w"));
    check("and unbind frees a key from whatever has it", of(keys, "walk"), "");

    // The problems are the loader's own, in its own words, for names it has never heard of.
    check("a word the table does not know is reported",
        resolve("wiggle C-q").problems, ['line 1: nothing is called "wiggle"']);
    check("a name the table knows but has no defaults for is bound",
        of(resolve("jump C-j").keys, "jump"), "C-j");
    check("a key that would type is refused",
        resolve("walk q").problems,
        ['line 1: "q" would type: use "; q" for the command layer, or a chord']);
    check("a reserved key is refused", resolve("walk RET").problems,
        ['line 1: "RET": RET keeps its own meaning']);
    check("and the same name twice is refused",
        resolve("walk C-q\nwalk C-p").problems, ["line 2: walk is already bound on line 1"]);

    // This diagram's own table is untouched by any of that, and is the default.
    check("the diagram's table is what resolve takes without one",
        Bindings.resolve(null).keys.has("save"), true);
    check("and the other table knows nothing of it", resolve(null).keys.has("save"), false);
}
