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
    /// included) each arrow has, and where its label's centre is, to the pixel. The saved file can
    /// be right while the drawing is stale.
    drawn: async (ctx) => {
        await ctx.press("a", ["control"]);
        for (const command of JSON.parse(ctx.argument)) {
            await ctx.command(command);
        }
        return ctx.js(`Array.from(document.querySelectorAll(".arrow > svg:has(path.arrow-edge)"))
            .map((svg) => {
                const label = svg.closest(".arrow").querySelector(".arrow-label");
                const rect = label === null ? null : label.getBoundingClientRect();
                return {
                    dashes: svg.querySelector("path.arrow-edge").getAttribute("stroke-dasharray"),
                    heads: svg.querySelectorAll(".arrow-head").length,
                    label: rect === null ? null : [
                        Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2),
                    ],
                };
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
