#!/usr/bin/env bash
# Stages pgsql-mac/ (the bundled PostgreSQL for the macOS installer) from a
# Postgres.app release — the automated form of MANUAL_Setup_Installation.md §1
# "PostgreSQL binaries for the macOS build". Used by
# .github/workflows/build-installers.yml; runs the same on a developer's Mac.
#
#   scripts/ci/stage-pgsql-mac.sh [path/to/Postgres-X.Y.Z-17.dmg]
#
# With no argument it downloads the latest Postgres.app release's PostgreSQL 17
# dmg via `gh` (needs GH_TOKEN in CI). Copies only what the app invokes —
# postgres, initdb, pg_ctl, pg_dump, the dylibs they load (computed with otool,
# not hardcoded), plpgsql + dict_snowball, and share/postgresql — then proves
# the payload works on its own: initdb, start, pg_dump, stop.
set -euo pipefail

PG_MAJOR=17
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/pgsql-mac"
WORK="$(mktemp -d)"
MOUNT=""
cleanup() {
  if [ -n "$MOUNT" ]; then hdiutil detach "$MOUNT" -quiet || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

DMG="${1:-}"
if [ -z "$DMG" ]; then
  echo "Downloading the latest Postgres.app release (PostgreSQL $PG_MAJOR)..."
  gh release download --repo PostgresApp/PostgresApp --pattern "Postgres-*-${PG_MAJOR}.dmg" --dir "$WORK"
  DMG="$(ls "$WORK"/Postgres-*-"${PG_MAJOR}".dmg | head -1)"
fi
echo "Using $DMG"

MOUNT="$(hdiutil attach -nobrowse -readonly "$DMG" | awk -F'\t' '/\/Volumes\// {print $NF}' | tail -1)"
SRC="$MOUNT/Postgres.app/Contents/Versions/$PG_MAJOR"
[ -x "$SRC/bin/pg_ctl" ] || { echo "No $SRC/bin/pg_ctl in $DMG" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/lib/postgresql" "$OUT/share"

BINS=(postgres initdb pg_ctl pg_dump)
MODULES=(plpgsql.dylib dict_snowball.dylib)
for b in "${BINS[@]}"; do cp -p "$SRC/bin/$b" "$OUT/bin/"; done
for m in "${MODULES[@]}"; do cp -p "$SRC/lib/postgresql/$m" "$OUT/lib/postgresql/"; done
cp -R "$SRC/share/postgresql" "$OUT/share/"

# Dylib closure: every non-system library the binaries and modules load,
# followed recursively. Postgres.app references them as @loader_path/../lib/X,
# @rpath/X or an absolute .../Versions/17/lib/X — all resolve to lib/X here.
declare -a QUEUE=()
for b in "${BINS[@]}"; do QUEUE+=("$SRC/bin/$b"); done
for m in "${MODULES[@]}"; do QUEUE+=("$SRC/lib/postgresql/$m"); done
SEEN=" "
while [ ${#QUEUE[@]} -gt 0 ]; do
  f="${QUEUE[0]}"; QUEUE=("${QUEUE[@]:1}")
  while read -r dep; do
    case "$dep" in
      /usr/lib/*|/System/*) continue ;;
    esac
    name="$(basename "$dep")"
    case "$SEEN" in *" $name "*) continue ;; esac
    SEEN="$SEEN$name "
    if [ ! -f "$SRC/lib/$name" ]; then
      echo "Cannot resolve dependency $dep of $f" >&2; exit 1
    fi
    cp -p "$SRC/lib/$name" "$OUT/lib/"
    QUEUE+=("$SRC/lib/$name")
  done < <(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep -v "^$(basename "$f")\$" || true)
done
chmod +x "$OUT"/bin/*

echo "Staged pgsql-mac/:"
ls "$OUT/bin" "$OUT/lib"
du -sh "$OUT"

# Prove the payload runs on its own, detached from Postgres.app — the same
# check the manual asks for by hand.
hdiutil detach "$MOUNT" -quiet; MOUNT=""
T="$WORK/pgtest"
PW="$WORK/pw"; printf 'stagecheck' > "$PW"
"$OUT/bin/initdb" -D "$T" -U wvo_user -E UTF8 --locale=C -A scram-sha-256 --pwfile="$PW" > "$WORK/initdb.log"
"$OUT/bin/pg_ctl" -D "$T" -l "$WORK/pg.log" -o "-p 5544 -k $WORK" -w start > /dev/null
PGPASSWORD=stagecheck "$OUT/bin/pg_dump" -h 127.0.0.1 -p 5544 -U wvo_user postgres > /dev/null
"$OUT/bin/pg_ctl" -D "$T" -m fast -w stop > /dev/null
echo "pgsql-mac/ verified: initdb, start, pg_dump and stop all succeed."
