#!/bin/sh
set -eu

BIN_DIR=${REVIEWONATOR_BIN_DIR:-"$HOME/.local/bin"}
CLAUDE_SKILL_ROOT=${REVIEWONATOR_CLAUDE_SKILL_DIR:-${REVIEWONATOR_SKILL_DIR:-"$HOME/.claude/skills"}}
CODEX_SKILL_ROOT=${REVIEWONATOR_CODEX_SKILL_DIR:-"$HOME/.agents/skills"}
TARGETS=${REVIEWONATOR_TARGETS:-}
REPOSITORY=${REVIEWONATOR_REPOSITORY:-}
COMMENT_LANGUAGE=${REVIEWONATOR_COMMENT_LANGUAGE:-}
REVIEWER_LANGUAGE=${REVIEWONATOR_REVIEWER_LANGUAGE:-}
LOCAL_BUILD=false
FORCE=false
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
TEMP_DIR=""

usage() {
  printf '%s\n' "Usage: install.sh [--targets claude,codex] [--bin-dir DIR] [--claude-skill-dir DIR] [--codex-skill-dir DIR] [--repository OWNER/REPO] [--comment-language LANGUAGE] [--reviewer-language LANGUAGE] [--local] [--force]"
  printf '%s\n' "       --skill-dir DIR is kept as an alias for --claude-skill-dir DIR."
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir) BIN_DIR=$2; shift 2 ;;
    --skill-dir) CLAUDE_SKILL_ROOT=$2; shift 2 ;;
    --claude-skill-dir) CLAUDE_SKILL_ROOT=$2; shift 2 ;;
    --codex-skill-dir) CODEX_SKILL_ROOT=$2; shift 2 ;;
    --targets) TARGETS=$2; shift 2 ;;
    --repository) REPOSITORY=$2; shift 2 ;;
    --comment-language) COMMENT_LANGUAGE=$2; shift 2 ;;
    --reviewer-language) REVIEWER_LANGUAGE=$2; shift 2 ;;
    --local) LOCAL_BUILD=true; shift ;;
    --force) FORCE=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

choose_targets() {
  if [ -n "$TARGETS" ]; then
    return
  fi
  if [ -t 0 ] || [ "${REVIEWONATOR_INTERACTIVE:-}" = "1" ]; then
    printf '%s\n' "Install the Reviewonator skill for:" >&2
    printf '%s\n' "  1) Claude Code" >&2
    printf '%s\n' "  2) Codex" >&2
    printf '%s' "Select one or more targets (comma-separated, for example 1,2): " >&2
    IFS= read -r TARGETS || TARGETS=""
  else
    printf '%s\n' "No installation target was provided. Pass --targets claude, --targets codex, or --targets claude,codex." >&2
    exit 2
  fi
}

parse_targets() {
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
      *)
        printf 'Unknown installation target: %s. Use claude, codex, or both.\n' "$target" >&2
        exit 2
        ;;
    esac
  done
  if [ "$SELECT_CLAUDE" = false ] && [ "$SELECT_CODEX" = false ]; then
    printf '%s\n' "Select at least one installation target." >&2
    exit 2
  fi
}

choose_targets
parse_targets

if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' "GitHub CLI is required. Install it from https://cli.github.com/" >&2
  exit 1
fi

BIN_PATH="$BIN_DIR/reviewonator"
BIN_MARKER="$BIN_PATH.reviewonator-managed"

if [ -e "$BIN_PATH" ] && [ ! -f "$BIN_MARKER" ]; then
  printf 'Refusing to replace unmanaged executable: %s\n' "$BIN_PATH" >&2
  exit 1
fi
check_skill_target() {
  skill_path="$1/reviewonator"
  if [ -e "$skill_path" ] && [ ! -f "$skill_path/.reviewonator-managed" ]; then
    printf 'Refusing to replace unmanaged skill: %s\n' "$skill_path" >&2
    exit 1
  fi
}

if [ "$SELECT_CLAUDE" = true ]; then check_skill_target "$CLAUDE_SKILL_ROOT"; fi
if [ "$SELECT_CODEX" = true ]; then check_skill_target "$CODEX_SKILL_ROOT"; fi

installed_language() {
  kind=$1
  value=""
  if [ "$SELECT_CLAUDE" = true ]; then
    value=$(installed_language_from "$kind" "$CLAUDE_SKILL_ROOT/reviewonator")
  fi
  if [ -z "$value" ] && [ "$SELECT_CODEX" = true ]; then
    value=$(installed_language_from "$kind" "$CODEX_SKILL_ROOT/reviewonator")
  fi
  printf '%s' "$value"
}

installed_language_from() {
  kind=$1
  skill_path=$2
  value=""
  if [ -f "$skill_path/SKILL.md" ]; then
    case "$kind" in
      comments)
        value=$(sed -n 's/^Review language configuration: write public pull request comments and the review summary in \(.*\); write private reviewer explanations in .*\.$/\1/p' "$skill_path/SKILL.md" | head -n 1)
        ;;
      reviewer)
        value=$(sed -n 's/^Review language configuration: .*; write private reviewer explanations in \(.*\)\.$/\1/p' "$skill_path/SKILL.md" | head -n 1)
        ;;
    esac
  fi
  if [ -z "$value" ] && [ -f "$skill_path/references/languages.md" ]; then
    case "$kind" in
      comments) pattern='- Write public pull request comments and the review summary' ;;
      reviewer) pattern='- Write private reviewer explanations' ;;
    esac
    value=$(sed -n "s/^$pattern in \\(.*\\)\\.$/\\1/p" "$skill_path/references/languages.md" | head -n 1)
  fi
  printf '%s' "$value"
}

choose_language() {
  prompt=$1
  default=$2
  configured=$3
  if [ -n "$configured" ]; then
    printf '%s' "$configured"
    return
  fi
  answer=""
  if [ -t 0 ] || [ "${REVIEWONATOR_INTERACTIVE:-}" = "1" ]; then
    printf '%s [%s]: ' "$prompt" "$default" >&2
    IFS= read -r answer || answer=""
  fi
  printf '%s' "${answer:-$default}"
}

COMMENT_DEFAULT=$(installed_language comments)
REVIEWER_DEFAULT=$(installed_language reviewer)
COMMENT_LANGUAGE=$(choose_language "Language for comments published to GitHub" "${COMMENT_DEFAULT:-English}" "$COMMENT_LANGUAGE")
REVIEWER_LANGUAGE=$(choose_language "Language for private reviewer notes" "${REVIEWER_DEFAULT:-English}" "$REVIEWER_LANGUAGE")

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT INT TERM

normalize_repository() {
  printf '%s' "$1" | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##'
}

detect_repository() {
  if [ -n "$REPOSITORY" ]; then
    normalize_repository "$REPOSITORY"
    return
  fi
  if command -v git >/dev/null 2>&1 && git -C "$PROJECT_DIR" remote get-url origin >/dev/null 2>&1; then
    normalize_repository "$(git -C "$PROJECT_DIR" remote get-url origin)"
    return
  fi
  printf '%s\n' "Cannot determine the GitHub repository. Pass --repository OWNER/REPO." >&2
  exit 1
}

platform_name() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

binary_version() {
  "$1" --version 2>/dev/null | sed -n 's/^Reviewonator \([0-9][0-9.]*\)$/\1/p' | head -n 1
}

version_is_newer() {
  awk -v left="$1" -v right="$2" 'BEGIN {
    split(left, a, "."); split(right, b, ".");
    for (i = 1; i <= 3; i++) {
      if ((a[i] + 0) > (b[i] + 0)) exit 0;
      if ((a[i] + 0) < (b[i] + 0)) exit 1;
    }
    exit 1;
  }'
}

write_language_config() {
  skill_path=$1
  configured_line="Review language configuration: write public pull request comments and the review summary in $COMMENT_LANGUAGE; write private reviewer explanations in $REVIEWER_LANGUAGE."
  temporary_skill="$skill_path/.SKILL.md.reviewonator.tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "Review language configuration:"*|"Read [references/languages.md](references/languages.md) before producing review text and follow the installed language configuration throughout the review.")
        printf '%s\n' "$configured_line"
        ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$skill_path/SKILL.md" > "$temporary_skill"
  if ! grep -Fqx "$configured_line" "$temporary_skill"; then
    rm -f "$temporary_skill"
    printf '%s\n' "The Reviewonator skill is missing its language configuration marker." >&2
    exit 1
  fi
  mv "$temporary_skill" "$skill_path/SKILL.md"
  rm -f "$skill_path/references/languages.md"
}

skills_are_installed() {
  if [ "$SELECT_CLAUDE" = true ] && [ ! -f "$CLAUDE_SKILL_ROOT/reviewonator/SKILL.md" ]; then return 1; fi
  if [ "$SELECT_CODEX" = true ] && [ ! -f "$CODEX_SKILL_ROOT/reviewonator/SKILL.md" ]; then return 1; fi
  return 0
}

configure_installed_skills() {
  if [ "$SELECT_CLAUDE" = true ]; then write_language_config "$CLAUDE_SKILL_ROOT/reviewonator"; fi
  if [ "$SELECT_CODEX" = true ] && { [ "$SELECT_CLAUDE" = false ] || [ "$CODEX_SKILL_ROOT" != "$CLAUDE_SKILL_ROOT" ]; }; then
    write_language_config "$CODEX_SKILL_ROOT/reviewonator"
  fi
}

if [ "$LOCAL_BUILD" = true ]; then
  if [ ! -x "$PROJECT_DIR/dist/reviewonator" ] || [ ! -f "$PROJECT_DIR/skills/reviewonator/SKILL.md" ]; then
    printf '%s\n' "A local build is not available. Run bun run build first or omit --local." >&2
    exit 1
  fi
  BINARY_SOURCE="$PROJECT_DIR/dist/reviewonator"
  SKILL_SOURCE="$PROJECT_DIR/skills/reviewonator"
  printf '%s\n' "Installing the local Reviewonator build…"
else
  REPOSITORY=$(detect_repository)
  LATEST_TAG=$(gh release view --repo "$REPOSITORY" --json tagName --jq .tagName)
  if ! printf '%s' "$LATEST_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
    printf 'Latest release has an unsupported version tag: %s\n' "$LATEST_TAG" >&2
    exit 1
  fi
  LATEST_VERSION=${LATEST_TAG#v}
  INSTALLED_VERSION=""
  if [ -x "$BIN_PATH" ]; then
    INSTALLED_VERSION=$(binary_version "$BIN_PATH")
  fi

  if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ] && [ "$FORCE" = false ] && skills_are_installed; then
    configure_installed_skills
    printf 'Reviewonator %s is already up to date.\n' "$INSTALLED_VERSION"
    printf 'GitHub comment language: %s\n' "$COMMENT_LANGUAGE"
    printf 'Private reviewer note language: %s\n' "$REVIEWER_LANGUAGE"
    exit 0
  fi
  if [ -n "$INSTALLED_VERSION" ] && version_is_newer "$INSTALLED_VERSION" "$LATEST_VERSION" && [ "$FORCE" = false ]; then
    if skills_are_installed; then configure_installed_skills; fi
    printf 'Installed Reviewonator %s is newer than the latest release %s; keeping it. Use --force to replace it.\n' "$INSTALLED_VERSION" "$LATEST_VERSION"
    printf 'GitHub comment language: %s\n' "$COMMENT_LANGUAGE"
    printf 'Private reviewer note language: %s\n' "$REVIEWER_LANGUAGE"
    exit 0
  fi

  PLATFORM=$(platform_name)
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/reviewonator-install.XXXXXX")
  ARCHIVE="reviewonator-$PLATFORM.tar.gz"
  if [ -n "$INSTALLED_VERSION" ]; then
    printf 'Updating Reviewonator %s to %s…\n' "$INSTALLED_VERSION" "$LATEST_VERSION"
  elif [ -e "$BIN_PATH" ]; then
    printf 'Updating the installed Reviewonator to %s…\n' "$LATEST_VERSION"
  else
    printf 'Installing Reviewonator %s…\n' "$LATEST_VERSION"
  fi
  gh release download "$LATEST_TAG" --repo "$REPOSITORY" --pattern "$ARCHIVE" --dir "$TEMP_DIR"
  tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"
  BINARY_SOURCE="$TEMP_DIR/reviewonator"
  SKILL_SOURCE="$TEMP_DIR/reviewonator-skill"
fi

if [ ! -x "$BINARY_SOURCE" ] || [ ! -f "$SKILL_SOURCE/SKILL.md" ]; then
  printf '%s\n' "The installation payload is incomplete." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
install -m 755 "$BINARY_SOURCE" "$BIN_PATH"
printf '%s\n' "Installed by Reviewonator" > "$BIN_MARKER"

install_skill() {
  label=$1
  skill_root=$2
  skill_path="$skill_root/reviewonator"
  mkdir -p "$skill_root"
  if [ -d "$skill_path" ]; then rm -rf "$skill_path"; fi
  cp -R "$SKILL_SOURCE" "$skill_path"
  write_language_config "$skill_path"
  printf '%s\n' "Installed by Reviewonator" > "$skill_path/.reviewonator-managed"
  printf 'Installed %s skill: %s\n' "$label" "$skill_path"
}

printf 'Installed Reviewonator executable: %s\n' "$BIN_PATH"
if [ "$SELECT_CLAUDE" = true ]; then install_skill "Claude Code" "$CLAUDE_SKILL_ROOT"; fi
if [ "$SELECT_CODEX" = true ] && { [ "$SELECT_CLAUDE" = false ] || [ "$CODEX_SKILL_ROOT" != "$CLAUDE_SKILL_ROOT" ]; }; then
  install_skill "Codex" "$CODEX_SKILL_ROOT"
fi
printf 'GitHub comment language: %s\n' "$COMMENT_LANGUAGE"
printf 'Private reviewer note language: %s\n' "$REVIEWER_LANGUAGE"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH before using /reviewonator.\n' "$BIN_DIR" ;;
esac
