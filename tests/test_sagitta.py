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
"""

import json
import os
import shutil
import stat
import subprocess

import pytest

_APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DRIVER = os.path.join(_APP, "tests", "sagitta", "driver.js")


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
    """Run a scenario on a diagram, returning its result. Fails on any page error."""

    def run(scenario, diagram, argument=None):
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
        assert output["errors"] == []
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
])
def test_commands_change_the_arrows(sagitta, home, commands, expected):
    diagram = _diagram(home / "paper")
    sagitta("commands", diagram, json.dumps(commands))
    assert expected in diagram.read_text()


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
    assert ["RET", "edit the label in place"] in help["Typing"]
    assert ["<delete>", "delete"] in help["Typing"]
    assert help["Moving"][0] == ["arrows", "move the focus point"]
    assert help["Mouse"][0] == ["click", "select; again to edit the label"]
    assert help["Mouse"][-1] == ["S-scroll", "zoom"]
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
    ([["step", "curve (loops: radius)", "+"]], '\\arrow["f", curve={height=6pt}, from=1-1'),
    ([["step", "curve (loops: radius)", "+"], ["step", "curve (loops: radius)", "+"]], '\\arrow["f", curve={height=12pt}, from=1-1'),
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
