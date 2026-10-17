/// The editor's parameters, added to the arrow renderer's (`src/arrow.js`). `ArrowOptions` reads
/// them as it is defined, so this loads before `src/options.js`.
Object.assign(CONSTANTS, {
    /// We currently only support n-cells for (n ≤ 4). This restriction is not technical: it can be
    /// lifted in the editor without issue. Rather, this is for usability: a user is unlikely to
    /// want to draw a higher cell. For n-cells for n ≥ 3, we make use of tikz-nfold in exported
    /// diagrams.
    MAXIMUM_CELL_LEVEL: 4,
    /// The width of the dashed grid lines.
    GRID_BORDER_WIDTH: 2,
    /// The padding of the content area of a vertex.
    CONTENT_PADDING: 8,
    /// How much (horizontal and vertical) space (in pixels) in the SVG to give around the arrow
    /// (to account for artefacts around the drawing).
    SVG_PADDING: 6,
    /// How much space (in pixels) to leave between adjacent parallel arrows.
    EDGE_OFFSET_DISTANCE: 8,
    /// How many pixels each unit of curve height corresponds to.
    CURVE_HEIGHT: 24,
    /// How many pixels each unit of a route's rounding corresponds to.
    ROUNDING: 8,
    /// How many pixels each unit of loop radius corresponds to.
    LOOP_HEIGHT: 16,
    /// How many pixels of padding to place around labels on edges.
    EDGE_LABEL_PADDING: 8,
    /// How much padding to try to keep around the focus point when moving it via the keyboard
    /// (in pixels).
    VIEW_PADDING: 128,
    /// How much to shorten edges connected to edges by (in %), by default.
    EDGE_EDGE_PADDING: 20,
    /// Minimum and maximum zoom levels.
    MIN_ZOOM: -2.5,
    MAX_ZOOM: 1,

    /// The canvas is laid out as tikz-cd lays the diagram out, in a 10pt document, scaled so that
    /// labels are the size KaTeX draws them (see `UI.update_scale`). These were measured from
    /// tikz-cd's own output.
    TEX: {
        /// A TeX em, in pt, which tikz-cd's separations are given in.
        EM: 10,
        /// How much larger KaTeX draws maths than the font size it is given (its `.katex` rule).
        KATEX_SCALE: 1.21,
        /// What tikz-cd puts around a label to make its node, on each side, in pt.
        NODE_PADDING: { x: 4.5, y: 0.9 },
        /// How far apart tikz-cd puts neighbouring nodes, per pt of separation: a column's gap is
        /// a third more than its `column sep`, and a row's is its `row sep`.
        GAP: { x: 4 / 3, y: 1 },
        /// The size of a bullet's node, in pt, which an empty column or row beyond the diagram
        /// takes (see `Grid`).
        BULLET: { x: 14, y: 14 },
        /// A millimetre, in pt, which a loop's distance is given in.
        PT_PER_MM: 72.27 / 25.4,
        /// The unit of tikz-cd's `shift left` and `shift right`, 0.56ex, in pt.
        SHIFT: 2.41,
    },
});
