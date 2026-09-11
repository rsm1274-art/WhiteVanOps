#!/bin/bash
# reset-admin-password.sh — macOS counterpart to reset-admin-password.ps1
#
# Use when NOBODY can log in to the dashboard. If any other admin or
# superuser account still works, use Manage Users inside the app instead —
# that's a two-click fix and doesn't need this.
#
# A customer's Mac has no Node.js and no copy of the repo, so this borrows
# the Node runtime inside the installed Electron binary
# (ELECTRON_RUN_AS_NODE=1) to run reset-admin-password.js against the app's
# own bundled PostgreSQL. Nothing has to be installed on the machine.
# Unlike the Windows wrapper, no Start-Process workaround is needed —
# WhiteVanOps's macOS binary is a normal executable, so a plain foreground
# exec blocks and returns a real exit code.
#
# The bundled database only runs while WhiteVanOps is open. Start the app
# and leave it sitting at the login screen before running this.
#
# Copy BOTH files in this folder (this .sh and reset-admin-password.js) to
# the machine — a USB stick is fine. They can live anywhere; they do not
# need to be inside the install directory.
#
# Full walkthrough: MANUAL_Troubleshooting.md §3.4.
#
# Usage:
#   ./reset-admin-password.sh -List
#   ./reset-admin-password.sh
#   ./reset-admin-password.sh --install-dir "/Applications/WhiteVanOps.app" --username owner

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_SCRIPT="$SCRIPT_DIR/reset-admin-password.js"

INSTALL_DIR=""
USERNAME="admin"
LIST=false
CREATE=false

usage() {
  cat <<EOF
Usage: $0 [--install-dir PATH] [--username NAME] [--list] [--create]

  --install-dir PATH   Path to WhiteVanOps.app (default: /Applications/WhiteVanOps.app)
  --username NAME      Account to reset. Default: admin
  --list                Show existing admin/superuser accounts and exit without
                        changing anything.
  --create              Recreate the account as a superuser if it is missing
                        (use when the account itself was deleted).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    --list) LIST=true; shift ;;
    --create) CREATE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ ! -f "$JS_SCRIPT" ]]; then
  echo ""
  echo "ERROR: reset-admin-password.js is not next to this script." >&2
  echo "       Copy BOTH files from scripts/recovery/ to this machine." >&2
  echo ""
  exit 1
fi

if [[ -z "$INSTALL_DIR" ]]; then
  if [[ -d "/Applications/WhiteVanOps.app" ]]; then
    INSTALL_DIR="/Applications/WhiteVanOps.app"
  else
    echo ""
    echo "ERROR: Could not find WhiteVanOps.app in /Applications." >&2
    echo "       Pass the install location explicitly, e.g.:" >&2
    echo "         $0 --install-dir \"/Applications/WhiteVanOps.app\"" >&2
    echo ""
    exit 1
  fi
fi

APP_BIN="$INSTALL_DIR/Contents/MacOS/WhiteVanOps"
if [[ ! -x "$APP_BIN" ]]; then
  echo ""
  echo "ERROR: Could not find the WhiteVanOps binary at $APP_BIN" >&2
  echo "       Is --install-dir pointing at the .app bundle?" >&2
  echo ""
  exit 1
fi

echo ""
echo "Found WhiteVanOps at: $INSTALL_DIR"

ARGS=("$JS_SCRIPT" --install-dir "$INSTALL_DIR" --username "$USERNAME")
$LIST && ARGS+=(--list)
$CREATE && ARGS+=(--create)

# Electron's main process IS Node; ELECTRON_RUN_AS_NODE makes the packaged
# binary behave as a bare Node interpreter — this is what lets a machine with
# no Node installed run this at all.
ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "${ARGS[@]}"
CODE=$?

if [[ $CODE -ne 0 ]]; then
  echo "Password reset did not complete. See the error above." >&2
  echo "Most common cause: WhiteVanOps isn't running, so its database is stopped." >&2
  echo "Start the app, leave it at the login screen, and try again." >&2
  echo ""
fi

exit $CODE
