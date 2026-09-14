#!/usr/bin/env bash
# Builds miner-wasm and copies the artifact into the web package. Requires rustup target wasm32-unknown-unknown.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cargo build --release --target wasm32-unknown-unknown --manifest-path "$ROOT/miner-wasm/Cargo.toml"
mkdir -p "$ROOT/web/src/engine/wasm"
cp "$ROOT/miner-wasm/target/wasm32-unknown-unknown/release/hashmine_keccak.wasm" "$ROOT/web/src/engine/wasm/hashmine_keccak.wasm"
ls -la "$ROOT/web/src/engine/wasm/hashmine_keccak.wasm"
