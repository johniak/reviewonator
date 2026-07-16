#!/bin/sh
set -eu

BIN_DIR=${REVIEWONATOR_BIN_DIR:-"$HOME/.local/bin"}
SKILL_ROOT=${REVIEWONATOR_SKILL_DIR:-"$HOME/.claude/skills"}
REPOSITORY=${REVIEWONATOR_REPOSITORY:-}
COMMENT_LANGUAGE=${REVIEWONATOR_COMMENT_LANGUAGE:-}
REVIEWER_LANGUAGE=${REVIEWONATOR_REVIEWER_LANGUAGE:-}
LOCAL_BUILD=false
FORCE=false
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
TEMP_DIR=""

usage() {
  printf '%s\n' "Usage: install.sh [--bin-dir DIR] [--skill-dir DIR] [--repository OWNER/REPO] [--comment-language LANGUAGE] [--reviewer-language LANGUAGE] [--local] [--force]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir) BIN_DIR=$2; shift 2 ;;
    --skill-dir) SKILL_ROOT=$2; shift 2 ;;
    --repository) REPOSITORY=$2; shift 2 ;;
    --comment-language) COMMENT_LANGUAGE=$2; shift 2 ;;
    --reviewer-language) REVIEWER_LANGUAGE=$2; shift 2 ;;
    --local) LOCAL_BUILD=true; shift ;;
    --force) FORCE=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' "GitHub CLI is required. Install it from https://cli.github.com/" >&2
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

installed_language() {
  pattern=$1
  if [ -f "$SKILL_PATH/references/languages.md" ]; then
    sed -n "s/^$pattern in \\(.*\\)\\.$/\\1/p" "$SKILL_PATH/references/languages.md" | head -n 1
  fi
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

COMMENT_DEFAULT=$(installed_language '- Write public pull request comments and the review summary')
REVIEWER_DEFAULT=$(installed_language '- Write private reviewer explanations')
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
  mkdir -p "$SKILL_PATH/references"
  {
    printf '%s\n\n' "# Review languages"
    printf -- '- Write public pull request comments and the review summary in %s.\n' "$COMMENT_LANGUAGE"
    printf -- '- Write private reviewer explanations in %s.\n' "$REVIEWER_LANGUAGE"
    printf '%s\n' '- Use natural equivalents of `What:` and `Why:` in the reviewer-note language.'
  } > "$SKILL_PATH/references/languages.md"
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

  if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ] && [ "$FORCE" = false ] && [ -f "$SKILL_PATH/SKILL.md" ]; then
    write_language_config
    printf 'Reviewonator %s is already up to date.\n' "$INSTALLED_VERSION"
    printf 'GitHub comment language: %s\n' "$COMMENT_LANGUAGE"
    printf 'Private reviewer note language: %s\n' "$REVIEWER_LANGUAGE"
    exit 0
  fi
  if [ -n "$INSTALLED_VERSION" ] && version_is_newer "$INSTALLED_VERSION" "$LATEST_VERSION" && [ "$FORCE" = false ]; then
    if [ -f "$SKILL_PATH/SKILL.md" ]; then
      write_language_config
    fi
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

mkdir -p "$BIN_DIR" "$SKILL_ROOT"
install -m 755 "$BINARY_SOURCE" "$BIN_PATH"
printf '%s\n' "Installed by Reviewonator" > "$BIN_MARKER"
if [ -d "$SKILL_PATH" ]; then rm -rf "$SKILL_PATH"; fi
cp -R "$SKILL_SOURCE" "$SKILL_PATH"
write_language_config
printf '%s\n' "Installed by Reviewonator" > "$SKILL_MARKER"

printf 'Installed Reviewonator executable: %s\n' "$BIN_PATH"
printf 'Installed Claude Code skill: %s\n' "$SKILL_PATH"
printf 'GitHub comment language: %s\n' "$COMMENT_LANGUAGE"
printf 'Private reviewer note language: %s\n' "$REVIEWER_LANGUAGE"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH before using /reviewonator.\n' "$BIN_DIR" ;;
esac
