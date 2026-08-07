#!/usr/bin/env bash
# ============================================================
# L2L — Runtime launcher
# The packaged app ships a SUID chrome-sandbox helper that must
# be owned by root with mode 4755 to be used. For a user-level
# install (~/.local/share) that is impossible, so when the helper
# is missing or not configured correctly we fall back to
# --no-sandbox (same policy as the dev launcher in launch.js).
# If the helper IS properly set up, the full sandbox stays on.
# ============================================================
set -euo pipefail

DIR="$(dirname "$(readlink -f "$0")")"
BIN="$DIR/l2l-converter"
SB="$DIR/chrome-sandbox"

needs_no_sandbox=1
if [[ -f "$SB" ]]; then
  owner="$(stat -c '%U' "$SB" 2>/dev/null || echo nobody)"
  mode="$(stat -c '%a' "$SB" 2>/dev/null || echo 0000)"
  if [[ "$owner" == "root" && "$mode" == "4755" ]]; then
    needs_no_sandbox=0
  fi
fi

if [[ "$needs_no_sandbox" == "1" ]]; then
  exec "$BIN" --no-sandbox "$@"
fi
exec "$BIN" "$@"
