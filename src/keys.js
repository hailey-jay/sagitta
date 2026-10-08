/// What the keys that edit the diagram do, in the base layer: Enter, Tab, Space, Escape, the
/// arrow keys, the hint-code prompts, and the clipboard. `Keymap.BINDINGS` says which keys these
/// are, and when each applies.
class Keys {
    constructor(ui) {
        this.ui = ui;

        // The cells last copied or cut, encoded (see `copy`).
        this.clipboard = "";
    }

    /// Enter: submit a hint-code prompt; otherwise edit the targeted cell's label in place, or,
    /// while editing, confirm it (typing a character instead replaces the label: see
    /// `Keymap.after`).
    enter() {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Command)) {
            // Get the list of IDs to select.
            const mode = ui.mode.mode;

            const codes = new Set(ui.label_input.element.value.split(" "));
            if (mode === "Select") {
                // Deselect all selected cells.
                ui.deselect();
            }
            let repositioned_focus_point = false;
            let final_selection = null;
            const actions = [];
            for (const code of codes) {
                const cell = ui.codes.get(code);
                if (cell !== undefined && ui.quiver.contains_cell(cell)) {
                    switch (mode) {
                        case "Select":
                        case "Toggle":
                            if (!ui.selection.has(cell)) {
                                ui.select(cell);
                            } else {
                                ui.deselect(cell);
                            }
                            // Focus on the first vertex that the user typed.
                            if (!repositioned_focus_point && cell.is_vertex()) {
                                ui.reposition_focus_point(cell.position);
                                repositioned_focus_point = true;
                            }
                            break;
                        case "Source":
                        case "Target":
                            const end = mode.toLowerCase();
                            const edges = Array.from(ui.selection)
                                .filter((cell) => cell.is_edge());
                            for (const edge of edges) {
                                const source = mode === "Source" ? cell : edge.source;
                                const target = mode === "Target" ? cell : edge.target;
                                const valid_connection = Edge.valid_connection(
                                    ui,
                                    { source: target, target: source }[end],
                                    { source, target }[end],
                                    { end, edge },
                                );
                                if (valid_connection) {
                                    actions.push({
                                        kind: "connect",
                                        edge,
                                        end,
                                        from: edge[end],
                                        to: cell,
                                    });
                                    edge.reconnect(ui, source, target);
                                }
                            }
                            break;
                        case "Create":
                            const created = new Set();
                            for (const source of ui.selection) {
                                const valid_connection = Edge.valid_connection(
                                    ui,
                                    source,
                                    cell,
                                );
                                if (valid_connection) {
                                    created.add(
                                        Edge.create(ui, source, cell)
                                    );
                                }
                            }
                            if (created.size > 0) {
                                if (final_selection === null) {
                                    final_selection = new Set();
                                }
                                final_selection = new Set([...final_selection, ...created]);
                                actions.push({
                                    kind: "create",
                                    cells: created,
                                });
                            }
                            break;
                    }
                }
            }
            if (final_selection !== null) {
                ui.deselect();
                ui.select(...final_selection);
            }
            if (actions.length > 0) {
                ui.history.add(ui, actions);
            }
            ui.switch_mode(UIMode.default);
        } else {
            // Toggle the focus of the label input. Focusing edits the label in place (typing
            // a character instead replaces it: see `Keymap.after`).
            const input = ui.label_input.element;
            if (document.activeElement !== input) {
                if (ui.keymap.edit_target(false)) {
                    ui.keymap.begin_edit();
                }
            } else {
                // Pressing Enter "confirms" the currently selected queued cells.
                ui.unqueue_selected();
                input.blur();
            }
        }
    }

    /// The queued cell Tab goes to next (going backwards when `sign` is -1): the first in the queue
    /// after any selected cell (queued or not), or `null` if no other cell is queued.
    next_queued(sign = 1) {
        const ui = this.ui;
        const unselected = Array.from(
            ui.element.query_selector_all(".cell:not(.selected) kbd.queue")
        );
        if (unselected.length === 0) {
            return null;
        }
        // Check there is a selected cell. If not, we will use the first or last queued cell.
        if (ui.element.query_selector(".cell.selected kbd") === null) {
            return ui.codes.get((
                sign > 0 ? unselected[0] : unselected[unselected.length - 1]
            ).get_attribute("data-code"));
        }
        // Find the first queued cell after the first selected cell, cycling back to the start
        // (or the end, going backwards) after the end.
        const cells = Array.from(ui.codes.values());
        const selected_index = cells.findIndex((cell) => {
            return cell.element.class_list.contains("selected");
        });
        const count = cells.length;
        for (let step = 1; step < count; ++step) {
            const cell = cells[((selected_index + sign * step) % count + count) % count];
            if (!cell.element.class_list.contains("selected")
                && cell.element.query_selector("kbd.queue") !== null
            ) {
                return cell;
            }
        }
        return null;
    }

    /// Mark the hint of the queued cell Tab goes to next, which is the only one shown while
    /// cycling through the queue.
    mark_next_queued() {
        const next = this.next_queued();
        for (const element of this.ui.element.query_selector_all("kbd.next")) {
            element.class_list.remove("next");
        }
        if (next !== null) {
            next.element.query_selector("kbd").class_list.add("next");
        }
    }

    /// Tab (Shift+Tab backwards) labels the next queued cell, or concludes labelling.
    tab(event) {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Default)) {
            ui.keymap.unchoose();
            ui.cancel_creation();
            ui.focus_point.class_list.remove("focused", "smooth");

            // If there are any cells in the queue, we may cycle through them using Tab. Holding
            // Shift cycles in reverse order.
            const select = this.next_queued(!event.shiftKey ? 1 : -1);
            if (select !== null) {
                // Deselect all other cells.
                ui.deselect();
                ui.select(select);
                // Bring the label input in sync with the selection.
                ui.update_selection();
                ui.hide_if_unselected();
                // Display the queue.
                ui.element.class_list.add("show-queue");
                // Bring up the label input and select the text.
                ui.focus_label_input();
            } else if (document.activeElement === ui.label_input.element) {
                // After emptying the queue, it is natural to press Tab again to conclude.
                // In this case, we do not want to bring up the command interface. Thus,
                // when the label input is focused, Tab instead defocuses everything.
                ui.deselect();
                ui.update_selection();
                ui.hide_if_unselected();
            } else if (ui.element.query_selector("kbd.queue") !== null) {
                // In this case, we have no other cells in the queue to switch to. We simply
                // focus the label input if it is not focused, and otherwise do nothing.
                ui.focus_label_input();
            }
        } else {
            ui.switch_mode(UIMode.default);
        }
    }

    /// The hint-code prompts, from the command layer: `'` toggles the cells whose codes are
    /// typed, and `,` and `.` change the selected arrows' source and target. Within a prompt, they
    /// switch between its modes. In the base layer, `/` searches instead (which also accepts
    /// codes).
    code_prompt(mode) {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Default) || ui.in_mode(UIMode.Command)) {
            if (ui.selection_contains_edge() || mode === "Toggle") {
                ui.keymap.leave();
                if (ui.in_mode(UIMode.Default)) {
                    // We use `Defer` instead of `Conservative` so that we can switch modes by
                    // pressing the various command keys (when the input will be focused), but
                    // when we are in the default mode, we don't want to trigger command mode
                    // if we are editing any input.
                    if (!ui.input_is_active()) {
                        ui.keymap.unchoose();
                        // We won't actually be creating anything, but the focus point might be
                        // visible, in which case the following will hide it.
                        ui.cancel_creation();
                        ui.focus_point.class_list.remove("focused", "smooth");
                        ui.switch_mode(new UIMode.Command(ui, mode));
                    }
                } else if (ui.mode.mode !== mode) {
                    ui.mode.switch_mode(ui, mode);
                } else {
                    ui.switch_mode(UIMode.default);
                }
            }
        }
    }

    /// Escape does at most one thing, the first of these that applies, so that it may be
    /// pressed repeatedly: dismiss an error; cancel a move or a creation; leave the label input;
    /// let go of what the command layer was setting; deselect; hide the focus point; unqueue.
    escape() {
        const ui = this.ui;
        // In the following, we return if we perform any successful action. This means Escape
        // will do at most one thing, and the user may press Escape repeatedly if necessary.

        // If an error banner is visible, the first thing Escape will do is dismiss the banner.
        if (UI.dismiss_error()) {
            return;
        }

        if (ui.in_mode(UIMode.PointerMove)) {
            ui.switch_mode(UIMode.default);
            return;
        }

        if (ui.cancel_creation()) {
            return;
        }

        // Defocus the label input. This works both in normal mode and in command mode.
        const input = ui.input_is_active();
        if (input) {
            input.blur();
            return;
        }

        // Let go of what the command layer was setting.
        if (ui.keymap.property !== null || ui.keymap.component !== null) {
            ui.keymap.unchoose();
            ui.mode_line.update(ui);
            return;
        }

        // Defocus selected cells.
        if (ui.element.query_selector(".cell.selected")) {
            ui.deselect();
            ui.hide_if_unselected();
            ui.label_input.parent.class_list.add("hidden");
            ui.colour_picker.close();
            return;
        }

        if (ui.focus_point.class_list.contains("focused")) {
            ui.focus_point.class_list.remove("focused", "smooth");
            ui.mode_line.update(ui);
            return;
        }

        // Unqueue queued cells.
        if (ui.element.class_list.contains("show-queue")) {
            for (const element of ui.element.query_selector_all("kbd.queue")) {
                element.class_list.remove("queue");
            }
        }
    }

    /// Select, or deselect, the cell under the focus point ("S" for "Select").
    toggle_at_focus() {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Default)) {
            if (ui.focus_point.class_list.contains("focused")) {
                const cell_under_focus_point = ui.cell_under_focus_point();
                if (cell_under_focus_point !== null) {
                    if (!ui.selection.has(cell_under_focus_point)) {
                        ui.select(cell_under_focus_point);
                    } else {
                        ui.deselect(cell_under_focus_point);
                        ui.hide_if_unselected();
                    }
                }
            }
        }
    }

    /// Space: create a vertex at the focus point (or take the one there), connected to the
    /// selected vertices. With Shift, only toggle whether the vertex there is selected.
    space(event) {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Default)) {
            if (ui.focus_point.class_list.contains("focused") && event.shiftKey) {
                const cell = ui.cell_under_focus_point();
                if (cell !== null) {
                    if (!ui.selection.has(cell)) {
                        ui.select(cell);
                    } else {
                        ui.deselect(cell);
                        ui.hide_if_unselected();
                    }
                }
            } else if (ui.focus_point.class_list.contains("focused")) {
                const selected = Array.from(ui.codes)
                    .filter(([, cell]) => cell.is_vertex() && ui.selection.has(cell));
                if (!ui.positions.has(`${ui.focus_position}`)) {
                    const target = ui.create_vertex_at_focus_point(event);
                    // Connect any selected vertices to the target.
                    const edges = selected.map(([, source]) => {
                        return Edge.create(ui, source, target);
                    });
                    ui.order_before(target, ...edges);
                    const actions = [{
                        kind: "create",
                        cells: new Set([target, ...edges]),
                    }];
                    ui.history.add(
                        ui,
                        actions,
                    );
                } else {
                    const target = ui.positions.get(`${ui.focus_position}`);
                    selected.forEach(([, source]) => {
                        // The `target` vertex already exists, so it may already be selected.
                        // In this case, we do not want to try to connect it to itself.
                        if (source !== target) {
                            const edge = Edge.create(ui, source, target);
                            ui.history.add(
                                ui,
                                [{
                                    kind: "create",
                                    cells: new Set([edge]),
                                }],
                            );
                        }
                    });
                    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        ui.deselect();
                    }
                    ui.select(target);
                }
            } else {
                // Move the focus point back to where it was the last time it was moved using
                // the keyboard (or the user clicked somewhere on the canvas).
                ui.reposition_focus_point(ui.focus_position);
                ui.focus_point.class_list.remove("revealed", "pending", "active");
                ui.focus_point.class_list.add("focused");
                ui.mode_line.update(ui);
                delay(() => ui.focus_point.class_list.add("smooth"));
            }
        }
    }

    /// The arrow keys: step the property the command layer is setting; otherwise move the focus
    /// point (extending the selection with Shift). While panning (holding Control or Option),
    /// move the selection instead, or, when only arrows are selected, bend or shift them (see
    /// `ArrowOptions.nudge`).
    arrow(event) {
        const ui = this.ui;
        let delta = 0;
        if (event.key === "ArrowLeft") {
            --delta;
        }
        if (event.key === "ArrowRight") {
            ++delta;
        }
        const panning = ui.in_mode(UIMode.Pan);
        if (!panning && ui.keymap.step_property(delta)) {
            // While the command layer is setting a property, the arrow keys step it rather
            // than moving the selection.
            return;
        }

        let position_delta;
        switch (event.key) {
            case "ArrowLeft":
                position_delta = new Position(-1, 0);
                break;
            case "ArrowDown":
                position_delta = new Position(0, 1);
                break;
            case "ArrowRight":
                position_delta = new Position(1, 0);
                break;
            case "ArrowUp":
                position_delta = new Position(0, -1);
                break;
        }

        if (ui.in_mode(UIMode.Default)) {
            // Holding Shift extends the selection by the cells the focus point passes over, as
            // in a spreadsheet: the one it leaves (if it was visible) and the one it reaches.
            if (event.shiftKey) {
                const positions = [ui.focus_position.add(position_delta)];
                if (ui.focus_point.class_list.contains("focused")) {
                    positions.push(ui.focus_position);
                }
                ui.select(...positions
                    .map((position) => ui.positions.get(`${position}`))
                    .filter((cell) => cell !== undefined));
            }

            // Reveal the focus point if it wasn't already visible.
            if (!ui.focus_point.class_list.contains("focused")) {
                ui.focus_point.class_list.remove("revealed", "pending", "active");
                ui.focus_point.class_list.add("focused");
                ui.mode_line.update(ui);
                // We first reposition to the correct location, then add the delta after adding
                // the `smooth` class (directly below), so that it animates to the new position.
                ui.reposition_focus_point(ui.focus_position);
                delay(() => {
                    ui.focus_point.class_list.add("smooth");
                    ui.reposition_focus_point(ui.focus_position.add(position_delta));
                });
            } else {
                ui.reposition_focus_point(ui.focus_position.add(position_delta));
            }

            // Reposition the view if the focus point is not complete in-view.
            const offset = ui.grid.offset_from_position(ui.focus_position);
            const width = ui.grid.column_width(ui.focus_position.x);
            const height = ui.grid.row_height(ui.focus_position.y);
            const view = new Dimensions(
                document.body.offsetWidth / 2 ** ui.scale,
                document.body.offsetHeight / 2 ** ui.scale,
            ).sub(Dimensions.diag(CONSTANTS.VIEW_PADDING * 2));
            const pan = Offset.zero();
            // We only adjust in the direction of movement, to avoid issues with edge cases,
            // e.g. where the height of the screen is too small, which can cause panning
            // vertically back and forth with each key press.
            if (position_delta.x !== 0) {
                // Left.
                pan.x += Math.min(offset.x - (ui.view.x - view.width / 2), 0);
                // Right.
                pan.x += Math.max(offset.x + width - (ui.view.x + view.width / 2), 0);
            }
            if (position_delta.y !== 0) {
                // Top.
                pan.y += Math.min(offset.y - (ui.view.y - view.height / 2), 0);
                // Bottom.
                pan.y += Math.max(offset.y + height - (ui.view.y + view.height / 2), 0);
            }

            const start = performance.now();
            const view_origin = new Offset(ui.view.x, ui.view.y);
            // We want to transition the view smoothly. We can animate the offset with CSS, but
            // the grid is drawn using a <canvas> and so must be updated manually.
            const partial_pan = () => {
                requestAnimationFrame(() => {
                    // The panning animation lasts for 0.1 seconds.
                    const x
                        = Math.max(Math.min((performance.now() - start) / (1000 * 0.1), 1), 0);
                    // The definition of the `ease` transition duration in CSS, which is the
                    // default transition and the one we use.
                    const ease = new CubicBezier(
                        Point.zero(),
                        new Point(0.25, 0.1),
                        new Point(0.25, 1.0),
                        Point.diag(1),
                    );

                    // Do a binary search to find the value of `t` corresponding to the x
                    // co-ordinate `x`. The value of `p.y` thereat is the distance through the
                    // animation.
                    let p;
                    let [min, max] = [ease.point(0), ease.point(1)];

                    if (x === 0) {
                        p = min;
                    } else if (x === 1) {
                        p = max;
                    } else if (x > 0 && x < 1) {
                        const EPSILON = 0.01;
                        const BAIL_OUT = 128;
                        let i = 0;
                        while (true) {
                            p = ease.point((max.t + min.t) / 2);
                            if (p.x === x || max.t - min.t <= EPSILON || ++i >= BAIL_OUT) {
                                break;
                            }
                            if (x > p.x) {
                                min = p;
                            }
                            if (x < p.x) {
                                max = p;
                            }
                        }
                    }

                    ui.pan_to(view_origin.add(pan.mul(p.y)));
                    if (x < 1) {
                        partial_pan();
                    }
                })
            };
            partial_pan();
        }

        if (panning) {
            // The cell under the focus point is moved if nothing is selected.
            const cell_under_focus_point = ui.cell_under_focus_point();
            if (ui.selection.size === 0 && cell_under_focus_point !== null) {
                ui.select(cell_under_focus_point);
            }
            if (!ui.selection_contains_vertex() && ui.selection_contains_edge()) {
                // Only arrows are selected: "moving" them bends or offsets them. Each press is
                // its own undo step, as with moving vertices, rather than collapsing into the
                // last change to the slider.
                ui.history.permanentise();
                ui.arrow_options.nudge(ui, position_delta);
                ui.history.permanentise();
                return;
            }
            // The focus point follows the cell it is on, if that moves.
            const focused = ui.focus_point.class_list.contains("focused")
                && ui.selection.has(ui.cell_under_focus_point());
            const distance = ui.move_selection(position_delta);
            if (distance > 0 && focused) {
                ui.reposition_focus_point(
                    ui.focus_position.add(position_delta.mul(distance)),
                );
            }
        }
    }

    /// Copy the selection, and the cells it depends on.
    copy() {
        const ui = this.ui;
        // Copying nothing would keep nothing, but it throws on an empty diagram.
        if (ui.in_mode(UIMode.Default, UIMode.Pan) && !ui.input_is_active()
            && ui.selection.size > 0
        ) {
            this.clipboard = QuiverImportExport.base64.export_selection(
                ui.quiver,
                ui.quiver.transitive_reverse_dependencies(ui.selection),
            );
        }
    }

    /// Delete the selection, which the `cut` binding has just copied.
    cut() {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Default, UIMode.Pan) && !ui.input_is_active()) {
            // The binding copies first (see `Bindings.HANDLERS`).
            ui.history.add(ui, [{
                kind: "delete",
                cells: ui.quiver.transitive_dependencies(ui.selection),
            }], true);
            ui.update_selection();
        }
    }

    /// Paste the cells last copied at the focus point. In the import and macros layers, pasting
    /// loads tikz-cd or definitions instead (see `Keymap.intercept`).
    paste() {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Default, UIMode.Pan) && !ui.input_is_active()
            && !ui.keymap.pasting()
        ) {
            if (this.clipboard === "") {
                return;
            }
            try {
                const cells = new Set(QuiverImportExport.base64.import(
                    ui,
                    this.clipboard,
                    ui.focus_position,
                    false,
                ));
                ui.history.add(ui, [{ kind: "create", cells }]);
            } catch (_) {
                ui.mode_line.flash("can't paste here: it would overlap existing cells", true);
            }
            ui.focus_point.class_list.remove("revealed", "pending", "active");
        }
    }
}
