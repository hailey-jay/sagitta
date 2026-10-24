/// The checks `tests/tikzcd.js` runs, in the context it builds: the sources are already loaded,
/// and `check`, `example`, and `make_ui` are in scope.

/// A diagram loaded from the contents of its file, as opening it does (see `DiagramFile.read`):
/// parsed, unless it has an encoded line, as older files do, that still reproduces its picture.
function load(text) {
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    DiagramFile.restore_sep(ui, text);
    return { ui, ...DiagramFile.read(ui, text) };
}

/// A file as Sagitta wrote it before 0.6.0: the encoded line, then the picture.
const legacy = (text) => {
    const { ui } = load(text);
    return `%#q=${QuiverImportExport.base64.export(
        ui.quiver, ui.settings, ui.options(), ui.definitions()).data}\n${text}`;
};

/// A diagram parsed from tikz-cd alone, with no encoded line, under `settings` if given, and with
/// the separations the code's options give, as opening a file reads them.
function parse(code, settings = null) {
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    if (settings !== null) {
        ui.settings = settings;
    }
    DiagramFile.restore_sep(ui, code);
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
    // The round trip a paper depends on: the example is read from its picture, and saving it
    // writes the file back byte for byte.
    const text = example("pullback.cd.tex");
    const { ui, legacy: encoded, diagnostics } = load(text);
    check("the example holds no encoded line", encoded, false);
    check("it has no diagnostics", diagnostics.length, 0);
    check("it reads as a square with five arrows", counts(ui), [4, 5]);
    check("and saving it writes the same bytes", ui.text(), text);
    check("with no encoded line", ui.text().includes("#q="), false);
    // The braces the export writes round a label that is not a single word are taken off again,
    // or every reading would add another pair.
    check("the labels come back as typed", labels(ui),
        ["X \\times_Z Y", "Y", "X", "Z", "\\pr_2", "\\pr_1", "", "g", "f"]);
    check("but braces that close before the end are the label's own",
        ["{a}{b}", "{f'}", "{\\}}", "\\{x\\}"].map(Parser.unbrace),
        ["{a}{b}", "f'", "\\}", "\\{x\\}"]);
    check("the corner survives the parse",
        ui.quiver.all_cells().filter((cell) => cell.is_edge())
            .map((edge) => edge.options.style.name).sort(),
        ["arrow", "arrow", "arrow", "arrow", "corner"]);

    // An older file begins with the diagram's encoding, which is trusted while it still
    // reproduces the picture, and saving leaves it out.
    const old = legacy(text);
    const reopened = load(old);
    check("an older file's encoded line is trusted", reopened.trusted, true);
    check("and saving it leaves the line out", reopened.ui.text(), text);

    // A hand edit to the picture beats the encoded line: the line still parses, but it no longer
    // reproduces the environment, so the tikz-cd is what is read.
    const hand = load(old.replace('"g"', '"g\'"'));
    check("a hand edit is not trusted", hand.trusted, false);
    check("and the edited label is the one read", labels(hand.ui).includes("g'"), true);

    // A line that decodes to a different diagram is also distrusted, rather than believed over
    // the picture.
    const swapped = old.replace(/^%#q=\S+$/m, `%#q=${
        QuiverImportExport.base64.export(parse("\\begin{tikzcd}\n\tA \\\\\n\tB\n\\end{tikzcd}\n")
            .ui.quiver, new Settings(SETTINGS), {}).data}`);
    check("a line for another diagram is distrusted", load(swapped).trusted, false);
    check("so the picture is what is read", counts(load(swapped).ui), [4, 5]);
}

{
    // The snake lemma example, which the paper `\input`s beside the pullback: a wider figure, with
    // empty cells, a dashed arrow routed round the outside, and labels that need the
    // `\coker` of `examples/macros.tex`.
    const text = example("snake-lemma.cd.tex");
    const { ui, diagnostics } = load(text);
    check("with no diagnostics", diagnostics.length, 0);
    check("as four rows of terms and the arrows between them", counts(ui), [17, 23]);
    check("and saving it writes the same bytes", ui.text(), text);

    // The empty cells of the figure are empty cells, not absent ones: the first row has no fifth
    // term, and the first and last rows have no first term. The file starts with the empty row and
    // column the route runs through, so the terms are a row and a column in from the corner.
    check("the corners of the figure are left out",
        ui.quiver.all_cells().filter((cell) => cell.is_vertex())
            .map((cell) => `${cell.position.x}${cell.position.y}`).sort().join(" "),
        "12 13 21 22 23 24 31 32 33 34 41 42 43 44 52 53 54");

    // The connecting morphism is one arrow round the whole figure, dashed: up from ker c, along
    // above the kernels, down the left, and in to coker a.
    const [delta] = ui.quiver.all_cells().filter((cell) => cell.label === "\\delta");
    check("the connecting morphism runs from ker c to coker a",
        [`${delta.source.position.x}${delta.source.position.y}`,
            `${delta.target.position.x}${delta.target.position.y}`], ["41", "24"]);
    check("and is routed round the figure and dashed",
        [delta.options.route, delta.options.style.body.name],
        [[[4, 0], [0, 0], [0, 4]], "dashed"]);

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
    const encoded = legacy(example("pullback.cd.tex")).match(/^%#q=(\S+)$/m)[1];
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

    // A curve is kept in pt, as written, rather than rounded to quiver's units of 6pt, and links
    // still give it in those units.
    const height = "\\begin{tikzcd}\n\tA \\arrow[r, curve={height=-7.5pt}] & B\n\\end{tikzcd}\n";
    const tall = parse(height);
    const [arc] = tall.ui.quiver.all_cells().filter((cell) => cell.is_edge());
    check("a curve reads in pt", arc.options.curve, -7.5);
    check("and is written as it was read", tall.ui.quiver.export("tikz-cd", tall.ui.settings,
        tall.ui.options(), tall.ui.definitions()).data.includes("curve={height=-7.5pt}"), true);
    check("a curve far past quiver's reads", parse(height.replace("-7.5", "100")).ui.quiver
        .all_cells().filter((cell) => cell.is_edge())[0].options.curve, 100);
    const link = QuiverImportExport.base64.export(
        tall.ui.quiver, tall.ui.settings, tall.ui.options(), tall.ui.definitions()).data;
    const decoded = JSON.parse(atob(link));
    check("a link gives the curve in quiver's units", decoded[decoded.length - 1][4].curve, -1.25);
    const relinked = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History,
        ArrowOptions });
    QuiverImportExport.base64.import(relinked, link);
    check("and reads back in pt", relinked.quiver.all_cells().filter((cell) => cell.is_edge())[0]
        .options.curve, -7.5);
    check("an arrow key bends by 6pt", ArrowOptions.PROPERTIES.curve.step, 6);

    // The other lengths are kept as the source gives them too: an offset in tikz-cd's shifts, a
    // loop's distance in mm, its angle to the degree, and shortening in pt.
    const edge_of = (code) => parse(code).ui.quiver.all_cells().find((cell) => cell.is_edge());
    const written = (code) => {
        const { ui } = parse(code);
        return ui.quiver.export("tikz-cd", ui.settings, ui.options(), ui.definitions()).data;
    };
    const shifted = "\\begin{tikzcd}\n\tA \\arrow[r, shift left=1.5] & B\n\\end{tikzcd}\n";
    check("a fractional offset reads", edge_of(shifted).options.offset, -1.5);
    check("and is written as read", written(shifted).includes("shift left=1.5"), true);
    const looped = (distance) => "\\begin{tikzcd}\n\tA \\arrow[loop, in=55, out=125, "
        + `distance=${distance}] \\end{tikzcd}\n`;
    check("a loop's distance reads in mm", edge_of(looped("12mm")).options.radius, 12);
    check("whatever its unit", edge_of(looped("1cm")).options.radius, 10);
    check("and is written in mm", written(looped("12mm")).includes("distance=12mm"), true);
    const turned = "\\begin{tikzcd}\n\tA \\arrow[loop, in=40, out=100, distance=5mm]"
        + " \\end{tikzcd}\n";
    check("a loop's angle reads to the degree", edge_of(turned).options.angle, 20);
    check("stepping a loop past 0 turns it round",
        [ArrowOptions.stepped("radius", 5, -1), ArrowOptions.stepped("radius", 2, -1),
            ArrowOptions.stepped("radius", 10, -1)], [-5, -2, 5]);
    check("a loop of 0mm is refused", ArrowOptions.clamp("radius", [0]), 5);
    const loop_link = (units) => {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History,
            ArrowOptions });
        QuiverImportExport.base64.import(ui, btoa(JSON.stringify(
            [0, 1, [0, 0, "A"], [0, 0, "", 0, { radius: units, angle: 0 }]])));
        return ui.quiver.all_cells().find((cell) => cell.is_edge()).options.radius;
    };
    check("quiver's loop units read as mm", [1, 3, 5, -3].map(loop_link), [5, 10, 15, -10]);
    check("and go back to them",
        [5, 10, 15, -10].map((mm) => QuiverExport.loop_units(mm)), [1, 3, 5, -3]);
    const short = "\\begin{tikzcd}\n\tA \\arrow[r, shorten <=2.5pt] & B\n\\end{tikzcd}\n";
    check("a fractional shortening reads", parse(short).diagnostics.length, 0);
    const corner = String.raw`\begin{tikzcd}
	A & B \\
	& C
	\arrow[to path={[rounded corners=5pt] -- (\tikzcdmatrixname-1-2.center) -- (\tikztotarget) [sharp corners]}, from=1-1, to=2-2]
\end{tikzcd}
`;
    check("a route's rounding reads in pt", edge_of(corner).options.rounding, 5);
    check("an arrow key rounds by 2pt", ArrowOptions.PROPERTIES.rounding.step, 2);

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
    check("and reading it back keeps it", crossing(reloaded.ui), ["AD 1", "BC 0"]);
    check("so saving writes the same bytes", reloaded.ui.text(), text);

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
        .map((edge) => [`${edge.source.label}${edge.target.label}`, edge.options.crossing_over])
        .sort(([a], [b]) => a < b ? -1 : 1));
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
        legacy(example("pullback.cd.tex")).match(/^%#q=(\S+)$/m)[1]);
    const text = () => ui.text();

    check("the export holds no encoded line", text().includes("#q="), false);
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
    const pictured = load(text);
    check("reading it back keeps the route",
        [route(pictured.ui), pictured.diagnostics.length], ["[[0,1]]", 0]);
    check("so saving writes the same bytes", pictured.ui.text(), text);
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
    // The file has no cells above its top row, so the diagram reads back a row lower, with the
    // route where it was among its cells.
    check("and it reads back where it was", load(text).ui.quiver.all_cells()
        .filter((cell) => cell.is_edge()).map((edge) => edge.options.route),
    [[[1, 1], [2, 1], [1, 0]]]);

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
            ["not valid JSON, so ignored until fixed"]);
        check("and is not overwritten", settings.writable, false);
        settings.set("ui.zoom", 150);
        await settings.write();
        check("so a change writes nothing", host.written.length, 0);

        settings = await read('{"ui.cell_size": 1, "ui.zoom": 120}');
        check("a setting the app no longer has is ignored",
            [settings.has("ui.cell_size"), settings.get("ui.zoom")], [false, 120]);
        check("without being reported", settings.problems, []);
        await settings.write();
        check("and the next write drops it",
            Object.hasOwn(JSON.parse(host.written.at(-1)), "ui.cell_size"), false);

        settings = await read('{"ui.zoon": 120}');
        check("a name that is not a setting is ignored",
            [settings.has("ui.zoon"), settings.get("ui.zoom")], [false, 100]);
        check("and reported", settings.problems, ["unknown setting ui.zoon"]);
        await settings.write();
        check("but the next write keeps it", JSON.parse(host.written.at(-1))["ui.zoon"], 120);

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
        resolve("wiggle C-q").problems, ['line 1: no command "wiggle"']);
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

// The round trip without the encoded line: a diagram written out, read back from its tikz-cd
// alone, and written out again, gives the same text. Saved files carry no encoding, so this is
// what keeps a diagram the same across saves. The diagrams are generated from a fixed seed, over
// every option the export writes.
{
    let seed = Number(process.env.ROUNDTRIP_SEED ?? 20261017);
    const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const pick = (values) => values[Math.floor(random() * values.length)];
    const between = (min, max, step = 1) => min + step * Math.floor(random() * ((max - min) / step + 1));
    const labels = ["A", "B'", "\\bullet", "X \\times Y", "f^{-1}(U)", "\\mathbb{Z}", "[a]",
        "a \\\\ b", "{a}{b}", ""];
    const colour = () => pick([undefined, [0, 0, 0, 1], [240, 60, 60, 1], [0, 60, 60, 1],
        [between(0, 360), between(0, 100), between(0, 100), 1]]);

    const diagram = () => {
        const vertices = [];
        const taken = new Set();
        const count = between(2, 5);
        while (vertices.length < count) {
            const [x, y] = [between(0, 3), between(0, 3)];
            if (taken.has(`${x},${y}`)) {
                continue;
            }
            taken.add(`${x},${y}`);
            const vertex = [x, y, pick(labels.filter((label) => label !== ""))];
            const c = colour();
            if (c !== undefined) {
                vertex.push(c);
            }
            vertices.push(vertex);
        }
        const edges = [];
        const cells = () => vertices.length + edges.length;
        for (let i = between(1, 5); i > 0; --i) {
            const source = between(0, cells() - 1);
            let target = between(0, cells() - 1);
            const loop = source === target && source < vertices.length;
            if (source === target && !loop) {
                continue;
            }
            const options = {};
            const style = {};
            const kind = loop ? "arrow" : pick(["arrow", "arrow", "arrow", "adjunction", "corner",
                "corner-inverse"]);
            if (kind !== "arrow") {
                style.name = kind;
            } else {
                style.tail = pick(ArrowOptions.STYLES.tail)[2];
                style.body = pick(ArrowOptions.STYLES.body)[2];
                style.head = pick(ArrowOptions.STYLES.head)[2];
                options.level = between(1, 4);
                if (loop) {
                    options.radius = pick([-5, -3, -1, 1, 3, 5]);
                    options.angle = between(-180, 180, 45);
                } else if (random() < 0.5) {
                    options.curve = between(-5, 5);
                }
                const source_shorten = between(0, 50, 10);
                options.shorten = { source: source_shorten,
                    target: between(0, 100 - source_shorten - 10, 10) };
            }
            const vertex_ends = source < vertices.length && target < vertices.length;
            if (!loop && kind === "arrow" && vertex_ends && random() < 0.25) {
                options.route = [[between(0, 4), between(0, 4)]];
                if (random() < 0.5) {
                    options.route.push([between(0, 4), between(0, 4)]);
                }
                options.rounding = between(0, 8);
                delete options.curve;
            } else if (!loop && random() < 0.4) {
                options.offset = between(-5, 5);
            }
            if (!vertex_ends && random() < 0.5) {
                options.edge_alignment = { source: random() < 0.5, target: random() < 0.5 };
            }
            options.label_position = random() < 0.5 ? between(0, 100, 10) : between(0, 100);
            const c = colour();
            if (c !== undefined && kind === "arrow") {
                options.colour = c;
            }
            if (random() < 0.2 && kind === "arrow") {
                options.crossing_over = 1;
            }
            options.style = style;
            const label = pick(labels);
            const alignment = between(0, 3);
            const edge = [source, target, label, alignment, options];
            const lc = colour();
            if (lc !== undefined && label !== "") {
                edge.push(lc);
            }
            edges.push(edge);
        }
        return [0, vertices.length, ...vertices, ...edges];
    };

    const encode = (input) => btoa(String.fromCharCode(
        ...new TextEncoder().encode(JSON.stringify(input))));
    const strip = (text) => text.replace(/^%#q=.*\n/, "");
    // Reading tikz-cd shortens its arrows once the grid is laid out, a moment after the parse
    // (see `Parser.parse_diagram`), so each diagram is written out again after that.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const ROUNDS = Number(process.env.ROUNDTRIP_ROUNDS ?? 400);
    pending.push((async () => {
        const failed = [];
        for (let round = 0; round < ROUNDS; ++round) {
            const input = diagram();
            const ui = make_ui(
                { DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
            ui.settings.set("export.ampersand_replacement", random() < 0.2);
            ui.settings.set("export.cramped", random() < 0.2);
            ui.settings.set("export.centre_diagram", random() < 0.8);
            ui.sep = { column: pick([0.9, 1.8, 2.7, 3.15]), row: pick([0.9, 1.8, 2.7]) };
            try {
                QuiverImportExport.base64.import(ui, encode(input));
            } catch (_) {
                continue;
            }
            const first = strip(ui.text());
            let reread;
            try {
                reread = parse(first, ui.settings);
            } catch (error) {
                failed.push([JSON.stringify(input), first, `${error.stack}`, []]);
                continue;
            }
            await tick();
            const again = strip(reread.ui.text());
            if (again !== first) {
                failed.push([JSON.stringify(input), first, again, reread.diagnostics]);
            }
        }
        // The first few lines that differ, to start a diagnosis from.
        for (const [input, first, again, diagnostics] of
            failed.slice(0, process.env.ROUNDTRIP_SHOW ?? 1)
        ) {
            const a = first.split("\n");
            const b = again.split("\n");
            const line = a.findIndex((text, i) => text !== b[i]);
            if (process.env.ROUNDTRIP_DUMP !== undefined
                && (process.env.ROUNDTRIP_DUMP === "all" || diagnostics.some((d) => `${d.message?.text ?? d.message}`
                    .includes(process.env.ROUNDTRIP_DUMP)))) {
                console.log(`${first}\n-----\n${again}`);
            }
            console.log(`${input}\n  wrote  ${a[line]}\n  reread ${b[line]}\n  ${
                diagnostics.map((diagnostic) => diagnostic.message?.text ?? diagnostic.message)
                    .join("; ")}`);
        }
        check(`${ROUNDS} generated diagrams write the same tikz-cd after reading it back`,
            failed.length, 0);
    })());
}

// amscd: a diagram in a `CD` environment is written and read as amscd writes it, and what amscd
// cannot draw is listed, so that switching to it can say what would be lost.
{
    const amscd = (code) => {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
        const { diagnostics } = DiagramFile.read(ui, code);
        return { ui, diagnostics };
    };
    const five = amscd(example("five-lemma.cd.tex"));
    check("the five lemma example is amscd", [five.ui.format, counts(five.ui),
        five.diagnostics.length], ["amscd", [10, 13], 0]);
    check("and saving it writes the same bytes", five.ui.text(), example("five-lemma.cd.tex"));

    const square = "\\[\\begin{CD}\n\tA @>f>> B \\\\\n\t@VgVV @VVhV \\\\\n\tC @>>k> D\n\\end{CD}\\]\n";
    const { ui, diagnostics } = amscd(square);
    check("a CD environment is amscd", ui.format, "amscd");
    check("a square reads", [counts(ui), diagnostics.length], [[4, 4], 0]);
    const sides = ui.quiver.all_cells().filter((cell) => cell.is_edge())
        .map((edge) => `${edge.label} ${edge.options.label_alignment}`).sort();
    // f above a rightward arrow is on its left; k below one, on its right; g left of a downward
    // arrow is on its right, and h right of it, on its left.
    check("with each label on its side", sides, ["f left", "g right", "h left", "k right"]);
    check("and writing it gives the same text", ui.text(), square);

    const others = amscd("\\begin{CD}\n\tA @<<< B @= C \\\\\n\t@AaAA @. @|\n\\\\ X @)u)) Y @. Z\n"
        + "\\end{CD}\n");
    check("leftward, upward, equals, and empty arrows read",
        [counts(others.ui), others.diagnostics.length], [[6, 5], 0]);
    const edge = (ui, from) => ui.quiver.all_cells().find((cell) => cell.is_edge()
        && cell.source.label === from);
    check("an arrow going left goes from the right", edge(others.ui, "B").target.label, "A");
    check("one going up goes from below", edge(others.ui, "X").target.label, "A");
    check("an equals has no head", [edge(others.ui, "B").options.level,
        others.ui.quiver.all_cells().filter((cell) => cell.is_edge() && cell.options.level === 2)
            .map((edge) => edge.options.style.head.name)], [1, ["none", "none"]]);
    check("and is written as amscd writes it", others.ui.text(),
        "\\[\\begin{CD}\n\tA @<<< B @= C \\\\\n\t@AaAA @. @| \\\\\n\tX @>u>> Y @. Z\n\\end{CD}\\]\n");

    // Empty cells, braced labels, and a label holding its arrow's delimiter.
    const sparse = amscd("\\begin{CD}\n\t@>{x>y}>> {B'} \\\\\n\t@. @V{V_1}VV \\\\\n\t@. C\n"
        + "\\end{CD}\n");
    check("an arrow from an empty cell keeps it", counts(sparse.ui)[0] >= 3, true);
    check("braced labels are read as typed",
        labels(sparse.ui).filter((label) => label !== "").sort(), ["B'", "C", "V_1", "x>y"]);
    const coloured = amscd("\\begin{CD}\n\t\\textcolor{blue}{{X \\times Y}} @>>> B\n\\end{CD}\n");
    check("a coloured object is read as typed", [labels(coloured.ui)[0],
        coloured.ui.quiver.all_cells()[0].label_colour.hsla()], ["X \\times Y", [240, 100, 50, 1]]);
    const written = sparse.ui.text();
    check("and written braced", [written.includes("@>{x>y}>>"), written.includes("@V{V_1}VV")],
        [true, true]);

    // What amscd cannot draw, from a tikz-cd diagram.
    const tikz = parse("\\begin{tikzcd}\n\tA \\arrow[r, \"f\", bend left] \\arrow[dr] & B "
        + "\\arrow[d, dashed] \\\\\n\t& C \\arrow[loop, in=60, out=120, distance=5mm]\n"
        + "\\end{tikzcd}\n");
    check("its problems are listed", Formats.problems("amscd", tikz.ui.quiver)
        .map(([description, cells]) => `${description} ${cells.length}`).sort(),
    ["arrows that are not between neighbours 1", "curves 1", "loops 1",
        "styles other than plain and equals 1"]);
    check("and tikz-cd has none", Formats.problems("tikz-cd", tikz.ui.quiver), []);

    // Converting resets what amscd cannot draw of the arrows it keeps, once the arrow has been
    // shortened as reading it does, a moment after the parse.
    const kept = parse("\\begin{tikzcd}\n\tA \\arrow[r, \"f\"{pos=0.3, description}, "
        + "shift left=2, between={0.2}{0.7}, crossing over, "
        + "draw={rgb,255:red,214;green,92;blue,92}] & B\n\\end{tikzcd}\n");
    pending.push(new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
        const before = Formats.problems("amscd", kept.ui.quiver)
            .map(([description]) => description);
        kept.ui.history.add(kept.ui, AmsCD.convert(kept.ui));
        const [arrow] = kept.ui.quiver.all_cells().filter((cell) => cell.is_edge());
        const options = () => [arrow.options.offset, arrow.options.shorten,
            arrow.options.label_position, arrow.options.label_alignment,
            arrow.options.crossing_over, arrow.options.colour.is_not_black(), arrow.label];
        check("converting resets an arrow amscd can draw",
            [before.sort(), Formats.problems("amscd", kept.ui.quiver), options()],
            [["arrow colours", "crossing over", "label positions", "labels centred on the arrow",
                "offsets", "shortening"], [], [0, { source: 0, target: 0 }, 50, "left", 0, false,
                "f"]]);
        kept.ui.history.undo(kept.ui);
        check("and undoing it gives it all back", options(),
            [-2, { source: 20, target: 30 }, 30, "centre", 1, true, "f"]);
    }));

    // Converting drops what amscd cannot draw and draws the rest plainly, as one undoable step.
    tikz.ui.unqueue_selected = () => {};
    const since = tikz.ui.history.present;
    const actions = AmsCD.convert(tikz.ui);
    tikz.ui.history.add(tikz.ui, actions);
    check("converting leaves what amscd can draw", [counts(tikz.ui),
        Formats.problems("amscd", tikz.ui.quiver)], [[3, 1], []]);
    tikz.ui.history.undo(tikz.ui);
    check("and undoing it brings back the rest", counts(tikz.ui), [3, 4]);
    check("as they were", Formats.problems("amscd", tikz.ui.quiver).length, 4);
    check("in one step", tikz.ui.history.present, since);
}

// amscd's round trip, over generated grids of objects with arrows between neighbours.
{
    let seed = 4242;
    const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const pick = (values) => values[Math.floor(random() * values.length)];
    const names = ["A", "B'", "X \\times Y", "\\mathbb{Z}", "0", "{a}{b}", "V", "x>y"];
    const failed = [];
    for (let round = 0; round < 300; ++round) {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
        ui.format = "amscd";
        const [w, h] = [1 + Math.floor(random() * 4), 1 + Math.floor(random() * 3)];
        const grid = new Map();
        for (let y = 0; y < h; ++y) {
            for (let x = 0; x < w; ++x) {
                if (random() < 0.8 || (x === 0 && y === 0)) {
                    grid.set(`${x},${y}`, new Vertex(ui, pick(names), new Position(x, y),
                        random() < 0.2 ? new Colour(240, 60, 60) : Colour.black()));
                }
            }
        }
        for (const [key, vertex] of grid) {
            const [x, y] = key.split(",").map(Number);
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
                const other = grid.get(`${x + dx},${y + dy}`);
                if (other === undefined || random() < 0.4) {
                    continue;
                }
                const equals = random() < 0.2;
                const [source, target] = random() < 0.5 ? [vertex, other] : [other, vertex];
                new Edge(ui, equals ? "" : pick(["", "f", "g'", "\\alpha", "{u}{v}", "V", "x>y"]),
                    source, target, Edge.default_options({
                        level: equals ? 2 : 1,
                        label_alignment: pick(["left", "right"]),
                    }, equals ? { head: { name: "none" } } : null));
            }
        }
        const first = ui.text();
        const { ui: reread } = (() => {
            const again = make_ui(
                { DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
            DiagramFile.read(again, first);
            return { ui: again };
        })();
        if (reread.text() !== first) {
            failed.push([first, reread.text()]);
        }
    }
    if (failed.length > 0) {
        console.log(`${failed[0][0]}\n-----\n${failed[0][1]}`);
    }
    check("300 generated amscd diagrams write the same text after reading it back",
        failed.length, 0);
}

// Inline maths: a row of objects and arrows, as a formula for the clipboard.
{
    const inline = (code, display = false) => {
        const { ui } = parse(code);
        return InlineMaths.export(ui.quiver, display);
    };
    const ses = inline("\\begin{tikzcd}\n\t0 \\arrow[r] & A \\arrow[r, \"f\", hook] "
        + "& B \\arrow[r, two heads] & C \\arrow[r] & 0\n\\end{tikzcd}\n");
    check("a short exact sequence is a formula", ses.text,
        "0 \\to A \\xhookrightarrow{f} B \\twoheadrightarrow C \\to 0");
    check("which needs mathtools and amssymb", ses.needs.sort(), ["amssymb", "mathtools"]);
    check("and shows in display", inline("\\begin{tikzcd}\n\tA \\arrow[r, \"f\"'] & B\n"
        + "\\end{tikzcd}\n", true).text, "\\[A \\xrightarrow[f]{} B\\]");
    check("an arrow going left is a left arrow", inline("\\begin{tikzcd}\n\tA & B "
        + "\\arrow[l, \"u\"]\n\\end{tikzcd}\n").text, "A \\xleftarrow[u]{} B");
    check("a square is not a formula", inline(example("pullback.cd.tex")),
        "a formula is one row: the objects are on several");
    check("nor a row with a gap", inline("\\begin{tikzcd}\n\tA && B\n\\end{tikzcd}\n"),
        "a formula has no gaps: the objects are not side by side");
    const labelled = inline("\\begin{tikzcd}\n\tA \\arrow[r, \"p\", two heads] & B "
        + "\\arrow[r, \"e\"', equals] & C\n\\end{tikzcd}\n");
    check("a labelled epi and equals stretch, from extpfeil", labelled.text,
        "A \\xtwoheadrightarrow{p} B \\xlongequal[e]{} C");
    check("which needs extpfeil alone", labelled.needs, ["extpfeil"]);
    check("as does an epi going left", inline("\\begin{tikzcd}\n\tA & B "
        + "\\arrow[l, \"q\"', two heads]\n\\end{tikzcd}\n").text, "A \\xtwoheadleftarrow{q} B");
    check("but a labelled tailed arrow is not a formula", inline("\\begin{tikzcd}\n\tA "
        + "\\arrow[r, \"m\", tail] & B\n\\end{tikzcd}\n")
        .startsWith("amsmath, mathtools, and extpfeil stretch no tailed arrow"), true);
}

// The command line: quotes hold spaces and semicolons.
{
    check("commands split at semicolons, words at spaces",
        Commands.split("cc 3 dir=d; select-all"), [["cc", "3", "dir=d"], ["select-all"]]);
    check("quotes hold both, and are dropped",
        Commands.split("cc obj=\"H_#(A; B)\",C"), [["cc", "obj=H_#(A; B),C"]]);
    check("and a quote within them is escaped", Commands.split("x \"a \\\"b\\\" c\""),
        [["x", "a \"b\" c"]]);
    let open = "";
    try {
        Commands.split("cc obj=\"C_#");
    } catch (error) {
        open = error.message;
    }
    check("a quote left open is refused", open.startsWith("A quote is left open"), true);
}

// Label templates.
{
    const fill = (template, offset, base = null, more = []) => Template.expand(template,
        new Map([["#", { base, offset }], ...more]));
    check("# is the index", fill("C_#", 2), "C_2");
    check("arithmetic on it", fill("C_#{#-1}", 2), "C_1");
    check("a negative index is braced", fill("C_#", -1), "C_{-1}");
    check("as is a symbolic one with an offset", fill("C_#", 1, "n"), "C_{n+1}");
    check("but not the symbol alone", fill("C^#", 0, "n"), "C^n");
    check("nor one already in braces", fill("\\partial_{#}", -2, "n"), "\\partial_{n-2}");
    check("arithmetic on a symbol", fill("H^#{2*#+1}", 0, "k"), "H^{2k+1}");
    check("#p and #q are the bidegree where there is one",
        fill("E_2^{#p,#q}", 0, null, [["#p", { offset: 2 }], ["#q", { offset: 1 }]]), "E_2^{2,1}");
    check("and arithmetic on them", fill("E^{#{#p+2},#{#q-1}}", 0, null,
        [["#p", { offset: 0 }], ["#q", { offset: 3 }]]), "E^{2,2}");
    check("#p is # and p where there is no bidegree", fill("C_#p", 3), "C_3p");
    check("a list splits at commas outside brackets", Template.list("A,\\hom(X,Y),{B,C}"),
        ["A", "\\hom(X,Y)", "{B,C}"]);
}

// Presets: what each stamps, at the focus point.
{
    const stamp = (line, setup = null) => {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
        ui.focus_position = Position.zero();
        setup?.(ui);
        const [[name, ...words]] = Commands.split(line);
        Commands.TABLE[Commands.canonical(name)].run(new Commands(ui), words);
        return ui;
    };
    const body = (ui) => ui.text().replace(/^\\\[\\begin\{tikzcd\}\n|\\end\{tikzcd\}\\\]\n$/g, "");
    check("a chain complex runs down its indices, unbounded", body(stamp("cc 3")),
        "\t\\cdots & {C_2} & {C_1} & {C_0} & \\cdots\n"
        + "\t\\arrow[from=1-1, to=1-2]\n"
        + "\t\\arrow[\"{\\partial_2}\", from=1-2, to=1-3]\n"
        + "\t\\arrow[\"{\\partial_1}\", from=1-3, to=1-4]\n"
        + "\t\\arrow[from=1-4, to=1-5]\n");
    check("a cochain complex runs up them, bounded below", body(stamp(
        "chain-complex 3 type=cochain bounded=start dir=d")),
        "\t0 \\\\\n\t{C^0} \\\\\n\t{C^1} \\\\\n\t{C^2} \\\\\n\t\\vdots\n"
        + "\t\\arrow[from=1-1, to=2-1]\n"
        + "\t\\arrow[\"{d^0}\", from=2-1, to=3-1]\n"
        + "\t\\arrow[\"{d^1}\", from=3-1, to=4-1]\n"
        + "\t\\arrow[from=4-1, to=5-1]\n");
    check("a symbol centres the indices on it", body(stamp("cc 3 at=n bounded=both d=none")),
        "\t0 & {C_{n+1}} & {C_n} & {C_{n-1}} & 0\n"
        + "\t\\arrow[from=1-1, to=1-2]\n\t\\arrow[from=1-2, to=1-3]\n"
        + "\t\\arrow[from=1-3, to=1-4]\n\t\\arrow[from=1-4, to=1-5]\n");
    const labels = (ui) => ui.quiver.all_cells().filter((cell) => cell.is_vertex())
        .sort((a, b) => a.position.x - b.position.x).map((cell) => cell.label);
    check("at= takes a symbol with a number, or a multiple of one", [
        labels(stamp("cc 3 at=n+1 bounded=both d=none")),
        labels(stamp("cc 3 at=2k bounded=both d=none"))],
    [["0", "C_{n+2}", "C_{n+1}", "C_n", "0"], ["0", "C_{2k+1}", "C_{2k}", "C_{2k-1}", "0"]]);
    const refusal = (line) => {
        try {
            stamp(line);
            return null;
        } catch (error) {
            return error.message;
        }
    };
    check("and refuses what is not one", [refusal("cc at="), refusal("cc at=#")], [
        "at takes a lower-case letter, as at=n, or one with a number, as at=n+1: not \"\".",
        "at takes a lower-case letter, as at=n, or one with a number, as at=n+1: not \"#\"."]);
    check("TeX's own \\# is not a place", labels(stamp("cc 1 obj=\\#_# bounded=both d=none")),
        ["0", "\\#_0", "0"]);
    check("one term to a row needs no route", body(stamp("cc 2 wrap=1 bounded=both d=none"))
        .includes("checkpoint") || body(stamp("cc 2 wrap=1 bounded=both d=none")).includes(".center"),
    false);
    check("a short exact sequence includes, then projects", body(stamp("ses maps=f,g")),
        "\t0 & A & B & C & 0\n"
        + "\t\\arrow[from=1-1, to=1-2]\n"
        + "\t\\arrow[\"f\", hook, from=1-2, to=1-3]\n"
        + "\t\\arrow[\"g\", two heads, from=1-3, to=1-4]\n"
        + "\t\\arrow[from=1-4, to=1-5]\n");
    const section = (line) => body(stamp(line)).split("\n").find((arrow) => arrow.includes("dashed"));
    check("a split's section curves back over the epi", section("ses split"),
        "\t\\arrow[\"s\"', curve={height=12pt}, dashed, from=1-4, to=1-3]");
    check("or under it", section("ses split under"),
        "\t\\arrow[\"s\", curve={height=-12pt}, dashed, from=1-4, to=1-3]");
    check("an exact sequence counts up from 1", body(stamp("es 2 dir=l")),
        "\t0 & {A_2} & {A_1} & 0\n"
        + "\t\\arrow[from=1-2, to=1-1]\n\t\\arrow[from=1-3, to=1-2]\n"
        + "\t\\arrow[from=1-4, to=1-3]\n");
    const les = stamp("les");
    check("a long exact sequence snakes from row to row", body(les).split("\n").slice(1, 8),
        ["\t\\cdots & {H_1(A)} & {H_1(B)} & {H_1(C)} \\\\",
            "\t& && \\\\",
            "\t& {H_0(A)} & {H_0(B)} & {H_0(C)} & \\cdots",
            "\t\\arrow[from=1-1, to=1-2]",
            "\t\\arrow[from=1-2, to=1-3]",
            "\t\\arrow[from=1-3, to=1-4]",
            "\t\\arrow[\"\\delta\", to path={[rounded corners=6pt] -- (\\tikzcdmatrixname-2-4.center)"
            + " -- (\\tikzcdmatrixname-2-2.center) \\tikztonodes -- (\\tikztotarget) [sharp corners]},"
            + " from=1-4, to=3-2]"]);
    check("as one step to undo, selected", [les.history.present, les.selection.size], [1, 15]);
    les.history.undo(les);
    check("which undoes whole", les.quiver.all_cells().length, 0);
    let refused = "";
    try {
        stamp("cc 2", (ui) => {
            ui.focus_position = new Position(-1, 0);
            new Vertex(ui, "X", new Position(1, 0));
        });
    } catch (error) {
        refused = error.message;
    }
    check("a stamp onto cells already there is refused", refused,
        "That would land \\cdots on X already at (1, 0): move the focus point somewhere with room.");
    let wrong = "";
    try {
        stamp("cc dir=x");
    } catch (error) {
        wrong = error.message;
    }
    check("an option out of its values is refused, saying which there are", wrong,
        "dir takes r, d, l, or u: not \"x\".");
}

// Indices: stepping along a sequence, and moving them.
{
    check("an index is a number, a symbol, or a multiple of one and a number",
        Index.scan("C_2 \\partial_{n-1} H^{2k+1} X_\\alpha E^{p,q}").map(({ value, base }) =>
            Template.index(value, base)), ["2", "n-1", "2k+1"]);
    check("reindexing moves each, braced where it needs it",
        Index.shift("C_n \\otimes D_2", 1), "C_{n+1} \\otimes D_3");
    check("but not arguments in brackets, capitals, scripts in scripts, or bound letters", [
        Index.shift("H^{n}(X;\\mathbb{Z}_2)", 1), Index.shift("\\Omega^n_X", 1),
        Index.shift("\\sum_{i=1}^n x_i", 1), Index.shift("\\pi_n(X,x_0)", 1),
        Index.shift("E_{n_1}", 1), Index.shift("X_\\alpha", 1)],
    ["H^{n+1}(X;\\mathbb{Z}_2)", "\\Omega^{n+1}_X", "\\sum_{i=1}^{n+1} x_i",
        "\\pi_{n+1}(X,x_0)", "E_{n_1}", "X_\\alpha"]);
    check("a step is how far alike labels' indices move", [Index.step("C_2", "C_1"),
        Index.step("C_{n+1}", "C_n"), Index.step("H^0(A)", "H^1(A)")], [-1, -1, 1]);
    check("and there is none between labels that differ otherwise",
        [Index.step("H_n(A)", "H_n(B)"), Index.step("\\cdots", "C_0")], [null, null]);

    const make = (code) => {
        const { ui } = parse(code);
        ui.focus_position = Position.zero();
        return ui;
    };
    const ui = make("\\begin{tikzcd}\n\t{C_2} & {C_1}\n"
        + "\t\\arrow[\"{\\partial_2}\", hook, from=1-1, to=1-2]\n\\end{tikzcd}\n");
    ui.select(ui.quiver.all_cells().find((cell) => cell.label === "C_1"));
    Commands.TABLE["continue"].run(new Commands(ui), []);
    check(":continue adds the next term, stepped, drawn as the last arrow",
        ui.text().split("\n").slice(1, -2),
        ["\t{C_2} & {C_1} & {C_0}",
            "\t\\arrow[\"{\\partial_2}\", hook, from=1-1, to=1-2]",
            "\t\\arrow[\"{\\partial_1}\", hook, from=1-2, to=1-3]"]);
    check("as one step, selected", [ui.history.present, ui.selection.size], [1, 2]);
    {
        const two = make("\\begin{tikzcd}\n\t{C_2} & {C_1} && {D_1} & {D_2}\n"
            + "\t\\arrow[\"f\", color={rgb,255:red,214;green,92;blue,92}, curve={height=6pt}, from=1-1, to=1-2]\n"
            + "\t\\arrow[from=1-5, to=1-4]\n\\end{tikzcd}\n");
        two.select(...two.quiver.all_cells().filter((cell) => ["C_1", "D_1"].includes(cell.label)));
        let clash = "";
        try {
            Commands.TABLE["continue"].run(new Commands(two), []);
        } catch (error) {
            clash = error.message;
        }
        check(":continue refuses two ends going on to one cell", [clash, two.history.present],
            ["C_1 and D_1 would both go on to (2, 0): continue them one at a time.", 0]);
        two.deselect();
        two.select(two.quiver.all_cells().find((cell) => cell.label === "C_1"));
        Commands.TABLE["continue"].run(new Commands(two), []);
        check("and draws the next arrow in the last one's colour and curve",
            two.text().split("\n").find((line) => line.includes("to=1-3")),
            "\t\\arrow[color={rgb,255:red,214;green,92;blue,92}, curve={height=6pt}, from=1-2, to=1-3]");
    }
    ui.deselect();
    ui.select(...ui.quiver.all_cells());
    Commands.TABLE["reindex"].run(new Commands(ui), ["-1"]);
    check(":reindex moves every selected index",
        ui.quiver.all_cells().map((cell) => cell.label).sort(),
        ["C_0", "C_1", "C_{-1}", "\\partial_0", "\\partial_1"]);
    ui.history.undo(ui);
    check("and undoes as one step", ui.quiver.all_cells()[0].label, "C_2");

    const triangle = make("");
    Presets.run(triangle, "triangle", []);
    check("a triangle's third arrow is marked +1", triangle.text().split("\n").slice(1, -2),
        ["\tX && Y \\\\", "\t& Z", "\t\\arrow[from=1-1, to=1-3]", "\t\\arrow[from=1-3, to=2-2]",
            "\t\\arrow[\"{+1}\", from=2-2, to=1-1]"]);
}

// Labels that once did not come back: a quote in an arrow's label, and a `%`.
{
    const square = "\\begin{tikzcd}\n\tA & B\n\t\\arrow[\"f\", from=1-1, to=1-2]\n\\end{tikzcd}\n";
    const relabel = (vertex, edge) => {
        const { ui } = parse(square);
        ui.quiver.all_cells().find((cell) => cell.label === "B").label = vertex;
        ui.quiver.all_cells().find((cell) => cell.is_edge()).label = edge;
        const text = ui.text();
        const back = parse(text);
        return [text.split("\n").slice(1, 3), labels(back.ui), back.diagnostics.length];
    };
    check("a quote in an arrow's label is braced, and read back", relabel("B", "\\text{\"}"),
        [["\tA & B", "\t\\arrow[\"{\\text{\"}}\", from=1-1, to=1-2]"], ["A", "B", "\\text{\"}"], 0]);
    check("a bare % is written as the sign, not a comment", relabel("50%", "x%y"),
        [["\tA & {50\\%}", "\t\\arrow[\"{x\\%y}\", from=1-1, to=1-2]"], ["A", "50\\%", "x\\%y"], 0]);
    check("an escaped one is left as it is", [Delimiters.percent("\\%"), Delimiters.percent("%%"),
        Delimiters.percent("a\\\\%")], ["\\%", "\\%\\%", "a\\\\\\%"]);
    check("braces balance, escaped ones aside", ["{B", "B}", "}{", "\\{", "{\\}}", "\\frac{a}{b}"]
        .map(Delimiters.balanced), [false, false, false, true, true, true]);
}

// Spectral sequences: the page, its frame in the file, and its differentials.
{
    const page = (words, setup = null) => {
        const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
        ui.focus_position = new Position(1, 0);
        setup?.(ui);
        Presets.run(ui, "spectral-sequence", words);
        return ui;
    };
    const small = page(["p=0..2", "q=0..1", "obj=E_#^{#p,#q}"]);
    const text = small.text();
    check("a page is its entries, a tick column and row, and the names of the axes",
        text.split("\n").slice(1, 6), [
            "\t% sagitta: spectral-sequence grading=coh page=2 origin=3-2 p=0..2 q=0..1",
            "\t{\\scriptstyle q} \\\\",
            "\t{\\scriptstyle 1} & {E_2^{0,1}} & {E_2^{1,1}} & {E_2^{2,1}} \\\\",
            "\t{\\scriptstyle 0} & {E_2^{0,0}} & {E_2^{1,0}} & {E_2^{2,0}} \\\\",
            "\t& {\\scriptstyle 0} & {\\scriptstyle 1} & {\\scriptstyle 2} & {\\scriptstyle p}"]);
    check("with axes drawn from the ticks", text.split("\n")[0].includes(
        String.raw`\coordinate (sagitta-corner) at ($(\tikzcdmatrixname-3-1.base)!.5!(`
        + String.raw`\tikzcdmatrixname-4-2.base)+(0,\the\fontdimen22\textfont2)$)`), true);
    check("its frame is set as one step with it", [small.frame.origin.x, small.frame.origin.y,
        small.history.present], [1, 1, 1]);
    const { ui: read, diagnostics: read_diagnostics } = parse(text);
    check("and read back from the file", [read.frame.origin.x, read.frame.origin.y, read.frame.p,
        read.frame.q, read.frame.grading, read_diagnostics.length], [1, 2, [0, 2], [0, 1], "coh", 0]);
    check("so saving writes the same bytes", read.text(), text);
    small.history.undo(small);
    check("undoing takes the frame away with the page", [small.frame, small.quiver.all_cells().length],
        [null, 0]);

    const at = (ui, p, q) => ui.positions.get(`${SpectralSequence.cell(ui.frame, p, q)}`);
    const differential = (grading, r, from) => {
        const ui = page(["p=0..3", "q=0..3", "obj=\\bullet", `grading=${grading}`]);
        ui.deselect();
        ui.select(at(ui, ...from));
        SpectralSequence.differential(ui, r, true);
        const edge = ui.quiver.all_cells().find((cell) => cell.is_edge());
        return [SpectralSequence.bidegree(ui.frame, edge.target.position), edge.label];
    };
    check("d_2 goes right 2, down 1, cohomologically", differential("coh", 2, [0, 1]),
        [[2, 0], "d_2"]);
    check("left 2, up 1, homologically", differential("hom", 2, [2, 0]), [[0, 1], "d_2"]);
    check("and left 1, up r, in an Adams chart", differential("adams", 3, [2, 0]), [[1, 3], "d_3"]);
    const outside = page(["p=0..1", "q=0..1", "obj=\\bullet"]);
    outside.deselect();
    outside.select(at(outside, 0, 1));
    SpectralSequence.differential(outside, 3, false);
    check("a differential to where there is no cell makes one, as Space does",
        outside.quiver.all_cells().filter((cell) => cell.is_vertex() && cell.label === "\\bullet")
            .length, 5);
    check("and selects it with the arrow", Array.from(outside.selection, (cell) => cell.is_vertex()
        ? SpectralSequence.bidegree(outside.frame, cell.position) : "arrow"), [[3, -1], "arrow"]);

    const gap = page(["p=0..1", "q=0..1"]);
    new Commands(gap).insert("x", 0);
    check("a column opened before the page moves its origin", gap.frame.origin.x, 2);
    gap.history.undo(gap);
    check("and back with the undo", gap.frame.origin.x, 1);
    const refuse = (f) => {
        try {
            f();
            return null;
        } catch (error) {
            return error.message;
        }
    };
    const inside = page(["p=0..3", "q=0..1"]);
    check("a column opened through the page, or between its ticks and entries, is refused", [
        refuse(() => new Commands(inside).insert("x", 3)),
        refuse(() => new Commands(inside).insert("x", 1)),
        inside.history.present], [
        "That would open a gap inside the spectral sequence's page: open it left or right of the"
            + " page, or grow a range in :frame.",
        "That would open a gap inside the spectral sequence's page: open it left or right of the"
            + " page, or grow a range in :frame.", 1]);
    new Commands(inside).insert("x", 5);
    check("one past the ticks, at the name, leaves the frame where it is", inside.frame.origin.x, 1);
    check("deleting every cell takes the frame too", SpectralSequence.deleting(inside,
        new Set(inside.quiver.all_cells())).map(({ to }) => to), [null]);
    check("and deleting some leaves it", SpectralSequence.deleting(inside,
        new Set(inside.quiver.all_cells().slice(1))), []);
    check("a second page in one diagram is refused", refuse(() => Presets.run(inside,
        "spectral-sequence", [])), "This diagram has a spectral sequence already, and keeps only"
        + " one: put the next page in a diagram of its own.");

    const directive = (words) => {
        const { ui, diagnostics } = parse(text.replace(/grading=.*$/m, words));
        return [ui.frame === null, diagnostics.map(({ message }) => message)];
    };
    check("a directive that cannot be read is said so, and left out", [
        directive("grading=coh page=two origin=3-2 p=0..2 q=0..1"),
        directive("grading=coh page=2 origin=3-2 p=2..0 q=0..1"),
        directive("grading=coh page=2 origin=3-2 p=0..2 q=0..1 lines=1,x")], [
        [true, ["Spectral sequence ignored: page=two should be a whole number."]],
        [true, ["Spectral sequence ignored: p=2..0 should be low..high."]],
        [true, ["Spectral sequence ignored: lines=1,x should be numbers."]]]);
    check("and its lines are kept once each, in order", parse(text.replace(/q=0\.\.1$/m,
        "q=0..1 lines=3,1,3")).ui.frame.lines, [1, 3]);
    check("axes without their comment are said to go", parse(text.split("\n")
        .filter((line) => !line.includes("% sagitta")).join("\n")).diagnostics
        .map(({ message }) => message), ["Axes dropped: their spectral-sequence comment is missing."]);
}

// The frame changes: its range grows and shrinks by its ticks, and its page and grading.
{
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    ui.focus_position = new Position(1, 0);
    Presets.run(ui, "spectral-sequence", ["p=0..1", "q=0..1"]);
    const row = () => ui.text().split("\n").filter((line) => line.includes("{\\scriptstyle p}"))[0];
    SpectralSequence.resize(ui, "p", 1);
    check("growing p adds its tick where its name was, and moves the name on", [row(), ui.frame.p],
        ["\t& {\\scriptstyle 0} & {\\scriptstyle 1} & {\\scriptstyle 2} & {\\scriptstyle p}", [0, 2]]);
    SpectralSequence.resize(ui, "p", -1);
    SpectralSequence.resize(ui, "p", -1);
    check("shrinking takes the last tick away, and brings the name back", [row(), ui.frame.p],
        ["\t& {\\scriptstyle 0} & {\\scriptstyle p}", [0, 0]]);
    let refused = "";
    try {
        SpectralSequence.resize(ui, "p", -1);
    } catch (error) {
        refused = error.message;
    }
    check("but not below one", refused, "The range of p is down to one, 0..0.");
    ui.history.undo(ui);
    ui.history.undo(ui);
    check("each is a step to undo", [row(), ui.frame.p],
        ["\t& {\\scriptstyle 0} & {\\scriptstyle 1} & {\\scriptstyle 2} & {\\scriptstyle p}", [0, 2]]);
    SpectralSequence.change(ui, { ...ui.frame, page: 3 });
    check("the page changes, and the file says so",
        ui.text().includes("% sagitta: spectral-sequence grading=coh page=3"), true);
}

// The low ends of the ranges: the other axis's ticks move with them.
{
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    ui.focus_position = new Position(1, 0);
    Presets.run(ui, "spectral-sequence", ["p=0..1", "q=0..1"]);
    const body = () => ui.text().split("\n").filter((line) => line.startsWith("\t")
        && !line.includes("sagitta:") && !line.includes("\\arrow"));
    SpectralSequence.shift_low(ui, "p", -1);
    check("lowering p's low end moves the q ticks out and adds a tick", [body(), ui.frame.p], [[
        "\t{\\scriptstyle q} \\\\",
        "\t{\\scriptstyle 1} \\\\",
        "\t{\\scriptstyle 0} \\\\",
        "\t& {\\scriptstyle -1} & {\\scriptstyle 0} & {\\scriptstyle 1} & {\\scriptstyle p}",
    ], [-1, 1]]);
    SpectralSequence.shift_low(ui, "q", -1);
    check("and q's moves the p ticks down", [ui.frame.q, body().length], [[-1, 1], 5]);
    SpectralSequence.shift_low(ui, "q", 1);
    SpectralSequence.shift_low(ui, "p", 1);
    check("raising them takes the ticks back", [ui.frame.p, ui.frame.q, body()], [[0, 1], [0, 1], [
        "\t{\\scriptstyle q} \\\\",
        "\t{\\scriptstyle 1} \\\\",
        "\t{\\scriptstyle 0} \\\\",
        "\t& {\\scriptstyle 0} & {\\scriptstyle 1} & {\\scriptstyle p}",
    ]]);
    const entry = new Vertex(ui, "A", SpectralSequence.cell(ui.frame, 0, 1));
    ui.history.add(ui, [{ kind: "create", cells: new Set([entry]) }]);
    let refused = "";
    try {
        SpectralSequence.shift_low(ui, "p", 1);
    } catch (error) {
        refused = error.message;
    }
    check("but not onto entries", refused, "The entries of p=0 are in the way: A.");
}

// Every d_r at once, the diagonals, and an augmentation.
{
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    ui.focus_position = new Position(1, 0);
    Presets.run(ui, "spectral-sequence", ["p=0..3", "q=0..2", "obj=\\bullet"]);
    // A command line's one command, run as the command line would, returning what it says.
    const command = (line) => {
        const [name, ...args] = Commands.split(line)[0];
        try {
            Commands.TABLE[Commands.canonical(name)].run(new Commands(ui), args);
            return "";
        } catch (error) {
            return error.message;
        }
    };
    command("d 2 all");
    const edges = () => ui.quiver.all_cells().filter((cell) => cell.is_edge());
    check(":d 2 all draws each d_2 between entries in the ranges", edges().map((edge) =>
        [SpectralSequence.bidegree(ui.frame, edge.source.position),
            SpectralSequence.bidegree(ui.frame, edge.target.position)]).sort().join(" "),
        [[[0, 1], [2, 0]], [[0, 2], [2, 1]], [[1, 1], [3, 0]], [[1, 2], [3, 1]]].join(" "));
    check("and none twice", [command("d 2 all"), edges().length],
        ["There are no d_2 to draw between the entries in the ranges.", 4]);
    command("diagonal 2");
    check(":diagonal selects the entries of a total degree", Array.from(ui.selection, (cell) =>
        SpectralSequence.bidegree(ui.frame, cell.position)).sort(), [[0, 2], [1, 1], [2, 0]]);
    command("diagonal 2 line");
    const text = ui.text();
    check("line keeps it in the frame", text.includes("p=0..3 q=0..2 lines=2"), true);
    check("and draws it dashed through the entries' maths axes", text.includes(String.raw`\coordinate (sagitta-a) at ($(\tikzcdmatrixname-5-2.base |- \tikzcdmatrixname-2-1.base)+(0,\the\fontdimen22\textfont2)$);`)
        && text.includes(String.raw`\draw[line width=0.4pt, dashed] ($(sagitta-a)!-8pt!(sagitta-b)$)`), true);
    const { ui: read } = parse(text);
    check("and reads back", [read.frame.lines, read.text() === text], [[2], true]);
    command("diagonal 2 line");
    check("again takes it away", ui.text().includes("lines="), false);

    const resolution = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    resolution.focus_position = Position.zero();
    Presets.run(resolution, "chain-complex", ["2", "obj=P_#", "aug=M"]);
    check(":cc aug=M ends a chain complex with ε onto M, then 0",
        resolution.text().split("\n")[1], "\t\\cdots & {P_1} & {P_0} & M & 0");
    const injective = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions });
    injective.focus_position = Position.zero();
    Presets.run(injective, "chain-complex", ["2", "type=cochain", "obj=I^#", "aug=M"]);
    check("and starts a cochain complex with it", injective.text().split("\n")[1],
        "\t0 & M & {I^0} & {I^1} & \\cdots");
    check("text options suggest values", Presets.completions(Presets.SPECTRAL_SEQUENCE)
        .filter((word) => word.startsWith("obj=")), ["obj=", "obj=\\bullet", "obj=E_#^{#p,#q}",
        "obj=E^#_{#p,#q}"]);
    check("the setup layer's keys step to", [Presets.steps(Presets.CHAIN_COMPLEX.wrap, 0),
        Presets.steps(Presets.CHAIN_COMPLEX.step, 2), Presets.amscd("split",
            Presets.SHORT_EXACT_SEQUENCE.split)], [[1], [3, 1], "no split"]);
}
