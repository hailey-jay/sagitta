/// `sagitta --check [DIR]`: read every diagram under `DIR` (by default the directory it is run
/// from) as Sagitta opens it, without a window, and report, a line each, what a paper would
/// suffer from:
///
/// - what Sagitta cannot read of a file, which saving it would drop;
/// - a file that saving would change, as one written by hand or by an older Sagitta;
/// - a label KaTeX cannot read, or one using a macro the nearest `macros.tex` (or `--macros`) does
///   not define.
///
/// It loads the diagram's sources and KaTeX into a `vm` context over the window the fast suite
/// uses (see `headless.js`), so it reads and writes exactly as the app does.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const headless = require("./headless.js");

/// What one diagram's `text` has wrong, run inside the context, given the definitions of its
/// macros file: `{ unread, legacy, changed, undefined, broken }`, where `changed` is the first
/// line saving would change, as `[line, was, would be]`, or `null`, `undefined` maps each unknown
/// macro to the labels using it, and `broken` lists the labels KaTeX cannot read at all.
const LINT = String.raw`(async (text, definitions) => {
    const ui = make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions,
        SpectralSequence });
    DiagramFile.restore_sep(ui, text);
    const { diagnostics, legacy } = DiagramFile.read(ui, text);
    // Reading shortens arrows once the grid is laid out, a moment after the parse.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const was = text.replace(/\r\n/g, "\n").split("\n");
    const would = ui.text().split("\n");
    const at = was.findIndex((line, i) => line !== would[i]);
    const changed = at === -1 && was.length === would.length ? null
        : [at === -1 ? Math.min(was.length, would.length) + 1 : at + 1,
            was[at] ?? "", would[at] ?? ""];
    const macros = Macros.for_katex(Macros.parse(definitions).macros);
    const undefined_macros = new Map();
    const broken = [];
    for (const cell of ui.quiver.all_cells()) {
        if (cell.label.trim() === "") {
            continue;
        }
        const label = Delimiters.dollars(Delimiters.percent(cell.label));
        const known = { ...macros };
        // KaTeX stops at the first macro it does not know, so each is defined as nothing in turn,
        // to find the next.
        for (let tries = 0; tries < 64; ++tries) {
            try {
                katex.renderToString(label, { throwOnError: true, strict: false,
                    macros: { ...known } });
                break;
            } catch (error) {
                const unknown = /Undefined control sequence: (\\[A-Za-z@]+|\\.)/
                    .exec(error.message ?? "");
                if (unknown === null) {
                    broken.push(cell.label);
                    break;
                }
                const name = unknown[1];
                undefined_macros.set(name, [...(undefined_macros.get(name) ?? []), cell.label]);
                known[name] = "";
            }
        }
    }
    return {
        unread: diagnostics.map((diagnostic) => diagnostic.message?.text ?? diagnostic.message),
        legacy,
        changed,
        undefined: Array.from(undefined_macros),
        broken,
    };
})`;

/// Every diagram file under `directory`, sorted, leaving out hidden directories and
/// `node_modules`.
function diagrams(directory) {
    const found = [];
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
                    walk(full);
                }
            } else if (/\.(cd\.tex|tikzcd)$/.test(entry.name)) {
                found.push(full);
            }
        }
    };
    walk(directory);
    return found.sort();
}

/// Check every diagram under `directory`, the app's sources being in `root`, with macros from
/// `macros` if given, or else the nearest `macros.tex` to each, as `find_up` finds it. Returns the
/// report, and the exit code: 0 if nothing is wrong, 1 if something is.
async function check(root, directory, macros, find_up) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        return { text: `sagitta: ${directory} is not a directory\n`, code: 2 };
    }
    const context = headless.sandbox();
    vm.runInContext(headless.source(root, true), context, { filename: "sagitta" });
    const lint = vm.runInContext(LINT, context);
    const read = (file) => file === null ? "" : fs.readFileSync(file, "utf8");
    const lines = [];
    const files = diagrams(directory);
    let wrong = 0;
    for (const file of files) {
        const name = path.relative(process.cwd(), file) || file;
        let result;
        try {
            const definitions = read(macros ?? find_up(path.dirname(file), "macros.tex"));
            result = await lint(read(file), definitions);
        } catch (error) {
            lines.push(`${name}: cannot be read: ${error.message}`);
            ++wrong;
            continue;
        }
        const found = [];
        for (const message of result.unread) {
            found.push(`not read, so saving drops it: ${message}`);
        }
        if (result.legacy) {
            found.push("has the encoded first line older versions wrote, which saving drops");
        } else if (result.changed !== null && result.unread.length === 0) {
            const [line, was, would] = result.changed;
            found.push(`saving would change line ${line}: ${JSON.stringify(was)} to ${
                JSON.stringify(would)}`);
        }
        for (const [macro, labels] of result.undefined) {
            found.push(`${macro} is not defined, in ${labels.map((label) => JSON.stringify(label))
                .join(", ")}`);
        }
        for (const label of result.broken) {
            found.push(`KaTeX cannot read the label ${JSON.stringify(label)}`);
        }
        if (found.length > 0) {
            ++wrong;
            lines.push(...found.map((problem) => `${name}: ${problem}`));
        }
    }
    lines.push(`${files.length} diagram${files.length === 1 ? "" : "s"} checked, ${
        wrong === 0 ? "all well" : `${wrong} with problems`}`);
    return { text: `${lines.join("\n")}\n`, code: wrong === 0 ? 0 : 1 };
}

module.exports = { check, diagrams };

// Run as a script, as the launcher runs it (under `ELECTRON_RUN_AS_NODE`, so that it needs no
// display): `check.js [--check] [--macros FILE] [DIR]`.
if (require.main === module) {
    const words = process.argv.slice(2).filter((word) => word !== "--check");
    let macros = null;
    let directory = null;
    for (let i = 0; i < words.length; ++i) {
        if (words[i] === "--macros" && i + 1 < words.length) {
            macros = path.resolve(words[++i]);
        } else if (words[i].startsWith("-") || directory !== null) {
            process.stderr.write(`sagitta: --check takes --macros FILE and a directory: not '${
                words[i]}'; see sagitta --help\n`);
            process.exit(2);
        } else {
            directory = path.resolve(words[i]);
        }
    }
    check(path.join(__dirname, ".."), directory ?? process.cwd(), macros,
        require("./paths.js").find_up).then(({ text, code }) => {
        // The report is the output, problems or none; only a mistake in the arguments is an error.
        (code === 2 ? process.stderr : process.stdout).write(text);
        process.exit(code);
    });
}
