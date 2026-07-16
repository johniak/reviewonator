#!/bin/sh
set -eu

BIN_DIR=${REVIEWONATOR_BIN_DIR:-"$HOME/.local/bin"}
SKILL_ROOT=${REVIEWONATOR_SKILL_DIR:-"$HOME/.claude/skills"}
REPOSITORY=${REVIEWONATOR_REPOSITORY:-}
COMMENT_LANGUAGE=${REVIEWONATOR_COMMENT_LANGUAGE:-}
REVIEWER_LANGUAGE=${REVIEWONATOR_REVIEWER_LANGUAGE:-}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
TEMP_DIR=""

usage() {
  printf '%s\n' "Usage: install.sh [--bin-dir DIR] [--skill-dir DIR] [--repository OWNER/REPO] [--comment-language LANGUAGE] [--reviewer-language LANGUAGE]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir) BIN_DIR=$2; shift 2 ;;
    --skill-dir) SKILL_ROOT=$2; shift 2 ;;
    --repository) REPOSITORY=$2; shift 2 ;;
    --comment-language) COMMENT_LANGUAGE=$2; shift 2 ;;
    --reviewer-language) REVIEWER_LANGUAGE=$2; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' "GitHub CLI is required. Install it from https://cli.github.com/" >&2
  exit 1
fi

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

COMMENT_LANGUAGE=$(choose_language "Language for comments published to GitHub" "English" "$COMMENT_LANGUAGE")
REVIEWER_LANGUAGE=$(choose_language "Language for private reviewer notes" "English" "$REVIEWER_LANGUAGE")

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

if [ -x "$PROJECT_DIR/dist/reviewonator" ] && [ -f "$PROJECT_DIR/skills/reviewonator/SKILL.md" ]; then
  BINARY_SOURCE="$PROJECT_DIR/dist/reviewonator"
  SKILL_SOURCE="$PROJECT_DIR/skills/reviewonator"
else
  REPOSITORY=$(detect_repository)
  PLATFORM=$(platform_name)
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/reviewonator-install.XXXXXX")
  ARCHIVE="reviewonator-$PLATFORM.tar.gz"
  printf 'Downloading the latest Reviewonator release from %s…\n' "$REPOSITORY"
  gh release download --repo "$REPOSITORY" --pattern "$ARCHIVE" --dir "$TEMP_DIR"
  tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"
  BINARY_SOURCE="$TEMP_DIR/reviewonator"
  SKILL_SOURCE="$TEMP_DIR/reviewonator-skill"
fi

if [ ! -x "$BINARY_SOURCE" ] || [ ! -f "$SKILL_SOURCE/SKILL.md" ]; then
  printf '%s\n' "The installation payload is incomplete." >&2
  exit 1
fi

BIN_PATH="$BIN_DIR/reviewonator"
BIN_MARKER="$BIN_PATH.reviewonator-managed"
SKILL_PATH="$SKILL_ROOT/reviewonator"
SKILL_MARKER="$SKILL_PATH/.reviewonator-managed"

if [ -e "$BIN_PATH" ] && [ ! -f "$BIN_MARKER" ]; then
  printf 'Refusing to replace unmanaged executable: %s\n' "$BIN_PATH" >&2
  exit 1
fi
if [ -e "$SKILL_PATH" ] && [ ! -f "$SKILL_MARKER" ]; then
  printf 'Refusing to replace unmanaged skill: %s\n' "$SKILL_PATH" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$SKILL_ROOT"
install -m 755 "$BINARY_SOURCE" "$BIN_PATH"
printf '%s\n' "Installed by Reviewonator" > "$BIN_MARKER"
if [ -d "$SKILL_PATH" ]; then rm -rf "$SKILL_PATH"; fi
cp -R "$SKILL_SOURCE" "$SKILL_PATH"
mkdir -p "$SKILL_PATH/references"
{
  printf '%s\n\n' "# Review languages"
  printf -- '- Write public pull request comments and the review summary in %s.\n' "$COMMENT_LANGUAGE"
  printf -- '- Write private reviewer explanations in %s.\n' "$REVIEWER_LANGUAGE"
  printf '%s\n' '- Use natural equivalents of `What:` and `Why:` in the reviewer-note language.'
} > "$SKILL_PATH/references/languages.md"
printf '%s\n' "Installed by Reviewonator" > "$SKILL_MARKER"

printf 'Installed Reviewonator executable: %s\n' "$BIN_PATH"
printf 'Installed Claude Code skill: %s\n' "$SKILL_PATH"
printf 'GitHub comment language: %s\n' "$COMMENT_LANGUAGE"
printf 'Private reviewer note language: %s\n' "$REVIEWER_LANGUAGE"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH before using /reviewonator.\n' "$BIN_DIR" ;;
esac
