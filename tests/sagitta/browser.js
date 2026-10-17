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

const { app, BrowserWindow, Menu, nativeTheme } = require("electron");

const [url, script] = process.argv.slice(-2);

app.setName("sagitta-browser-test");

app.whenReady().then(async () => {
    // Headless, Electron's default menu takes the process down.
    Menu.setApplicationMenu(null);
    // Dark mode follows the system's colour scheme, so this fixes it, as `driver.js` does.
    nativeTheme.themeSource = "light";
    const window = new BrowserWindow({ width: 1200, height: 800 });
    const errors = [];
    window.webContents.on("console-message", (event) => {
        if (event.level === "error") {
            errors.push(event.message);
        }
    });
    await window.loadURL(url);
    // Wait for the page to finish starting, which includes opening a link or the last diagram.
    await window.webContents.executeJavaScript(`new Promise((resolve) => {
        const check = () => window.ui?.started !== undefined
            ? window.ui.started.then(resolve) : setTimeout(check, 50);
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
