/// Runs Sagitta headless and drives it through one scenario from `scenarios.js`, for
/// `tests/test_sagitta.py`:
///
///     electron --ozone-platform=headless driver.js APP SCENARIO DIAGRAM [ARGUMENT]
///
/// Sagitta's own `electron/main.js` is loaded as is, told to open `DIAGRAM`, and the scenario gets
/// its window once the diagram has loaded. The last line printed is `RESULT <json>`, holding the
/// scenario's return value and every console error the page logged. Key and mouse input goes
/// through `sendInputEvent`, so the page sees trusted events, as it would from a real keyboard.

const { app } = require("electron");
const path = require("node:path");

const [appdir, scenario, diagram, argument = null] =
    process.argv.slice(process.argv.findIndex((a) => a.endsWith("driver.js")) + 1);
const scenarios = require(path.join(__dirname, "scenarios.js"));

// Sagitta's argument parsing expects the stock binary's layout: the app's directory, then its own
// arguments.
process.argv = [process.argv[0], appdir, diagram];

/// The key each of `sendInputEvent`'s modifier names is held down by.
const MODIFIER_KEYS = { control: "Control", shift: "Shift", alt: "Alt", meta: "Meta" };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const errors = [];

async function run(window) {
    const contents = window.webContents;
    const js = (source) => contents.executeJavaScript(source);

    // Wait for the diagram to load, which titles the window, and for KaTeX to lay out.
    for (let tries = 0; !window.getTitle().endsWith(" - Sagitta"); ++tries) {
        if (tries > 100) {
            throw new Error(`the window never loaded (title: ${window.getTitle()})`);
        }
        await wait(50);
    }
    await js("document.fonts.ready.then(() => null)");
    await wait(200);
    contents.focus();

    const ctx = {
        window,
        contents,
        argument,
        diagram,
        wait,
        js,
        /// Press `key` (an Electron accelerator key code) with `modifiers`. The modifier keys go
        /// down first and come up last, as on a real keyboard, since holding Control is itself a
        /// binding (it pans).
        press: async (key, modifiers = []) => {
            const held = modifiers.map((modifier) => MODIFIER_KEYS[modifier]);
            for (const [i, modifier] of held.entries()) {
                contents.sendInputEvent(
                    { type: "keyDown", keyCode: modifier, modifiers: modifiers.slice(0, i + 1) });
            }
            contents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
            const character = { Space: " " }[key] ?? key;
            if ([...character].length === 1) {
                contents.sendInputEvent({ type: "char", keyCode: character, modifiers });
            }
            contents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
            for (const [i, modifier] of [...held.entries()].reverse()) {
                contents.sendInputEvent(
                    { type: "keyUp", keyCode: modifier, modifiers: modifiers.slice(0, i) });
            }
            await wait(150);
        },
        /// Drag with the left button from `from` to `to`, each `[x, y]` in the page.
        drag: async (from, to) => {
            const mouse = (type, [x, y], modifiers = []) => contents.sendInputEvent(
                { type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, modifiers });
            mouse("mouseMove", from);
            mouse("mouseDown", from);
            // Pressing can put the focus point under the pointer, which only counts as over it
            // (and so can later leave it) once a frame has been drawn.
            await wait(50);
            for (let step = 1; step <= 10; ++step) {
                mouse("mouseMove", [
                    from[0] + (to[0] - from[0]) * step / 10,
                    from[1] + (to[1] - from[1]) * step / 10,
                ], ["leftButtonDown"]);
                await wait(20);
            }
            mouse("mouseUp", to);
            await wait(200);
        },
        /// Click with `button` (`left`, by default) at `point`, `[x, y]` in the page.
        click: async ([x, y], button = "left") => {
            for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
                contents.sendInputEvent(
                    { type, x: Math.round(x), y: Math.round(y), button, clickCount: 1 });
            }
            await wait(200);
        },
        /// The centres of the vertices, in the order they were created.
        vertices: () => js(`[...document.querySelectorAll(".vertex")].map((vertex) => {
            const rect = vertex.getBoundingClientRect();
            return [rect.x + rect.width / 2, rect.y + rect.height / 2];
        })`),
        /// How many vertices, edges, and selected cells there are. Every drawn edge is an
        /// `.arrow.cell`; the canvas also keeps one bare `.arrow` for previews.
        counts: () => js(`({
            vertices: document.querySelectorAll(".vertex").length,
            edges: document.querySelectorAll(".arrow.cell").length,
            selected: document.querySelectorAll(".cell.selected").length,
        })`),
        /// The mode line's text.
        mode_line: () => js(`document.querySelector(".mode-line").textContent`),
        /// Run `text` through the command line: `:`, the text, then Return.
        command: async (text) => {
            await ctx.press(":");
            for (const character of text) {
                await ctx.press(character === " " ? "Space" : character);
            }
            await ctx.press("Enter");
        },
        /// Save with `C-s`, and wait for the title to show no unsaved changes.
        save: async () => {
            await ctx.press("s", ["control"]);
            for (let tries = 0; window.getTitle().includes(" + "); ++tries) {
                if (tries > 40) {
                    throw new Error("saving never finished");
                }
                await wait(50);
            }
        },
    };
    return scenarios[scenario](ctx);
}

app.on("browser-window-created", (_, window) => {
    // Headless windows start at 1x1, which puts every cell off-screen.
    window.setContentSize(1200, 800);
    window.webContents.on("console-message", (event) => {
        if (event.level === "error") {
            errors.push(`${event.message} (${path.basename(event.sourceId)}:${event.lineNumber})`);
        }
    });
    window.webContents.once("did-finish-load", async () => {
        let result = null;
        try {
            result = await run(window);
        } catch (error) {
            errors.push(`driver: ${error.stack}`);
        }
        console.log(`RESULT ${JSON.stringify({ result, errors })}`);
        app.exit(0);
    });
});

require(path.join(appdir, "electron", "main.js"));
