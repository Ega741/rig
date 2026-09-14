# Rig

Project name: **Rig** (`$RIG`), chosen 2026-09-14. The working name `hashmine` survives in the share-pool contract `HashMine.sol`, the spec/plan file names and the WASM crate.

Browser GPU/CPU mining of a PONS-launched token on Robinhood Chain. No NFTs, no team allocation: trading fees buy the token back into a mining pool, and shares of keccak proof-of-work split every round's release by work.

Spec: `docs/superpowers/specs/2026-09-14-hashmine-design.md`. Plans and execution notes: `docs/superpowers/plans/`.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry: `HashMine.sol` (rounds, shares, rewards), `PonsTreasury.sol` (PONS launch, fee harvest, buyback, migration) |
| `miner-wasm/` | Rust → WASM keccak share search (CPU engine) |
| `web/` | Vite + React miner: engines (WASM workers, WebGPU), controller, UI |
| `sim/` | Parameter simulation (`sim/RESULTS.md`) |
| `scripts/` | `build-wasm.sh`, `export-abi.sh` |

## Commands

```bash
# contracts
cd contracts && forge test --no-match-path 'test/fork/*'     # unit + invariants
cd contracts && forge test --match-path 'test/fork/*'        # against real PONS on a mainnet fork (drpc)
cd contracts && forge script script/Vectors.s.sol:Vectors    # cross-implementation hash vectors

# wasm + abi (after changing miner-wasm/ or contracts/src/)
scripts/build-wasm.sh
scripts/export-abi.sh

# web
cd web && npm install
cd web && npm test              # vitest (engines, policy, controller, UI helpers)
cd web && npm run test:browser  # WebGPU + WASM engines in headless Chromium
cd web && npm run test:e2e      # controller against HashMine on anvil
cd web && npm run test:e2e-ui   # the Mine/Stats/Docs pages against anvil, screenshots in web/e2e-artifacts/
cd web && npm run dev           # local dev server; pass ?chain=local&rpc=…&hashMine=0x… or set VITE_* env

# simulation
cd sim && python3 hashmine_sim.py --seed 1
```

Browser tests need the cached Chromium 1243 (`~/Library/Caches/ms-playwright/chromium-1243`) or `RIG_CHROME=<path>`; WebGPU on Metal is required for the GPU checks.

## Configuration (web)

`VITE_CHAIN` (`local` | `testnet` | `mainnet`), `VITE_RPC_URL`, `VITE_HASHMINE_ADDRESS`, optional `VITE_TREASURY_ADDRESS` and `VITE_FEE_ESCROW_ADDRESS` (enable `harvest`). URL query parameters `chain`, `rpc`, `hashMine`, `treasury`, `feeEscrow`, `beneficiary` override them.

The **Token** page watches a PONS launch on Robinhood Chain mainnet regardless of the mining chain: `VITE_PONS_TOKEN` (or `?token=0x…`, or paste it on the page) and optional `VITE_PONS_RPC_URL` (`?ponsRpc=`). It shows the creator's fees waiting in the fee escrow, on the bonding curve and in the Uniswap v4 hook, plus price, market cap and graduation progress, refreshed every 3 s.
