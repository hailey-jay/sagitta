/// The user settings, held as JSON in `~/.config/sagitta/settings.json`, which the shell names
/// and this class is the only writer of. `load` reads the file; every `set` rewrites it in full.
class Settings {
    constructor() {
        this.data = {
            // Whether to wrap the `tikz-cd` output in `\[ \]`.
            "export.centre_diagram": true,
            // Whether to use `\&` instead of `&` for column separators in `tikz-cd` output.
            "export.ampersand_replacement": false,
            // Whether to export diagrams with the `cramped` option.
            "export.cramped": false,
            // Whether to wrap the `tikz-cd` output in a standalone LaTeX document.
            "export.standalone": false,
            // Which variant of the corner to use for pullbacks/pushouts.
            "diagram.var_corner": false,
            // The preset new arrows take (see `Commands.PRESETS` and `Edge.suggested_options`).
            "diagram.arrow_preset": "plain",
            // Whether the canvas is grey, with the default colour drawn in white (see `main.css`).
            "ui.dark_mode": false,
            // The zoom the view starts at, and that `reset-zoom` returns to, in percent.
            "ui.zoom": 100,
            // The width and height of an empty column or row, in pixels, which they grow from.
            "ui.cell_size": 128,
            // The size of the labels, in pixels.
            "ui.label_size": 26,
            // How long the command layer waits for a key before listing its keys, in milliseconds,
            // or `null` to list them only on `?` (see `Keymap.enter`).
            "ui.which_key_delay": 300,
            // Whether the command layer lists only its keys and their values, without what they do.
            "ui.which_key_compact": false,
            // The characters of the codes that select cells, in the order they are given out (see
            // `UI.recode`): the keyboard's home row, then the bottom row, the top, and the digits.
            "ui.hint_characters": "ASDFGHJKLZXCVBNMQWERTYUIOP1234567890",
        };

        // What was wrong with the file, setting by setting, for the mode line (see
        // `UI.report_problems`).
        this.problems = [];

        // Whether `set` may rewrite the file, which it may not while the file is malformed, so
        // that a hand edit gone wrong is not lost.
        this.writable = true;
    }

    /// Read the saved settings over the defaults. A malformed file is ignored, and left alone, and
    /// so is any setting of the wrong kind, or outside what `Settings.CHECKS` allows.
    async load() {
        const text = await host.read_settings();
        if (text === null) {
            return;
        }
        let saved;
        try {
            saved = JSON.parse(text);
        } catch (_) {
            this.problems.push("not valid JSON, so ignored, and left alone until it is fixed");
            this.writable = false;
            return;
        }
        // Settings the app no longer has are ignored, and the next `set` drops them.
        for (const [setting, value] of Object.entries(saved)) {
            if (!Object.hasOwn(this.data, setting)) {
                continue;
            }
            const [check, expected] = Settings.CHECKS[setting]
                ?? [(value) => typeof value === "boolean", "true or false"];
            const typed = value === null ? Settings.NULLABLE.has(setting)
                : typeof value === typeof this.data[setting];
            if (typed && check(value)) {
                this.data[setting] = value;
            } else {
                this.problems.push(`${setting} should be ${
                    typeof expected === "function" ? expected() : expected}`);
            }
        }
    }

    /// Returns a saved user setting, or the default value if a setting has not been modified yet.
    get(setting) {
        return this.data[setting];
    }

    /// Saves a user setting. The file is rewritten as a whole, and the write is not waited on.
    set(setting, value) {
        this.data[setting] = value;
        this.write();
    }

    /// Write every setting to the file, unless it is malformed. Returns the write, to wait on.
    async write() {
        if (this.writable) {
            await host.write_settings(`${JSON.stringify(this.data, null, 4)}\n`);
        }
    }
}

/// The numbers a numeric setting may be, as `[least, most]`.
Settings.RANGES = {
    "ui.zoom": [20, 200],
    "ui.cell_size": [48, 512],
    "ui.label_size": [8, 72],
    "ui.which_key_delay": [0, 5000],
};

/// The settings that may also be `null`.
Settings.NULLABLE = new Set(["ui.which_key_delay"]);

/// What each setting that is not true or false may be, as `[check, description]`, where the
/// description may be a function returning it.
Settings.CHECKS = {
    "diagram.arrow_preset": [
        (value) => Object.hasOwn(Commands.PRESETS, value),
        () => `one of ${Object.keys(Commands.PRESETS).join(", ")}`,
    ],
    "ui.hint_characters": [
        (value) => /^[A-Z0-9]{2,}$/.test(value) && new Set(value).size === value.length,
        "at least two different capital letters or digits",
    ],
};
for (const [setting, [least, most]] of Object.entries(Settings.RANGES)) {
    const nullable = Settings.NULLABLE.has(setting);
    Settings.CHECKS[setting] = [
        (value) => nullable && value === null || value >= least && value <= most,
        `a number from ${least} to ${most}${nullable ? ", or null" : ""}`,
    ];
}
