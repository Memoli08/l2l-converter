#!/usr/bin/env bash
# ============================================================
# L2L — One-click Linux installer
# Installs the FUSE-free unpacked app + registers an
# "L2L Converter" launcher with icon in the app menu.
#   ./scripts/install-linux.sh
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d release/linux-unpacked ]]; then
  echo "No packaged app found. Build it first: npm run dist:linux"
  exit 1
fi

INSTALL_DIR="$HOME/.local/share/l2l-converter"
BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON_FILE="$ICON_DIR/l2l-converter-v2.png"
APP_DIRS_DIR="$HOME/.local/share/applications"

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$ICON_DIR" "$APP_DIRS_DIR"

echo "Installing unpacked app → $INSTALL_DIR/app"
# Verify checksum if manifest exists
if [[ -f release/SHA256SUMS.txt ]]; then
  echo "Verifying checksums..."
  (cd release && sha256sum -c --ignore-missing SHA256SUMS.txt) || { echo "Checksum verification failed — aborting install." >&2; exit 1; }
fi
rm -rf "$INSTALL_DIR/app"
cp -r release/linux-unpacked "$INSTALL_DIR/app"
chmod +x "$INSTALL_DIR/app/l2l-converter"

# sandbox-aware launcher (fixes app menu not opening when SUID sandbox is unavailable)
cp scripts/l2l-launcher.sh "$INSTALL_DIR/app/l2l-launcher"
chmod +x "$INSTALL_DIR/app/l2l-launcher"

# portable single-file launcher (no FUSE needed — AppImage requires FUSE
# which is often missing on Ubuntu 24.04+, so we ship a plain launcher that
# execs the unpacked app directly)
cat > "$BIN_DIR/l2l-converter" <<EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/app/l2l-launcher" "\$@"
EOF
chmod +x "$BIN_DIR/l2l-converter"
echo "Also installing portable launcher → $BIN_DIR/l2l-converter"

if [[ -f assets/icon.png ]]; then
  # Use a versioned filename so desktop environments cannot reuse the
  # previous cached icon under the old l2l-converter.png path.
  cp assets/icon.png "$ICON_FILE"
  ICON_PATH="$ICON_FILE"
else
  ICON_PATH="applications-utilities"
fi

cat > "$APP_DIRS_DIR/l2l-converter.desktop" <<EOF
[Desktop Entry]
Name=L2L Converter
Comment=Local batch file converter — images, video, audio, documents
Exec="$INSTALL_DIR/app/l2l-launcher"
Icon=$ICON_PATH
Terminal=false
Type=Application
Categories=Utility;
StartupWMClass=l2l-converter
EOF

chmod +x "$APP_DIRS_DIR/l2l-converter.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APP_DIRS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1 && [[ -d "$HOME/.local/share/icons/hicolor" ]]; then
  gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

echo ""
echo "✅ Installed! 'L2L Converter' is now in your app menu."
echo "   (Or run it directly: $INSTALL_DIR/app/l2l-converter)"
echo ""
