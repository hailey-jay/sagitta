/// The type-through keymap.
///
/// quiver's stock bindings put a command on nearly every bare letter, so a label can only be typed
/// after pressing Enter. This inverts that, spreadsheet-style:
///
/// - Base layer: printable keys edit the label of the targeted cell (replacing it); Enter edits in
///   place (appending); Backspace clears the label; `/` searches; `:` opens the command line; `;`
///   enters the command layer. Arrows, Tab, Space, Escape, Delete, and modifier
///   chords are unchanged.
/// - Command layer (`;`, sticky): every stock bare-key binding (`R`, `K`, `D`, `S`, `G`, ...) is
///   live. After focusing a slider (`K`, `O`, `L`, ...), typing a signed number and pressing Enter
///   sets it. Punctuation applies arrow presets. `;`, Escape, or Enter (with no pending number)
///   leave the layer.
/// - Command line (`:`): named commands, with Tab completion, separated by `;`.
/// - Import layer (`C-i`): pasting tikz-cd (`C-v`) replaces the diagram, as one undo step, and
///   lists any problems parsing it.
/// - Macros layer (`C-m`): pasting LaTeX definitions (`C-v`) replaces the macros and colours, which
///   the layer lists; `f` follows another macros file (see
///   `DiagramFile`), and `r` reloads it.
/// - Help layer (`C-/`): the base layer's bindings, how to enter the other layers, and the chords,
///   described by the bindings and actions themselves (see `Layer.Help`).
/// - Export layer (`C-e`): the diagram's tikz-cd encoding as an object, whose options are toggled
///   and stepped by key, and which `y` or Enter copies to the clipboard.
/// - Settings layer (`C-,`): the settings, each on a key, changed as the command layer's options
///   are.
/// - Colour layer (`; c` for arrows, `; C` for labels): the selection's colour as an object, whose
///   hue, saturation, and lightness are stepped by key, and whose palettes' colours are picked by
///   key.
///
/// Every key press goes through `dispatch`: first to the layers (`intercept`), then to the bindings
/// (`Keymap.BINDINGS`, and the named bindings, `keys`, which the keys file can change; see
/// `Bindings`), and last, if nothing claimed it, to type-through (`after`). A binding marked `layer`
/// is one of the command layer's keys, and only runs there.
///
/// The command layer is handled here. The other layers are classes in `src/layers.js`, the prompts
/// are `src/prompt.js`, the commands they run are `src/commands.js`, and what the base layer's
/// editing keys do is `src/keys.js`.
class Keymap {
    constructor(ui) {
        this.ui = ui;

        // The bindings, by lower-case key (see `bind`).
        this.bindings = new Map();

        // The named bindings' keys, by name, and what was wrong with the keys file (see
        // `Bindings.resolve`). Until `load`, the defaults.
        ({ keys: this.keys, problems: this.problems } = Bindings.resolve(null));

        // Whether the command layer is active.
        this.active = false;

        // The layers that take over the keys (see `layers.js`), and the one that has them, or
        // `null`. The colour layer is not held here: it is active while the colour picker has a
        // target (see `current_layer`).
        this.layers = {
            import: new Layer.Import(this),
            macros: new Layer.Macros(this),
            help: new Layer.Help(this),
            export: new Layer.Export(this),
            settings: new Layer.Settings(this),
            colour: new Layer.Colour(this),
        };
        this.layer = null;

        // The number being typed for the command layer's chosen property.
        this.count = "";

        // The numeric property the command layer is setting (see `ArrowOptions.PROPERTIES`), and
        // which of its values, for `length`, which has two. `null` when none is chosen.
        this.property = null;
        this.thumb = 0;

        // The arrow component (`tail`, `body`, or `head`) whose styles the command layer is
        // listing, or `null`.
        this.component = null;

        // Whether Shift is held, which shortens both ends of an arrow together.
        this.symmetric = false;

        // The list of the command layer's bindings, shown while it is active, once it has waited
        // `ui.which_key_delay` for a key (see `enter`), and the timeout ending the wait.
        this.which_key = null;
        this.listed = false;
        this.list_timeout = null;
    }

    /// Read the keys file over the default bindings. The problems with it are reported once the
    /// mode line is up (see `UI.report_problems`).
    async load() {
        ({ keys: this.keys, problems: this.problems } = Bindings.resolve(await host.read_keys()));
    }

    initialise() {
        const ui = this.ui;

        this.which_key = this.build_which_key().add_to(ui.element);

        // Every named action is also a command, and has a named binding, if only to no keys.
        for (const name of ui.mode_line.actions.keys()) {
            if (!Object.hasOwn(Bindings.DEFAULTS, name)) {
                console.error(`the action "${name}" is missing from Bindings.DEFAULTS`);
            }
            if (!Object.hasOwn(Commands.TABLE, name)) {
                Commands.TABLE[name] = {
                    run: ({ ui }) => {
                        if (!ui.mode_line.run(ui, name)) {
                            throw new Error(`"${name}" is not available right now.`);
                        }
                    },
                };
            }
        }

        for (const { combinations, press, release = null } of Keymap.BINDINGS) {
            this.bind(combinations, (event) => press(ui, event),
                release !== null ? (event) => release(ui, event) : null);
        }
        // A named binding runs its action, its handler, or else its command.
        for (const [name, combinations] of this.keys) {
            const handler = Bindings.HANDLERS[name];
            if (ui.mode_line.actions.has(name)) {
                this.bind(combinations, () => ui.mode_line.run(ui, name));
            } else if (handler !== undefined) {
                this.bind(combinations, (event) => handler.press(ui, event));
            } else {
                this.bind(combinations, () => ui.commands.run(name));
            }
        }
        for (const type of ["keydown", "keyup"]) {
            document.addEventListener(type, (event) => this.dispatch(type, event));
        }

        ui.prompt.initialise();

        // Focusing a text input (e.g. by pressing Tab to label a queued cell) returns to typing.
        document.addEventListener("focusin", () => {
            if (this.active && ui.input_is_active()) {
                this.leave();
            }
            if (this.layer !== null && ui.input_is_active()) {
                this.leave_layer(this.layer);
            }
        });
    }

    /// The keys of the named binding `name`, as combinations (see `bind`).
    combinations(name) {
        return this.keys.get(name) ?? [];
    }

    /// The Emacs-style names of the keys of the named binding `name`, or of those of them that
    /// `filter` keeps.
    describe_name(name, filter = () => true) {
        return Keymap.describe(this.combinations(name).filter(filter));
    }

    /// Bind `press` (and `release`, if any, to the key coming up) to each of `combinations`:
    /// `{ key, shift, modifier, context, layer }`. `shift` and `modifier` (Control or Command) must
    /// match, unless `null`, and default to `false`; `context` (see `Keymap.CONTEXT`) says whether
    /// the binding runs while a text field has the focus; and `layer` marks one of the command
    /// layer's keys. A `press` returning `true` stops any later bindings of the key.
    bind(combinations, press, release = null) {
        for (const combination of combinations) {
            const key = combination.key.toLowerCase();
            if (!this.bindings.has(key)) {
                this.bindings.set(key, []);
            }
            this.bindings.get(key).push({
                shift: combination.shift !== null ? (combination.shift || false) : null,
                modifier: combination.modifier !== null ? (combination.modifier || false) : null,
                context: combination.context || Keymap.CONTEXT.Conservative,
                layer: combination.layer || false,
                press,
                release,
            });
        }
    }

    /// Whether the command layer's bindings may run: while it is active and no text field has the
    /// keys, and in the hint-code prompts, which switch between their modes with them.
    layer_live() {
        if (this.ui.in_mode(UIMode.Command)) {
            return true;
        }
        return this.active && !this.ui.input_is_active();
    }

    /// Handle a key press or release (`type` is `keydown` or `keyup`). A key pressed while the
    /// command layer waits to list its keys ends the wait, unless it leaves something to finish.
    dispatch(type, event) {
        const waiting = type === "keydown" && this.active && !this.listed
            && !Keymap.MODIFIERS.has(event.key);
        this.handle(type, event);
        if (waiting && this.active && !this.listed) {
            this.wait_to_list(this.property !== null || this.component !== null);
        }
    }

    /// Handle a key press or release, as `dispatch` says.
    handle(type, event) {
        const ui = this.ui;
        // The layers may claim the key outright (e.g. `;` entering the command layer).
        if (type === "keydown" && this.intercept(event)) {
            event.preventDefault();
            return;
        }

        const editing_input = ui.input_is_active();
        const key = event.key.toLowerCase();
        for (const binding of this.bindings.get(key) ?? []) {
            if (binding.layer && !this.layer_live()) {
                continue;
            }
            const matches = (binding.shift === null || event.shiftKey === binding.shift
                // Shift's own binding matches on its release, when it is no longer held.
                || key === "shift" && event.shiftKey === (type === "keydown"))
                && (binding.modifier === null
                    || (event.metaKey || event.ctrlKey) === binding.modifier
                    || ["control", "meta"].includes(key));
            if (!matches) {
                continue;
            }
            const run = type === "keydown" ? binding.press : binding.release;
            if (!editing_input || binding.context === Keymap.CONTEXT.Always) {
                event.preventDefault();
                if (run !== null && run(event)) {
                    break;
                }
            } else if (type === "keydown") {
                // A text field has the key. If the key left it unchanged, a `Defer` binding runs
                // after all; otherwise the field flashes, to show that it took the key.
                const input = document.activeElement;
                const [value, selectionStart, selectionEnd]
                    = [input.value, input.selectionStart, input.selectionEnd];
                setTimeout(() => {
                    if (input.value === value
                        && input.selectionStart === selectionStart
                        && input.selectionEnd === selectionEnd
                    ) {
                        if (binding.context === Keymap.CONTEXT.Defer) {
                            run(event);
                        } else {
                            Keymap.flash(new DOM.Element(input));
                        }
                    }
                }, 8);
            }
        }

        // A printable key that nothing claimed edits a label.
        if (type === "keydown") {
            this.after(event);
        }
    }

    /// The Emacs-style name of `key` (e.g. `RET`, `a`), which `Bindings.parse` reads back.
    static key_name(key) {
        const names = { Shift: "Shift", Control: "Ctrl", Alt: "Alt" };
        for (const [name, value] of Object.entries(Bindings.NAMED)) {
            // The arrows' glyphs come last, and win.
            names[value] = /^[a-z]+$/.test(name) ? name.toUpperCase() : name;
        }
        return names[key] || (/^[a-z]$/i.test(key) ? key.toLowerCase() : key);
    }

    /// The Emacs-style names of `combinations`, those of the command layer prefixed with `;`
    /// (e.g. `; r, C-r`).
    /// A shifted letter in the command layer is written as the capital (e.g. `; F`).
    static describe(combinations) {
        return combinations.map((combination) => {
            const name = Keymap.key_name(combination.key);
            if (combination.layer && combination.shift && /^[a-z]$/.test(name)) {
                return `; ${name.toUpperCase()}`;
            }
            return `${combination.layer ? "; " : ""}${combination.modifier ? "C-" : ""}${
                combination.shift ? "S-" : ""}${name}`;
        }).join(", ");
    }

    /// A key press for the first key of `notation`, as the key lists show it (e.g. `RET`, `C-v`,
    /// `F`, or `r, x`), or `null` if it names no key. `shift` adds Shift, as a Shift-click does.
    static event_for(notation, shift = false) {
        let rest = notation.trim().split(/\s+/)[0] ?? "";
        if ([...rest].length > 1) {
            rest = rest.replace(/,$/, "");
        }
        let ctrlKey = false;
        let shiftKey = shift;
        while (/^[CS]-./u.test(rest)) {
            if (rest[0] === "C") {
                ctrlKey = true;
            } else {
                shiftKey = true;
            }
            rest = rest.slice(2);
        }
        const key = Bindings.NAMED[rest.toLowerCase()] ?? Bindings.NAMED[rest] ?? rest;
        if ([...key].length !== 1 && !Object.values(Bindings.NAMED).includes(key)) {
            return null;
        }
        shiftKey ||= /^[A-Z]$/.test(key);
        return new KeyboardEvent("keydown", { key, ctrlKey, shiftKey, cancelable: true });
    }

    /// Replay the "flash" animation on `element`, to show that it took a key.
    static flash(element) {
        element.class_list.remove("flash");
        // Removing a class and adding it straight back is ignored, unless a reflow comes between.
        void element.element.offsetWidth;
        element.class_list.add("flash");
    }

    /// Handle a key press before the bindings see it. Returns whether it was consumed.
    intercept(event) {
        const ui = this.ui;
        // Pasting in the import layer imports the clipboard's tikz-cd, and in the macros layer,
        // loads its definitions, rather than pasting copied cells.
        if (this.pasting() && !ui.input_is_active()
            && event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "v"
        ) {
            this.paste();
            return true;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }
        if (ui.in_mode(UIMode.Command)) {
            return ui.prompt.intercept(event);
        }
        const layer = this.current_layer();
        if (layer !== null) {
            return layer.intercept(event);
        }
        if (this.active) {
            return this.intercept_layer(event);
        }
        if (!ui.in_mode(UIMode.Default) || ui.input_is_active()) {
            return false;
        }
        switch (event.key) {
            case ";":
                this.enter();
                return true;
            case ":":
                this.ui.prompt.open("Command");
                return true;
            case "/":
                this.ui.prompt.open("Search");
                return true;
            case "Backspace":
                if (this.edit_target(false)) {
                    this.begin_edit("");
                }
                return true;
        }
        return false;
    }

    /// Type-through: a printable key that no binding claimed replaces the targeted cell's label,
    /// or, for an opening delimiter, wraps it (bringing the closing one, if it was empty).
    after(event) {
        const ui = this.ui;
        if (this.active || event.defaultPrevented
            || event.ctrlKey || event.metaKey || event.altKey
            || [...event.key].length !== 1 || Keymap.BASE_KEYS.has(event.key)
            || !ui.in_mode(UIMode.Default) || ui.input_is_active()
        ) {
            return;
        }
        if (this.edit_target(true)) {
            event.preventDefault();
            // An empty label gets the pair, with the caret between.
            const label = ui.label_input.element.value;
            if (Object.hasOwn(Delimiters.PLAIN, event.key)) {
                this.begin_edit(Delimiters.wrap(label, event.key), label === "" ? 1 : null);
            } else {
                this.begin_edit(event.key);
            }
        }
    }

    /// Select the cell that typing should edit. With the focus point visible, that is the cell
    /// under it (created, if `create`, when there is none); otherwise it is the selection. Returns
    /// whether there is anything to edit.
    edit_target(create) {
        const ui = this.ui;
        if (ui.focus_point.class_list.contains("focused")) {
            const cell = ui.cell_under_focus_point();
            if (cell !== null) {
                if (!ui.selection.has(cell)) {
                    ui.deselect();
                    ui.select(cell);
                }
            } else if (create) {
                ui.focus_point.class_list.remove("revealed");
                ui.deselect();
                const vertex = new Vertex(ui, "", ui.focus_position);
                ui.select(vertex);
                ui.history.add(ui, [{ kind: "create", cells: new Set([vertex]) }]);
            }
        }
        return ui.selection.size > 0;
    }

    /// Focus the label input with the caret at `caret` (by default, the end), first replacing its
    /// contents with `text` unless `text` is `null`.
    begin_edit(text = null, caret = null) {
        const ui = this.ui;
        const input = ui.label_input.element;
        this.unchoose();
        input.focus();
        if (text !== null) {
            input.value = text;
            input.dispatchEvent(new Event("input"));
        }
        caret ??= input.value.length;
        input.setSelectionRange(caret, caret);
    }

    /// Open the search prompt, from whatever state the UI is in.
    search() {
        this.settle();
        this.ui.prompt.open("Search");
        this.render();
    }

    /// Run what clicking `entry`, a line of the key list, would: its key, through `dispatch`, so
    /// that a click does exactly what the key does, rebound or not. Shift-click adds Shift.
    click_entry(entry, event) {
        const kbd = entry.query_selector("kbd");
        const press = kbd !== null ? Keymap.event_for(kbd.element.textContent, event.shiftKey)
            : null;
        if (press !== null) {
            this.dispatch("keydown", press);
            this.render();
        }
    }

    /// Step the selected arrows' numeric `property` by `delta`, as the arrow keys do once it is
    /// chosen, choosing it first. For the sliders' buttons in the key list.
    nudge(property, delta) {
        if (!this.ui.selection_contains_edge()) {
            return;
        }
        property = this.slider_property(property);
        if (this.property !== property) {
            this.property = property;
            this.thumb = 0;
            this.component = null;
        }
        this.count = "";
        this.step_property(delta);
    }

    /// The command layer.

    /// Enter the command layer. Its keys are listed once it has waited `ui.which_key_delay` for one
    /// (so that a key typed straight after `;` need not flash the list up), never if that is
    /// `null`, until `?`, and at once if `list`, as for the pointer.
    enter(list = false) {
        const ui = this.ui;
        this.active = true;
        this.count = "";
        this.listed = list || ui.settings.get("ui.which_key_delay") === 0;
        this.wait_to_list(!this.listed);
        ui.cancel_creation();
        this.render();
    }

    /// Stop waiting to list the command layer's keys, then, if `again`, wait afresh: after a key
    /// that chose a list or a slider, so that a pause there lists the keys, but not after one that
    /// did what it does, so that typing `; (` does not bring the list up behind it.
    wait_to_list(again) {
        const wait = this.ui.settings.get("ui.which_key_delay");
        clearTimeout(this.list_timeout);
        if (again && wait !== null) {
            this.list_timeout = setTimeout(() => {
                this.listed = true;
                this.render();
            }, wait);
        }
    }

    leave() {
        this.active = false;
        this.count = "";
        clearTimeout(this.list_timeout);
        this.render();
    }

    /// Show the command layer's list of keys, or hide it, for `?`.
    toggle_list() {
        clearTimeout(this.list_timeout);
        this.listed = !this.listed;
        this.render();
    }

    /// Forget the property or arrow component the layer was setting.
    unchoose() {
        this.property = null;
        this.thumb = 0;
        this.component = null;
        this.count = "";
    }

    /// Reflect the command layer's state in the mode line (which updates the key list).
    render() {
        this.ui.mode_line.update(this.ui);
    }

    /// Show the key list while the command layer is active, with the current values of what the
    /// bindings change, hiding the arrow bindings unless an arrow is selected, and dimming
    /// the others that do not apply to the selection. While an arrow component's list is focused
    /// (after `t`, `d`, `h`, or `A`), show its options instead, and in the other layers, theirs.
    update_which_key() {
        const ui = this.ui;
        const layer = this.current_layer();
        const shown = this.active && this.listed || layer !== null;
        this.which_key.class_list.toggle("hidden", !shown);
        // Lines that describe keys rather than being them (the help's) get room to be read.
        this.which_key.class_list.toggle("descriptive", layer !== null && !layer.clickable);
        if (!shown) {
            return;
        }
        const edges = ui.selection_contains_edge();
        // Arrow bindings are only listed while an arrow is selected, to save space.
        this.which_key.class_list.toggle("no-edge", !edges);
        this.which_key.class_list.toggle("no-selection", ui.selection.size === 0);
        // The compact list shows only the keys and their values, and what each does on hovering.
        const compact = ui.settings.get("ui.which_key_compact");
        this.which_key.class_list.toggle("compact", compact);
        for (const entry of this.which_key.query_selector_all(".main .entry")) {
            if (compact) {
                entry.set_attributes({ title: entry.query_selector("kbd + span").element.textContent });
            } else {
                entry.remove_attributes("title");
            }
        }

        const options = ui.arrow_options;
        for (const entry of this.which_key.query_selector_all(".main .entry[data-value]")) {
            const [kind, name] = entry.get_attribute("data-value").split(":");
            let value = "";
            let current = false;
            if (edges) {
                switch (kind) {
                    case "slider":
                        const values = options.value(ui, this.slider_property(name));
                        if (values !== null) {
                            value = Array.isArray(values) ? values.join(",") : `${values}`;
                        }
                        break;
                    case "style":
                        value = ArrowOptions.style_title(name, options.style(ui, name));
                        break;
                    case "endpoint":
                        // Only arrows whose source (or target) is an arrow have the option.
                        const attached = options.endpoint(ui, name);
                        if (attached !== null) {
                            value = attached ? "centre" : "midpoint";
                        }
                        break;
                    case "edge-type":
                        current = name.split("|").includes(options.edge_type(ui));
                        break;
                    case "label_alignment":
                        current = name.split("|").includes(options.label_alignment(ui));
                        break;
                    case "alignment":
                        value = options.label_alignment(ui) ?? "";
                        break;
                }
            }
            entry.query_selector(".value").clear().add(value);
            entry.class_list.toggle("current", current);
        }

        // Groups of bindings replacing the main list: `[[title, [key, description, current,
        // value, swatch, steps]]]`, or `null`, where `swatch` is a colour to show, and `steps`
        // what the line's `−` and `+` buttons step (see `step`).
        let submenu_groups = null;
        // Whether clicking a line presses its key.
        const clickable = layer === null || layer.clickable;
        if (layer !== null) {
            submenu_groups = layer.groups();
        } else if (this.component !== null) {
            submenu_groups = [[
                `${Keymap.CHOICE_TITLES[this.component] ?? this.component} (again to cancel)`,
                this.choices(this.component).map(([key, title, current]) => [key, title, current]),
            ]];
        }

        this.which_key.query_selector(".main")
            .class_list.toggle("hidden", submenu_groups !== null);
        const submenu = this.which_key.query_selector(".submenu").clear();
        submenu.class_list.toggle("hidden", submenu_groups === null);
        for (const [title, entries] of submenu_groups || []) {
            const group = new DOM.Div({ class: "group" })
                .add(new DOM.Element("h3").add(title))
                .add_to(submenu);
            for (const [key, description, current = false, value = "", swatch = null, steps = null]
                of entries) {
                const entry = new DOM.Div({ class: `entry${current ? " current" : ""}${
                    clickable && key !== "" ? " clickable" : ""}` })
                    .add(new DOM.Element("kbd").add(key))
                    .add_to(group);
                if (swatch !== null) {
                    entry.add(new DOM.Element("i", { class: "swatch" }, {
                        background: swatch.css(),
                    }));
                }
                entry
                    .add(new DOM.Element("span").add(description))
                    .add(new DOM.Element("span", { class: "value" }).add(value));
                if (steps !== null) {
                    Keymap.add_steps(entry.set_attributes({ "data-value": steps }));
                }
            }
        }
    }

    /// The command layer's name for the mode line, and its detail, or `null`: `;`, or with a list
    /// open, its name (e.g. `; ALIGN`), and with a property chosen, the property's name, with the
    /// number typed so far (e.g. `; LENGTH`, `(end) 12_`).
    describe_layer() {
        if (this.component !== null) {
            return [`; ${this.component.toUpperCase()}`, null];
        }
        if (this.property === null) {
            return [";", null];
        }
        const name = this.property.replace(/^label_/, "").toUpperCase();
        const end = ArrowOptions.PROPERTIES[this.property].thumbs > 1
            ? `(${this.thumb === 0 ? "start" : "end"}) ` : "";
        return [`; ${name}`, `${end}${this.count}_`];
    }

    /// The list of the command layer's bindings (see `Keymap.WHICH_KEY`), and a submenu for the
    /// options of a focused arrow component. Bindings also available as chords list those, and
    /// those with no key in the command layer are left out. Clicking a line presses its key, and
    /// the sliders have buttons stepping them, for the pointer.
    build_which_key() {
        const which_key = new DOM.Div({ class: "which-key hidden" })
            // Keep presses from the canvas, which would deselect, and keep the focus where it is.
            .listen("pointerdown", (event) => {
                event.stopPropagation();
                event.preventDefault();
            })
            .listen("click", (event) => {
                const step = event.target.closest("button[data-step]");
                const entry = event.target.closest(".entry.clickable");
                if (step !== null) {
                    const [kind, property] = step.closest(".entry").dataset.value.split(":");
                    if (kind === "alignment") {
                        this.step_alignment(Number(step.dataset.step));
                    } else if (kind === "setting") {
                        this.layers.settings.step(property, Number(step.dataset.step));
                    } else {
                        this.nudge(property, Number(step.dataset.step));
                    }
                } else if (entry !== null) {
                    this.click_entry(new DOM.Element(entry), event);
                }
            });
        const main = new DOM.Div({ class: "main" }).add_to(which_key);
        new DOM.Div({ class: "submenu hidden" }).add_to(which_key);
        for (const [title, entries] of Keymap.WHICH_KEY) {
            // Groups of arrow bindings are hidden with them.
            const arrows = entries.every(([, , needs = null]) => needs === "edge");
            const group = new DOM.Div({ class: `group${arrows ? " needs-edge" : ""}` })
                .add(new DOM.Element("h3").add(title));
            for (const [name, description, needs = null, value = null] of entries) {
                const key = Keymap.FIXED_KEYS[name]
                    ?? this.describe_name(name, ({ layer }) => layer).replace(/; /g, "");
                if (key === "") {
                    continue;
                }
                const chords = Object.hasOwn(Keymap.FIXED_KEYS, name)
                    ? "" : this.describe_name(name, ({ modifier }) => modifier);
                const entry = new DOM.Div({
                    class: `entry clickable${needs !== null ? ` needs-${needs}` : ""}`,
                })
                    .add(new DOM.Element("kbd").add(key))
                    .add(new DOM.Element("span").add(description))
                    .add(new DOM.Element("kbd", { class: "chord" }).add(chords))
                    .add(new DOM.Element("span", { class: "value" }))
                    .add_to(group);
                if (value !== null) {
                    entry.set_attributes({ "data-value": value });
                }
                if (value !== null && /^(slider|alignment):/.test(value)) {
                    Keymap.add_steps(entry);
                }
            }
            if (group.query_selector(".entry") !== null) {
                group.add_to(main);
            }
        }
        return which_key;
    }

    /// Add `−` and `+` buttons to `entry`, a line of the key list, stepping what its `data-value`
    /// names (see `build_which_key`).
    static add_steps(entry) {
        const steps = new DOM.Element("span", { class: "steps" }).add_to(entry);
        for (const [step, glyph] of [[-1, "−"], [1, "+"]]) {
            steps.add(new DOM.Element("button", {
                "data-step": `${step}`,
                title: step < 0 ? "less (or ←)" : "more (or →)",
            }).add(glyph));
        }
    }

    intercept_layer(event) {
        const ui = this.ui;
        // Let modes entered from the layer handle their own keys.
        if (!ui.in_mode(UIMode.Default)) {
            return false;
        }

        const key = event.key;

        if (this.property !== null && (/^[0-9]$/.test(key) || key === "-" && this.count === "")) {
            this.count += key;
            this.render();
            return true;
        }
        if (key === "Backspace" && this.property !== null) {
            // Never fall through to deleting while a number is being typed.
            this.count = this.count.slice(0, -1);
            this.render();
            return true;
        }
        // A choice's key makes it, while a component's list is open. The key that opened the list
        // still closes it, even if rebound to one of its choices' keys.
        if (this.component !== null && !this.opens(this.component, event)) {
            const choice = this.choices(this.component).find(([choice_key]) => choice_key === key);
            if (choice !== undefined) {
                if (ui.selection_contains_edge()) {
                    choice[3]();
                    this.component = null;
                    this.render();
                }
                return true;
            }
        }

        switch (key) {
            case "Escape":
            case ";":
                this.unchoose();
                ui.colour_picker.close();
                this.leave();
                return true;
            case "Enter":
                if (this.count !== "") {
                    this.apply_count();
                } else {
                    this.unchoose();
                    this.leave();
                }
                return true;
            case "Backspace":
                ui.mode_line.run(ui, "delete");
                return true;
            case "/":
                // Search, as outside the layer.
                this.leave();
                this.ui.prompt.open("Search");
                return true;
            case ":":
                this.leave();
                this.ui.prompt.open("Command");
                return true;
            case "?":
                this.toggle_list();
                return true;
        }

        // Any other key abandons a half-typed number, and falls through to the bindings, which
        // hold the layer's named keys (see `Bindings`).
        this.count = "";
        delay(() => this.render());
        return false;
    }

    /// Choose the selected arrows' numeric `property` to set, entering the layer if need be, or
    /// step to its next value, or let go of it.
    choose_property(property) {
        if (!this.ui.selection_contains_edge()) {
            return;
        }
        property = this.slider_property(property);
        if (!this.active) {
            this.enter();
        }
        const thumbs = ArrowOptions.PROPERTIES[property].thumbs;
        this.count = "";
        this.component = null;
        if (this.property === property && this.thumb + 1 < thumbs) {
            // The same key steps through a property's values before letting go of it.
            ++this.thumb;
        } else {
            this.property = this.property === property ? null : property;
            this.thumb = 0;
        }
        this.render();
    }

    /// The property a slider's key sets for the selection: a loop's radius in place of the curve
    /// it does not take, while only loops are selected, as the arrow keys do.
    slider_property(property) {
        const edges = ArrowOptions.edges(this.ui);
        return property === "curve" && edges.length > 0 && edges.every((edge) => edge.is_loop())
            ? "radius" : property;
    }

    /// What the list of `component` (`tail`, `body`, `head`, or `align`, the label alignment)
    /// chooses between, as `[key, title, current, choose]` (see `Keymap.CHOICE_KEYS`).
    choices(component) {
        const ui = this.ui;
        const options = ui.arrow_options;
        const keys = Keymap.CHOICE_KEYS[component];
        if (component === "align") {
            const current = options.label_alignment(ui);
            return Keymap.ALIGNMENTS.map(([value, title]) => [
                keys[value], title, value === current,
                () => options.set_label_alignment(ui, value),
            ]);
        }
        const current = options.style(ui, component);
        return ArrowOptions.STYLES[component].map(([value, title, data]) => [
            keys[value], title, value === current, () => {
                ui.commands.ensure_arrow();
                options.set_style(ui, component, data);
            },
        ]);
    }

    /// Whether the key press `event` is one of the command layer's keys for `component`.
    opens(component, event) {
        return this.combinations(component).some(({ key, shift, layer }) => layer
            && key === event.key.toLowerCase() && (shift === null || shift === event.shiftKey));
    }

    /// List the choices of the selected arrows' `component` (see `choices`), entering the layer if
    /// need be, or stop listing them.
    choose_component(component) {
        if (!this.ui.selection_contains_edge()) {
            return;
        }
        if (!this.active) {
            this.enter();
        }
        this.property = null;
        this.count = "";
        this.component = this.component === component ? null : component;
        this.render();
    }

    /// Set the chosen property to the typed number, and let go of it, so that pressing its key
    /// again chooses it afresh rather than stepping to its next value.
    apply_count() {
        const value = Number(this.count);
        const property = this.property;
        this.count = "";
        if (property !== null && Number.isFinite(value)) {
            this.set_property(property, value);
        }
        this.unchoose();
        this.render();
    }

    /// Set the chosen property's chosen value, keeping the others where they are. While Shift is
    /// held, an arrow's two ends are shortened together.
    set_property(property, value) {
        const ui = this.ui;
        const { thumbs, default: fallback } = ArrowOptions.PROPERTIES[property];
        if (thumbs === 1) {
            ui.arrow_options.set(ui, property, [value]);
            return;
        }
        const values = Array.from(ui.arrow_options.value(ui, property) ?? fallback);
        values[this.thumb] = value;
        if (this.symmetric) {
            values[1 - this.thumb] = ArrowOptions.PROPERTIES[property].max - value;
        }
        ui.arrow_options.set(ui, property, values);
    }

    /// Step the selected arrows' label alignment by `delta` through `Keymap.ALIGNMENTS`, wrapping
    /// around, from the first if they disagree. For the alignment's buttons, and the arrow keys
    /// while its list is open.
    step_alignment(delta) {
        const ui = this.ui;
        if (!ui.selection_contains_edge()) {
            return;
        }
        const values = Keymap.ALIGNMENTS.map(([value]) => value);
        const index = values.indexOf(ui.arrow_options.label_alignment(ui));
        ui.arrow_options.set_label_alignment(
            ui, values[index === -1 ? 0 : mod(index + delta, values.length)]);
        this.render();
    }

    /// Step the chosen property, or the label alignment while its list is open, by `delta`, for the
    /// arrow keys. Returns whether either was chosen.
    step_property(delta) {
        if (this.component === "align") {
            if (delta !== 0) {
                this.step_alignment(delta);
            }
            return true;
        }
        if (this.property === null) {
            return false;
        }
        const { step } = ArrowOptions.PROPERTIES[this.property];
        const current = this.ui.arrow_options.value(this.ui, this.property)
            ?? ArrowOptions.PROPERTIES[this.property].default;
        const value = (Array.isArray(current) ? current[this.thumb] : current) + step * delta;
        this.set_property(this.property, value);
        this.render();
        return true;
    }

    /// Close anything that would compete with a layer for keys (prompts, a focused label, and the
    /// other layers), from whatever state the UI is in.
    settle() {
        const ui = this.ui;
        if (!ui.in_mode(UIMode.Default)) {
            ui.switch_mode(UIMode.default);
        }
        const input = ui.input_is_active();
        if (input) {
            input.blur();
        }
        this.unchoose();
        ui.cancel_creation();
        ui.colour_picker.close();
        clearTimeout(this.list_timeout);
        this.active = false;
        this.count = "";
        this.layer = null;
    }

    /// Enter `layer`, leaving whatever else had the keys.
    enter_layer(layer) {
        this.settle();
        this.layer = layer;
        layer.entered();
        this.render();
    }

    /// Leave `layer`, if it has the keys.
    leave_layer(layer) {
        if (this.layer === layer) {
            this.layer = null;
        }
        this.render();
    }

    /// The layer that has the keys, or `null`.
    current_layer() {
        return this.layer ?? (this.layers.colour.active ? this.layers.colour : null);
    }

    /// Whether the layer that has the keys takes what is pasted: tikz-cd to import, or definitions
    /// to load.
    pasting() {
        return this.layer !== null && typeof this.layer.paste === "function";
    }

    /// Hand the clipboard to the layer that takes it.
    async paste() {
        const text = await host.read_clipboard();
        if (this.pasting()) {
            this.layer.paste(text);
        }
    }
}

/// The modifier keys, which neither end nor restart the command layer's wait to list its keys.
Keymap.MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

/// Keys that keep their meaning in the base layer, rather than typing.
Keymap.BASE_KEYS = new Set([" ", ";", ":", "/"]);

/// When a binding runs while a text field has the focus.
Keymap.CONTEXT = new Enum(
    "CONTEXT",
    // Whenever the key is pressed.
    "Always",
    // When no text field has the focus, or when the key left the field unchanged.
    "Defer",
    // When no text field has the focus.
    "Conservative",
);

{
    const { Always } = Keymap.CONTEXT;

    /// The bindings that keep their keys, as `{ combinations, press, release, help }`, where
    /// `press` and `release` take the UI and the key event, and `help` lists the lines the help
    /// layer shows for the binding, as `[section, description, keys]` (`keys` defaulting to the
    /// combinations'). Those of a key run in order. The rest are named, and can be rebound (see
    /// `Bindings`).
    Keymap.BINDINGS = [
        // Holding Shift shortens both ends of an arrow together (see `set_property`).
        {
            combinations: [{ key: "Shift", context: Always }],
            press: (ui) => {
                ui.keymap.symmetric = true;
            },
            release: (ui) => {
                ui.keymap.symmetric = false;
            },
        },
        {
            combinations: [{ key: "Enter", context: Always }],
            press: (ui) => ui.keys.enter(),
            help: [["Typing", "edit the label in place"]],
        },
        {
            combinations: [{ key: " ", shift: null, modifier: null }],
            press: (ui, event) => ui.keys.space(event),
            help: [
                ["Typing", "create, connected to the selection", "SPC"],
                ["Typing", "select or deselect", "S-SPC"],
            ],
        },
        // Shift cycles backwards.
        {
            combinations: [{ key: "Tab", shift: null, context: Always }],
            press: (ui, event) => ui.keys.tab(event),
            help: [["Typing", "label the next, or previous, queued cell", "TAB S-TAB"]],
        },
        {
            combinations: [{ key: "Escape", shift: null, context: Always }],
            press: (ui) => ui.keys.escape(),
            help: [["Typing", "cancel, then deselect"]],
        },
        // Holding Option or Control pans (and releasing it stops).
        {
            combinations: [{ key: "Alt", context: Always }, { key: "Control", context: Always }],
            press: (ui, event) => {
                if (ui.in_mode(UIMode.Default)) {
                    ui.switch_mode(new UIMode.Pan(event.key));
                }
            },
            release: (ui, event) => {
                if (ui.in_mode(UIMode.Pan) && ui.mode.key === event.key) {
                    ui.switch_mode(UIMode.default);
                }
            },
        },
        // While panning, the modifier moves the selection rather than the focus point.
        {
            combinations: ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].map((key) => ({
                key, shift: null, modifier: null,
            })),
            press: (ui, event) => ui.keys.arrow(event),
            help: [
                ["Moving", "move the focus point", "arrows"],
                ["Moving", "select what it passes over", "S-arrows"],
                ["Moving", "move the selection; bend or shift arrows; resize or turn loops",
                    "C-arrows"],
            ],
        },
    ];
}

/// The help layer's lines for what the bindings do not handle, as `[section, description, keys]`,
/// listed `before` or `after` each section's bindings (see `Layer.Help`), where `keys` may be a
/// function of the keymap. These are kept in sync with their handlers by hand.
Keymap.HELP_ELSEWHERE = {
    before: [
        // `Keymap.after`.
        ["Typing", "replace the label", "a \\ 2 …"],
        // `UI.create_label_input` and `Delimiters.type`.
        ["Typing", "pair, or wrap the label or selection", "( [ { | \\{ \\langle …"],
        // `Keymap.intercept`.
        ["Typing", "clear the label", "DEL"],
        ["Layers", "commands (lists its keys)", ";"],
        ["Layers", "command line (TAB lists every command)", ":"],
        ["Layers", "search labels, or type cell codes", (keymap) => ["/", keymap.describe_name(
            "search", ({ layer }) => !layer)].filter((keys) => keys !== "").join("  ")],
        ["Layers", "colour arrows, or labels", (keymap) => ["colour", "label-colour"]
            .map((name) => keymap.describe_name(name, ({ layer }) => layer))
            .filter((keys) => keys !== "").join("  ")],
    ],
    after: [
        // `Cell.initialise`, `Pointer`, and `Edge.initialise` (the ends' handles).
        ["Mouse", "select; again to edit the label", "click"],
        ["Mouse", "add to, or take from, the selection", "S-click"],
        ["Mouse", "create a cell in an empty space", "click twice"],
        ["Mouse", "draw an arrow from a cell (or empty space)", "drag"],
        ["Mouse", "move a cell, held by the edge of its space", "drag edge"],
        ["Mouse", "reconnect an arrow", "drag its end"],
        ["Mouse", "commands, as ; (click a line to run it)", "right-click"],
        // `Pointer.scroll`.
        ["Mouse", "pan (hold C or A to drag)", "scroll"],
        ["Mouse", "zoom", "S-scroll"],
    ],
};

/// The command layer's bindings, as listed while it is active: `[title, [name, description, needs,
/// value]]`, where `name` names a binding (see `Bindings`) or one of `Keymap.FIXED_KEYS`, `needs` is
/// `"edge"` or `"selection"` for bindings that only apply to those, and `value` names the state the
/// binding changes, to show alongside it (see `update_which_key`).
Keymap.WHICH_KEY = [
    ["Arrow", [
        ["tail", "tail", "edge", "style:tail"],
        ["body", "body", "edge", "style:body"],
        ["head", "head", "edge", "style:head"],
        ["arrow", "arrow", "edge", "edge-type:arrow"],
        ["adjunction", "adjunction", "edge", "edge-type:adjunction"],
        ["corner", "pullback / pushout", "edge", "edge-type:corner|corner-inverse"],
        ["reverse", "reverse", "edge"],
        ["flip", "flip", "edge"],
        ["colour", "colour", "edge"],
    ]],
    ["Sliders (-0-9 RET)", [
        ["level", "level", "edge", "slider:level"],
        ["curve", "curve (loops: radius)", "edge", "slider:curve"],
        ["offset", "offset", "edge", "slider:offset"],
        ["length", "length (again: end)", "edge", "slider:length"],
    ]],
    ["Presets", [
        "plain", "equals", "inclusion", "mono", "epi", "maps-to", "dashed", "dotted", "squiggly",
    ].map((name) => [name, name.replace("-", " "), "edge"])],
    ["Label", [
        ["align", "alignment", "edge", "alignment:"],
        ["position", "position", "edge", "slider:label_position"],
        ["label-colour", "colour", "selection"],
        ["flip-labels", "flip side", "edge"],
        ["align-left", "align left", "edge", "label_alignment:left"],
        ["align-centre", "align centre", "edge", "label_alignment:centre"],
        ["align-over", "align over", "edge", "label_alignment:over"],
    ]],
    ["Select", [
        ["toggle-selection", "select or deselect, by code"],
        ["select-at-focus", "select at focus"],
        ["create-arrows", "arrows to cells, by code", "selection"],
        ["delete-selection", "delete", "selection"],
    ]],
    ["Ends", [
        ["change-source", "change source", "edge"],
        ["change-target", "change target", "edge"],
        ["align-source", "source end on arrow", "edge", "endpoint:source"],
        ["align-target", "target end on arrow", "edge", "endpoint:target"],
    ]],
    ["View", [
        ["find", "search"],
        ["centre-view", "centre"],
        ["hide-grid", "grid"],
        ["command-line", "command line"],
        ["hide-list", "hide this list"],
        ["leave", "leave"],
    ]],
];

/// The label alignments `; A` lists, as `[value, title]`: the sides, then on the arrow.
Keymap.ALIGNMENTS = [
    ["left", "left"],
    ["right", "right"],
    ["centre", "centre, in a gap"],
    ["over", "over the arrow"],
];

/// The keys of the choices in each component's list, by value (see `choices`): `n` is none and `a`
/// the arrowhead throughout, Shift gives the other side or the doubled style, and punctuation
/// follows the presets' keys. None is the key that opens its list, which closes it again.
Keymap.CHOICE_KEYS = {
    tail: {
        "mono": "m",
        "none": "n",
        "maps to": "|",
        "top-hook": "h",
        "bottom-hook": "H",
        "arrowhead": "a",
    },
    body: {
        "solid": "s",
        "none": "n",
        "dashed": "-",
        "dotted": ".",
        "squiggly": "~",
        "barred": "b",
        "double barred": "B",
        "bullet hollow": "o",
        "bullet solid": "*",
    },
    head: {
        "arrowhead": "a",
        "none": "n",
        "epi": "e",
        "top-harpoon": "p",
        "bottom-harpoon": "P",
    },
    align: {
        "left": "l",
        "right": "r",
        "centre": "c",
        "over": "o",
    },
};

/// The titles of the choices' lists, where not the component's name.
Keymap.CHOICE_TITLES = { align: "label alignment" };

/// The command layer's keys that keep their meaning (see `intercept_layer`), by their names in
/// `Keymap.WHICH_KEY`.
Keymap.FIXED_KEYS = {
    "find": "/",
    "delete-selection": "DEL",
    "command-line": ":",
    "hide-list": "?",
    "leave": "; ESC RET",
};
