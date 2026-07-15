#!/bin/sh
set -eu

BIN_DIR=${REVIEWONATOR_BIN_DIR:-"$HOME/.local/bin"}
SKILL_ROOT=${REVIEWONATOR_SKILL_DIR:-"$HOME/.claude/skills"}

usage() {
  printf '%s\n' "Usage: uninstall.sh [--bin-dir DIR] [--skill-dir DIR]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir) BIN_DIR=$2; shift 2 ;;
    --skill-dir) SKILL_ROOT=$2; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

BIN_PATH="$BIN_DIR/reviewonator"
BIN_MARKER="$BIN_PATH.reviewonator-managed"
SKILL_PATH="$SKILL_ROOT/reviewonator"
SKILL_MARKER="$SKILL_PATH/.reviewonator-managed"

if [ -f "$BIN_MARKER" ]; then
  rm -f "$BIN_PATH" "$BIN_MARKER"
  printf 'Removed Reviewonator executable: %s\n' "$BIN_PATH"
elif [ -e "$BIN_PATH" ]; then
  printf 'Kept unmanaged executable: %s\n' "$BIN_PATH"
fi

if [ -f "$SKILL_MARKER" ]; then
  rm -rf "$SKILL_PATH"
  printf 'Removed Claude Code skill: %s\n' "$SKILL_PATH"
elif [ -e "$SKILL_PATH" ]; then
  printf 'Kept unmanaged skill: %s\n' "$SKILL_PATH"
fi
