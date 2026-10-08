/// The entry point: builds the `UI` once the page has loaded, and opens the diagram.

// We wait until the (minimal) DOM content has loaded, so we have access to `document.body`.
document.addEventListener("DOMContentLoaded", async () => {
    // The global UI.
    const body = new DOM.Element(document.body);
    const ui = new UI(body);
    // The settings decide how the UI is first laid out, and the keys file what the keys and their
    // hints say, so they have to be in before it is built.
    await Promise.all([ui.settings.load(), ui.keymap.load()]);
    ui.initialise();

    // Open the diagram and macros named on the command line (see `DiagramFile`).
    ui.file.initialise();

    // Load the style sheet needed for KaTeX.
    document.head.appendChild(new DOM.Element("link", {
        rel: "stylesheet",
        href: "katex.css",
    }).element);
});
