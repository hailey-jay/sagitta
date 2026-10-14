/// Loads Sagitta as a web page, as a browser would, and evaluates a script in it, for
/// `tests/test_sagitta.py`:
///
///     electron --ozone-platform=headless browser.js URL SCRIPT
///
/// The window has no preload, so the page gets `window.host` from `web/host.js` rather than from
/// the desktop shell. `SCRIPT` is evaluated once the page has started, and may return a promise.
/// A dialog open by then, as the notice for a device with no mouse that headless Chromium can seem
/// to be, is closed first, and its text returned as `notice`. The last line printed is
/// `RESULT <json>`, holding that, what the script returned, and every console error the page
/// logged.

const { app, BrowserWindow, Menu } = require("electron");

const [url, script] = process.argv.slice(-2);

app.setName("sagitta-browser-test");

app.whenReady().then(async () => {
    // Headless, Electron's default menu takes the process down.
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({ width: 1200, height: 800 });
    const errors = [];
    window.webContents.on("console-message", (event) => {
        if (event.level === "error") {
            errors.push(event.message);
        }
    });
    await window.loadURL(url);
    // `main.js` builds the UI once the DOM has loaded, then waits on the settings.
    await window.webContents.executeJavaScript(`new Promise((resolve) => {
        const check = () => window.ui?.file !== undefined && document.title !== ""
            ? resolve() : setTimeout(check, 50);
        check();
    })`);
    const notice = await window.webContents.executeJavaScript(`(() => {
        const dialog = document.querySelector("dialog.web-dialog[open]");
        dialog?.close();
        return dialog?.textContent ?? null;
    })()`);
    let result = null;
    try {
        result = await window.webContents.executeJavaScript(script);
    } catch (error) {
        errors.push(String(error));
    }
    process.stdout.write(`RESULT ${JSON.stringify({ notice, result, errors })}\n`);
    app.exit(0);
});
