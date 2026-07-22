#!/bin/sh
set -eu

BIN_DIR=${REVIEWONATOR_BIN_DIR:-"$HOME/.local/bin"}
CLAUDE_SKILL_ROOT=${REVIEWONATOR_CLAUDE_SKILL_DIR:-${REVIEWONATOR_SKILL_DIR:-"$HOME/.claude/skills"}}
CODEX_SKILL_ROOT=${REVIEWONATOR_CODEX_SKILL_DIR:-"$HOME/.agents/skills"}
TARGETS=${REVIEWONATOR_TARGETS:-}

usage() {
  printf '%s\n' "Usage: uninstall.sh [--targets claude,codex] [--bin-dir DIR] [--claude-skill-dir DIR] [--codex-skill-dir DIR]"
  printf '%s\n' "       --skill-dir DIR is kept as an alias for --claude-skill-dir DIR."
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir) BIN_DIR=$2; shift 2 ;;
    --skill-dir) CLAUDE_SKILL_ROOT=$2; shift 2 ;;
    --claude-skill-dir) CLAUDE_SKILL_ROOT=$2; shift 2 ;;
    --codex-skill-dir) CODEX_SKILL_ROOT=$2; shift 2 ;;
    --targets) TARGETS=$2; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$TARGETS" ]; then
  if [ -t 0 ] || [ "${REVIEWONATOR_INTERACTIVE:-}" = "1" ]; then
    printf '%s\n' "Remove the Reviewonator skill from:" >&2
    printf '%s\n' "  1) Claude Code" >&2
    printf '%s\n' "  2) Codex" >&2
    printf '%s' "Select one or more targets (comma-separated, for example 1,2): " >&2
    IFS= read -r TARGETS || TARGETS=""
  else
    printf '%s\n' "No uninstall target was provided. Pass --targets claude, --targets codex, or --targets claude,codex." >&2
    exit 2
  fi
fi

SELECT_CLAUDE=false
SELECT_CODEX=false
normalized=$(printf '%s' "$TARGETS" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
old_ifs=$IFS
IFS=,
set -- $normalized
IFS=$old_ifs
for target in "$@"; do
  case "$target" in
    1|claude|claude-code) SELECT_CLAUDE=true ;;
    2|codex) SELECT_CODEX=true ;;
    both|all) SELECT_CLAUDE=true; SELECT_CODEX=true ;;
    *) printf 'Unknown uninstall target: %s. Use claude, codex, or both.\n' "$target" >&2; exit 2 ;;
  esac
done
if [ "$SELECT_CLAUDE" = false ] && [ "$SELECT_CODEX" = false ]; then
  printf '%s\n' "Select at least one uninstall target." >&2
  exit 2
fi

BIN_PATH="$BIN_DIR/reviewonator"
BIN_MARKER="$BIN_PATH.reviewonator-managed"
remove_skill() {
  label=$1
  skill_path="$2/reviewonator"
  if [ -f "$skill_path/.reviewonator-managed" ]; then
    rm -rf "$skill_path"
    printf 'Removed %s skill: %s\n' "$label" "$skill_path"
  elif [ -e "$skill_path" ]; then
    printf 'Kept unmanaged skill: %s\n' "$skill_path"
  fi
}

if [ "$SELECT_CLAUDE" = true ]; then remove_skill "Claude Code" "$CLAUDE_SKILL_ROOT"; fi
if [ "$SELECT_CODEX" = true ] && { [ "$SELECT_CLAUDE" = false ] || [ "$CODEX_SKILL_ROOT" != "$CLAUDE_SKILL_ROOT" ]; }; then
  remove_skill "Codex" "$CODEX_SKILL_ROOT"
fi

if [ -f "$CLAUDE_SKILL_ROOT/reviewonator/.reviewonator-managed" ] || [ -f "$CODEX_SKILL_ROOT/reviewonator/.reviewonator-managed" ]; then
  printf '%s\n' "Kept Reviewonator executable because another installed integration still uses it."
elif [ -f "$BIN_MARKER" ]; then
  rm -f "$BIN_PATH" "$BIN_MARKER"
  printf 'Removed Reviewonator executable: %s\n' "$BIN_PATH"
elif [ -e "$BIN_PATH" ]; then
  printf 'Kept unmanaged executable: %s\n' "$BIN_PATH"
fi
