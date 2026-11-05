#!/usr/bin/env bash
# Build the fork's installable server tarball from the checked-out commit, in
# the toolchain container, and print the pin awm installs it by
# (awm/services/trilium/server.pin). The tarball stays on this node: awm's
# deploy pushes it to the nodes that serve Trilium. Run it on mizar, on a clean
# `release`.
set -euo pipefail

usage() {
    cat <<EOF
usage: $0 [--out DIR]

  --out   where the tarball lands (default: \$AWM_DIR/artifacts, else
          <workspace>/.awm/artifacts, the store awm's deploy pushes from).
EOF
}

. "$(dirname "$0")/toolchain.sh"

workspace_artifacts() {
    [ -n "${AWM_DIR:-}" ] && { echo "$AWM_DIR/artifacts"; return; }
    local d="$project"
    while [ "$d" != "/" ]; do
        [ -d "$d/projects" ] && [ -f "$d/AGENTS.md" ] && { echo "$d/.awm/artifacts"; return; }
        d="$(dirname "$d")"
    done
    die "no awm workspace above $project; pass --out."
}

out=""
while [ $# -gt 0 ]; do
    case "$1" in
        --out) out="${2:?--out needs a directory}"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
    shift
done
out="${out:-$(workspace_artifacts)}"

cd "$root"
[ -z "$(git status --porcelain)" ] || die "the working tree is not clean."
# v* only: the fork-* tags this script makes must not rename the next build.
version="$(git describe --tags --match 'v[0-9]*')"
branch="$(git symbolic-ref --quiet --short HEAD || echo detached)"

echo "Building $version from $branch ($(git rev-parse --short HEAD)) …"
toolchain_image
toolchain_run -- bash -euc '
    pnpm install --frozen-lockfile
    pnpm server:build
    cd apps/server && bash scripts/build-server.sh'

built=("$root"/apps/server/out/TriliumNotes-Server-*-linux-*.tar.xz)
[ "${#built[@]}" = 1 ] && [ -f "${built[0]}" ] \
    || die "build-server.sh left no single tarball in apps/server/out."
arch="${built[0]##*-linux-}"
arch="${arch%.tar.xz}"
asset="TriliumNotes-Server-${version}-linux-${arch}.tar.xz"

# The layout awm's install unpacks with --strip-components=1.
listing="$(tar -tJf "${built[0]}")"
top="$(cut -d/ -f1 <<<"$listing" | sort -u)"
[ "$(wc -l <<<"$top")" = 1 ] || die "the tarball holds more than one top-level entry."
grep -qx "$top/main.cjs" <<<"$listing" || die "the tarball has no $top/main.cjs."
grep -qx "$top/node/bin/node" <<<"$listing" || die "the tarball has no $top/node/bin/node."

mkdir -p "$out"
mv "${built[0]}" "$out/$asset"
sha256="$(sha256sum "$out/$asset" | cut -d' ' -f1)"
echo "$sha256  $asset" > "$out/$asset.sha256"

if [ "$branch" = release ]; then
    git rev-parse -q --verify "refs/tags/fork-$version" >/dev/null || git tag "fork-$version" HEAD
fi

echo
echo "Tarball: $out/$asset"
echo
echo "Pin for awm/services/trilium/server.pin:"
echo "version=$version"
echo "file=$asset"
echo "sha256=$sha256"
