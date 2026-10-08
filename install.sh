#!/bin/bash
# install.sh: put `sagitta` on PATH and register it with the desktop.
# Idempotent: safe to re-run; only updates stale symlinks.
#
# Usage: install.sh [--bin=DIR] [--docs=DIR] [--dry-run]
#
# Symlinks for the launcher, the icon, and the MIME type, one rendered desktop
# entry, and the MIME registration. Settings live in
# ~/.config/sagitta/settings.json, which Sagitta writes itself and this script
# never touches.
#
# --bin defaults to $XDG_BIN_HOME, else ~/.local/bin. The desktop entry names
# the launcher under it outright, since launchers do not necessarily see the
# shell's PATH. --docs also links the manual, docs/sagitta.md, into DIR.

set -e

SAGITTA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${XDG_BIN_HOME:-${HOME}/.local/bin}"
DOCS=""
SHARE="${XDG_DATA_HOME:-${HOME}/.local/share}"
DRY=0

for arg in "$@"; do
    case "$arg" in
        --bin=*)   BIN="${arg#--bin=}" ;;
        --docs=*)  DOCS="${arg#--docs=}" ;;
        --dry-run) DRY=1 ;;
        *) echo "install.sh: unknown option '${arg}'" >&2; exit 1 ;;
    esac
done
BIN="${BIN/#\~/$HOME}"
DOCS="${DOCS/#\~/$HOME}"

# _sym SRC DST [LABEL]
# Creates or updates a symlink. Skips anything already at DST that isn't a
# symlink, so it never clobbers a real file it didn't create.
_sym() {
    local src="$1" dst="$2" label="${3:-${2##*/}}"
    if [[ -L "$dst" ]]; then
        if [[ "$(readlink "$dst")" == "$src" ]]; then
            printf '  ok   %s\n' "$label"
            return
        fi
    elif [[ -e "$dst" ]]; then
        printf '  skip %s  (exists, not a symlink)\n' "$label"
        return
    fi
    if (( DRY )); then
        printf '  link %s  → %s\n' "$label" "$src"
    else
        mkdir -p "$(dirname "$dst")"
        ln -sfn "$src" "$dst"
        printf '  link %s\n' "$label"
    fi
}

printf 'Sagitta install  root=%s  bin=%s\n' "$SAGITTA" "$BIN"
(( DRY )) && printf '(dry run: no changes will be made)\n'
printf '\n'

printf 'Command:\n'
_sym "${SAGITTA}/sagitta" "${BIN}/sagitta" "sagitta"
case ":${PATH}:" in
    *":${BIN}:"*) ;;
    *) printf '  note %s is not on PATH\n' "$BIN" ;;
esac

if [[ -n "$DOCS" ]]; then
    printf '\nDocumentation:\n'
    # Relative, so the link survives DIR being synced to a machine whose home
    # directory is elsewhere.
    _sym "$(realpath -m --relative-to="${DOCS}" "${SAGITTA}/docs/sagitta.md")" "${DOCS}/sagitta.md" "sagitta.md"
fi

# The desktop entry is rendered rather than linked: it holds an absolute path.
# .tikzcd files are text/x-tikzcd, a kind of text/x-tex, and open in Sagitta
# rather than the TeX editor.
printf '\nDesktop:\n'
_sym "${SAGITTA}/icon.svg" "${SHARE}/icons/hicolor/scalable/apps/sagitta.svg" "icons/sagitta.svg"
_sym "${SAGITTA}/text-x-tikzcd.xml" "${SHARE}/mime/packages/text-x-tikzcd.xml" "mime/text-x-tikzcd.xml"
if (( DRY )); then
    printf '  render sagitta.desktop\n'
else
    mkdir -p "${SHARE}/applications"
    grep -v '^[[:space:]]*#' "${SAGITTA}/sagitta.desktop.in" \
        | sed -e "s|@BIN@|${BIN}|g" \
        > "${SHARE}/applications/sagitta.desktop"
    printf '  render sagitta.desktop\n'
    update-mime-database "${SHARE}/mime"
    update-desktop-database "${SHARE}/applications"
    xdg-mime default sagitta.desktop text/x-tikzcd
fi

# ── Dependencies ──────────────────────────────────────────────────────────────
# Reported, not installed. The launcher looks in this order too.

printf '\nDependencies:\n'
if [[ -n "${SAGITTA_ELECTRON:-}" ]] && command -v "$SAGITTA_ELECTRON" >/dev/null; then
    printf '  ok   %s (SAGITTA_ELECTRON)\n' "$SAGITTA_ELECTRON"
elif command -v electron43 >/dev/null; then
    printf '  ok   electron43\n'
elif command -v electron >/dev/null; then
    printf '  ok   electron (%s)\n' "$(electron --version 2>/dev/null)"
elif [[ -x "${SAGITTA}/node_modules/.bin/electron" ]]; then
    printf '  ok   electron (node_modules)\n'
else
    printf '  MISSING electron: install electron43, or run npm install in %s\n' "$SAGITTA"
fi

printf '\nDone. Run sagitta for an empty diagram; C-/ lists the keys.\n'
