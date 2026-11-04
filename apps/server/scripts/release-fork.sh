#!/usr/bin/env bash
# Build the fork's installable server tarball from the checked-out commit and
# print the pin awm installs it by. With --publish, upload it as a GitHub
# release on the fork. Run it on `release` with the node that .nvmrc names on
# PATH, e.g. `mamba run -n trilium apps/server/scripts/release-fork.sh`.
set -euo pipefail

usage() {
    cat <<EOF
usage: $0 [--publish] [--repo OWNER/NAME]

  --publish   push tag fork-<version> to origin and attach the tarball to a
              GitHub release on the fork. Only from a clean \`release\`.
  --repo      the fork's GitHub repository (default: \$TRILIUM_FORK_REPO or
              phy0x1a79ed/Trilium).
EOF
}

die() { echo "error: $*" >&2; exit 1; }

publish=0
repo="${TRILIUM_FORK_REPO:-phy0x1a79ed/Trilium}"
while [ $# -gt 0 ]; do
    case "$1" in
        --publish) publish=1 ;;
        --repo) repo="${2:?--repo needs OWNER/NAME}"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
    shift
done

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$root"

for tool in node pnpm jq wget xz tar sha256sum; do
    command -v "$tool" >/dev/null || die "$tool is not on PATH."
done
if [ "$publish" = 1 ]; then
    command -v gh >/dev/null || die "gh is not on PATH; --publish needs it."
    command -v curl >/dev/null || die "curl is not on PATH; --publish needs it."
fi

# The bundle's native modules (better-sqlite3) are built for the node that runs
# pnpm, and the tarball ships the .nvmrc runtime. The two must share an ABI.
want_node="v$(cat .nvmrc)"
[ "$(node --version)" = "$want_node" ] \
    || die "node on PATH is $(node --version); .nvmrc names $want_node."

[ -z "$(git status --porcelain)" ] || die "the working tree is not clean."
version="$(git describe --tags)"
branch="$(git symbolic-ref --quiet --short HEAD || echo detached)"
if [ "$publish" = 1 ] && [ "$branch" != release ]; then
    die "--publish runs only on release; this checkout is on $branch."
fi

echo "Building $version from $branch ($(git rev-parse --short HEAD)) …"
pnpm install --frozen-lockfile
pnpm server:build
(cd apps/server && bash scripts/build-server.sh)

out="$root/apps/server/out"
built=("$out"/TriliumNotes-Server-*-linux-*.tar.xz)
[ "${#built[@]}" = 1 ] && [ -f "${built[0]}" ] \
    || die "build-server.sh left no single tarball in $out."
arch="${built[0]##*-linux-}"
arch="${arch%.tar.xz}"
asset="TriliumNotes-Server-${version}-linux-${arch}.tar.xz"
tarball="$out/$asset"
mv "${built[0]}" "$tarball"

# The layout install.sh unpacks with --strip-components=1.
listing="$(tar -tJf "$tarball")"
top="$(cut -d/ -f1 <<<"$listing" | sort -u)"
[ "$(wc -l <<<"$top")" = 1 ] || die "$asset holds more than one top-level entry."
grep -qx "$top/main.cjs" <<<"$listing" || die "$asset has no $top/main.cjs."
grep -qx "$top/node/bin/node" <<<"$listing" || die "$asset has no $top/node/bin/node."

sha256="$(sha256sum "$tarball" | cut -d' ' -f1)"
echo "$sha256  $asset" > "$tarball.sha256"
tag="fork-$version"
url="https://github.com/$repo/releases/download/$tag/$asset"

echo
echo "Tarball: $tarball"
echo "SHA-256: $sha256"
echo
echo "Pin for awm/services/trilium/server.pin:"
echo "version=$version"
echo "url=$url"
echo "sha256=$sha256"

[ "$publish" = 1 ] || exit 0

# Upstream's Release workflow runs on every pushed v* tag, so the fork's tags
# carry the fork- prefix.
echo
echo "Publishing $tag to $repo …"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git tag "$tag" HEAD
git push origin "refs/tags/$tag"
gh release create "$tag" "$tarball" "$tarball.sha256" \
    --repo "$repo" --verify-tag --title "$tag" \
    --notes "Trilium server built from the fork's release at $(git rev-parse HEAD)."

check="$(mktemp)"
trap 'rm -f "$check"' EXIT
curl -fsSL -o "$check" "$url"
[ "$(sha256sum "$check" | cut -d' ' -f1)" = "$sha256" ] \
    || die "the published asset at $url does not match $sha256."
echo "Published: $url"
