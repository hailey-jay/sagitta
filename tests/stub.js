/// The window the fast suite (`tests/tikzcd.js`) runs the diagram in: enough of the DOM for
/// `src/dom.js` to build cells, and a `Stub.UI` holding only what parsing and exporting reach for.
/// Nothing here draws or measures: the tikz-cd export is written from a cell's options alone, so
/// every element below is somewhere for the cell to keep its own, and is never looked at again.

/// One `querySelector` selector: a tag name, classes, or both (`kbd.queue`), or several of those
/// separated by spaces, each a descendant of the one before (`.arrow-label div`).
function matches(element, selector) {
    const [last, ...ancestors] = selector.trim().split(/\s+/).reverse();
    if (!matches_one(element, last)) {
        return false;
    }
    let parent = element.parentElement;
    for (const ancestor of ancestors) {
        while (parent !== null && !matches_one(parent, ancestor)) {
            parent = parent.parentElement;
        }
        if (parent === null) {
            return false;
        }
        parent = parent.parentElement;
    }
    return true;
}

/// One part of a selector: a tag name, classes, or both.
function matches_one(element, selector) {
    const tag = selector.match(/^[A-Za-z][\w-]*/);
    const classes = selector.match(/\.[\w-]+/g) ?? [];
    if (tag !== null && element.tagName !== tag[0].toUpperCase()) {
        return false;
    }
    return classes.every((name) => element.classList.contains(name.slice(1)));
}

class StubClassList {
    constructor() {
        this.classes = new Set();
    }

    add(...names) {
        for (const name of names) {
            this.classes.add(name);
        }
    }

    remove(...names) {
        for (const name of names) {
            this.classes.delete(name);
        }
    }

    contains(name) {
        return this.classes.has(name);
    }

    toggle(name, force = !this.classes.has(name)) {
        if (force) {
            this.classes.add(name);
        } else {
            this.classes.delete(name);
        }
        return force;
    }

    replace(from, to) {
        if (this.classes.delete(from)) {
            this.classes.add(to);
            return true;
        }
        return false;
    }
}

class StubStyle {
    setProperty(name, value) {
        this[name] = value;
    }

    getPropertyValue(name) {
        return this[name] ?? "";
    }

    removeProperty(name) {
        delete this[name];
    }
}

class StubElement {
    constructor(tag_name) {
        this.tagName = tag_name.toUpperCase();
        this.classList = new StubClassList();
        this.style = new StubStyle();
        this.attributes = new Map();
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this.text = "";
        // Nothing is laid out, so every element measures zero (see `Vertex.measure_label`).
        this.offsetWidth = 0;
        this.offsetHeight = 0;
    }

    get firstChild() {
        return this.children[0] ?? null;
    }

    get id() {
        return this.attributes.get("id") ?? "";
    }

    appendChild(child) {
        child.remove();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        const parent = this.parentElement;
        if (parent !== null) {
            parent.children.splice(parent.children.indexOf(this), 1);
            this.parentElement = null;
        }
    }

    addEventListener(type, f) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(f);
    }

    removeEventListener(type, f) {
        const listeners = this.listeners.get(type) ?? [];
        const index = listeners.indexOf(f);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }

    dispatchEvent() {
        return true;
    }

    /// Every descendant, in document order.
    descendants() {
        return this.children.flatMap((child) => [child, ...child.descendants()]);
    }

    querySelector(selector) {
        return this.descendants().find((child) => matches(child, selector)) ?? null;
    }

    querySelectorAll(selector) {
        return this.descendants().filter((child) => matches(child, selector));
    }

    /// `class` is the `classList` spelt as an attribute, since `DOM.Element` sets a new element's
    /// classes that way and reads them back through `classList`.
    getAttribute(attribute) {
        if (attribute === "class") {
            return Array.from(this.classList.classes).join(" ");
        }
        return this.attributes.get(attribute) ?? null;
    }

    setAttribute(attribute, value) {
        if (attribute === "class") {
            this.classList.classes = new Set(`${value}`.split(/\s+/).filter((name) => name !== ""));
            return;
        }
        this.attributes.set(attribute, `${value}`);
    }

    removeAttribute(attribute) {
        if (attribute === "class") {
            this.classList.classes.clear();
            return;
        }
        this.attributes.delete(attribute);
    }

    cloneNode() {
        const clone = new StubElement(this.tagName);
        clone.classList.add(...this.classList.classes);
        for (const [attribute, value] of this.attributes) {
            clone.attributes.set(attribute, value);
        }
        return clone;
    }

    contains(other) {
        return other === this || this.descendants().includes(other);
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    }

    /// The 2D context a `DOM.Canvas` asks for. The grid is the only canvas, and the suite never
    /// draws it, so each call does nothing.
    getContext() {
        return new Proxy({}, { get: () => () => {} });
    }
}

class StubText extends StubElement {
    constructor(text) {
        super("#text");
        this.text = text;
    }
}

const document = {
    body: new StubElement("body"),
    createElement: (tag_name) => new StubElement(tag_name),
    createElementNS: (_, tag_name) => new StubElement(tag_name),
    createTextNode: (text) => new StubText(text),
    addEventListener: () => {},
    removeEventListener: () => {},
    fonts: { ready: Promise.resolve() },
    title: "",
};

const window = {
    devicePixelRatio: 1,
    getComputedStyle: () => new StubStyle(),
    addEventListener: () => {},
    removeEventListener: () => {},
};

/// The desktop shell, as the page reaches it: `src/settings.js` and `src/file.js` call it to read
/// and write. Here it is a pair of strings, so that reading a settings file and writing one back
/// can be checked without a disk.
const host = {
    /// What `read_settings` hands over: `null` for no file, as the real shell says when there is
    /// none. A check sets this before calling `load`.
    settings_text: null,
    /// Every settings file written, in order, so a check can see what a `set` wrote.
    written: [],

    read_settings: async () => host.settings_text,
    write_settings: async (text) => {
        host.written.push(text);
    },
};

/// A `UI` as the diagram sees it: the quiver, the grid, the settings, and the handful of methods
/// `Parser`, `Cell`, and `QuiverImportExport` call on the way through. The view, the selection, the
/// mode line, and the history are stubbed out, since a parse neither reads nor needs them.
///
/// The undo history and the arrow options are the real ones, so that a command's history event can
/// be applied, undone, and redone here rather than only in the app.
///
/// `make_ui` builds one once the sources have been loaded into the context, which is why it takes
/// the classes rather than naming them.
function make_ui({ DOM, Quiver, Grid, Settings, SETTINGS, Offset, History, ArrowOptions }) {
    const focus_point = { class_list: new StubClassList() };
    const ui = {
        quiver: new Quiver(),
        grid: new Grid(),
        settings: new Settings(SETTINGS),
        macros: new Map(),
        colours: new Map(),
        sep: { column: 1.8, row: 1.8 },
        // The format the diagram is written in, which nothing here lays out (see `UI.format`).
        format: "tikz-cd",
        amscd_ends: new Map(),
        // The separations `DiagramFile.SEPS` calls normal, which a diagram keeps unless its file
        // says otherwise.
        present: 0,
        positions: new Map(),
        selection: new Set(),
        buffer_updates: false,
        focus_point,
        view: Offset.zero(),
        history: new History(),
        mode_line: { update: () => {}, flash: () => {}, error: () => {}, dismiss_error: () => false },
        colour_picker: { update_diagram_colours: () => {} },
        // No pointer rests on anything, so the keys act at the focus point.
        pointer: { hovered_checkpoint: () => null },
        // The arrow options are the real ones: they hold the selection's values and need no
        // elements of their own (the palette that edits them is the mode line's business).
        arrow_options: new ArrowOptions(),
        // The element every cell is added to, which stands in for the canvas.
        canvas: new DOM.Div({ class: "canvas" }),

        options: () => ({ dimensions: [0, 0], sep: ui.sep }),
        definitions: () => ({ macros: ui.macros, colours: ui.colours }),

        /// As `UI.add_cell`, without the colour picker or the codes.
        add_cell: (cell) => {
            ui.canvas.add(cell.element);
            if (cell.is_vertex()) {
                ui.positions.set(`${cell.position}`, cell);
                cell.recalculate_size(ui);
            }
        },

        /// As `UI.add_cells`, which has nothing to stack or code here.
        add_cells: (add) => add(),
        draw_unrendered: () => {},

        /// As `UI.change_setting`, without what it shows: nothing here is drawn.
        change_setting: (setting, value) => ui.settings.set(setting, value),

        centre_view: () => {},
        /// KaTeX is not loaded, so a label is never typeset; a vertex that asks for its label to
        /// be rendered is told it measures nothing, which is what an empty one would.
        render_maths: (...cells) => {
            for (const cell of cells) {
                if (cell.is_vertex()) {
                    cell.label_size = [0, 0];
                    cell.resize_content(ui, cell.label_size);
                }
            }
        },
        /// As `UI.update_cell_size`, without the resize: the grid still has to be told which cell
        /// constrains which column and row, since moving a cell asks the grid to let go of them
        /// (see `Grid.unconstrain`).
        update_cell_size: (cell, width, height) => ui.grid.constrain(cell, width, height),
        reposition_focus_point: () => {},
        /// As `UI.update_col_row_size`, which only the grid's sizes care about: nothing here is
        /// laid out, so there is nothing to resize and nothing to rerender.
        update_col_row_size: () => [],
        recode: () => {},
        /// As `UI.restack`: the stacking is the canvas's, which nothing here draws.
        restack: () => {},
        /// As `UI.update_mark_region`, which only the canvas shows.
        update_mark_region: () => {},
        /// As `UI.select` and `UI.deselect`, which are variadic, and where `deselect` with no
        /// argument clears the selection.
        select: (...cells) => {
            for (const cell of cells) {
                ui.selection.add(cell);
            }
        },
        deselect: (cell = null) => {
            if (cell === null) {
                ui.selection.clear();
            } else {
                ui.selection.delete(cell);
            }
        },
        update_selection: () => {},
        hide_if_unselected: () => {},
        selection_contains_edge: () =>
            Array.from(ui.selection).some((cell) => cell.is_edge()),

        /// As `UI.remove_cell`, without the elements or the colour picker.
        remove_cell: (cell, when) => {
            for (const removed of ui.quiver.remove(cell, when)) {
                if (removed.is_vertex()) {
                    ui.positions.delete(`${removed.position}`);
                    ui.grid.unconstrain(removed);
                }
                ui.selection.delete(removed);
                removed.element.remove();
            }
        },

        /// The text the diagram would be saved as, as `DiagramFile.text` writes it.
        text: () => `${
            ui.quiver.export(ui.format, ui.settings, ui.options(), ui.definitions()).data}\n`,

        /// Start again on an empty diagram, as `UI.reset` does.
        reset: () => {
            ui.quiver = new Quiver();
            ui.grid.clear();
            ui.positions.clear();
            ui.selection.clear();
            ui.format = "tikz-cd";
        },
    };
    return ui;
}

module.exports = { document, window, host, make_ui, StubElement, StubClassList };
