/// The object responsible for controlling all aspects of the user interface.
class UI {
    constructor(element) {
        // The quiver identified with the UI.
        this.quiver = new Quiver();

        // The UI mode (e.g. whether cells are being rearranged, or connected, etc.).
        this.mode = null;

        // The columns and rows the cells are laid out on, and their sizes.
        this.grid = new Grid();

        // All currently selected cells;
        this.selection = new Set();

        // The element in which to place the interface elements.
        this.element = element;

        // A map from `x,y` positions to vertices. Note that this
        // implies that only one vertex may occupy each position.
        this.positions = new Map();

        // A set of unique idenitifiers for various objects (used for generating HTML `id`s).
        this.ids = new Map();

        // The element containing all the cells themselves.
        this.canvas = null;

        // The grid background.
        this.grid_canvas = null;

        // Whether to prevent relayout for individual cell changes so as to batch it instead.
        this.buffer_updates = false;

        // The offset of the view (i.e. the centre of the view).
        this.view = Offset.zero();

        // The scale of the view, as a log of 2. E.g. `scale = 0` is normal, `scale = 1` is 2x
        // zoom, `scale = -1` is 0.5x and so on.
        this.scale = 0;

        // The position of focus for the keyboard, i.e. where new cells will be added if Space is
        // pressed.
        this.focus_position = Position.zero();

        // The element associated with the focus position.
        this.focus_point = null;

        // The size of the view (i.e. the document body dimensions).
        this.dimensions = new Dimensions(document.body.offsetWidth, document.body.offsetHeight);

        // Undo/redo for actions.
        this.history = new History();

        // The key bindings, and the layers they switch between (see `keymap.js`).
        this.keymap = new Keymap(this);

        // The named commands, which the command line runs (see `commands.js`).
        this.commands = new Commands(this);

        // The search and command line prompts (see `prompt.js`).
        this.prompt = new Prompt(this);

        // What the keys that edit the diagram do (see `keys.js`), and what the pointer and the
        // scroll wheel do (see `pointer.js`).
        this.keys = new Keys(this);
        this.pointer = new Pointer(this);

        // A map from the codes of the cells in the diagram to the cells, in the order Tab visits
        // them (see `recode`).
        this.codes = new Map();

        // The label input along the bottom, which labels the selected cells.
        this.label_input = null;

        // The colour picker.
        this.colour_picker = new ColourPicker();

        // The mode line, and the named actions it shows.
        this.mode_line = new ModeLine();

        // The diagram's file, and the macros file that goes with it.
        this.file = new DiagramFile(this);

        // LaTeX macro definitions.
        this.macros = new Map();

        // LaTeX colour definitions.
        this.colours = new Map();

        // Cells whose labels have been rendered, but not yet sized (see `render_maths`), and whether
        // sizing them is scheduled.
        this.unsized_labels = new Set();
        this.sizing_labels = false;

        // The user settings, kept in `~/.config/sagitta/settings.json` (see `Settings`).
        this.settings = new Settings();

        // The arrow options of the selection, and the edits the palette makes to them.
        this.arrow_options = new ArrowOptions();

        // The diagram's column and row separation, in em.
        this.sep = { column: 1.8, row: 1.8 };
    }

    /// Create the label input: the text field along the bottom that labels the selected cells, and
    /// that the search and command prompts type into (see `Keymap`).
    create_label_input() {
        const ui = this;

        // The label.
        ui.label_input = new DOM.Element("input", {
            class: "label-input",
            type: "text",
            spellcheck: "false",
            disabled: true,
        });

        // Prevent propagation of scrolling when the cursor is over the label input.
        // This allows the user to scroll the label input text when not all the content fits.
        ui.label_input.listen("wheel", (event) => {
            event.stopImmediatePropagation();
        }, { passive: true });

        // Prevent propagation of pointer events when interacting with the label input.
        ui.label_input.listen("pointerdown", (event) => {
            if (event.button === 0) {
                event.stopImmediatePropagation();
            }
        });

        // Delimiters pair, wrap, and step over, as in most editors (see `Delimiters.type`).
        ui.label_input.listen("beforeinput", (event) => {
            const input = ui.label_input.element;
            const data = {
                insertText: event.data,
                deleteContentBackward: null,
            }[event.inputType];
            if (ui.in_mode(UIMode.Command) || data === undefined) {
                return;
            }
            const typed = Delimiters.type(
                input.value, input.selectionStart, input.selectionEnd, data);
            if (typed !== null) {
                event.preventDefault();
                const changed = typed.value !== input.value;
                input.value = typed.value;
                input.setSelectionRange(typed.start, typed.end);
                if (changed) {
                    input.dispatchEvent(new Event("input"));
                }
            }
        });

        // Handle label interaction: update the labels of the selected cells when
        // the input field is modified.
        ui.label_input.listen("input", () => {
            if (!ui.in_mode(UIMode.Command)) {
                const selection = Array.from(ui.selection).filter((cell) => {
                    return cell.label !== ui.label_input.element.value;
                });
                if (selection.length === 0) {
                    // It can happen that we receive an event (e.g. `inputType` `historyUndo`)
                    // that has no effect on any label. It is unclear whether this is the
                    // correct behaviour, but we must account for it in any case. In this case,
                    // we do not want to add a history event, as it would be idempotent.
                    return;
                }
                ui.unqueue_selected();
                ui.history.add_or_modify_previous(
                    ui,
                    ["label", ui.selection],
                    [{
                        kind: "label",
                        value: ui.label_input.element.value,
                        cells: selection.map((cell) => ({
                            cell,
                            from: cell.label,
                            to: ui.label_input.element.value,
                        })),
                    }],
                );
            } else if (ui.prompt.owns()) {
                ui.prompt.input();
            } else {
                // We are jumping to a cell with the entered ID.
                let replaced
                    = ui.label_input.element.value
                        // We are going to remove any `|` symbols in the next step, so it's safe
                        // to convert them to any other symbol that will be removed. Then we can use
                        // `|` as a placeholder for the position of the caret, which conveniently
                        // allows us to preserve the position when typing, even after modifying the
                        // input.
                        .replace(/\|/g, " ");
                replaced = replaced.slice(0, ui.label_input.element.selectionStart) + "|"
                    + replaced.slice(ui.label_input.element.selectionStart);
                // Codes are made of the hint characters, and an edge's may end in a number.
                const characters = `${ui.settings.get("ui.hint_characters")}0-9`;
                switch (ui.mode.mode) {
                    case "Select":
                    case "Toggle":
                    case "Create":
                        replaced = replaced.replace(new RegExp(`[^${characters} |]`, "gi"), "");
                        break;
                    case "Source":
                    case "Target":
                        replaced = replaced.replace(new RegExp(`[^${characters}|]`, "gi"), "");
                        break;
                }
                // We allow the pattern " | " to appear, just in case the user does decide to go
                // back and insert a code (for whatever reason).
                replaced = replaced
                    .replace(/\s{2,}/g, " ")
                    .replace(/^\s+/, "")
                    .replace(/^\|\s*/, "|")
                    .toUpperCase();

                // While selecting cells, we keep the caret indicator "|" in `replaced`. This allows
                // us to only partially-select codes when we know the user is still typing that code
                // (i.e. the caret is immediately after it).

                const focused_cells = ui.element.query_selector_all(
                    ".cell kbd.focused, .cell kbd.partially-focused"
                );
                for (const element of focused_cells) {
                    element.class_list.remove("focused", "partially-focused");
                    // Only partially-focused cells need clearing.
                    element.clear();
                }
                const highlighted = new Set();
                for (let code of replaced.split(" ")) {
                    const in_progress = code.endsWith("|");
                    code = code.replace(/\|$/, "");
                    if (!highlighted.has(code)) {
                        const element = ui.element.query_selector(`kbd[data-code="${code}"]`);
                        if (element !== null) {
                            element.class_list.add("focused");
                            highlighted.add(code);
                            continue;
                        }
                    }
                    // If the user is in the process of typing a code, partially-select all the
                    // codes that it matches so far.
                    if (in_progress) {
                        const matches_prefix
                            = ui.element.query_selector_all(`kbd[data-code^="${code}"]`);
                        for (const element of matches_prefix) {
                            element.class_list.add("partially-focused");
                            element.clear()
                                .add(new DOM.Element("span", { class: "focused" }).add(code))
                                .add(element.get_attribute("data-code").slice(code.length));
                        }
                    }
                }

                const caret = replaced.indexOf("|");
                replaced = replaced.replace("|", "");
                ui.label_input.element.value = replaced;
                ui.label_input.element.setSelectionRange(caret, caret);
            }
        }).listen("focus", () => {
            // Close the colour picker.
            ui.colour_picker.close();
        }).listen("blur", () => {
            if (!ui.in_mode(UIMode.Command)) {
                // As soon as the input is blurred, treat the label modification as
                // a discrete event, so if we modify again, we'll need to undo both
                // modifications to completely undo the label change.
                ui.history.permanentise();
            } else {
                ui.switch_mode(UIMode.default);
            }
        });
    }

    /// Render the labels of `cells` with KaTeX, then size them (see `size_labels`).
    render_maths(...cells) {
        const macros = Macros.for_katex(this.macros);
        for (const cell of cells) {
            const label = cell.element.query_selector(".label");
            if (label === null) {
                // The label will be null if the edge is invalid, which may happen when bad tikz-cd
                // has been parsed.
                continue;
            }
            // Currently all errors are disabled, so we don't wrap this in a try-catch block.
            katex.render(
                cell.label.replace(/\$/g, "\\$"),
                label.element,
                {
                    throwOnError: false,
                    errorColor: "var(--ui-error)",
                    // A copy each, as KaTeX adds a label's `\gdef`s to the macros it is given.
                    macros: { ...macros },
                    trust: (context) => ["\\href", "\\url", "\\includegraphics"]
                        .includes(context.command),
                },
            );
            this.unsized_labels.add(cell);
        }
        if (this.unsized_labels.size === 0 || this.sizing_labels) {
            return;
        }
        // KaTeX loads fonts as it needs them. After we call `render`, it will load the fonts it
        // needs if they haven't already been loaded, then render the LaTeX asynchronously. If we
        // calculate the label size immediately and the necessary fonts have not been loaded, the
        // calculated dimensions will be incorrect. Therefore, we need to wait until all the fonts
        // used in the document (i.e. the KaTeX-specific ones, which are the only ones that may not
        // have been loaded yet) have been loaded. Then we wait for the next frame, so that every
        // label rendered meanwhile (a macros file reloading, or keys typed faster than the diagram
        // lays out) is sized together, before it is drawn.
        this.sizing_labels = true;
        document.fonts.ready.then(() => requestAnimationFrame(() => {
            this.sizing_labels = false;
            const cells = this.unsized_labels;
            this.unsized_labels = new Set();
            this.size_labels(cells);
        }));
    }

    /// Size the newly rendered labels of `cells`: vertices to fit their labels, resizing the grid
    /// if need be, and edges around their labels. Every label is measured before anything is
    /// resized, so that the whole batch costs one layout rather than one per label.
    size_labels(cells) {
        // The quiver may have been replaced while the fonts loaded, as when opening a file whose
        // encoding no longer matches its tikz-cd imports it twice.
        cells = Array.from(cells).filter((cell) => this.quiver.dependencies.has(cell));
        const vertices = cells.filter((cell) => cell.is_vertex());
        const edges = cells.filter((cell) => cell.is_edge());

        for (const vertex of vertices) {
            vertex.measure_label();
        }
        const edge_sizes = edges.map((edge) => {
            const katex_element = edge.element.query_selector(".label .katex, .label .katex-error");
            return katex_element === null ? [0, 0]
                : [katex_element.element.offsetWidth, katex_element.element.offsetHeight];
        });

        for (const [i, edge] of edges.entries()) {
            const [width, height] = edge_sizes[i];
            edge.arrow.label.size = new Dimensions(
                width + (width > 0 ? CONSTANTS.EDGE_LABEL_PADDING * 2 : 0),
                height + (height > 0 ? CONSTANTS.EDGE_LABEL_PADDING * 2 : 0),
            );
        }
        // Resize the grid once for all the vertices, rather than once for each.
        const buffered = this.buffer_updates;
        this.buffer_updates = true;
        for (const vertex of vertices) {
            vertex.recalculate_size(this);
            // If the cell is empty, we highlight it to make it easier to spot.
            vertex.element.class_list.toggle("empty", vertex.label.trim() === "");
        }
        this.buffer_updates = buffered;
        const moved = buffered ? new Set()
            : this.update_col_row_size(...vertices.map((vertex) => vertex.position));
        // Edges are drawn around their labels, and snugly against their source and target vertices'
        // labels, so everything depending on a resized label is redrawn.
        for (const cell of this.quiver.transitive_dependencies([...vertices, ...edges])) {
            if (cell.is_edge() && !moved.has(cell)) {
                cell.render(this);
            }
        }
    }

    /// Focus the label input and select all its text.
    focus_label_input() {
        const input = this.label_input.element;
        input.focus();
        input.setSelectionRange(0, input.value.length);
    }

    /// Bring the label input and the colours in line with the selection, after the selection or the
    /// cells in it have changed. What the palette reports is read from the selection as it is
    /// needed (see `ArrowOptions` and `ModeLine.describe_arrows`), so there is nothing else to sync.
    update_selection() {
        const input = this.label_input.element;
        // While a prompt owns the input, what it holds is being typed, not a label.
        if (!this.in_mode(UIMode.Command)) {
            const label = ArrowOptions.common(this.selection, (cell) => cell.label) ?? "";
            if (input.value !== label) {
                // Guard on the value changing: assigning it moves the caret to the end.
                input.value = label;
            }
            input.disabled = this.selection.size === 0;
            if (input.disabled && document.activeElement === input) {
                // A disabled input can keep the focus, which then swallows key presses.
                input.blur();
            }
        }

        // The colours the picker edits, and the indicator beside the label input.
        const options = this.arrow_options;
        options.label_colour
            = ArrowOptions.common(this.selection, (cell) => cell.label_colour) || Colour.black();
        options.colour = ArrowOptions.common(
            ArrowOptions.edges(this), (edge) => edge.options.colour) || Colour.black();
        const indicator = this.element.query_selector(".label-input-container .colour-indicator");
        indicator.class_list.toggle("disabled", this.selection.size === 0);
        if (this.colour_picker.is_targeting(ColourPicker.TARGET.Label)) {
            this.colour_picker.set_colour(this, options.label_colour);
        } else {
            indicator.set_style({ background: options.label_colour.css() });
        }
        if (this.colour_picker.is_targeting(ColourPicker.TARGET.Edge)) {
            this.colour_picker.set_colour(this, options.colour);
        }
    }

    /// Close what the selection had open, once the cells it held are no longer selected.
    hide_if_unselected() {
        if (!this.selection_contains_edge()) {
            if (this.colour_picker.is_targeting(ColourPicker.TARGET.Edge)) {
                this.colour_picker.close();
            }
            this.keymap.unchoose();
        }
        if (this.selection.size === 0) {
            this.label_input.parent.class_list.add("hidden");
            this.colour_picker.close();
        }
    }

    /// Unqueue any selected cell, typically after an edit affecting the cells in the selection.
    unqueue_selected() {
        for (const element of this.element.query_selector_all(".cell.selected kbd.queue")) {
            element.class_list.remove("queue");
        }
    }

    /// Clear the current diagram. This also clears the history.
    clear_quiver() {
        // Clear the existing quiver.
        for (const cell of this.quiver.all_cells()) {
            cell.element.remove();
        }
        this.quiver = new Quiver();
        this.codes = new Map();

        // Reset data regarding existing vertices.
        this.grid.clear();
        this.selection = new Set();
        this.positions = new Map();
        this.update_grid();

        // Clear the undo/redo history.
        this.history = new History();

        // Update UI elements.
        this.update_selection();
        this.mode_line.update(this);
        // Reset the focus point.
        this.focus_point.class_list.remove("focused", "smooth");

        // While the following does work without a delay, it currently experiences some stutters.
        // Using a delay makes the transition much smoother.
        delay(() => {
            this.hide_if_unselected();
            this.label_input.parent.class_list.add("hidden");
            this.colour_picker.close();
        });
    }

    /// Reset most of the UI. We don't bother resetting current zoom, etc.: just enough to make
    /// changing the URL history work properly.
    reset() {
        // Reset the mode.
        this.switch_mode(UIMode.default);

        // Clear the quiver and update associated UI elements.
        this.clear_quiver();

    }

    /// Returns definitions of macros and colours that are recognised by LaTeX.
    definitions() {
        const { macros, colours } = this;
        return { macros, colours };
    }

    /// Returns options that are not saved persistently in `settings`, but are used to modify
    /// export output.
    options() {
        return {
            dimensions: this.diagram_size(),
            sep: this.sep,
        };
    }

    initialise() {
        this.element.class_list.add("ui");
        document.body.classList.toggle("dark", this.settings.get("ui.dark_mode"));
        document.body.style.setProperty("--label-size", `${this.settings.get("ui.label_size")}px`);
        this.grid.default_size = this.settings.get("ui.cell_size");
        this.scale = this.default_scale();
        this.switch_mode(UIMode.default);

        // Set the grid background.
        this.initialise_grid(this.element);

        // Set up the element containing all the cells.
        this.container = new DOM.Div({ class: "container" }).add_to(this.element);
        this.canvas = new DOM.Div({ class: "canvas" }).add_to(this.container);

        // Set up the label input, which the container below and the keymap add themselves to.
        this.create_label_input();
        this.colour_picker.initialise(this);

        // The label colour indicator, which (like `; C`) enters the colour layer.
        const colour_indicator = new DOM.Div({ class: "colour-indicator" })
            .listen("click", () => this.keymap.layers.colour.toggle(ColourPicker.TARGET.Label));
        this.element.add(
            new DOM.Div({ class: "label-input-container hidden" })
                .add(new DOM.Div({ class: "input-mode" }))
                .add(this.label_input)
                .add(colour_indicator)
                .listen("pointerdown", (event) => event.stopPropagation())
        );

        // Prevent the label input being dismissed when clicked on in command mode, when no cells
        // are selected.
        this.label_input.parent.listen("pointerup", (event) => {
            if (this.in_mode(UIMode.Command)
                && event.button === 0
            ) {
                event.stopPropagation();
            }
        });

        // Set up the mode line.
        this.mode_line.initialise(this);
        UI.mode_line = this.mode_line;
        this.element.add(this.mode_line.element);

        this.keymap.initialise();

        // Add the focus point for new nodes.
        this.focus_point = new DOM.Div({ class: "focus-point focused smooth" })
            .add_to(this.canvas);
        this.mode_line.update(this);

        // The canvas is only as big as the window, so we need to resize it when the window resizes.
        window.addEventListener("resize", () => {
            // Adjust the grid so that it aligns with the content.
            this.update_grid();
        });

        this.reposition_focus_point(Position.zero());

        // The pointer and the scroll wheel.
        this.pointer.initialise();

        // Centre the cell at (0, 0) in the view, which looks prettier.
        this.pan_view(Offset.diag(this.grid.default_size / 2));

        this.report_problems();
    }

    /// The zoom the view starts at, and that `reset-zoom` returns to (see `scale`).
    default_scale() {
        return clamp(CONSTANTS.MIN_ZOOM, Math.log2(this.settings.get("ui.zoom") / 100),
            CONSTANTS.MAX_ZOOM);
    }

    /// Report what was wrong with the settings and the keys files in the mode line: the first
    /// problem, and how many others there were. Each is logged as a warning, too.
    report_problems() {
        const problems = [
            ...this.settings.problems.map((problem) => `settings.json: ${problem}`),
            ...this.keymap.problems.map((problem) => `keys, ${problem}`),
        ];
        for (const problem of problems) {
            console.warn(problem);
        }
        if (problems.length > 0) {
            const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
            this.mode_line.error(`~/.config/sagitta/${problems[0]}${more}`);
        }
    }

    /// Create a vertex at the focus point, and select it: alone, unless Shift, Command, or Control
    /// is held.
    create_vertex_at_focus_point(event) {
        this.focus_point.class_list.remove("revealed");
        // We want the new vertex to be the only selected cell, unless we've held
        // Shift/Command/Control when creating it.
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
            this.deselect();
        }
        const vertex = new Vertex(this, "\\bullet", this.focus_position);
        this.select(vertex);
        return vertex;
    }

    /// Put `edges` (at least one), created with their target `vertex`, before the vertex in the
    /// order Tab visits cells in.
    order_before(vertex, ...edges) {
        // When we create a target vertex and an edge simultaneously, the new vertex has to be
        // created first, because the edge needs a target. However, in practice, it feels more
        // natural to cycle to the edge before the vertex, because this aligns with the
        // diagrammatic order.
        const cells = [...edges, vertex];
        const serials = cells.map((cell) => cell.serial).sort((a, b) => a - b);
        cells.forEach((cell, i) => cell.serial = serials[i]);
        this.recode();
    }

    /// Give every cell in the diagram a code, which typing in the hint-code prompts (and `/`)
    /// selects it by. A vertex keeps its code for as long as it is in the diagram, and takes the
    /// first one free otherwise: one character of `ui.hint_characters`, and two once those run
    /// out, and so on. Removing a cell frees its code. An edge's code is its source's followed by
    /// its target's, with a number after it to tell parallel edges apart, unless that is longer
    /// than `UI.MAX_JOINED_CODE`.
    recode() {
        const cells = this.quiver.all_cells().sort((a, b) => a.serial - b.serial);
        const live = new Set(cells);
        const vertices = cells.filter((cell) => cell.is_vertex());
        const edges = cells.filter((cell) => cell.is_edge())
            .sort((a, b) => a.level - b.level || a.serial - b.serial);

        // The vertices that already hold their code keep it.
        const kept = new Set(vertices.filter((vertex) => this.codes.get(vertex.code) === vertex));
        const taken = new Set(Array.from(kept, (vertex) => vertex.code));
        // The others, being new or brought back, take their old code if it is free, and otherwise
        // the first one that neither a vertex nor an edge holds, so that the edges' codes stay.
        const held = new Set(taken);
        for (const [code, cell] of this.codes) {
            if (cell.is_edge() && live.has(cell)) {
                held.add(code);
            }
        }
        const alphabet = this.settings.get("ui.hint_characters");
        const free_codes = function* () {
            for (let length = 1; ; ++length) {
                const count = alphabet.length ** length;
                for (let value = 0; value < count; ++value) {
                    let code = "";
                    for (let rest = value, i = 0; i < length; ++i) {
                        code = alphabet[rest % alphabet.length] + code;
                        rest = Math.floor(rest / alphabet.length);
                    }
                    if (!held.has(code)) {
                        yield code;
                    }
                }
            }
        }();
        for (const vertex of vertices) {
            if (kept.has(vertex)) {
                continue;
            }
            if (vertex.code === "" || taken.has(vertex.code)) {
                vertex.code = free_codes.next().value;
            }
            taken.add(vertex.code);
            held.add(vertex.code);
        }

        // Edges after their ends, so that their ends' codes are settled. An edge whose ends' codes
        // together are too long to type (as between edges) takes a code of its own instead, as a
        // vertex does, and keeps it while it is free.
        for (const edge of edges) {
            const base = edge.source.code + edge.target.code;
            let code = base;
            if (base.length > UI.MAX_JOINED_CODE) {
                code = edge.own_code;
                if (code === undefined || taken.has(code)) {
                    code = free_codes.next().value;
                    while (taken.has(code)) {
                        code = free_codes.next().value;
                    }
                }
                edge.own_code = code;
            } else {
                for (let n = 2; taken.has(code); ++n) {
                    code = `${base}${n}`;
                }
            }
            edge.code = code;
            taken.add(code);
            held.add(code);
        }

        this.codes = new Map(cells.map((cell) => [cell.code, cell]));
        for (const cell of cells) {
            const element = cell.element?.query_selector("kbd");
            if (element && element.get_attribute("data-code") !== cell.code) {
                element.set_attributes({ "data-code": cell.code });
            }
        }
    }

    /// Returns whether the UI is in a particular mode.
    in_mode(...modes) {
        for (const mode of modes) {
            if (this.mode instanceof mode) {
                return true;
            }
        }
        return false;
    }

    /// Transitions to a `UIMode`.
    switch_mode(mode) {
        if (this.mode === null || this.mode.constructor !== mode.constructor) {
            if (this.mode !== null) {
                // Clean up any state for which this mode is responsible.
                this.mode.release(this);
                if (this.mode.name !== null) {
                    this.element.class_list.remove(this.mode.name);
                }
            }
            this.mode = mode;
            this.mode_line.update(this);
            if (this.mode.name !== null) {
                this.element.class_list.add(this.mode.name);
            }
        }
    }

    /// A helper method for getting a position from an event.
    position_from_event(event) {
        return this.grid.position_from_offset(this.offset_from_event(event));
    }

    /// A helper method for getting an offset from an event.
    offset_from_event(event) {
        const scale = 2 ** this.scale;
        return new Offset(event.pageX, event.pageY)
            .sub(new Offset(document.body.offsetWidth / 2, document.body.offsetHeight / 2))
            .div(scale)
            .add(this.view);
    }

    /// Update the width of the grid columns and the heights of the grid rows at each of the given
    /// positions.
    /// The maximum width/height of each cell in a column/row will be used to determine the width/
    /// height of each column/row.
    ///
    /// Returns the cells rerendered, because a resize moved them, so that the caller need not
    /// render them again.
    update_col_row_size(...positions) {
        // The columns and rows whose sizes changed. Only the vertices at or beyond them (counting
        // outwards from 0, from which offsets are measured) move, and the edges depending on those.
        const columns = [];
        const rows = [];
        // We keep the view centred as best we can, so we have to adjust the view if anything is
        // resized.
        let view_offset = Offset.zero();

        for (const position of positions) {
            const [delta_x, delta_y] = this.grid.fit(position);

            if (delta_x !== 0 || delta_y !== 0) {
                // Compute how much to adjust the view in order to keep it centred appropriately.
                const offset = new Offset(
                    delta_x / 2 * (position.x >= 0 ? -1 : 1),
                    delta_y / 2 * (position.y >= 0 ? -1 : 1),
                );
                view_offset = view_offset.sub(offset);
            }
            if (delta_x !== 0) {
                columns.push(position.x);
            }
            if (delta_y !== 0) {
                rows.push(position.y);
            }
        }

        if (columns.length === 0 && rows.length === 0) {
            // Nothing moved. This is the usual case, as every vertex rendered checks its own
            // column and row, so it must not cost a pass over the quiver.
            return new Set();
        }
        const beyond = (index, resized) => resized.some((resized) => {
            return resized >= 0 ? index >= resized : index <= resized;
        });
        const moved = this.quiver.transitive_dependencies(this.quiver.all_cells().filter((cell) => {
            return cell.is_vertex()
                && (beyond(cell.position.x, columns) || beyond(cell.position.y, rows));
        }));

        // First, we reposition the grid and redraw it.
        this.pan_view(view_offset);
        // Then, we rerender the cells that have moved, which `transitive_dependencies` orders so
        // that the cells on which others depend are rendered first.
        for (const cell of moved) {
            cell.render(this);
        }
        // Similarly, the focus point may have changed position.
        if (this.focus_point.class_list.contains("focused")) {
            // Don't animate the size change, which should happen instantaneously.
            this.focus_point.class_list.remove("smooth");
            this.reposition_focus_point(this.focus_position);
            delay(() => this.focus_point.class_list.add("smooth"));
        }

        return moved;
    }

    /// Updates the size of the content of a cell. If the size is larger than the maximum of all
    /// other cells in that column or row, we resize the column or row to fit the content in.
    /// This means we do not have to resize the text inside a cell, for instance, to make things
    /// fit.
    update_cell_size(cell, width, height) {
        this.grid.constrain(cell, width, height);

        // Resize the grid if need be.
        if (!this.buffer_updates) {
            this.update_col_row_size(cell.position);
        }
    }

    /// Move the selected vertices (and so their edges) one step by `position_delta`, or further, to
    /// the first positions that are all free. Returns the number of steps moved (0 if no vertex is
    /// selected).
    move_selection(position_delta) {
        const vertices = Array.from(this.selection).filter((cell) => cell.is_vertex());
        if (vertices.length === 0) {
            return 0;
        }
        // We are guaranteed to eventually find free positions, because diagrams are finite.
        for (let distance = 1;; ++distance) {
            for (const vertex of vertices) {
                this.positions.delete(`${vertex.position}`);
            }
            const all_new_positions_free = vertices.every((vertex) => {
                return !this.positions.has(`${vertex.position.add(position_delta.mul(distance))}`);
            });
            for (const vertex of vertices) {
                this.positions.set(`${vertex.position}`, vertex);
            }
            if (all_new_positions_free) {
                this.history.add(this, [{
                    kind: "move",
                    displacements: vertices.map((vertex) => ({
                        vertex,
                        from: vertex.position,
                        to: vertex.position.add(position_delta.mul(distance)),
                    })),
                }], true);
                return distance;
            }
        }
    }

    /// Move the focus point to a given position. This will also resize the focus point
    /// appropriately, so this isn't necessarily an idempotent operation.
    reposition_focus_point(position, update_focus_position = true) {
        if (update_focus_position) {
            // Sometimes, we will want to move the focus point element, but not change its
            // remembered position, so that when we press a key (e.g. Space, or one of the arrow
            // keys), the focus point will jump back to where it last was when we used the keyboard.
            this.focus_position = position;
        }
        const offset = this.grid.offset_from_position(position);
        const height = this.grid.row_height(position.y) - CONSTANTS.GRID_BORDER_WIDTH;
        this.element.query_selector(".focus-point").set_style({
            left: `${offset.x}px`,
            top: `${offset.y}px`,
            // Resize the focus point appropriately for the grid cell.
            width: `${
                this.grid.column_width(position.x) - CONSTANTS.GRID_BORDER_WIDTH}px`,
            height: `${height}px`,
            "padding-top": `${height / 2}px`,
        });
    };

    /// Returns the cell under the focus point, if the focus point is active and such a cell exists.
    /// Otherwise, returns `null`.
    cell_under_focus_point() {
        if (!this.focus_point.class_list.contains("focused")) {
            return null;
        }
        if (this.positions.has(`${this.focus_position}`)) {
            return this.positions.get(`${this.focus_position}`);
        }
        return null;
    }

    /// Computes the size of the diagram.
    diagram_size() {
        // Compute the extrema of the diagram.
        const bounding_rect = this.quiver.bounding_rect();
        return bounding_rect === null ? Dimensions.zero() : this.grid.size_of(bounding_rect);
    }

    /// Returns whether there are any selected vertices.
    selection_contains_vertex() {
        return Array.from(this.selection).some((cell) => cell.is_vertex());
    }

    /// Returns whether there are any selected edges.
    selection_contains_edge() {
        return Array.from(this.selection).some((cell) => cell.is_edge());
    }

    /// Returns the current UI selection, excluding the given `cells`.
    selection_excluding(cells) {
        const selection = new Set(this.selection);
        for (const cell of cells) {
            selection.delete(cell);
        }
        return selection;
    }

    /// Selects specific `cells`. Note that this does *not* deselect any cells that were
    /// already selected. For this, call `deselect()` beforehand.
    select(...cells) {
        let selection_changed = false;
        // The selection set is treated immutably, so we duplicate it here to
        // ensure that existing references to the selection are not modified.
        this.selection = new Set(this.selection);
        for (const cell of cells) {
            if (this.quiver.deleted.has(cell)) {
                // This should not happen in practice, but to avoid bugs, we make sure only to
                // select cells that exist in the diagram. In the past, the history system has
                // occasionally had trouble keeping track of which cells to select.
                continue;
            }
            if (!this.selection.has(cell)) {
                this.selection.add(cell);
                cell.select();
                selection_changed = true;
            }
        }
        if (selection_changed) {
            this.update_selection();
            this.mode_line.update(this);
            if (this.selection.size > 0) {
                this.label_input.parent.class_list.remove("hidden");
            }
        }
    }

    /// Deselect a specific `cell`, or deselect all cells if `cell` is null.
    deselect(cell = null) {
        if (cell === null) {
            for (cell of this.selection) {
                cell.deselect();
            }
            this.selection = new Set();
        } else {
            // The selection set is treated immutably, so we duplicate it here to
            // ensure that existing references to the selection are not modified.
            this.selection = new Set(this.selection);
            if (this.selection.delete(cell)) {
                cell.deselect();
            }
        }

        this.update_selection();
        this.mode_line.update(this);
    }

    /// Adds a cell to the canvas.
    add_cell(cell) {
        this.canvas.add(cell.element);
        if (cell.is_vertex()) {
            this.positions.set(`${cell.position}`, cell);
            cell.recalculate_size(this);
        }
        this.recode();
        this.colour_picker.update_diagram_colours(this);
    }

    /// Removes a cell.
    remove_cell(cell, when) {
        // Remove this cell and its dependents from the quiver and then from the HTML.
        const update_positions = new Set();
        for (const removed of this.quiver.remove(cell, when)) {
            if (removed.is_vertex()) {
                this.positions.delete(`${removed.position}`);
                this.grid.unconstrain(cell);
                update_positions.add(removed.position);
            }
            this.deselect(removed);
            removed.element.remove();
        }
        this.update_col_row_size(...update_positions);
        this.recode();
        this.colour_picker.update_diagram_colours(this);
    }

    /// Cancel the creation of a new vertex or edge via clicking or dragging.
    cancel_creation() {
        let effectful = false;

        // Stop trying to connect cells.
        if (this.in_mode(UIMode.Connect)) {
            if (this.mode.forged_vertex) {
                // If we created a vertex as part of the connection, we need to record
                // that as an action.
                this.history.add(this, [{
                    kind: "create",
                    cells: new Set([this.mode.source]),
                }]);
            }
            this.switch_mode(UIMode.default);
            effectful = true;
        }

        // If we're waiting to start connecting a cell, then we stop waiting.
        const pending = this.element.query_selector(".cell.pending");
        if (pending !== null) {
            pending.class_list.remove("pending");
            effectful = true;
        }

        // If the user has revealed the focus point (and possibly started dragging), hide it
        // again.
        const class_list = this.focus_point.class_list;
        if (
            class_list.contains("revealed") || class_list.contains("pending")
            || class_list.contains("active")
        ) {
            this.focus_point.class_list.remove("revealed", "pending", "active");
            effectful = true;
        }

        return effectful;
    }

    /// Repositions the view by an absolute offset.
    pan_to(offset, zoom = this.scale) {
        this.view.x = offset.x;
        this.view.y = offset.y;
        this.scale = zoom;
        const view = this.view.mul(2 ** this.scale);
        this.canvas.set_style({
            transform: `translate(${-view.x}px, ${-view.y}px) scale(${2 ** this.scale})`,
        });
        this.update_grid();
    }

    /// Repositions the view by a relative offset.
    /// If `offset` is positive, then everything will appear to move towards the top left.
    /// If `zoom` is positive, then everything will grow larger.
    pan_view(offset, zoom = 0) {
        this.pan_to(this.view.add(offset), this.scale + zoom);
    }

    /// Centre the view with respect to the selection, or the entire quiver if no cells are
    /// selected.
    centre_view() {
        let cells;
        if (this.selection.size > 0) {
            cells = this.selection;
        } else if (this.quiver.cells.length > 0 && this.quiver.cells[0].size > 0) {
            cells = this.quiver.cells[0];
        } else {
            return;
        }

        // We want to centre the view on the cells, so we take the range of all cell offsets.
        let min_offset = new Offset(Infinity, Infinity);
        let max_offset = new Offset(-Infinity, -Infinity);
        this.view = Offset.zero();

        for (const cell of cells) {
            if (cell.is_vertex()) {
                // For vertices, we want to include the entire cell they occupy.
                const offset = this.grid.centre_offset_from_position(cell.position);
                const centre = this.grid.cell_centre_at_position(cell.position);
                min_offset = min_offset.min(offset.sub(centre));
                max_offset = max_offset.max(offset.add(centre));
            } else {
                // For edges, we want to include the centre point (for curved edges) and endpoints.
                const offsets = [
                    cell.shape.origin,
                    cell.source.shape.origin,
                    cell.target.shape.origin
                ];
                for (const offset of offsets) {
                    min_offset = min_offset.min(offset);
                    max_offset = max_offset.max(offset);
                }
            }
        }

        this.pan_view(min_offset.add(max_offset).div(2));
    }

    /// Returns a unique identifier for an object.
    unique_id(object) {
        if (!this.ids.has(object)) {
            this.ids.set(object, this.ids.size);
        }
        return this.ids.get(object);
    }

    /// Returns the active element if it is a text input field. (If it is, certain
    /// actions (primarily keyboard shortcuts) will be disabled.)
    input_is_active() {
        // This may not be the label input, e.g. it may be the macros input.
        return document.activeElement.matches('input[type="text"], div[contenteditable]')
            && document.activeElement;
    }

    /// Show the error `message` in the mode line, until it is dismissed.
    static display_error(message) {
        console.error(message);
        if (UI.mode_line !== null) {
            UI.mode_line.error(message);
        }
    }

    /// Dismiss the error shown in the mode line. Returns whether there was one.
    static dismiss_error() {
        return UI.mode_line !== null && UI.mode_line.dismiss_error();
    }

    /// Create the canvas upon which the grid will be drawn.
    initialise_grid(element) {
        const [width, height] = [document.body.offsetWidth, document.body.offsetHeight];
        this.grid_canvas = new DOM.Canvas(null, width, height, { class: "grid" });
        element.add(this.grid_canvas);
        this.update_grid();
    }

    /// Change `setting` to `value`, and remember it, showing the change straight away (see
    /// `Layer.Settings`).
    change_setting(setting, value) {
        this.settings.set(setting, value);
        switch (setting) {
            case "ui.dark_mode":
                document.body.classList.toggle("dark", value);
                this.update_grid();
                break;
            case "ui.zoom":
                this.scale = this.default_scale();
                this.pan_view(Offset.zero());
                break;
            case "ui.label_size":
                document.body.style.setProperty("--label-size", `${value}px`);
                this.render_maths(...this.quiver.all_cells());
                break;
            case "ui.cell_size":
                this.grid.default_size = value;
                this.relayout();
                break;
        }
    }

    /// Lay every cell out afresh, as when the size of an empty column or row changes: each column
    /// and row fits its largest cell again, and everything is drawn where that puts it.
    relayout() {
        this.grid.widths.clear();
        this.grid.heights.clear();
        const cells = this.quiver.all_cells();
        for (const cell of cells) {
            if (cell.is_vertex()) {
                this.grid.fit(cell.position);
            }
        }
        for (const cell of this.quiver.transitive_dependencies(cells)) {
            cell.render(this);
        }
        this.pan_view(Offset.zero());
        this.reposition_focus_point(this.focus_position);
    }

    /// Switch dark mode on or off, and remember it. Only how the diagram is shown changes.
    toggle_dark_mode() {
        this.change_setting("ui.dark_mode", !this.settings.get("ui.dark_mode"));
    }

    /// Update the grid with respect to the view and size of the window.
    update_grid() {
        // Constants for parameters of the grid pattern.
        // The (average) length of the dashes making up the cell border lines.
        const DASH_LENGTH = this.grid.default_size;
        // The border colour, which dark mode changes.
        const BORDER_COLOUR = getComputedStyle(document.body).getPropertyValue("--grid");

        const [width, height] = [document.body.offsetWidth, document.body.offsetHeight];
        const canvas = this.grid_canvas;
        canvas.resize(width, height);

        const scale = 2 ** this.scale;

        const context = canvas.context;
        context.strokeStyle = BORDER_COLOUR;
        context.lineWidth = Math.max(1, CONSTANTS.GRID_BORDER_WIDTH * scale);
//        context.setLineDash([DASH_LENGTH * scale]);

        // We want to centre the horizontal and vertical dashes, so we get little crosses in the
        // corner of each grid cell. This is best effort: it is perfect when each column and row
        // is the default size, but otherwise may be imperfect.
        const dash_offset = -DASH_LENGTH * scale / 2;

        const offset = this.view;

        const [[left_col, left_offset], [top_row, top_offset]]
            = this.grid.col_row_offset_from_offset(
                offset.sub(new Offset(width / scale / 2, height / scale / 2))
            );
        const [[right_col,], [bottom_row,]] = this.grid.col_row_offset_from_offset(
            offset.add(new Offset(width / scale / 2, height / scale / 2))
        );

        // Draw the vertical lines.
        context.beginPath();
        for (let col = left_col, x = left_offset - offset.x;
                col <= right_col; x += this.grid.column_width(col++)) {
            context.moveTo(x * scale + width / 2, 0);
            context.lineTo(x * scale + width / 2, height);
        }
        context.lineDashOffset
            = offset.y * scale - dash_offset - height % (this.grid.default_size * scale) / 2;
        context.stroke();

        // Draw the horizontal lines.
        context.beginPath();
        for (let row = top_row, y = top_offset - offset.y;
                row <= bottom_row; y += this.grid.row_height(row++)) {
            context.moveTo(0, y * scale + height / 2);
            context.lineTo(width, y * scale + height / 2);
        }
        context.lineDashOffset
            = offset.x * scale - dash_offset - width % (this.grid.default_size * scale) / 2;
        context.stroke();
    }

    /// Load macros and colours from a string. Macros will be expanded in any LaTeX label, whilst
    /// colours appear as a palette group in the colour layer.
    load_macros(definitions) {
        const { macros, colours } = Macros.parse(definitions);
        const changed = Macros.changed(this.macros, macros);
        this.macros = macros;
        this.colours = colours;

        // Rerender the labels the new macro definitions could change.
        this.render_maths(...this.quiver.all_cells().filter((cell) => {
            return Array.from(changed).some((name) => cell.label.includes(name));
        }));

        // Update the LaTeX colour palette group.
        this.colour_picker.update_latex_colours(this);
    }
}

/// The mode line of the UI, which shows errors (see `UI.display_error`), once initialised.
UI.mode_line = null;

/// The longest code an edge takes from its ends' codes (see `UI.recode`).
UI.MAX_JOINED_CODE = 3;
