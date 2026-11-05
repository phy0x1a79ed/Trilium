#!/usr/bin/env bash
# Run this worktree's server in watch mode, in the toolchain container, against
# a scratch copy of a vault snapshot. Never point it at the live vault: the
# copy is the only database this server writes.
set -euo pipefail

usage() {
    cat <<EOF
usage: $0 [--snapshot DB] [--port N] [--fresh]

  --snapshot  the snapshot to copy (default: \$TRILIUM_DEV_SNAPSHOT, else
              ~/backups/trilium-vault/document.db, mizar's daily vault mirror)
  --port      the loopback port to serve on (default: \$TRILIUM_DEV_PORT or 37750)
  --fresh     replace the scratch copy with a new copy of the snapshot
EOF
}

. "$(dirname "$0")/toolchain.sh"
command -v sqlite3 >/dev/null || die "sqlite3 is not on PATH."

snapshot="${TRILIUM_DEV_SNAPSHOT:-$HOME/backups/trilium-vault/document.db}"
port="${TRILIUM_DEV_PORT:-37750}"
fresh=0
while [ $# -gt 0 ]; do
    case "$1" in
        --snapshot) snapshot="${2:?--snapshot needs a file}"; shift ;;
        --port) port="${2:?--port needs a number}"; shift ;;
        --fresh) fresh=1 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
    shift
done

[ -f "$snapshot" ] || die "no snapshot at $snapshot."
# A database with a write-ahead log beside it is open in a running server.
[ ! -e "$snapshot-wal" ] || die "$snapshot has a -wal beside it, so it looks live. Copy a snapshot instead."

scratch="$cache/dev-data/$(basename "$root")"
if [ "$fresh" = 1 ] || [ ! -f "$scratch/document.db" ]; then
    rm -rf "$scratch"
    mkdir -p "$scratch"
    sqlite3 "file:$snapshot?mode=ro" "VACUUM INTO '$scratch/document.db'"
    echo "Copied $snapshot into $scratch."
fi

toolchain_image
echo "Serving $(git -C "$root" describe --tags --always --dirty) on http://127.0.0.1:$port/ from $scratch."
# The dev script fixes TRILIUM_DATA_DIR to apps/server/data, so the scratch
# copy mounts there.
tty=(-i); [ -t 0 ] && tty+=(-t)
toolchain_run "${tty[@]}" -p "127.0.0.1:$port:8080" \
    -e TRILIUM_PORT=8080 -e TRILIUM_HOST=0.0.0.0 \
    -v "$scratch:$root/apps/server/data" -- \
    bash -euc 'pnpm install --frozen-lockfile && exec pnpm server:start'
