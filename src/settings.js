/// The user settings, held as JSON in `~/.config/sagitta/settings.json`, which the shell names
/// and this class is the only writer of. `load` reads the file; every `set` rewrites it in full.
///
/// Which settings there are, and what each may hold, comes from the schema it is given
/// (`src/schema.js`): nothing below names a setting, so another kind of diagram keeps all of this
/// by passing its own table.
class Settings {
    /// `schema` is `{ defaults, ranges, nullable, checks }`, as `src/schema.js` describes.
    constructor(schema) {
        this.schema = schema;

        // The current value of every setting, starting from the schema's defaults.
        this.data = Object.assign({}, schema.defaults);

        // What was wrong with the file, setting by setting, for the mode line (see
        // `UI.report_problems`).
        this.problems = [];

        // Whether `set` may rewrite the file, which it may not while the file is malformed, so
        // that a hand edit gone wrong is not lost.
        this.writable = true;

        // The settings the file holds, which `follow` leaves alone.
        this.saved = new Set();

        // The settings that follow the system (see `follow`), which the file leaves out.
        this.following = new Set();

        // What the file holds that is not a setting here (a typo, or a newer version's setting),
        // kept as it was, so that writing the file does not lose it.
        this.unknown = {};
    }

    /// Read the saved settings over the defaults. A malformed file is ignored, and left alone, and
    /// so is any setting of the wrong kind, or outside what the schema's checks allow.
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
        // Settings the app no longer has are ignored, and the next `set` drops them. Any other
        // name is reported, and kept.
        for (const [setting, value] of Object.entries(saved)) {
            if (Settings.RETIRED.has(setting)) {
                continue;
            }
            if (!Object.hasOwn(this.data, setting)) {
                this.unknown[setting] = value;
                this.problems.push(`unknown setting ${setting}`);
                continue;
            }
            if (this.allows(setting, value)) {
                this.data[setting] = value;
                this.saved.add(setting);
            } else {
                this.problems.push(`${setting} should be ${this.expected(setting)}`);
            }
        }
    }

    /// Returns a saved user setting, or the default value if a setting has not been modified yet.
    get(setting) {
        return this.data[setting];
    }

    /// Whether this is a setting at all, which `:set` asks before anything else.
    has(setting) {
        return Object.hasOwn(this.data, setting);
    }

    /// Every setting's name, for `:set`'s completions and for the file.
    names() {
        return Object.keys(this.data);
    }

    /// Saves a user setting. The file is rewritten as a whole, and the write is not waited on.
    set(setting, value) {
        this.data[setting] = value;
        this.following.delete(setting);
        this.saved.add(setting);
        this.write();
    }

    /// Take `value`, the system's (dark mode from its colour scheme, say), for a setting the file
    /// does not hold, and keep taking it until the setting is set, leaving it out of the file till
    /// then. Returns whether the setting follows the system.
    follow(setting, value) {
        if (this.saved.has(setting)) {
            return false;
        }
        this.data[setting] = value;
        this.following.add(setting);
        return true;
    }

    /// The numbers a numeric setting may be, as `[least, most]`, or `undefined` if it is not one.
    /// The settings layer steps a number within this (see `Layer.Settings.step`).
    range(setting) {
        return this.schema.ranges[setting];
    }

    /// Whether a setting may also be `null`, which the layer shows as never.
    nullable(setting) {
        return this.schema.nullable.has(setting);
    }

    /// The value a string means for a setting, or `undefined` if it means nothing for it. This is
    /// what `:set SETTING VALUE` types the value with (see `Commands.TABLE["set"]`).
    parse(setting, text) {
        const held = this.data[setting];
        if (typeof held === "boolean") {
            return ["true", "on", "yes"].includes(text) ? true
                : ["false", "off", "no"].includes(text) ? false : undefined;
        }
        if (typeof held === "number" || this.nullable(setting)) {
            if (text === "null" && this.nullable(setting)) {
                return null;
            }
            const value = parseFloat(text);
            return Number.isFinite(value) ? value : undefined;
        }
        return text;
    }

    /// Whether a value is one this setting may hold, as `load` asks of the file's.
    allows(setting, value) {
        const [check] = this.schema.checks[setting] ?? [(value) => typeof value === "boolean"];
        const typed = value === null ? this.nullable(setting)
            : typeof value === typeof this.schema.defaults[setting];
        return typed && check(value);
    }

    /// What a setting may be, in words, for the message that refuses a value.
    expected(setting) {
        const [, expected] = this.schema.checks[setting] ?? [null, "true or false"];
        return typeof expected === "function" ? expected() : expected;
    }

    /// Write every setting but those following the system to the file, with whatever it held that
    /// is not a setting, unless it is malformed. Returns the write, to wait on.
    async write() {
        if (this.writable) {
            const data = Object.fromEntries(Object.entries(this.data)
                .filter(([setting]) => !this.following.has(setting)));
            Object.assign(data, this.unknown);
            await host.write_settings(`${JSON.stringify(data, null, 4)}\n`);
        }
    }
}

/// The settings earlier versions had, which a file may still hold. They are ignored, and dropped the
/// next time the file is written.
Settings.RETIRED = new Set([
    "ui.cell_size", "ui.quiver_mode", "ui.spreadsheet_mode", "ui.which_key_delay",
]);
