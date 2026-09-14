# HashMine Miner Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Библиотека `web/src/engine/` — три движка поиска шар (эталон на JS/viem, CPU через Rust→WASM в Web Workers, GPU через WebGPU/WGSL), общий формат nonce и кросс-проверка всех реализаций одними векторами, сгенерированными Solidity-скриптом. Без UI и без отправки в контракт (это план 04b).

**Architecture:** Хэш шары `keccak256(beneficiary[20] ‖ challenge[32] ‖ nonce[32])`, nonce = `segment<<128 | worker<<64 | counter` (все — u64). Хост задаёт `header` (52 байта), `segment`, `difficulty`; движок перебирает `counter` и отдаёт находки `{worker, counter}`. Каждая находка перепроверяется эталоном на viem. WASM — крейт `keccak` 0.1 (проверено: 5.2 MH/s на поток, ручной keccak — 1.5). WGSL генерируется из TS (развёрнутые rho/pi/chi, состояние в `var<private>`; проверено: 145 MH/s на Apple Metal, хэши совпадают с viem).

**Tech Stack:** Vite 8.3, TypeScript 5.9, viem 2.56, vitest 5.0 (node), Rust 1.96 + target `wasm32-unknown-unknown` (установлен), крейт `keccak` 0.1.6, playwright-core 1.61.1 с явным `executablePath` на кэшированный Chromium 1243 (`~/Library/Caches/ms-playwright/chromium-1243/…`, WebGPU через Metal проверен).

**Спека:** §6.2 (движки), §7 п.4 (кросс-реализации). **Git:** коммиты только по команде пользователя; в конце задач — Checkpoint (`git status`).

**Проверенные факты (спайки 2026-09-14, scratchpad `wasmspike3/`, `wgslspike/`):**
- `keccak::f1600` из крейта 0.1.6; в 0.2 API другой (`with_f1600`), не использовать.
- `RUSTFLAGS=-C target-feature=+simd128` — скорость ниже (4.5 против 5.3 MH/s), не включать.
- WGSL: индексация `const`-массивов runtime-индексом не используется; RC — в `var<private>`; сдвиги на 32 исключены генерацией кода.
- Раскладка счётчика: байты сообщения 76..79 = старшее слово counter (BE) → верхняя половина лейна 9; 80..83 → нижняя половина лейна 10; в обоих случаях `bswap32`.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `.gitignore` | + `miner-wasm/target/`, `web/node_modules/`, `web/dist/` |
| `contracts/foundry.toml` | + `fs_permissions` для `vectors/` |
| `contracts/script/Vectors.s.sol` | Генерирует `contracts/vectors/share-vectors.json` |
| `contracts/vectors/share-vectors.json` | 12 векторов `(beneficiary, challenge, nonce) → hash, leadingZeroBits` |
| `miner-wasm/Cargo.toml`, `miner-wasm/src/lib.rs` | Крейт поиска шар |
| `scripts/build-wasm.sh` | Сборка крейта и копирование `.wasm` в `web/src/engine/wasm/` |
| `web/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html` | Каркас |
| `web/src/engine/share.ts` | Эталон: nonce, header, hash, leadingZeroBits, isValidShare |
| `web/src/engine/types.ts` | `EngineConfig`, `Hit`, `Engine` |
| `web/src/engine/wasm.ts` | Загрузка WASM и типизированная обёртка |
| `web/src/engine/wasm/hashmine_keccak.wasm` | Артефакт сборки (3 КБ, коммитится) |
| `web/src/engine/cpuWorker.ts` | Web Worker: цикл поиска на WASM |
| `web/src/engine/cpuEngine.ts` | Пул воркеров |
| `web/src/engine/keccakWgsl.ts` | Генератор WGSL + `blockWords` |
| `web/src/engine/gpuEngine.ts` | WebGPU-движок |
| `web/src/engine/__tests__/share.test.ts`, `wasm.test.ts` | Vitest (node) против векторов |
| `web/browser-tests/index.html`, `main.ts` | Страница браузерных тестов (GPU + CPU) |
| `web/scripts/browser-test.mjs` | Запуск браузерных тестов через Vite + playwright-core |

---

### Task 1: Векторы из Solidity

**Files:**
- Modify: `contracts/foundry.toml`
- Create: `contracts/script/Vectors.s.sol`
- Create (генерируется): `contracts/vectors/share-vectors.json`

- [ ] **Step 1: Разрешить запись в `contracts/vectors/`** — в `[profile.default]` файла `contracts/foundry.toml` добавить:

```toml
fs_permissions = [{ access = "read-write", path = "./vectors" }]
```

- [ ] **Step 2: Записать `contracts/script/Vectors.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Writes cross-implementation vectors for the share hash used by HashMine.submit:
/// keccak256(abi.encodePacked(beneficiary, challenge, nonce)), nonce = segment << 128 | worker << 64 | counter.
/// Run: forge script script/Vectors.s.sol:Vectors
contract Vectors is Script {
    uint256 internal constant COUNT = 12;

    function run() external {
        string memory json = "[";
        for (uint256 i = 0; i < COUNT; i++) {
            address beneficiary = address(uint160(uint256(keccak256(abi.encode("beneficiary", i)))));
            bytes32 challenge = keccak256(abi.encode("challenge", i));
            uint256 counter = uint64(uint256(keccak256(abi.encode("counter", i))));
            // The last four vectors are real shares of at least 12 bits.
            uint256 target = i < 8 ? 0 : 12;
            (uint256 nonce, bytes32 hash) = _find(beneficiary, challenge, i + 1, i % 4, counter, target);
            json = string.concat(json, i == 0 ? "" : ",", _entry(beneficiary, challenge, nonce, hash));
        }
        json = string.concat(json, "]");
        vm.writeFile("vectors/share-vectors.json", json);
    }

    function _find(address b, bytes32 c, uint256 segment, uint256 worker, uint256 counter, uint256 target)
        internal
        pure
        returns (uint256 nonce, bytes32 hash)
    {
        while (true) {
            nonce = (segment << 128) | (worker << 64) | counter;
            hash = keccak256(abi.encodePacked(b, c, nonce));
            if (_leadingZeroBits(hash) >= target) return (nonce, hash);
            counter = (counter + 1) & type(uint64).max;
        }
    }

    function _leadingZeroBits(bytes32 h) internal pure returns (uint256 n) {
        uint256 x = uint256(h);
        if (x == 0) return 256;
        while (x >> 255 == 0) {
            x <<= 1;
            ++n;
        }
    }

    function _entry(address b, bytes32 c, uint256 nonce, bytes32 hash) internal view returns (string memory) {
        return string.concat(
            '{"beneficiary":"', vm.toString(b),
            '","challenge":"', vm.toString(c),
            '","nonce":"', vm.toString(nonce),
            '","hash":"', vm.toString(hash),
            '","leadingZeroBits":', vm.toString(_leadingZeroBits(hash)),
            "}"
        );
    }
}
```

- [ ] **Step 3: Сгенерировать и проверить**

Run: `cd ~/Desktop/rig/contracts && mkdir -p vectors && forge script script/Vectors.s.sol:Vectors && python3 -c "import json; v=json.load(open('vectors/share-vectors.json')); print(len(v), 'vectors;', 'min lz of last 4:', min(x['leadingZeroBits'] for x in v[8:]))"`
Expected: `12 vectors; min lz of last 4: 12` или больше.

- [ ] **Step 4: Checkpoint** — `git status --short`.

---

### Task 2: Крейт WASM и скрипт сборки

**Files:**
- Create: `miner-wasm/Cargo.toml`, `miner-wasm/src/lib.rs`, `scripts/build-wasm.sh`
- Modify: `.gitignore`

- [ ] **Step 1: `.gitignore`** — добавить строки:

```gitignore
miner-wasm/target/
web/node_modules/
web/dist/
```

- [ ] **Step 2: Записать `miner-wasm/Cargo.toml`**

```toml
[package]
name = "hashmine_keccak"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
# 0.1 exposes keccak::f1600; 0.2 changed the API. Measured 5.3 MH/s per thread vs 1.5 for a hand-written loop.
keccak = { version = "0.1", default-features = false }

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
```

- [ ] **Step 3: Записать `miner-wasm/src/lib.rs`**

```rust
//! HashMine share search: keccak256(beneficiary[20] || challenge[32] || nonce[32]) with
//! nonce = segment << 128 | worker << 64 | counter (big-endian). One 136-byte keccak block.
#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

/// beneficiary (20 bytes) followed by challenge (32 bytes); written by the host.
static mut HEADER: [u8; 52] = [0; 52];
/// 32-byte hash output for `hash_into`.
static mut OUT: [u8; 32] = [0; 32];

#[no_mangle]
pub extern "C" fn header_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(HEADER) as *mut u8
}

#[no_mangle]
pub extern "C" fn out_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(OUT) as *mut u8
}

/// Absorbed block for counter = 0: lanes 0..17 of the padded 136-byte message.
#[inline(always)]
fn base_state(segment: u64, worker: u64) -> [u64; 25] {
    let header = unsafe { &*core::ptr::addr_of!(HEADER) };
    let mut m = [0u8; 136];
    m[..52].copy_from_slice(header);
    m[60..68].copy_from_slice(&segment.to_be_bytes());
    m[68..76].copy_from_slice(&worker.to_be_bytes());
    m[84] = 0x01;
    m[135] |= 0x80;
    let mut st = [0u64; 25];
    for i in 0..17 {
        let mut lane = [0u8; 8];
        lane.copy_from_slice(&m[8 * i..8 * i + 8]);
        st[i] = u64::from_le_bytes(lane);
    }
    st
}

/// Leading zero bits of the hash read as a big-endian 256-bit integer (at most 4 lanes are checked).
#[inline(always)]
fn leading_zero_bits(st: &[u64; 25]) -> u32 {
    let mut n = 0;
    for i in 0..4 {
        let v = st[i].swap_bytes();
        if v == 0 {
            n += 64;
        } else {
            return n + v.leading_zeros();
        }
    }
    n
}

#[inline(always)]
fn hash_counter(base: &[u64; 25], counter: u64) -> [u64; 25] {
    let mut st = *base;
    // message bytes 76..79 = counter high word big-endian -> lane 9 high half, little-endian
    st[9] |= (((counter >> 32) as u32).swap_bytes() as u64) << 32;
    // message bytes 80..83 = counter low word big-endian -> lane 10 low half
    st[10] |= (counter as u32).swap_bytes() as u64;
    keccak::f1600(&mut st);
    st
}

/// Returns `counter + 1` of the first nonce in `[start, start + count)` whose hash has at least
/// `difficulty` leading zero bits, or 0 if there is none. A hit at counter u64::MAX reads as none.
#[no_mangle]
pub extern "C" fn search(segment: u64, worker: u64, start: u64, count: u32, difficulty: u32) -> u64 {
    let base = base_state(segment, worker);
    let mut c = start;
    for _ in 0..count {
        if leading_zero_bits(&hash_counter(&base, c)) >= difficulty {
            return c.wrapping_add(1);
        }
        c = c.wrapping_add(1);
    }
    0
}

/// Writes the 32-byte hash of one nonce into the buffer at `out_ptr()`.
#[no_mangle]
pub extern "C" fn hash_into(segment: u64, worker: u64, counter: u64) {
    let st = hash_counter(&base_state(segment, worker), counter);
    let out = unsafe { &mut *core::ptr::addr_of_mut!(OUT) };
    for i in 0..4 {
        out[8 * i..8 * i + 8].copy_from_slice(&st[i].to_le_bytes());
    }
}
```

- [ ] **Step 4: Записать `scripts/build-wasm.sh`**

```bash
#!/usr/bin/env bash
# Builds miner-wasm and copies the artifact into the web package. Requires rustup target wasm32-unknown-unknown.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cargo build --release --target wasm32-unknown-unknown --manifest-path "$ROOT/miner-wasm/Cargo.toml"
mkdir -p "$ROOT/web/src/engine/wasm"
cp "$ROOT/miner-wasm/target/wasm32-unknown-unknown/release/hashmine_keccak.wasm" "$ROOT/web/src/engine/wasm/hashmine_keccak.wasm"
ls -la "$ROOT/web/src/engine/wasm/hashmine_keccak.wasm"
```

- [ ] **Step 5: Собрать**

Run: `chmod +x ~/Desktop/rig/scripts/build-wasm.sh && ~/Desktop/rig/scripts/build-wasm.sh`
Expected: `Finished release`, файл ~3.2 КБ в `web/src/engine/wasm/`, без предупреждений `unused_unsafe`.

- [ ] **Step 6: Checkpoint** — `git status --short`.

---

### Task 3: Каркас `web/` и эталон `share.ts`

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`
- Create: `web/src/engine/share.ts`, `web/src/engine/types.ts`, `web/src/engine/__tests__/share.test.ts`

- [ ] **Step 1: Записать `web/package.json`**

```json
{
  "name": "hashmine-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:browser": "node scripts/browser-test.mjs"
  },
  "dependencies": {
    "viem": "2.56.5"
  },
  "devDependencies": {
    "@types/node": "24.13.4",
    "@webgpu/types": "0.1.72",
    "playwright-core": "1.61.1",
    "typescript": "5.9.3",
    "vite": "8.3.0",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 2: Записать `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vite/client", "@webgpu/types", "node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src", "browser-tests", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Записать `web/vite.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  // share-vectors.json lives in contracts/, outside the Vite root.
  server: { fs: { allow: [repoRoot] } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', browserTests: 'browser-tests/index.html' } },
  },
});
```

- [ ] **Step 4: Записать `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 5: Записать `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>hashmine</title>
  </head>
  <body>
    <p>hashmine — miner UI lands in plan 04b. Engine tests: <a href="/browser-tests/index.html">browser-tests</a>.</p>
  </body>
</html>
```

- [ ] **Step 6: Установить зависимости**

Run: `cd ~/Desktop/rig/web && npm install 2>&1 | tail -3`
Expected: `added N packages`, без `ERESOLVE`.

- [ ] **Step 7: Записать `web/src/engine/types.ts`**

```ts
/** What every engine searches: a 52-byte header (beneficiary ++ challenge), a segment and a difficulty. */
export interface EngineConfig {
  header: Uint8Array;
  segment: bigint;
  difficulty: number;
}

/** A candidate share reported by an engine. The host recomputes the hash before trusting it. */
export interface Hit {
  segment: bigint;
  worker: bigint;
  counter: bigint;
  difficulty: number;
}

export interface Engine {
  readonly name: string;
  start(config: EngineConfig): void;
  /** New round/segment/difficulty. Counters restart when header or segment change. */
  update(config: EngineConfig): void;
  stop(): void;
  onHit: ((hit: Hit) => void) | null;
  /** Hashes per second over the most recent reports; 0 before the first report. */
  hashRate(): number;
}

/** Worker id reserved for the GPU engine; CPU workers use 0..cores-1. */
export const GPU_WORKER_ID = 255n;
```

- [ ] **Step 8: Записать падающий тест `web/src/engine/__tests__/share.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { getAddress, hexToBytes, type Address, type Hex } from 'viem';
import vectors from '../../../../contracts/vectors/share-vectors.json';
import {
  MASK64,
  headerBytes,
  isValidShare,
  leadingZeroBits,
  makeNonce,
  shareHash,
  splitNonce,
} from '../share';

describe('share reference (viem)', () => {
  it('has 12 vectors, the last four being real shares', () => {
    expect(vectors).toHaveLength(12);
    expect(Math.min(...vectors.slice(8).map((v) => v.leadingZeroBits))).toBeGreaterThanOrEqual(12);
  });

  it.each(vectors)('matches Solidity for $hash', (v) => {
    const beneficiary = getAddress(v.beneficiary) as Address;
    const nonce = BigInt(v.nonce);
    expect(shareHash(beneficiary, v.challenge as Hex, nonce)).toBe(v.hash);
    expect(leadingZeroBits(v.hash as Hex)).toBe(v.leadingZeroBits);
    expect(isValidShare(beneficiary, v.challenge as Hex, nonce, v.leadingZeroBits)).toBe(true);
    expect(isValidShare(beneficiary, v.challenge as Hex, nonce, v.leadingZeroBits + 1)).toBe(false);
  });

  it('packs and splits nonces', () => {
    const nonce = makeNonce(7n, 3n, 123456789n);
    expect(nonce).toBe((7n << 128n) | (3n << 64n) | 123456789n);
    expect(splitNonce(nonce)).toEqual({ segment: 7n, worker: 3n, counter: 123456789n });
    expect(() => makeNonce(MASK64 + 1n, 0n, 0n)).toThrow(RangeError);
  });

  it('builds a 52-byte header', () => {
    const v = vectors[0]!;
    const header = headerBytes(getAddress(v.beneficiary) as Address, v.challenge as Hex);
    expect(header).toHaveLength(52);
    expect(header.slice(0, 20)).toEqual(hexToBytes(v.beneficiary as Hex));
    expect(header.slice(20)).toEqual(hexToBytes(v.challenge as Hex));
  });

  it('counts leading zero bits of edge hashes', () => {
    expect(leadingZeroBits(('0x' + '00'.repeat(32)) as Hex)).toBe(256);
    expect(leadingZeroBits(('0x80' + '00'.repeat(31)) as Hex)).toBe(0);
    expect(leadingZeroBits(('0x0001' + '00'.repeat(30)) as Hex)).toBe(15);
  });
});
```

- [ ] **Step 9: Убедиться, что падает**

Run: `cd ~/Desktop/rig/web && npx vitest run src/engine/__tests__/share.test.ts 2>&1 | tail -5`
Expected: FAIL — `Failed to resolve import "../share"`.

- [ ] **Step 10: Записать `web/src/engine/share.ts`**

```ts
import { concatHex, getAddress, hexToBytes, keccak256, pad, toHex, type Address, type Hex } from 'viem';

export const MASK64 = (1n << 64n) - 1n;

/** nonce = segment << 128 | worker << 64 | counter; every part is an unsigned 64-bit value. */
export function makeNonce(segment: bigint, worker: bigint, counter: bigint): bigint {
  for (const part of [segment, worker, counter]) {
    if (part < 0n || part > MASK64) throw new RangeError('nonce part must fit in 64 bits');
  }
  return (segment << 128n) | (worker << 64n) | counter;
}

export function splitNonce(nonce: bigint): { segment: bigint; worker: bigint; counter: bigint } {
  return { segment: (nonce >> 128n) & MASK64, worker: (nonce >> 64n) & MASK64, counter: nonce & MASK64 };
}

/** beneficiary (20 bytes) ++ challenge (32 bytes): the part of the message every engine keeps fixed. */
export function headerBytes(beneficiary: Address, challenge: Hex): Uint8Array {
  const header = hexToBytes(concatHex([getAddress(beneficiary), challenge]));
  if (header.length !== 52) throw new RangeError('header must be 52 bytes');
  return header;
}

/** keccak256(abi.encodePacked(beneficiary, challenge, nonce)) — exactly what HashMine.submit checks. */
export function shareHash(beneficiary: Address, challenge: Hex, nonce: bigint): Hex {
  return keccak256(concatHex([getAddress(beneficiary), challenge, pad(toHex(nonce), { size: 32 })]));
}

/** Leading zero bits of a 32-byte hash read as a big-endian integer. */
export function leadingZeroBits(hash: Hex): number {
  const value = BigInt(hash);
  return value === 0n ? 256 : 256 - value.toString(2).length;
}

export function isValidShare(beneficiary: Address, challenge: Hex, nonce: bigint, difficulty: number): boolean {
  return leadingZeroBits(shareHash(beneficiary, challenge, nonce)) >= difficulty;
}

/** Hex of a 32-byte little-endian lane dump (how WASM and WGSL hand hashes back). */
export function bytesToHashHex(bytes: Uint8Array): Hex {
  return toHex(bytes);
}
```

- [ ] **Step 11: Прогнать**

Run: `cd ~/Desktop/rig/web && npx vitest run src/engine/__tests__/share.test.ts 2>&1 | tail -6 && npm run typecheck`
Expected: `Tests  16 passed` (12 параметризованных + 4), typecheck без ошибок.

- [ ] **Step 12: Checkpoint** — `git status --short`.

---

### Task 4: Обёртка WASM и её тест

**Files:**
- Create: `web/src/engine/wasm.ts`, `web/src/engine/__tests__/wasm.test.ts`

- [ ] **Step 1: Записать падающий тест `web/src/engine/__tests__/wasm.test.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import vectors from '../../../../contracts/vectors/share-vectors.json';
import { bytesToHashHex, headerBytes, isValidShare, makeNonce, splitNonce } from '../share';
import { KeccakWasm } from '../wasm';

const wasmBytes = readFileSync(fileURLToPath(new URL('../wasm/hashmine_keccak.wasm', import.meta.url)));

describe('keccak wasm', () => {
  let wasm: KeccakWasm;

  beforeAll(async () => {
    wasm = await KeccakWasm.instantiate(wasmBytes);
  });

  it.each(vectors)('hashes $hash like Solidity', (v) => {
    wasm.setHeader(headerBytes(getAddress(v.beneficiary) as Address, v.challenge as Hex));
    const { segment, worker, counter } = splitNonce(BigInt(v.nonce));
    expect(bytesToHashHex(wasm.hash(segment, worker, counter))).toBe(v.hash);
    expect(wasm.search(segment, worker, counter, 1, v.leadingZeroBits)).toBe(counter);
    expect(wasm.search(segment, worker, counter, 1, v.leadingZeroBits + 1)).toBeNull();
  });

  it('finds the same first share as a JS scan', () => {
    const v = vectors[0]!;
    const beneficiary = getAddress(v.beneficiary) as Address;
    const challenge = v.challenge as Hex;
    wasm.setHeader(headerBytes(beneficiary, challenge));
    let js = 0n;
    while (!isValidShare(beneficiary, challenge, makeNonce(1n, 0n, js), 12)) js++;
    expect(wasm.search(1n, 0n, 0n, 1 << 20, 12)).toBe(js);
  });

  it('rejects a header of the wrong size', () => {
    expect(() => wasm.setHeader(new Uint8Array(51))).toThrow(RangeError);
  });

  it('hashes at least 2 MH/s on one thread', () => {
    const count = 1 << 20;
    const t0 = performance.now();
    expect(wasm.search(1n, 0n, 0n, count, 64)).toBeNull();
    const rate = count / ((performance.now() - t0) / 1000);
    expect(rate).toBeGreaterThan(2_000_000);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd ~/Desktop/rig/web && npx vitest run src/engine/__tests__/wasm.test.ts 2>&1 | tail -5`
Expected: FAIL — `Failed to resolve import "../wasm"`.

- [ ] **Step 3: Записать `web/src/engine/wasm.ts`**

```ts
interface KeccakExports {
  memory: WebAssembly.Memory;
  header_ptr(): number;
  out_ptr(): number;
  search(segment: bigint, worker: bigint, start: bigint, count: number, difficulty: number): bigint;
  hash_into(segment: bigint, worker: bigint, counter: bigint): void;
}

/** Typed wrapper over miner-wasm (see miner-wasm/src/lib.rs). One instance per worker. */
export class KeccakWasm {
  private constructor(private readonly ex: KeccakExports) {}

  static async instantiate(bytes: BufferSource): Promise<KeccakWasm> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new KeccakWasm(instance.exports as unknown as KeccakExports);
  }

  /** beneficiary (20 bytes) ++ challenge (32 bytes). */
  setHeader(header: Uint8Array): void {
    if (header.length !== 52) throw new RangeError('header must be 52 bytes');
    new Uint8Array(this.ex.memory.buffer).set(header, this.ex.header_ptr());
  }

  /** 32-byte hash of one nonce, in wire (big-endian) byte order. */
  hash(segment: bigint, worker: bigint, counter: bigint): Uint8Array {
    this.ex.hash_into(segment, worker, counter);
    const ptr = this.ex.out_ptr();
    return new Uint8Array(this.ex.memory.buffer.slice(ptr, ptr + 32));
  }

  /** First counter in [start, start + count) whose hash has >= difficulty leading zero bits, else null. */
  search(segment: bigint, worker: bigint, start: bigint, count: number, difficulty: number): bigint | null {
    const result = this.ex.search(segment, worker, start, count, difficulty);
    return result === 0n ? null : result - 1n;
  }
}

/** Browser-side loader; Vite turns the URL into a hashed asset at build time. */
export async function loadKeccakWasm(): Promise<KeccakWasm> {
  const response = await fetch(new URL('./wasm/hashmine_keccak.wasm', import.meta.url));
  if (!response.ok) throw new Error(`wasm fetch failed: ${response.status}`);
  return KeccakWasm.instantiate(await response.arrayBuffer());
}
```

- [ ] **Step 4: Прогнать**

Run: `cd ~/Desktop/rig/web && npx vitest run 2>&1 | tail -6`
Expected: `Tests  32 passed` (share 16 + wasm 16).

- [ ] **Step 5: Checkpoint** — `git status --short`.

---

### Task 5: CPU-движок — воркер и пул

**Files:**
- Create: `web/src/engine/cpuWorker.ts`, `web/src/engine/cpuEngine.ts`

Тесты этой задачи — браузерные, в Task 7 (в node нет Web Worker с тем же API).

- [ ] **Step 1: Записать `web/src/engine/cpuWorker.ts`**

```ts
import { loadKeccakWasm, type KeccakWasm } from './wasm';

/** Messages from CpuEngine. bigint travels as decimal strings: structured clone supports bigint, but strings keep DevTools readable. */
export type CpuWorkerIn =
  | { type: 'start'; header: Uint8Array; segment: string; worker: number; difficulty: number }
  | { type: 'update'; header: Uint8Array; segment: string; difficulty: number }
  | { type: 'stop' };

export type CpuWorkerOut =
  | { type: 'ready' }
  | { type: 'hit'; segment: string; worker: number; counter: string; difficulty: number }
  | { type: 'rate'; hashes: number; ms: number }
  | { type: 'error'; message: string };

const CHUNK = 1 << 16;
const REPORT_MS = 500;

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<CpuWorkerIn>) => void) | null;
  postMessage(message: CpuWorkerOut): void;
};

let wasm: KeccakWasm | null = null;
let running = false;
let workerId = 0n;
let segment = 0n;
let difficulty = 0;
let counter = 0n;
let generation = 0;

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
let header = new Uint8Array(52);

async function loop(myGeneration: number): Promise<void> {
  let hashes = 0;
  let since = performance.now();
  while (running && myGeneration === generation && wasm) {
    const found = wasm.search(segment, workerId, counter, CHUNK, difficulty);
    if (found === null) {
      hashes += CHUNK;
      counter += BigInt(CHUNK);
    } else {
      hashes += Number(found - counter) + 1;
      ctx.postMessage({ type: 'hit', segment: segment.toString(), worker: Number(workerId), counter: found.toString(), difficulty });
      counter = found + 1n;
    }
    const now = performance.now();
    if (now - since >= REPORT_MS) {
      ctx.postMessage({ type: 'rate', hashes, ms: now - since });
      hashes = 0;
      since = now;
    }
    // Yield so 'update'/'stop' messages get through between chunks (~12 ms each at 5 MH/s).
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

ctx.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'start') {
      if (!wasm) wasm = await loadKeccakWasm();
      workerId = BigInt(msg.worker);
      header = msg.header;
      segment = BigInt(msg.segment);
      difficulty = msg.difficulty;
      counter = 0n;
      wasm.setHeader(header);
      running = true;
      ctx.postMessage({ type: 'ready' });
      void loop(++generation);
    } else if (msg.type === 'update') {
      const newSegment = BigInt(msg.segment);
      if (!sameKey(header, msg.header) || newSegment !== segment) counter = 0n;
      header = msg.header;
      segment = newSegment;
      difficulty = msg.difficulty;
      wasm?.setHeader(header);
    } else if (msg.type === 'stop') {
      running = false;
      generation++;
    }
  } catch (error) {
    ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
```

- [ ] **Step 2: Записать `web/src/engine/cpuEngine.ts`**

```ts
import type { CpuWorkerIn, CpuWorkerOut } from './cpuWorker';
import type { Engine, EngineConfig, Hit } from './types';

/** One Web Worker per core, each searching its own worker-id nonce space on the WASM keccak. */
export class CpuEngine implements Engine {
  readonly name = 'cpu';
  onHit: ((hit: Hit) => void) | null = null;
  onError: ((worker: number, message: string) => void) | null = null;

  private workers: Worker[] = [];
  private rates: number[] = [];

  constructor(readonly cores: number) {
    if (!Number.isInteger(cores) || cores < 1) throw new RangeError('cores must be a positive integer');
  }

  start(config: EngineConfig): void {
    this.stop();
    this.rates = new Array<number>(this.cores).fill(0);
    for (let i = 0; i < this.cores; i++) {
      const worker = new Worker(new URL('./cpuWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<CpuWorkerOut>) => this.handle(i, event.data);
      worker.onerror = (event) => this.onError?.(i, event.message);
      this.post(worker, { type: 'start', header: config.header, segment: config.segment.toString(), worker: i, difficulty: config.difficulty });
      this.workers.push(worker);
    }
  }

  update(config: EngineConfig): void {
    for (const worker of this.workers) {
      this.post(worker, { type: 'update', header: config.header, segment: config.segment.toString(), difficulty: config.difficulty });
    }
  }

  stop(): void {
    for (const worker of this.workers) {
      this.post(worker, { type: 'stop' });
      worker.terminate();
    }
    this.workers = [];
    this.rates = [];
  }

  hashRate(): number {
    return this.rates.reduce((sum, rate) => sum + rate, 0);
  }

  private post(worker: Worker, message: CpuWorkerIn): void {
    worker.postMessage(message);
  }

  private handle(index: number, msg: CpuWorkerOut): void {
    if (msg.type === 'hit') {
      this.onHit?.({ segment: BigInt(msg.segment), worker: BigInt(msg.worker), counter: BigInt(msg.counter), difficulty: msg.difficulty });
    } else if (msg.type === 'rate') {
      this.rates[index] = msg.ms > 0 ? (msg.hashes * 1000) / msg.ms : 0;
    } else if (msg.type === 'error') {
      this.onError?.(index, msg.message);
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/Desktop/rig/web && npm run typecheck`
Expected: без ошибок.

- [ ] **Step 4: Checkpoint** — `git status --short`.

---

### Task 6: GPU-движок — генератор WGSL и класс

**Files:**
- Create: `web/src/engine/keccakWgsl.ts`, `web/src/engine/gpuEngine.ts`

- [ ] **Step 1: Записать `web/src/engine/keccakWgsl.ts`**

```ts
// WGSL for the share search. Lanes are vec2<u32> (x = low word, y = high word): WGSL has no u64.
// The shader takes the padded 136-byte block with counter = 0 and ORs the counter (message bytes
// 76..83, big-endian) into lanes 9 and 10 for every invocation.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
/** Rho rotation offsets by lane index x + 5y. */
const RHO = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

export const BLOCK_WORDS = 34;

/** 64-bit rotate-left of a vec2<u32> expression; n is a compile-time constant so no shift is ever 32. */
function rotl(v: string, n: number): string {
  n %= 64;
  if (n === 0) return v;
  if (n === 32) return `vec2<u32>(${v}.y, ${v}.x)`;
  if (n < 32) return `vec2<u32>((${v}.x << ${n}u) | (${v}.y >> ${32 - n}u), (${v}.y << ${n}u) | (${v}.x >> ${32 - n}u))`;
  const m = n - 32;
  return `vec2<u32>((${v}.y << ${m}u) | (${v}.x >> ${32 - m}u), (${v}.x << ${m}u) | (${v}.y >> ${32 - m}u))`;
}

function roundBody(): string {
  const lines: string[] = [];
  for (let x = 0; x < 5; x++) lines.push(`    let c${x} = st[${x}] ^ st[${x + 5}] ^ st[${x + 10}] ^ st[${x + 15}] ^ st[${x + 20}];`);
  for (let x = 0; x < 5; x++) lines.push(`    let d${x} = c${(x + 4) % 5} ^ ${rotl(`c${(x + 1) % 5}`, 1)};`);
  for (let i = 0; i < 25; i++) lines.push(`    st[${i}] = st[${i}] ^ d${i % 5};`);
  for (let i = 0; i < 25; i++) {
    const x = i % 5;
    const y = Math.floor(i / 5);
    const j = y + 5 * ((2 * x + 3 * y) % 5);
    lines.push(`    b[${j}] = ${rotl(`st[${i}]`, RHO[i]!)};`);
  }
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const i = x + 5 * y;
      lines.push(`    st[${i}] = b[${i}] ^ ((~b[${((x + 1) % 5) + 5 * y}]) & b[${((x + 2) % 5) + 5 * y}]);`);
    }
  }
  return lines.join('\n');
}

export function keccakShaderSource(workgroupSize: number): string {
  const rcLo = RC.map((v) => `${Number(v & 0xffffffffn)}u`).join(', ');
  const rcHi = RC.map((v) => `${Number(v >> 32n)}u`).join(', ');
  return `
struct Params {
  base_lo: u32,
  base_hi: u32,
  count: u32,
  difficulty: u32,
  max_hits: u32,
  debug: u32,
}
struct Hits {
  count: atomic<u32>,
  entries: array<vec2<u32>>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> block: array<u32, ${BLOCK_WORDS}>;
@group(0) @binding(2) var<storage, read_write> hits: Hits;
@group(0) @binding(3) var<storage, read_write> debug_hash: array<u32, 8>;

var<private> RC_LO: array<u32, 24> = array<u32, 24>(${rcLo});
var<private> RC_HI: array<u32, 24> = array<u32, 24>(${rcHi});
var<private> st: array<vec2<u32>, 25>;

fn keccakf() {
  var b: array<vec2<u32>, 25>;
  for (var r = 0u; r < 24u; r = r + 1u) {
${roundBody()}
    st[0] = st[0] ^ vec2<u32>(RC_LO[r], RC_HI[r]);
  }
}

fn bswap(x: u32) -> u32 {
  return ((x & 0xffu) << 24u) | ((x & 0xff00u) << 8u) | ((x >> 8u) & 0xff00u) | (x >> 24u);
}

// Leading zero bits of the hash read as a big-endian 256-bit integer; the first 128 bits are checked.
fn leading_zero_bits() -> u32 {
  let w0 = bswap(st[0].x);
  if (w0 != 0u) { return countLeadingZeros(w0); }
  let w1 = bswap(st[0].y);
  if (w1 != 0u) { return 32u + countLeadingZeros(w1); }
  let w2 = bswap(st[1].x);
  if (w2 != 0u) { return 64u + countLeadingZeros(w2); }
  let w3 = bswap(st[1].y);
  if (w3 != 0u) { return 96u + countLeadingZeros(w3); }
  return 128u;
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.count) { return; }
  let lo = params.base_lo + idx;
  var hi = params.base_hi;
  if (lo < params.base_lo) { hi = hi + 1u; }
  for (var i = 0u; i < 17u; i = i + 1u) {
    st[i] = vec2<u32>(block[2u * i], block[2u * i + 1u]);
  }
  for (var i = 17u; i < 25u; i = i + 1u) {
    st[i] = vec2<u32>(0u, 0u);
  }
  st[9].y = st[9].y | bswap(hi);
  st[10].x = st[10].x | bswap(lo);
  keccakf();
  if (leading_zero_bits() >= params.difficulty) {
    let slot = atomicAdd(&hits.count, 1u);
    if (slot < params.max_hits) { hits.entries[slot] = vec2<u32>(lo, hi); }
  }
  if (params.debug == 1u && idx == 0u) {
    debug_hash[0] = st[0].x; debug_hash[1] = st[0].y; debug_hash[2] = st[1].x; debug_hash[3] = st[1].y;
    debug_hash[4] = st[2].x; debug_hash[5] = st[2].y; debug_hash[6] = st[3].x; debug_hash[7] = st[3].y;
  }
}
`;
}

/** Padded 136-byte keccak block for header ++ nonce(segment, worker, counter = 0), as 34 little-endian u32 words. */
export function blockWords(header: Uint8Array, segment: bigint, worker: bigint): Uint32Array {
  if (header.length !== 52) throw new RangeError('header must be 52 bytes');
  const block = new Uint8Array(136);
  block.set(header, 0);
  const view = new DataView(block.buffer);
  view.setBigUint64(60, segment, false);
  view.setBigUint64(68, worker, false);
  block[84] = 0x01;
  block[135] = block[135]! | 0x80;
  const words = new Uint32Array(BLOCK_WORDS);
  for (let i = 0; i < BLOCK_WORDS; i++) words[i] = view.getUint32(4 * i, true);
  return words;
}
```

- [ ] **Step 2: Записать `web/src/engine/gpuEngine.ts`**

```ts
import { BLOCK_WORDS, blockWords, keccakShaderSource } from './keccakWgsl';
import { GPU_WORKER_ID, type Engine, type EngineConfig, type Hit } from './types';

const WORKGROUP_SIZE = 256;
const MAX_HITS = 1024;
const MIN_DISPATCH = 1 << 16;
const MAX_DISPATCH = 1 << 24;
/** Target wall time of one dispatch: long enough to amortise readback, short enough to keep the page drawing. */
const TARGET_MS = 60;

interface DispatchResult {
  hits: Array<{ lo: number; hi: number }>;
  hitCount: number;
  debugHash: Uint32Array;
  ms: number;
}

/** WebGPU share search. One dispatch hashes `count` consecutive counters of the GPU worker id. */
export class GpuEngine implements Engine {
  readonly name = 'gpu';
  onHit: ((hit: Hit) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private config: EngineConfig | null = null;
  private running = false;
  private base = 0n;
  private dispatchSize = 1 << 20;
  private rate = 0;

  private readonly paramsBuffer: GPUBuffer;
  private readonly blockBuffer: GPUBuffer;
  private readonly hitsBuffer: GPUBuffer;
  private readonly debugBuffer: GPUBuffer;
  private readonly hitsStaging: GPUBuffer;
  private readonly debugStaging: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    readonly adapterInfo: { vendor: string; architecture: string; description: string },
  ) {
    const hitsSize = 8 + 8 * MAX_HITS;
    this.paramsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blockBuffer = device.createBuffer({ size: 4 * BLOCK_WORDS, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.hitsBuffer = device.createBuffer({ size: hitsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.debugBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.hitsStaging = device.createBuffer({ size: hitsSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.debugStaging = device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.blockBuffer } },
        { binding: 2, resource: { buffer: this.hitsBuffer } },
        { binding: 3, resource: { buffer: this.debugBuffer } },
      ],
    });
  }

  /** null when the browser has no WebGPU or no adapter; throws on shader compile errors. */
  static async create(): Promise<GpuEngine | null> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: keccakShaderSource(WORKGROUP_SIZE) });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);
    if (errors.length > 0) throw new Error(`WGSL: ${errors.join(' | ')}`);
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const raw = adapter.info;
    return new GpuEngine(device, pipeline, { vendor: raw.vendor, architecture: raw.architecture, description: raw.description });
  }

  start(config: EngineConfig): void {
    this.config = config;
    this.base = 0n;
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  update(config: EngineConfig): void {
    const previous = this.config;
    if (!previous || previous.segment !== config.segment || !sameBytes(previous.header, config.header)) this.base = 0n;
    this.config = config;
  }

  stop(): void {
    this.running = false;
  }

  hashRate(): number {
    return this.running ? this.rate : 0;
  }

  /** Hash of one nonce, for cross-implementation tests. Not used while mining. */
  async hashOne(header: Uint8Array, segment: bigint, worker: bigint, counter: bigint): Promise<Uint8Array> {
    const result = await this.dispatch(blockWords(header, segment, worker), counter, 1, 200, 1);
    return new Uint8Array(result.debugHash.buffer.slice(0, 32));
  }

  private async loop(): Promise<void> {
    try {
      while (this.running && this.config) {
        const { header, segment, difficulty } = this.config;
        const base = this.base;
        const count = this.dispatchSize;
        const result = await this.dispatch(blockWords(header, segment, GPU_WORKER_ID), base, count, difficulty, 0);
        // A config change during the dispatch restarted the counter space; drop these hits.
        if (this.config.segment === segment && sameBytes(this.config.header, header)) {
          this.base = base + BigInt(count);
          for (const { lo, hi } of result.hits) {
            const counter = (BigInt(hi) << 32n) | BigInt(lo);
            this.onHit?.({ segment, worker: GPU_WORKER_ID, counter, difficulty });
          }
        }
        this.rate = (count * 1000) / result.ms;
        if (result.ms < TARGET_MS / 2 && this.dispatchSize < MAX_DISPATCH) this.dispatchSize *= 2;
        else if (result.ms > TARGET_MS * 2 && this.dispatchSize > MIN_DISPATCH) this.dispatchSize /= 2;
      }
    } catch (error) {
      this.running = false;
      this.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private async dispatch(words: Uint32Array, base: bigint, count: number, difficulty: number, debug: number): Promise<DispatchResult> {
    const device = this.device;
    const baseLo = Number(base & 0xffffffffn);
    const baseHi = Number((base >> 32n) & 0xffffffffn);
    device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([baseLo, baseHi, count, difficulty, MAX_HITS, debug, 0, 0]));
    device.queue.writeBuffer(this.blockBuffer, 0, words);
    device.queue.writeBuffer(this.hitsBuffer, 0, new Uint32Array(2 + 2 * MAX_HITS));
    const t0 = performance.now();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
    pass.end();
    encoder.copyBufferToBuffer(this.hitsBuffer, 0, this.hitsStaging, 0, 8 + 8 * MAX_HITS);
    encoder.copyBufferToBuffer(this.debugBuffer, 0, this.debugStaging, 0, 32);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = Math.max(performance.now() - t0, 0.001);

    await this.hitsStaging.mapAsync(GPUMapMode.READ);
    const hitWords = new Uint32Array(this.hitsStaging.getMappedRange().slice(0));
    this.hitsStaging.unmap();
    await this.debugStaging.mapAsync(GPUMapMode.READ);
    const debugHash = new Uint32Array(this.debugStaging.getMappedRange().slice(0));
    this.debugStaging.unmap();

    const hitCount = hitWords[0]!;
    const hits: DispatchResult['hits'] = [];
    for (let i = 0; i < Math.min(hitCount, MAX_HITS); i++) hits.push({ lo: hitWords[2 + 2 * i]!, hi: hitWords[3 + 2 * i]! });
    return { hits, hitCount, debugHash, ms };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/Desktop/rig/web && npm run typecheck`
Expected: без ошибок. Если `adapter.info` не типизирован в `@webgpu/types` 0.1.72 — заменить на `(adapter as unknown as { info: GPUAdapterInfo }).info`.

- [ ] **Step 4: Checkpoint** — `git status --short`.

---

### Task 7: Браузерные тесты GPU и CPU

**Files:**
- Create: `web/browser-tests/index.html`, `web/browser-tests/main.ts`, `web/scripts/browser-test.mjs`

- [ ] **Step 1: Записать `web/browser-tests/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>hashmine engine tests</title>
  </head>
  <body>
    <pre id="log">engine tests: call window.hashmineTest.gpu() / .cpu(cores)</pre>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Записать `web/browser-tests/main.ts`**

```ts
import { getAddress, type Address, type Hex } from 'viem';
import vectors from '../../contracts/vectors/share-vectors.json';
import { CpuEngine } from '../src/engine/cpuEngine';
import { GpuEngine } from '../src/engine/gpuEngine';
import { bytesToHashHex, headerBytes, isValidShare, makeNonce, splitNonce } from '../src/engine/share';
import type { Engine, Hit } from '../src/engine/types';

interface SearchReport {
  hits: number;
  verified: number;
  invalid: string[];
  rate: number;
  seconds: number;
}

const SEARCH_DIFFICULTY = 16;

async function runSearch(engine: Engine, seconds: number): Promise<SearchReport> {
  const v = vectors[0]!;
  const beneficiary = getAddress(v.beneficiary) as Address;
  const challenge = v.challenge as Hex;
  const hits: Hit[] = [];
  engine.onHit = (hit) => hits.push(hit);
  engine.start({ header: headerBytes(beneficiary, challenge), segment: 42n, difficulty: SEARCH_DIFFICULTY });
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const rate = engine.hashRate();
  engine.stop();
  const invalid: string[] = [];
  let verified = 0;
  const seen = new Set<string>();
  for (const hit of hits) {
    const nonce = makeNonce(hit.segment, hit.worker, hit.counter);
    const key = nonce.toString();
    if (seen.has(key)) invalid.push(`duplicate ${key}`);
    seen.add(key);
    if (isValidShare(beneficiary, challenge, nonce, hit.difficulty)) verified++;
    else invalid.push(`bad ${key}`);
  }
  return { hits: hits.length, verified, invalid, rate, seconds };
}

async function gpu(): Promise<{ available: boolean; adapter?: unknown; vectorsOk?: number; vectorsTotal?: number; search?: SearchReport }> {
  const engine = await GpuEngine.create();
  if (!engine) return { available: false };
  let vectorsOk = 0;
  for (const v of vectors) {
    const { segment, worker, counter } = splitNonce(BigInt(v.nonce));
    const hash = await engine.hashOne(headerBytes(getAddress(v.beneficiary) as Address, v.challenge as Hex), segment, worker, counter);
    if (bytesToHashHex(hash) === v.hash) vectorsOk++;
  }
  const search = await runSearch(engine, 3);
  return { available: true, adapter: engine.adapterInfo, vectorsOk, vectorsTotal: vectors.length, search };
}

async function cpu(cores: number): Promise<{ search: SearchReport; errors: string[] }> {
  const engine = new CpuEngine(cores);
  const errors: string[] = [];
  engine.onError = (worker, message) => errors.push(`worker ${worker}: ${message}`);
  const search = await runSearch(engine, 4);
  return { search, errors };
}

declare global {
  interface Window {
    hashmineTest: { gpu: typeof gpu; cpu: typeof cpu };
  }
}
window.hashmineTest = { gpu, cpu };
```

- [ ] **Step 3: Записать `web/scripts/browser-test.mjs`**

```js
// Runs browser-tests/ in headless Chromium against the Vite dev server. Exit code 1 on any failure.
// RIG_CHROME overrides the browser binary (default: the cached Chromium 1243 with WebGPU on Metal).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const CHROME =
  process.env.RIG_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CORES = Number(process.env.RIG_TEST_CORES ?? 2);
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(CHROME)) {
  console.log(`FAIL browser binary not found: ${CHROME} (set RIG_CHROME)`);
  process.exit(1);
}

const server = await createServer({ configFile: 'vite.config.ts', server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto(`${url}browser-tests/index.html`);
  await page.waitForFunction(() => typeof window.hashmineTest === 'object');

  const gpu = await page.evaluate(() => window.hashmineTest.gpu());
  console.log('gpu:', JSON.stringify(gpu));
  check(gpu.available, 'gpu: WebGPU adapter available');
  if (gpu.available) {
    check(gpu.vectorsOk === gpu.vectorsTotal, `gpu: vectors ${gpu.vectorsOk}/${gpu.vectorsTotal}`);
    check(gpu.search.hits > 0 && gpu.search.invalid.length === 0, `gpu: ${gpu.search.verified}/${gpu.search.hits} hits verified`);
    check(gpu.search.rate > 20e6, `gpu: ${(gpu.search.rate / 1e6).toFixed(1)} MH/s > 20`);
  }

  const cpu = await page.evaluate((cores) => window.hashmineTest.cpu(cores), CORES);
  console.log('cpu:', JSON.stringify(cpu));
  check(cpu.errors.length === 0, `cpu: no worker errors`);
  check(cpu.search.hits > 0 && cpu.search.invalid.length === 0, `cpu: ${cpu.search.verified}/${cpu.search.hits} hits verified`);
  check(cpu.search.rate > 2e6 * CORES, `cpu: ${(cpu.search.rate / 1e6).toFixed(2)} MH/s > ${2 * CORES}`);
} finally {
  await browser.close();
  await server.close();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nall browser tests passed');
```

- [ ] **Step 4: Прогнать браузерные тесты**

Run: `cd ~/Desktop/rig/web && npm run test:browser`
Expected: все строки `ok`, в конце `all browser tests passed`. Ориентиры: GPU ≥ 100 MH/s на Apple Metal, CPU ≈ 4–5 MH/s на ядро; при D=16 за 3 с GPU даёт сотни находок, CPU на 2 ядрах — ~600.

- [ ] **Step 5: Полный прогон и сборка**

Run: `cd ~/Desktop/rig/web && npm test 2>&1 | tail -4 && npm run build 2>&1 | tail -6`
Expected: vitest `32 passed`; `vite build` без ошибок, в `dist/assets/` есть `.wasm` и воркер.

- [ ] **Step 6: Checkpoint** — `git status --short`.

---

## Self-Review

- **Спека §6.2:** три движка (JS-эталон `share.ts`, WASM в воркерах, WGSL) — Task 3–6; перепроверка находок эталоном — в `runSearch` (Task 7); отключение движка при расхождении — логика хоста, план 04b (движки лишь отдают `onError`/находки).
- **Спека §7 п.4:** векторы из forge (Task 1), проверка JS (Task 3), WASM (Task 4), WGSL (Task 7 — `vectorsOk === vectorsTotal`).
- **Раскладка nonce** `segment<<128 | worker<<64 | counter` одинакова в `Vectors.s.sol`, `share.ts`, `lib.rs` (байты 60..84) и `blockWords`.
- **Не вошло (план 04b):** выбор сложности, сегменты и сортировка nonce, сессионный ключ, `submit`/`harvest`, UI.

---

## Отклонения при исполнении (2026-09-14)

1. **`Vectors.s.sol`:** `_entry` может быть `pure` (компилятор предупреждал про `view`); исправлено, векторы после перегенерации побайтово те же.
2. **`wasm.ts`:** результат `search` (i64) приходит в JS **знаковым** BigInt. Для counter ≥ 2⁶³ четыре вектора падали (`-2798677087087029677n`). Исправление: `BigInt.asUintN(64, …)`. Входные u64-аргументы конвертируются по модулю 2⁶⁴ и проблемы не создают.
3. **TypeScript 5.9:** `Uint8Array<ArrayBuffer>` ≠ `Uint8Array<ArrayBufferLike>`. Три аннотации: `let header: Uint8Array` в `cpuWorker.ts`, возвращаемый тип `blockWords(): Uint32Array<ArrayBuffer>` и параметр `dispatch(words: Uint32Array<ArrayBuffer>, …)` — `@webgpu/types` требует не-shared буфер в `writeBuffer`.
4. **`cpuWorker.ts`:** yield между чанками через `setTimeout(0)` браузер зажимает до ≥4 мс, скорость на ядро падала до 2.7 MH/s. Заменено на `MessageChannel`-hop.
5. **Порядок TDD:** файлы задач 5–7 (воркер, пул, WGSL, GPU, браузерные тесты) записаны до зелёного прогона задачи 4 — их тесты браузерные и на vitest не влияют.
