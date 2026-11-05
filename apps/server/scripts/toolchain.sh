# Sourced by release-fork.sh and dev-server.sh: build the toolchain image for
# this checkout, and run a command in it as the calling user.
#
# The container mounts the whole project (worktrees and the bare repo, the bare
# read-only) at its host path, so git inside it resolves the worktree's .git.

die() { echo "error: $*" >&2; exit 1; }

command -v docker >/dev/null || die "docker is not on PATH."

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
project="$(dirname "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)")"
node_version="$(tr -d ' \n' < "$root/.nvmrc")"
pnpm_version="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$root/package.json")"
[ -n "$pnpm_version" ] || die "package.json names no pnpm in packageManager."
image="trilium-toolchain:node${node_version}-pnpm${pnpm_version}"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/trilium-toolchain"

toolchain_image() {
    docker image inspect "$image" >/dev/null 2>&1 && return
    echo "Building $image …"
    docker build -q -t "$image" \
        --build-arg "NODE_VERSION=$node_version" --build-arg "PNPM_VERSION=$pnpm_version" \
        -f "$root/apps/server/scripts/release.Dockerfile" "$root/apps/server/scripts" >/dev/null
}

# toolchain_run [docker run options …] -- command …
toolchain_run() {
    local opts=()
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do opts+=("$1"); shift; done
    shift
    mkdir -p "$cache/pnpm-store" "$cache/home"
    docker run --rm --init \
        --user "$(id -u):$(id -g)" \
        -e HOME=/home/build -e CI=true -e npm_config_store_dir=/pnpm-store \
        -v "$cache/home:/home/build" -v "$cache/pnpm-store:/pnpm-store" \
        -v "$project:$project" -v "$project/.bare:$project/.bare:ro" \
        -w "$root" "${opts[@]}" "$image" "$@"
}
