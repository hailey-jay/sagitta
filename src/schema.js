/// The settings a tikz-cd diagram has, and what each may hold.
///
/// This is the one place that knows the names: `src/settings.js` reads, writes, parses, and checks
/// without naming a single setting, so another kind of diagram supplies its own table here and
/// keeps the file handling, the problem reporting, `:set`, and the settings layer unchanged.
const SETTINGS = {
    /// Every setting, and what it holds until the file says otherwise. A setting's kind is its
    /// default's kind: a boolean flips, a number is stepped and ranged, a string is taken as typed.
    defaults: {
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
        // Whether typing edits the label, spreadsheet-style. Otherwise keys work as in quiver: the
        // command layer's keys are live without `;`, and a label is typed only after RET (see
        // `Keymap.latched`).
        "ui.spreadsheet_mode": false,
        // Whether the canvas is grey, with the default colour drawn in white (see `main.css`).
        "ui.dark_mode": false,
        // The zoom the view starts at, and that `reset-zoom` returns to, in percent.
        "ui.zoom": 100,
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
    },

    /// The numbers a numeric setting may be, as `[least, most]`.
    ranges: {
        "ui.zoom": [20, 200],
        "ui.label_size": [8, 72],
        "ui.which_key_delay": [0, 5000],
    },

    /// The settings that may also be `null`.
    nullable: new Set(["ui.which_key_delay"]),

    /// What each setting that is not true or false may be, as `[check, description]`, where the
    /// description may be a function returning it, for a list that is built elsewhere.
    checks: {
        "diagram.arrow_preset": [
            (value) => Object.hasOwn(Commands.PRESETS, value),
            () => `one of ${Object.keys(Commands.PRESETS).join(", ")}`,
        ],
        "ui.hint_characters": [
            (value) => /^[A-Z0-9]{2,}$/.test(value) && new Set(value).size === value.length,
            "at least two different capital letters or digits",
        ],
    },
};

// A range is a check like any other, so the reader has one thing to ask rather than two.
for (const [setting, [least, most]] of Object.entries(SETTINGS.ranges)) {
    const nullable = SETTINGS.nullable.has(setting);
    SETTINGS.checks[setting] = [
        (value) => nullable && value === null || value >= least && value <= most,
        `a number from ${least} to ${most}${nullable ? ", or null" : ""}`,
    ];
}
