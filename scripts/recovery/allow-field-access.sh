#!/bin/bash
# allow-field-access.sh — macOS counterpart to allow-field-access.ps1
#
# Base serves /field over the office LAN, so this Mac has to accept inbound
# connections on the app's port. macOS's Application Firewall (unlike
# Windows Firewall) is scoped per-app, not per-port — there is no port number
# to pass here, and no per-user-installer limitation to work around either:
# this is a manual step because the firewall change itself needs admin
# rights, the same reason allow-field-access.ps1 needs an admin PowerShell.
#
# Usage:
#   sudo ./allow-field-access.sh
#   sudo ./allow-field-access.sh --app-path "/Applications/WhiteVanOps.app"
#   sudo ./allow-field-access.sh --remove

set -euo pipefail

APP_PATH="/Applications/WhiteVanOps.app"
SOCKETFILTERFW="/usr/libexec/ApplicationFirewall/socketfilterfw"
REMOVE=false

usage() {
  cat <<EOF
Usage: $0 [--app-path PATH] [--remove]

  --app-path PATH   Path to WhiteVanOps.app (default: /Applications/WhiteVanOps.app)
  --remove          Undo: remove WhiteVanOps from the firewall's allowed-apps list
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-path) APP_PATH="$2"; shift 2 ;;
    --remove) REMOVE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: $APP_PATH not found." >&2
  echo "       Pass --app-path if WhiteVanOps is installed somewhere else." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must run as root — it changes the system firewall." >&2
  echo "Re-run with: sudo $0 $*" >&2
  exit 1
fi

if $REMOVE; then
  "$SOCKETFILTERFW" --remove "$APP_PATH" || true
  echo "Removed WhiteVanOps from the firewall's allowed-apps list."
  exit 0
fi

# Idempotent: --add is a no-op if the app is already listed.
"$SOCKETFILTERFW" --add "$APP_PATH"
"$SOCKETFILTERFW" --unblockapp "$APP_PATH"

echo "Allowed WhiteVanOps through the macOS Application Firewall."
echo ""
echo "Two more things that produce the identical symptom (a phone's browser"
echo "hangs on a white screen that never finishes loading) if missed:"
echo ""
echo "  1. The first time WhiteVanOps runs, macOS may separately prompt"
echo "     'Accept incoming network connections?' for the app itself — click"
echo "     Allow. If that was dismissed or answered Deny earlier, remove"
echo "     WhiteVanOps from System Settings > Network > Firewall > Options"
echo "     and re-run this script so it prompts again."
echo "  2. On macOS 15 and later, WhiteVanOps also needs the Local Network"
echo "     permission: System Settings > Privacy & Security > Local Network"
echo "     > WhiteVanOps. Without it, the app never even attempts to accept"
echo "     LAN connections, firewall rule or not."
echo ""
echo "Verify from a phone on the same WiFi: open the address shown in"
echo "WhiteVanOps's Field Access QR (dashboard sidebar), e.g. http://<mac-lan-ip>:3000/field"
