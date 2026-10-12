#!/usr/bin/env bash
# Vercel's build command (vercel.json "buildCommand").
#
# Vercel's build image has no Rust, and /noeterra needs the Noeterra engine
# compiled to WebAssembly. This installs a minimal toolchain when cargo is
# missing (rustup's official installer, HTTPS only), builds the engine, and then
# runs the repository's own build exactly as Vercel would have, which copies the
# module into public/ (scripts/copy-noeterra-wasm.mjs) and runs every gate.
#
# A failed engine build fails the deploy: shipping /noeterra without its engine
# would publish a page that cannot run.
set -euo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "noeterra: installing a minimal Rust toolchain for the WebAssembly target"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
  export PATH="$HOME/.cargo/bin:$PATH"
fi

rustup target add wasm32-unknown-unknown
cargo build --manifest-path noeterra/Cargo.toml --release --lib --no-default-features \
  --target wasm32-unknown-unknown

if command -v bun >/dev/null 2>&1; then
  exec bun run build
else
  exec npm run build
fi
