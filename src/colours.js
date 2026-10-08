/// The colour layer: the colour being picked for the selection's labels or arrows, and the palettes
/// offered there. `Layer.Colour` opens it; `Colour` itself lives in `src/ds.js`.

/// The colour being picked for the selection's labels or arrows in the colour layer (see
/// `Keymap`), and the palettes offered there.
class ColourPicker {
    constructor() {
        this.ui = null;

        // The colour last picked, which the colour layer's hue, saturation, and lightness bindings
        // step from.
        this.colour = Colour.black();

        // What we are picking a colour for (a `ColourPicker.TARGET`), or `null` outside the colour
        // layer.
        this.target = null;

        // Whether picking a label colour also sets the arrow colour, and vice versa.
        this.sync = true;

        // The palette groups' colours. The LaTeX colours are those defined by the macros, and the
        // diagram colours those already in use.
        this.palettes = new Map([
            ["Preset", [
                Colour.black(),
                new Colour(0, 0, 33),
                new Colour(0, 0, 67),
                new Colour(0, 0, 100),
                Colour.from_rgba(255, 0, 0),
                Colour.from_rgba(255, 255, 0),
                Colour.from_rgba(0, 255, 0),
                Colour.from_rgba(0, 255, 255),
                Colour.from_rgba(0, 0, 255),
                Colour.from_rgba(255, 0, 255),
            ]],
            ["LaTeX", []],
            ["Diagram", []],
        ]);
    }

    initialise(ui) {
        this.ui = ui;
    }

    /// Start picking a colour for `target`, or switch to it if already picking.
    open(ui, target) {
        if (this.target === null) {
            // Keep label and arrow colours in sync iff every selected arrow's already match. We
            // only decide this on opening, as it would be confusing for switching between the label
            // and arrow targets to change it.
            this.sync = Array.from(ui.selection).every((cell) => {
                return cell.is_vertex() || cell.label_colour.eq(cell.options.colour);
            });
        }
        this.target = target;
        this.set_colour(
            ui,
            target === ColourPicker.TARGET.Label
                ? ui.arrow_options.label_colour : ui.arrow_options.colour,
        );
    }

    /// Stop picking a colour, leaving the colour layer.
    close() {
        if (this.target !== null) {
            this.target = null;
            this.ui.keymap.render();
        }
    }

    /// Toggle whether label and arrow colours are kept in sync. Turning it on makes the selected
    /// arrows' label and arrow colours match.
    toggle_sync(ui) {
        this.sync = !this.sync;
        if (this.sync && Array.from(ui.selection).some((cell) => {
            return cell.is_edge() && !cell.label_colour.eq(cell.options.colour);
        })) {
            this.set_selection_colour(ui, this.colour, true);
        }
    }

    /// Sets the colour of the selected labels or edges to the given colour. `resync` distinguishes
    /// the history step made by turning syncing on from that of picking a colour.
    set_selection_colour(ui, colour, resync = false) {
        const label_colour_change = {
            kind: "label_colour",
            value: colour,
            cells: Array.from(ui.selection).map((cell) => ({
                cell,
                from: cell.label_colour,
                to: colour,
            })),
        };
        const colour_change = {
            kind: "colour",
            value: colour,
            cells: Array.from(ui.selection).filter(cell => cell.is_edge())
                .map((edge) => ({
                    edge,
                    from: edge.options.colour,
                    to: colour,
                })),
        };

        let changes;
        switch (this.target) {
            case ColourPicker.TARGET.Label:
                changes = [label_colour_change];
                if (this.sync) {
                    changes.push(colour_change);
                }
                ui.history.add_or_modify_previous(
                    ui,
                    ["label_colour", ui.selection, this.sync, resync],
                    changes,
                );
                break;
            case ColourPicker.TARGET.Edge:
                changes = [colour_change];
                if (this.sync) {
                    changes.push(label_colour_change);
                }
                ui.history.add_or_modify_previous(
                    ui,
                    ["colour", ui.selection, this.sync, resync],
                    changes,
                );
                break;
        }
        this.set_colour(ui, colour);
    }

    /// Set the colour being picked. The label's colour also shows in the indicator beside the
    /// label input; an arrow's shows in the mode line, which reads it from the selection.
    set_colour(ui, colour) {
        this.colour = colour;
        switch (this.target) {
            case ColourPicker.TARGET.Label:
                ui.arrow_options.label_colour = colour;
                ui.element.query_selector(".label-input-container .colour-indicator").set_style({
                    background: colour.css(),
                });
                break;
            case ColourPicker.TARGET.Edge:
                ui.arrow_options.colour = colour;
                break;
        }
    }

    is_targeting(target) {
        return this.target === target;
    }

    /// Update the LaTeX colour palette group from `UI.colours`.
    update_latex_colours(ui) {
        this.palettes.set("LaTeX", Array.from(ui.colours.values()));
    }

    /// Update the diagram colour palette group.
    update_diagram_colours(ui) {
        // Rather than keep track of the current colours in the diagram, which would be most
        // efficient, but also involve a fair deal of book-keeping, we instead simply iterate
        // through all the cells and collect their colours every time that the diagram changes (i.e.
        // whenever a cell is added or removed, or a colour is changed). Even for large diagrams,
        // this ought to be fast.
        const colours = new Set();
        for (const cell of ui.quiver.all_cells()) {
            colours.add(`${cell.label_colour}`);
            if (cell.is_edge()) {
                colours.add(`${cell.options.colour}`);
            }
        }
        this.palettes.set("Diagram", Array.from(colours).map((string) => {
            const [h, s, l, a] = string.split(",");
            return new Colour(parseInt(h), parseInt(s), parseInt(l), parseFloat(a));
        }));
    }
}

/// What a colour is being picked for.
ColourPicker.TARGET = new Enum(
    "TARGET",
    // The cell label.
    "Label",
    // The edge label.
    "Edge",
);
