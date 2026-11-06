#!/bin/sh
# Reviewonator installer.
#   sh -c "$(curl -fsSL https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"
#   sh -c "$(wget -qO- https://github.com/johniak/reviewonator/releases/latest/download/install.sh)"
# Every option other than --bin-dir, --force and --local is passed to `reviewonator setup`.
set -eu

REPOSITORY="johniak/reviewonator"
DOWNLOAD_URL=${REVIEWONATOR_DOWNLOAD_URL:-"https://github.com/$REPOSITORY/releases/latest/download"}
BIN_DIR=${REVIEWONATOR_BIN_DIR:-"$HOME/.local/bin"}
LOCAL_BUILD=false
FORCE=false
TEMP_DIR=""
STAGED=""

usage() {
  printf '%s\n' "Usage: install.sh [--bin-dir DIR] [--force] [--local] [reviewonator setup options]"
  printf '%s\n' "Setup options: --targets claude,codex --comment-language LANGUAGE --reviewer-language LANGUAGE --mode full|early"
  printf '%s\n' "               --claude-skill-dir DIR --codex-skill-dir DIR --reconfigure"
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

take_bin_dir=false
for argument do
  shift
  if [ "$take_bin_dir" = true ]; then
    BIN_DIR=$argument
    take_bin_dir=false
    continue
  fi
  case "$argument" in
    --bin-dir) take_bin_dir=true ;;
    --bin-dir=*) BIN_DIR=${argument#--bin-dir=} ;;
    --force) FORCE=true ;;
    --local) LOCAL_BUILD=true ;;
    --help|-h) usage; exit 0 ;;
    *) set -- "$@" "$argument" ;;
  esac
done
if [ "$take_bin_dir" = true ]; then
  usage >&2
  exit 2
fi

BIN_PATH="$BIN_DIR/reviewonator"
BIN_MARKER="$BIN_PATH.reviewonator-managed"

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then rm -rf "$TEMP_DIR"; fi
  if [ -n "$STAGED" ]; then rm -f "$STAGED"; fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' "GitHub CLI is required to use Reviewonator. Install it from https://cli.github.com/" >&2
fi

platform_name() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "Unsupported operating system: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1" || fail "Could not download $1."
  else
    wget -qO "$2" "$1" || fail "Could not download $1."
  fi
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    sha256sum "$1" | awk '{ print $1 }'
  fi
}

binary_version() {
  "$1" --version 2>/dev/null | sed -n 's/^Reviewonator \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$/\1/p' | head -n 1
}

# Asks only a person at a terminal (or a test that sets REVIEWONATOR_INTERACTIVE=1).
confirm() {
  if [ -t 0 ] || [ "${REVIEWONATOR_INTERACTIVE:-}" = "1" ]; then
    printf '%s' "$1" >&2
    answer=""
    read -r answer || true
    case "$answer" in
      [yY]|[yY][eE][sS]) return 0 ;;
    esac
  fi
  return 1
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

# A reviewonator without the marker was put here some other way. Replace it only when it
# is Reviewonator and the person agrees, or passes --force.
if [ -e "$BIN_PATH" ] && [ ! -f "$BIN_MARKER" ]; then
  UNMANAGED_VERSION=$(binary_version "$BIN_PATH")
  if [ -z "$UNMANAGED_VERSION" ]; then
    fail "Refusing to replace unmanaged executable: $BIN_PATH"
  fi
  if [ "$FORCE" = false ] \
    && ! confirm "Replace Reviewonator $UNMANAGED_VERSION at $BIN_PATH, which this script did not install? [y/N] "; then
    fail "Kept the Reviewonator executable at $BIN_PATH. Remove it, or run this script again with --force to replace it."
  fi
  FORCE=true
fi

if [ "$LOCAL_BUILD" = true ]; then
  SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  BINARY_SOURCE="$(dirname "$SCRIPT_DIR")/dist/reviewonator"
  if [ ! -x "$BINARY_SOURCE" ]; then
    fail "A local build is not available. Run bun run build first or omit --local."
  fi
  FORCE=true
else
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    fail "curl or wget is required to install Reviewonator."
  fi
  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    fail "A SHA-256 checksum utility (shasum or sha256sum) is required."
  fi
  ARCHIVE="reviewonator-$(platform_name).tar.gz"
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/reviewonator-install.XXXXXX")
  download "$DOWNLOAD_URL/$ARCHIVE" "$TEMP_DIR/$ARCHIVE"
  download "$DOWNLOAD_URL/$ARCHIVE.sha256" "$TEMP_DIR/$ARCHIVE.sha256"
  expected=$(awk '{ print $1; exit }' "$TEMP_DIR/$ARCHIVE.sha256")
  actual=$(sha256_of "$TEMP_DIR/$ARCHIVE")
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    fail "Checksum verification failed for $ARCHIVE."
  fi
  mkdir "$TEMP_DIR/payload"
  tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR/payload"
  BINARY_SOURCE="$TEMP_DIR/payload/reviewonator"
  if [ ! -x "$BINARY_SOURCE" ]; then
    fail "The installation payload is incomplete."
  fi
fi

# Stage next to the destination: the temporary directory may be mounted noexec,
# and a rename within one directory replaces the executable atomically.
mkdir -p "$BIN_DIR"
STAGED="$BIN_DIR/.reviewonator-install.$$"
install -m 755 "$BINARY_SOURCE" "$STAGED"
NEW_VERSION=$(binary_version "$STAGED")
if [ -z "$NEW_VERSION" ]; then
  fail "Could not read the version of the downloaded Reviewonator executable."
fi
# The installer run last wins: remove a Homebrew installation only once the new executable is ready.
if command -v brew >/dev/null 2>&1 && brew list --formula --versions reviewonator >/dev/null 2>&1; then
  printf '%s\n' "Removing the Homebrew installation of Reviewonator: brew uninstall --formula --force reviewonator"
  brew uninstall --formula --force reviewonator \
    || fail "Could not remove the Homebrew installation of Reviewonator. Run brew uninstall reviewonator, then run this script again."
fi

INSTALLED_VERSION=""
if [ -x "$BIN_PATH" ]; then
  INSTALLED_VERSION=$(binary_version "$BIN_PATH")
fi

if [ "$FORCE" = false ] && [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" = "$NEW_VERSION" ]; then
  printf 'Reviewonator %s is already up to date.\n' "$INSTALLED_VERSION"
elif [ "$FORCE" = false ] && [ -n "$INSTALLED_VERSION" ] && version_is_newer "$INSTALLED_VERSION" "$NEW_VERSION"; then
  printf 'Installed Reviewonator %s is newer than the latest release %s; keeping it. Use --force to replace it.\n' \
    "$INSTALLED_VERSION" "$NEW_VERSION"
else
  if [ -n "$INSTALLED_VERSION" ]; then
    printf 'Updating Reviewonator %s to %s…\n' "$INSTALLED_VERSION" "$NEW_VERSION"
  elif [ -e "$BIN_PATH" ]; then
    printf 'Updating the installed Reviewonator to %s…\n' "$NEW_VERSION"
  else
    printf 'Installing Reviewonator %s…\n' "$NEW_VERSION"
  fi
  mv -f "$STAGED" "$BIN_PATH"
  STAGED=""
  printf '%s\n' "Installed by Reviewonator" > "$BIN_MARKER"
  printf 'Installed Reviewonator executable: %s\n' "$BIN_PATH"
fi

"$BIN_PATH" setup "$@"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH before using /reviewonator.\n' "$BIN_DIR" ;;
esac
