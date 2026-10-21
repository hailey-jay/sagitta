/// What reading and writing diagrams has to get right, checked without Electron and without a
/// display: the round trip of a diagram's file a paper depends on, in tikz-cd and in amscd, the
/// encoded first line of older files and when it is trusted, the forms quiver writes, inline
/// maths, and the settings the command line parses. Run it with `node tests/tikzcd.js`.
///
/// `tests/test_sagitta.py` drives the real app, which takes minutes; this takes seconds, so
/// a parser or export regression shows before the slow suite starts. It loads the sources that
/// touch the diagram itself (nothing of the keymap, the mode line, or KaTeX) into a `vm` context,
/// over a stub DOM (`stub.js`) and a stub `UI` that holds only what the parse and export paths
/// reach for.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

/// The sources the diagram itself needs, in the order `index.html` loads them.
const SOURCES = [
    "src/ds.js",
    "src/dom.js",
    "src/grid.js",
    "src/curve.js",
    "src/arrow.js",
    "src/constants.js",
    "src/parser.js",
    "src/quiver.js",
    "src/formats.js",
    "src/settings.js",
    "src/schema.js",
    "src/delimiters.js",
    "src/history.js",
    "src/colours.js",
    "src/cell.js",
    "src/options.js",
    "src/commands.js",
    "src/presets.js",
    "src/spectral.js",
    "src/keys.js",
    "src/keymap.js",
    "src/bindings.js",
    "src/file.js",
];

const source = SOURCES
    .map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const failures = [];
const check = (what, got, wanted) => {
    const ok = JSON.stringify(got) === JSON.stringify(wanted);
    if (!ok) {
        failures.push(what);
    }
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${what}${
        ok ? "" : `: ${JSON.stringify(got)} (wanted ${JSON.stringify(wanted)})`}\n`);
};

const example = (name) => fs.readFileSync(path.join(ROOT, "examples", name), "utf8");

const context = Object.assign(
    {
        console, check, example, process, setTimeout, clearTimeout,
        // The encoding is base64 over UTF-8, which the page takes from the browser.
        TextEncoder, TextDecoder, btoa, atob, URL, URLSearchParams,
    },
    require("./stub.js"),
);
vm.createContext(context);

/// The checks, as a function compiled in the context, so that they are ordinary source rather
/// than a template literal (and so may hold backticks and `${}`).
const checks = fs.readFileSync(path.join(__dirname, "tikzcd-checks.js"), "utf8");
// The checks hand back the ones that cannot finish at once (reading a settings file is
// asynchronous), which are waited for before the failures are counted.
Promise.all(vm.runInContext(`${source}\n${checks}\npending`, context,
    { filename: "tests/tikzcd.js" }))
    .then(() => {
        process.stdout.write(
            `${failures.length === 0 ? "all ok" : `${failures.length} failures`}\n`);
        process.exit(failures.length === 0 ? 0 : 1);
    });
