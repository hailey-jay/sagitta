/// The grid the diagram is laid out on: the width of each column and the height of each row, which
/// grow to fit the largest cell in them, and the conversions between a `Position` (cell indices)
/// and an `Offset` (pixels, measured from the corner of the cell at the origin). Where the grid
/// sits in the window is the view's business (see `UI.pan_to` and `UI.offset_from_event`), as is
/// drawing it (`UI.update_grid`).
class Grid {
    constructor() {
        // The default (minimum) size of each column and row, if a width or height has not been
        // specified.
        this.default_size = 128;

        this.clear();
    }

    /// Forget every size, as when the diagram is cleared.
    clear() {
        // The width of each column and the height of each row. Defaults to `default_size`.
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
    /// ensure it defaults to `default_size`.
    size(sizes, index) {
        return sizes.get(index) || this.default_size;
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

    /// Returns half the size of the cell at the given `position`.
    cell_centre_at_position(position) {
        return new Offset(
            this.column_width(position.x) / 2,
            this.row_height(position.y) / 2,
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
        // We keep a margin around the content of each cell. This gives space for dragging them
        // with the pointer.
        const MARGIN = this.default_size * 0.5;

        // Compute how much a column or row size has changed and update the size.
        const delta = (constraints, sizes, offset) => {
            // If we have just deleted a cell, there may be no constraint data for that offset,
            // in which case the maximum size is simply zero.
            const constraint_sizes = constraints.has(offset) ?
                Array.from(constraints.get(offset)).map(([_, size]) => size) : [];
            // The size of a column or row is determined by the largest cell.
            const max_size = Math.max(0, ...constraint_sizes);
            const new_size = Math.max(this.default_size, max_size + MARGIN);
            const delta = new_size - this.size(sizes, offset);

            if (delta !== 0) {
                sizes.set(offset, new_size);
            }

            return delta;
        };

        return [
            delta(this.width_constraints, this.widths, position.x),
            delta(this.height_constraints, this.heights, position.y),
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
