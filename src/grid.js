/// The grid the diagram is laid out on: the width of each column and the height of each row, which
/// grow to fit the largest cell in them, and the conversions between a `Position` (cell indices)
/// and an `Offset` (pixels, measured from the corner of the cell at the origin). Where the grid
/// sits in the window is the view's business (see `UI.pan_to` and `UI.offset_from_event`), as is
/// drawing it (`UI.update_grid`).
///
/// It is laid out as tikz-cd lays out its matrix, so that the canvas looks like the PDF: a column
/// is as wide as its widest node, its label with tikz-cd's padding, and a gap, so that neighbouring
/// nodes are a gap apart, and an empty column is the gap alone. Rows are the same. `UI.update_scale`
/// sets the gap and the padding from the separations and the label size.
///
/// That holds within the diagram's extent, between its outermost cells and checkpoints, where an
/// empty column or row is the gap alone, as in the PDF. Beyond it, an empty one is as big as one
/// holding a bullet, so that the space around a diagram does not change size as it is drawn into.
class Grid {
    constructor() {
        // The space between neighbouring nodes, in pixels, across columns (`x`) and rows (`y`),
        // which is all an empty column or row within the extent has.
        this.gap = { x: 75, y: 57 };
        // What a node adds to its label on each side, in pixels.
        this.padding = { x: 14, y: 3 };
        // The size of a bullet's node, in pixels, which an empty column or row beyond the extent
        // takes.
        this.bullet = { x: 44, y: 44 };
        // The diagram's extent, as `{ x: [least, most], y: [least, most] }`, or `null` while it is
        // empty (see `UI.update_extent`).
        this.extent = null;
        // The columns and rows of a layout worked out whole rather than fitted cell by cell, as
        // amscd's is (see `AmsCD.layout`): `{ x, y }`, each a map from an index to `{ size, centre }`,
        // where `centre` is how far into it its cells' centre is, or `null`.
        this.fixed = null;

        this.clear();
    }

    /// The size of an empty column (`axis` `"x"`) or row (`"y"`) at `index`: the gap, within the
    /// extent, and a bullet's node and the gap beyond it.
    empty_size(axis, index) {
        const extent = this.extent?.[axis] ?? null;
        const within = extent !== null && index >= extent[0] && index <= extent[1];
        return this.gap[axis] + (within ? 0 : this.bullet[axis]);
    }

    /// The size of a node whose label measures `width` by `height`: nothing, for an empty label,
    /// which tikz-cd draws no node for.
    node_size(width, height) {
        return new Dimensions(
            width > 0 ? width + this.padding.x * 2 : 0,
            height > 0 ? height + this.padding.y * 2 : 0,
        );
    }

    /// The least size of a vertex's content, so that an empty one can still be clicked.
    content_minimum() {
        return Math.min(this.gap.x, this.gap.y) * 0.75;
    }

    /// Forget every size, as when the diagram is cleared.
    clear() {
        // The width of each column and the height of each row. Defaults to the gap.
        this.widths = new Map();
        this.heights = new Map();
        // The constraints on the width and height of each cell: we use the maximum constraint for
        // final width/height. We store these separately from `widths` and `heights` to avoid
        // recomputing the sizes every time, as we access them frequently.
        this.width_constraints = new Map();
        this.height_constraints = new Map();
    }

    /// Get the width or height of a particular column or row. You should use this (or
    /// `column_width` and `row_height`) instead of directly accessing `widths` or `heights`, to
    /// ensure an empty one is the gap.
    size(sizes, index) {
        const axis = sizes === this.widths ? "x" : "y";
        return this.fixed?.[axis].get(index)?.size ?? sizes.get(index)
            ?? this.empty_size(axis, index);
    }

    /// The width of the column `x`.
    column_width(x) {
        return this.size(this.widths, x);
    }

    /// The height of the row `y`.
    row_height(y) {
        return this.size(this.heights, y);
    }

    /// Get a column or row number corresponding to an offset (in pixels), as well as the partial
    /// offset from the absolute position of that column and row origin.
    cell_from_offset(sizes, offset) {
        // We explore the grid in both directions, starting from the origin.
        let index = 0;
        const original_offset = offset;
        if (offset === 0) {
            return [index, 0];
        }
        // The following two loops have been kept separate to increase readability.
        // Explore to the right or bottom...
        while (offset >= 0) {
            const size = this.size(sizes, index);
            if (offset < size) {
                return [index, original_offset - offset];
            }
            offset -= size;
            ++index;
        }
        // Explore to the left or top...
        while (offset <= 0) {
            --index;
            const size = this.size(sizes, index);
            if (Math.abs(offset) < size) {
                return [index, original_offset - (offset + size)];
            }
            offset += size;
        }
    }

    /// Get a column and row number corresponding to an offset, as well as the partial offsets from
    /// the absolute positions of the column and row. See `cell_from_offset` for details.
    col_row_offset_from_offset(offset) {
        return [
            this.cell_from_offset(this.widths, offset.x),
            this.cell_from_offset(this.heights, offset.y),
        ];
    }

    /// Get a column and row number corresponding to an offset.
    col_row_from_offset(offset) {
        return this.col_row_offset_from_offset(offset).map(([index, _]) => index);
    }

    /// Convert an `Offset` (pixels) to a `Position` (cell indices).
    /// The inverse function is `offset_from_position`.
    position_from_offset(offset) {
        const [col, row] = this.col_row_from_offset(offset);
        return new Position(col, row);
    }

    /// How far into the cell at `position` its centre is: halfway, unless a fixed layout puts it
    /// elsewhere.
    cell_centre_at_position(position) {
        return new Offset(
            this.fixed?.x.get(position.x)?.centre ?? this.column_width(position.x) / 2,
            this.fixed?.y.get(position.y)?.centre ?? this.row_height(position.y) / 2,
        );
    }

    /// Computes the offset to the centre of the cell at `position`.
    centre_offset_from_position(position) {
        const offset = this.offset_from_position(position);
        const centre = this.cell_centre_at_position(position);
        return offset.add(centre);
    }

    /// Convert a `Position` (cell indices) to an `Offset` (pixels).
    /// The inverse function is `position_from_offset`.
    offset_from_position(position) {
        const offset = Offset.zero();

        // We attempt to explore in each of the four directions in turn.
        // These four loops could be simplified, but have been left as-is to aid readability.

        if (position.x > 0) {
            for (let col = 0; col < Math.floor(position.x); ++col) {
                offset.x += this.column_width(col);
            }
            offset.x += this.column_width(Math.floor(position.x)) * (position.x % 1);
        }
        if (position.x < 0) {
            for (let col = -1; col >= position.x; --col) {
                offset.x -= this.column_width(col);
            }
            offset.x += this.column_width(Math.floor(position.x)) * (position.x % 1);
        }

        if (position.y > 0) {
            for (let row = 0; row < Math.floor(position.y); ++row) {
                offset.y += this.row_height(row);
            }
            offset.y += this.row_height(Math.floor(position.y)) * (position.y % 1);
        }
        if (position.y < 0) {
            for (let row = -1; row >= position.y; --row) {
                offset.y -= this.row_height(row);
            }
            offset.y += this.row_height(Math.floor(position.y)) * (position.y % 1);
        }

        return offset;
    }

    /// Record the size of the content of `cell`, which constrains the size of its column and row
    /// (see `fit`).
    constrain(cell, width, height) {
        const update_size = (constraints, offset, size) => {
            if (!constraints.has(offset)) {
                constraints.set(offset, new Map());
            }
            constraints.get(offset).set(cell, size);
        };

        update_size(this.width_constraints, cell.position.x, width);
        update_size(this.height_constraints, cell.position.y, height);
    }

    /// Forget the size of the content of `cell`, as when it leaves its position.
    unconstrain(cell) {
        this.width_constraints.get(cell.position.x).delete(cell);
        this.height_constraints.get(cell.position.y).delete(cell);
    }

    /// Resize the column and the row at `position` to fit the largest cell in each. Returns how
    /// much each grew, as `[delta_x, delta_y]`.
    fit(position) {
        // A fixed layout is worked out whole, and does not fit its cells one by one.
        if (this.fixed !== null) {
            return [0, 0];
        }
        // Compute how much a column or row size has changed and update the size.
        const delta = (constraints, sizes, offset, axis) => {
            // If we have just deleted a cell, there may be no constraint data for that offset,
            // in which case the maximum size is simply zero.
            const constraint_sizes = constraints.has(offset) ?
                Array.from(constraints.get(offset)).map(([_, size]) => size) : [];
            // The size of a column or row is its largest node's, and the gap, which it shares
            // half and half with each neighbour, as tikz-cd centres its nodes.
            const max_size = Math.max(0, ...constraint_sizes);
            const new_size = max_size > 0 ? max_size + this.padding[axis] * 2 + this.gap[axis]
                : this.empty_size(axis, offset);
            const delta = new_size - this.size(sizes, offset);

            if (delta !== 0) {
                sizes.set(offset, new_size);
            }

            return delta;
        };

        return [
            delta(this.width_constraints, this.widths, position.x, "x"),
            delta(this.height_constraints, this.heights, position.y, "y"),
        ];
    }

    /// The size of the columns and rows spanned by `bounding_rect` (see `Quiver.bounding_rect`).
    size_of(bounding_rect) {
        const [[x_min, y_min], [x_max, y_max]] = bounding_rect;
        let [width, height] = [0, 0];
        for (let x = x_min; x <= x_max; ++x) {
            width += this.column_width(x);
        }
        for (let y = y_min; y <= y_max; ++y) {
            height += this.row_height(y);
        }
        return new Dimensions(width, height);
    }
}
