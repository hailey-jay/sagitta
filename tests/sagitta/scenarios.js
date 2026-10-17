/// What `driver.js` can do to a running Sagitta, by name. Each scenario gets the driver's `ctx` and
/// returns something JSON-serialisable for `tests/test_sagitta.py` to check.

const { clipboard } = require("electron");

module.exports = {
    /// The state straight after opening.
    open: async (ctx) => ({
        title: ctx.window.getTitle(),
        mode_line: await ctx.mode_line(),
        counts: await ctx.counts(),
    }),

    /// Save without changing anything.
    save: async (ctx) => {
        await ctx.save();
        return { title: ctx.window.getTitle() };
    },

    /// `C-i C-v`, with `argument` on the clipboard.
    import_paste: async (ctx) => {
        clipboard.writeText(ctx.argument);
        await ctx.press("i", ["control"]);
        await ctx.press("v", ["control"]);
        return { counts: await ctx.counts(), mode_line: await ctx.mode_line() };
    },

    /// `C-m C-v`, with `argument` on the clipboard.
    macros_paste: async (ctx) => {
        clipboard.writeText(ctx.argument);
        await ctx.press("m", ["control"]);
        await ctx.press("v", ["control"]);
        return { mode_line: await ctx.mode_line() };
    },

    /// `C-e y`, returning what lands on the clipboard.
    export_copy: async (ctx) => {
        clipboard.writeText("");
        await ctx.press("e", ["control"]);
        await ctx.press("y");
        return { clipboard: clipboard.readText(), mode_line: await ctx.mode_line() };
    },

    /// On the square `A B / C D`, with the focus point starting on `A`: Shift+Space selects `A`,
    /// then `B`, then deselects `B`; reselects `B`; does nothing on an empty cell; then plain Space
    /// on `D` connects `A` and `B` to it. Returns the counts after each step.
    space: async (ctx) => {
        const steps = {};
        const step = async (name, ...keys) => {
            for (const [key, modifiers] of keys) {
                await ctx.press(key, modifiers);
            }
            steps[name] = await ctx.counts();
        };
        await step("start");
        await step("select A", ["Space", ["shift"]]);
        await step("select B", ["Right"], ["Space", ["shift"]]);
        await step("deselect B", ["Space", ["shift"]]);
        await step("empty cell", ["Space", ["shift"]], ["Right"], ["Space", ["shift"]]);
        await step("connect to D", ["Left"], ["Down"], ["Space"]);
        return steps;
    },

    /// `C-e a`, turning ampersand replacement on, then leave the export layer. The setting should
    /// reach `settings.json`, which `tests/test_sagitta.py` reads.
    settings: async (ctx) => {
        await ctx.press("e", ["control"]);
        await ctx.press("a");
        await ctx.press("Escape");
        return { mode_line: await ctx.mode_line() };
    },

    /// Select everything, arrows included, which is what used to bring the side panel out.
    side_panel: async (ctx) => {
        await ctx.press("a", ["control"]);
        return ctx.js(`({
            selected: document.querySelectorAll(".cell.selected").length,
            panels: document.querySelectorAll(".panel, .slider, input[type=radio]").length,
        })`);
    },

    /// Select every cell, run each command in `argument` (a JSON list) through the command line,
    /// then save. The diagram it writes is the assertion; `tests/test_sagitta.py` reads the file.
    commands: async (ctx) => {
        await ctx.press("a", ["control"]);
        for (const command of JSON.parse(ctx.argument)) {
            await ctx.command(command);
        }
        await ctx.save();
        return { mode_line: await ctx.mode_line() };
    },

    /// Select every cell, run each command in `argument` (a JSON list) through the command line,
    /// and report what the arrows draw: each edge path's dash array, how many heads (tails
    /// included) each arrow has, where its label's centre is, to the pixel, and whether it draws
    /// the gap it cuts crossing over others, above them. The saved file can be right while the
    /// drawing is stale.
    drawn: async (ctx) => {
        await ctx.press("a", ["control"]);
        for (const command of JSON.parse(ctx.argument)) {
            await ctx.command(command);
        }
        return ctx.js(`Array.from(document.querySelectorAll(".arrow > svg:has(path.arrow-edge)"))
            .map((svg) => {
                const label = svg.closest(".arrow").querySelector(".arrow-label");
                const rect = label === null ? null : label.getBoundingClientRect();
                const crossing = svg.querySelector("path.arrow-crossing");
                return {
                    crossing: crossing !== null && crossing.getAttribute("display") !== "none"
                        && getComputedStyle(svg).zIndex === "5",
                    dashes: svg.querySelector("path.arrow-edge").getAttribute("stroke-dasharray"),
                    heads: svg.querySelectorAll(".arrow-head").length,
                    label: rect === null ? null : [
                        Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2),
                    ],
                };
            })`);
    },

    /// Select the arrows labelled as `argument.select` says, run each of `argument.commands`
    /// through the command line, and report the labels of the arrows raised for crossing over, in
    /// the order they are stacked on the canvas, with the order the export writes them.
    stacking: async (ctx) => {
        const { select = [], commands = [] } = JSON.parse(ctx.argument);
        await ctx.js(`ui.select(...ui.quiver.all_cells()
            .filter((cell) => cell.is_edge() && ${JSON.stringify(select)}.includes(cell.label)))`);
        for (const command of commands) {
            await ctx.command(command);
        }
        return ctx.js(`({
            stacked: Array.from(document.querySelectorAll(".arrow.crossing-over"))
                .map((arrow) => ui.quiver.all_cells()
                    .find((cell) => cell.is_edge() && cell.element.element === arrow).label),
            written: Array.from(ui.quiver.drawing_groups().flat())
                .filter((edge) => edge.drawing_rank() > 0).map((edge) => edge.label),
        })`);
    },

    /// Select every cell, then press each key in `argument` (a JSON list of keys, or of `[key,
    /// modifiers]`) inside the command layer, and save. This is the `;` layer's own path to the
    /// arrow options.
    layer: async (ctx) => {
        await ctx.press("a", ["control"]);
        await ctx.press(";");
        for (const step of JSON.parse(ctx.argument)) {
            const [key, modifiers = []] = Array.isArray(step) ? step : [step];
            await ctx.press(key, modifiers);
        }
        const mode_line = await ctx.mode_line();
        await ctx.press("Escape");
        await ctx.save();
        return { mode_line };
    },

    /// Press each key in `argument` (a JSON list of keys, or `[key, modifiers]`), without
    /// selecting anything first, then save, returning the mode line before saving, and whether a
    /// label was being edited.
    typing: async (ctx) => {
        for (const step of JSON.parse(ctx.argument)) {
            const [key, modifiers = []] = Array.isArray(step) ? step : [step];
            await ctx.press(key, modifiers);
        }
        const mode_line = await ctx.mode_line();
        const editing = await ctx.js("ui.input_is_active() !== false");
        await ctx.save();
        return { mode_line, editing, counts: await ctx.counts() };
    },

    /// Select every cell, press each key in `argument` (as for `typing`), and wait out the command
    /// layer's delay before listing its keys, returning which of its lists are shown.
    lists: async (ctx) => {
        await ctx.press("a", ["control"]);
        for (const step of JSON.parse(ctx.argument)) {
            const [key, modifiers = []] = Array.isArray(step) ? step : [step];
            await ctx.press(key, modifiers);
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
        return ctx.js(`(() => {
            const shown = (selector) => {
                const element = document.querySelector(selector);
                return element !== null && element.getClientRects().length > 0;
            };
            return { main: shown(".which-key .main"), submenu: shown(".which-key .submenu") };
        })()`);
    },

    /// Select every cell, then press each key in `argument` (a JSON list of `[key, modifiers]`)
    /// outside any layer, and save. Shift+Space on the vertices leaves only the arrows selected,
    /// which the arrow keys then nudge while panning (with Control held).
    keys: async (ctx) => {
        await ctx.press("a", ["control"]);
        for (const [key, modifiers = []] of JSON.parse(ctx.argument)) {
            await ctx.press(key, modifiers);
        }
        await ctx.save();
        return { counts: await ctx.counts(), mode_line: await ctx.mode_line() };
    },

    /// Press each key in `argument` (as for `keys`), without selecting anything first, the last
    /// with no wait after it, and return the size of the focus point, of each vertex's content and
    /// where it lies across the window, the view's centre, and the widths of the columns -2 to 3,
    /// just before the last key and on each of the next 20 frames, to show any jump or animation
    /// it sets off.
    frames: async (ctx) => {
        const keys = JSON.parse(ctx.argument);
        for (const [key, modifiers = []] of keys.slice(0, -1)) {
            await ctx.press(key, modifiers);
        }
        // The page samples itself once before the last key, which may act before the next frame,
        // and then on each frame after it.
        const before = await ctx.js(`(() => {
            const size = (element) => {
                const { width, height } = element.getBoundingClientRect();
                return [Math.round(width), Math.round(height)];
            };
            window.sample_layout = () => ({
                focus: size(document.querySelector(".focus-point")),
                vertices: Array.from(document.querySelectorAll(".vertex .content"), size),
                view: Math.round(ui.view.x),
                columns: [-2, -1, 0, 1, 2, 3].map((x) => Math.round(ui.grid.column_width(x))),
                left: Array.from(document.querySelectorAll(".vertex .content"),
                    (content) => Math.round(content.getBoundingClientRect().left)),
            });
            return window.sample_layout();
        })()`);
        const after = ctx.js(`(async () => {
            const sizes = [];
            for (let frame = 0; frame < 20; ++frame) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                sizes.push(window.sample_layout());
            }
            return sizes;
        })()`);
        const [key, modifiers = []] = keys.at(-1);
        await ctx.press(key, modifiers);
        return [before, ...await after];
    },

    /// Press each key in `argument` (as for `keys`), without selecting anything first, and return
    /// the codes of the vertices and the arrows, of the queued cells, and of the cell Tab goes to
    /// next, once the mode line has caught up.
    codes: async (ctx) => {
        for (const [key, modifiers = []] of JSON.parse(ctx.argument)) {
            await ctx.press(key, modifiers);
        }
        return ctx.js(`(async () => {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const codes = (selector) => Array.from(
                document.querySelectorAll(selector), (kbd) => kbd.dataset.code);
            return {
                vertices: codes(".vertex kbd"),
                edges: codes(".arrow kbd"),
                queued: codes(".cell kbd.queue"),
                next: codes(".cell kbd.next"),
            };
        })()`);
    },

    /// Drag from the first vertex to the last, then save.
    drag: async (ctx) => {
        const vertices = await ctx.vertices();
        await ctx.drag(vertices[0], vertices[vertices.length - 1]);
        const dirty = ctx.window.getTitle().includes(" + ");
        await ctx.save();
        return { dirty, counts: await ctx.counts() };
    },

    /// Drag `A` on the square by the edge of its grid cell (the content would start an arrow) to
    /// the empty cell right of `B`, then save, undo, and save again. Returns the mode line after
    /// the drag, and the diagram as saved after the move and after the undo.
    move: async (ctx) => {
        const [a, b] = await ctx.vertices();
        const offset = 48;
        await ctx.drag([a[0], a[1] - offset], [2 * b[0] - a[0], b[1] - offset]);
        const mode_line = await ctx.mode_line();
        const read = () => require("node:fs").readFileSync(ctx.diagram, "utf8");
        await ctx.save();
        const moved = read();
        await ctx.press("z", ["control"]);
        await ctx.save();
        return { mode_line, moved, undone: read() };
    },

    /// Click the empty cell right of `B` on the square, once to move the focus point there and
    /// again to create a vertex, then save.
    click: async (ctx) => {
        const [a, b] = await ctx.vertices();
        const empty = [2 * b[0] - a[0], b[1]];
        const steps = {};
        await ctx.click(empty);
        steps.moved = await ctx.counts();
        await ctx.click(empty);
        steps.created = await ctx.counts();
        await ctx.save();
        return steps;
    },

    /// Drag from the empty cell right of `B` on the square to `A`: a vertex is created there as
    /// the pointer leaves the focus point, and connected to `A`. Then save.
    drag_from_focus_point: async (ctx) => {
        const [a, b] = await ctx.vertices();
        const empty = [2 * b[0] - a[0], b[1]];
        await ctx.drag(empty, a);
        await ctx.save();
        return { counts: await ctx.counts() };
    },

    /// Press each key in `argument.keys` (a list of `[key, modifiers]`), then, if `argument.macros`
    /// is given, write it to `argument.macros_file` and wait for the reload. Returns the boxes of
    /// each vertex's content, and of each arrow's line (drawn from the centre of its source to that
    /// of its target, before the ends are masked off), in the order they were created.
    layout: async (ctx) => {
        const { keys = [], macros = null, macros_file = null } = JSON.parse(ctx.argument);
        for (const [key, modifiers = []] of keys) {
            await ctx.press(key, modifiers);
        }
        if (macros !== null) {
            require("node:fs").writeFileSync(macros_file, macros);
            await ctx.wait(1500);
        }
        return ctx.js(`(() => {
            const box = (element) => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            };
            return {
                vertices: [...document.querySelectorAll(".vertex .content")].map(box),
                arrows: [...document.querySelectorAll(".arrow.cell path.arrow-edge")].map(box),
            };
        })()`);
    },

    /// `:dark-mode`, then save. Returns whether it is on, and the colours an arrow in the default
    /// colour, and a label, are drawn in.
    dark_mode: async (ctx) => {
        await ctx.command("dark-mode");
        await ctx.save();
        return ctx.js(`({
            dark: document.body.classList.contains("dark"),
            stroke: getComputedStyle(
                document.querySelector(".arrow.cell path:not(mask *)[stroke^=hsla]"),
            ).stroke,
            label: getComputedStyle(document.querySelector(".vertex .label")).color,
        })`);
    },

    /// Select every cell and enter the command layer, returning its key list as `[keys,
    /// description, chords]`.
    which_key: async (ctx) => {
        await ctx.press("a", ["control"]);
        await ctx.press(";");
        return ctx.js(`[...document.querySelectorAll(".which-key .main .entry")].map((entry) => [
            entry.querySelector("kbd").textContent,
            entry.querySelector("kbd + span").textContent,
            entry.querySelector(".chord").textContent,
        ])`);
    },

    /// Go through the steps in `argument` (a JSON list), then save. A step is `["press", key,
    /// modifiers]`; `["entry", description]`, clicking the line of the key list so described;
    /// `["step", description, glyph]`, clicking that slider's `−` or `+`; or `["right-click",
    /// index]`, on the vertex at `index`. Returns the counts, and whether the command layer is
    /// open.
    pointer: async (ctx) => {
        const centre = (expression) => ctx.js(`(() => {
            const rect = (${expression}).getBoundingClientRect();
            return [rect.x + rect.width / 2, rect.y + rect.height / 2];
        })()`);
        const entry = (description) => `[...document.querySelectorAll(".which-key .entry")]
            .find((entry) => entry.offsetParent !== null
                && entry.querySelector("kbd + span, i + span").textContent
                    === ${JSON.stringify(description)})`;
        // The command layer lists its keys only once it has waited for one (see `Keymap.enter`).
        const listed = async (expression) => {
            for (let tries = 0; !await ctx.js(`${expression} !== undefined`); ++tries) {
                if (tries > 40) {
                    throw new Error(`nothing to click: ${expression}`);
                }
                await ctx.wait(50);
            }
            return expression;
        };
        for (const [kind, ...rest] of JSON.parse(ctx.argument)) {
            switch (kind) {
                case "press":
                    await ctx.press(rest[0], rest[1] ?? []);
                    break;
                case "entry":
                    await ctx.click(await centre(await listed(entry(rest[0]))));
                    break;
                case "step":
                    await listed(entry(rest[0]));
                    await ctx.click(await centre(`[...(${entry(rest[0])}).querySelectorAll(
                        ".steps button")].find((button) => button.textContent === "${rest[1]}")`));
                    break;
                case "right-click":
                    await ctx.click((await ctx.vertices())[rest[0]], "right");
                    break;
            }
        }
        const open = await ctx.js(`!document.querySelector(".which-key")
            .classList.contains("hidden")`);
        await ctx.save();
        return { counts: await ctx.counts(), open };
    },

    /// Go through the steps in `argument` (a JSON list), returning what each `eval` step found. A
    /// step is `["press", key, modifiers]`, `["wait", ms]`, or `["eval", expression]`, the value
    /// of the JavaScript `expression` in the page.
    script: async (ctx) => {
        const found = [];
        for (const [kind, ...rest] of JSON.parse(ctx.argument)) {
            switch (kind) {
                case "press":
                    await ctx.press(rest[0], rest[1] ?? []);
                    break;
                case "wait":
                    await ctx.wait(rest[0]);
                    break;
                case "eval":
                    found.push(await ctx.js(rest[0]));
                    break;
            }
        }
        return found;
    },

    /// The mark (`C-SPC`): on the square `A B / C D`, with the focus point on `A`, take the top
    /// row, then the whole square, then add the row again to show Shift adds rather than replaces,
    /// and finally drop a mark with Escape. Returns the counts and the mode line after each step,
    /// with whether the rectangle from the mark is shown, its size in cells, and how many cells it
    /// marks as those it would take.
    mark: async (ctx) => {
        const steps = {};
        const region = () => ctx.js(`(() => {
            const region = document.querySelector(".mark-region");
            const shown = !region.classList.contains("hidden");
            const cell = ui.grid.column_width(0);
            return {
                shown,
                size: shown ? [Math.round(region.offsetWidth / cell),
                    Math.round(region.offsetHeight / cell)] : null,
                inside: document.querySelectorAll(".cell.in-mark").length,
            };
        })()`);
        const step = async (name, ...keys) => {
            for (const [key, modifiers = []] of keys) {
                await ctx.press(key, modifiers);
            }
            steps[name] = {
                counts: await ctx.counts(),
                mode_line: await ctx.mode_line(),
                region: await region(),
            };
        };
        // `A` and `B`, and the arrow between them.
        await step("mark at A", ["Space", ["control"]]);
        // Before the mark is used, the rectangle grows with the focus point.
        await step("towards B", ["Right"]);
        await step("top row", ["Space", ["control"]]);
        // The whole square, from `A` again: four vertices and all four arrows.
        await step("square", ["Left"], ["Space", ["control"]],
            ["Right"], ["Down"], ["Space", ["control"]]);
        // Shift adds, so marking the top row again over the square leaves the square selected.
        await step("adding the row", ["Up"], ["Left"], ["Space", ["control"]],
            ["Right"], ["Space", ["control", "shift"]]);
        // A mark dropped with Escape selects nothing, and the selection is left alone.
        await step("mark dropped", ["Space", ["control"]], ["Escape"]);
        return steps;
    },

    /// Press each key in `argument` (a JSON list of `[key, modifiers]`), with nothing selected
    /// first and nothing saved after, and report the counts and the mode line.
    pressed: async (ctx) => {
        for (const [key, modifiers = []] of JSON.parse(ctx.argument)) {
            await ctx.press(key, modifiers);
        }
        return { counts: await ctx.counts(), mode_line: await ctx.mode_line() };
    },

    /// A Control key whose release the window never sees, as when a file dialog or another window
    /// takes the focus while it is held: Control goes down and stays down as far as the page knows,
    /// which pans. Then plain keys, with Control up, as the next real key press reports: Right
    /// moves the focus point from `A`, and `C-SPC` twice takes the top row. Returns the mode after
    /// the stuck key, after Right, and the counts at the end.
    stale_pan: async (ctx) => {
        ctx.contents.sendInputEvent({ type: "keyDown", keyCode: "Control", modifiers: ["control"] });
        await ctx.wait(50);
        const stuck = await ctx.js("ui.mode.name");
        await ctx.press("Right");
        const after = await ctx.js("ui.mode.name");
        await ctx.press("Left");
        await ctx.press("Space", ["control"]);
        await ctx.press("Right");
        await ctx.press("Space", ["control"]);
        return { stuck, after, counts: await ctx.counts() };
    },

    /// `:set` for each of `argument` (a JSON list of command lines), returning the mode line after
    /// each, and the settings as the page holds them at the end. `tests/test_sagitta.py` also reads
    /// `settings.json`, which every change rewrites.
    set_command: async (ctx) => {
        const lines = [];
        for (const command of JSON.parse(ctx.argument)) {
            await ctx.command(command);
            lines.push(await ctx.mode_line());
        }
        return { lines, settings: await ctx.js("ui.settings.data") };
    },

    /// A preset key with nothing selected sets the preset new arrows take: `=` for equals, then
    /// Space twice to draw an arrow with it, and save. Returns the mode line, the setting, and
    /// whether the command layer marks equals as the one in force.
    preset_default: async (ctx) => {
        await ctx.press("=");
        const mode_line = await ctx.mode_line();
        const preset = await ctx.js(`ui.settings.get("diagram.arrow_preset")`);
        // The list marks the preset only while it is shown, which `;` does.
        await ctx.press(";");
        const shown = `document.querySelector(".which-key") !== null`
            + ` && !document.querySelector(".which-key").classList.contains("hidden")`;
        for (let tries = 0; !await ctx.js(shown); ++tries) {
            if (tries > 40) {
                throw new Error("the key list never showed");
            }
            await ctx.wait(50);
        }
        const current = await ctx.js(
            `[...document.querySelectorAll(".which-key .main .entry.current")]`
            + `.map((entry) => entry.querySelector("kbd + span").textContent)`);
        await ctx.press("Escape");
        // An arrow drawn now should take the new default: Space on an empty cell makes a vertex,
        // and Space on the next connects the selection to it.
        await ctx.press("Space");
        await ctx.press("Right");
        await ctx.press("Space");
        await ctx.save();
        return { mode_line, preset, current, counts: await ctx.counts() };
    },

    /// The wheel: pan with no modifier, then zoom with Shift and with Control. Returns the scale
    /// and the view after each, to the pixel.
    ///
    /// The modified turns zoom out rather than in, since the diagram opens one step below
    /// `CONSTANTS.MAX_ZOOM` and two steps in would both clamp to it, which would say nothing about
    /// the second.
    ///
    /// The plain turn is a real input event. The modified ones are `WheelEvent`s dispatched in the
    /// page, because Chromium does not deliver a ctrl+wheel from `sendInputEvent` to the page as a
    /// wheel event at all (it reserves the gesture), so a real one would check nothing.
    wheel: async (ctx) => {
        const state = async () => ctx.js("({ scale: ui.scale, view: [ui.view.x, ui.view.y] })");
        const turn = (modifier) => ctx.js(`window.dispatchEvent(new WheelEvent("wheel", {
            deltaX: 0, deltaY: 100, clientX: 600, clientY: 400, ${modifier}: true,
            bubbles: true, cancelable: true,
        }))`);
        const steps = { start: await state() };
        await ctx.wheel([600, 400], 100);
        steps.plain = await state();
        await turn("shiftKey");
        steps.shift = await state();
        await turn("ctrlKey");
        steps.control = await state();
        return steps;
    },

    /// Dragging with the middle button pans, from over a cell as well as from empty space, and
    /// leaves the diagram and the selection alone.
    middle_drag: async (ctx) => {
        const state = async () => ({
            view: await ctx.js("[Math.round(ui.view.x), Math.round(ui.view.y)]"),
            counts: await ctx.counts(),
        });
        const [a] = await ctx.vertices();
        const steps = { start: await state() };
        // From a vertex, which a left drag would instead draw an arrow from.
        await ctx.drag(a, [a[0] + 120, a[1] + 80], "middle");
        steps.from_a_cell = await state();
        await ctx.drag([1000, 700], [900, 600], "middle");
        steps.from_empty_space = await state();
        steps.dirty = ctx.window.getTitle().includes(" + ");
        return steps;
    },

    /// Opening a gap, anchored on the focus point: move the focus point by the keys in
    /// `argument.keys`, run `argument.command`, then save. Returns where every vertex ended up,
    /// then undoes and returns that too, so one undo is shown to close the gap.
    insert: async (ctx) => {
        const { keys = [], command } = JSON.parse(ctx.argument);
        for (const [key, modifiers = []] of keys) {
            await ctx.press(key, modifiers);
        }
        const grid = () => ctx.js(`[...ui.quiver.all_cells()].filter((cell) => cell.is_vertex())`
            + `.map((cell) => cell.label + cell.position.x + cell.position.y).sort().join(" ")`);
        const before = await grid();
        await ctx.command(command);
        const after = await grid();
        await ctx.save();
        await ctx.press("z", ["control"]);
        return { before, after, undone: await grid(), mode_line: await ctx.mode_line() };
    },

    /// Routes: select every cell, then take each step of `argument` (a JSON list): a string runs
    /// through the command line, `[x, y]` moves the focus point to that cell, `{ keys }` presses
    /// each `[key, modifiers]`, `{ hover }` rests the pointer on the selected arrows' checkpoint
    /// ring of that index, and `{ js }` runs JavaScript in the page. Then save, and report each
    /// arrow's route as its options hold it, whether it is drawn, how many arcs its line turns
    /// through, where on the screen its ends, label, and checkpoint marks are, and whether each
    /// mark shows and is carried, beside the centres of the vertices.
    route: async (ctx) => {
        await ctx.press("a", ["control"]);
        for (const step of JSON.parse(ctx.argument)) {
            if (typeof step === "string") {
                await ctx.command(step);
            } else if (Array.isArray(step)) {
                await ctx.js(`ui.reposition_focus_point(new Position(${step[0]}, ${step[1]}))`);
            } else if (step.drag !== undefined) {
                // Drag the selected arrow's checkpoint at one cell to another, by its ring.
                const [[fx, fy], [tx, ty]] = step.drag;
                const [from, to] = await ctx.js(`(() => {
                    const ring = document.querySelector(".arrow.selected .arrow-checkpoint-handle");
                    const rect = ring.getBoundingClientRect();
                    const cells = [${fx}, ${fy}, ${tx}, ${ty}];
                    const offset = (x, y) => ui.grid.centre_offset_from_position(new Position(x, y));
                    const shift = offset(cells[2], cells[3]).sub(offset(cells[0], cells[1]));
                    const from = [rect.x + rect.width / 2, rect.y + rect.height / 2];
                    return [from, [from[0] + shift.x, from[1] + shift.y]];
                })()`);
                await ctx.drag(from, to);
            } else if (step.hover !== undefined) {
                await ctx.hover(await ctx.js(`(() => {
                    const rect = document.querySelectorAll(
                        ".arrow.selected .arrow-checkpoint-handle")[${step.hover}]
                        .getBoundingClientRect();
                    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
                })()`));
            } else if (step.js !== undefined) {
                await ctx.js(step.js);
            } else {
                for (const [key, modifiers = []] of step.keys) {
                    await ctx.press(key, modifiers);
                }
            }
        }
        // What the mode line says after the last step, before saving says something else.
        const flashed = await ctx.mode_line();
        await ctx.save();
        const vertices = await ctx.vertices();
        const edges = await ctx.js(`[...ui.quiver.all_cells()].filter((cell) => cell.is_edge())
            .map((edge) => {
                const centre = (element) => {
                    const rect = element.getBoundingClientRect();
                    return [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)];
                };
                const arrow = edge.element.element;
                const line = arrow.querySelector("path.arrow-edge");
                const label = arrow.querySelector(".arrow-label");
                return {
                    route: edge.options.route,
                    drawn: !arrow.classList.contains("invalid")
                        && !arrow.querySelector("svg:has(path.arrow-edge)").classList.contains("invalid"),
                    arcs: (line.getAttribute("d").match(/^a /gm) ?? []).length,
                    source: centre(arrow.querySelector(".arrow-endpoint.source")),
                    target: centre(arrow.querySelector(".arrow-endpoint.target")),
                    label: label === null ? null : centre(label),
                    checkpoints: [...arrow.querySelectorAll(".arrow-checkpoint")]
                        .map((checkpoint) => ({
                            shown: getComputedStyle(checkpoint).display !== "none",
                            carried: checkpoint.classList.contains("carried"),
                            centre: centre(checkpoint),
                        })),
                };
            })`);
        return {
            vertices,
            edges,
            flashed,
            steps: await ctx.js("ui.history.present"),
        };
    },

    /// The value of the JavaScript expression `argument`, evaluated in the page.
    evaluate: async (ctx) => ctx.js(ctx.argument),

    /// `C-/`, returning the help layer as `[title, [[keys, description]]]`.
    help: async (ctx) => {
        await ctx.press("/", ["control"]);
        return ctx.js(`[...document.querySelectorAll(".which-key .submenu .group")].map((group) => [
            group.querySelector("h3").textContent,
            [...group.querySelectorAll(".entry")].map((entry) => [
                entry.querySelector("kbd").textContent,
                entry.querySelector("kbd + span, i + span").textContent,
            ]),
        ])`);
    },

    /// Try to leave the page, by a drop the page cannot place on disk and by navigating.
    navigate: async (ctx) => ctx.js(`(async () => {
        const data = new DataTransfer();
        data.items.add(new File(["x"], "x.tikzcd"));
        const drop = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
        document.body.dispatchEvent(drop);
        location.href = "file:///etc/hostname";
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
            drop_prevented: drop.defaultPrevented,
            still_here: location.pathname.endsWith("index.html"),
            vertices: document.querySelectorAll(".vertex").length,
        };
    })()`),
};
