/// The mode line along the bottom of the window, and the registry of named, diagram-wide actions
/// (undo, export, zoom, ...), which the key bindings, the command line, and the mode line share.
///
/// The mode line shows, from left to right: the input mode; the diagram's file, and whether it has
/// unsaved changes; what typing would edit; the selected arrow's style and parameters; how many
/// cells are queued for labelling; a few clickable key hints, the first opening the command layer
/// (whose key list is clickable too); the zoom level; a settings button; and a menu button, which
/// opens the command line listing every command. While the diagram is empty, a line of tips runs along the top.
class ModeLine {
    constructor() {
        /// The mode line element.
        this.element = null;

        /// The tips shown while the diagram is empty.
        this.tip = null;

        /// The named actions: `name` to `{ label, combinations, run, enabled }`.
        this.actions = new Map();

        /// Whether an update has been scheduled for the next animation frame.
        this.scheduled = false;

        /// The timeout clearing the message shown by `flash`.
        this.flash_timeout = null;

        /// Whether the message is an error waiting to be dismissed, which flashes do not replace.
        this.standing = false;
    }

    initialise(ui) {
        this.define_actions(ui);

        const button = (attributes, content, action) => new DOM.Element("button", attributes)
            .add(content)
            .listen("click", action);

        this.element = new DOM.Div({ class: "mode-line" })
            .listen("pointerdown", (event) => {
                if (event.button === 0) {
                    event.stopImmediatePropagation();
                }
            })
            .add(new DOM.Element("span", { class: "mode" }))
            .add(new DOM.Element("span", { class: "file" }))
            .add(button({ class: "target", title: "Edit the label (RET)" }, "", () => {
                if (ui.keymap.edit_target(false)) {
                    ui.keymap.begin_edit();
                }
            }))
            .add(new DOM.Element("span", { class: "arrow" }))
            .add(new DOM.Element("span", { class: "queue" }))
            .add(new DOM.Element("span", { class: "message" })
                // Clicking an error dismisses it.
                .listen("click", () => this.dismiss_error()))
            .add(new DOM.Element("span", { class: "fill" }));

        // The command layer, for the pointer as much as the keys.
        this.element.add(button({ class: "hint layer", title: "Commands (;)" }, "", () => {
            if (ui.keymap.active) {
                ui.keymap.leave();
            } else {
                ui.keymap.settle();
                ui.keymap.enter(true);
            }
        }).add(new DOM.Element("kbd").add(";")).add(" commands"));
        for (const name of ["undo", "save", "export", "shortcuts"]) {
            const { label, combinations } = this.actions.get(name);
            this.element.add(button({ class: "hint", "data-action": name }, "", () => {
                this.run(ui, name);
            }).add(new DOM.Element("kbd").add(Keymap.describe(combinations.slice(0, 1)))).add(` ${
                label.toLowerCase()
            }`));
        }

        // What a newcomer needs first, until there is a diagram to work on.
        const shortcuts = Keymap.describe(this.actions.get("shortcuts").combinations.slice(0, 1));
        this.tip = new DOM.Div({ class: "tip hidden" }).add_to(ui.element);
        for (const [keys, description] of [
            ["type", "label"],
            ["click twice", "new cell"],
            ["drag", "arrow"],
            ["; or right-click", "commands"],
            ...(shortcuts !== "" ? [[shortcuts, "help"]] : []),
        ]) {
            this.tip.add(new DOM.Element("span")
                .add(new DOM.Element("kbd").add(keys))
                .add(` ${description}`));
        }

        // A button running the action `name`, titled with its label and keys.
        const action_button = (name, attributes, content) => {
            const { label, combinations } = this.actions.get(name);
            const title = `${label} (${Keymap.describe(combinations)})`;
            return button({ ...attributes, title }, content, () => this.run(ui, name));
        };
        this.element
            .add(new DOM.Element("span", { class: "zoom" })
                .add(action_button("zoom-out", { "data-action": "zoom-out" }, "−"))
                .add(action_button("reset-zoom", { class: "level" }, ""))
                .add(action_button("zoom-in", { "data-action": "zoom-in" }, "+"))
            )
            .add(action_button("settings", { class: "menu" }, "⚙"))
            .add(button({ class: "menu", title: "All commands (:)" }, "≡", () => {
                ui.prompt.open("Command");
            }));

        // Most state the mode line shows (the focus point, labels, the queue) changes without
        // notifying it, so we also refresh it after any input.
        for (const type of ["keydown", "keyup", "pointerup"]) {
            window.addEventListener(type, () => this.schedule_update(ui), true);
        }

        this.update(ui);
    }

    /// Register an action, which `Keymap` binds to its keys (its named binding; see `Bindings`).
    /// The action only runs when `enabled()` holds.
    add_action(ui, name, label, run, enabled = () => true) {
        const combinations = ui.keymap.combinations(name);
        this.actions.set(name, { label, combinations, run, enabled });
    }

    /// Run the action `name`, if it is enabled. Returns whether it ran.
    run(ui, name) {
        const action = this.actions.get(name);
        if (action === undefined || !action.enabled()) {
            return false;
        }
        action.run();
        this.update(ui);
        return true;
    }

    define_actions(ui) {
        const default_pan = [UIMode.Default, UIMode.Pan];
        const any_cells = () => ui.quiver.all_cells().length > 0;

        // Importing and exporting enter their layers (see `Layer`).
        this.add_action(ui, "import", "Import",
            () => ui.keymap.layers.import.toggle(),
        );
        this.add_action(ui, "export", "Export",
            () => ui.keymap.layers.export.toggle(),
        );
        this.add_action(ui, "macros", "Macros",
            () => ui.keymap.layers.macros.toggle(),
        );

        // The diagram's file (see `DiagramFile`).
        this.add_action(ui, "save", "Save", () => ui.file.save());
        this.add_action(ui, "save-as", "Save as", () => ui.file.save_as());
        this.add_action(ui, "open", "Open", () => ui.file.open());
        this.add_action(ui, "new", "New", () => ui.file.new_diagram());

        this.add_action(ui, "undo", "Undo",
            () => ui.history.undo(ui),
            () => ui.in_mode(...default_pan) && ui.history.present !== 0,
        );
        this.add_action(ui, "redo", "Redo",
            () => ui.history.redo(ui),
            () => ui.in_mode(...default_pan) && ui.history.present < ui.history.actions.length,
        );

        this.add_action(ui, "select-all", "Select all",
            () => ui.select(...ui.quiver.all_cells()),
            () => ui.in_mode(...default_pan) && ui.selection.size < ui.quiver.all_cells().length,
        );
        this.add_action(ui, "select-connected", "Select connected",
            () => ui.select(...ui.quiver.connected_components(ui.selection)),
            () => {
                const connected_components = ui.quiver.connected_components(ui.selection);
                return ui.in_mode(...default_pan) && ui.selection.size > 0
                    // The user hasn't already selected all connected components.
                    && (ui.selection.size !== connected_components.size
                        || [...ui.selection].some((cell) => !connected_components.has(cell)));
            },
        );
        this.add_action(ui, "deselect-all", "Deselect",
            () => {
                ui.deselect();
                ui.hide_if_unselected();
                ui.label_input.parent.class_list.add("hidden");
                ui.colour_picker.close();
            },
            () => ui.in_mode(...default_pan) && ui.selection.size > 0,
        );
        // Operations on the selected arrows.
        const edges = () => ui.in_mode(...default_pan) && ui.selection_contains_edge();
        for (const [name, label, kind] of [
            ["reverse", "Reverse", "reverse"],
            ["flip", "Flip", "flip"],
            ["flip-labels", "Flip labels", "flip labels"],
        ]) {
            this.add_action(ui, name, label, () => {
                ui.unqueue_selected();
                ui.history.add(ui, [{ kind, cells: ui.selection }], true);
            }, edges);
        }

        // Clearing keeps the file, and undoes like any deletion.
        this.add_action(ui, "clear", "Clear",
            () => {
                ui.deselect();
                ui.history.add(ui, [{ kind: "delete", cells: new Set(ui.quiver.all_cells()) }],
                    true);
                ui.update_selection();
            },
            () => ui.in_mode(...default_pan) && any_cells(),
        );
        this.add_action(ui, "delete", "Delete", () => {
            ui.history.add(ui, [{
                kind: "delete",
                cells: ui.quiver.transitive_dependencies(ui.selection),
            }], true);
            ui.update_selection();
        }, () => ui.in_mode(...default_pan) && ui.selection.size > 0);

        // Transformations of the whole diagram. Each moves the vertices, and fixes up the edges
        // (including loops, whose angles are absolute).
        const transform = (name, label, move, edges) => {
            this.add_action(ui, name, label, () => {
                const vertices = ui.quiver.all_cells().filter((cell) => cell.is_vertex());
                const bounding_rect = ui.quiver.bounding_rect();
                if (bounding_rect === null) {
                    return;
                }
                const loops = ui.quiver.all_cells().filter((cell) => cell.is_loop());
                ui.history.add(ui, [{
                    kind: "move",
                    displacements: vertices.map((vertex) => ({
                        vertex,
                        from: vertex.position,
                        to: move(bounding_rect, vertex.position),
                    })),
                }, ...edges(loops)], true);
            }, () => ui.in_mode(...default_pan) && any_cells());
        };
        const reflect = (angle) => (loops) => [{
            kind: "flip",
            cells: ui.quiver.all_cells().filter((cell) => cell.is_edge() && !cell.is_loop()),
        }, {
            kind: "reverse",
            cells: loops,
        }, {
            kind: "angle",
            angles: loops.map((edge) => ({
                edge,
                from: edge.options.angle,
                to: angle(edge.options.angle),
            })),
        }];
        transform("flip-hor", "Flip horizontally",
            ([[x_min,], [x_max,]], position) => new Position(
                x_min + (x_max - position.x),
                position.y,
            ),
            reflect((angle) => 180 - angle),
        );
        transform("flip-ver", "Flip vertically",
            ([[, y_min], [, y_max]], position) => new Position(
                position.x,
                y_min + (y_max - position.y),
            ),
            reflect((angle) => -angle),
        );
        transform("rotate", "Rotate",
            ([[x_min, y_min], [x_max,]], position) => new Position(
                x_min + (position.y - y_min),
                y_min - (position.x - x_max),
            ),
            (loops) => [{
                kind: "angle",
                angles: loops.map((edge) => {
                    let to = edge.options.angle - 90;
                    if (to < -180) {
                        to += 360;
                    }
                    return { edge, from: edge.options.angle, to };
                }),
            }],
        );

        this.add_action(ui, "centre-view", "Centre view", () => {
            // If the focus point is focused, we centre on it; otherwise we centre on the
            // selection, or the entire quiver if no cells are selected.
            if (ui.element.query_selector(".focus-point.focused")) {
                ui.pan_to(ui.grid.centre_offset_from_position(ui.focus_position));
            } else {
                ui.centre_view();
            }
        }, () => ui.element.query_selector(".focus-point.focused") !== null
            || ui.selection.size > 0 || any_cells());

        this.add_action(ui, "zoom-out", "Zoom out",
            () => ui.pan_view(Offset.zero(), -0.25),
            () => ui.scale > CONSTANTS.MIN_ZOOM,
        );
        this.add_action(ui, "zoom-in", "Zoom in",
            () => ui.pan_view(Offset.zero(), 0.25),
            () => ui.scale < CONSTANTS.MAX_ZOOM,
        );
        this.add_action(ui, "reset-zoom", "Reset zoom",
            () => {
                ui.scale = ui.default_scale();
                ui.pan_view(Offset.zero());
            },
            () => ui.scale !== ui.default_scale(),
        );

        this.add_action(ui, "hide-grid", "Toggle grid", () => {
            ui.grid_canvas.class_list.toggle("hidden");
        });
        this.add_action(ui, "dark-mode", "Dark mode", () => ui.toggle_dark_mode());
        this.add_action(ui, "hide-mode-line", "Toggle mode line",
            () => ui.element.class_list.toggle("hide-mode-line"),
        );

        this.add_action(ui, "shortcuts", "Help",
            () => ui.keymap.layers.help.toggle(),
        );
        this.add_action(ui, "settings", "Settings",
            () => ui.keymap.layers.settings.toggle(),
        );
    }

    /// Show `text` in the mode line for a few seconds, styled as an error if `error`, unless an
    /// error is waiting to be dismissed.
    flash(text, error = false) {
        if (this.standing) {
            return;
        }
        this.show_message(text, error);
        this.flash_timeout = setTimeout(() => this.show_message("", false), 3000);
    }

    /// Show the error `text` in the mode line until it is dismissed (see `dismiss_error`).
    error(text) {
        this.show_message(text, true);
        this.standing = true;
    }

    /// Clear an error shown in the mode line. Returns whether there was one.
    dismiss_error() {
        const message = this.element.query_selector(".message");
        if (!message.class_list.contains("error")) {
            return false;
        }
        this.show_message("", false);
        return true;
    }

    show_message(text, error) {
        clearTimeout(this.flash_timeout);
        this.standing = false;
        const message = this.element.query_selector(".message").clear().add(text);
        // Long messages are cut short, so the whole of each is also its tooltip.
        message.set_attributes({ title: text });
        message.class_list.toggle("error", error && text !== "");
    }

    /// Update the mode line on the next animation frame. This is cheap to call often.
    schedule_update(ui) {
        if (!this.scheduled) {
            this.scheduled = true;
            requestAnimationFrame(() => {
                this.scheduled = false;
                this.update(ui);
            });
        }
    }

    /// Update the mode line to reflect the state of the UI.
    update(ui) {
        if (this.element === null || ui.focus_point === null) {
            // During initialisation, the `UI` may call `mode_line.update` before everything the
            // mode line describes exists. We may simply ignore this.
            return;
        }

        // The input mode, which also colours the mode line.
        const [mode, detail, kind] = this.mode(ui);
        const badge = this.element.query_selector(".mode").clear().add(mode);
        if (detail !== null) {
            badge.add(new DOM.Element("span", { class: "detail" }).add(detail));
        }
        this.element.set_attributes({ "data-mode": kind });

        // The diagram's file, marked `+` with unsaved changes.
        ui.file.update();
        this.element.query_selector(".file").clear()
            .add(`${ui.file.name()}${ui.file.dirty ? " +" : ""}`)
            .class_list.toggle("dirty", ui.file.dirty);

        // What typing would edit.
        this.element.query_selector(".target").clear().add(this.target(ui));

        // The selected arrow.
        this.element.query_selector(".arrow").clear().add(ModeLine.describe_arrows(ui.selection));

        // The queue of cells awaiting labels, and which of them Tab goes to next.
        ui.keys.mark_next_queued();
        const queued = ui.element.query_selector_all(".cell kbd.queue").length;
        this.element.query_selector(".queue").clear()
            .add(queued > 0 ? `TAB ${queued} queued` : "");

        // Hints and zoom buttons for disabled actions are greyed out.
        for (const element of this.element.query_selector_all("[data-action]")) {
            element.element.disabled
                = !this.actions.get(element.get_attribute("data-action")).enabled();
        }
        this.element.query_selector(".zoom .level").clear()
            .add(`${Math.round(2 ** ui.scale * 100)}%`);
        this.element.query_selector(".layer").class_list.toggle("active", ui.keymap.active);
        this.tip.class_list.toggle("hidden", !ui.quiver.is_empty());

        ui.keymap.update_which_key();
    }

    /// The name of the input mode; any detail (e.g. the number being typed in the command layer),
    /// or `null`; and the kind of mode, for styling (`type`, `layer`, `prompt`, or `other`).
    mode(ui) {
        if (ui.in_mode(UIMode.Command)) {
            return [{
                Search: "/ SEARCH",
                Command: ": CMD",
            }[ui.mode.mode] || ui.mode.mode.toUpperCase(), null, "prompt"];
        }
        const layer = ui.keymap.current_layer();
        if (layer !== null) {
            return [...layer.describe(), "layer"];
        }
        for (const [modes, name] of [
            [[UIMode.PointerMove], "MOVE"],
            [[UIMode.Connect], "CONNECT"],
            [[UIMode.Pan], "PAN"],
        ]) {
            if (ui.in_mode(...modes)) {
                return [name, null, "other"];
            }
        }
        if (ui.keymap.active) {
            return [...ui.keymap.describe_layer(), "layer"];
        }
        return ["TYPE", null, "type"];
    }

    /// The option value for an arrow component (e.g. `top-hook`), as in `Commands.STYLES`.
    static component_value(component) {
        if (component.side !== undefined) {
            return `${component.side}-${component.name}`;
        }
        return component.name === "cell" ? "solid" : component.name;
    }

    /// A compact description of the first selected edge (and how many others are selected): its
    /// kind (or matching preset), then those parameters that differ from the defaults.
    static describe_arrows(selection) {
        const edges = Array.from(selection).filter((cell) => cell.is_edge());
        if (edges.length === 0) {
            return "";
        }
        const { options } = edges[0];
        const { style } = options;
        const parts = [];
        if (style.name !== "arrow") {
            parts.push({ "corner-inverse": "corner (var)" }[style.name] || style.name);
        } else {
            const value = (component) => ModeLine.component_value(style[component]);
            // The "plain" preset is just the default arrow, which we call "arrow" below.
            const preset = Object.entries(Commands.PRESETS).find(([name, preset]) => {
                return name !== "plain" && ["tail", "body", "head"].every((component) => {
                    return preset[component] !== undefined
                        && Commands.STYLES[component][preset[component]] === value(component);
                }) && preset.level === options.level;
            });
            if (preset !== undefined) {
                parts.push(preset[0]);
            } else {
                const defaults = { tail: "none", body: "solid", head: "arrowhead" };
                for (const component of ["tail", "body", "head"]) {
                    if (value(component) !== defaults[component]) {
                        parts.push(`${component} ${value(component).replace("-", " ")}`);
                    }
                }
                if (parts.length === 0) {
                    parts.push("arrow");
                }
                if (options.level !== 1) {
                    parts.push(`level ${options.level}`);
                }
            }
            if (edges[0].is_loop()) {
                parts.push(`radius ${options.radius}`, `angle ${options.angle}`);
            } else if (options.curve !== 0) {
                parts.push(`curve ${options.curve}`);
            }
            const { source, target } = options.shorten;
            if (source !== 0 || target !== 0) {
                parts.push(`length ${source},${100 - target}`);
            }
        }
        if (options.offset !== 0) {
            parts.push(`offset ${options.offset}`);
        }
        if (options.label_position !== 50) {
            parts.push(`position ${options.label_position}`);
        }
        if (options.label_alignment !== "left") {
            parts.push(options.label_alignment);
        }
        if (edges.length > 1) {
            parts.push(`(+${edges.length - 1})`);
        }
        return parts.join(" · ");
    }

    /// A description of what typing would edit (mirroring `Keymap.edit_target`).
    target(ui) {
        const describe = (cell) => {
            const label = cell.label.trim() === "" ? "∅" : cell.label;
            return cell.is_vertex() ? `${label}  (${cell.position.x},${cell.position.y})` : label;
        };
        if (ui.focus_point.class_list.contains("focused")) {
            const cell = ui.cell_under_focus_point();
            if (cell !== null && !ui.selection.has(cell)) {
                return describe(cell);
            }
            if (cell === null) {
                return `new vertex  (${ui.focus_position.x},${ui.focus_position.y})`;
            }
        }
        switch (ui.selection.size) {
            case 0:
                return "";
            case 1:
                return describe(ui.selection.values().next().value);
            default:
                const cells = Array.from(ui.selection);
                const labels = cells.map((cell) => cell.label.trim()).filter((label) => label);
                return `${cells.length} cells${labels.length > 0 ? `: ${
                    labels.slice(0, 4).join(", ")}${labels.length > 4 ? ", …" : ""}` : ""}`;
        }
    }
}
