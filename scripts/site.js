#!/usr/bin/env node
/// Gather the web page into a directory of its own, to upload to a static host as it is:
///
///     node scripts/site.js [DIR]
///
/// `DIR` is `site/` by default, and is emptied first. The page is what the desktop app packages
/// (`build.files` in `package.json`), without the desktop shell, and with the service worker, which
/// only a browser uses. Serving the repository itself would publish everything else in it too,
/// `node_modules/` and the packages in `dist/` among them.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "site"));

const packaged = require(path.join(ROOT, "package.json")).build.files;
const entries = [...packaged.filter((entry) => entry !== "electron/**"), "service-worker.js"];

fs.rmSync(out, { recursive: true, force: true });
for (const entry of entries) {
    // Each entry is a file, or `<directory>/**` for everything in a directory.
    const name = entry.replace(/\/\*\*$/, "");
    const from = path.join(ROOT, name);
    if (!fs.existsSync(from)) {
        console.error(`site: ${name} is in the list, but not in the repository.`);
        process.exit(1);
    }
    fs.cpSync(from, path.join(out, name), { recursive: true });
}
console.log(`The page is in ${path.relative(process.cwd(), out) || "."}.`);
