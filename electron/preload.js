/// The page's view of the desktop shell (`main.js`), as `window.host`. Calls that return a value are
/// asynchronous.

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (name) => (...parameters) => ipcRenderer.invoke(name, ...parameters);

contextBridge.exposeInMainWorld("host", {
    arguments: invoke("arguments"),
    version: invoke("version"),
    resolve: invoke("resolve"),
    read: invoke("read"),
    write: invoke("write"),
    config_dir: invoke("config_dir"),
    read_settings: invoke("read_settings"),
    read_keys: invoke("read_keys"),
    write_settings: invoke("write_settings"),
    open_settings: invoke("open_settings"),
    open_keys: invoke("open_keys"),
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
    // The desktop has no address bar to follow a link from.
    on_link: () => {},
    // What the help says of where the diagram goes, which only a browser, with a server behind
    // it, has reason to say (see `web/host.js`).
    private: null,
    // The path of a `File` from a drop, which the page cannot see itself.
    path_of: (file) => webUtils.getPathForFile(file),
    // How a message names the file at `path`: by its path, which the user can find.
    describe: (path) => path,
    // The diagram at `path` was opened or saved. A browser keeps it to reopen; the desktop has
    // the command line and its own recent files for that.
    opened: () => {},
});
