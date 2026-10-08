/// Various states for the UI (e.g. whether cells are being rearranged, or connected, etc.).
class UIMode {
    constructor() {
        // Used for the CSS class associated with the mode. `null` means no class.
        this.name = null;
    }

    /// A placeholder method to clean up any state when a mode is left.
    release() {}
}

/// The default mode, representing no special action.
UIMode.Default = class extends UIMode {
    constructor() {
        super();

        this.name = "default";
    }
};
UIMode.default = new UIMode.Default();

/// Two k-cells are being connected by an (k + 1)-cell.
UIMode.Connect = class extends UIMode {
    constructor(ui, source, forged_vertex, reconnect = null) {
        super();

        this.name = "connect";

        // The source of a connection between two cells.
        this.source = source;

        // The target of a connection between two cells.
        this.target = null;

        // Whether the source of this connection was created with the start
        // of the connection itself (i.e. a vertex was created after dragging
        // from an empty grid cell).
        this.forged_vertex = forged_vertex;

        // If `reconnect` is not null, then we're reconnecting an existing edge.
        // In that case, rather than drawing a phantom arrow, we'll actually
        // reposition the existing edge.
        // `reconnect` is of the form `{ edge, end }` where `end` is either
        // `"source"` or `"target"`.
        this.reconnect = reconnect;

        // Whether we have dragged far enough from the source to trigger the loop mode.
        this.loop = false;

        if (this.reconnect === null) {
            // The overlay for drawing an edge between the source and the cursor.
            this.overlay = new DOM.Div({ class: "overlay" });
            this.arrow = new Arrow(
                new Shape.Endpoint(Point.zero()),
                new Shape.Endpoint(Point.zero()),
            );
            this.overlay.add(this.arrow.element);
            ui.canvas.add(this.overlay);
        } else {
            this.reconnect.edge.element.class_list.add("reconnecting");
        }
    }

    release(ui) {
        this.source.element.class_list.remove("source");
        if (this.target !== null) {
            this.target.element.class_list.remove("target");
            this.target = null;
        }
        // If we're connecting from an focus point, then we need to hide it again.
        ui.focus_point.class_list.remove("revealed");
        if (this.reconnect === null) {
            this.overlay.remove();
            this.arrow = null;
        } else {
            this.reconnect.edge.element.class_list.remove("reconnecting");
            for (const cell of ui.quiver.transitive_dependencies([this.reconnect.edge])) {
                cell.render(ui);
            }
            this.reconnect = null;
        }
        this.loop = false;
    }

    /// Update the overlay with a new cursor position.
    update(ui, offset) {
        // If we're creating a new edge...
        if (this.reconnect === null) {
            // We're drawing the edge again from scratch, so we need to remove all existing
            // elements.
            const svg = this.overlay.query_selector("svg");
            svg.clear();
            // Lock on to the target if present, otherwise simply draw the edge
            // to the position of the cursor.
            const target = this.target !== null ? this.target : {
                shape: new Shape.Endpoint(offset),
                level: 0,
            };

            this.arrow.source = this.source.shape;
            this.arrow.target = target.shape;
            const level = Math.max(this.source.level, target.level) + 1;
            const distance = this.arrow.target.origin.sub(this.arrow.source.origin).length();
            // We only permit loops on vertices, not edges.
            if (level === 1 && distance >= CONSTANTS.ARC.OUTER_DIS) {
                this.loop = true;
            }

            this.arrow.style = Edge.arrow_style_for_options(
                this.arrow,
                Edge.default_options(Object.assign({
                    level,
                    shape: this.loop && (this.target === null || this.source === this.target)
                        ? "arc" : "bezier",
                }, Edge.suggested_options(ui, this.source, target))),
            );

            this.arrow.redraw();
        } else {
            // We're reconnecting an existing edge.

            // Note that we currently do not permit existing edges to be converted into loops,
            // simply because the desired behaviour is subtle (e.g. we don't want edges with
            // dependencies to be converted, and we'd have to interpolate curves into loops, etc.).
            // Thus, the only time `this.loop` will be true is if we're reconnecting an existing
            // loop. We can convert loops into non-loops.
            this.loop = this.reconnect.edge.is_loop();

            this.reconnect.edge.render(ui, offset);
            for (const cell of ui.quiver.transitive_dependencies([this.reconnect.edge], true)) {
                cell.render(ui);
            }
        }
    }

    /// Connects the source and target. Note that this does *not* check whether the source and
    /// target are compatible with each other.
    connect(ui, event) {
        if (this.reconnect === null) {
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                ui.deselect();
            }
            const edge = Edge.create(ui, this.source, this.target);
            ui.select(edge);
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                ui.label_input.element.focus();
            }
            return edge;
        } else {
            // Reconnect an existing edge.
            const { edge, end } = this.reconnect;
            // We might be reconnecting an edge by its source, in which case, we need to switch
            // the traditional order of `source` and `target`, because the "source" will actually
            // be the target and vice versa.
            // Generally, the fixed end is always `this.source`, even if it isn't actually the
            // edge's source. This makes the interaction behaviour simpler elsewhere, because
            // one can always assume that `mode.target` is the possibly-null, moving endpoint
            // that is the one of interest.
            const [source, target] = {
                source: [this.target, this.source],
                target: [this.source, this.target],
            }[end];
            edge.reconnect(ui, source, target);
            return edge;
        }
    }
};

/// Cells are being moved to a different position, via the pointer.
UIMode.PointerMove = class extends UIMode {
    constructor(ui, origin, selection) {
        super();

        this.name = "pointer-move";

        /// The location from which the move was initiated.
        this.origin = origin;

        /// The location relative to which positions were last updated.
        this.previous = this.origin;

        /// The group of cells that should be moved.
        this.selection = selection;

        // Cells that are being moved are not considered part of the grid of cells
        // and therefore do not interact with one another.
        for (const cell of selection) {
            ui.positions.delete(`${cell.position}`);
        }
    }

    release(ui) {
        // Make sure we're not trying to release any cells on top of existing ones.
        for (const cell of this.selection) {
            if (ui.positions.has(`${cell.position}`)) {
                throw new Error(
                    "new cell position already contains a cell:",
                    ui.positions.get(`${cell.position}`),
                );
            }
        }
        // Now we know the positions are free, we can set them with impunity.
        for (const cell of this.selection) {
            ui.positions.set(`${cell.position}`, cell);
        }
    }
};

/// The UI view is being panned.
UIMode.Pan = class extends UIMode {
    constructor(key) {
        super();

        this.name = "pan";

        /// The location from which the pan was initiated (used to update the view relative to the
        /// origin).
        this.origin = null;

        /// The key with which the pan was initiated. Multiple keys (Option and Control) can be used
        /// for panning, so we need to make sure that we're consistent about the key we listen for
        /// when panning.
        this.key = key;
    }
};

/// The user is jumping to a cell.
UIMode.Command = class extends UIMode {
    constructor(ui, mode) {
        super();

        this.name = "command";

        ui.label_input.element.value = "";
        this.switch_mode(ui, mode);
        ui.label_input.parent.class_list.remove("hidden");
        ui.label_input.remove_attributes("disabled");
        ui.label_input.element.focus();
    }

    release(ui) {
        ui.prompt.release();
        const focused_cells = ui.element.query_selector_all(
            ".cell kbd.focused, .cell kbd.partially-focused"
        );
        for (const element of focused_cells) {
            element.class_list.remove("focused", "partially-focused");
            element.clear();
        }
        ui.label_input.element.blur();
        ui.update_selection();
        ui.mode_line.update(ui);
        ui.hide_if_unselected();
    }

    switch_mode(ui, mode) {
        this.mode = mode;
        ui.element.query_selector(".input-mode").replace(this.mode);
    }
};
