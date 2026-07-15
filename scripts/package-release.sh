#!/bin/sh
set -eu

usage() {
  printf '%s\n' "Usage: package-release.sh PLATFORM BINARY [OUTPUT_DIR]"
  printf '%s\n' "Platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64"
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  usage >&2
  exit 2
fi

PLATFORM=$1
BINARY_SOURCE=$2
OUTPUT_DIR=${3:-release}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

case "$PLATFORM" in
  darwin-arm64|darwin-x64|linux-arm64|linux-x64) ;;
  *)
    printf 'Unsupported platform: %s\n' "$PLATFORM" >&2
    usage >&2
    exit 2
    ;;
esac

if [ ! -x "$BINARY_SOURCE" ]; then
  printf 'Executable does not exist or is not executable: %s\n' "$BINARY_SOURCE" >&2
  exit 1
fi

for required in "$PROJECT_DIR/skills/reviewonator/SKILL.md" "$PROJECT_DIR/LICENSE" "$PROJECT_DIR/THIRD_PARTY_NOTICES.md"; do
  if [ ! -f "$required" ]; then
    printf 'Required release file is missing: %s\n' "$required" >&2
    exit 1
  fi
done

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/reviewonator-release.XXXXXX")
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

PAYLOAD_DIR="$TEMP_DIR/payload"
ARCHIVE_NAME="reviewonator-$PLATFORM.tar.gz"
LICENSE_DIR="$PAYLOAD_DIR/third-party-licenses"
mkdir -p "$PAYLOAD_DIR" "$LICENSE_DIR" "$OUTPUT_DIR"
install -m 755 "$BINARY_SOURCE" "$PAYLOAD_DIR/reviewonator"
cp -R "$PROJECT_DIR/skills/reviewonator" "$PAYLOAD_DIR/reviewonator-skill"
cp "$PROJECT_DIR/LICENSE" "$PROJECT_DIR/THIRD_PARTY_NOTICES.md" "$PAYLOAD_DIR/"

copy_dependency_license() {
  package=$1
  source=$2
  destination=$3
  if [ ! -f "$PROJECT_DIR/node_modules/$package/$source" ]; then
    printf 'Dependency license is missing for %s. Run bun install first.\n' "$package" >&2
    exit 1
  fi
  cp "$PROJECT_DIR/node_modules/$package/$source" "$LICENSE_DIR/$destination"
}

copy_dependency_license "@pierre/diffs" "LICENSE.md" "pierre-diffs-Apache-2.0.txt"
copy_dependency_license "@radix-ui/react-dialog" "LICENSE" "radix-ui-MIT.txt"
copy_dependency_license "clsx" "license" "clsx-MIT.txt"
copy_dependency_license "hono" "LICENSE" "hono-MIT.txt"
copy_dependency_license "lucide-react" "LICENSE" "lucide-react-ISC-and-MIT.txt"
copy_dependency_license "react" "LICENSE" "react-MIT.txt"
copy_dependency_license "react-dom" "LICENSE" "react-dom-MIT.txt"
copy_dependency_license "tailwind-merge" "LICENSE.md" "tailwind-merge-MIT.txt"
copy_dependency_license "zod" "LICENSE" "zod-MIT.txt"

tar -czf "$OUTPUT_DIR/$ARCHIVE_NAME" -C "$PAYLOAD_DIR" .

if command -v shasum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && shasum -a 256 "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256")
else
  printf '%s\n' "A SHA-256 checksum utility (shasum or sha256sum) is required." >&2
  exit 1
fi

printf 'Created %s and its SHA-256 checksum.\n' "$OUTPUT_DIR/$ARCHIVE_NAME"
