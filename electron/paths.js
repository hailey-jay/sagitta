/// Finding files on disk, shared by the app (`main.js`) and `sagitta --check` (`check.js`).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/// The nearest file called `name` in `directory` or its ancestors, or `null`. The search ends at
/// the enclosing git repository's root, and never reaches the home directory, so that a stray
/// `~/macros.tex` is not taken up by every diagram outside a project.
function find_up(directory, name) {
    // Windows spells one directory several ways, and they differ in case. Compare paths the way
    // the platform does, or the search takes up a `macros.tex` above the home directory.
    const same = (a, b) => process.platform === "win32"
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;
    const home = os.homedir();
    for (let current = directory; !same(current, home); current = path.dirname(current)) {
        const candidate = path.join(current, name);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const root = fs.existsSync(path.join(current, ".git"));
        if (root || path.dirname(current) === current) {
            return null;
        }
    }
    return null;
}

module.exports = { find_up };
