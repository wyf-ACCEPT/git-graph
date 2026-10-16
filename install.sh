#!/bin/zsh
# Recreate the pinned runtime, frozen dependencies, and production bundles.
set -euo pipefail
ROOT_DIR="${0:A:h}"
command -v npm >/dev/null || { print -u2 'Git Graph install: Node.js/npm is required'; exit 1; }
command -v node >/dev/null || { print -u2 'Git Graph install: Node.js is required'; exit 1; }
mkdir -p "$ROOT_DIR/.runtime"
cp "$ROOT_DIR/runtime-package.json" "$ROOT_DIR/.runtime/package.json"
npm install --prefix "$ROOT_DIR/.runtime" --package-lock=false
BUN="$ROOT_DIR/.runtime/node_modules/.bin/bun"
export PATH="$ROOT_DIR/.runtime/node_modules/.bin:$PATH"
cd "$ROOT_DIR"
"$BUN" install --frozen-lockfile
# Use the installed build tools directly; npm's Bun package may omit bunx.
node node_modules/vite/bin/vite.js build
NODE_ENV=production "$BUN" build server/index.ts server/cli.ts --outdir dist/server --target bun --sourcemap=linked --production
print 'Git Graph dependencies and build are ready.'
