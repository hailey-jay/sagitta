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
});
