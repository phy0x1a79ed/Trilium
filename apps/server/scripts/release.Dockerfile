# The toolchain the fork's server builds under: the node .nvmrc names, the pnpm
# package.json names, and what build-server.sh calls. release-fork.sh and
# dev-server.sh pass both versions in, so the image follows the checkout.
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm
ARG PNPM_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends jq xz-utils wget \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g --no-fund --no-audit "pnpm@${PNPM_VERSION}"
