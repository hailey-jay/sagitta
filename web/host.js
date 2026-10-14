/// The page's view of the browser, as `window.host`, when Sagitta runs as a web page rather than in
/// the desktop shell (whose `electron/preload.js` defines `host` first, so that this does nothing).
///
/// The page names files by path, and a browser gives out none. Each file the user picks, saves, or
/// drops is given a path of its own, `/<n>/<name>`, which stands for it from then on: `<n>` keeps
/// two files of the same name apart, and the directory part keeps the page's relative paths and
/// default save locations working within what the user has handed over.
///
/// Where the File System Access API is there (Chromium), a picked file keeps its handle, so that
/// saving writes it back and changes made elsewhere are noticed. Elsewhere, opening reads a copy,
/// and saving downloads one.
///
/// Settings and the keys file live in the browser's storage, and `open_settings` edits both in the
/// page.
if (!("host" in window)) {
    window.host = (() => {
        // From path to `{ handle, file, text }`: the handle, where the browser gave one; a `File`,
        // for a copy read when the handle is not (yet) to hand; and the text, for a file that only
        // lives in the page, as one opened without the API does after the first read.
        const files = new Map();
        let next = 0;

        /// Give the file named `name` a path of its own, holding `entry`.
        const register = (name, entry) => {
            const path = `/${++next}/${name}`;
            files.set(path, entry);
            return path;
        };

        const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

        // What the pickers offer, diagrams first. Every type is `text/plain`, which the API takes
        // where it may refuse a type of Sagitta's own.
        const TYPES = {
            diagram: [{ description: "tikz-cd diagrams", accept: { "text/plain": [".tikzcd"] } }],
            macros: [{ description: "LaTeX", accept: { "text/plain": [".tex", ".sty"] } }],
        };
        /// The extensions of `kind`, as `<input type="file">` takes them.
        const accept = (kind) => Object.values(TYPES[kind][0].accept).flat().join(",");

        const has_api = typeof window.showOpenFilePicker === "function";

        /// What `picker` gives, or `null` if the user dismissed it, which is not a failure.
        const pick = async (picker) => {
            try {
                return await picker();
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") {
                    return null;
                }
                throw error;
            }
        };

        /// Wait for the handle a drop may still be handing over (see `path_of`).
        const settle = async (entry) => {
            if (entry?.pending !== undefined) {
                entry.handle = await entry.pending;
                delete entry.pending;
            }
            return entry;
        };

        /// A file picked with a plain `<input type="file">`, or `null` if the user picked none.
        const pick_with_input = (accept) => new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = accept;
            input.addEventListener("change", () => resolve(input.files[0] ?? null));
            input.addEventListener("cancel", () => resolve(null));
            input.click();
        });

        /// Offer `text` as a download called `name`.
        const download = (name, text) => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        };

        /// Ask for leave to write through `handle`, which a file picked for opening lacks at first.
        const writable = async (handle) => {
            const mode = { mode: "readwrite" };
            if (await handle.queryPermission(mode) !== "granted"
                && await handle.requestPermission(mode) !== "granted"
            ) {
                throw new Error("the browser was not allowed to write it");
            }
        };

        // A drop hands over a `File`, and, in Chromium, a handle to it, but only while the drop
        // event lasts, and the page asks for the file's path (`path_of`) without waiting. So take
        // the handle's promise here, before the page sees the drop, for `path_of` to keep.
        let dropped = null;
        document.addEventListener("drop", (event) => {
            const item = event.dataTransfer.items[0];
            dropped = item !== undefined && typeof item.getAsFileSystemHandle === "function"
                ? item.getAsFileSystemHandle().catch(() => null)
                : null;
        }, true);

        // Watched paths, from path to the time their file last changed, polled as the shell polls.
        const watched = new Map();
        const listeners = [];
        setInterval(async () => {
            if (document.hidden) {
                return;
            }
            for (const [path, previous] of watched) {
                const handle = files.get(path)?.handle;
                if (handle === undefined || handle === null) {
                    continue;
                }
                try {
                    const modified = (await handle.getFile()).lastModified;
                    if (watched.has(path) && modified !== previous) {
                        watched.set(path, modified);
                        if (previous !== null) {
                            listeners.forEach((callback) => callback(path));
                        }
                    }
                } catch (_) {
                    // The file has gone, or the browser has withdrawn access: there is nothing
                    // more to notice.
                }
            }
        }, 1000);

        // Storage can be missing or refuse (in a private window, say); the page then keeps its
        // settings for the visit alone.
        const STORAGE = { settings: "sagitta.settings", keys: "sagitta.keys" };
        const memory = {};
        const load = (key) => {
            try {
                return localStorage.getItem(key);
            } catch (_) {
                return memory[key] ?? null;
            }
        };
        const store = (key, text) => {
            memory[key] = text;
            try {
                localStorage.setItem(key, text);
            } catch (_) {}
        };

        // Whether the diagram has unsaved changes, for the browser to ask before leaving.
        let dirty = false;
        window.addEventListener("beforeunload", (event) => {
            if (dirty) {
                event.preventDefault();
            }
        });

        // The dialog's look, in the page's colours (see `main.css`).
        const style = document.createElement("style");
        style.textContent = `
            .web-settings {
                width: min(48rem, calc(100vw - 2rem));
                padding: 1rem;
                border: 1px solid var(--ui-border);
                border-radius: 4px;
                background: var(--ui-black);
                color: var(--ui-white);
                font: inherit;
            }
            .web-settings::backdrop {
                background: hsla(0, 0%, 0%, 0.5);
            }
            .web-settings label {
                display: block;
                margin-bottom: 1rem;
            }
            .web-settings textarea {
                display: block;
                width: 100%;
                height: 12rem;
                margin-top: 0.25rem;
                padding: 0.5rem;
                border: 1px solid var(--ui-border);
                background: transparent;
                color: inherit;
                font-family: monospace;
                resize: vertical;
            }
            .web-settings textarea:focus {
                outline: 1px solid var(--ui-focus);
            }
            .web-settings div {
                display: flex;
                justify-content: flex-end;
                gap: 0.5rem;
            }
        `;
        document.head.append(style);

        /// Edit the settings and the keys file in the page, which the desktop shell leaves to an
        /// editor. Saving stores both and reloads, since the page reads them as it starts.
        const edit_settings = () => {
            const dialog = document.createElement("dialog");
            dialog.className = "web-settings";
            const field = (label, key, placeholder) => {
                const heading = document.createElement("label");
                heading.textContent = label;
                const area = document.createElement("textarea");
                area.spellcheck = false;
                area.placeholder = placeholder;
                area.value = load(key) ?? "";
                heading.append(area);
                dialog.append(heading);
                return area;
            };
            const settings = field("settings.json", STORAGE.settings, "{}");
            const keys = field("keys", STORAGE.keys, "# bind  ACTION  KEYS\n# unbind  KEYS");
            const buttons = document.createElement("div");
            const button = (text, action) => {
                const element = document.createElement("button");
                element.textContent = text;
                element.addEventListener("click", action);
                buttons.append(element);
            };
            button("Cancel", () => dialog.close());
            button("Save and reload", () => {
                store(STORAGE.settings, settings.value);
                store(STORAGE.keys, keys.value);
                location.reload();
            });
            dialog.append(buttons);
            // The page's own keys must not act on what is typed here. Escape still closes the
            // dialog, which is the browser's doing rather than a listener's.
            for (const type of ["keydown", "keyup"]) {
                dialog.addEventListener(type, (event) => event.stopPropagation());
            }
            dialog.addEventListener("close", () => dialog.remove());
            document.body.append(dialog);
            dialog.showModal();
            settings.focus();
        };

        return {
            // There is no command line. A diagram or macros file comes from a picker or a drop.
            arguments: async () => ({ diagram: null, macros: null }),

            resolve: async (base, file) => {
                if (file.startsWith("/")) {
                    return file;
                }
                const directory = base ?? `/${++next}`;
                return `${directory.replace(/\/$/, "")}/${file}`;
            },

            // The file's contents, or `null` if it does not exist, as for a path the page made up
            // that no file stands behind yet.
            read: async (path) => {
                const entry = await settle(files.get(path));
                if (entry === undefined) {
                    return null;
                }
                if (entry.handle) {
                    return (await entry.handle.getFile()).text();
                }
                if (entry.file) {
                    entry.text = await entry.file.text();
                    delete entry.file;
                }
                return entry.text ?? null;
            },

            write: async (path, text) => {
                let entry = await settle(files.get(path));
                if (!entry?.handle && has_api) {
                    // A path with no file behind it, or a copy: ask where the file goes, and keep
                    // writing there.
                    const handle = await pick(() => window.showSaveFilePicker({
                        suggestedName: basename(path),
                        types: TYPES.diagram,
                    }));
                    if (handle === null) {
                        throw new Error("no file was chosen");
                    }
                    entry = { handle };
                    files.set(path, entry);
                }
                if (entry?.handle) {
                    await writable(entry.handle);
                    const stream = await entry.handle.createWritable();
                    await stream.write(text);
                    await stream.close();
                    return;
                }
                download(basename(path), text);
                files.set(path, { text });
            },

            config_dir: async () => "",
            read_settings: async () => load(STORAGE.settings),
            read_keys: async () => load(STORAGE.keys),
            write_settings: async (text) => store(STORAGE.settings, text),
            open_settings: async () => {
                edit_settings();
                return "";
            },

            // No directory is handed over, so there is no nearest `macros.tex` to find.
            find_up: async () => null,

            open_dialog: async (kind) => {
                if (has_api) {
                    const handles = await pick(() => window.showOpenFilePicker({
                        types: TYPES[kind],
                    }));
                    const [handle] = handles ?? [null];
                    return handle === null ? null : register(handle.name, { handle });
                }
                const file = await pick_with_input(accept(kind));
                return file === null ? null : register(file.name, { file });
            },

            save_dialog: async (default_path) => {
                const name = default_path === null ? "diagram.tikzcd" : basename(default_path);
                if (has_api) {
                    const handle = await pick(() => window.showSaveFilePicker({
                        suggestedName: name,
                        types: TYPES.diagram,
                    }));
                    return handle === null ? null : register(handle.name, { handle });
                }
                const chosen = window.prompt("Download the diagram as", name);
                return chosen === null || chosen.trim() === ""
                    ? null
                    : register(chosen.trim(), {});
            },

            confirm: async (message) => window.confirm(message),

            watch: async (path) => {
                if (!watched.has(path)) {
                    watched.set(path, null);
                }
            },
            unwatch: async (path) => {
                watched.delete(path);
            },

            read_clipboard: () => navigator.clipboard.readText(),
            write_clipboard: (text) => navigator.clipboard.writeText(text),

            set_dirty: (value) => {
                dirty = value;
            },
            // A page cannot close its own tab; `on_save_and_close` never asks it to.
            close: () => {},
            on_changed: (callback) => listeners.push(callback),
            on_save_and_close: () => {},

            path_of: (file) => {
                const pending = dropped;
                dropped = null;
                return register(file.name, pending === null ? { file } : { file, pending });
            },
        };
    })();
}
