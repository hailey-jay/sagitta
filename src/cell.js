/// The cells of a diagram: vertices, and the edges between them, each holding both its abstract
/// options (what the tikz-cd says) and its elements on the canvas. `src/arrow.js` draws them.

/// An k-cell (such as a vertex or edge). This object represents both the
/// abstract properties of the cell as well as their HTML representation.
class Cell {
    constructor(quiver, level, label = "", label_colour = Colour.black()) {
        // The k for which this cell is an k-cell.
        this.level = level;

        // The label with which the vertex or edge is annotated.
        this.label = label;

        // The colour of the label (hue, saturation, lightness, alpha).
        this.label_colour = label_colour;

        // The code that the user can type to jump to this cell, which `UI.recode` assigns.
        this.code = "";
        // The order in which Tab visits the cells.
        this.serial = Cell.NEXT_ID++;

        // Add this cell to the quiver.
        quiver.add(this);

        // Elements are specialised depending on whether the cell is a vertex (0-cell) or edge.
        this.element = null;
    }

    /// Set up the cell's element with interaction events.
    initialise(ui) {
        this.element.class_list.add("cell");

        const content_element = this.content_element;

        // Set the label colour.
        if (this.label_colour.is_not_black()) {
            this.element.query_selector(".label").set_style({
                color: this.label_colour.css(),
            });
        }

        // For cells with a separate `content_element`, we allow the cell to be moved
        // by dragging its `element` (under the assumption it doesn't totally overlap
        // its `content_element`). For now, these are precisely the vertices.
        // We allow vertices to be moved by dragging its `element` (which contains its
        // `content_element`, the element with the actual cell content).
        if (this.is_vertex()) {
            this.element.listen("pointerdown", (event) => {
                if (event.button === 0) {
                    if (ui.in_mode(UIMode.Default)) {
                        event.stopPropagation();
                        ui.focus_point.class_list.remove(
                            "revealed", "pending", "active", "focused", "smooth"
                        );
                        const vertices = Array.from(ui.selection).filter(
                            (cell) => cell.is_vertex()
                        );
                        // If the cell we're dragging is part of the existing selection,
                        // then we'll move every cell that is selected. However, if it's
                        // not already part of the selection, we'll just drag this cell
                        // and ignore the selection.
                        const move = new Set(ui.selection.has(this) ? vertices : [this]);
                        ui.switch_mode(
                            new UIMode.PointerMove(
                                ui,
                                ui.position_from_event(event),
                                move,
                            ),
                        );
                    }
                }
            });
        } else {
            // Vertices have custom handling for adding `kbd`, but it's more convenient to handle
            // edges here.
            // The identifier that notifies the user how to jump to this cell.
            this.element.add(new DOM.Element("kbd", {
                "data-code": this.code,
                class: "hint queue",
            }));
        }

        // We record whether a cell was already selected when we click on it, because
        // we only want to trigger a label input focus if we click on a cell that is
        // already selected. Clicking on an unselected cell should not focus the input,
        // or we wouldn't be able to immediately delete a cell with Backspace/Delete,
        // as the input field would capture it.
        let was_previously_selected = true;

        content_element.listen("pointerdown", (event) => {
            // The focus point will have already been removed on a device with a cursor, but on
            // touch devices, we may encounter a `pointerdown` without a corresponding
            // `pointerleave`.
            ui.focus_point.class_list.remove("revealed");

            if (event.button === 0) {
                if (ui.in_mode(UIMode.Default) || ui.in_mode(UIMode.Command)) {
                    event.stopPropagation();
                    event.preventDefault();

                    was_previously_selected = !event.shiftKey && !event.metaKey && !event.ctrlKey
                        && ui.selection.has(this) &&
                        // If the label input is already focused, then we defocus it.
                        // This allows the user to easily switch between editing the
                        // entire cell and the label.
                        !ui.input_is_active();

                    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        // Deselect all other nodes.
                        ui.deselect();
                        ui.select(this);
                        if (this.is_vertex()) {
                            ui.reposition_focus_point(this.position);
                        }
                    } else {
                        // Toggle selection when holding Shift/Command/Control and clicking.
                        if (!ui.selection.has(this)) {
                            ui.select(this);
                        } else {
                            ui.deselect(this);
                        }
                    }

                    ui.keymap.unchoose();

                    // We won't start a new connection immediately, because that will switch
                    // into connect mode prematurely. Instead, we'll add a `.pending` class, which
                    // will then convert to a connection if the pointer leaves the element
                    // while remaining held.
                    this.element.class_list.add("pending");
                    // A plain click on a vertex moves the focus point onto it, so that typing
                    // edits it. Otherwise (an edge, or a multiple selection), we hide the focus
                    // point, so that typing edits the selection.
                    ui.focus_point.class_list.remove("smooth");
                    ui.focus_point.class_list.toggle("focused", this.is_vertex()
                        && !event.shiftKey && !event.metaKey && !event.ctrlKey);
                }
            }
        });

        // Right-clicking a cell selects it, unless it is already selected, for the command layer
        // that the canvas then opens (see `Pointer.context_menu`).
        content_element.listen("contextmenu", () => {
            if (ui.in_mode(UIMode.Default) && !ui.selection.has(this)) {
                ui.deselect();
                ui.select(this);
                if (this.is_vertex()) {
                    ui.reposition_focus_point(this.position);
                }
            }
        });

        content_element.listen("pointerenter", () => {
            if (ui.in_mode(UIMode.Connect)) {
                // The second part of the condition should not be necessary, because pointer events
                // are disabled for reconnected edges, but this acts as a warranty in case this is
                // not working.
                if ((ui.mode.source !== this || ui.mode.loop)
                    && (ui.mode.reconnect === null || ui.mode.reconnect.edge !== this)) {
                    if (
                        Edge.valid_connection(
                            ui, ui.mode.source, this, ui.mode.reconnect)
                    ) {
                        ui.mode.target = this;
                        this.element.class_list.add("target");
                        // Hide the focus point (e.g. if we're connecting a vertex to an edge).
                        ui.focus_point.class_list.remove("revealed", "pending", "active");
                    }
                }
            }
        });

        content_element.listen("pointerleave", (event) => {
            if (this.element.class_list.contains("pending")) {
                this.element.class_list.remove("pending");

                // Start connecting the node.
                const mode = new UIMode.Connect(ui, this, false);
                if (
                    Edge.valid_connection(ui, mode.source, null, mode.reconnect)
                ) {
                    ui.switch_mode(mode);
                    this.element.class_list.add("source");
                }
            }

            if (ui.in_mode(UIMode.Connect)) {
                if (ui.mode.target === this) {
                    ui.mode.target = null;
                }
                // We may not have the "target" class, but we may attempt to remove it
                // regardless. We might still have the "target" class even if this cell
                // is not the target, if we've immediately transitioned from targeting
                // one cell to targeting another.
                this.element.class_list.remove("target");
            }
        });

        content_element.listen("pointerup", (event) => {
            if (event.button === 0) {
                // If we release the pointer without ever dragging, then
                // we never begin connecting the cell.
                this.element.class_list.remove("pending");

                if (ui.in_mode(UIMode.Default)) {
                    // Focus the input if we click on a cell that was already selected. It will
                    // automatically blur when we click on the cell again, so this allows us to
                    // toggle the focus of the input when we click on any cell.
                    if (was_previously_selected) {
                        ui.focus_label_input();
                    }
                }

                if (ui.in_mode(UIMode.Connect)) {
                    event.stopImmediatePropagation();

                    // Connect two cells if the source is different to the target.
                    if (ui.mode.target === this) {
                        const actions = [];
                        const cells = new Set();

                        if (ui.mode.forged_vertex) {
                            cells.add(ui.mode.source);
                        }

                        if (ui.mode.reconnect === null) {
                            // Create a new edge if we're not simply reconnecting an existing one.
                            const edge = ui.mode.connect(ui, event);
                            cells.add(edge);
                        } else {
                            // Otherwise, reconnect the existing edge.
                            const { edge, end } = ui.mode.reconnect;
                            actions.push({
                                kind: "connect",
                                edge,
                                end,
                                from: edge[end],
                                to: ui.mode.target,
                            });
                            ui.mode.connect(ui, event);
                        }

                        // If we haven't created any cells, then we don't need to
                        // record it in the history.
                        if (cells.size > 0) {
                            // We want to make sure `create` comes before `connect`, as
                            // order for history events is important, so we `unshift`
                            // here instead of `push`ing.
                            actions.unshift({
                                kind: "create",
                                cells,
                            });
                        }

                        // We might not have made a meaningful action (e.g. if we're tried
                        // connecting an edge to a node it's already connected to).
                        if (actions.length > 0) {
                            ui.history.add(ui, actions, false, ui.selection_excluding(cells));
                        }
                    } else if (ui.mode.source === this && ui.mode.target === null) {
                        // Here, we released the pointer on the source vertex, but may have forged a
                        // vertex when we began dragging, so we need to add a history event to
                        // record it.
                        if (ui.mode.forged_vertex) {
                            ui.history.add(ui, [{
                                kind: "create",
                                cells: new Set([ui.mode.source]),
                            }]);
                        }
                    }

                    ui.switch_mode(UIMode.default);
                }
            }
        });

        // Add the cell to the UI canvas.
        ui.add_cell(this);
    }

    /// The main element of interaction for the cell. Not necessarily `this.element`, as children
    /// may override this getter.
    get content_element() {
        return this.element;
    }

    /// Whether this cell is an edge (i.e. whether its level is equal to zero).
    is_vertex() {
        return this.level === 0;
    }

    /// Whether this cell is an edge (i.e. whether its level is nonzero).
    is_edge() {
        return this.level > 0;
    }

    /// Whether this cell is a loop.
    is_loop() {
        return this.is_edge() && this.source === this.target;
    }

    select() {
        this.element.class_list.add("selected");
    }

    deselect() {
        this.element.class_list.remove("selected");
    }

    size() {
        if (this.is_vertex()) {
            const label = this.element.query_selector(".label");
            return new Dimensions(label.element.offsetWidth, label.element.offsetHeight);
        } else {
            return Dimensions.zero();
        }
    }
}

// The next cell's `serial`.
Cell.NEXT_ID = 0;

/// 0-cells, or vertices. This is primarily specialised in its set up of HTML elements.
class Vertex extends Cell {
    constructor(ui, label, position, label_colour = Colour.black()) {
        super(ui.quiver, 0, label, label_colour);

        this.position = position;
        // The shape data is going to be overwritten immediately, so really this information is
        // unimportant.
        this.shape = new Shape.RoundedRect(
            Point.zero(),
            new Dimensions(ui.grid.default_size / 2, ui.grid.default_size / 2),
            ui.grid.default_size / 8,
        );
        // This property is only relevant for edges. For vertices, it is always simply the shape.
        this.phantom_shape = this.shape;
        // The label's `[width, height]`, as last measured (see `measure_label`), or `null`.
        this.label_size = null;

        this.render(ui);
        super.initialise(ui);
    }

    get content_element() {
        if (this.element !== null) {
            return this.element.query_selector(".content");
        } else {
            return null;
        }
    }

    /// Changes the vertex's position.
    /// This helper method ensures that column and row sizes are updated automatically.
    set_position(ui, position) {
        ui.grid.unconstrain(this);
        this.position = position;
        this.shape.origin = ui.grid.centre_offset_from_position(this.position);
    }

    /// Create the HTML element associated with the vertex.
    render(ui) {
        const construct = this.element === null;

        // The container for the cell.
        if (construct) {
            this.element = new DOM.Div();
        }

        // Position the vertex.
        const offset = ui.grid.offset_from_position(this.position);
        this.element.set_style({
            left: `${offset.x}px`,
            top: `${offset.y}px`,
        });
        const centre_offset = offset.add(ui.grid.cell_centre_at_position(this.position));
        this.shape.origin = centre_offset;
        // Shape width is controlled elsewhere.

        // Resize according to the grid cell.
        const cell_width = ui.grid.column_width(this.position.x);
        const cell_height = ui.grid.row_height(this.position.y);
        this.element.set_style({
            width: `${cell_width}px`,
            height: `${cell_height}px`,
        });

        if (construct) {
            this.element.class_list.add("vertex");

            // The cell content (containing the label).
            new DOM.Div({ class: "content" })
                .add(new DOM.Div({ class: "label" }))
                // The identifier that notifies the user how to jump to this cell.
                .add(new DOM.Element("kbd", {
                    "data-code": this.code,
                    class: "hint queue",
                }))
                .add_to(this.element);
        }

        // Resize the content according to the grid cell. This is just the default size: it will be
        // updated by `render_maths`.
        this.content_element.set_style({
            width: `${ui.grid.default_size / 2}px`,
            height: `${ui.grid.default_size / 2}px`,
            left: `${cell_width / 2}px`,
            top: `${cell_height / 2}px`,
        });

        if (construct) {
            ui.render_maths(this);
        } else {
            // The vertex may have moved, in which case we need to update the size of the grid cell
            // in which the vertex now lives, as the grid cell may now need to be resized.
            this.recalculate_size(ui);
        }
    }

    /// Calculates the size of the vertex and updates the grid accordingly. This should be called
    /// whenever the size or position may have changed.
    recalculate_size(ui) {
        const size = this.label_size ?? this.measure_label();
        ui.update_cell_size(this, ...size);
        this.resize_content(ui, size);
    }

    /// Measure the label, which only changes size when it is rendered (see `UI.render_maths`), so
    /// that moving the vertex, or relaying out the grid, need not force a layout per vertex.
    measure_label() {
        const { offsetWidth, offsetHeight } = this.element.query_selector(".label").element;
        this.label_size = [offsetWidth, offsetHeight];
        return this.label_size;
    }

    /// Get the size of the cell content.
    content_size(ui, sizes) {
        const [width, height] = sizes;
        return new Dimensions(
            Math.max(ui.grid.default_size / 2, width + CONSTANTS.CONTENT_PADDING * 2),
            Math.max(ui.grid.default_size / 2, height + CONSTANTS.CONTENT_PADDING * 2),
        );
    }

    /// Resize the cell content to match the label width.
    resize_content(ui, sizes) {
        const size = this.content_size(ui, sizes);
        this.content_element.set_style({
            width: `${size.width}px`,
            height: `${size.height}px`,
        });
        this.shape.size = size;
    }
}

/// k-cells (for k > 0), or edges. This is primarily specialised in its set up of HTML elements.
class Edge extends Cell {
    constructor(ui, label, source, target, options, label_colour) {
        super(ui.quiver, Math.max(source.level, target.level) + 1, label, label_colour);

        this.options = Edge.default_options(Object.assign({ level: this.level }, options));

        this.arrow = new Arrow(source.shape, target.shape, new ArrowStyle(), new Label());
        if (this.source === this.target) {
            this.options.shape = "arc";
        }
        this.element = this.arrow.element;

        // `this.shape` is used for the source/target from (higher) cells connected to this one.
        // This is located at the centre of the arrow (it will be updated in `render`).
        this.shape = new Shape.Endpoint(Point.zero());
        // We also record the shape of the edge, if endpoints are not taken into account. E.g. if
        // the target of this edge is a long label XXX, then the phantom shape is the
        // arrow pointing not to the left of the first X, but to the centre of the middle X.
        this.phantom_shape = new Shape.Endpoint(Point.zero());

        this.reconnect(ui, source, target);

        this.initialise(ui);
    }

    /// A set of defaults for edge options: a basic arrow (→).
    static default_options(properties = null, style = null) {
        const options = {
            label_alignment: "left",
            label_position: 50,
            offset: 0,
            curve: 0,
            radius: 3,
            angle: 0,
            shorten: { source: 0, target: 0 },
            level: 1,
            shape: "bezier",
            colour: Colour.black(),
            // Whether to align the source and target of the current edge to the midpoint of the
            // source/target edge (`true`), or to the midpoint of the source and target of the
            // source/target edge (`false`).
            edge_alignment: { source: true, target: true },
            // For historical reasons, the following options are in a `style` subobject. Originally,
            // these were those pertaining to the edge style. However, options such as `curve` and
            // `level` also pertain to the edge style (and can only be set for arrows), but are not
            // placed in `style`. It would be possible to refactor this data structure, but it's
            // inconvenient, as we would still need to maintain support for the old data structure
            // anyway.
            style: {
                name: "arrow",
                tail: { name: "none" },
                body: { name: "cell" },
                head: { name: "arrowhead" },
            },
        };

        // Copy values in `properties` and `style` into `options`.
        const deep_assign = (target, source) => {
            if (typeof source === "undefined" || source === null) {
                return;
            }

            for (const [key, value] of Object.entries(source)) {
                if (typeof value === "object") {
                    target[key] = target[key] || {};
                    deep_assign(target[key], value);
                } else {
                    target[key] = value;
                }
            }
        };

        deep_assign(options, properties);
        deep_assign(options.style, style);

        return options;
    }

    /// Get an `ArrowStyle` from the `options` associated to an edge.
    /// `ArrowStyle` is used simply for styling: we don't use it as an internal data representation
    /// for quivers. This helps keep a separation between structure and drawing, which makes it
    /// easiser to maintain backwards-compatibility.
    static arrow_style_for_options(arrow, options) {
        // By default, `ArrowStyle` have minimal styling.
        const style = new ArrowStyle();

        // All arrow styles support labels, shifting, and colour.
        style.label_position = options.label_position / 100;
        style.shift = options.offset * CONSTANTS.EDGE_OFFSET_DISTANCE;
        style.colour = options.colour.css();

        switch (options.style.name) {
            case "arrow":
                style.level = options.level;
                // `shorten` is interpreted with respect to the arc length of the arrow.
                const curve = arrow.curve();
                try {
                    const [start, end] = arrow.find_endpoints();
                    const arc_length = curve.arc_length(end.t) - curve.arc_length(start.t);
                    style.shorten.tail = arc_length * options.shorten.source / 100;
                    style.shorten.head = arc_length * options.shorten.target / 100;
                } catch (_) {
                    // If we can't find the endpoints, the arrow isn't being drawn, so we don't
                    // need to bother trying to shorten it.
                }

                // Shape.
                switch (options.shape) {
                    case "bezier":
                        style.shape = CONSTANTS.ARROW_SHAPE.BEZIER;
                        style.curve = options.curve * CONSTANTS.CURVE_HEIGHT * 2;
                        break;
                    case "arc":
                        style.shape = CONSTANTS.ARROW_SHAPE.ARC;
                        const radius = [2, 3, 4][Math.floor(Math.abs(options.radius) / 2)];
                        style.curve = radius * Math.sign(options.radius) * CONSTANTS.LOOP_HEIGHT;
                        style.angle = deg_to_rad(options.angle);
                        break;
                }

                // Body style.
                switch (options.style.body.name) {
                    case "squiggly":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY;
                        break;
                    case "barred":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.PROARROW;
                        break;
                    case "double barred":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.DOUBLE_PROARROW;
                        break;
                    case "bullet solid":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.BULLET_SOLID;
                        break;
                    case "bullet hollow":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.BULLET_HOLLOW;
                        break;
                    case "dashed":
                        style.dash_style = CONSTANTS.ARROW_DASH_STYLE.DASHED;
                        break;
                    case "dotted":
                        style.dash_style = CONSTANTS.ARROW_DASH_STYLE.DOTTED;
                        break;
                    case "none":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.NONE;
                        break;
                }

                // Tail style.
                switch (options.style.tail.name) {
                    case "none":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                        break;
                    case "maps to":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.MAPS_TO;
                        break;
                    case "mono":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.MONO;
                        break;
                    case "hook":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE[{
                            "top": "HOOK_TOP",
                            "bottom": "HOOK_BOTTOM",
                        }[options.style.tail.side]];
                        break;
                    case "arrowhead":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.NORMAL;
                        break;
                }

                // Head style.
                switch (options.style.head.name) {
                    case "arrowhead":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE.NORMAL;
                        break;
                    case "none":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                        break;
                    case "epi":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE.EPI;
                        break;
                    case "harpoon":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE[{
                            "top": "HARPOON_TOP",
                            "bottom": "HARPOON_BOTTOM",
                        }[options.style.head.side]];
                        break;
                }
                break;

            // Adjunction (⊣).
            case "adjunction":
                style.body_style = CONSTANTS.ARROW_BODY_STYLE.ADJUNCTION;
                style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                break;

            // Pullback/pushout corner.
            case "corner":
                style.body_style = CONSTANTS.ARROW_BODY_STYLE.NONE;
                style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                style.tails = CONSTANTS.ARROW_HEAD_STYLE.CORNER;
                break;

            // Pullback/pushout corner.
            case "corner-inverse":
                style.body_style = CONSTANTS.ARROW_BODY_STYLE.NONE;
                style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                style.tails = CONSTANTS.ARROW_HEAD_STYLE.CORNER_INVERSE;
                break;
        }

        return style;
    }

    /// Update the `ArrowStyle` associated to an arrow, as well as label formatting, etc.
    /// This is necessary before redrawing.
    static update_style(arrow, options) {
        // Update the arrow style.
        arrow.style = Edge.arrow_style_for_options(arrow, options);
        // Update the label style.
        if (arrow.label !== null) {
            arrow.label.alignment = {
                left: CONSTANTS.LABEL_ALIGNMENT.LEFT,
                right: CONSTANTS.LABEL_ALIGNMENT.RIGHT,
                centre: CONSTANTS.LABEL_ALIGNMENT.CENTRE,
                over: CONSTANTS.LABEL_ALIGNMENT.OVER,
            }[options.label_alignment];
        }
    }

    /// Returns whether the `source` is compatible with the specified `target`.
    /// This first checks that the source is valid at all.
    static valid_connection(ui, source, target, reconnect = null) {
        // To allow `valid_connection` to be used to simply check whether the source is valid,
        // we ignore source--target compatibility if `target` is null.
        // We allow cells to be connected even if they do not have the same level. This is
        // because it's often useful when drawing diagrams, even if it may not always be
        // semantically valid.

        if (source === target) {
            // We currently only permit loops on nodes.
            return source.level === 0;
        }
        if (source.is_loop() || (target !== null && target.is_loop())) {
            // We do not permit loops to be connected to anything else.
            return false;
        }
        const source_target_level = Math.max(source.level, target === null ? 0 : target.level);
        if (source_target_level + 1 > CONSTANTS.MAXIMUM_CELL_LEVEL) {
            return false;
        }

        if (reconnect === null) {
            // If there are no edges depending on this one, then there are no other obstructions to
            // being connectable.
            return true;
        } else {
            if (target === reconnect.edge) {
                // We obviously can't connect an edge to itself.
                return false;
            }

            // We need to check that the dependencies also don't have too great a level after
            // reconnecting.
            // We're going to temporarily increase the level of the edge to what it would be,
            // and check for any edges that then exceed the `MAXIMUM_CELL_LEVEL`. This is
            // conceptually the simplest version of the check.
            const edge_level = reconnect.edge.level;
            reconnect.edge.level = source_target_level + 1;

            let exceeded_max_level = false;

            const update_levels = () => {
                for (const cell of ui.quiver.transitive_dependencies([reconnect.edge], true)) {
                    if (target === cell) {
                        // We shouldn't be able to connect to an edge that's connected to this one.
                        exceeded_max_level = true;
                        break;
                    }
                    cell.level = Math.max(cell.source.level, cell.target.level) + 1;
                    if (cell.level > CONSTANTS.MAXIMUM_CELL_LEVEL) {
                        exceeded_max_level = true;
                        break;
                    }
                }
            };

            // Check for violations of `MAXIMUM_CELL_LEVEL`.
            update_levels();
            // Reset the edge level.
            reconnect.edge.level = edge_level;
            // Reset the levels of its dependencies.
            update_levels();

            return !exceeded_max_level;
        }
    }

    /// Creates a new edge.
    static create(ui, source, target) {
        // The edge itself does all the set up, such as adding itself to the page.
        return new Edge(ui, "", source, target, Edge.suggested_options(ui, source, target));
    }

    /// Returns the suggested default options for an edge, e.g. automatically offsetting to reducing
    /// overlap with existing parallel edges where possible.
    static suggested_options(ui, source, target) {
        const options = {
            // By default, 2-cells and above have a little padding for aesthetic purposes.
            shorten: {
                source: source.level === 0 ? 0 : CONSTANTS.EDGE_EDGE_PADDING,
                target: target.level === 0 ? 0 : CONSTANTS.EDGE_EDGE_PADDING,
            },
            // We will guess the label alignment below, but in case there's no selected label
            // alignment, we default to "left".
            label_alignment: "left",
            // The default settings for the other options are fine.
        };
        // If several edges are selected and they disagree, there is no alignment to take.
        options.label_alignment = ui.arrow_options.label_alignment(ui) ?? "left";

        // The preset of the settings gives the tail, body, and head, and the number of lines,
        // unless the edge's level asks for more.
        const preset = Commands.PRESETS[ui.settings.get("diagram.arrow_preset")];
        options.style = {};
        for (const component of ["tail", "body", "head"]) {
            if (preset[component] !== undefined) {
                options.style[component] = ArrowOptions.style_data(
                    component, Commands.STYLES[component][preset[component]]);
            }
        }
        if (preset.level !== undefined) {
            options.level = Math.max(Math.max(source.level, target.level ?? 0) + 1, preset.level);
        }

        // The following heuristics are only sensible for non-loops, and for which the target is a
        // cell (rather than the pointer).
        if (target instanceof Cell && source !== target) {
            Edge.suggest_from_neighbours(ui, source, target, options);
        }
        if (source === target) {
            Edge.suggest_loop_angle(ui, source, options);
        }
        return options;
    }

    /// Guess the label alignment, offset, and curve of a new edge from `source` to `target`, into
    /// `options`, if the cells being connected form some path with existing connections. Otherwise
    /// the label alignment and the default offset (0) are left as they are.
    static suggest_from_neighbours(ui, source, target, options) {
        // If *every* existing connection to source and target has a consistent label alignment,
        // then `align` will be a singleton, in which case we use that element as the alignment.
        // If it has `left` and `right` in equal measure (regardless of `centre`), then
        // we will pick `centre`. Otherwise we keep the default. And similarly for `offset` and
        // `curve`.
        const align = new Map();
        const offset = new Map();
        const curve = new Map();
        // In our offset heuristic below, where we attempt to avoid overlap, we only
        // wish to consider offset for edges that are not curved.
        const offset_only = new Map();
        // We only want to pick `centre` when the source and target are equally constraining
        // (otherwise we end up picking `centre` far too often). So we check that they're both
        // being considered equally. This means `centre` is chosen only rarely, but often in
        // the situations you want it. (This has no analogue in `offset` or `curve`.)
        let balance = 0;

        const flip = (options) => {
            return {
                label_alignment: {
                    left: "right",
                    centre: "centre",
                    over: "over",
                    right: "left",
                }[options.label_alignment],
                offset: -options.offset,
                curve: -options.curve,
            };
        };

        const conserve = (options, parallel) => {
            return {
                label_alignment: options.label_alignment,
                // We ignore the offsets and curves of edges that don't share a source and
                // target with the new edge, i.e. we only modify the offset and curve of
                // parallel edges.
                offset: parallel ? options.offset : null,
                curve: parallel ? options.curve : null,
            };
        };

        const consider = (options, tip) => {
            if (!align.has(options.label_alignment)) {
                align.set(options.label_alignment, 0);
            }
            align.set(options.label_alignment, align.get(options.label_alignment) + 1);
            if (options.offset !== null) {
                if (!offset.has(options.offset)) {
                    offset.set(options.offset, 0);
                }
                offset.set(options.offset, offset.get(options.offset) + 1);
            }
            if (options.offset !== null && (options.curve === null || options.curve === 0)) {
                if (!offset_only.has(options.offset)) {
                    offset_only.set(options.offset, 0);
                }
                offset_only.set(options.offset, offset_only.get(options.offset) + 1);
            }
            if (options.curve !== null) {
                if (!curve.has(options.curve)) {
                    curve.set(options.curve, 0);
                }
                curve.set(options.curve, curve.get(options.curve) + 1);
            }
            balance += tip;
        };

        const source_dependencies = ui.quiver.dependencies_of(source);
        const target_dependencies = ui.quiver.dependencies_of(target);
        for (const [edge, relationship] of source_dependencies) {
            // We consider each edge whose source or target is the source of the new edge.
            consider(conserve({
                // If the source of the edge is the same as the source of the new edge, we want
                // to invert the offset/curve/etc., so that the new edge will not overlap the
                // new one.
                source: flip(edge.options),
                target: edge.options,
            }[relationship], target_dependencies.has(edge)), -1);
        }
        for (const [edge, relationship] of target_dependencies) {
            // We consider each edge whose source or target is the target of the new edge.
            consider(conserve({
                source: edge.options,
                // If the target of the edge is the same as the target of the new edge, we want
                // to invert the offset/curve/etc., so that the new edge will not overlap the
                // new one.
                target: flip(edge.options),
            }[relationship], source_dependencies.has(edge)), 1);
        }

        if (align.size === 1) {
            options.label_alignment = align.keys().next().value;
        } else if (align.size > 0
                && align.get("left") === align.get("right") && balance === 0) {
            options.label_alignment = "centre";
        }

        if (offset.size === 1) {
            options.offset = offset.keys().next().value;
        }
        if (curve.size === 1) {
            options.curve = curve.keys().next().value;
        }

        // If there was not precisely one parallel edge that had a non-zero offset, then we try
        // to offset the new edge to reduce overlap with existing edges.
        if (!options.hasOwnProperty("offset") || options.offset === 0) {
            // We try to offset somewhat symmetrically, and with decent spacing. It seems most
            // convenient to hardcode the following values, as the pattern is not particularly
            // uniform.
            const offset_attempts = [0, -3, 3, -5, 5, -1, 1, -2, 2, -4, 4];
            while (offset_attempts.length > 0) {
                const attempt = offset_attempts.shift();
                // We need to negate because the offsets in `offset` are negated, because they
                // record offset candidates, rather than offsets that are present.
                if (!offset_only.has(-attempt)) {
                    options.offset = attempt;
                    break;
                }
            }
        }
    }

    /// Guess the angle of a new loop on `vertex`, into `options`.
    static suggest_loop_angle(ui, vertex, options) {
        // We try to place new loops at a new angle, if possible, to reducing overlap with
        // existing loops.
        const angles = new Map();
        for (const [loop,] of Array.from(ui.quiver.dependencies_of(vertex))
            .filter(([edge,]) => edge.is_loop()))
        {
            const angle = mod(
                loop.options.angle + 180 - (loop.options.radius < -1 ? 180 : 0), 360) - 180;
            angles.set(angle, Math.abs(loop.options.radius));
            // Both -180 and 180 are possible angle values for symmetry, but they should count
            // as the same angle.
            if (Math.abs(angle) === 180) {
                angles.set(-angle, Math.abs(loop.options.radius));
            }
        }
        let found_space = false;
        // First, attempt to find an angle at which there exists no loop.
        for (let angle = 0; angle < 360; angle += 45) {
            const attempt_angle = mod(180 - angle, 360) - 180;
            if (!angles.has(attempt_angle)) {
                options.angle = attempt_angle;
                found_space = true;
                break;
            }
        }
        if (!found_space) {
            // Next, attempt to find an angle at which there is no loop of the default radius.
            for (let angle = 0; angle < 360; angle += 45) {
                const attempt_angle = mod(180 - angle, 360) - 180;
                if (angles.get(attempt_angle) !== 3) {
                    options.angle = attempt_angle;
                    break;
                }
            }
        }
    }

    initialise(ui) {
        super.initialise(ui);

        // We allow users to reconnect edges to different cells by dragging their endpoint handles.
        const reconnect = (event, end) => {
            event.stopPropagation();
            event.preventDefault();
            // We don't get the default blur behaviour here, as we've prevented it, so we have to do
            // it ourselves.
            ui.label_input.element.blur();
            ui.focus_point.class_list.remove("focused", "smooth");

            const fixed = { source: this.target, target: this.source }[end];
            ui.switch_mode(new UIMode.Connect(ui, fixed, false, {
                end,
                edge: this,
            }));
        };

        // Set up the endpoint handle interaction events.
        for (const end of ["source", "target"]) {
            const handle = this.arrow.element.query_selector(`.arrow-endpoint.${end}`);
            // If an invalid edge has been created (e.g. during tikz-cd parsing), the arrow may not
            // have handles.
            if (handle !== null) {
                handle.listen("pointerdown", (event) => {
                    if (event.button === 0) {
                        reconnect(event, end);
                    }
                });
            }
        }

        ui.render_maths(this);
    }

    /// Create the HTML element associated with the edge.
    /// Note that `render_maths` triggers redrawing the edge, rather than the other way around.
    render(ui, pointer_offset = null) {
        if (pointer_offset !== null) {
            const end = ui.mode.reconnect.end;
            if (ui.mode.target !== null) {
                // In this case, we're hovering over another cell.
                this.arrow[end] =
                    (ui.mode.target.is_vertex() || this.options.edge_alignment[end]) ?
                        ui.mode.target.shape : ui.mode.target.phantom_shape
            } else {
                // In this case, we're not hovering over another cell.
                // Usually we offset edge endpoints from the cells to which they are connected,
                // but when we are dragging an endpoint, we want to draw it right up to the pointer.
                this.arrow[end] = new Shape.Endpoint(pointer_offset);
            }
        } else {
            for (const end of ["source", "target"]) {
                this.arrow[end] = this.options.edge_alignment[end] ?
                    this[end].shape : this[end].phantom_shape
            }
        }

        Edge.update_style(this.arrow, this.options);
        this.arrow.redraw();

        // Update the origin, which is given by the centre of the edge.
        const curve = this.arrow.curve(Point.zero(), 0);
        const midpoint = curve.point(0.5);
        let centre = null;
        try {
            // Preferably, we take the centre relative to the endpoints, rather than the
            // source and target.
            const [start, end] = this.arrow.find_endpoints();
            centre = curve.point((start.t + end.t) / 2);
        } catch (_) {
            // If we're not reconnecting the edge, and we can't find the endpoints, we just take
            // the centre relative to the source and target.
            centre = midpoint;
        }
        if (centre !== null) {
            const relative_position = (position) => {
                return this.arrow.source.origin.add(
                    position.add(new Point(0, this.arrow.style.shift)).rotate(this.arrow.angle()),
                );
            };
            // `centre` will be `null` only if we've already updated the origin.
            this.shape.origin = relative_position(centre);
            this.phantom_shape.origin = relative_position(midpoint);
        }

        // Move the jump label to the centre of the edge. We may not have created the `kbd` element
        // yet, during initialisation, so we need to check.
        const jump_label = this.element.query_selector("kbd");
        if (jump_label) {
            jump_label.set_style({
                left: `${this.shape.origin.x}px`,
                top: `${this.shape.origin.y}px`,
            });
        }

        // We override the source and target whilst drawing, so we need to reset them.
        this.arrow.source = this.source.shape;
        this.arrow.target = this.target.shape;
    }

    /// Returns the angle of this edge.
    angle() {
        if (this.is_loop()) {
            return deg_to_rad(this.options.angle);
        }
        return this.target.shape.origin.sub(this.source.shape.origin).angle();
    }

    /// Changes the source and target.
    reconnect(ui, source, target) {
        ui.quiver.connect(source, target, this);
        this.options.shape = source !== target ? "bezier" : "arc";
        for (const end of ["source", "target"]) {
            if (this[end].is_vertex()) {
                this.options.edge_alignment[end] = true;
            }
        }
        for (const cell of ui.quiver.transitive_dependencies([this])) {
            cell.render(ui);
        }
        // The codes of edges name their ends.
        ui.recode();
        ui.update_selection();
    }

    /// Flips the edge, so that what was on the left is now on the right. If `flip_arrow` is true,
    /// this includes offset and head/tail style. Otherwise it only flips the label alignment.
    flip(ui, flip_arrow, skip_dependencies = false) {
        this.options.label_alignment = {
            left: "right",
            centre: "centre",
            over: "over",
            right: "left",
        }[this.options.label_alignment];
        if (flip_arrow) {
            this.options.offset = -this.options.offset;
            this.options.curve = -this.options.curve;
            if (this.is_loop()) {
                this.options.radius = -this.options.radius;
            }
            if (this.options.style.name === "arrow") {
                const swap_sides = { top: "bottom", bottom: "top" };
                if (this.options.style.tail.name === "hook") {
                    this.options.style.tail.side = swap_sides[this.options.style.tail.side];
                }
                if (this.options.style.head.name === "harpoon") {
                    this.options.style.head.side = swap_sides[this.options.style.head.side];
                }
            }
        }

        this.render(ui);

        if (flip_arrow && !skip_dependencies) {
            for (const cell of ui.quiver.transitive_dependencies([this])) {
                cell.render(ui);
            }
        }
    }

    /// Reverses the edge, swapping the `source` and `target`.
    reverse(ui) {
        // Flip all the dependency relationships.
        for (const cell of ui.quiver.reverse_dependencies_of(this)) {
            const dependencies = ui.quiver.dependencies.get(cell);
            dependencies.set(
                this,
                { source: "target", target: "source" }[dependencies.get(this)],
            );
        }

        // Swap the `source` and `target`.
        [this.source, this.target] = [this.target, this.source];
        [this.arrow.source, this.arrow.target] = [this.source.shape, this.target.shape];

        if (this.is_loop()) {
            this.options.angle = mod(this.options.angle + 360, 360) - 180;
        }
        // Reverse the label alignment and edge offset as well as any oriented styles.
        // Flipping the label will also cause a rerender.
        // Note that since we do this, the position of the edge will remain the same, which
        // means we don't need to rerender any of this edge's dependencies.
        this.flip(ui, true, true);
    }
}
