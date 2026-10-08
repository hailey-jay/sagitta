/// The search (`/`) and command line (`:`) prompts. These are submodes of `UIMode.Command`, sharing
/// the label input with the hint-code prompts (which keep their stock behaviour, see `Keys.enter`).
/// The command line completes and runs the named commands (see `Commands`).
class Prompt {
    constructor(ui) {
        this.ui = ui;

        // The list of completions displayed under the command line.
        this.completions = null;

        // Tab completion state: the command line before completing, the candidates, and the index
        // of the candidate last inserted. `null` when not completing.
        this.completing = null;
    }

    /// Add the list of completions beside the label input, once that exists.
    initialise() {
        this.completions = new DOM.Div({ class: "prompt-completions hidden" });
        this.ui.label_input.parent.add(this.completions);
    }

    open(mode) {
        const ui = this.ui;
        ui.keymap.unchoose();
        ui.cancel_creation();
        ui.focus_point.class_list.remove("focused", "smooth");
        ui.switch_mode(new UIMode.Command(ui, mode));
        if (mode === "Command") {
            this.list_completions();
        }
    }

    /// Whether the current `UIMode.Command` is one of the prompts handled here.
    owns() {
        return this.ui.in_mode(UIMode.Command) && ["Search", "Command"].includes(this.ui.mode.mode);
    }

    intercept(event) {
        if (!this.owns()) {
            return false;
        }
        switch (event.key) {
            case "Enter":
                if (this.ui.mode.mode === "Search") {
                    this.submit_search();
                } else {
                    this.submit_command();
                }
                return true;
            case "Tab":
                if (this.ui.mode.mode === "Command") {
                    this.complete(event.shiftKey ? -1 : 1);
                }
                return true;
        }
        return false;
    }

    /// Called on each edit of the prompt.
    input() {
        this.completing = null;
        if (this.ui.mode.mode === "Search") {
            this.highlight(this.search_matches());
        } else {
            this.list_completions();
        }
    }

    /// Called when the prompt closes.
    release() {
        this.completing = null;
        this.completions.class_list.add("hidden");
        this.highlight([]);
    }

    /// The prompt's text.
    query() {
        return this.ui.label_input.element.value;
    }

    /// Flash the prompt to signal that it was not accepted.
    reject() {
        Keymap.flash(this.ui.label_input);
    }

    highlight(cells) {
        const ui = this.ui;
        for (const element of ui.element.query_selector_all(".cell.search-match")) {
            element.class_list.remove("search-match");
        }
        for (const cell of cells) {
            cell.element.class_list.add("search-match");
        }
    }

    /// The cells matching the search query: those whose label is the query (ignoring whitespace);
    /// failing that, those whose label contains it; failing that, those whose hint codes were
    /// typed (so that `/` subsumes the stock `;` jump).
    search_matches() {
        const ui = this.ui;
        const normalise = (text) => text.replace(/\s+/g, "");
        const query = normalise(this.query());
        if (query === "") {
            return [];
        }
        const cells = ui.quiver.all_cells();
        const exact = cells.filter((cell) => normalise(cell.label) === query);
        if (exact.length > 0) {
            return exact;
        }
        const partial = cells.filter((cell) => normalise(cell.label).includes(query));
        if (partial.length > 0) {
            return partial;
        }
        const coded = [];
        for (const code of this.query().toUpperCase().split(/\s+/).filter((code) => code !== "")) {
            const cell = ui.codes.get(code);
            if (cell === undefined || !ui.quiver.contains_cell(cell)) {
                return [];
            }
            coded.push(cell);
        }
        return coded;
    }

    submit_search() {
        const ui = this.ui;
        const matches = this.search_matches();
        if (matches.length === 0) {
            this.reject();
            return;
        }
        ui.switch_mode(UIMode.default);
        ui.deselect();
        ui.select(...matches);
        const vertex = matches.find((cell) => cell.is_vertex());
        if (vertex !== undefined) {
            ui.reposition_focus_point(vertex.position);
        }
        ui.hide_if_unselected();
    }

    submit_command() {
        const line = this.query().trim();
        this.ui.switch_mode(UIMode.default);
        if (line !== "" && !this.ui.commands.run(line)) {
            // Reopen the prompt with the offending line, so it can be corrected.
            this.open("Command");
            this.ui.label_input.element.value = line;
        }
    }

    /// The completions of the last word of the command line: `{ base, candidates }`, where
    /// `base` is the line without that word.
    candidates() {
        const line = this.query();
        const words = line.slice(line.lastIndexOf(";") + 1).trimStart().split(/\s+/);
        const prefix = words[words.length - 1].toLowerCase();
        let candidates;
        if (words.length === 1) {
            candidates = Object.keys(Commands.TABLE).sort();
        } else {
            const command = Commands.TABLE[Commands.canonical(words[0])];
            candidates = command === undefined ? [] : typeof command.completions === "function"
                ? command.completions(this.ui.commands) : (command.completions || []);
        }
        return {
            base: line.slice(0, line.length - prefix.length),
            candidates: candidates.filter((candidate) => candidate.startsWith(prefix)),
        };
    }

    /// List the completions above the command line, highlighting the one at `current` (if any).
    /// Clicking a completion inserts it, and runs it if it is a complete command.
    list_completions(candidates = this.candidates().candidates, current = null) {
        this.completions.clear().class_list.toggle("hidden", candidates.length === 0);
        for (const [i, candidate] of candidates.entries()) {
            const command = Commands.TABLE[candidate];
            const entry = new DOM.Element("span", { class: i === current ? "current" : "" })
                .add(candidate)
                .listen("pointerdown", (event) => {
                    // Keep the prompt focused.
                    event.preventDefault();
                    const { base } = this.candidates();
                    this.ui.label_input.element.value = `${base}${candidate} `;
                    if (command !== undefined && !command.arguments) {
                        this.submit_command();
                    } else {
                        this.input();
                    }
                })
                .add_to(this.completions);
            const keys = command !== undefined ? this.ui.keymap.describe_name(candidate) : "";
            if (keys !== "") {
                entry.add(new DOM.Element("kbd").add(keys));
            }
        }
    }

    /// Cycle through the completions of the last word of the command line.
    complete(direction) {
        const input = this.ui.label_input.element;
        if (this.completing === null) {
            const { base, candidates } = this.candidates();
            if (candidates.length === 0) {
                this.reject();
                return;
            }
            this.completing = { base, candidates, index: direction > 0 ? -1 : 0 };
        }
        const { base, candidates } = this.completing;
        const count = candidates.length;
        this.completing.index = ((this.completing.index + direction) % count + count) % count;
        input.value = base + candidates[this.completing.index] + (count === 1 ? " " : "");
        input.setSelectionRange(input.value.length, input.value.length);
        if (count === 1) {
            this.completing = null;
            this.list_completions();
            return;
        }
        this.list_completions(candidates, this.completing.index);
    }
}
