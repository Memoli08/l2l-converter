#!/usr/bin/env bash
# Create a checksum manifest for the artifacts that will be uploaded to GitHub.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"

if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "No release directory found. Run a dist:* command first." >&2
  exit 1
fi

cd "$RELEASE_DIR"
mapfile -t artifacts < <(find . -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.zip' -o -name '*.exe' -o -name '*.dmg' \) -printf '%f\n' | sort)

if [[ ${#artifacts[@]} -eq 0 ]]; then
  echo "No release artifacts found." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${artifacts[@]}" > SHA256SUMS.txt
else
  shasum -a 256 "${artifacts[@]}" > SHA256SUMS.txt
fi

echo "Wrote $RELEASE_DIR/SHA256SUMS.txt"
cat SHA256SUMS.txt

# Optional: verify if gpg is available and a signing key is configured
if command -v gpg >/dev/null 2>&1 && [[ -n "${L2L_GPG_KEY:-}" ]]; then
  echo "Signing SHA256SUMS.txt with GPG key $L2L_GPG_KEY..."
  gpg --local-user "$L2L_GPG_KEY" --armor --detach-sign SHA256SUMS.txt
  echo "Wrote $RELEASE_DIR/SHA256SUMS.txt.asc (detached GPG signature)"
elif command -v gpg >/dev/null 2>&1; then
  echo "Note: set L2L_GPG_KEY env var to also create a GPG detached signature." >&2
fi
