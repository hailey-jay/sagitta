/// The named bindings: every key a user may rebind, by the name of what it does, with its defaults,
/// and the keys file (`~/.config/sagitta/keys`) that overrides them.
///
/// A name is a named action (see `ModeLine.define_actions`), one of `Bindings.HANDLERS`, or any
/// other command (see `Commands.TABLE`), which a key runs with no arguments. Keys are written as
/// the help shows them: `C-s` and `C-S-z` are chords, `; b` is `b` in the command layer, and
/// `<delete>` or `<f5>` are keys of their own. The keys file is read once, at startup:
///
///     # A line names something, then its keys, replacing the defaults.
///     save        C-s
///     flip        ; e  C-S-f
///     curve       ; k
///     # A name alone unbinds it; `unbind` frees keys from whatever has them.
///     hide-mode-line
///     unbind      C-n
///
/// A key a line binds is taken from whatever had it by default. A line with a problem is skipped
/// whole, and the problems are reported in the mode line.
class Bindings {
    /// The keys of `name`'s notation `text`, as a combination in the form `Keymap.bind` takes,
    /// without its context. Throws an error explaining what is wrong with `text`.
    static parse(text) {
        let rest = text;
        const layer = rest.startsWith(";");
        if (layer) {
            rest = rest.slice(1).trimStart();
        }
        let modifier = false;
        let shift = false;
        // A lone `C-` or `S-` is a key, not a prefix, as in `C--`.
        while (/^[CS]-./u.test(rest)) {
            if (rest[0] === "C") {
                modifier = true;
            } else {
                shift = true;
            }
            rest = rest.slice(2);
        }
        let key = Bindings.NAMED[rest.toLowerCase()] ?? Bindings.NAMED[rest] ?? null;
        if (key === null) {
            if ([...rest].length !== 1) {
                throw new Error(`"${text}" is not a key`);
            }
            key = rest;
        }
        if (/^[a-z]$/i.test(key)) {
            // An upper-case letter is the letter with Shift.
            shift ||= key !== key.toLowerCase();
            key = key.toLowerCase();
        } else if (key.length === 1) {
            if (shift) {
                throw new Error(`"${text}": write the shifted character itself, without S-`);
            }
            // Whatever Shift it takes to type the character on the keyboard at hand.
            shift = null;
        }

        if (Bindings.RESERVED.has(key)) {
            throw new Error(`"${text}": ${Keymap.key_name(key)} keeps its own meaning`);
        }
        if (layer) {
            if (modifier) {
                throw new Error(`"${text}": the command layer's keys take no C-`);
            }
            if (/^[0-9]$/.test(key) || Bindings.LAYER_RESERVED.has(key)) {
                throw new Error(`"${text}": ${key} keeps its own meaning in the command layer`);
            }
        } else if (!modifier && key.length === 1) {
            throw new Error(`"${text}" would type: use "; ${rest}" for the command layer, `
                + `or a chord`);
        }
        return { key, shift, modifier, layer };
    }

    /// What tells combinations apart: two with the same signature are the same keys.
    static signature({ key, shift, modifier, layer }) {
        return `${layer ? ";" : ""}${modifier ? "C-" : ""}${shift ? "S-" : ""}${key.toLowerCase()}`;
    }

    /// When the binding of `combination` to `name` runs while a text field has the focus (see
    /// `Keymap.CONTEXT`): as `Bindings.CONTEXTS` says, and otherwise, for chords, always.
    static context(name, combination) {
        const { Always, Conservative } = Keymap.CONTEXT;
        return Bindings.CONTEXTS[name] ?? (combination.modifier ? Always : Conservative);
    }

    /// Whether `name` is something a key can be bound to.
    static known(name) {
        return Object.hasOwn(Bindings.DEFAULTS, name)
            || Object.hasOwn(Commands.TABLE, Commands.canonical(name));
    }

    /// The words of a line of the keys file, with `; x` joined into one, and comments (from a word
    /// starting with `#`, unless it is the command layer's key) dropped.
    static words(line) {
        const words = [];
        const tokens = line.trim().split(/\s+/).filter((token) => token !== "");
        for (let i = 0; i < tokens.length; ++i) {
            const token = tokens[i];
            if (token === ";") {
                if (i + 1 === tokens.length) {
                    throw new Error("\";\" needs a key after it");
                }
                words.push(`; ${tokens[++i]}`);
            } else if (token.startsWith("#")) {
                break;
            } else {
                words.push(token);
            }
        }
        return words;
    }

    /// The bindings, as `{ keys, problems }`: `keys` maps each name to its combinations, which are
    /// the defaults overridden by the keys file's `text` (or none, if `null`), and `problems` lists
    /// what was wrong with the file, line by line.
    static resolve(text) {
        const keys = new Map();
        // The name each signature is bound to.
        const owners = new Map();
        const bind = (name, combinations) => {
            keys.set(name, combinations);
            for (const combination of combinations) {
                owners.set(Bindings.signature(combination), name);
            }
        };
        // Take the keys with `signature` from whatever has them.
        const free = (signature) => {
            const owner = owners.get(signature);
            if (owner !== undefined) {
                keys.set(owner, keys.get(owner).filter((combination) => {
                    return Bindings.signature(combination) !== signature;
                }));
                owners.delete(signature);
            }
        };
        for (const [name, notations] of Object.entries(Bindings.DEFAULTS)) {
            bind(name, notations.map((notation) => Bindings.parse(notation)));
        }

        const problems = [];
        // The lines that bound each name, and each signature.
        const named = new Map();
        const claimed = new Map();
        for (const [index, line] of (text ?? "").split("\n").entries()) {
            const number = index + 1;
            try {
                const words = Bindings.words(line);
                if (words.length === 0) {
                    continue;
                }
                const [word, ...notations] = words;
                const name = Object.hasOwn(Bindings.DEFAULTS, word) ? word : Commands.canonical(word);
                const combinations = notations.map((notation) => Bindings.parse(notation));
                if (name === "unbind") {
                    for (const combination of combinations) {
                        free(Bindings.signature(combination));
                        claimed.delete(Bindings.signature(combination));
                    }
                    continue;
                }
                if (!Bindings.known(name)) {
                    throw new Error(`nothing is called "${word}"`);
                }
                if (named.has(name)) {
                    throw new Error(`${name} is already bound on line ${named.get(name)}`);
                }
                const signatures = combinations.map((combination) => {
                    return Bindings.signature(combination);
                });
                for (const [i, signature] of signatures.entries()) {
                    const earlier = claimed.get(signature)
                        ?? (signatures.indexOf(signature) < i ? number : null);
                    if (earlier !== null) {
                        throw new Error(`${notations[i]} is already bound on line ${earlier}`);
                    }
                }
                for (const signature of [...owners.keys()]) {
                    if (owners.get(signature) === name) {
                        owners.delete(signature);
                    }
                }
                for (const signature of signatures) {
                    free(signature);
                    claimed.set(signature, number);
                }
                named.set(name, number);
                bind(name, combinations);
            } catch (error) {
                problems.push(`line ${number}: ${error.message}`);
            }
        }

        for (const [name, combinations] of keys) {
            keys.set(name, combinations.map((combination) => ({
                ...combination,
                context: Bindings.context(name, combination),
            })));
        }
        return { keys, problems };
    }
}

/// The keys written by name, by their names in the notation (lower case, except the arrows'
/// glyphs), to `KeyboardEvent.key`. `Keymap.key_name` goes the other way.
Bindings.NAMED = {
    "del": "Backspace",
    "tab": "Tab",
    "ret": "Enter",
    "spc": " ",
    "esc": "Escape",
    "<delete>": "Delete",
    "<insert>": "Insert",
    "<home>": "Home",
    "<end>": "End",
    "<prior>": "PageUp",
    "<next>": "PageDown",
    "<left>": "ArrowLeft",
    "<down>": "ArrowDown",
    "<right>": "ArrowRight",
    "<up>": "ArrowUp",
    "←": "ArrowLeft",
    "↓": "ArrowDown",
    "→": "ArrowRight",
    "↑": "ArrowUp",
};
for (let i = 1; i <= 12; ++i) {
    Bindings.NAMED[`<f${i}>`] = `F${i}`;
}

/// Keys that keep their meaning everywhere (see `Keymap.BINDINGS`), and so cannot be bound.
Bindings.RESERVED = new Set([
    "Backspace", "Tab", "Enter", " ", "Escape", "ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp",
]);

/// Keys that keep their meaning in the command layer (see `Keymap.intercept_layer`), besides the
/// digits, which set numbers.
Bindings.LAYER_RESERVED = new Set([";", ":", "/", "?"]);

/// The default keys of each name. Every named action has an entry, even if it has no keys.
Bindings.DEFAULTS = {
    // Named actions (see `ModeLine.define_actions`).
    "import": ["C-i"],
    "export": ["C-e"],
    "macros": ["C-m"],
    "save": ["C-s"],
    "save-as": ["C-S-s"],
    "open": ["C-o"],
    "new": ["C-n"],
    "undo": ["C-z"],
    "redo": ["C-S-z"],
    "select-all": ["C-a"],
    "select-connected": ["C-S-c"],
    "deselect-all": ["C-S-a"],
    // The flips have no chords, as `C-f` searches and `C-e` exports.
    "reverse": ["; r", "C-r"],
    "flip": ["; f"],
    // The label alignment (`; A`) sets either side directly, so flipping labels needs no key.
    "flip-labels": [],
    // Clearing the diagram has no keys, as one slip would lose it.
    "clear": [],
    "delete": ["<delete>"],
    "flip-hor": [],
    "flip-ver": [],
    "rotate": [],
    "centre-view": ["; z"],
    "zoom-out": ["C--"],
    "zoom-in": ["C-="],
    "reset-zoom": ["C-0"],
    "hide-grid": ["; #"],
    "dark-mode": [],
    "hide-mode-line": ["C-\\"],
    "shortcuts": ["C-/", "<f1>"],
    "settings": ["C-,"],

    // Search, which `/` also opens.
    "search": ["C-f"],

    // The clipboard.
    "copy": ["C-c"],
    "cut": ["C-x"],
    "paste": ["C-v"],

    // The selected arrows' numeric properties, then the components whose styles to list. `curve`
    // sets a loop's radius instead when only loops are selected, so `radius` needs no key of its
    // own. In the layer, capitals act on the label.
    "level": ["; n"],
    "curve": ["; b"],
    "offset": ["; o"],
    "radius": [],
    "length": ["; l"],
    "position": ["; P"],
    "tail": ["; t"],
    "body": ["; d"],
    "head": ["; h"],

    // Edge types, and label alignments: `align` lists them all, each on its own key.
    "arrow": ["; a"],
    "adjunction": ["; j"],
    "corner": ["; p"],
    "align": ["; A"],
    "align-left": [],
    "align-centre": [],
    "align-over": [],

    // Presets (see `Commands.PRESETS`).
    "plain": ["; !"],
    "equals": ["; ="],
    "inclusion": ["; ("],
    "mono": ["; <"],
    "epi": ["; >"],
    "maps-to": ["; |"],
    "dashed": ["; -"],
    "dotted": [],
    "squiggly": ["; ~"],

    // Where an arrow's ends attach, when they attach to arrows.
    "align-source": ["; ["],
    "align-target": ["; ]"],

    // Colours, the selection, and the hint-code prompts.
    "colour": ["; c"],
    "label-colour": ["; C"],
    // Selecting at the focus point has no key here, as Shift-Space does it.
    "select-at-focus": [],
    "toggle-selection": ["; s"],
    "create-arrows": ["; e"],
    "change-source": ["; ,"],
    "change-target": ["; ."],
};

/// The names whose keys run in another context than the default (see `Bindings.context`).
{
    const { Defer, Conservative } = Keymap.CONTEXT;
    Bindings.CONTEXTS = {
        // Within a text field, these act on the text, unless it is left unchanged.
        "undo": Defer,
        "redo": Defer,
        "select-all": Defer,
        "deselect-all": Defer,
        "copy": Defer,
        "cut": Conservative,
        "paste": Conservative,
        // `#` and the prompts' keys switch the hint-code prompts' modes, whose fields drop them.
        "hide-grid": Defer,
        "toggle-selection": Defer,
        "change-source": Defer,
        "change-target": Defer,
    };
}

/// What the names that are neither actions nor commands do, or do differently from their commands,
/// as `{ press, help }`, where `press` takes the UI and the key event, and `help` is the help
/// layer's `[section, description]` for the name's keys outside the command layer.
Bindings.HANDLERS = {
    "copy": { press: (ui) => ui.keys.copy(), help: ["Chords", "copy"] },
    "cut": {
        press: (ui) => {
            ui.keys.copy();
            ui.keys.cut();
        },
        help: ["Chords", "cut"],
    },
    "paste": { press: (ui) => ui.keys.paste(), help: ["Chords", "paste"] },
    "search": { press: (ui) => ui.keymap.search() },
    "select-at-focus": { press: (ui) => ui.keys.toggle_at_focus() },
    "toggle-selection": { press: (ui) => ui.keys.code_prompt("Toggle") },
    // Arrows from the selection to the cells whose codes are typed.
    "create-arrows": {
        press: (ui) => {
            if (ui.selection.size > 0) {
                ui.keymap.leave();
                ui.prompt.open("Create");
            }
        },
    },
    "change-source": { press: (ui) => ui.keys.code_prompt("Source") },
    "change-target": { press: (ui) => ui.keys.code_prompt("Target") },
    // The arrow colour, and the label colour, unless there is nothing to colour, as the indicator
    // beside the label input shows.
    "colour": {
        press: (ui) => {
            if (ui.selection_contains_edge()) {
                ui.keymap.layers.colour.toggle(ColourPicker.TARGET.Edge);
            }
        },
    },
    "label-colour": {
        press: (ui) => {
            const indicator
                = ui.element.query_selector(".label-input-container .colour-indicator");
            if (!indicator.class_list.contains("disabled")) {
                ui.keymap.layers.colour.toggle(ColourPicker.TARGET.Label);
            }
        },
    },
};

// Choosing a property, a component, or the label alignment enters the command layer, if need be,
// which then takes the number, or the key choosing a style or an alignment.
for (const [name, property] of [
    ["level", "level"], ["curve", "curve"], ["offset", "offset"], ["radius", "radius"],
    ["length", "length"], ["position", "label_position"],
]) {
    Bindings.HANDLERS[name] = { press: (ui) => ui.keymap.choose_property(property) };
}
for (const component of ["tail", "body", "head", "align"]) {
    Bindings.HANDLERS[component] = { press: (ui) => ui.keymap.choose_component(component) };
}
// Unlike their commands, these quietly do nothing without an arrow selected.
for (const [name, type] of [["arrow", "arrow"], ["adjunction", "adjunction"], ["corner", null]]) {
    Bindings.HANDLERS[name] = {
        press: (ui) => {
            if (!ui.selection_contains_edge()) {
                return;
            }
            ui.keymap.unchoose();
            if (type === null) {
                ui.arrow_options.toggle_corner(ui);
            } else {
                ui.arrow_options.set_edge_type(ui, type);
            }
            ui.keymap.render();
        },
    };
}
for (const alignment of ["left", "centre", "over"]) {
    Bindings.HANDLERS[`align-${alignment}`] = {
        press: (ui) => {
            if (ui.selection_contains_edge()) {
                ui.arrow_options.set_label_alignment(ui, alignment);
                ui.keymap.render();
            }
        },
    };
}
