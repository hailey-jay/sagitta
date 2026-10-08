/// The undo history: a list of events, each a list of actions, which `effect` applies forwards or
/// backwards. Every edit the palette makes records one (see `src/options.js`), and the events that
/// a single gesture produces collapse into one another (`add_or_modify_previous`, `squash`).

/// The history system (i.e. undo and redo).
class History {
    constructor() {
        // A list of all actions taken by the user.
        // Each "action" actually comprises a list of atomic actions.
        this.actions = [];

        // The index after the last taken action (usually equal to `this.actions.length`).
        // `0` therefore signifies that no action has been taken (or we've reverted history
        // to that point).
        this.present = 0;

        // We keep track of the state of the editor at the various points in history, e.g. the
        // selection.
        this.states = [new History.State(new Set(), Position.zero())];

        // We allow history events to be collapsed if two consecutive events have the same
        // (elementwise) `collapse` array. This tracks the previous one.
        this.collapse = null;
    }

    /// Add a reversible event to the history. Its effect will not be invoked (i.e. one should
    /// effect the action separately) unless `invoke` is `true`, as actions added to the history
    /// are often composites of individual actions that should not be performed atomically in
    /// real-time.
    add(ui, actions, invoke = false, selection = ui.selection) {
        // Append a new history event.
        // If there are future actions, clear them. (Our history only forms a list, not a tree.)
        ui.quiver.flush(this.present);
        this.states.splice(this.present + 1, this.actions.length - this.present);
        // Update the current state, so that if we undo to it, we restore the exact
        // state we had before making the action.
        const state = new History.State(selection, ui.focus_position);
        this.states[this.present] = state;
        this.actions.splice(this.present, this.actions.length - this.present);
        this.actions.push(actions);

        if (invoke) {
            this.redo(ui);
        } else {
            ++this.present;
        }

        this.states.push(state);
        this.collapse = null;

        // Update the mode line (e.g. enabling Redo).
        ui.mode_line.update(ui);
    }

    /// Add a collapsible history event. This allows the last event to be modified later,
    /// replacing the history state.
    add_collapsible(ui, collapse, event, invoke = false) {
        this.add(ui, event, invoke);
        this.collapse = collapse;
    }

    /// Get the previous array of actions, if `collapse` matches `this.collapse`.
    get_collapsible_actions(collapse) {
        if (this.collapse !== null && collapse !== null
            && collapse.length === this.collapse.length
            && collapse.every((_, i) => collapse[i] === this.collapse[i]))
        {
            return this.actions[this.present - 1];
        } else {
            return null;
        }
    }

    /// Adds a new history event, or collapses it into the previous event if the two match.
    add_or_modify_previous(ui, collapse, new_actions) {
        const actions = this.get_collapsible_actions(collapse);
        if (actions !== null) {
            // If the previous history event was to modify the property `kind`, then we're just
            // going to modify that event rather than add a new one.
            let unchanged = true;
            outer: for (const action of actions) {
                // We require that each `kind` in `new_actions` is unique.
                for (const new_action of new_actions) {
                    if (action.kind === new_action.kind) {
                        // Modify the `to` field of each property modification.
                        action[`${new_action.kind}s`].forEach((modification) => {
                            modification.to = new_action.value;
                            if (modification.to !== modification.from) {
                                unchanged = false;
                            }
                        });
                        continue outer;
                    }
                }
            }
            // Invoke the new property changes immediately.
            this.effect(ui, actions, false);
            if (unchanged) {
                this.pop(ui);
            }
        } else {
            // If this is the start of our property modification, we need to add a new history
            // event.
            this.add_collapsible(ui, collapse, new_actions.map((new_action) => ({
                kind: new_action.kind,
                [`${new_action.kind}s`]: new_action.cells,
            })), true);
        }
    }

    /// Merge the events after the first `since` into one, so that a compound command (e.g. an
    /// arrow preset) is undone in a single step. Assumes that `this.present === this.actions.length`.
    squash(since) {
        if (this.present - since < 2) {
            return;
        }
        const merged = this.actions.splice(since, this.present - since).flat();
        this.actions.splice(since, 0, merged);
        // Keep the states before and after the merged event.
        this.states.splice(since + 1, this.present - since - 1);
        this.present = since + 1;
        this.permanentise();
    }

    /// Make the last action permanent, preventing it from being collapsed.
    permanentise() {
        this.collapse = null;
    }

    /// Pop the last event from the history. Assumes that `this.present === this.actions.length`.
    pop(ui) {
        --this.present;
        this.permanentise();
        ui.quiver.flush(this.present);
        this.states.splice(this.present + 1, 1);
        this.actions.splice(this.present, 1);
    }

    /// Trigger an action. Returns whether the selection should be brought in sync afterwards.
    effect(ui, actions, reverse) {
        const order = Array.from(actions);

        // We need to iterate these in reverse order if `reverse` so that interacting actions
        // get executed in the correct order relative to one another.
        if (reverse) {
            order.reverse();
        }

        // Whether to call `UI.update_selection` after triggering the events.
        let update_selection = false;
        // Whether to call `ColourPicker.update_diagram_colours` after triggering the events.
        let update_colours = false;

        for (const action of order) {
            let kind = action.kind;
            if (reverse) {
                // Actions either have corresponding inverse actions or are self-inverse.
                kind = {
                    create: "delete",
                    delete: "create",
                    // Self-inverse actions will be automatically preserved.
                }[kind] || kind;
            }
            // Self-inverse actions often work by inverting `from`/`to`.
            const [from, to] = !reverse ? ["from", "to"] : ["to", "from"];
            // Actions will often require cells to be rendered transitively.
            const cells = new Set();
            switch (kind) {
                case "move":
                    // We perform these loops in sequence as cells may move
                    // directly into positions that have just been unoccupied.
                    for (const displacement of action.displacements) {
                        ui.positions.delete(`${displacement[from]}`);
                    }
                    for (const displacement of action.displacements) {
                        displacement.vertex.set_position(ui, displacement[to]);
                        ui.positions.set(
                            `${displacement.vertex.position}`,
                            displacement.vertex,
                        );
                        cells.add(displacement.vertex);
                    }
                    // We may need to resize the columns and rows that the cells moved from, if
                    // they were what was determining the column/row width/height.
                    // The cells `update_col_row_size` rerendered need not be rendered again below.
                    for (const cell of ui.update_col_row_size(...action.displacements.map(
                        (displacement) => displacement[from])
                    )) {
                        cells.delete(cell);
                    }
                    break;
                case "create":
                    for (const cell of action.cells) {
                        ui.quiver.add(cell);
                        ui.add_cell(cell);
                    }
                    update_selection = true;
                    break;
                case "delete":
                    for (const cell of action.cells) {
                        ui.remove_cell(cell, this.present);
                    }
                    update_selection = true;
                    break;
                case "label":
                    for (const label of action.labels) {
                        label.cell.label = label[to];
                    }
                    ui.render_maths(...action.labels.map((label) => label.cell));
                    break;
                case "label_colour":
                    for (const label_colour of action.label_colours) {
                        label_colour.cell.label_colour = label_colour[to];
                        // The default colour is left to the style sheet, which dark mode changes.
                        const colour = label_colour.cell.label_colour.is_not_black()
                            ? label_colour.cell.label_colour.css() : "";
                        label_colour.cell.element.query_selector(".label").set_style({
                            color: colour,
                            fill: colour,
                        });
                    }
                    update_selection = true;
                    update_colours = true;
                    break;
                case "label_alignment":
                    for (const alignment of action.alignments) {
                        alignment.edge.options.label_alignment = alignment[to];
                        alignment.edge.render(ui);
                    }
                    update_selection = true;
                    break;
                case "label_position":
                    for (const label_position of action.label_positions) {
                        label_position.edge.options.label_position = label_position[to];
                        label_position.edge.render(ui);
                    }
                    update_selection = true;
                    break;
                case "offset":
                    for (const offset of action.offsets) {
                        offset.edge.options.offset = offset[to];
                        cells.add(offset.edge);
                    }
                    update_selection = true;
                    break;
                case "curve":
                    for (const curve of action.curves) {
                        if (curve.edge.is_loop()) {
                            continue;
                        }
                        curve.edge.options.curve = curve[to];
                        cells.add(curve.edge);
                    }
                    update_selection = true;
                    break;
                case "radius":
                    // We don't have any special casing for nonstandard plurals :)
                    for (const radius of action.radiuss) {
                        if (!radius.edge.is_loop()) {
                            continue;
                        }
                        radius.edge.options.radius = radius[to];
                        cells.add(radius.edge);
                    }
                    update_selection = true;
                    break;
                case "angle":
                    for (const angle of action.angles) {
                        if (!angle.edge.is_loop()) {
                            continue;
                        }
                        angle.edge.options.angle = angle[to];
                        cells.add(angle.edge);
                    }
                    update_selection = true;
                    break;
                case "length":
                    for (const length of action.lengths) {
                        const [source, target] = length[to];
                        length.edge.options.shorten = { source, target: 100 - target };
                        cells.add(length.edge);
                    }
                    update_selection = true;
                    break;
                case "reverse":
                    for (const cell of action.cells) {
                        if (cell.is_edge()) {
                            cell.reverse(ui);
                        }
                    }
                    update_selection = true;
                    break;
                case "flip":
                    for (const cell of action.cells) {
                        if (cell.is_edge()) {
                            cell.flip(ui, true);
                        }
                    }
                    update_selection = true;
                    break;
                case "flip labels":
                    for (const cell of action.cells) {
                        if (cell.is_edge()) {
                            cell.flip(ui, false);
                        }
                    }
                    update_selection = true;
                    break;
                case "level":
                    for (const level of action.levels) {
                        level.edge.options.level = level[to];
                        cells.add(level.edge);
                    }
                    update_selection = true;
                    break;
                case "style":
                    for (const style of action.styles) {
                        style.edge.options.style = style[to];
                        style.edge.render(ui);
                    }
                    update_selection = true;
                    break;
                case "connect":
                    const [source, target] = {
                        source: [action[to], action.edge.target],
                        target: [action.edge.source, action[to]],
                    }[action.end];
                    action.edge.reconnect(ui, source, target);
                    update_selection = true;
                    break;
                case "colour":
                    for (const colour of action.colours) {
                        colour.edge.options.colour = colour[to];
                        cells.add(colour.edge);
                    }
                    update_selection = true;
                    update_colours = true;
                    break;
                case "edge_alignment":
                    for (const cell of action.cells) {
                        cell.options.edge_alignment[action.end] =
                            !cell.options.edge_alignment[action.end];
                        cells.add(cell);
                    }
                    update_selection = true;
                    break;
            }
            for (const cell of ui.quiver.transitive_dependencies(cells)) {
                cell.render(ui);
            }
        }

        if (update_selection) {
            ui.update_selection();
            ui.hide_if_unselected();
        }
        if (update_colours) {
            ui.colour_picker.update_diagram_colours(ui);
        }
        // Though we have already brought the selection in sync if `update_selection`, `undo`
        // and `redo` may want to do so again, if they change which cells are
        // selected, so we pass this flag on.
        return update_selection;
    }

    undo(ui) {
        if (this.present > 0) {
            --this.present;
            this.permanentise();

            // Trigger the reverse of the previous action.
            const update_selection = this.effect(ui, this.actions[this.present], true);
            ui.deselect();
            const state = this.states[this.present];
            ui.select(...state.selection);
            ui.focus_point.class_list.remove("revealed");
            ui.reposition_focus_point(state.focus_position);
            if (update_selection) {
                ui.update_selection();
                ui.hide_if_unselected();
            }

            ui.mode_line.update(ui);

            return true;
        }

        return false;
    }

    redo(ui) {
        if (this.present < this.actions.length) {
            // Trigger the next action.
            const update_selection = this.effect(ui, this.actions[this.present], false);

            ++this.present;
            this.permanentise();
            // If we're immediately invoking `redo`, then the selection has not
            // been recorded yet, in which case the current selection is correct.
            if (this.present < this.states.length) {
                ui.deselect();
                const state = this.states[this.present];
                ui.select(...state.selection);
                ui.focus_point.class_list.remove("revealed");
                ui.reposition_focus_point(state.focus_position);
            }
            if (update_selection) {
                ui.update_selection();
                ui.hide_if_unselected();
            }

            ui.mode_line.update(ui);

            return true;
        }

        return false;
    }
}

/// The data tracked and restored by the history system.
History.State = class {
    constructor(selection, focus_position) {
        // We keep track of cell selection between events to conserve it as expected.
        this.selection = selection;

        // We also keep track of the position of the focus point for keyboard use.
        this.focus_position = focus_position;
    }
};
