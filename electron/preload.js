/// The page's view of the desktop shell (`main.js`), as `window.host`. Calls that return a value are
/// asynchronous.

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (name) => (...parameters) => ipcRenderer.invoke(name, ...parameters);

contextBridge.exposeInMainWorld("host", {
    arguments: invoke("arguments"),
    resolve: invoke("resolve"),
    read: invoke("read"),
    write: invoke("write"),
    read_settings: invoke("read_settings"),
    read_keys: invoke("read_keys"),
    write_settings: invoke("write_settings"),
    open_settings: invoke("open_settings"),
    find_up: invoke("find_up"),
    open_dialog: invoke("open_dialog"),
    save_dialog: invoke("save_dialog"),
    confirm: invoke("confirm"),
    watch: invoke("watch"),
    unwatch: invoke("unwatch"),
    read_clipboard: invoke("read_clipboard"),
    write_clipboard: invoke("write_clipboard"),
    set_dirty: (dirty) => ipcRenderer.send("set-dirty", dirty),
    close: () => ipcRenderer.send("close"),
    on_changed: (callback) => ipcRenderer.on("changed", (_, file) => callback(file)),
    on_save_and_close: (callback) => ipcRenderer.on("save-and-close", () => callback()),
    // The path of a `File` from a drop, which the page cannot see itself.
    path_of: (file) => webUtils.getPathForFile(file),
});
