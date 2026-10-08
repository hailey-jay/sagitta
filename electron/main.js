/// The desktop shell: one window per process, showing `index.html`, with the filesystem access the
/// page needs to open and save `.tikzcd` files and to follow the project's `macros.tex`, and the
/// system clipboard. The page reaches it through `window.host` (see `preload.js`); everything here
/// is plumbing, and the page decides what to do with it (see `src/file.js`).
///
/// The command line is `USAGE`, below.

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } = require("electron");
const child_process = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const USAGE = `\
Usage: sagitta [--macros FILE] [--devtools] [DIAGRAM.tikzcd] [-- SWITCHES]

A keyboard-driven editor for tikz-cd diagrams. Opens DIAGRAM, which need not
exist yet, or else an empty diagram. In the app, C-/ lists the keys.

  --macros FILE  take macros from FILE, not the nearest macros.tex
  --devtools     open Chromium's developer tools
  -h, --help     show this and exit
  --version      show the version and exit
  -- SWITCHES    pass the rest to Electron, as in -- --ozone-platform=wayland
`;

/// Print `message` and the way to the usage, and exit.
function usage_error(message) {
    process.stderr.write(`sagitta: ${message}; see sagitta --help\n`);
    app.exit(2);
    process.exit(2);
}

/// The command-line arguments, as `{ diagram, macros, devtools, switches, arguments }`, with paths
/// made absolute, `switches` those after `--`, and `arguments` those before it. Exits on `--help`, `--version`, or a mistake, which
/// would otherwise open an empty diagram regardless.
function parse_arguments() {
    // Under the stock `electron` binary, the first argument that is not a Chromium switch is the
    // app's directory.
    let argv = process.argv.slice(1);
    if (process.defaultApp) {
        argv = argv.slice(argv.findIndex((argument) => !argument.startsWith("-")) + 1);
    }
    // Starting again (see below), the arguments come here, apart from Chromium's switches.
    if (process.env.SAGITTA_ARGUMENTS !== undefined) {
        argv = JSON.parse(process.env.SAGITTA_ARGUMENTS);
        delete process.env.SAGITTA_ARGUMENTS;
    }
    const result = { diagram: null, macros: null, devtools: false, switches: [], arguments: [] };
    for (let i = 0; i < argv.length; ++i) {
        const argument = argv[i];
        if (argument === "-h" || argument === "--help") {
            process.stdout.write(USAGE);
            app.exit(0);
            process.exit(0);
        } else if (argument === "--version") {
            process.stdout.write(`sagitta ${app.getVersion()}\n`);
            app.exit(0);
            process.exit(0);
        } else if (argument === "--macros") {
            if (i + 1 === argv.length) {
                usage_error("--macros needs a file");
            }
            result.macros = path.resolve(argv[++i]);
        } else if (argument === "--devtools") {
            result.devtools = true;
        } else if (argument === "--") {
            result.switches = argv.slice(i + 1);
            result.arguments = argv.slice(0, i);
            break;
        } else if (argument.startsWith("-")) {
            usage_error(`unknown option '${argument}'`);
        } else if (result.diagram !== null) {
            usage_error("one diagram at a time");
        } else {
            result.diagram = path.resolve(argv[i]);
        }
    }
    return result;
}

const args = parse_arguments();

// Chromium reads no switches after `--`, so Sagitta starts again, detached, with them as its only
// arguments besides the app's directory under the stock binary, and with its own arguments in
// `SAGITTA_ARGUMENTS`. An AppImage starts again from its own path: the binary inside it, and so
// `app.relaunch`, goes when this process exits and the image is unmounted.
if (args.switches.length > 0) {
    const env = { ...process.env, SAGITTA_ARGUMENTS: JSON.stringify(args.arguments) };
    child_process.spawn(
        process.env.APPIMAGE ?? process.execPath,
        [...args.switches, ...(process.defaultApp ? [app.getAppPath()] : [])],
        { env, detached: true, stdio: "inherit" },
    ).unref();
    app.exit(0);
}

// `app.getPath("userData")`, and so the settings file, is `~/.config/sagitta`.
app.setName("sagitta");

// Dialogs offer these, diagrams first.
const FILTERS = {
    diagram: [{ name: "tikz-cd diagrams", extensions: ["tikzcd"] }, { name: "All files", extensions: ["*"] }],
    macros: [{ name: "LaTeX", extensions: ["tex", "sty"] }, { name: "All files", extensions: ["*"] }],
};

/// The file's contents, or `null` if it does not exist.
function read_file(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

/// Write beside the file and rename over it, so that a crash leaves the old contents or the new,
/// never part of either. Through a symlink, this replaces the file it points to.
function write_file(file, text) {
    let target = file;
    let mode = null;
    try {
        target = fs.realpathSync(file);
        mode = fs.statSync(target).mode & 0o7777;
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
    const temporary = path.join(
        path.dirname(target), `.${path.basename(target)}.sagitta-${process.pid}`);
    try {
        const descriptor = fs.openSync(temporary, "w");
        try {
            fs.writeFileSync(descriptor, text);
            if (mode !== null) {
                fs.fchmodSync(descriptor, mode);
            }
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, target);
    } catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
    }
}

app.whenReady().then(() => {
    // No menu bar: every binding is the page's own, and a menu would claim `Alt` and some chords.
    Menu.setApplicationMenu(null);

    // The page's settings, as plain JSON it reads at startup and rewrites on every change.
    const settings = path.join(app.getPath("userData"), "settings.json");

    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: "#1e1e1e",
        // Electron cannot load an SVG icon; `icon.png` is `icon.svg` rendered at 256px.
        icon: path.join(__dirname, "..", "icon.png"),
        webPreferences: { preload: path.join(__dirname, "preload.js") },
    });

    // Whether the diagram has unsaved changes, as the page last reported, and whether closing
    // should go ahead regardless.
    let dirty = false;
    let closing = false;

    window.on("close", (event) => {
        if (!dirty || closing) {
            return;
        }
        event.preventDefault();
        const response = dialog.showMessageBoxSync(window, {
            type: "question",
            message: "Save the diagram before closing?",
            buttons: ["Save", "Discard", "Cancel"],
            defaultId: 0,
            cancelId: 2,
        });
        if (response === 0) {
            // The page saves (asking for a path if it has none), then asks to close.
            window.webContents.send("save-and-close");
        } else if (response === 1) {
            closing = true;
            window.close();
        }
    });

    // Watched files, from path to the `fs.watchFile` listener. Polling survives editors that save
    // by writing a new file and renaming it over the old one, which `fs.watch` loses track of.
    const watched = new Map();

    const handlers = {
        arguments: () => ({ diagram: args.diagram, macros: args.macros }),
        resolve: (base, file) => path.resolve(base ?? process.cwd(), file),
        read: read_file,
        write: write_file,
        // The settings, as the text of `settings.json`, or `null` before it has been written.
        read_settings: () => read_file(settings),
        // The keys file, which only the user writes, or `null` if there is none.
        read_keys: () => read_file(path.join(app.getPath("userData"), "keys")),
        write_settings: (text) => {
            fs.mkdirSync(path.dirname(settings), { recursive: true });
            write_file(settings, text);
        },
        // Open the settings in the desktop's editor for JSON. Returns the error, or "".
        open_settings: () => shell.openPath(settings),
        // The nearest file called `name` in `directory` or its ancestors, or `null`. The search
        // ends at the enclosing git repository's root, and never reaches the home directory, so
        // that a stray `~/macros.tex` is not taken up by every diagram outside a project.
        find_up: (directory, name) => {
            const home = os.homedir();
            for (let current = directory; current !== home; current = path.dirname(current)) {
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
        },
        open_dialog: (kind, directory) => {
            const paths = dialog.showOpenDialogSync(window, {
                defaultPath: directory ?? undefined,
                filters: FILTERS[kind],
                properties: ["openFile"],
            });
            return paths === undefined ? null : paths[0];
        },
        save_dialog: (default_path) => dialog.showSaveDialogSync(window, {
            defaultPath: default_path ?? undefined,
            filters: FILTERS.diagram,
        }) ?? null,
        confirm: (message) => dialog.showMessageBoxSync(window, {
            type: "question",
            message,
            buttons: ["Discard", "Cancel"],
            defaultId: 1,
            cancelId: 1,
        }) === 0,
        watch: (file) => {
            if (watched.has(file)) {
                return;
            }
            const listener = (current, previous) => {
                if (current.mtimeMs !== previous.mtimeMs) {
                    window.webContents.send("changed", file);
                }
            };
            watched.set(file, listener);
            fs.watchFile(file, { interval: 300 }, listener);
        },
        unwatch: (file) => {
            if (watched.has(file)) {
                fs.unwatchFile(file, watched.get(file));
                watched.delete(file);
            }
        },
        read_clipboard: () => clipboard.readText(),
        write_clipboard: (text) => clipboard.writeText(text),
    };
    for (const [name, handler] of Object.entries(handlers)) {
        ipcMain.handle(name, (_, ...parameters) => handler(...parameters));
    }
    ipcMain.on("set-dirty", (_, value) => {
        dirty = value;
    });
    ipcMain.on("close", () => {
        closing = true;
        window.close();
    });

    // The page never leaves `index.html` or opens windows of its own: a link or a file dropped
    // where the page does not take it would otherwise replace the diagram.
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    window.loadFile(path.join(__dirname, "..", "index.html"));
    if (args.devtools) {
        window.webContents.openDevTools();
    }
});

app.on("window-all-closed", () => app.quit());
