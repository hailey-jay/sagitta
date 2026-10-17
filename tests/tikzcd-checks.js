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
    // The braces the export writes round a label that is not a single word are taken off again,
    // or every reading would add another pair.
    check("and the same labels", labels(parsed.ui), labels(ui));
    check("so it writes the same picture",
        parsed.ui.text().replace(/^%.*\n/, ""), bare);
    check("but braces that close before the end are the label's own",
        ["{a}{b}", "{f'}", "{\\}}", "\\{x\\}"].map(Parser.unbrace),
        ["{a}{b}", "f'", "\\}", "\\{x\\}"]);
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
    // empty cells, a dashed arrow routed round the outside, and labels that need the
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

    // The connecting morphism is one arrow round the whole figure, dashed: up from ker c, along
    // above the kernels, down the left, and in to coker a.
    const [delta] = ui.quiver.all_cells().filter((cell) => cell.label === "\\delta");
    check("the connecting morphism runs from ker c to coker a",
        [`${delta.source.position.x}${delta.source.position.y}`,
            `${delta.target.position.x}${delta.target.position.y}`], ["30", "13"]);
    check("and is routed round the figure and dashed",
        [delta.options.route, delta.options.style.body.name],
        [[[3, -1], [-1, -1], [-1, 3]], "dashed"]);

    // Its tikz-cd says so too, which is what LaTeX reads.
    check("the export says as much",
        ui.text().includes('\\arrow["\\delta"\'{pos=0.51}, to path={[rounded corners=6pt] '
            + '-- (\\tikzcdmatrixname-1-5.center) -- (\\tikzcdmatrixname-1-1.center) \\tikztonodes '
            + '-- (\\tikzcdmatrixname-5-1.center) -- (\\tikztotarget) [sharp corners]}, dashed, '
            + 'from=2-5, to=5-3]'),
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
    // An arrow crossing over another: `A` to `D` passes over `B` to `C`. tikz-cd only cuts a gap
    // in the arrows drawn before the crossing one, so it is written last, though it would sort
    // first by its source.
    const crossed = parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[dr, crossing over] & B \\arrow[dl] \\\\\n\tC & D\n\\end{tikzcd}\n");
    check("crossing over reads", crossed.diagnostics.length, 0);
    const crossing = (ui) => ui.quiver.all_cells().filter((cell) => cell.is_edge())
        .map((edge) => `${edge.source.label}${edge.target.label} ${edge.options.crossing_over}`)
        .sort();
    check("as a rank of that arrow alone", crossing(crossed.ui), ["AD 1", "BC 0"]);
    const text = crossed.ui.text();
    check("and is written last", text.indexOf("from=1-2, to=2-1") < text.indexOf("crossing over"),
        true);
    check("as crossing over", text.includes("\\arrow[crossing over, from=1-1, to=2-2]"), true);
    const reloaded = load(text);
    check("its own line is trusted", reloaded.trusted, true);
    check("and keeps it", crossing(reloaded.ui), ["AD 1", "BC 0"]);
    check("so saving writes the same bytes", reloaded.ui.text(), text);
    check("and the picture alone keeps it too",
        crossing(parse(text.replace(/^%.*\n/, "")).ui), ["AD 1", "BC 0"]);

    // An arrow alone at the front is brought to the front by staying there, which is no step to
    // undo, but another arrow brought forward goes above it.
    const front = parse(text.replace(/^%.*\n/, "")).ui;
    front.unqueue_selected = () => {};
    const edge = (name) => front.quiver.all_cells()
        .find((cell) => cell.is_edge() && `${cell.source.label}${cell.target.label}` === name);
    front.select(edge("AD"));
    check("an arrow already alone at the front stays there",
        [front.arrow_options.set_crossing_over(front, true), crossing(front)],
        [false, ["AD 1", "BC 0"]]);
    front.deselect();
    front.select(edge("BC"));
    front.arrow_options.set_crossing_over(front, true);
    check("and another goes above it", crossing(front), ["AD 1", "BC 2"]);

    // The clearance is tikz-cd's to set, and we do not read it.
    const clearance = parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[r, crossing over clearance=2ex] & B\n\\end{tikzcd}\n");
    check("crossing over clearance is a diagnostic",
        [crossing(clearance.ui), clearance.diagnostics.length > 0], [["AB 0"], true]);

    // Only an arrow cuts a gap: an adjunction draws nothing for the gap to follow.
    const [adjoint] = crossed.ui.quiver.all_cells()
        .filter((cell) => cell.is_edge() && cell.options.crossing_over > 0);
    adjoint.options.style = { name: "adjunction" };
    check("an adjunction does not cross over", crossed.ui.text().includes("crossing over"), false);
}

{
    // Several arrows crossing over stack by rank, whatever their positions: the one written later
    // in hand-written tikz-cd is above, and is written later again.
    const stacked = parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[ddrr, crossing over] & B \\arrow[dd] & C \\arrow[ddll, crossing over] \\\\\n"
        + "\t&& \\\\\n\tD & E & F\n\\end{tikzcd}\n");
    const ranks = (ui) => Object.fromEntries(ui.quiver.all_cells().filter((cell) => cell.is_edge())
        .map((edge) => [`${edge.source.label}${edge.target.label}`, edge.options.crossing_over]));
    check("crossing arrows rank in the order they are written", ranks(stacked.ui),
        { AF: 1, BE: 0, CD: 2 });
    const order = (ui) => (ui.text().match(/from=\d-\d, to=\d-\d/g) ?? []).join(" ");
    check("and are written plain first, then by rank", order(stacked.ui),
        "from=1-2, to=3-2 from=1-1, to=3-3 from=1-3, to=3-1");

    // The ranks are written without gaps, so a line does not depend on how they came about.
    const [af] = stacked.ui.quiver.all_cells().filter((cell) => cell.label === ""
        && cell.is_edge() && cell.options.crossing_over === 1);
    af.options.crossing_over = 7;
    const reranked = load(stacked.ui.text());
    check("ranks are written without gaps", ranks(reranked.ui), { AF: 2, BE: 0, CD: 1 });
    check("so the order they stack in survives", order(reranked.ui),
        "from=1-2, to=3-2 from=1-3, to=3-1 from=1-1, to=3-3");

    // A 2-cell on an arrow that crosses over is drawn in its layer, after it, as tikz-cd needs the
    // arrow's name written first.
    const two = parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[r, \"\"{name=0, anchor=center, inner sep=0}, crossing over] "
        + "\\arrow[r, \"\"'{name=1, anchor=center, inner sep=0}, bend right] & B\n"
        + "\t\\arrow[Rightarrow, from=0, to=1]\n\\end{tikzcd}\n");
    check("a 2-cell on a crossing arrow reads", counts(two.ui), [2, 3]);
    const written = two.ui.text();
    check("and is written after it",
        written.indexOf("crossing over") < written.indexOf("Rightarrow"), true);
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

    check("null is no number", settings.allows("ui.zoom", null), false);

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
    check("a preset is set by name",
        [set("diagram.arrow_preset", "mono"), ui.settings.get("diagram.arrow_preset")],
        [null, "mono"]);
    check("and one there is no such thing as is refused",
        set("diagram.arrow_preset", "wiggly").startsWith('"wiggly" is not a value'), true);
    check("every setting is offered for completion",
        Commands.TABLE["set"].completions(commands).length, Object.keys(ui.settings.data).length);
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
    // A route's geometry: straight legs, with each turn rounded into an arc of the radius asked
    // for, or less where the legs are too short for it, as TikZ's `rounded corners` does.
    const round = (point) => [point.x, point.y].map((value) => Math.round(value * 100) / 100);
    const ell = new Route(Point.zero(),
        [new Point(0, 0), new Point(100, 0), new Point(100, 100)], 10, 0);
    check("a route is its legs and the arcs between them",
        Math.round(ell.length * 100) / 100, Math.round((180 + 5 * Math.PI) * 100) / 100);
    check("it starts and ends where its points do", [round(ell.point(0)), round(ell.point(1))],
        [[0, 0], [100, 100]]);
    check("and halfway round the corner is halfway along the arc",
        round(ell.point(0.5)), round(new Point(90, 10).add(Point.lendir(10, -Math.PI / 4))));
    check("where it is heading diagonally", Math.round(ell.tangent(0.5) * 1000) / 1000,
        Math.round(Math.PI / 4 * 1000) / 1000);
    const tight = new Route(Point.zero(),
        [new Point(0, 0), new Point(10, 0), new Point(10, 10)], 100, 0);
    check("a corner on short legs is rounded only as far as half a leg",
        Math.round(tight.segments.find((segment) => segment.centre !== undefined).radius), 5);
    const sharp = new Route(Point.zero(),
        [new Point(0, 0), new Point(100, 0), new Point(100, 100)], 0, 0);
    check("and a radius of nothing leaves it sharp",
        sharp.segments.every((segment) => segment.centre === undefined), true);
    const [hit] = ell.intersections_with_rounded_rectangle(
        new RoundedRectangle(new Point(100, 100), new Point(20, 20), 0), false);
    check("it meets a cell at its edge", round(hit), [100, 90]);
    check("and the point knows how far along it is", Math.round(hit.t * ell.length), 186);
}

{
    // `:route` bends an arrow round one corner, along a row or a column first, and is written as a
    // `to path` through the centre of the cell it turns in.
    const diagonal = () => {
        const ui = parse(
            "\\begin{tikzcd}\n\tA \\arrow[dr, \"f\"] & B \\\\\n\t& C\n\\end{tikzcd}\n").ui;
        ui.unqueue_selected = () => {};
        ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
        return ui;
    };
    const route = (ui) => ui.quiver.all_cells().filter((cell) => cell.is_edge())
        .map((edge) => JSON.stringify(edge.options.route)).join(" ");
    const path = (ui) => (ui.text().match(/to path=\{(.*)\}, from/) ?? [null, null])[1];

    let ui = diagonal();
    let commands = new Commands(ui);
    commands.route("x");
    check("a route along the row first turns under B", route(ui), "[[1,0]]");
    check("and is written through B's centre", path(ui),
        "[rounded corners=6pt] -- (\\tikzcdmatrixname-1-2.center) \\tikztonodes "
        + "-- (\\tikztotarget) [sharp corners]");
    check("with the label on the leg it falls on", ui.text().includes("\"f\"{pos=0.833}"), true);
    commands.route("y");
    check("a route along the column first turns in an empty cell", route(ui), "[[0,1]]");
    check("whose centre is A's column and C's row", path(ui),
        "[rounded corners=6pt] -- (\\tikzcdmatrixname-1-1.center |- "
        + "\\tikzcdmatrixname-2-2.center) -- (\\tikztotarget) \\tikztonodes [sharp corners]");
    check("which needs no empty nodes", ui.text().includes("execute at empty cell"), false);

    // The file keeps the route, and the picture alone gives it back.
    let text = ui.text();
    let reloaded = load(text);
    check("a routed arrow's own line is trusted", reloaded.trusted, true);
    check("and keeps the route", route(reloaded.ui), "[[0,1]]");
    check("so saving writes the same bytes", reloaded.ui.text(), text);
    const pictured = parse(text.replace(/^%.*\n/, ""));
    check("the picture alone reads the route back",
        [route(pictured.ui), pictured.diagnostics.length], ["[[0,1]]", 0]);
    check("with the label where it was", pictured.ui.quiver.all_cells()
        .filter((cell) => cell.is_edge()).map((edge) => edge.options.label_position), [50]);

    // With no argument, `route` steps from straight, to along the row, to along the column, and
    // back to straight, where the curve and offset it had are still waiting.
    ui = diagonal();
    commands = new Commands(ui);
    const steps = [];
    for (let i = 0; i < 3; ++i) {
        Commands.TABLE["route"].run(commands, []);
        steps.push(route(ui));
    }
    check("route steps through both bends and back", steps, ["[[1,0]]", "[[0,1]]", "[]"]);
    ui.history.undo(ui);
    check("each step undoes on its own", route(ui), "[[0,1]]");
    // Asking for the route an arrow already has changes nothing, so leaves nothing to undo.
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    commands.route("y");
    ui.history.undo(ui);
    check("and a route asked for again is no step", route(ui), "[[1,0]]");
    // The same holds for every setter, since the history itself refuses a step that changes
    // nothing: a label alignment the arrow already has is no step either.
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    const steps_before = ui.history.present;
    ui.arrow_options.set_label_alignment(ui, ui.arrow_options.label_alignment(ui));
    check("nor is a label alignment the arrow already has",
        ui.history.present, steps_before);
    check("an action changes something when it has cells to act on, or a value that differs",
        [
            { kind: "create", cells: new Set() },
            { kind: "flip", cells: [{}] },
            { kind: "move", displacements: [{ from: new Position(0, 0), to: new Position(0, 0) }] },
            { kind: "move", displacements: [{ from: new Position(0, 0), to: new Position(1, 0) }] },
            { kind: "style", styles: [{ from: { name: "arrow" }, to: { name: "arrow" } }] },
            { kind: "curve", curves: [{ from: 0, to: 0 }, { from: 0, to: 1 }] },
            { kind: "route", routes: [] },
        ].map(History.changes),
        [false, true, false, true, false, true, false]);

    // An arrow along a row has no corner to turn.
    ui = parse("\\begin{tikzcd}\n\tA \\arrow[r] & B\n\\end{tikzcd}\n").ui;
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    let refused = "";
    try {
        new Commands(ui).route("x");
    } catch (error) {
        refused = error.message;
    }
    check("a straight arrow along a row is refused a bend", refused.startsWith("The arrow is"),
        true);
    refused = "";
    try {
        Commands.TABLE["route"].run(new Commands(ui), ["z"]);
    } catch (error) {
        refused = error.message;
    }
    check("and route takes x, y, or none", refused,
        '"z" is not x, y, or none, which route takes, or nothing.');
}

{
    // `:checkpoint` adds the cell at the focus point to the route, or takes it out again, and a
    // cell no node shares a row or a column with is written out as an empty cell to route through.
    const ui = parse("\\begin{tikzcd}\n\tA \\arrow[dr, \"f\"] & B \\\\\n\t& C\n\\end{tikzcd}\n").ui;
    ui.unqueue_selected = () => {};
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    const [edge] = ui.quiver.all_cells().filter((cell) => cell.is_edge());
    const commands = new Commands(ui);
    ui.focus_position = new Position(1, 0);
    commands.checkpoint();
    ui.focus_position = new Position(2, 0);
    commands.checkpoint();
    check("checkpoints are passed through in the order they are added",
        edge.options.route, [[1, 0], [2, 0]]);
    let text = ui.text();
    check("a cell in an empty column takes empty nodes of no size",
        text.includes(`[${QuiverExport.EMPTY_CELLS}]`), true);
    check("and the row is written out to it", text.includes("\tA & B & \\\\\n"), true);
    check("so the cell has a name", text.includes("-- (\\tikzcdmatrixname-1-3.center)"), true);
    check("and the picture alone reads it back", [parse(text.replace(/^%.*\n/, "")).ui.quiver
        .all_cells().filter((cell) => cell.is_edge()).map((edge) => edge.options.route),
        parse(text.replace(/^%.*\n/, "")).diagnostics.length], [[[[1, 0], [2, 0]]], 0]);
    // The option holds brackets of its own, which must not end the options early, or a
    // separation after it would be lost.
    const separated = load(text.replace(`[${QuiverExport.EMPTY_CELLS}]`,
        `[${QuiverExport.EMPTY_CELLS},column sep=small]`).replace(/^%.*\n/, ""));
    check("and a separation after it is still read", separated.ui.sep.column,
        DiagramFile.SEPS.small);
    check("as is TikZ's own nodes in empty cells", parse(text
        .replace(QuiverExport.EMPTY_CELLS, "nodes in empty cells").replace(/^%.*\n/, ""))
        .diagnostics.length, 0);

    // Above everything, the matrix grows a row, and the cells are counted from there.
    ui.focus_position = new Position(1, -1);
    commands.checkpoint();
    text = ui.text();
    check("a cell above the diagram adds a row", text.includes("\t& \\\\\n\tA & B & \\\\\n"), true);
    check("so the arrow's ends are a row lower", text.includes("from=2-1, to=3-2"), true);
    check("and it reads back where it was", load(text).ui.quiver.all_cells()
        .filter((cell) => cell.is_edge()).map((edge) => edge.options.route),
    [[[1, 0], [2, 0], [1, -1]]]);

    ui.focus_position = new Position(2, 0);
    commands.checkpoint();
    check("a checkpoint already there is taken out", edge.options.route, [[1, 0], [1, -1]]);
    ui.focus_position = new Position(1, 1);
    let refused = "";
    try {
        commands.checkpoint();
    } catch (error) {
        refused = error.message;
    }
    check("an end of the arrow is no checkpoint",
        refused.startsWith("The focus point is on an end"), true);
}

{
    // A route goes where its cells go: it moves with an arrow moved whole, follows a gap opened
    // across it, and is passed through the other way when the arrow is reversed.
    const make = () => {
        const ui = parse("\\begin{tikzcd}\n\tA \\arrow[dr] & B \\\\\n\t& C\n\\end{tikzcd}\n").ui;
        ui.unqueue_selected = () => {};
        const [edge] = ui.quiver.all_cells().filter((cell) => cell.is_edge());
        ui.select(edge);
        new Commands(ui).route("x");
        return [ui, edge];
    };
    let [ui, edge] = make();
    new Commands(ui).insert("x", 1);
    check("a gap opened across a route moves the cells beyond it", edge.options.route, [[2, 0]]);
    ui.history.undo(ui);
    check("and undoing the gap puts them back", edge.options.route, [[1, 0]]);
    new Commands(ui).insert("y", 1);
    check("a gap beyond the route leaves it", edge.options.route, [[1, 0]]);

    [ui, edge] = make();
    const vertices = ui.quiver.all_cells().filter((cell) => cell.is_vertex());
    const whole = vertices.map((vertex) => ({
        vertex, from: vertex.position, to: vertex.position.add(new Position(0, 2)),
    }));
    check("a route moves with an arrow moved whole",
        ui.quiver.moved_routes(whole).map(({ to }) => to), [[[1, 2]]]);
    const part = whole.filter(({ vertex }) => vertex === edge.source);
    check("but not with an arrow stretched", ui.quiver.moved_routes(part).length, 0);

    [ui, edge] = make();
    ui.focus_position = new Position(1, 1);
    edge.options.route = [[1, 0], [2, 0], [2, 1]];
    edge.reverse(ui);
    check("a reversed arrow's route is passed through the other way",
        edge.options.route, [[2, 1], [2, 0], [1, 0]]);

    // A paste lands its routes where it lands its cells.
    [ui, edge] = make();
    const copied = QuiverImportExport.base64
        .export_selection(ui.quiver, new Set(ui.quiver.all_cells()));
    ui.reset();
    QuiverImportExport.base64.import(ui, copied, new Position(3, 4));
    check("a pasted route lands with its cells", ui.quiver.all_cells()
        .filter((cell) => cell.is_edge()).map((edge) => edge.options.route), [[[4, 4]]]);
}

{
    // What a route does to the rest of the arrow's export: the curve and the offset are not
    // written, the corners are sharp without rounding, and a shortened route is shortened by
    // lengths, since quiver's `between` does not follow a `to path`.
    const ui = parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[dr, curve={height=12pt}, shift left=2] & B \\\\\n\t& C\n\\end{tikzcd}\n").ui;
    ui.unqueue_selected = () => {};
    ui.select(...ui.quiver.all_cells().filter((cell) => cell.is_edge()));
    const commands = new Commands(ui);
    commands.route("x");
    check("a route writes neither the curve nor the offset",
        ["curve", "shift"].map((word) => ui.text().includes(word)), [false, false]);
    commands.slide("rounding", [0]);
    check("a route rounded by nothing is written sharp", ui.text().includes("corners"), false);
    commands.slide("length", [20, 80]);
    check("and is shortened by lengths, not between",
        [/shorten <=\d+pt, shorten >=\d+pt/.test(ui.text()), ui.text().includes("between")],
        [true, false]);
    commands.route(null);
    check("straightened, it has its curve and offset again",
        ["curve", "shift"].map((word) => ui.text().includes(word)), [true, true]);

    // A route that is not as the export writes it is left out, and says so.
    const foreign = parse("\\begin{tikzcd}\n"
        + "\tA \\arrow[r, to path={|- (\\tikztotarget)}] & B\n\\end{tikzcd}\n");
    check("a to path we do not write is a diagnostic, and the arrow is kept",
        [foreign.diagnostics.length, counts(foreign.ui)], [1, [2, 1]]);
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

        settings = await read('{"ui.zoom": 120}');
        check("a setting the file does not hold follows the system",
            [settings.follow("ui.dark_mode", true), settings.get("ui.dark_mode")], [true, true]);
        await settings.write();
        check("and is left out of the file",
            Object.hasOwn(JSON.parse(host.written.at(-1)), "ui.dark_mode"), false);
        settings.set("ui.dark_mode", false);
        await settings.write();
        check("until it is set", [settings.follow("ui.dark_mode", true),
            JSON.parse(host.written.at(-1))["ui.dark_mode"]], [false, false]);

        settings = await read('{"ui.dark_mode": false}');
        check("one the file holds keeps the file's",
            [settings.follow("ui.dark_mode", true), settings.get("ui.dark_mode")], [false, false]);
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
    check("a key alone is the command layer's, as with ;",
        [of(resolve("walk q").keys, "walk"), of(resolve("walk ; q").keys, "walk")], [";q", ";q"]);
    check("as is a shifted one", of(resolve("walk Q").keys, "walk"), ";S-q");
    check("and the layer's reserved keys stay reserved alone", resolve("walk 5").problems,
        ['line 1: "5": 5 keeps its own meaning in the command layer']);
    check("a reserved key is refused", resolve("walk RET").problems,
        ['line 1: "RET": RET keeps its own meaning']);
    check("and the same name twice is refused",
        resolve("walk C-q\nwalk C-p").problems, ["line 2: walk is already bound on line 1"]);

    // This diagram's own table is untouched by any of that, and is the default.
    check("the diagram's table is what resolve takes without one",
        Bindings.resolve(null).keys.has("save"), true);
    check("and the other table knows nothing of it", resolve(null).keys.has("save"), false);

    // Space keeps its meaning alone, but its chords are free, and the mark has one.
    const signatures = (text, name) => (Bindings.resolve(text).keys.get(name) ?? [])
        .map((combination) => Bindings.signature(combination));
    check("the mark is C-SPC by default", signatures(null, "mark"), ["C- "]);
    check("and may be rebound", signatures("mark C-q", "mark"), ["C-q"]);
    check("as may the mark that adds", signatures("mark-add C-S-q", "mark-add"), ["C-S-q"]);
    check("but Space alone is still refused", Bindings.resolve("mark SPC").problems,
        ['line 1: "SPC": SPC keeps its own meaning']);

    // A layout may report a chord it gives no character as `Unidentified`; the physical key
    // stands in for it, so the chord still matches its binding.
    const pressed = (key, code, shiftKey = false) => {
        let prevented = false;
        const event = { key, code, shiftKey, ctrlKey: true, preventDefault() {
            prevented = this === event;
        } };
        const identified = Keymap.identify(event);
        identified.preventDefault();
        return [identified.key, identified.ctrlKey, prevented];
    };
    check("an unidentified Space is Space", pressed("Unidentified", "Space"), [" ", true, true]);
    check("an unidentified letter is its letter", pressed("Unidentified", "KeyQ"),
        ["q", true, true]);
    check("and its capital with Shift", pressed("Unidentified", "KeyQ", true), ["Q", true, true]);
    check("a shifted digit is left unidentified", pressed("Unidentified", "Digit2", true)[0],
        "Unidentified");
    check("and an identified key is left alone", pressed("x", "KeyQ"), ["x", true, true]);
}

// A route's corners are rounded no more than tikz-cd's shortest legs allow, at normal separations
// (18pt): a corner overshooting a short leg turns the arrowhead back along the curve.
{
    const sep = { column: 1.8, row: 1.8 };
    const points = (...cells) => cells.map(([x, y]) => new Position(x, y));
    check("a route round one cell keeps its radius to a leg less its arrowhead",
        QuiverExport.route_radius(points([0, 0], [0, 1], [1, 1], [1, 0]), sep, 16), 9);
    check("a smaller radius is kept as it is",
        QuiverExport.route_radius(points([0, 0], [0, 1], [1, 1], [1, 0]), sep, 6), 6);
    check("long legs leave a radius as it is",
        QuiverExport.route_radius(points([0, 0], [0, 3], [3, 3], [3, 0]), sep, 16), 16);
}
