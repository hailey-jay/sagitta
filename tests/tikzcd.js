/// What reading and writing diagrams has to get right, checked without Electron and without a
/// display: the round trip of a diagram's file a paper depends on, in tikz-cd and in amscd, the
/// encoded first line of older files and when it is trusted, the forms quiver writes, inline
/// maths, and the settings the command line parses. Run it with `node tests/tikzcd.js`.
///
/// `tests/test_sagitta.py` drives the real app, which takes minutes; this takes seconds, so
/// a parser or export regression shows before the slow suite starts. It loads the sources that
/// touch the diagram itself (nothing of the mode line, the pointer, or KaTeX) into a `vm`
/// context, over a stub DOM (`electron/headless.js`) and a stub `UI` that holds only what the
/// parse and export paths reach for.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

const headless = require("../electron/headless.js");

const source = headless.source(ROOT);

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

/// Each file of `tests/corpus/`, as `[name, contents]`.
const corpus = () => fs.readdirSync(path.join(__dirname, "corpus")).sort()
    .map((name) => [name, fs.readFileSync(path.join(__dirname, "corpus", name), "utf8")]);

const context = headless.sandbox({ check, example, corpus });

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
