"""Sagitta, run headless on Electron and driven like a user would.

Each test starts Electron with `--ozone-platform=headless` on `tests/sagitta/driver.js`, which loads
Sagitta's own `electron/main.js`, opens a diagram under `tmp_path`, runs one scenario from
`tests/sagitta/scenarios.js` with trusted key and mouse events, and prints the result as JSON.
Every run also fails on any console error the page logged.

The promise most worth keeping is the `.tikzcd` round trip: a paper `\\input`s these files, so
opening and saving must not change them, and hand edits must win over the encoded first line.

HOME and XDG_CONFIG_HOME point into `tmp_path` for every run, so Sagitta's settings and its
`macros.tex` search never see the real home directory. The headless clipboard is Chromium's
own, not the desktop's, so the clipboard scenarios leave the real one alone.

The browser tests serve the repository over HTTP instead, and load it in a window with no preload
(`tests/sagitta/browser.js`), so that the page runs on `web/host.js`, as it would in a browser.
"""

import functools
import http.server
import json
import os
import shutil
import stat
import subprocess
import threading

import pytest

_APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DRIVER = os.path.join(_APP, "tests", "sagitta", "driver.js")
_BROWSER = os.path.join(_APP, "tests", "sagitta", "browser.js")


def _electron():
    """The Electron the launcher would pick: `$SAGITTA_ELECTRON`, else `electron43` or `electron`
    on PATH, else the one `npm install` puts in `node_modules`."""
    local = os.path.join(_APP, "node_modules", ".bin", "electron")
    for candidate in (os.environ.get("SAGITTA_ELECTRON"), "electron43", "electron", local):
        if candidate and shutil.which(candidate):
            return shutil.which(candidate)
    return None


electron = _electron()
node = shutil.which("node")

pytestmark = pytest.mark.skipif(not electron, reason="Electron not installed")

SQUARE = """\
\\begin{tikzcd}
\tA \\arrow[r, "f"] \\arrow[d, "g"'] & B \\arrow[d, "h"] \\\\
\tC \\arrow[r, "\\alpha"'] & D
\\end{tikzcd}
"""

TRIANGLE = """\
\\begin{tikzcd}
\tX \\arrow[r] & Y \\arrow[d] \\\\
\t& Z
\\end{tikzcd}
"""


LOOP = """\
\\begin{tikzcd}
\tA \\arrow["f", loop, in=60, out=120, distance=5mm]
\\end{tikzcd}
"""

LOOP_AND_ARROW = LOOP.replace("distance=5mm]", "distance=5mm] \\arrow[r, \"g\"] & B")


@pytest.fixture
def home(tmp_path):
    path = tmp_path / "home"
    path.mkdir()
    return path


@pytest.fixture
def sagitta(home):
    """Run a scenario on a diagram, returning its result. Fails on any page error, except one
    the test asked for: a refused command reports itself with `UI.display_error`, which logs to the
    console, so `expected_error` names the substring such a run is allowed to log."""

    def run(scenario, diagram, argument=None, expected_error=None):
        env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"))
        command = [electron, "--ozone-platform=headless", _DRIVER, _APP, scenario, str(diagram)]
        # CI runners (Ubuntu's AppArmor) refuse the user namespaces Chromium's sandbox needs.
        # The sandbox guards against hostile web content, which these runs never load.
        if os.environ.get("CI"):
            command.insert(1, "--no-sandbox")
        if argument is not None:
            command.append(argument)
        completed = subprocess.run(
            command, env=env, capture_output=True, text=True, timeout=60, check=False)
        lines = [line for line in completed.stdout.splitlines() if line.startswith("RESULT ")]
        assert lines, f"no result from {scenario}:\n{completed.stdout}\n{completed.stderr}"
        output = json.loads(lines[-1][len("RESULT "):])
        errors = output["errors"]
        if expected_error is not None:
            assert [error for error in errors if expected_error in error], \
                f"{scenario} never reported {expected_error!r}: {errors}"
            errors = [error for error in errors if expected_error not in error]
        assert errors == []
        return output["result"]

    return run


def _diagram(directory, text=SQUARE, name="square.tikzcd"):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(text)
    return path


# ── The arrow options, driven from the command line ───────────────────────────
#
# Each runs a command line (`Commands.run`) and is checked against the tikz-cd it writes.


@pytest.mark.parametrize("commands,expected", [
    (["tail hook", "body dashed", "head none"], '\\arrow["f", dashed, hook, no head, from=1-1'),
    (["curve 3"], '\\arrow["f", curve={height=18pt}, from=1-1'),
    (["level 2"], '\\arrow["f", Rightarrow, from=1-1'),
    (["offset 2"], '\\arrow["f", shift right=2, from=1-1'),
    (["position 30"], '\\arrow["f"{pos=0.3}, from=1-1'),
    (["length 20 80"], '\\arrow["f", between={0.2}{0.8}, from=1-1'),
    (["adjunction"], '"\\dashv"{anchor=center}, draw=none, from=1-1'),
    (["corner"], '"\\lrcorner"{anchor=center, pos=0.125, rotate=45}, draw=none'),
    (["corner", "corner-var"], '"\\ulcorner"{anchor=center, pos=0.125, rotate=45}, draw=none'),
    (["equals"], '\\arrow["f", equals, from=1-1'),
    (["mono"], '\\arrow["f", tail, from=1-1'),
    (["squiggly"], '\\arrow["f", squiggly, from=1-1'),
    (["align right"], '\\arrow["f"\', from=1-1'),
    (["align center"], '\\arrow["f"{description}, from=1-1'),
    (["crossing-over"], '\\arrow["f", crossing over, from=1-1'),
    (["crossing-over off", "cross on"], '\\arrow["f", crossing over, from=1-1'),
])
def test_commands_change_the_arrows(sagitta, home, commands, expected):
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(commands))
    assert expected in diagram.read_text()


@pytest.mark.parametrize("commands", [
    ["crossing-over", "crossing-over"],
    ["crossing-over", "undo"],
    ["crossing-over on", "crossing-over off"],
])
def test_crossing_over_turns_off_again(sagitta, home, commands):
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(commands))
    assert "crossing over" not in diagram.read_text()


def test_crossing_over_draws_the_gap(sagitta, home):
    diagram = _diagram(home / "paper")
    before = sagitta("drawn", diagram, json.dumps([]))
    after = sagitta("drawn", diagram, json.dumps(["crossing-over"]))
    assert [b["crossing"] for b in before] == [False] * 4
    assert [a["crossing"] for a in after] == [True] * 4


CROSSED = """\
\\begin{tikzcd}
\tA \\arrow[ddrr, "f", crossing over] & B \\arrow[dd, "g"] & C \\arrow[ddll, "h", crossing over] \\\\
\t&& \\\\
\tD & E & F
\\end{tikzcd}
"""


def test_the_canvas_stacks_crossing_arrows_as_the_export_does(sagitta, home):
    diagram = _diagram(home / "paper", CROSSED, "crossed.tikzcd")
    opened = sagitta("stacking", diagram, json.dumps({}))
    assert opened["stacked"] == opened["written"] == ["f", "h"]
    # Bringing `f` to the front puts it above `h`, and so does turning `g` on, above both.
    raised = sagitta("stacking", diagram, json.dumps(
        {"select": ["f"], "commands": ["crossing-over on"]}))
    assert raised["stacked"] == raised["written"] == ["h", "f"]
    toggled = sagitta("stacking", diagram, json.dumps({"select": ["g"], "commands": ["cross"]}))
    assert toggled["stacked"] == toggled["written"] == ["f", "h", "g"]
    # Undoing it lowers `g` again.
    undone = sagitta("stacking", diagram, json.dumps(
        {"select": ["g"], "commands": ["cross", "undo"]}))
    assert undone["stacked"] == undone["written"] == ["f", "h"]


def test_styling_the_arrows_redraws_them(sagitta, home):
    diagram = _diagram(home / "paper")
    before = sagitta("drawn", diagram, json.dumps([]))
    after = sagitta("drawn", diagram, json.dumps(["body dashed", "tail mono"]))
    assert len(before) == len(after) == 4
    assert all(a["dashes"] != b["dashes"] for a, b in zip(after, before))
    assert all(a["heads"] > b["heads"] for a, b in zip(after, before))


@pytest.mark.parametrize("alignment", ["right", "centre", "over"])
def test_aligning_the_labels_redraws_them(sagitta, home, alignment):
    diagram = _diagram(home / "paper")
    before = sagitta("drawn", diagram, json.dumps([]))
    after = sagitta("drawn", diagram, json.dumps(["align left", f"align {alignment}"]))
    assert len(before) == len(after) == 4
    assert all(b["label"] is not None for b in before)
    # `f` and `h` start on the left, and `g` and `\alpha` on the right.
    moved = [a["label"] != b["label"] for a, b in zip(after, before)]
    assert sum(moved) >= 2, (before, after)


@pytest.mark.parametrize("keys,expected", [
    (["b", "3", "Enter"], '\\arrow["f", curve={height=18pt}, from=1-1'),
    (["b", "Right"], '\\arrow["f", curve={height=6pt}, from=1-1'),
    (["o", "Left"], '\\arrow["f", shift left, from=1-1'),
    (["n", "2", "Enter"], '\\arrow["f", Rightarrow, from=1-1'),
    (["l", "l", "Left"], '\\arrow["f", between={0}{0.9}, from=1-1'),
    (["t", "h"], '\\arrow["f", hook, from=1-1'),
    (["d", "-"], '\\arrow["f", dashed, from=1-1'),
    ([["a", ["shift"]], "o"], '\\arrow["f"{marking, allow upside down}, from=1-1'),
    ([["a", ["shift"]], "c"], '\\arrow["f"{description}, from=1-1'),
    # The arrows disagree, so the first step goes to left, then right, then centre.
    ([["a", ["shift"]], "Right", "Right", "Right"], '\\arrow["f"{description}, from=1-1'),
    ([["a", ["shift"]], "r"], '\\arrow["f"\', from=1-1'),
    (["p"], '"\\lrcorner"{anchor=center, pos=0.125, rotate=45}, draw=none'),
    (["x"], '\\arrow["f", crossing over, from=1-1'),
    # Pressing a component's key again lets go of it, so `n` chooses the level, not no tail.
    (["t", "t", "n", "2", "Enter"], '\\arrow["f", Rightarrow, from=1-1'),
])
def test_the_command_layer_changes_the_arrows(sagitta, home, keys, expected):
    diagram = _diagram(home / "paper")
    sagitta("layer", diagram, json.dumps(keys))
    assert expected in diagram.read_text()


@pytest.mark.parametrize("keys,command", [
    (["t", ["h", ["shift"]]], "tail bottom-hook"),
    (["t", "|"], "tail maps-to"),
    (["d", "*"], "body bullet-solid"),
    (["d", ["b", ["shift"]]], "body double-barred"),
    (["h", "e"], "head epi"),
    (["h", ["p", ["shift"]]], "head bottom-harpoon"),
])
def test_the_style_lists_choose_by_their_own_keys(sagitta, home, keys, command):
    by_key, by_command = _diagram(home / "key"), _diagram(home / "command")
    sagitta("layer", by_key, json.dumps(keys))
    sagitta("commands", by_command, json.dumps([command]))
    assert by_key.read_text() == by_command.read_text()


def test_the_command_layer_opens_the_colour_layer(sagitta, home):
    result = sagitta("layer", _diagram(home / "paper"), json.dumps(["c"]))
    assert "COLOUR" in result["mode_line"]


def test_the_mode_line_names_the_value_being_typed(sagitta, home):
    result = sagitta("layer", _diagram(home / "paper"), json.dumps(["l", "l", "4"]))
    assert result["mode_line"].startswith("; LENGTH(end) 4_")


@pytest.mark.parametrize("keys,mode", [
    ([["A", ["shift"]]], "; ALIGN"),
    (["t"], "; TAIL"),
    (["b"], "; CURVE_"),
    ([["P", ["shift"]]], "; POSITION_"),
    # Closing the list returns to the layer's own name.
    (["t", "t"], ";"),
])
def test_the_mode_line_names_the_list_or_slider_open(sagitta, home, keys, mode):
    """The badge, then the file's name."""
    result = sagitta("layer", _diagram(home / "paper"), json.dumps(keys))
    assert result["mode_line"].startswith(f"{mode}square.tikzcd")


@pytest.mark.parametrize("commands,expected", [
    (["curve 3", "corner", "arrow"], '\\arrow["f", curve={height=18pt}, from=1-1'),
    (["level 3", "tail hook", "adjunction", "arrow"],
     '\\arrow["f", Rightarrow, scaling nfold=3, hook, from=1-1'),
])
def test_an_arrow_comes_back_as_it_was(sagitta, home, commands, expected):
    """A corner or an adjunction has no curve or level; going back restores what the arrow had."""
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(commands))
    assert expected in diagram.read_text()


def test_the_mode_line_reports_the_arrow_it_changed(sagitta, home):
    result = sagitta("commands", _diagram(home / "paper"), json.dumps(["tail hook", "body dashed"]))
    assert "tail top hook" in result["mode_line"]
    assert "body dashed" in result["mode_line"]


def test_the_var_corner_can_be_chosen_on_its_own(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(["corner-var"]))
    assert "\\ulcorner" in diagram.read_text()


def _quiver_mode(home):
    settings = home / ".config" / "sagitta"
    settings.mkdir(parents=True, exist_ok=True)
    (settings / "settings.json").write_text('{"ui.quiver_mode": true}\n')


def test_spreadsheet_mode_types_straight_into_the_label(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("typing", diagram, json.dumps(["x", "Enter"]))
    assert "\tx & B" in diagram.read_text()


def test_quiver_mode_types_only_after_return(sagitta, home):
    _quiver_mode(home)
    diagram = _diagram(home / "paper")
    # `x` is the layer's crossing over, which wants an arrow, rather than a label.
    result = sagitta("typing", diagram, json.dumps(["x"]), expected_error="Select an arrow first")
    assert result["mode_line"].startswith(";")
    assert not result["editing"]
    assert "\tA & B" in diagram.read_text()
    result = sagitta("typing", diagram, json.dumps(["Enter", "x", "Enter"]))
    assert result["mode_line"].startswith(";")
    assert "\tAx & B" in diagram.read_text()


def test_quiver_mode_keeps_the_command_layer_open(sagitta, home):
    """The layer's keys work without `;`, and Escape still deselects."""
    _quiver_mode(home)
    diagram = _diagram(home / "paper")
    sagitta("keys", diagram, json.dumps([["x"]]))
    assert '\\arrow["f", crossing over, from=1-1' in diagram.read_text()
    result = sagitta("keys", diagram, json.dumps([["Escape"]]))
    assert result["counts"]["selected"] == 0
    assert result["mode_line"].startswith(";")


@pytest.mark.parametrize("quiver,keys,main,submenu", [
    # Spreadsheet mode lists the keys after a pause, as it always has.
    (False, [";"], True, False),
    (False, [";", "t"], False, True),
    # Quiver mode lists them only on `;`, though a component's choices show at once.
    (True, [], False, False),
    (True, ["b"], False, False),
    (True, ["t"], False, True),
    (True, [";"], True, False),
    (True, [";", ";"], False, False),
])
def test_the_command_list_shows(sagitta, home, quiver, keys, main, submenu):
    if quiver:
        _quiver_mode(home)
    result = sagitta("lists", _diagram(home / "paper"), json.dumps(keys))
    assert result == {"main": main, "submenu": submenu}


@pytest.mark.parametrize("quiver", [False, True])
def test_a_key_the_command_layer_does_not_use_is_kept_from_the_browser(sagitta, home, quiver):
    """Firefox's quick find takes `'` otherwise."""
    if quiver:
        _quiver_mode(home)
    script = """(() => {
        if (!ui.keymap.active) {
            ui.keymap.enter();
        }
        const event = new KeyboardEvent("keydown", { key: "'", cancelable: true });
        document.dispatchEvent(event);
        return event.defaultPrevented;
    })()"""
    assert sagitta("evaluate", _diagram(home / "paper"), script)


@pytest.mark.parametrize("quiver", [False, True])
def test_return_on_an_empty_cell_makes_one_to_label(sagitta, home, quiver):
    if quiver:
        _quiver_mode(home)
    diagram = _diagram(home / "paper")
    result = sagitta("typing", diagram, json.dumps(["Right", "Right", "Enter", "E", "Enter"]))
    assert result["counts"]["vertices"] == 5
    assert "& B & E" in diagram.read_text()


def test_return_with_a_selection_still_edits_it(sagitta, home):
    """The focus point on an empty cell leaves a selection's label to RET, as it always has."""
    diagram = _diagram(home / "paper")
    result = sagitta("typing", diagram, json.dumps(
        [["Space", ["shift"]], "Right", "Right", "Enter", "x", "Enter"]))
    assert result["counts"]["vertices"] == 4
    assert "\tAx & B" in diagram.read_text()


def test_quiver_mode_command_switches_it(sagitta, home):
    sagitta("commands", _diagram(home / "paper"), json.dumps(["quiver-mode"]))
    settings = json.loads((home / ".config" / "sagitta" / "settings.json").read_text())
    assert settings["ui.quiver_mode"] is True


def test_the_corner_takes_the_kind_last_used(sagitta, home):
    settings = home / ".config" / "sagitta"
    settings.mkdir(parents=True)
    (settings / "settings.json").write_text('{"diagram.var_corner": true}\n')
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(["corner"]))
    assert "\\ulcorner" in diagram.read_text()


def test_the_corner_alternates_between_its_two_kinds(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(["corner", "corner"]))
    assert "\\ulcorner" in diagram.read_text()
    sagitta("commands", diagram, json.dumps(["corner"]))
    assert "\\lrcorner" in diagram.read_text()


# ── Loops ─────────────────────────────────────────────────────────────────────
#
# A loop takes `radius` and `angle` where an arrow takes `curve` and `offset`, and `ArrowOptions`
# picks between them itself. Only the loop's `in`, `out`, and `distance` show which it picked.


@pytest.mark.parametrize("scenario,argument,expected", [
    # With only loops selected, `b` (curve) sets the radius.
    ("layer", ["b", "3", "Enter"], "loop, in=55, out=125, distance=10mm]"),
    ("commands", ["angle 90"], "loop, in=330, out=30, distance=5mm]"),
    # With the vertex let go of, the arrow keys, panning, grow the loop and turn it.
    ("keys", [["Space", ["shift"]], ["Up", ["control"]]], "loop, in=55, out=125, distance=10mm]"),
    ("keys", [["Space", ["shift"]], ["Right", ["control"]]], "loop, in=15, out=75, distance=5mm]"),
])
def test_loops_take_radius_and_angle(sagitta, home, scenario, argument, expected):
    diagram = _diagram(home / "paper", LOOP, "loop.tikzcd")
    sagitta(scenario, diagram, json.dumps(argument))
    assert expected in diagram.read_text()


def test_a_nudge_bends_the_arrow_beside_a_loop(sagitta, home):
    """With a plain arrow selected too, the arrow keys mean curve, which a loop does not take."""
    diagram = _diagram(home / "paper", LOOP_AND_ARROW, "loop.tikzcd")
    sagitta("keys", diagram, json.dumps(
        [["Space", ["shift"]], ["Right"], ["Space", ["shift"]], ["Up", ["control"]]]))
    text = diagram.read_text()
    assert "loop, in=60, out=120, distance=5mm]" in text
    assert '\\arrow["g", curve={height=-6pt}, from=1-1, to=1-2]' in text


# ── Key bindings ──────────────────────────────────────────────────────────────
#
# Every binding goes through `Keymap.dispatch`. A binding marked `layer` runs only in the command
# layer; outside it, the same key types a label.


@pytest.mark.parametrize("keys,expected", [
    ([[";"], ["r"], ["Escape"]], '\\arrow["f"\', from=1-2, to=1-1]'),
    ([["r", ["control"]]], '\\arrow["f"\', from=1-2, to=1-1]'),
    ([["r"], ["Enter"]], '\\arrow["r", from=1-1, to=1-2]'),
    # An opening delimiter wraps the label it would replace, or the selected part of one, and
    # otherwise brings its closing one, which typing steps over.
    ([["Escape"], ["("], ["Enter"]], "\t{(A)} & B"),
    ([["Escape"], ["Enter"], ["Left", ["shift"]], ["["], ["{"], ["Enter"]], "\t{[{A}]} & B"),
    ([["Escape"], ["Backspace"], ["Escape"], ["("], ["x"], ["Enter"]], "\t{(x)} & B"),
    ([["Escape"], ["Enter"], ["("], ["x"], [")"], ["Enter"]], "\t{A(x)} & B"),
    # Not before its closing one; and deleting an empty pair deletes both.
    ([["Escape"], ["Enter"], ["("], ["("], ["Enter"]], "\t{A(()} & B"),
    ([["Escape"], ["Enter"], ["["], ["Backspace"], ["Enter"]], "\tA & B"),
])
def test_keys_change_the_diagram(sagitta, home, keys, expected):
    diagram = _diagram(home / "paper")
    sagitta("keys", diagram, json.dumps(keys))
    assert expected in diagram.read_text()


def _typed(*keys):
    """Edit `A` in place, type `keys`, and commit."""
    return [["Escape"], ["Enter"], *([key] for key in keys), ["Enter"]]


@pytest.mark.parametrize("keys,expected", [
    # Escaped delimiters pair with escaped ones, and typing the closing one steps over it.
    (_typed("\\", "{"), "\t{A\\{\\}} & B"),
    (_typed("\\", "{", "x", "\\", "}"), "\t{A\\{x\\}} & B"),
    (_typed("\\", "{", "Backspace"), "\tA & B"),
    # Commands pair once they are complete.
    (_typed("\\", *"langle", "Space", "x"), "\t{A\\langle x\\rangle} & B"),
    (_typed("\\", *"langle", "\\", *"alpha"), "\t{A\\langle\\alpha\\rangle} & B"),
    (_typed("\\", *"langlex"), "\t{A\\langlex} & B"),
    # After `\left`, the closing one comes with `\right`, which typing the delimiter steps over.
    (_typed("\\", *"left(x"), "\t{A\\left(x\\right)} & B"),
    (_typed("\\", *"left(x)y"), "\t{A\\left(x\\right)y} & B"),
    (_typed("\\", *"left.x"), "\t{A\\left.x\\right.} & B"),
    (_typed("\\", *"left(", "Backspace"), "\t{A\\left} & B"),
    (_typed("\\", *"left|x|"), "\t{A\\left|x\\right|} & B"),
    (_typed("\\", "|", "x"), "\t{A\\|x\\|} & B"),
    # `|` alone is as often a restriction as a delimiter, so it neither wraps nor pairs.
    ([["Escape"], ["|"], ["Enter"]], "\t{|} & B"),
    (_typed("|", "U"), "\t{A|U} & B"),
    (_typed("|", "|", "Backspace"), "\t{A|} & B"),
    # `\(` and `\[` are left alone, as is a delimiter after a line break.
    (_typed("\\", "("), "\t{A\\(} & B"),
    (_typed("\\", "\\", "{"), "\\begin{array}{c} A\\\\{} \\end{array} & B"),
])
def test_latex_delimiters_pair(sagitta, home, keys, expected):
    diagram = _diagram(home / "paper")
    sagitta("keys", diagram, json.dumps(keys))
    assert expected in diagram.read_text()


@pytest.mark.parametrize("keys,counts", [
    ([["x", ["control"]]], {"vertices": 0, "edges": 0, "selected": 0}),
    ([["x", ["control"]], ["z", ["control"]]], {"vertices": 4, "edges": 4, "selected": 8}),
    # Copied, then pasted clear of the square.
    ([["c", ["control"]], ["Escape"], ["Right"], ["Right"], ["Right"], ["v", ["control"]]],
     {"vertices": 8, "edges": 8, "selected": 0}),
    ([["Escape"]], {"vertices": 4, "edges": 4, "selected": 0}),
    ([["Escape"], ["Space", ["shift"]]], {"vertices": 4, "edges": 4, "selected": 1}),
])
def test_keys_change_the_selection(sagitta, home, keys, counts):
    assert sagitta("keys", _diagram(home / "paper"), json.dumps(keys))["counts"] == counts


def test_the_help_layer_lists_every_binding(sagitta, home):
    """Its lines come from the bindings and actions themselves, and from `Keymap.HELP_ELSEWHERE`
    for the keys handled elsewhere."""
    help = dict(sagitta("help", _diagram(home / "paper")))
    assert list(help) == ["Typing", "Moving", "Mouse", "Layers", "Chords", "Help"]
    assert help["Typing"][0] == ["a \\ 2 …", "replace the label"]
    assert ["RET", "edit the label in place, or label a new cell"] in help["Typing"]
    assert ["<delete>", "delete"] in help["Typing"]
    assert help["Moving"][0] == ["arrows", "move the focus point"]
    assert help["Mouse"][0] == ["click", "select; again to edit the label"]
    assert help["Mouse"][-1] == ["S-scroll  C-scroll", "zoom"]
    assert ["C-drag  A-drag  middle-drag", "pan by dragging"] in help["Mouse"]
    assert ["C-e", "export tikz-cd"] in help["Layers"]
    assert ["C-m", "macros"] in help["Layers"]
    assert ["/  C-f", "search labels, or type cell codes"] in help["Layers"]
    assert ["C-r", "reverse"] in help["Chords"]
    assert ["C-x", "cut"] in help["Chords"]
    assert not any(keys.startswith(";") for keys, _ in help["Chords"])


def test_flip_is_on_f(sagitta, home):
    by_key, by_command = _diagram(home / "key"), _diagram(home / "command")
    sagitta("keys", by_key, json.dumps([[";"], ["f"], ["Escape"]]))
    sagitta("commands", by_command, json.dumps(["flip"]))
    assert by_key.read_text() == by_command.read_text()


def test_control_f_searches(sagitta, home):
    result = sagitta("keys", _diagram(home / "paper"), json.dumps([["f", ["control"]]]))
    assert result["mode_line"].startswith("/ SEARCH")


def test_the_command_layer_lists_shifted_letters_as_capitals(sagitta, home):
    listed = sagitta("which_key", _diagram(home / "paper"))
    assert ["A", "alignment", ""] in listed
    assert ["C", "colour", ""] in listed


# ── The pointer ───────────────────────────────────────────────────────────────
#
# The command layer's key list is the menu: clicking a line presses its key, and the sliders have
# buttons. Right-clicking opens it.


@pytest.mark.parametrize("steps,expected", [
    ([["entry", "dashed"]], '\\arrow["f", dashed, from=1-1'),
    ([["step", "curve (loops: radius, routes: rounding)", "+"]], '\\arrow["f", curve={height=6pt}, from=1-1'),
    ([["step", "curve (loops: radius, routes: rounding)", "+"], ["step", "curve (loops: radius, routes: rounding)", "+"]], '\\arrow["f", curve={height=12pt}, from=1-1'),
    ([["entry", "reverse"]], '\\arrow["f"\', from=1-2, to=1-1]'),
    ([["entry", "alignment"], ["entry", "over the arrow"]],
     '\\arrow["f"{marking, allow upside down}, from=1-1'),
    ([["step", "alignment", "+"]], '\\arrow["f"\', from=1-1'),
    # Stepping wraps around, from left back to over.
    ([["step", "alignment", "−"]], '\\arrow["f"{marking, allow upside down}, from=1-1'),
])
def test_clicking_the_key_list_presses_its_keys(sagitta, home, steps, expected):
    diagram = _diagram(home / "paper")
    # The arrow `f`, found by `/`.
    select = [["press", "/"], ["press", "f"], ["press", "Enter"], ["press", ";"]]
    result = sagitta("pointer", diagram, json.dumps([*select, *steps]))
    assert result["open"]
    assert expected in diagram.read_text()


def test_the_arrow_lines_are_listed_for_several_arrows(sagitta, home):
    """With everything selected, the arrow's lines are still there to click, and act on each."""
    diagram = _diagram(home / "paper")
    sagitta("pointer", diagram, json.dumps(
        [["press", "a", ["control"]], ["press", ";"], ["entry", "dashed"]]))
    assert diagram.read_text().count("dashed") == 4


def test_right_clicking_a_cell_selects_it_and_opens_the_command_layer(sagitta, home):
    opened = sagitta("pointer", _diagram(home / "open"), json.dumps([["right-click", 0]]))
    assert opened["open"] and opened["counts"]["selected"] == 1
    deleted = sagitta("pointer", _diagram(home / "delete"),
                      json.dumps([["right-click", 0], ["entry", "delete"]]))
    assert deleted["counts"]["vertices"] == 3


def test_the_tips_show_only_on_an_empty_diagram(sagitta, home):
    shown = '!document.querySelector(".tip").classList.contains("hidden")'
    assert sagitta("evaluate", home / "new.tikzcd", shown) is True
    assert sagitta("evaluate", _diagram(home / "paper"), shown) is False


def test_the_command_layer_opens_the_code_prompts(sagitta, home):
    result = sagitta("keys", _diagram(home / "paper"), json.dumps([[";"], ["s"]]))
    assert result["mode_line"].startswith("TOGGLE")


def test_slash_searches_in_the_command_layer_too(sagitta, home):
    result = sagitta("keys", _diagram(home / "paper"), json.dumps([[";"], ["/"]]))
    assert result["mode_line"].startswith("/ SEARCH")


def test_e_in_the_command_layer_draws_arrows_to_typed_codes(sagitta, home):
    """From `A` (found by `/`) to `D`, whose code is `F`."""
    keys = [["/"], ["A", ["shift"]], ["Enter"], [";"], ["e"], ["f"], ["Enter"]]
    result = sagitta("keys", _diagram(home / "paper"), json.dumps(keys))
    assert result["counts"]["edges"] == 5


PARALLEL = """\
\\begin{tikzcd}
\tX \\arrow[""{name=0, anchor=center, inner sep=0}, bend left, from=1-1, to=1-2]
\t\\arrow[""{name=1, anchor=center, inner sep=0}, bend right, from=1-1, to=1-2] & Y
\t\\arrow[Rightarrow, from=0, to=1]
\\end{tikzcd}
"""


def _codes(sagitta, diagram, keys=()):
    codes = sagitta("codes", diagram, json.dumps(list(keys)))
    return sorted(codes["vertices"]), sorted(codes["edges"])


def test_an_arrows_code_is_its_ends_codes(sagitta, home):
    """Vertices take the home row first. An arrow between arrows would have a long code, so it
    takes one of its own."""
    assert _codes(sagitta, _diagram(home / "paper")) == (
        ["A", "D", "F", "S"], ["AD", "AS", "DF", "SF"])
    assert _codes(sagitta, _diagram(home / "parallel", PARALLEL)) == (
        ["A", "S"], ["AS", "AS2", "D"])


def test_removing_a_cell_frees_its_code(sagitta, home):
    search_s = [["/"], ["s"], ["Enter"]]
    removed = _codes(sagitta, _diagram(home / "removed"), [*search_s, ["Delete"]])
    assert removed == (["A", "D", "F"], ["AD", "DF"])
    # Undoing the removal brings the codes back.
    restored = _codes(sagitta, _diagram(home / "restored"), [*search_s, ["Delete"], ["z", ["control"]]])
    assert restored == (["A", "D", "F", "S"], ["AD", "AS", "DF", "SF"])


def test_a_key_press_ends_a_pan_whose_key_was_released_unseen(sagitta, home):
    result = sagitta("stale_pan", _diagram(home / "paper"))
    assert result["stuck"] == "pan"
    assert result["after"] == "default"
    # `A`, `B`, and the arrow between them.
    assert result["counts"]["selected"] == 3, result


def test_only_the_cell_tab_goes_to_next_is_marked(sagitta, home):
    """Space from the selected `A` to an empty cell queues an arrow `AG` and a vertex `G`, with
    `G` selected; Tab then goes to the arrow, and back to the vertex."""
    create = [["Space", ["shift"]], ["Right"], ["Right"], ["Space"]]
    for name, keys, next in [("created", create, ["AG"]),
                             ("tab", [*create, ["Tab"]], ["G"]),
                             ("tab twice", [*create, ["Tab"], ["Tab"]], ["AG"])]:
        codes = sagitta("codes", _diagram(home / name), json.dumps(keys))
        assert sorted(codes["queued"]) == ["AG", "G"], name
        assert codes["next"] == next, name


def test_codes_grow_a_character_when_the_hint_characters_run_out(sagitta, home):
    directory = home / ".config" / "sagitta"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "settings.json").write_text(json.dumps({"ui.hint_characters": "XY"}))
    vertices, edges = _codes(sagitta, _diagram(home / "paper"))
    assert vertices == ["X", "XX", "XY", "Y"]
    assert len(set(edges)) == 4


# ── The keys file ─────────────────────────────────────────────────────────────


def _keys(home, text):
    directory = home / ".config" / "sagitta"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "keys").write_text(text)


def test_the_keys_file_rebinds_the_command_layer(sagitta, home):
    _keys(home, "# Reverse on w.\nreverse ; w\n")
    texts = {}
    for name, keys in [("none", []), ("r", ["r"]), ("w", ["w"])]:
        diagram = _diagram(home / name)
        sagitta("layer", diagram, json.dumps(keys))
        texts[name] = diagram.read_text()
    assert texts["r"] == texts["none"]
    assert texts["w"] != texts["none"]


def test_a_chord_in_the_keys_file_takes_the_key_from_its_default(sagitta, home):
    _keys(home, "dashed  C-r  # was reverse's\n")
    diagram = _diagram(home / "paper")
    sagitta("keys", diagram, json.dumps([["r", ["control"]]]))
    assert "dashed" in diagram.read_text()
    help = dict(sagitta("help", _diagram(home / "other")))
    assert ["C-r", "reverse"] not in help["Chords"]


def test_the_keys_file_rebinds_the_mark(sagitta, home):
    _keys(home, "mark C-q\nmark-add C-j\n")
    # The top row with the new key, then the bottom row added with the other.
    rebound = sagitta("pressed", _diagram(home / "rebound"), json.dumps([
        ["q", ["control"]], ["Right"], ["q", ["control"]],
        ["Down"], ["j", ["control"]], ["Left"], ["j", ["control"]],
    ]))
    # Each row's two vertices and its arrow; the arrows down the sides have their ends in
    # different rectangles, so neither takes them.
    assert rebound["counts"]["selected"] == 6, rebound
    # `C-SPC` is free now, and does nothing: no mark, and no vertex made by the Space in it.
    freed = sagitta("pressed", _diagram(home / "freed"), json.dumps([["Space", ["control"]]]))
    assert "MARK" not in freed["mode_line"]
    assert freed["counts"] == {"vertices": 4, "edges": 4, "selected": 0}


def test_a_chord_choosing_a_slider_enters_the_command_layer(sagitta, home):
    _keys(home, "curve ; k C-k\n")
    diagram = _diagram(home / "paper")
    sagitta("keys", diagram, json.dumps([["k", ["control"]], ["3"], ["Enter"]]))
    assert '\\arrow["f", curve={height=18pt}, from=1-1' in diagram.read_text()


def test_the_command_layer_lists_its_rebound_keys(sagitta, home):
    default = sagitta("which_key", _diagram(home / "default"))
    assert ["r", "reverse", "C-r"] in default
    assert ["z", "centre", ""] in default
    _keys(home, "reverse ; w C-S-e\ncentre-view\ndotted ; `\n")
    rebound = sagitta("which_key", _diagram(home / "paper"))
    assert ["w", "reverse", "C-S-e"] in rebound
    assert ["`", "dotted", ""] in rebound
    assert not any(description == "centre" for _, description, _ in rebound)


def test_the_help_layer_shows_rebound_chords(sagitta, home):
    _keys(home, "copy C-S-y\nshortcuts C-/ <f1>\n")
    help = dict(sagitta("help", _diagram(home / "paper")))
    assert ["C-S-y", "copy"] in help["Chords"]
    assert help["Help"] == [["C-/ RET ; ESC", "leave"]]


def test_the_keys_file_reports_its_problems_and_keeps_the_rest(sagitta, home):
    _keys(home, "sav C-s\nreverse ; w\nflip a\n")
    opened = sagitta("open", _diagram(home / "paper"))
    assert 'line 1: nothing is called "sav" (and 1 more)' in opened["mode_line"]
    # A line replaces every default key of what it names, chords included.
    assert ["w", "reverse", ""] in sagitta("which_key", _diagram(home / "other"))


@pytest.mark.parametrize("text,problem", [
    ("sav C-s", 'line 1: nothing is called "sav"'),
    ("save s", '"s" would type'),
    ("save ; 5", "keeps its own meaning in the command layer"),
    ("save ; :", "keeps its own meaning in the command layer"),
    ("save C-S-#", "write the shifted character itself"),
    ("save C-RET", "RET keeps its own meaning"),
    ("save ; C-s", "the command layer's keys take no C-"),
    ("save ;", '";" needs a key after it'),
    ("save C-hello", '"C-hello" is not a key'),
    ("save C-q\nopen C-q", "line 2: C-q is already bound on line 1"),
    ("save C-q C-q", "line 1: C-q is already bound on line 1"),
    ("save C-q\nsave C-w", "line 2: save is already bound on line 1"),
])
def test_the_keys_file_explains_bad_lines(sagitta, home, text, problem):
    problems = sagitta("evaluate", _diagram(home / "paper"),
                       f"Bindings.resolve({json.dumps(text)}).problems")
    assert len(problems) == 1 and problem in problems[0], problems


def test_the_keys_file_reads_what_the_help_writes(sagitta, home):
    text = "\n".join([
        "hide-grid ; #  # the grid, as by default",
        "zoom-in C-+ <f5> S-<f6>",
        "rotate C-S-t",
        "unbind C-n",
        "save C-q",
        "unbind C-q",
        "open C-q",
        "pos ; i",
    ])
    result = sagitta("evaluate", _diagram(home / "paper"), f"""(() => {{
        const {{ keys, problems }} = Bindings.resolve({json.dumps(text)});
        const names = ["hide-grid", "zoom-in", "rotate", "new", "save", "open", "position"];
        return {{ problems, keys: Object.fromEntries(
            names.map((name) => [name, Keymap.describe(keys.get(name))])) }};
    }})()""")
    assert result == {"problems": [], "keys": {
        "hide-grid": "; #", "zoom-in": "C-+, <f5>, S-<f6>", "rotate": "C-S-t", "new": "",
        "save": "", "open": "C-q", "position": "; i",
    }}


def test_the_manual_lists_every_named_binding(sagitta, home):
    names = sagitta("evaluate", _diagram(home / "paper"), "Object.keys(Bindings.DEFAULTS)")
    with open(os.path.join(_APP, "docs", "sagitta.md")) as manual:
        text = manual.read()
    assert [name for name in names if f"`{name}`" not in text] == []


# ── The .tikzcd round trip ────────────────────────────────────────────────────


def test_hand_written_diagram_is_parsed(sagitta, home):
    diagram = _diagram(home / "paper")
    opened = sagitta("open", diagram)
    assert opened["counts"] == {"vertices": 4, "edges": 4, "selected": 0}
    assert "(parsed)" in opened["mode_line"]
    assert opened["title"] == "square.tikzcd - Sagitta"


def test_save_writes_the_encoding_and_the_tikzcd(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("save", diagram)
    text = diagram.read_text()
    assert text.startswith("%#q=")
    assert '\\arrow["\\alpha"\', from=2-1, to=2-2]' in text


@pytest.mark.parametrize("marker", [
    # quiver's own first line, and the bare form.
    "% https://q.uiver.app/#q={}",
    "% {}",
])
def test_the_encoding_is_read_in_either_form(sagitta, home, marker):
    diagram = _diagram(home / "paper")
    sagitta("save", diagram)
    first, rest = diagram.read_text().split("\n", 1)
    diagram.write_text(f"{marker.format(first[len('%#q='):])}\n{rest}")
    opened = sagitta("open", diagram)
    # The encoding was trusted: the tikz-cd was not parsed instead.
    assert "parsed" not in opened["mode_line"]
    assert opened["counts"] == {"vertices": 4, "edges": 4, "selected": 0}


def test_opening_and_saving_changes_nothing(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("save", diagram)
    first = diagram.read_bytes()
    opened = sagitta("open", diagram)
    assert "parsed" not in opened["mode_line"]
    sagitta("save", diagram)
    assert diagram.read_bytes() == first


def test_hand_edits_win_over_the_encoding(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("save", diagram)
    diagram.write_text(diagram.read_text().replace('\\arrow["f", ', '\\arrow["k", '))
    opened = sagitta("open", diagram)
    assert "edited by hand, so parsed" in opened["mode_line"]
    sagitta("save", diagram)
    assert '\\arrow["k", from=1-1, to=1-2]' in diagram.read_text()


def test_separations_survive_a_save(sagitta, home):
    diagram = _diagram(home / "paper", SQUARE.replace(
        "\\begin{tikzcd}", "\\begin{tikzcd}[column sep=large, row sep=2.5em]"))
    sagitta("save", diagram)
    assert "\\begin{tikzcd}[column sep=large,row sep=2.50em]" in diagram.read_text()


# ── Saving ────────────────────────────────────────────────────────────────────


def test_save_keeps_permissions_and_leaves_no_temporary_file(sagitta, home):
    diagram = _diagram(home / "paper")
    diagram.chmod(0o600)
    sagitta("save", diagram)
    assert stat.S_IMODE(diagram.stat().st_mode) == 0o600
    assert sorted(os.listdir(diagram.parent)) == ["square.tikzcd"]


def test_save_through_a_symlink_replaces_its_target(sagitta, home):
    target = _diagram(home / "figures")
    link = home / "paper" / "square.tikzcd"
    link.parent.mkdir()
    link.symlink_to(target)
    sagitta("save", link)
    assert link.is_symlink()
    assert target.read_text().startswith("%#q=")


# ── Layers and keys ───────────────────────────────────────────────────────────


def test_import_layer_pastes_tikzcd(sagitta, home):
    result = sagitta("import_paste", _diagram(home / "paper"), TRIANGLE)
    assert result["counts"]["vertices"] == 3
    assert result["counts"]["edges"] == 2


def test_macros_layer_pastes_definitions(sagitta, home):
    result = sagitta("macros_paste", _diagram(home / "paper"),
                     "\\newcommand{\\cat}[1]{\\mathcal{#1}}\n")
    assert "loaded 1 macro and 0 colours" in result["mode_line"]


def test_export_layer_copies_what_a_save_would_write(sagitta, home):
    diagram = _diagram(home / "paper")
    result = sagitta("export_copy", diagram)
    assert "copied 9 lines of tikz-cd" in result["mode_line"]
    sagitta("save", diagram)
    assert diagram.read_text() == result["clipboard"] + "\n"


def test_shift_space_selects_and_space_connects(sagitta, home):
    steps = sagitta("space", _diagram(home / "paper"))
    assert steps["start"] == {"vertices": 4, "edges": 4, "selected": 0}
    assert steps["select A"] == {"vertices": 4, "edges": 4, "selected": 1}
    assert steps["select B"] == {"vertices": 4, "edges": 4, "selected": 2}
    assert steps["deselect B"] == {"vertices": 4, "edges": 4, "selected": 1}
    assert steps["empty cell"] == {"vertices": 4, "edges": 4, "selected": 2}
    assert steps["connect to D"]["edges"] == 6


def test_the_mark_selects_a_rectangle_of_cells(sagitta, home):
    """`C-SPC` at two corners takes every cell between them, and the arrows whose ends are both
    among them; Shift adds that region to the selection; Escape drops a mark."""
    steps = sagitta("mark", _diagram(home / "paper"))
    assert "MARK" in steps["mark at A"]["mode_line"]
    assert steps["mark at A"]["counts"]["selected"] == 0
    # The rectangle shows from the mark, with `A` marked as one it would take, and grows to `B`,
    # taking `B` and the arrow between them, before anything is selected.
    assert steps["mark at A"]["region"] == {"shown": True, "size": [1, 1], "inside": 1}
    assert steps["towards B"]["region"] == {"shown": True, "size": [2, 1], "inside": 3}
    assert steps["towards B"]["counts"]["selected"] == 0
    assert steps["top row"]["region"] == {"shown": False, "size": None, "inside": 0}
    # `A`, `B`, and the arrow between them.
    assert steps["top row"]["counts"]["selected"] == 3
    assert "MARK" not in steps["top row"]["mode_line"]
    # The whole square: four vertices and four arrows.
    assert steps["square"]["counts"]["selected"] == 8
    # Shift adds, so the square is still selected after the row is added to it.
    assert steps["adding the row"]["counts"]["selected"] == 8
    # A mark dropped with Escape selects nothing, and leaves the selection as it was.
    assert "MARK" not in steps["mark dropped"]["mode_line"]
    assert not steps["mark dropped"]["region"]["shown"]
    assert steps["mark dropped"]["counts"]["selected"] == 8
    # Nothing was created or deleted along the way.
    for step in steps.values():
        assert (step["counts"]["vertices"], step["counts"]["edges"]) == (4, 4)


def test_a_preset_with_nothing_selected_sets_what_new_arrows_take(sagitta, home):
    diagram = _diagram(home / "pair", PAIR, "pair.tikzcd")
    result = sagitta("preset_default", diagram)
    assert result["preset"] == "equals"
    assert "equals" in result["mode_line"]
    # The command layer marks the preset in force, since there is no selection to describe.
    assert result["current"] == ["equals"]
    # The arrow drawn afterwards takes it.
    assert "\\arrow[equals" in diagram.read_text()


def test_a_preset_with_nothing_selected_does_not_land_in_the_undo_history(sagitta, home):
    """The preset new arrows take is a setting, not part of the diagram, so undo must step back
    over the restyling before it, not over the setting."""
    # Saving writes the encoding and the wrapper, so the diagram to compare against is one saved
    # the same way, rather than the hand-written file.
    untouched = _diagram(home / "untouched")
    sagitta("commands", untouched, json.dumps([]))
    # Restyle every arrow, deselect, set the default, then undo: the restyling is what comes back.
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(["equals", "deselect-all", "dashed", "undo"]))
    assert diagram.read_text() == untouched.read_text()
    settings = json.loads((home / ".config" / "sagitta" / "settings.json").read_text())
    assert settings["diagram.arrow_preset"] == "dashed"


def test_set_names_a_setting_and_its_value(sagitta, home):
    result = sagitta("set_command", _diagram(home / "paper"), json.dumps([
        "set ui.zoom 150",
        "set ui.dark_mode on",
        "set ui.which_key_delay null",
        "set diagram.arrow_preset equals",
    ]))
    assert result["settings"]["ui.zoom"] == 150
    assert result["settings"]["ui.dark_mode"] is True
    assert result["settings"]["ui.which_key_delay"] is None
    assert result["settings"]["diagram.arrow_preset"] == "equals"
    # Every change is reported, and reaches the file.
    assert all("is now" in line for line in result["lines"])
    settings = json.loads((home / ".config" / "sagitta" / "settings.json").read_text())
    assert settings["ui.zoom"] == 150


@pytest.mark.parametrize("command,problem", [
    ("set ui.zoom 1000", "a number from 20 to 200"),
    ("set ui.zoom wide", "a number from 20 to 200"),
    ("set ui.dark_mode sometimes", "true or false"),
    ("set diagram.arrow_preset wiggly", "one of plain"),
    ("set ui.hint_characters AA", "at least two different capital letters or digits"),
    ("set ui.colour red", 'Unknown setting "ui.colour"'),
])
def test_set_refuses_a_value_the_setting_cannot_take(sagitta, home, command, problem):
    """The refusal reaches the mode line's error banner, which `UI.display_error` also logs."""
    result = sagitta("set_command", _diagram(home / "paper"), json.dumps([command]),
                     expected_error=problem)
    assert problem in result["lines"][0]
    # Nothing was changed, so nothing was written.
    assert not (home / ".config" / "sagitta" / "settings.json").exists()


def test_set_with_no_value_reports_what_the_setting_holds(sagitta, home):
    result = sagitta("set_command", _diagram(home / "paper"), json.dumps(["set ui.zoom"]))
    assert "ui.zoom is 100" in result["lines"][0]


def test_the_wheel_zooms_with_shift_or_control_and_pans_with_neither(sagitta, home):
    steps = sagitta("wheel", _diagram(home / "paper"))
    # With no modifier the wheel pans, leaving the zoom alone.
    assert steps["plain"]["view"] != steps["start"]["view"]
    assert steps["plain"]["scale"] == steps["start"]["scale"]
    # Shift zooms (out, where there is room for two steps), and Control does the same, by the same
    # step, rather than panning or doing nothing.
    assert steps["shift"]["scale"] < steps["plain"]["scale"]
    assert steps["control"]["scale"] - steps["shift"]["scale"] == pytest.approx(
        steps["shift"]["scale"] - steps["plain"]["scale"], abs=1e-6)


def test_middle_dragging_pans_from_a_cell_as_well_as_empty_space(sagitta, home):
    steps = sagitta("middle_drag", _diagram(home / "paper"))
    assert steps["from_a_cell"]["view"] != steps["start"]["view"]
    assert steps["from_empty_space"]["view"] != steps["from_a_cell"]["view"]
    # Panning neither draws an arrow, moves a cell, nor selects one.
    for step in ("start", "from_a_cell", "from_empty_space"):
        assert steps[step]["counts"] == {"vertices": 4, "edges": 4, "selected": 0}
    assert steps["dirty"] is False


# ── Building a diagram outwards ───────────────────────────────────────────────


DIAGONAL = """\
\\begin{tikzcd}
\tP \\arrow[dr, "c"] & \\\\
\t& Q
\\end{tikzcd}
"""


@pytest.mark.parametrize("keys,command,after", [
    # The focus point starts on `A`, so a row above it moves the whole diagram down.
    ([], "insert-row-above", "A01 B11 C02 D12"),
    # A row below the focus point moves only the row under it.
    ([], "insert-row-below", "A00 B10 C02 D12"),
    # A column left of the focus point moves everything right.
    ([], "insert-column-left", "A10 B20 C11 D21"),
    # And one right of it moves only the column after.
    ([], "insert-column-right", "A00 B20 C01 D21"),
    # With the focus point moved onto `D`, the gap opens around it instead.
    ([["Right"], ["Down"]], "insert-row-above", "A00 B10 C02 D12"),
    ([["Right"], ["Down"]], "insert-column-left", "A00 B20 C01 D21"),
])
def test_a_gap_moves_what_is_at_or_beyond_it(sagitta, home, keys, command, after):
    result = sagitta("insert", _diagram(home / "paper"), json.dumps(
        {"keys": keys, "command": command}))
    assert result["before"] == "A00 B10 C01 D11"
    assert result["after"] == after
    # One undo closes the gap.
    assert result["undone"] == "A00 B10 C01 D11"


def test_a_gap_with_nothing_beyond_it_is_refused(sagitta, home):
    """Rather than doing nothing quietly: the key was pressed for a reason."""
    result = sagitta("insert", _diagram(home / "paper"), json.dumps(
        {"keys": [["Down"], ["Down"]], "command": "insert-row-below"}),
        expected_error="There is no row at or after row 4 to move.")
    assert result["after"] == "A00 B10 C01 D11"


def test_the_gap_is_saved_as_an_empty_row(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("insert", diagram, json.dumps({"keys": [], "command": "insert-row-below"}))
    # The undo at the end of the scenario is not saved, so the file holds the gap.
    assert "\t\\\\\n" in diagram.read_text()


def test_snake_draws_an_arrow_as_a_chain_through_empty_cells(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    steps = sagitta("snake", diagram, None)
    assert steps["selected"] == {"vertices": 2, "edges": 1, "selected": 3}
    # One corner between `P` and `Q`, so one new cell and two arrows.
    assert steps["drawn"]["vertices"] == 3
    assert steps["drawn"]["edges"] == 2
    # The new cell is empty, and sits at the corner that x-first gives.
    assert steps["cells"] == "-10 P00 Q11"
    # One undo puts the single arrow back.
    assert (steps["undone"]["vertices"], steps["undone"]["edges"]) == (2, 1)
    # The chain is what was saved.
    saved = diagram.read_text()
    assert saved.count("\\arrow[") == 2


def test_snake_can_be_told_which_axis_steps_first(sagitta, home):
    steps = sagitta("snake", _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd"), "y")
    assert steps["cells"] == "-01 P00 Q11"


def test_snake_refuses_what_has_no_staircase(sagitta, home):
    """Neighbours are already joined, so there is nothing to put between them."""
    sagitta("snake", _diagram(home / "paper"), None,
            expected_error="Select one arrow to draw as a staircase.")


# ── Routes ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("commands,expected", [
    (["route x"], "to path={[rounded corners=6pt] -- (\\tikzcdmatrixname-2-2.center |- "
     "\\tikzcdmatrixname-1-1.center) \\tikztonodes -- (\\tikztotarget) [sharp corners]}"),
    (["route y"], "to path={[rounded corners=6pt] -- (\\tikzcdmatrixname-1-1.center |- "
     "\\tikzcdmatrixname-2-2.center) -- (\\tikztotarget) \\tikztonodes [sharp corners]}"),
    (["route"], "-- (\\tikzcdmatrixname-2-2.center |- \\tikzcdmatrixname-1-1.center)"),
    (["route", "route"], "-- (\\tikzcdmatrixname-1-1.center |- \\tikzcdmatrixname-2-2.center)"),
    (["route x", "rounding 0"], "to path={-- (\\tikzcdmatrixname-2-2.center"),
    (["route x", "rounding 8"], "to path={[rounded corners=16pt] --"),
    (["route x", "squiggly"], "[sharp corners]}, squiggly, from=1-1, to=2-2]"),
])
def test_route_commands_write_a_to_path(sagitta, home, commands, expected):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    sagitta("commands", diagram, json.dumps(commands))
    assert expected in diagram.read_text()


@pytest.mark.parametrize("commands", [
    ["route x", "route none"],
    ["route", "route", "route"],
    ["route x", "undo"],
])
def test_a_route_straightens_again(sagitta, home, commands):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    sagitta("commands", diagram, json.dumps(commands))
    assert "to path" not in diagram.read_text()
    assert '\\arrow["c", from=1-1, to=2-2]' in diagram.read_text()


def test_a_route_is_drawn_round_its_corner(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    [p, q] = sagitta("route", diagram, json.dumps([]))["vertices"]
    straight = sagitta("route", diagram, json.dumps([]))["edges"][0]
    assert straight["arcs"] == 0
    routed = sagitta("route", diagram, json.dumps(["route x"]))
    [edge] = routed["edges"]
    assert edge["drawn"] and edge["arcs"] == 1
    # Along the row first: it leaves `P` heading right, level with it, and comes down into `Q`.
    assert abs(edge["source"][1] - p[1]) <= 1 and edge["source"][0] > p[0]
    assert abs(edge["target"][0] - q[0]) <= 1 and edge["target"][1] < q[1]
    down = sagitta("route", diagram, json.dumps(["route y"]))["edges"][0]
    assert abs(down["source"][0] - p[0]) <= 1 and down["source"][1] > p[1]
    assert abs(down["target"][1] - q[1]) <= 1 and down["target"][0] < q[0]


def test_a_route_label_is_on_the_leg_the_export_puts_it_on(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    # tikz-cd lays a diagram out wider than tall, so halfway along a route that goes along the row
    # first is still on the row, and one that goes down the column first is already on the row.
    [p, q] = sagitta("route", diagram, json.dumps([]))["vertices"]
    across = sagitta("route", diagram, json.dumps(["route x"]))
    assert "\\arrow[\"c\"{pos=0.833}" in diagram.read_text()
    label = across["edges"][0]["label"]
    assert p[0] < label[0] < q[0] and label[1] < p[1]
    down = sagitta("route", diagram, json.dumps(["route y"]))
    assert "\\tikztonodes [sharp corners]" in diagram.read_text()
    label = down["edges"][0]["label"]
    assert p[0] < label[0] < q[0] and p[1] < label[1] < q[1]


def test_checkpoints_are_added_at_the_focus_point(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps([[0, 2], "checkpoint", [1, 2], "checkpoint"]))
    [edge] = result["edges"]
    assert edge["route"] == [[0, 2], [1, 2]]
    assert edge["drawn"] and edge["arcs"] == 2
    saved = diagram.read_text()
    # Row 3 holds no vertex, so its cells are written out, empty, to have nodes to pass through.
    assert "[execute at empty cell=" in saved
    assert "-- (\\tikzcdmatrixname-3-1.center) -- (\\tikzcdmatrixname-3-2.center)" in saved
    # Again at the same cell takes it out.
    again = sagitta("route", diagram, json.dumps([[1, 2], "checkpoint"]))
    assert again["edges"][0]["route"] == [[0, 2]]


FORK = """\
\\begin{tikzcd}
\tP \\arrow[dr] \\arrow[drr] & & \\\\
\t& Q & R
\\end{tikzcd}
"""


def test_a_checkpoint_comes_out_of_the_arrows_that_have_it(sagitta, home):
    """With several arrows selected, a cell only some pass through is taken out of those, rather
    than added to the rest."""
    diagram = _diagram(home / "fork", FORK, "fork.tikzcd")
    first = ("const [edge] = ui.quiver.all_cells().filter((cell) => cell.is_edge());"
             " edge.options.route = [[0, 1]]; edge.render(ui);")
    result = sagitta("route", diagram, json.dumps([{"js": first}, [0, 1], "checkpoint"]))
    assert [edge["route"] for edge in result["edges"]] == [[], []]


def test_k_takes_out_the_checkpoint_under_the_pointer(sagitta, home):
    """Wherever the focus point is."""
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(
        ["route x", [0, 1], {"hover": 0}, {"keys": [[";"], ["k"]]}]))
    assert result["edges"][0]["route"] == []
    assert "checkpoint removed" in result["flashed"]


def test_checkpoint_has_a_key_in_the_layer(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(
        [[1, 0], {"keys": [[";"], ["k"], ["b"], ["5"], ["Enter"], ["Escape"]]}]))
    # The curve's key rounds a route instead.
    assert result["edges"][0]["route"] == [[1, 0]]
    assert "[rounded corners=10pt]" in diagram.read_text()


@pytest.mark.parametrize("keys,route", [
    # Picked up, carried up a row, and put down.
    ([[";"], ["m"], ["Escape"], ["Up"], ["Enter"]], [[1, -1]]),
    # Put back where it was.
    ([[";"], ["m"], ["Escape"], ["Up"], ["Escape"]], [[1, 0]]),
    # Onto the arrow's own end it does not go: it waits, and follows on past it.
    ([[";"], ["m"], ["Escape"], ["Down"], ["Down"], ["Enter"]], [[1, 2]]),
])
def test_a_checkpoint_is_carried_with_the_focus_point(sagitta, home, keys, route):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(["route x", [1, 0], {"keys": keys}]))
    assert result["edges"][0]["route"] == route
    assert result["edges"][0]["drawn"]


def test_checkpoints_are_marked_while_the_arrow_is_selected(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(["route x"]))
    [p, q] = result["vertices"]
    [mark] = result["edges"][0]["checkpoints"]
    # In the cell the route turns in: `Q`'s column, `P`'s row.
    assert mark["shown"] and not mark["carried"]
    assert abs(mark["centre"][0] - q[0]) <= 1 and abs(mark["centre"][1] - p[1]) <= 1
    carried = sagitta("route", diagram, json.dumps(["route x", [1, 0], "move-checkpoint"]))
    assert carried["edges"][0]["checkpoints"][0]["carried"]
    hidden = sagitta("route", diagram, json.dumps(["route x", {"keys": [["Escape"]]}]))
    assert not hidden["edges"][0]["checkpoints"][0]["shown"]


def test_carrying_a_checkpoint_undoes_in_one_step(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(
        ["route x", [1, 0], "move-checkpoint", {"keys": [["Up"], ["Up"], ["Enter"]]}, "undo"]))
    assert result["edges"][0]["route"] == [[1, 0]]


def test_a_change_to_the_diagram_puts_a_carried_checkpoint_down(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(
        ["route x", [1, 0], "move-checkpoint", {"keys": [["Up"]]}, "reverse",
         {"keys": [["Down"]]}]))
    # Put down a row up before the arrow was reversed, the checkpoint stays there when the focus
    # point moves on.
    assert result["edges"][0]["route"] == [[1, -1]]
    # A command undoes in one step, so putting the checkpoint down goes with the reverse.
    assert result["steps"] == 2


def test_a_checkpoint_put_down_where_it_was_is_no_step(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(
        ["route x", [1, 0], "move-checkpoint", {"keys": [["Up"], ["Down"], ["Enter"]]}]))
    assert result["edges"][0]["route"] == [[1, 0]]
    # The route is the one step: carrying the checkpoint there and back again adds none.
    assert result["steps"] == 1


def test_a_checkpoint_is_dragged_by_its_ring(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(["route x", {"drag": [[1, 0], [2, 0]]}]))
    [edge] = result["edges"]
    assert edge["route"] == [[2, 0]]
    assert not any(mark["carried"] for mark in edge["checkpoints"])
    # The bend and the drag are a step each.
    assert result["steps"] == 2


def test_carrying_needs_a_checkpoint_at_the_focus_point(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    sagitta("route", diagram, json.dumps(["route x", [0, 1], "move-checkpoint"]),
            expected_error="There is no checkpoint of a selected arrow at the focus point")


def test_a_route_moves_with_its_arrow(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    moved = sagitta("route", diagram, json.dumps(
        ["route x", {"keys": [["Down", ["control"]]]}]))
    assert moved["edges"][0]["route"] == [[1, 1]]
    # A gap opened across the route moves the cells beyond it on. The file was saved moved, and
    # opens with `P` back at the top left.
    opened = sagitta("route", diagram, json.dumps([[1, 0], "insert-column-left"]))
    assert opened["edges"][0]["route"] == [[2, 0]]


def test_straightening_checkpoints_says_how_to_get_them_back(sagitta, home):
    diagram = _diagram(home / "diagonal", DIAGONAL, "diagonal.tikzcd")
    result = sagitta("route", diagram, json.dumps(
        [[0, 2], "checkpoint", [1, 2], "checkpoint", "route"]))
    assert result["edges"][0]["route"] == []
    assert "route straightened: C-z brings the checkpoints back" in result["flashed"]
    # One of the two bends is no work to lose.
    bend = sagitta("route", diagram, json.dumps(["route x", "route none"]))
    assert "route straightened" not in bend["flashed"]


def test_a_route_is_refused_where_there_is_no_corner(sagitta, home):
    sagitta("commands", _diagram(home / "paper"), json.dumps(["route x"]),
            expected_error="The arrow is already straight")


def test_a_changed_setting_is_written_to_the_settings_file(sagitta, home):
    sagitta("settings", _diagram(home / "paper"))
    settings = json.loads((home / ".config" / "sagitta" / "settings.json").read_text())
    assert settings["export.ampersand_replacement"] is True
    # The defaults are written alongside it, so the file shows every setting there is.
    assert settings["export.centre_diagram"] is True


def _settings(home, text):
    directory = home / ".config" / "sagitta"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "settings.json").write_text(text)


PAIR = """\
\\begin{tikzcd}
\tA & B
\\end{tikzcd}
"""

# Select `A`, step right, and connect it to `B`.
CONNECT = [["Space", ["shift"]], ["Right"], ["Space"]]


@pytest.mark.parametrize("preset,expected", [
    (None, "\\arrow[from=1-1, to=1-2]"),
    ("dashed", "\\arrow[dashed, from=1-1, to=1-2]"),
    ("equals", "\\arrow[equals, from=1-1, to=1-2]"),
])
def test_new_arrows_take_the_preset_of_the_settings(sagitta, home, preset, expected):
    if preset is not None:
        _settings(home, json.dumps({"diagram.arrow_preset": preset}))
    diagram = _diagram(home / "paper", PAIR)
    sagitta("layout", diagram, json.dumps({"keys": CONNECT + [["s", ["control"]]]}))
    assert expected in diagram.read_text()


def test_the_view_starts_at_the_zoom_of_the_settings(sagitta, home):
    _settings(home, '{"ui.zoom": 50}')
    assert "50%" in sagitta("open", _diagram(home / "paper"))["mode_line"]


def test_the_cell_and_label_sizes_come_from_the_settings(sagitta, home):
    def measure():
        layout = sagitta("layout", _diagram(home / "paper", PAIR), json.dumps({}))
        a, b = layout["vertices"]
        size = sagitta("evaluate", _diagram(home / "paper", PAIR),
                       'getComputedStyle(document.querySelector(".vertex .label")).fontSize')
        return _centre(b)[0] - _centre(a)[0], size

    assert measure() == (pytest.approx(128, abs=1), "26px")
    _settings(home, '{"ui.cell_size": 200, "ui.label_size": 40}')
    assert measure() == (pytest.approx(200, abs=1), "40px")


def test_bad_settings_are_reported_and_left_at_their_defaults(sagitta, home):
    _settings(home, '{"ui.zoom": 500, "diagram.arrow_preset": "fancy", "ui.dark_mode": "yes"}')
    opened = sagitta("open", _diagram(home / "paper"))
    assert "settings.json: ui.zoom should be a number from 20 to 200 (and 2 more)" \
        in opened["mode_line"]
    assert "100%" in opened["mode_line"]


def test_a_malformed_settings_file_is_left_alone(sagitta, home):
    _settings(home, '{"ui.zoom": 50,\n')
    sagitta("settings", _diagram(home / "paper"))
    assert (home / ".config" / "sagitta" / "settings.json").read_text() == '{"ui.zoom": 50,\n'


def test_the_settings_file_is_read_at_startup(sagitta, home):
    settings = home / ".config" / "sagitta"
    settings.mkdir(parents=True)
    (settings / "settings.json").write_text('{"export.centre_diagram": false}\n')
    result = sagitta("export_copy", _diagram(home / "paper"))
    assert "\\begin{tikzcd}" in result["clipboard"]
    assert "\\[" not in result["clipboard"]


def test_a_malformed_settings_file_leaves_the_defaults(sagitta, home):
    settings = home / ".config" / "sagitta"
    settings.mkdir(parents=True)
    (settings / "settings.json").write_text("{ not json\n")
    result = sagitta("export_copy", _diagram(home / "paper"))
    assert "\\[\\begin{tikzcd}" in result["clipboard"]
    assert (settings / "settings.json").read_text() == "{ not json\n"


def test_the_panel_is_gone(sagitta, home):
    result = sagitta("side_panel", _diagram(home / "paper"))
    assert result["selected"] == 8
    # No panel, no sliders, and no radio buttons: the palette holds the arrow options itself.
    assert result["panels"] == 0


def test_a_setting_the_app_no_longer_has_is_dropped(sagitta, home):
    settings = home / ".config" / "sagitta"
    settings.mkdir(parents=True)
    (settings / "settings.json").write_text('{"ui.side_panel": true}\n')
    sagitta("settings", _diagram(home / "paper"))
    assert "ui.side_panel" not in json.loads((settings / "settings.json").read_text())


# ── The settings layer ────────────────────────────────────────────────────────
#
# `C-,` lists the settings, each on a key, and every change shows straight away.

# The distance between the centres of the pair's vertices, and the labels' size.
_PAIR_LAYOUT = """(() => {
    const [a, b] = [...document.querySelectorAll(".vertex .content")].map((content) => {
        const rect = content.getBoundingClientRect();
        return rect.x + rect.width / 2;
    });
    return [Math.round(b - a), getComputedStyle(document.querySelector(".vertex .label")).fontSize];
})()"""

_LIST_HIDDEN = 'document.querySelector(".which-key").classList.contains("hidden")'


def _presses(*keys):
    return [["press", key] for key in keys]


def _saved_settings(home):
    return json.loads((home / ".config" / "sagitta" / "settings.json").read_text())


def test_the_settings_layer_changes_the_view_straight_away(sagitta, home):
    found = sagitta("script", _diagram(home / "paper", PAIR), json.dumps([
        ["press", ",", ["control"]],
        *_presses("c", "2", "0", "0", "Enter", "l", "4", "0", "Enter"),
        ["wait", 300],
        ["eval", _PAIR_LAYOUT],
        *_presses("d", "z", "5", "0", "Enter"),
        ["eval", 'document.body.classList.contains("dark")'],
        ["eval", 'document.querySelector(".mode-line").textContent'],
    ]))
    assert found[0] == [200, "40px"]
    assert found[1] is True
    assert "SETTINGS" in found[2] and "50%" in found[2]
    settings = _saved_settings(home)
    assert (settings["ui.cell_size"], settings["ui.label_size"], settings["ui.zoom"]) \
        == (200, 40, 50)
    assert settings["ui.dark_mode"] is True


def test_the_settings_layer_lists_the_presets_for_new_arrows(sagitta, home):
    sagitta("script", _diagram(home / "paper"), json.dumps(
        [["press", ",", ["control"]], *_presses("a", "=")]))
    assert _saved_settings(home)["diagram.arrow_preset"] == "equals"


def test_the_settings_layer_refuses_a_number_out_of_range(sagitta, home):
    found = sagitta("script", _diagram(home / "paper"), json.dumps([
        ["press", ",", ["control"]], *_presses("z", "5", "Enter"),
        ["eval", 'document.querySelector(".mode-line").textContent'],
    ]))
    assert "zoom to start at: a number from 20 to 200" in found[0]
    assert "100%" in found[0]


def test_the_settings_buttons_step_their_settings(sagitta, home):
    result = sagitta("pointer", _diagram(home / "paper"), json.dumps(
        [["press", ",", ["control"]], ["step", "cell size", "+"], ["step", "label size", "−"]]))
    assert result["open"]
    settings = _saved_settings(home)
    assert (settings["ui.cell_size"], settings["ui.label_size"]) == (144, 24)


def test_the_command_list_waits_for_a_key_or_for_question_mark(sagitta, home):
    found = sagitta("script", _diagram(home / "paper"), json.dumps([
        # Listed once `;` has waited 300ms for a key, and hidden and shown again by `?`.
        ["press", ";"], ["eval", _LIST_HIDDEN],
        ["wait", 300], ["eval", _LIST_HIDDEN],
        ["press", "?"], ["eval", _LIST_HIDDEN],
        ["press", "Escape"],
        # Stepping the wait below none at all sets it to never: 200, 100, 0, then never.
        ["press", ",", ["control"]], *_presses("w", "Left", "Left", "Left", "Left", "Escape"),
        ["press", ";"], ["wait", 600], ["eval", _LIST_HIDDEN],
        ["press", "?"], ["eval", _LIST_HIDDEN],
    ]))
    assert found == [True, False, True, True, False]
    assert _saved_settings(home)["ui.which_key_delay"] is None


def test_a_key_typed_before_the_command_list_shows_keeps_it_hidden(sagitta, home):
    """`; (` does its preset and leaves the list hidden, but `; t` waits on a choice, so a pause
    there lists the tails."""
    found = sagitta("script", _diagram(home / "paper"), json.dumps([
        ["press", "a", ["control"]],
        ["press", ";"], ["press", "("], ["wait", 600], ["eval", _LIST_HIDDEN],
        ["press", "Escape"],
        ["press", ";"], ["press", "t"], ["eval", _LIST_HIDDEN],
        ["wait", 400], ["eval", _LIST_HIDDEN],
        ["eval", 'document.querySelector(".which-key .submenu h3").textContent'],
    ]))
    assert found == [True, True, False, "tail (again to cancel)"]


def test_the_compact_command_list_shows_only_keys_and_values(sagitta, home):
    found = sagitta("script", _diagram(home / "paper"), json.dumps([
        ["press", ",", ["control"]], *_presses("k", "Escape"),
        ["press", "a", ["control"]], ["press", ";"], ["press", "?"],
        ["eval", """[
            document.querySelector(".which-key").classList.contains("compact"),
            [...document.querySelectorAll(".which-key .main .entry kbd:first-child + span")]
                .filter((span) => span.offsetParent !== null).length,
            [...document.querySelectorAll(".which-key .main .entry .value")]
                .filter((span) => span.offsetParent !== null).length > 0,
            document.querySelector(".which-key .main .entry").title,
        ]"""],
    ]))
    assert found[0] == [True, 0, True, "tail"]


def test_settings_is_listed_under_layers_in_the_help(sagitta, home):
    help = dict(sagitta("help", _diagram(home / "paper")))
    assert ["C-,", "settings"] in help["Layers"]


def test_dragging_between_vertices_connects_them(sagitta, home):
    diagram = _diagram(home / "paper")
    result = sagitta("drag", diagram)
    assert result["dirty"]
    assert result["counts"]["edges"] == 5
    assert "\\arrow[from=1-1, to=2-2]" in diagram.read_text()


def test_dragging_a_vertex_moves_it_and_undoes(sagitta, home):
    result = sagitta("move", _diagram(home / "paper"))
    assert not result["mode_line"].startswith("MOVE")
    assert "\t& B & A \\\\" in result["moved"]
    assert "\tA & B \\\\" in result["undone"]


def test_clicking_the_focus_point_creates_a_vertex(sagitta, home):
    diagram = _diagram(home / "paper")
    steps = sagitta("click", diagram)
    assert steps["moved"] == {"vertices": 4, "edges": 4, "selected": 0}
    assert steps["created"] == {"vertices": 5, "edges": 4, "selected": 1}
    assert "A & B & \\bullet" in diagram.read_text()


def test_dragging_from_the_focus_point_creates_a_vertex_and_an_arrow(sagitta, home):
    result = sagitta("drag_from_focus_point", _diagram(home / "paper"))
    assert result["counts"] == {"vertices": 5, "edges": 5, "selected": 1}


# ── Layout ────────────────────────────────────────────────────────────────────
#
# A vertex's column and row grow to fit its label, which moves the vertices beyond them, so every
# arrow must be redrawn between where its ends now are. Only the cells that moved are redrawn, and
# labels are sized together, a frame after they change.


# The square's arrows, in the order they are created, by the vertices they join.
SQUARE_ARROWS = [(0, 1), (0, 2), (1, 3), (2, 3)]


def _centre(box):
    return ((box["left"] + box["right"]) / 2, (box["top"] + box["bottom"]) / 2)


def _assert_arrows_join_their_vertices(layout):
    """Each of the square's arrows runs rightwards or downwards, from its source's centre to its
    target's."""
    for (source, target), line in zip(SQUARE_ARROWS, layout["arrows"], strict=True):
        assert (line["left"], line["top"]) == pytest.approx(
            _centre(layout["vertices"][source]), abs=1)
        assert (line["right"], line["bottom"]) == pytest.approx(
            _centre(layout["vertices"][target]), abs=1)


def test_a_widened_label_moves_what_lies_beyond_it(sagitta, home):
    layout = sagitta("layout", _diagram(home / "paper"), json.dumps(
        {"keys": [["a", ["control"]], *_typed(*"xxxxxxxxxx")]}))
    a, b, c, d = layout["vertices"]
    assert a["right"] - a["left"] > 150
    assert b["left"] > a["right"] and d["left"] > a["right"]
    # `C` lies in the widened column, and stays centred in it.
    assert _centre(c)[0] == pytest.approx(_centre(a)[0], abs=1)
    _assert_arrows_join_their_vertices(layout)


def test_labels_are_sized_with_their_macros_when_opened_and_reloaded(sagitta, home):
    paper = home / "paper"
    macros = paper / "macros.tex"
    diagram = _diagram(paper, SQUARE.replace("\tA ", "\t\\wide "))
    macros.write_text("\\newcommand{\\wide}{\\mathrm{ABCDEFGHIJKL}}\n")
    layout = sagitta("layout", diagram, json.dumps({}))
    a = layout["vertices"][0]
    assert a["right"] - a["left"] > 150
    _assert_arrows_join_their_vertices(layout)

    layout = sagitta("layout", diagram, json.dumps({
        "macros": "\\newcommand{\\wide}{A}\n", "macros_file": str(macros)}))
    a = layout["vertices"][0]
    assert a["right"] - a["left"] < 100
    _assert_arrows_join_their_vertices(layout)


def test_dark_mode_draws_black_in_white_and_changes_nothing_saved(sagitta, home):
    diagram = _diagram(home / "paper")
    sagitta("save", diagram)
    light = diagram.read_text()
    result = sagitta("dark_mode", diagram)
    assert result == {"dark": True, "stroke": "rgb(255, 255, 255)", "label": "rgb(255, 255, 255)"}
    assert diagram.read_text() == light
    settings = home / ".config" / "sagitta" / "settings.json"
    assert json.loads(settings.read_text())["ui.dark_mode"] is True
    # It stays on, and the same key turns it off.
    result = sagitta("dark_mode", diagram)
    assert result == {"dark": False, "stroke": "rgb(0, 0, 0)", "label": "rgb(0, 0, 0)"}
    assert json.loads(settings.read_text())["ui.dark_mode"] is False


def test_the_page_never_navigates_away(sagitta, home):
    result = sagitta("navigate", _diagram(home / "paper"))
    assert result == {"drop_prevented": True, "still_here": True, "vertices": 4}


# ── Where macros come from ────────────────────────────────────────────────────


def _macros(directory):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "macros.tex").write_text("\\newcommand{\\found}{F}\n")


@pytest.mark.parametrize("layout, diagram_dir, found", [
    # A repository's own macros.tex is found from anywhere inside it.
    ({"repo/.git": None, "repo": "macros"}, "repo/figs/sub", True),
    # The search stops at the repository's root.
    ({"outer": "macros", "outer/repo/.git": None}, "outer/repo/figs", False),
    # Outside a repository, it climbs until the home directory.
    ({"outer": "macros"}, "outer/loose/figs", True),
    # But never into it: a stray ~/macros.tex is nobody's.
    ({"": "macros"}, "loose/figs", False),
    ({"": "macros"}, "", False),
])
def test_macros_search_bounds(sagitta, home, layout, diagram_dir, found):
    for directory, what in layout.items():
        if what == "macros":
            _macros(home / directory)
        else:
            (home / directory).mkdir(parents=True, exist_ok=True)
    opened = sagitta("open", _diagram(home / diagram_dir))
    if found:
        assert "; macros.tex: 1 macro and 0 colours" in opened["mode_line"]
    else:
        assert "; no macros.tex" in opened["mode_line"]


# ── Sources ───────────────────────────────────────────────────────────────────


def _sources():
    found = []
    for directory in ("src", "electron"):
        for name in sorted(os.listdir(os.path.join(_APP, directory))):
            if name.endswith(".js"):
                found.append(os.path.join(directory, name))
    return found


@pytest.mark.skipif(not node, reason="node not installed")
@pytest.mark.parametrize("source", _sources())
def test_source_parses(source):
    completed = subprocess.run(
        [node, "--check", os.path.join(_APP, source)], capture_output=True, text=True,
        check=False)
    assert completed.returncode == 0, completed.stderr


# ── In a browser ──────────────────────────────────────────────────────────────


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


@pytest.fixture(scope="module")
def site():
    """The repository, served over HTTP on a free port, as a static host would serve it."""
    handler = functools.partial(_QuietHandler, directory=_APP)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/"
    server.shutdown()


@pytest.fixture
def browser(site, home):
    """Evaluate a script in the page, served from `site` at `hash`, returning what it returns,
    or, if `notice`, that and the text of the notice the page opened on its own (see
    `browser.js`), or `None`. Fails on any page error but one with `expected_error` in it, as
    `sagitta` does."""

    def run(script, notice=False, hash="", expected_error=None):
        env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"))
        command = [electron, "--ozone-platform=headless", _BROWSER, site + hash, script]
        if os.environ.get("CI"):
            command.insert(1, "--no-sandbox")
        completed = subprocess.run(
            command, env=env, capture_output=True, text=True, timeout=60, check=False)
        lines = [line for line in completed.stdout.splitlines() if line.startswith("RESULT ")]
        assert lines, f"no result:\n{completed.stdout}\n{completed.stderr}"
        output = json.loads(lines[-1][len("RESULT "):])
        errors = output["errors"]
        if expected_error is not None:
            assert [error for error in errors if expected_error in error], \
                f"never reported {expected_error!r}: {errors}"
            errors = [error for error in errors if expected_error not in error]
        assert errors == []
        # A script returning nothing leaves `result` out.
        result = output.get("result")
        return (result, output["notice"]) if notice else result

    return run


def test_the_page_runs_on_the_web_host(browser):
    result = browser("""({
        built: document.querySelectorAll(".mode-line").length,
        title: document.title,
        web: typeof host.describe === "function" && host.describe("/1/a.tikzcd") === "a.tikzcd",
    })""")
    assert result == {"built": 1, "title": "untitled - Sagitta", "web": True}


def test_a_device_with_no_mouse_is_told_what_works(browser):
    fine, notice = browser('matchMedia("(any-pointer: fine)").matches', notice=True)
    if fine:
        assert notice is None
    else:
        assert "driven by the keyboard" in notice


def test_a_dropped_diagram_opens_in_a_browser(browser):
    script = """(async () => {
        const text = %s;
        const path = host.path_of(new File([text], "square.tikzcd"));
        await ui.file.open(path, true);
        return { counts: ui.quiver.all_cells().length, title: document.title };
    })()""" % json.dumps(SQUARE)
    assert browser(script) == {"counts": 8, "title": "square.tikzcd - Sagitta"}


def test_settings_are_kept_in_the_browser(browser):
    result = browser("""(async () => {
        await ui.settings.set("ui.zoom", 150);
        return JSON.parse(await host.read_settings())["ui.zoom"];
    })()""")
    assert result == 150


@pytest.mark.parametrize("press,expected", [
    ("Discard", True),
    ("Cancel", False),
    # ESC presses the last button, Cancel.
    (None, False),
])
def test_discarding_asks_in_the_page(browser, press, expected):
    script = """(async () => {
        const answer = host.confirm("Discard the changes to square.tikzcd?");
        const dialog = document.querySelector("dialog.web-dialog[open]");
        const focused = document.activeElement.textContent;
        const press = %s;
        if (press === null) {
            dialog.close();
        } else {
            [...dialog.querySelectorAll("button")]
                .find((button) => button.textContent === press).click();
        }
        return { answer: await answer, focused, gone: !dialog.isConnected };
    })()""" % json.dumps(press)
    assert browser(script) == {"answer": expected, "focused": "Cancel", "gone": True}


def test_the_settings_are_edited_in_the_page(browser):
    result = browser("""(async () => {
        await ui.settings.set("ui.zoom", 150);
        await host.open_settings();
        const dialog = document.querySelector("dialog.web-dialog[open]");
        const areas = [...dialog.querySelectorAll("textarea")];
        // Keys typed here are the dialog's, not the page's.
        const event = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
        areas[0].dispatchEvent(event);
        return {
            fields: areas.length,
            zoom: JSON.parse(areas[0].value)["ui.zoom"],
            mode_line: document.querySelector(".mode-line").textContent.startsWith("TYPE"),
        };
    })()""")
    assert result == {"fields": 2, "zoom": 150, "mode_line": True}


# The origin's private file system stands in for a folder on disk: its handles need no picker, and
# the browser grants them without asking. `PAPER` lays out a paper in it, with `macros.tex` at the
# top, a `.git` beside it, and a diagram a directory down, and hands it over as the picker would.
PAPER = """
    const root = await navigator.storage.getDirectory();
    const paper = await root.getDirectoryHandle("paper", { create: true });
    await paper.getDirectoryHandle(".git", { create: true });
    const write = async (directory, name, text) => {
        const stream = await (await directory.getFileHandle(name, { create: true }))
            .createWritable();
        await stream.write(text);
        await stream.close();
    };
    await write(paper, "macros.tex", String.raw`\\newcommand{\\C}{\\mathbb{C}}`);
    const figures = await paper.getDirectoryHandle("figures", { create: true });
    await write(figures, "square.tikzcd", %s);
    const diagram = await figures.getFileHandle("square.tikzcd");
    window.showDirectoryPicker = async () => paper;
    window.showOpenFilePicker = async () => [diagram];
    const read = async (directory, name) => (await (await directory.getFileHandle(name))
        .getFile()).text();
""" % json.dumps(SQUARE)


def test_a_folder_finds_macros_and_relative_paths(browser):
    result = browser("""(async () => {
        %s
        await ui.file.open_folder();
        await ui.file.open();
        const opened = { title: document.title, macros: host.describe(ui.file.macros),
            defined: ui.macros.has("\\\\C") };
        // A relative name saves beside the diagram, with no picker.
        await ui.file.save("../copy.tikzcd");
        return { ...opened, copy: (await read(paper, "copy.tikzcd")).includes("A & B") };
    })()""" % PAPER)
    assert result == {"title": "square.tikzcd - Sagitta", "macros": "macros.tex", "defined": True,
                      "copy": True}


def test_the_last_diagram_reopens_with_its_folder(browser):
    browser("""(async () => {
        %s
        await ui.file.open_folder();
        await ui.file.open();
        // Keeping the handles is not awaited by the page.
        await new Promise((resolve) => setTimeout(resolve, 200));
    })()""" % PAPER)
    result = browser("""({ title: document.title, macros: host.describe(ui.file.macros) })""")
    assert result == {"title": "square.tikzcd - Sagitta", "macros": "macros.tex"}


def test_the_page_keeps_its_files_to_open_offline(browser):
    result = browser("""(async () => {
        await navigator.serviceWorker.ready;
        if (navigator.serviceWorker.controller === null) {
            await new Promise((resolve) => navigator.serviceWorker
                .addEventListener("controllerchange", resolve, { once: true }));
        }
        await fetch("main.css");
        const kept = await (await caches.open("sagitta")).match("main.css");
        return kept !== undefined && (await kept.text()).includes("--ui-black");
    })()""")
    assert result


def _square_link(browser):
    """The square's encoding, as its file's `%#q=` line has it."""
    return browser("""(async () => {
        await ui.file.open(host.path_of(new File([%s], "square.tikzcd")), true);
        return ui.file.text().match(/^%%#q=(\\S+)$/m)[1];
    })()""" % json.dumps(SQUARE))


def test_a_link_opens_its_diagram(browser):
    """As quiver's do, with `+` and `=` escaped or not, and untitled, so unsaved."""
    encoding = _square_link(browser)
    for hash in [f"#q={encoding}", f"#q={encoding.replace('+', '%2B').replace('=', '%3D')}"]:
        result = browser("""({ cells: ui.quiver.all_cells().length, title: document.title,
            dirty: ui.file.dirty })""", hash=hash)
        assert result == {"cells": 8, "title": "untitled + - Sagitta", "dirty": True}


def test_a_link_pasted_into_the_open_page_opens(browser):
    encoding = _square_link(browser)
    result = browser("""(async () => {
        location.hash = "q=%s";
        await new Promise((resolve) => setTimeout(resolve, 200));
        return ui.quiver.all_cells().length;
    })()""" % encoding)
    assert result == 8


def test_a_broken_link_says_so(browser):
    cells = browser("ui.quiver.all_cells().length", hash="#q=bm90IGpzb24=",
                    expected_error="Could not open the link")
    assert cells == 0
