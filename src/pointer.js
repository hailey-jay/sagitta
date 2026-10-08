/// What the pointer and the scroll wheel do on the canvas: panning and zooming, moving the focus
/// point, dragging vertices, and dragging out arrows. Cells listen for the presses that land on
/// them (see `Cell.initialise`), and switch the `UIMode` that the handlers here then act on.
class Pointer {
    constructor(ui) {
        this.ui = ui;
    }

    /// Start listening, once the UI's elements exist.
    initialise() {
        const ui = this.ui;
        window.addEventListener("wheel", (event) => this.scroll(event), { passive: false });
        document.addEventListener("pointermove", (event) => this.stop_stale_pan(event));
        document.addEventListener("pointerup", (event) => this.release(event));
        ui.element.listen("pointerdown", (event) => this.press(event));
        ui.element.listen("pointermove", (event) => this.move(event));
        ui.element.listen("contextmenu", (event) => this.context_menu(event));
        ui.focus_point.listen("pointerdown", (event) => this.press_focus_point(event));
        ui.focus_point.listen("pointerleave", (event) => this.leave_focus_point(event));
        // On the container, so that a release anywhere in the focus point's cell counts.
        ui.container.listen("pointerup", (event) => this.release_on_focus_point(event));
    }

    /// Right-clicking the canvas opens the command layer, whose key list is clickable: the menu
    /// for the pointer. A cell right-clicked is selected first (see `Cell.initialise`).
    context_menu(event) {
        const ui = this.ui;
        event.preventDefault();
        if (event.target.closest(".mode-line, .which-key") !== null
            || !ui.in_mode(UIMode.Default)) {
            return;
        }
        if (!ui.keymap.active) {
            ui.keymap.settle();
            ui.keymap.enter(true);
        }
    }

    /// Handle panning via scrolling.
    scroll(event) {
        const ui = this.ui;
        // We don't want to scroll the page while using the mouse wheel.
        event.preventDefault();

        // Hide the focus point if it is visible.
        ui.focus_point.class_list.remove("revealed", "pending", "active");

        // If the user is holding shift, then we zoom, otherwise we pan.
        if (event.shiftKey) {
            ui.pan_to(ui.view, clamp(
                CONSTANTS.MIN_ZOOM,
                ui.scale - event.deltaY / 100,
                CONSTANTS.MAX_ZOOM,
            ));
            ui.mode_line.update(ui);
        } else {
            ui.pan_view(new Offset(
                event.deltaX * 2 ** -ui.scale,
                event.deltaY * 2 ** -ui.scale,
            ));
        }
    }

    /// Add the move just made to the history, if it moved anything.
    commit_move() {
        const ui = this.ui;
        if (!ui.mode.previous.sub(ui.mode.origin).is_zero()) {
            // We only want to commit the move event if it actually did moved things.
            ui.history.add(ui, [{
                kind: "move",
                displacements: Array.from(ui.mode.selection).map((vertex) => ({
                    vertex,
                    from: vertex.position.sub(ui.mode.previous.sub(ui.mode.origin)),
                    to: vertex.position,
                })),
            }]);
        }
    }

    /// Stop panning if the key that started it is no longer held, which happens when it was
    /// released while the window did not have the focus.
    stop_stale_pan(event) {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Pan)) {
            if (ui.mode.key !== null) {
                // If we're panning, but no longer holding the requisite key, stop.
                // This can happen if we release the key when the document is not focused.
                if (!{ Control: event.ctrlKey, Alt: event.altKey }[ui.mode.key]) {
                    ui.switch_mode(UIMode.default);
                }
            }
        }
    }

    /// Releasing the pointer anywhere, even outside the window: finish panning, moving, or
    /// connecting.
    release(event) {
        const ui = this.ui;
        if (event.button === 0) {
            if (ui.in_mode(UIMode.Pan)) {
                // We only want to pan when the pointer is held.
                ui.mode.origin = null;
            } else if (ui.in_mode(UIMode.PointerMove)) {
                this.commit_move();
                ui.switch_mode(UIMode.default);
            } else if (ui.in_mode(UIMode.Connect)) {
                // Stop trying to connect cells when the pointer is released outside
                // the `<body>`.
                if (ui.mode.forged_vertex) {
                    ui.history.add(ui, [{
                        kind: "create",
                        cells: new Set([ui.mode.source]),
                    }]);
                }
                ui.switch_mode(UIMode.default);
            } else if (ui.in_mode(UIMode.Default)) {
                // If we clicked down on an arrow, then release the pointer without
                // moving the cursor, we need to remove any pending state, so that we don't
                // start creating a new edge when the user moves the pointer.
                const pending = ui.element.query_selector(".cell.pending");
                if (pending !== null) {
                    pending.class_list.remove("pending");
                }
            }
            ui.hide_if_unselected();
        }
    }

    /// Pressing the pointer on the canvas: start panning (with Option or Control held), or move the
    /// focus point to it and deselect (unless Shift, Command, or Control is held).
    press(event) {
        const ui = this.ui;
        if (event.button === 0) {
            // Usually, if `Alt` or `Control` have been held we will have already switched to
            // the Pan mode. However, if the window is not in focus, they will not have been
            // detected, so we switch modes on pointer click.
            if (ui.in_mode(UIMode.Default)) {
                if (event.altKey) {
                    ui.switch_mode(new UIMode.Pan("Alt"));
                } else if (event.ctrlKey) {
                    ui.switch_mode(new UIMode.Pan("Control"));
                } else {
                    // Move the focus point to the click, and keep it focused, so that typing
                    // afterwards creates a vertex there (see `Keymap.edit_target`).
                    ui.focus_point.class_list.remove("smooth");
                    ui.reposition_focus_point(ui.position_from_event(event));
                    ui.focus_point.class_list.add("focused", "revealed", "pending");
                }
            }
            if (ui.in_mode(UIMode.Pan)) {
                // Hide the focus point if it is visible.
                ui.focus_point.class_list.remove("revealed");
                // Record the position the pointer was pressed at, so we can pan relative
                // to that location by dragging.
                ui.mode.origin = ui.offset_from_event(event).sub(ui.view);
            } else {
                if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                    // Deselect cells when the pointer is pressed (at least when the
                    // Shift/Command/Control keys are not held).
                    ui.deselect();
                } else {
                    // Otherwise, simply deselect the label input (it's unlikely the user
                    // wants to modify all the cell labels at once).
                    ui.label_input.element.blur();
                }
            }
        }
    }

    /// Clicking on the focus point reveals it, after which another click adds a new node.
    press_focus_point(event) {
        const ui = this.ui;
        if (event.button === 0) {
            if (ui.in_mode(UIMode.Default)) {
                event.preventDefault();
                if (ui.focus_point.class_list.contains("revealed")) {
                    // We only stop propagation in this branch, so that clicking once in an
                    // empty grid cell will deselect any selected cells, but clicking a second
                    // time to add a new vertex will not deselect the new, selected vertex we've
                    // just added. Note that it's not possible to select other cells in between
                    // the first and second click, because leaving the grid cell with the cursor
                    // (to select other cells) hides the focus point again.
                    event.stopPropagation();
                    const vertex = ui.create_vertex_at_focus_point(event);
                    ui.history.add(ui, [{
                        kind: "create",
                        cells: new Set([vertex]),
                    }]);
                    // When the user is creating a vertex and adding it to the selection,
                    // it is unlikely they expect to edit all the labels simultaneously,
                    // so in this case we do not focus the input.
                    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        ui.label_input.element.select();
                    }
                }
            }
        }
    }

    /// If we release the pointer while hovering over the focus point, there are two
    /// possibilities. Either we haven't moved the pointer, in which case the focus point loses
    /// its `"pending"` or `"active"` state; or we have, in which case we're mid-connection and
    /// we need to create a new vertex and connect it. We add the event listener to the
    /// container, rather than the focus point, so that we don't have to worry about the
    /// focus point being exactly the same size as a grid cell (there is some padding for
    /// aesthetic purposes) or the focus point being covered by other elements (like edge
    /// endpoints).
    release_on_focus_point(event) {
        const ui = this.ui;
        if (event.button === 0) {
            // Handle pointer releases without having moved the cursor from the initial cell.
            ui.focus_point.class_list.remove("pending", "active");

            // We only want to create a connection if the focus point is visible. E.g. not
            // if we're hovering over a grid cell that contains a vertex, but not hovering over
            // the vertex itself (i.e. the whitespace around the vertex).
            if (ui.focus_point.class_list.contains("revealed")) {
                // When releasing the pointer over an empty grid cell, we want to create a new
                // cell and connect it to the source.
                if (ui.in_mode(UIMode.Connect)) {
                    event.stopImmediatePropagation();
                    // We only want to forge vertices, not edges (and thus 1-cells).
                    if (ui.mode.source.is_vertex()) {
                        // Usually this vertex will be immediately deselected, except when Shift
                        // is held, in which case we want to select the forged vertices *and*
                        // the new edge.
                        ui.mode.target = ui.create_vertex_at_focus_point(event);
                        const created = new Set([ui.mode.target]);
                        const actions = [{
                            kind: "create",
                            cells: created,
                        }];

                        if (ui.mode.forged_vertex) {
                            created.add(ui.mode.source);
                        }

                        if (ui.mode.reconnect === null) {
                            // If we're not reconnecting an existing edge, then we need
                            // to create a new one.
                            const edge = ui.mode.connect(ui, event);
                            created.add(edge);
                            ui.order_before(ui.mode.target, edge);
                        } else {
                            // Unless we're holding Shift/Command/Control (in which case we just
                            // add the new vertex to the selection) we want to focus and select
                            // the new vertex.
                            const { edge, end } = ui.mode.reconnect;
                            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                                ui.label_input.element.select();
                            }
                            actions.push({
                                kind: "connect",
                                edge,
                                end,
                                from: edge[end],
                                to: ui.mode.target,
                            });
                            ui.mode.connect(ui, event);
                        }

                        // If we've forged a source vertex, then we select the source, which
                        // allows us to tab sequentially through the source, morphism, and
                        // target.
                        if (ui.mode.forged_vertex) {
                            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                                ui.deselect();
                                ui.select(ui.mode.source);
                                ui.hide_if_unselected();
                                ui.focus_label_input();
                            }
                        }

                        ui.history.add(
                            ui,
                            actions,
                            false,
                            ui.selection_excluding(created),
                        );
                    }
                    ui.hide_if_unselected();
                    ui.switch_mode(UIMode.default);
                }
            }
        }
    }

    /// If the cursor leaves the focus point and the pointer has *not*
    /// been held, it gets hidden again. However, if the cursor leaves the
    /// focus point whilst remaining held, then the focus point will
    /// be `"active"` and we create a new vertex and immediately start
    /// connecting it to something (possibly an empty grid cell, which will
    /// create a new vertex and connect them both).
    leave_focus_point(event) {
        const ui = this.ui;
        ui.focus_point.class_list.remove("pending");

        if (ui.focus_point.class_list.contains("active")) {
            // If the focus point is `"active"`, we're going to create
            // a vertex and start connecting it.
            ui.focus_point.class_list.remove("active");
            const vertex = ui.create_vertex_at_focus_point(event);
            ui.switch_mode(new UIMode.Connect(ui, vertex, true));
            vertex.element.class_list.add("source");
        } else if (!ui.in_mode(UIMode.Connect)) {
            // If the cursor leaves the focus point and we're *not*
            // connecting anything, then hide it.
            ui.focus_point.class_list.remove("revealed");
        }
    }

    /// Moving the focus point, panning, and rearranging cells.
    move(event) {
        const ui = this.ui;
        if (ui.in_mode(UIMode.Pan) && ui.mode.origin !== null) {
            const new_offset = ui.offset_from_event(event).sub(ui.view);
            ui.pan_view(ui.mode.origin.sub(new_offset));
            ui.mode.origin = new_offset;
        }

        // If we move the pointer (without releasing it) while the focus
        // point is revealed, it will transition from a `"pending"` state
        // to an `"active"` state. Moving the pointer off the focus
        // point in this state will create a new vertex and trigger the
        // connection mode.
        if (ui.focus_point.class_list.contains("pending")) {
            ui.focus_point.class_list.remove("pending");
            ui.focus_point.class_list.add("active");
        }

        const position = ui.position_from_event(event);

        // Moving cells around with the pointer.
        if (ui.in_mode(UIMode.PointerMove)) {
            // Prevent dragging from selecting random elements.
            event.preventDefault();

            const new_position = (cell) => cell.position.add(position).sub(ui.mode.previous);

            // We will only try to reposition if the new position is actually different
            // (rather than the cursor simply having moved within the same grid cell).
            // On top of this, we prevent vertices from being moved into grid cells that
            // are already occupied by vertices.
            const occupied = Array.from(ui.mode.selection).some((cell) => {
                return cell.is_vertex() && ui.positions.has(`${new_position(cell)}`);
            });

            if (!position.eq(ui.mode.previous) && !occupied) {
                // We'll need to move all of the edges connected to the moved vertices,
                // so we keep track of the root vertices in `moved.`
                const moved = new Set();
                // Move all the selected vertices.
                for (const cell of ui.mode.selection) {
                    if (cell.is_vertex()) {
                        cell.set_position(ui, new_position(cell));
                        moved.add(cell);
                    }
                }

                // Update the column and row sizes in response to the new positions of the
                // vertices.
                const rendered = ui.update_col_row_size(...Array.from(moved)
                    // Undo the transformation performed by `new_position`.
                    .map((vertex) => vertex.position.sub(position).add(ui.mode.previous))
                );
                // Rerender the dependencies that the resize did not, to make sure we move all of
                // the edges connected to cells that have moved.
                for (const cell of ui.quiver.transitive_dependencies(moved)) {
                    if (!rendered.has(cell)) {
                        cell.render(ui);
                    }
                }

                ui.mode.previous = position;

                // Bring the label input in sync, so that (e.g.) the
                // rotation of the label alignment buttons).
                ui.update_selection();
            }
        }

        // If the user has currently clicked to place a vertex, or activated keyboard controls,
        // then don't reposition the focus point until the new vertex has been created:
        // otherwise we might move the focus point before the vertex has been created and
        // accidentally place the vertex in the new position of the focus point, rather than
        // the old one.
        if (!ui.in_mode(UIMode.Connect) && (ui.focus_point.class_list.contains("revealed")
            || ui.focus_point.class_list.contains("focused"))
        ) {
            return;
        }

        // We permanently change the focus point position if we are dragging to connect an edge,
        // so that the focus point will be in the location we drag to.
        ui.reposition_focus_point(position, ui.in_mode(UIMode.Connect));

        // We want to reveal the focus point if and only if it is
        // not at the same position as an existing vertex (i.e. over an
        // empty grid cell).
        if (ui.in_mode(UIMode.Connect)) {
            // Prevent dragging from selecting random elements.
            event.preventDefault();

            // We only permit the forgery of vertices, not edges.
            if (ui.mode.source.is_vertex() && ui.mode.target === null) {
                ui.focus_point.class_list
                    .toggle("revealed", !ui.positions.has(`${position}`));
            }

            // Update the position of the cursor.
            const offset = ui.offset_from_event(event);
            ui.mode.update(ui, offset);
        }
    }
}
