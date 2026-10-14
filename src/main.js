/// The entry point: builds the `UI` once the page has loaded, and opens the diagram.

// We wait until the (minimal) DOM content has loaded, so we have access to `document.body`.
document.addEventListener("DOMContentLoaded", async () => {
    // The global UI, which `--devtools` and the test driver reach by this name.
    const body = new DOM.Element(document.body);
    const ui = new UI(body);
    window.ui = ui;
    // The settings decide how the UI is first laid out, and the keys file what the keys and their
    // hints say, so they have to be in before it is built.
    await Promise.all([ui.settings.load(), ui.keymap.load()]);
    ui.initialise();

    // Open the diagram and macros named on the command line (see `DiagramFile`).
    // The test drivers wait on this.
    ui.started = ui.file.initialise();

    // Load the style sheet needed for KaTeX.
    document.head.appendChild(new DOM.Element("link", {
        rel: "stylesheet",
        href: "katex.css",
    }).element);
});
