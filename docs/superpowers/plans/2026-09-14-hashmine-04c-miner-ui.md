# HashMine Miner UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сайт майнера на React: страницы Mine, Stats, Docs (спека §6.5), сессионный ключ с пополнением из основного кошелька одним попапом (§6.3), вызов `harvest` по политике §6.4, e2e-прогон UI против anvil со скриншотом.

**Architecture:** `web/src/app/` — React 19 без роутера (hash-маршруты), состояние майнера — в хуке `useMiner`, который создаёт движки и `MinerController` только по действию пользователя (Start), а не в эффектах. Конфиг — из `import.meta.env` с переопределением через query-параметры (для e2e и для ссылок вида `?chain=local`). Кошелёк — минимальный EIP-1193 (`eth_requestAccounts`, `wallet_switchEthereumChain`, `eth_sendTransaction`); без него beneficiary вводится вручную. Стили — CSS-переменные, один файл, без UI-библиотек. Шрифты self-hosted через `@fontsource-variable`.

**Дизайн (решения):**
- Сигнатура — **полоса раунда**: шкала текущего раунда, заполняется временем; жёлтые засечки — найденные шары, кобальтовые — отправленные батчи, пунктир — момент «send by». Это структура протокола, а не украшение.
- Палитра: `--paper #EDF0F2` (кварц), `--ink #12161B`, `--ink-2 #4B5563`, `--cobalt #1F3FD6`, `--signal #F5C400`, `--line #C9D0D6`, `--danger #B42318`.
- Шрифты: Bricolage Grotesque (display: большие числа, заголовок), Instrument Sans (текст), JetBrains Mono (хэши, адреса, таблицы).
- Копирайт на английском, sentence case, глаголы действия: «Start mining», «Claim rewards», «Fund session key».
- Ни бегущего тикера хэшей, ни нумерованных карточек. Motion: заполнение полосы (1 с linear) и появление засечек; `prefers-reduced-motion` отключает.

**Tech Stack:** react 19.3.0, react-dom 19.3.0, @vitejs/plugin-react 6.1.1, @types/react(-dom) 19.3.0, @fontsource-variable/{bricolage-grotesque,instrument-sans,jetbrains-mono} 5.3.0; остальное как в 04a/04b.

**Спека:** §6.3, §6.4 (harvest), §6.5, §6.6. **Git:** коммиты только по команде пользователя.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore` | React, JSX, корень приложения, артефакты e2e |
| `web/src/miner/controller.ts` (+ тест) | Snapshot: `roundStartsAt`, `roundLength`, `releaseBps`, `roundWork`, `ownWork`; события `onEvent` |
| `web/src/app/styles.css` | Токены и компоненты |
| `web/src/app/main.tsx`, `App.tsx` | Корень, шапка, hash-маршруты |
| `web/src/app/config.ts` (+ тест) | env + query → `AppConfig`, beneficiary из query/localStorage |
| `web/src/app/format.ts` (+ тест) | Форматирование чисел, адресов, обратного отсчёта |
| `web/src/app/wallet.ts` (+ тест) | EIP-1193: connect, ensureChain, sendEth |
| `web/src/app/useMiner.ts` | Движки, контроллер, сессионный ключ, harvest, метки для полосы |
| `web/src/app/RoundBar.tsx` | Сигнатурный элемент |
| `web/src/app/pages/Mine.tsx`, `Stats.tsx`, `Docs.tsx` | Страницы |
| `web/src/app/stats.ts` (+ тест) | Загрузка раундов и событий, уникальные майнеры |
| `web/scripts/lib/localChain.mjs` | anvil + деплой + пополнение (общее для e2e) |
| `web/scripts/e2e-local.mjs` | Переведён на `localChain.mjs` |
| `web/scripts/e2e-ui.mjs` | UI e2e: старт, шары на экране и на чейне, Stats, скриншот |

---

### Task 1: React-каркас

**Files:**
- Modify: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `.gitignore`
- Create: `web/src/app/main.tsx`, `web/src/app/App.tsx`, `web/src/app/styles.css`

- [ ] **Step 1: Зависимости и скрипты** — в `web/package.json` добавить в `dependencies`:

```json
    "@fontsource-variable/bricolage-grotesque": "5.3.0",
    "@fontsource-variable/instrument-sans": "5.3.0",
    "@fontsource-variable/jetbrains-mono": "5.3.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
```

в `devDependencies`:

```json
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
```

в `scripts`: `"test:e2e-ui": "node scripts/e2e-ui.mjs"`. Затем `cd web && npm install`.

- [ ] **Step 2: `web/tsconfig.json`** — в `compilerOptions` добавить `"jsx": "react-jsx"`.

- [ ] **Step 3: `web/vite.config.ts`** — добавить `import react from '@vitejs/plugin-react';` и `plugins: [react()],` в объект `defineConfig`.

- [ ] **Step 4: `.gitignore`** — добавить `web/e2e-artifacts/`.

- [ ] **Step 5: Записать `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>hashmine</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Записать `web/src/app/styles.css`**

```css
:root {
  --paper: #edf0f2;
  --paper-2: #f8f9fa;
  --ink: #12161b;
  --ink-2: #4b5563;
  --line: #c9d0d6;
  --cobalt: #1f3fd6;
  --cobalt-2: #dfe5fb;
  --signal: #f5c400;
  --danger: #b42318;
  --font-display: 'Bricolage Grotesque Variable', 'Instrument Sans Variable', system-ui, sans-serif;
  --font-body: 'Instrument Sans Variable', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace;
}

* {
  box-sizing: border-box;
}
html {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.45;
}
body {
  margin: 0;
}
a {
  color: inherit;
}
button,
input,
select {
  font: inherit;
}
h1,
h2,
h3 {
  font-family: var(--font-display);
  letter-spacing: -0.02em;
  margin: 0 0 12px;
}
p {
  margin: 0 0 12px;
}

.top {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--line);
}
.brand {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 20px;
  letter-spacing: -0.02em;
  text-decoration: none;
}
.nav {
  display: flex;
  gap: 16px;
}
.nav a {
  text-decoration: none;
  color: var(--ink-2);
  padding: 4px 0;
  border-bottom: 2px solid transparent;
}
.nav a[aria-current='page'] {
  color: var(--ink);
  border-bottom-color: var(--cobalt);
}
.net {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-2);
}

.page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px;
}

.round__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
.round__label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.round__number {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.bar {
  position: relative;
  height: 56px;
  margin-top: 10px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
}
.bar__fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--cobalt-2);
}
.bar__sendby {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--cobalt);
}
.bar__sendby span {
  position: absolute;
  top: 4px;
  left: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--cobalt);
  white-space: nowrap;
}
.bar__mark {
  position: absolute;
  bottom: 0;
  width: 2px;
  height: 40%;
  background: var(--signal);
  transform: translateX(-1px);
  transform-origin: bottom;
}
.bar__mark--submit {
  height: 100%;
  width: 3px;
  background: var(--cobalt);
}
.bar__now {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--ink);
}
.bar__legend {
  display: flex;
  gap: 18px;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
}
.bar__legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  vertical-align: -1px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 24px;
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.card {
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 20px;
}
.card + .card {
  margin-top: 24px;
}
.big {
  font-family: var(--font-display);
  font-size: 48px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.big small {
  font-size: 18px;
  font-weight: 500;
  color: var(--ink-2);
  margin-left: 6px;
  letter-spacing: 0;
}
.kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 16px 0 0;
  font-size: 15px;
}
.kv dt {
  color: var(--ink-2);
}
.kv dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.btn {
  border: 1px solid var(--ink);
  background: var(--ink);
  color: #fff;
  padding: 10px 16px;
  border-radius: 4px;
  cursor: pointer;
}
.btn:focus-visible,
input:focus-visible,
select:focus-visible,
a:focus-visible {
  outline: 3px solid var(--signal);
  outline-offset: 2px;
}
.btn--ghost {
  background: transparent;
  color: var(--ink);
}
.btn--primary {
  background: var(--cobalt);
  border-color: var(--cobalt);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.field {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}
.field label {
  color: var(--ink-2);
  font-size: 14px;
}
input,
select {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: #fff;
}
input.mono {
  width: 100%;
  max-width: 460px;
}
.mono {
  font-family: var(--font-mono);
}
.muted {
  color: var(--ink-2);
}
.error {
  color: var(--danger);
}
.status {
  margin-top: 12px;
  font-size: 14px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.table th,
.table td {
  text-align: right;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.table th:first-child,
.table td:first-child {
  text-align: left;
}
.table-wrap {
  overflow-x: auto;
}
.prose {
  max-width: 720px;
}
.prose h2 {
  margin-top: 28px;
  font-size: 22px;
}
.prose code {
  font-family: var(--font-mono);
  font-size: 0.92em;
  background: var(--paper-2);
  padding: 1px 5px;
  border-radius: 3px;
}

@media (prefers-reduced-motion: no-preference) {
  .bar__fill {
    transition: width 1s linear;
  }
  .bar__mark {
    animation: pop 0.3s ease-out;
  }
  @keyframes pop {
    from {
      transform: translateX(-1px) scaleY(0);
    }
  }
}
```

- [ ] **Step 7: Записать `web/src/app/main.tsx`**

```tsx
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Записать `web/src/app/App.tsx`** (страницы появятся в задачах 5–6; до них — заглушки)

```tsx
import { useEffect, useMemo, useState } from 'react';
import { loadConfig, type UiConfig } from './config';
import { shortAddress } from './format';
import { Docs } from './pages/Docs';
import { Mine } from './pages/Mine';
import { Stats } from './pages/Stats';

type Route = 'mine' | 'stats' | 'docs';

function routeFromHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return name === 'stats' || name === 'docs' ? name : 'mine';
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const config = useMemo<UiConfig | Error>(() => {
    try {
      return loadConfig(import.meta.env as Record<string, string | undefined>, window.location.search);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, []);

  if (config instanceof Error) {
    return (
      <main className="page prose">
        <h1>hashmine is not configured</h1>
        <p className="error">{config.message}</p>
        <p>
          Set <code>VITE_CHAIN</code>, <code>VITE_HASHMINE_ADDRESS</code> and optionally <code>VITE_RPC_URL</code> at build time, or pass{' '}
          <code>?chain=local&amp;rpc=…&amp;hashMine=0x…</code> in the URL.
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="top">
        <a className="brand" href="#/mine">
          hashmine
        </a>
        <nav className="nav" aria-label="Pages">
          <a href="#/mine" aria-current={route === 'mine' ? 'page' : undefined}>
            Mine
          </a>
          <a href="#/stats" aria-current={route === 'stats' ? 'page' : undefined}>
            Stats
          </a>
          <a href="#/docs" aria-current={route === 'docs' ? 'page' : undefined}>
            Docs
          </a>
        </nav>
        <span className="net" title={config.hashMine}>
          {config.chain.name} · {shortAddress(config.hashMine)}
        </span>
      </header>
      <main className="page">
        {route === 'mine' && <Mine config={config} />}
        {route === 'stats' && <Stats config={config} />}
        {route === 'docs' && <Docs config={config} />}
      </main>
    </>
  );
}
```

- [ ] **Step 9: Checkpoint** — задача завершается после Task 6 сборкой; здесь только `git status --short`.

---

### Task 2: Формат и конфиг (чистые функции)

**Files:**
- Create: `web/src/app/__tests__/format.test.ts`, `web/src/app/format.ts`, `web/src/app/__tests__/config.test.ts`, `web/src/app/config.ts`

- [ ] **Step 1: Падающие тесты `web/src/app/__tests__/format.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { formatCountdown, formatEth, formatHashRate, formatTokens, formatWorkBits, shortAddress } from '../format';

describe('format', () => {
  it('hash rate picks a unit and keeps three significant digits', () => {
    expect(formatHashRate(0)).toBe('0 H/s');
    expect(formatHashRate(820)).toBe('820 H/s');
    expect(formatHashRate(5_312_000)).toBe('5.31 MH/s');
    expect(formatHashRate(142_600_000)).toBe('143 MH/s');
    expect(formatHashRate(6.02e9)).toBe('6.02 GH/s');
  });

  it('tokens use thin-space grouping and two decimals', () => {
    expect(formatTokens(1_203_411_520_000_000_000_000_000n)).toBe('1 203 411.52');
    expect(formatTokens(0n)).toBe('0.00');
    expect(formatTokens(5n * 10n ** 15n)).toBe('0.01');
  });

  it('eth keeps four decimals', () => {
    expect(formatEth(42_100_000_000_000_000n)).toBe('0.0421');
    expect(formatEth(10n ** 18n)).toBe('1.0000');
  });

  it('countdown is mm:ss and clamps at zero', () => {
    expect(formatCountdown(401_000)).toBe('06:41');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(3_599_000)).toBe('59:59');
  });

  it('addresses are shortened to 0x1234…abcd', () => {
    expect(shortAddress('0x94006Dfc006DF5fA095293cA64c54cEc54705ccc')).toBe('0x9400…5ccc');
  });

  it('work is shown as bits', () => {
    expect(formatWorkBits(0n)).toBe('0 bits');
    expect(formatWorkBits(1n << 33n)).toBe('33.0 bits');
    expect(formatWorkBits(3n << 33n)).toBe('34.6 bits');
  });
});
```

- [ ] **Step 2: Падающие тесты `web/src/app/__tests__/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';

const HASHMINE = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

describe('loadConfig', () => {
  it('reads env and defaults to the testnet rpc', () => {
    const c = loadConfig({ VITE_CHAIN: 'testnet', VITE_HASHMINE_ADDRESS: HASHMINE }, '');
    expect(c.chain.id).toBe(46630);
    expect(c.rpcUrl).toBe('https://rpc.testnet.chain.robinhood.com');
    expect(c.hashMine).toBe(HASHMINE);
    expect(c.treasury).toBeNull();
    expect(c.beneficiary).toBeNull();
  });

  it('query parameters override env', () => {
    const c = loadConfig(
      { VITE_CHAIN: 'testnet', VITE_HASHMINE_ADDRESS: HASHMINE },
      `?chain=local&rpc=http://127.0.0.1:9999&hashMine=${HASHMINE}&beneficiary=0x1111111111111111111111111111111111111111`,
    );
    expect(c.chain.id).toBe(31337);
    expect(c.rpcUrl).toBe('http://127.0.0.1:9999');
    expect(c.beneficiary).toBe('0x1111111111111111111111111111111111111111');
  });

  it('rejects a bad address', () => {
    expect(() => loadConfig({ VITE_CHAIN: 'local', VITE_HASHMINE_ADDRESS: 'nope' }, '')).toThrow(/VITE_HASHMINE_ADDRESS/);
    expect(() => loadConfig({ VITE_CHAIN: 'local', VITE_HASHMINE_ADDRESS: HASHMINE }, '?beneficiary=0x12')).toThrow(/beneficiary/);
  });
});
```

- [ ] **Step 3: Убедиться, что падают**

Run: `cd ~/Desktop/rig/web && npx vitest run src/app 2>&1 | tail -4`
Expected: FAIL — `Cannot find module '../format'` / `'../config'`.

- [ ] **Step 4: Записать `web/src/app/format.ts`**

```ts
const THIN_SPACE = ' ';

function group(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

function significant(value: number, digits = 3): string {
  if (value === 0) return '0';
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, digits - 1 - magnitude);
  return value.toFixed(decimals);
}

export function formatHashRate(hashesPerSecond: number): string {
  const units: Array<[number, string]> = [
    [1e9, 'GH/s'],
    [1e6, 'MH/s'],
    [1e3, 'kH/s'],
  ];
  for (const [scale, unit] of units) {
    if (hashesPerSecond >= scale) return `${significant(hashesPerSecond / scale)} ${unit}`;
  }
  return `${Math.round(hashesPerSecond)} H/s`;
}

/** Token-wei (18 decimals) as "1 203 411.52". */
export function formatTokens(wei: bigint, decimals = 2): string {
  const scale = 10n ** 18n;
  const whole = wei / scale;
  const fraction = wei % scale;
  const fractionDigits = (fraction * 10n ** BigInt(decimals) + scale / 2n) / scale;
  const carry = fractionDigits >= 10n ** BigInt(decimals) ? 1n : 0n;
  const digits = (fractionDigits - carry * 10n ** BigInt(decimals)).toString().padStart(decimals, '0');
  return `${group((whole + carry).toString())}.${digits}`;
}

export function formatEth(wei: bigint): string {
  return formatTokens(wei, 4);
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** log2 of a work amount, one decimal: what the difficulty ladder is measured in. */
export function formatWorkBits(work: bigint): string {
  if (work === 0n) return '0 bits';
  const bits = work.toString(2).length - 1;
  const top = Number(work >> BigInt(Math.max(0, bits - 52))) / 2 ** Math.min(bits, 52);
  return `${(bits + Math.log2(top)).toFixed(1)} bits`;
}
```

- [ ] **Step 5: Записать `web/src/app/config.ts`**

```ts
import { getAddress, isAddress, type Address } from 'viem';
import { configFromEnv, type AppConfig } from '../chain/chains';

export interface UiConfig extends AppConfig {
  /** Beneficiary fixed by the URL (?beneficiary=0x…); otherwise the page asks for a wallet or an address. */
  beneficiary: Address | null;
}

function addressParam(value: string | null, name: string): Address | null {
  if (value === null || value === '') return null;
  if (!isAddress(value)) throw new Error(`${name} is not an address: ${value}`);
  return getAddress(value);
}

/** Build-time env with URL query overrides: chain, rpc, hashMine, treasury, feeEscrow, beneficiary. */
export function loadConfig(env: Record<string, string | undefined>, search: string): UiConfig {
  const query = new URLSearchParams(search);
  const merged: Record<string, string | undefined> = {
    ...env,
    VITE_CHAIN: query.get('chain') ?? env.VITE_CHAIN,
    VITE_RPC_URL: query.get('rpc') ?? env.VITE_RPC_URL,
    VITE_HASHMINE_ADDRESS: query.get('hashMine') ?? env.VITE_HASHMINE_ADDRESS,
    VITE_TREASURY_ADDRESS: query.get('treasury') ?? env.VITE_TREASURY_ADDRESS,
    VITE_FEE_ESCROW_ADDRESS: query.get('feeEscrow') ?? env.VITE_FEE_ESCROW_ADDRESS,
  };
  const base = configFromEnv(merged);
  if (!isAddress(base.hashMine)) throw new Error(`VITE_HASHMINE_ADDRESS is not an address: ${base.hashMine}`);
  return {
    ...base,
    hashMine: getAddress(base.hashMine),
    treasury: addressParam(base.treasury, 'VITE_TREASURY_ADDRESS'),
    feeEscrow: addressParam(base.feeEscrow, 'VITE_FEE_ESCROW_ADDRESS'),
    beneficiary: addressParam(query.get('beneficiary'), 'beneficiary'),
  };
}
```

- [ ] **Step 6: Прогнать**

Run: `cd ~/Desktop/rig/web && npx vitest run src/app 2>&1 | tail -4`
Expected: `9 passed`.

- [ ] **Step 7: Checkpoint** — `git status --short`.

---

### Task 3: Контроллер — данные для UI

**Files:**
- Modify: `web/src/miner/controller.ts`, `web/src/miner/__tests__/controller.test.ts`

- [ ] **Step 1: Добавить в `controller.test.ts` тест событий и полей**

```ts
  it('reports events and round timing for the UI', async () => {
    const { engine, chain, controller, advance } = setup();
    engine.rate = 0;
    const events: string[] = [];
    controller.onEvent = (event) => events.push(event.type);
    await controller.tick();
    engine.emitValid(chain.state.challenge);
    await controller.flush();
    const s = controller.snapshot();
    expect(s.roundStartsAt).toBe(1_000_000 * 1000);
    expect(s.roundLength).toBe(600);
    expect(s.releaseBps).toBe(48);
    expect(s.ownWork).toBe(1n << 4n);
    expect(events).toEqual(['round', 'hit', 'submit']);
    advance(600);
    chain.state = state(2n, 1_000_000 - 600);
    await controller.tick();
    expect(events.at(-1)).toBe('round');
  });
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd ~/Desktop/rig/web && npx vitest run src/miner/__tests__/controller.test.ts 2>&1 | tail -4`
Expected: FAIL (`onEvent` не существует / поля `undefined`).

- [ ] **Step 3: Изменить `controller.ts`**

После интерфейса `Snapshot` добавить тип событий; в `Snapshot` — поля; в классе — `onEvent`, `ownWork`, и вызовы.

Добавить перед `export interface Snapshot`:

```ts
export type MinerEvent =
  | { type: 'round'; at: number; round: bigint }
  | { type: 'hit'; at: number; difficulty: number }
  | { type: 'submit'; at: number; count: number; tx: Hex };
```

В `Snapshot` после `roundEndsAt: number;` добавить:

```ts
  roundStartsAt: number;
  roundLength: number;
  releaseBps: number;
  roundWork: bigint;
  /** Work this beneficiary has submitted or buffered in the current round. */
  ownWork: bigint;
```

В классе после `onSnapshot` добавить `onEvent: ((event: MinerEvent) => void) | null = null;` и поле `private ownWork = 0n;`.

В `snapshot()` после `roundEndsAt: …,` добавить:

```ts
      roundStartsAt: s ? (s.genesis + (Number(s.round) - 1) * s.roundLength) * 1000 : 0,
      roundLength: s?.roundLength ?? 0,
      releaseBps: s?.releaseBps ?? 0,
      roundWork: s?.roundWork ?? 0n,
      ownWork: this.ownWork,
```

В `flush()` после успешного submit (`this.batchesSubmitted += 1;`) добавить:

```ts
          this.onEvent?.({ type: 'submit', at: this.now(), count: batch.nonces.length, tx: this.lastTx });
```

В `enterRound()` после `this.segment = 0n;` добавить `this.ownWork = 0n;` и в конце функции `this.onEvent?.({ type: 'round', at: this.now(), round: state.round });`.

В `handleHit()` после `this.buffer.push(hit);` добавить:

```ts
    this.ownWork += 1n << BigInt(hit.difficulty);
    this.onEvent?.({ type: 'hit', at: this.now(), difficulty: hit.difficulty });
```

- [ ] **Step 4: Прогнать**

Run: `cd ~/Desktop/rig/web && npx vitest run 2>&1 | tail -4 && npm run typecheck`
Expected: `64 passed` (54 + 9 + 1), typecheck чистый (страницы ещё не написаны — если `App.tsx` уже есть, typecheck упадёт на импортах страниц; это ожидаемо до Task 6).

- [ ] **Step 5: Checkpoint** — `git status --short`.

---

### Task 4: Кошелёк (EIP-1193)

**Files:**
- Create: `web/src/app/__tests__/wallet.test.ts`, `web/src/app/wallet.ts`

- [ ] **Step 1: Падающий тест `web/src/app/__tests__/wallet.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { localAnvil } from '../../chain/chains';
import { connectWallet, ensureChain, sendEth, type Eip1193Provider } from '../wallet';

class FakeProvider implements Eip1193Provider {
  calls: Array<{ method: string; params?: unknown[] }> = [];
  chainId = '0x1';
  failSwitch = false;
  async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    this.calls.push(args);
    switch (args.method) {
      case 'eth_requestAccounts':
        return ['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'];
      case 'eth_chainId':
        return this.chainId;
      case 'wallet_switchEthereumChain':
        if (this.failSwitch) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
        this.chainId = (args.params![0] as { chainId: string }).chainId;
        return null;
      case 'wallet_addEthereumChain':
        this.chainId = (args.params![0] as { chainId: string }).chainId;
        return null;
      case 'eth_sendTransaction':
        return '0x' + 'ab'.repeat(32);
      default:
        throw new Error(`unexpected ${args.method}`);
    }
  }
}

describe('wallet', () => {
  it('connects and checksums the account', async () => {
    const p = new FakeProvider();
    expect(await connectWallet(p)).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('switches chains, adding the chain when the wallet does not know it', async () => {
    const p = new FakeProvider();
    await ensureChain(p, localAnvil, 'http://127.0.0.1:8545');
    expect(p.chainId).toBe('0x7a69');
    const q = new FakeProvider();
    q.failSwitch = true;
    await ensureChain(q, localAnvil, 'http://127.0.0.1:8545');
    expect(q.calls.map((c) => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
    expect(q.chainId).toBe('0x7a69');
  });

  it('sends eth with a hex value', async () => {
    const p = new FakeProvider();
    const tx = await sendEth(p, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x1111111111111111111111111111111111111111', 10n ** 16n);
    expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
    const call = p.calls.find((c) => c.method === 'eth_sendTransaction')!;
    expect((call.params![0] as { value: string }).value).toBe('0x2386f26fc10000');
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd ~/Desktop/rig/web && npx vitest run src/app/__tests__/wallet.test.ts 2>&1 | tail -3`
Expected: FAIL — `Cannot find module '../wallet'`.

- [ ] **Step 3: Записать `web/src/app/wallet.ts`**

```ts
import { getAddress, numberToHex, type Address, type Chain, type Hex } from 'viem';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** The injected wallet, if any (MetaMask, Rabby, …). */
export function injectedProvider(): Eip1193Provider | null {
  const w = window as unknown as { ethereum?: Eip1193Provider };
  return w.ethereum ?? null;
}

export async function connectWallet(provider: Eip1193Provider): Promise<Address> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts[0]) throw new Error('the wallet returned no account');
  return getAddress(accounts[0]);
}

/** Switches the wallet to `chain`, adding it first when the wallet does not know it (error 4902). */
export async function ensureChain(provider: Eip1193Provider, chain: Chain, rpcUrl: string): Promise<void> {
  const chainId = numberToHex(chain.id);
  const current = (await provider.request({ method: 'eth_chainId' })) as string;
  if (current.toLowerCase() === chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [rpcUrl],
          blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
        },
      ],
    });
  }
}

/** One popup: a plain value transfer from the connected wallet to the session key. */
export async function sendEth(provider: Eip1193Provider, from: Address, to: Address, valueWei: bigint): Promise<Hex> {
  return (await provider.request({ method: 'eth_sendTransaction', params: [{ from, to, value: numberToHex(valueWei) }] })) as Hex;
}
```

- [ ] **Step 4: Прогнать**

Run: `cd ~/Desktop/rig/web && npx vitest run src/app 2>&1 | tail -4`
Expected: `12 passed`.

- [ ] **Step 5: Checkpoint** — `git status --short`.

---

### Task 5: Хук майнера, полоса раунда, страница Mine

**Files:**
- Create: `web/src/app/useMiner.ts`, `web/src/app/RoundBar.tsx`, `web/src/app/pages/Mine.tsx`

- [ ] **Step 1: Записать `web/src/app/useMiner.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { ViemChainReader, ViemHarvester, ViemSubmitter, createClients, unknownPrice, type ChainClients } from '../chain/hashMineChain';
import { CpuEngine } from '../engine/cpuEngine';
import { GpuEngine } from '../engine/gpuEngine';
import type { Engine } from '../engine/types';
import { MinerController, type MinerEvent, type Snapshot } from '../miner/controller';
import { SessionKey } from '../session/sessionKey';
import type { UiConfig } from './config';

export interface MinerSettings {
  cores: number;
  useGpu: boolean;
}

export interface Mark {
  at: number;
  kind: 'hit' | 'submit';
}

const SETTINGS_KEY = 'hashmine.settings';
const HARVEST_CHECK_MS = 30_000;

function defaultSettings(): MinerSettings {
  const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  return { cores, useGpu: true };
}

function loadSettings(): MinerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<MinerSettings>) };
  } catch {
    /* ignore a corrupted value */
  }
  return defaultSettings();
}

export function useMiner(config: UiConfig, beneficiary: Address | null) {
  const sessionKey = useMemo(() => SessionKey.loadOrCreate(localStorage), []);
  const clients = useMemo<ChainClients>(() => createClients(config.chain, config.rpcUrl, sessionKey.account), [config, sessionKey]);
  const [settings, setSettingsState] = useState<MinerSettings>(loadSettings);
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionBalance, setSessionBalance] = useState<bigint | null>(null);
  const [gpuName, setGpuName] = useState<string | null>(null);
  const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

  const controllerRef = useRef<MinerController | null>(null);
  const enginesRef = useRef<Engine[]>([]);
  const harvesterRef = useRef<ViemHarvester | null>(null);

  const setSettings = useCallback((next: MinerSettings) => {
    setSettingsState(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      setSessionBalance(await clients.publicClient.getBalance({ address: sessionKey.address }));
    } catch {
      setSessionBalance(null);
    }
  }, [clients, sessionKey]);

  useEffect(() => {
    void refreshBalance();
    const timer = setInterval(() => void refreshBalance(), 10_000);
    return () => clearInterval(timer);
  }, [refreshBalance]);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    for (const engine of enginesRef.current) engine.stop();
    enginesRef.current = [];
    setRunning(false);
    setStatus('Stopped.');
  }, []);

  const start = useCallback(async () => {
    if (!beneficiary) {
      setStatus('Choose where rewards go first.');
      return;
    }
    if (controllerRef.current) return;
    setStatus('Starting engines…');
    const engines: Engine[] = [];
    if (settings.cores > 0) engines.push(new CpuEngine(settings.cores));
    if (settings.useGpu && gpuAvailable) {
      try {
        const gpu = await GpuEngine.create();
        if (gpu) {
          engines.push(gpu);
          setGpuName([gpu.adapterInfo.vendor, gpu.adapterInfo.architecture].filter(Boolean).join(' ') || 'GPU');
        }
      } catch (error) {
        setStatus(`GPU unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (engines.length === 0) {
      setStatus('No engine selected: enable CPU cores or the GPU.');
      return;
    }
    const controller = new MinerController({
      beneficiary,
      engines,
      chain: new ViemChainReader(clients.publicClient, config.hashMine),
      submitter: new ViemSubmitter(clients, config.hashMine, sessionKey.account),
      price: unknownPrice,
    });
    controller.onSnapshot = (s) => setSnapshot(s);
    controller.onEvent = (event: MinerEvent) => {
      if (event.type === 'round') setMarks([]);
      else setMarks((m) => [...m.slice(-400), { at: event.at, kind: event.type }]);
    };
    enginesRef.current = engines;
    controllerRef.current = controller;
    harvesterRef.current =
      config.treasury && config.feeEscrow ? new ViemHarvester(clients, config.treasury, config.feeEscrow, sessionKey.account) : null;
    controller.start(2000);
    setRunning(true);
    setStatus('Mining.');
  }, [beneficiary, settings, gpuAvailable, clients, config, sessionKey]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void harvesterRef.current?.maybeHarvest(Date.now() / 1000), HARVEST_CHECK_MS);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => () => controllerRef.current?.stop(), []);

  const claim = useCallback(async () => {
    setStatus('Claiming…');
    try {
      const controller = controllerRef.current;
      const tx = controller
        ? await controller.claim()
        : await new ViemSubmitter(clients, config.hashMine, sessionKey.account).claim(beneficiary!);
      setStatus(`Claimed. Transaction ${tx}`);
    } catch (error) {
      setStatus(`Claim failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [clients, config, sessionKey, beneficiary]);

  const forgetKey = useCallback(() => {
    stop();
    SessionKey.forget(localStorage);
    window.location.reload();
  }, [stop]);

  return {
    sessionKey,
    sessionBalance,
    refreshBalance,
    settings,
    setSettings,
    gpuAvailable,
    gpuName,
    running,
    snapshot,
    marks,
    status,
    start,
    stop,
    claim,
    forgetKey,
  };
}
```

- [ ] **Step 2: Записать `web/src/app/RoundBar.tsx`**

```tsx
import type { Mark } from './useMiner';

interface RoundBarProps {
  startsAt: number;
  endsAt: number;
  now: number;
  marks: Mark[];
  /** Seconds before the end at which buffered shares are sent. */
  sendBeforeEndSec: number;
}

/** The round as a timeline: elapsed time fills it, shares and submits leave marks, "send by" is the flush deadline. */
export function RoundBar({ startsAt, endsAt, now, marks, sendBeforeEndSec }: RoundBarProps) {
  const length = Math.max(endsAt - startsAt, 1);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - startsAt) / length) * 100))}%`;
  const sendBy = endsAt - sendBeforeEndSec * 1000;
  return (
    <div>
      <div className="bar" role="img" aria-label={`Round timeline, ${marks.length} marks`}>
        <div className="bar__fill" style={{ width: pct(now) }} />
        <div className="bar__sendby" style={{ left: pct(sendBy) }}>
          <span>send by</span>
        </div>
        {marks.map((mark, i) => (
          <div key={`${mark.at}-${i}`} className={mark.kind === 'submit' ? 'bar__mark bar__mark--submit' : 'bar__mark'} style={{ left: pct(mark.at) }} />
        ))}
        <div className="bar__now" style={{ left: pct(now) }} />
      </div>
      <div className="bar__legend">
        <span>
          <i style={{ background: 'var(--signal)' }} />
          share found
        </span>
        <span>
          <i style={{ background: 'var(--cobalt)' }} />
          batch sent
        </span>
        <span>
          <i style={{ background: 'var(--cobalt-2)' }} />
          elapsed
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Записать `web/src/app/pages/Mine.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { getAddress, isAddress, type Address } from 'viem';
import type { UiConfig } from '../config';
import { formatCountdown, formatEth, formatHashRate, formatTokens, formatWorkBits, shortAddress } from '../format';
import { RoundBar } from '../RoundBar';
import { useMiner } from '../useMiner';
import { connectWallet, ensureChain, injectedProvider, sendEth } from '../wallet';

const BENEFICIARY_KEY = 'hashmine.beneficiary';
const FUND_WEI = 10n ** 16n; // 0.01 ETH
const FLUSH_BEFORE_END_SEC = 20;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function storedBeneficiary(): Address | null {
  const value = localStorage.getItem(BENEFICIARY_KEY);
  return value && isAddress(value) ? getAddress(value) : null;
}

export function Mine({ config }: { config: UiConfig }) {
  const [beneficiary, setBeneficiary] = useState<Address | null>(() => config.beneficiary ?? storedBeneficiary());
  const [walletAccount, setWalletAccount] = useState<Address | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const miner = useMiner(config, beneficiary);
  const now = useNow();
  const s = miner.snapshot;
  const provider = injectedProvider();

  const chooseBeneficiary = (address: Address) => {
    setBeneficiary(address);
    localStorage.setItem(BENEFICIARY_KEY, address);
  };

  const connect = async () => {
    if (!provider) return;
    try {
      const account = await connectWallet(provider);
      setWalletAccount(account);
      chooseBeneficiary(account);
      setWalletStatus(null);
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const fund = async () => {
    if (!provider || !walletAccount) return;
    try {
      setWalletStatus('Confirm the transfer in your wallet…');
      await ensureChain(provider, config.chain, config.rpcUrl);
      const tx = await sendEth(provider, walletAccount, miner.sessionKey.address, FUND_WEI);
      setWalletStatus(`Sent. Transaction ${tx}`);
      setTimeout(() => void miner.refreshBalance(), 3000);
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const expectedThisRound =
    s && s.roundWork + s.ownWork > 0n
      ? (s.rewardPool * BigInt(s.releaseBps) * s.ownWork) / (10_000n * (s.roundWork > s.ownWork ? s.roundWork : s.ownWork))
      : 0n;

  return (
    <>
      <section className="round" aria-label="Current round">
        <div className="round__head">
          <div>
            <div className="round__label">Round</div>
            <div className="round__number" data-testid="round">
              {s ? s.round.toString() : '—'}
            </div>
          </div>
          <div>
            <div className="round__label">Ends in</div>
            <div className="round__number">{s ? formatCountdown(s.roundEndsAt - now) : '—'}</div>
          </div>
          <div>
            <div className="round__label">Network minimum</div>
            <div className="round__number">{s ? `${s.minDifficulty} bits` : '—'}</div>
          </div>
          <div>
            <div className="round__label">Round work so far</div>
            <div className="round__number">{s ? formatWorkBits(s.roundWork) : '—'}</div>
          </div>
        </div>
        <RoundBar startsAt={s?.roundStartsAt ?? now} endsAt={s?.roundEndsAt ?? now + 1} now={now} marks={miner.marks} sendBeforeEndSec={FLUSH_BEFORE_END_SEC} />
      </section>

      <div className="grid">
        <section className="card" aria-label="Your miner">
          <div className="big" data-testid="hash-rate">
            {formatHashRate(s?.hashRate ?? 0)}
          </div>
          <dl className="kv">
            <dt>Engines</dt>
            <dd>
              {miner.settings.cores} CPU core{miner.settings.cores === 1 ? '' : 's'}
              {miner.settings.useGpu && miner.gpuAvailable ? ` · GPU${miner.gpuName ? ` (${miner.gpuName})` : ''}` : ''}
            </dd>
            <dt>Your difficulty</dt>
            <dd>{s ? `${s.difficulty} bits` : '—'}</dd>
            <dt>Shares found</dt>
            <dd data-testid="shares-found">{s?.hitsFound ?? 0}</dd>
            <dt>Shares sent</dt>
            <dd data-testid="shares-sent">
              {s?.sharesSubmitted ?? 0}
              {s && s.buffered > 0 ? ` (+${s.buffered} waiting)` : ''}
            </dd>
            <dt>Your work this round</dt>
            <dd>{s ? formatWorkBits(s.ownWork) : '—'}</dd>
          </dl>
          <div className="field">
            <label htmlFor="cores">CPU cores</label>
            <input
              id="cores"
              type="number"
              min={0}
              max={64}
              value={miner.settings.cores}
              disabled={miner.running}
              onChange={(e) => miner.setSettings({ ...miner.settings, cores: Math.max(0, Math.min(64, Number(e.target.value) || 0)) })}
            />
            <label>
              <input
                type="checkbox"
                checked={miner.settings.useGpu}
                disabled={miner.running || !miner.gpuAvailable}
                onChange={(e) => miner.setSettings({ ...miner.settings, useGpu: e.target.checked })}
              />{' '}
              GPU{miner.gpuAvailable ? '' : ' (no WebGPU in this browser)'}
            </label>
          </div>
          <div className="actions">
            {miner.running ? (
              <button className="btn" onClick={miner.stop} data-testid="stop-button">
                Stop mining
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => void miner.start()} data-testid="start-button" disabled={!beneficiary}>
                Start mining
              </button>
            )}
          </div>
          <p className="status" data-testid="status">
            {miner.status ?? (beneficiary ? 'Ready.' : 'Choose where rewards go, then start.')}
            {s?.lastError && <span className="error"> {s.lastError}</span>}
            {s?.engineErrors.map((e) => (
              <span key={e} className="error">
                {' '}
                {e}
              </span>
            ))}
          </p>
        </section>

        <section className="card" aria-label="Rewards">
          <div className="big">
            {formatTokens(s?.rewardPool ?? 0n)}
            <small>in the pool</small>
          </div>
          <dl className="kv">
            <dt>Released per round</dt>
            <dd>{s ? `${(s.releaseBps / 100).toFixed(2)}% ≈ ${formatTokens((s.rewardPool * BigInt(s.releaseBps)) / 10_000n)}` : '—'}</dd>
            <dt>Your estimate this round</dt>
            <dd>{s ? formatTokens(expectedThisRound) : '—'}</dd>
            <dt>Claimable now</dt>
            <dd data-testid="pending">{s ? formatTokens(s.pending) : '—'}</dd>
          </dl>
          <div className="actions">
            <button className="btn btn--ghost" onClick={() => void miner.claim()} disabled={!beneficiary || !s || s.pending === 0n}>
              Claim rewards
            </button>
          </div>
          <p className="muted status">Rewards are credited on chain to the beneficiary and can be claimed by anyone on its behalf.</p>
        </section>
      </div>

      <section className="card" aria-label="Accounts" style={{ marginTop: 24 }}>
        <dl className="kv">
          <dt>Rewards go to</dt>
          <dd data-testid="beneficiary">{beneficiary ?? '— not chosen'}</dd>
          <dt>Session key</dt>
          <dd data-testid="session-address">{miner.sessionKey.address}</dd>
          <dt>Session key balance</dt>
          <dd data-testid="session-balance">{miner.sessionBalance === null ? '—' : `${formatEth(miner.sessionBalance)} ETH`}</dd>
        </dl>
        <p className="muted status">
          The session key lives in this browser and only pays gas for submitting shares. Keep at least 0.005 ETH on it. It never receives rewards.
        </p>
        <div className="actions">
          {provider ? (
            <>
              <button className="btn btn--ghost" onClick={() => void connect()} disabled={miner.running}>
                {walletAccount ? `Wallet ${shortAddress(walletAccount)}` : 'Connect wallet'}
              </button>
              <button className="btn btn--ghost" onClick={() => void fund()} disabled={!walletAccount}>
                Fund session key with 0.01 ETH
              </button>
            </>
          ) : (
            <span className="muted">No wallet extension found: send ETH to the session key address to pay for gas.</span>
          )}
          <button className="btn btn--ghost" onClick={() => alert(miner.sessionKey.exportPrivateKey())}>
            Show private key
          </button>
          <button className="btn btn--ghost" onClick={miner.forgetKey} disabled={miner.running}>
            Forget key
          </button>
        </div>
        {!config.beneficiary && (
          <div className="field">
            <label htmlFor="beneficiary">Or type the address rewards should go to</label>
            <input
              id="beneficiary"
              className="mono"
              placeholder="0x…"
              value={addressInput}
              disabled={miner.running}
              onChange={(e) => setAddressInput(e.target.value)}
            />
            <button
              className="btn btn--ghost"
              disabled={miner.running || !isAddress(addressInput)}
              onClick={() => chooseBeneficiary(getAddress(addressInput))}
            >
              Use this address
            </button>
          </div>
        )}
        {walletStatus && <p className="status">{walletStatus}</p>}
      </section>
    </>
  );
}
```

- [ ] **Step 4: Checkpoint** — `git status --short` (typecheck после Task 6).

---

### Task 6: Stats, Docs, сборка

**Files:**
- Create: `web/src/app/__tests__/stats.test.ts`, `web/src/app/stats.ts`, `web/src/app/pages/Stats.tsx`, `web/src/app/pages/Docs.tsx`

- [ ] **Step 1: Падающий тест `web/src/app/__tests__/stats.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { blockRanges, summarizeMiners } from '../stats';

describe('stats', () => {
  it('counts unique beneficiaries and shares', () => {
    const summary = summarizeMiners([
      { beneficiary: '0xa', count: 3 },
      { beneficiary: '0xA', count: 1 },
      { beneficiary: '0xb', count: 64 },
    ]);
    expect(summary).toEqual({ miners: 2, shares: 68, batches: 3 });
  });

  it('splits a block span into chunks that end at the latest block', () => {
    expect(blockRanges(1000n, 250, 100)).toEqual([
      [751n, 1000n],
      [651n, 750n],
      [551n, 650n],
    ]);
    expect(blockRanges(50n, 250, 100)).toEqual([[0n, 50n]]);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd ~/Desktop/rig/web && npx vitest run src/app/__tests__/stats.test.ts 2>&1 | tail -3`
Expected: FAIL — `Cannot find module '../stats'`.

- [ ] **Step 3: Записать `web/src/app/stats.ts`**

```ts
import { parseAbiItem, type Address, type PublicClient } from 'viem';
import { hashMineAbi } from '../chain/abi/hashMine';

export interface RoundRow {
  round: bigint;
  work: bigint;
  release: bigint;
  minDifficulty: number;
  closed: boolean;
  active: boolean;
}

export interface ShareEntry {
  beneficiary: string;
  count: number;
}

export interface MinerSummary {
  miners: number;
  shares: number;
  batches: number;
}

const SHARE_BATCH = parseAbiItem(
  'event ShareBatch(address indexed beneficiary, uint256 indexed round, uint8 difficulty, uint256 count, uint256 work, bytes32 lastHash)',
);

/** Last `count` rounds up to and including `latest`, newest first. */
export async function loadRounds(client: PublicClient, hashMine: Address, latest: bigint, count: number): Promise<RoundRow[]> {
  const rounds: bigint[] = [];
  for (let r = latest; r >= 1n && rounds.length < count; r--) rounds.push(r);
  const infos = await Promise.all(
    rounds.map((round) => client.readContract({ address: hashMine, abi: hashMineAbi, functionName: 'roundInfo', args: [round] })),
  );
  return rounds.map((round, i) => {
    const info = infos[i]!;
    return {
      round,
      work: info.work,
      release: info.closed ? (info.rewardPerWork * info.work) / 10n ** 36n : 0n,
      minDifficulty: info.minDifficulty,
      closed: info.closed,
      active: info.work > 0n,
    };
  });
}

/** [from, to] block ranges covering the last `span` blocks in chunks of `chunk`, newest first. */
export function blockRanges(latest: bigint, span: number, chunk: number): Array<[bigint, bigint]> {
  const ranges: Array<[bigint, bigint]> = [];
  let to = latest;
  const floor = latest > BigInt(span) ? latest - BigInt(span) : 0n;
  while (to >= floor) {
    const from = to - BigInt(chunk) + 1n > floor ? to - BigInt(chunk) + 1n : floor;
    ranges.push([from, to]);
    if (from === floor) break;
    to = from - 1n;
  }
  return ranges;
}

export async function loadShareEntries(client: PublicClient, hashMine: Address, span: number, chunk = 2000): Promise<ShareEntry[]> {
  const latest = await client.getBlockNumber();
  const entries: ShareEntry[] = [];
  for (const [fromBlock, toBlock] of blockRanges(latest, span, chunk)) {
    const logs = await client.getLogs({ address: hashMine, event: SHARE_BATCH, fromBlock, toBlock });
    for (const log of logs) entries.push({ beneficiary: log.args.beneficiary!, count: Number(log.args.count!) });
  }
  return entries;
}

export function summarizeMiners(entries: ShareEntry[]): MinerSummary {
  const miners = new Set(entries.map((e) => e.beneficiary.toLowerCase()));
  return { miners: miners.size, shares: entries.reduce((sum, e) => sum + e.count, 0), batches: entries.length };
}
```

- [ ] **Step 4: Записать `web/src/app/pages/Stats.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, http } from 'viem';
import { hashMineAbi } from '../../chain/abi/hashMine';
import type { UiConfig } from '../config';
import { formatTokens, formatWorkBits } from '../format';
import { loadRounds, loadShareEntries, summarizeMiners, type MinerSummary, type RoundRow } from '../stats';

const ROUNDS = 24;
/** Blocks scanned for ShareBatch events: ~1 h on Robinhood Chain (100 ms blocks). */
const BLOCK_SPAN = 36_000;

export function Stats({ config }: { config: UiConfig }) {
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [summary, setSummary] = useState<MinerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
      const current = await client.readContract({ address: config.hashMine, abi: hashMineAbi, functionName: 'currentRound' });
      const [rows, entries] = await Promise.all([loadRounds(client, config.hashMine, current, ROUNDS), loadShareEntries(client, config.hashMine, BLOCK_SPAN)]);
      setRounds(rows);
      setSummary(summarizeMiners(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <div className="grid">
        <section className="card" aria-label="Miners">
          <div className="big" data-testid="unique-miners">
            {summary ? summary.miners : '—'}
            <small>miners in the last {BLOCK_SPAN.toLocaleString('en-US')} blocks</small>
          </div>
          <dl className="kv">
            <dt>Shares</dt>
            <dd>{summary ? summary.shares : '—'}</dd>
            <dt>Batches</dt>
            <dd>{summary ? summary.batches : '—'}</dd>
          </dl>
        </section>
        <section className="card">
          <p className="muted">A miner counts once per window, however many shares it sent. Rounds without a single share release nothing and do not catch up later.</p>
          <div className="actions">
            <button className="btn btn--ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {error && <p className="error status">{error}</p>}
        </section>
      </div>
      <section className="card" style={{ marginTop: 24 }} aria-label="Rounds">
        <h2>Last {ROUNDS} rounds</h2>
        <div className="table-wrap">
          <table className="table" data-testid="rounds-table">
            <thead>
              <tr>
                <th>Round</th>
                <th>Minimum</th>
                <th>Work</th>
                <th>Released</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {(rounds ?? []).map((r) => (
                <tr key={r.round.toString()}>
                  <td>{r.round.toString()}</td>
                  <td>{r.active ? `${r.minDifficulty} bits` : '—'}</td>
                  <td>{r.active ? formatWorkBits(r.work) : '—'}</td>
                  <td>{r.closed ? formatTokens(r.release) : '—'}</td>
                  <td>{r.closed ? 'closed' : r.active ? 'open' : 'empty'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 5: Записать `web/src/app/pages/Docs.tsx`**

```tsx
import type { UiConfig } from '../config';

export function Docs({ config }: { config: UiConfig }) {
  return (
    <article className="prose">
      <h1>How mining works</h1>
      <p>
        Your browser hashes <code>keccak256(your address ‖ round challenge ‖ nonce)</code> until the result starts with enough zero bits. Each such
        hash is a share. Shares are sent to the HashMine contract in batches of up to 64, and the contract recomputes every hash before it counts.
      </p>
      <h2>Rounds</h2>
      <p>
        A round lasts {config.chain.id === 31337 ? '30 seconds on this local chain' : '10 minutes'}. When a round with at least one share ends, the
        contract releases 0.48% of its token balance and splits it between everyone who sent shares, in proportion to work. A share of difficulty D
        counts as 2<sup>D</sup> work. Empty rounds release nothing and never catch up.
      </p>
      <h2>Difficulty</h2>
      <p>
        The contract sets a minimum difficulty from the work of the last active round, aiming at about 4 096 shares per round, and lowers it one bit
        for every empty round. Your miner picks its own difficulty above that minimum so that it finds about 32 shares per round and each share is
        worth at least twice the gas it costs to send.
      </p>
      <h2>Where the tokens come from</h2>
      <p>
        Trading the token pays a 3% fee. The part that reaches the project is spent buying the token back on the market and sending it to the mining
        pool. Nothing is minted, nothing is reserved for the team: the pool is exactly what buybacks and donations put there.
      </p>
      <h2>Keys</h2>
      <p>
        The session key in this browser only pays gas. Rewards go to the beneficiary address bound inside every hash, so a stolen share is worthless to
        anyone else, and anyone can call <code>claim</code> on your behalf without being able to redirect it.
      </p>
      <h2>Contracts</h2>
      <dl className="kv">
        <dt>Network</dt>
        <dd>
          {config.chain.name} (chain id {config.chain.id})
        </dd>
        <dt>HashMine</dt>
        <dd>{config.hashMine}</dd>
        {config.treasury && (
          <>
            <dt>Treasury</dt>
            <dd>{config.treasury}</dd>
          </>
        )}
        <dt>RPC</dt>
        <dd>{config.rpcUrl}</dd>
      </dl>
    </article>
  );
}
```

- [ ] **Step 6: Прогнать всё и собрать**

Run: `cd ~/Desktop/rig/web && npx vitest run 2>&1 | tail -4 && npm run typecheck && npm run build 2>&1 | tail -4`
Expected: `66 passed` (54 + 9 + 1 + 3 + 2... см. итог в отчёте), typecheck чистый, `vite build` без ошибок.

- [ ] **Step 7: Checkpoint** — `git status --short`.

---

### Task 7: UI e2e на anvil

**Files:**
- Create: `web/scripts/lib/localChain.mjs`, `web/scripts/e2e-ui.mjs`
- Modify: `web/scripts/e2e-local.mjs` (использовать `localChain.mjs`)

- [ ] **Step 1: Записать `web/scripts/lib/localChain.mjs`**

```js
// Shared e2e bootstrap: anvil with 1 s blocks, DeployLocal, a funder from anvil account 0.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Starts anvil, deploys HashMine + mock token, returns clients and a stop() that kills anvil. */
export async function startLocalChain() {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['-p', String(port), '-b', '1', '--silent'], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    execFileSync(
      'forge',
      ['script', 'script/DeployLocal.s.sol:DeployLocal', '--rpc-url', rpcUrl, '--broadcast', '--private-key', ANVIL_KEY, '--silent'],
      { cwd: `${ROOT}contracts`, stdio: 'inherit' },
    );
  } catch (error) {
    anvil.kill();
    throw error;
  }
  const broadcast = JSON.parse(readFileSync(`${ROOT}contracts/broadcast/DeployLocal.s.sol/31337/run-latest.json`, 'utf8'));
  const hashMine = broadcast.transactions.find((t) => t.contractName === 'HashMine').contractAddress;
  const token = broadcast.transactions.find((t) => t.contractName === 'MockERC20').contractAddress;
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const funder = createWalletClient({ account: privateKeyToAccount(ANVIL_KEY), transport: http(rpcUrl) });
  return {
    rpcUrl,
    hashMine,
    token,
    publicClient,
    async fund(address, eth = '1') {
      const hash = await funder.sendTransaction({ to: address, value: parseEther(eth), chain: null });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    stop() {
      anvil.kill();
    },
  };
}
```

- [ ] **Step 2: Переписать `web/scripts/e2e-local.mjs` на общий модуль**

```js
// End-to-end: anvil -> DeployLocal -> fund a session key -> mine in headless Chromium -> check chain state.
// Env: RIG_CHROME (browser binary), E2E_SECONDS (default 75), E2E_CORES (default 2), E2E_GPU (default 1).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { parseAbiItem } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'vite';
import { startLocalChain } from './lib/localChain.mjs';

const CHROME =
  process.env.RIG_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SECONDS = Number(process.env.E2E_SECONDS ?? 75);
const CORES = Number(process.env.E2E_CORES ?? 2);
const USE_GPU = (process.env.E2E_GPU ?? '1') === '1';

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(CHROME)) {
  console.log(`FAIL browser binary not found: ${CHROME}`);
  process.exit(1);
}

const chain = await startLocalChain();
let vite;
let browser;
try {
  const { rpcUrl, hashMine, token, publicClient } = chain;
  console.log(`anvil ${rpcUrl}; HashMine ${hashMine}; token ${token}`);
  const sessionKey = generatePrivateKey();
  const session = privateKeyToAccount(sessionKey);
  const beneficiary = privateKeyToAccount(generatePrivateKey()).address;
  await chain.fund(session.address);

  vite = await createServer({ configFile: 'vite.config.ts', server: { port: 0 }, logLevel: 'error' });
  await vite.listen();
  const url = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'] });
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto(`${url}browser-tests/e2e.html`);
  await page.waitForFunction(() => typeof window.hashmineE2E === 'object');
  const result = await page.evaluate(
    (config) => window.hashmineE2E.run(config),
    { rpcUrl, hashMine, sessionPrivateKey: sessionKey, beneficiary, cores: CORES, useGpu: USE_GPU, seconds: SECONDS },
  );
  console.log(result.log.slice(-12).join('\n'));
  const s = result.snapshot;
  check(s.engineErrors.length === 0, `no engine errors (${s.engineErrors.join('; ')})`);
  check(s.hitsFound > 0, `hits found: ${s.hitsFound}`);
  check(s.batchesSubmitted > 0, `batches submitted: ${s.batchesSubmitted} (${s.sharesSubmitted} shares)`);

  const shareLogs = await publicClient.getLogs({
    address: hashMine,
    event: parseAbiItem('event ShareBatch(address indexed beneficiary, uint256 indexed round, uint8 difficulty, uint256 count, uint256 work, bytes32 lastHash)'),
    args: { beneficiary },
    fromBlock: 0n,
  });
  const onChainShares = shareLogs.reduce((sum, l) => sum + Number(l.args.count), 0);
  check(onChainShares === s.sharesSubmitted, `ShareBatch events on chain: ${onChainShares} shares in ${shareLogs.length} batches`);
  const closed = await publicClient.getLogs({
    address: hashMine,
    event: parseAbiItem('event RoundClosed(uint256 indexed round, uint256 work, uint256 release)'),
    fromBlock: 0n,
  });
  check(closed.length > 0, `rounds closed: ${closed.length}`);
  const balance = await publicClient.readContract({
    address: token,
    abi: [parseAbiItem('function balanceOf(address) view returns (uint256)')],
    functionName: 'balanceOf',
    args: [beneficiary],
  });
  check(result.claimTx !== null && balance > 0n, `claimed ${balance} token-wei to beneficiary (tx ${result.claimTx})`);
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  chain.stop();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\ne2e passed');
```

- [ ] **Step 3: Записать `web/scripts/e2e-ui.mjs`**

```js
// UI end-to-end: the real Mine page against anvil. Starts mining, waits for shares on screen and on chain,
// opens Stats, saves screenshots to e2e-artifacts/. Env: RIG_CHROME, E2E_UI_TIMEOUT (default 120 s).
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { parseAbiItem } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'vite';
import { startLocalChain } from './lib/localChain.mjs';

const CHROME =
  process.env.RIG_CHROME ??
  `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const TIMEOUT_MS = Number(process.env.E2E_UI_TIMEOUT ?? 120) * 1000;
const ARTIFACTS = 'e2e-artifacts';

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(CHROME)) {
  console.log(`FAIL browser binary not found: ${CHROME}`);
  process.exit(1);
}
mkdirSync(ARTIFACTS, { recursive: true });

const chain = await startLocalChain();
let vite;
let browser;
try {
  const { rpcUrl, hashMine, publicClient } = chain;
  const beneficiary = privateKeyToAccount(generatePrivateKey()).address;
  vite = await createServer({ configFile: 'vite.config.ts', server: { port: 0 }, logLevel: 'error' });
  await vite.listen();
  const url = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  const query = new URLSearchParams({ chain: 'local', rpc: rpcUrl, hashMine, beneficiary });
  await page.goto(`${url}?${query.toString()}#/mine`);

  const sessionAddress = (await page.getByTestId('session-address').textContent({ timeout: 15_000 })).trim();
  check(/^0x[0-9a-fA-F]{40}$/.test(sessionAddress), `session key shown: ${sessionAddress}`);
  await chain.fund(sessionAddress, '0.5');
  await page.waitForFunction(() => !document.querySelector('[data-testid="session-balance"]').textContent.includes('—'), null, { timeout: 30_000 });
  check((await page.getByTestId('session-balance').textContent()).includes('0.5000 ETH'), 'session balance shows 0.5000 ETH');
  check((await page.getByTestId('beneficiary').textContent()).trim() === beneficiary, 'beneficiary from the URL is shown');

  await page.getByLabel('CPU cores').fill('2');
  await page.getByTestId('start-button').click();
  await page.waitForFunction(() => /MH\/s|kH\/s/.test(document.querySelector('[data-testid="hash-rate"]').textContent), null, { timeout: 30_000 });
  console.log('hash rate:', (await page.getByTestId('hash-rate').textContent()).trim());
  await page.waitForFunction(() => Number.parseInt(document.querySelector('[data-testid="shares-sent"]').textContent, 10) > 0, null, { timeout: TIMEOUT_MS });
  const sent = Number.parseInt((await page.getByTestId('shares-sent').textContent()).trim(), 10);
  check(sent > 0, `shares sent on screen: ${sent}`);
  check((await page.locator('.bar__mark').count()) > 0, 'round bar shows share marks');
  await page.screenshot({ path: `${ARTIFACTS}/mine.png`, fullPage: true });

  const logs = await publicClient.getLogs({
    address: hashMine,
    event: parseAbiItem('event ShareBatch(address indexed beneficiary, uint256 indexed round, uint8 difficulty, uint256 count, uint256 work, bytes32 lastHash)'),
    args: { beneficiary },
    fromBlock: 0n,
  });
  const onChain = logs.reduce((sum, l) => sum + Number(l.args.count), 0);
  check(onChain >= sent, `ShareBatch on chain: ${onChain} shares`);

  await page.getByTestId('stop-button').click();
  check((await page.getByTestId('status').textContent()).includes('Stopped'), 'status says Stopped');

  await page.goto(`${url}?${query.toString()}#/stats`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="rounds-table"] tbody tr').length > 0, null, { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="unique-miners"]').textContent.startsWith('—'), null, { timeout: 30_000 });
  const miners = (await page.getByTestId('unique-miners').textContent()).trim();
  check(miners.startsWith('1'), `stats shows 1 unique miner (${miners})`);
  await page.screenshot({ path: `${ARTIFACTS}/stats.png`, fullPage: true });

  await page.goto(`${url}?${query.toString()}#/docs`);
  check((await page.locator('h1').textContent()).includes('How mining works'), 'docs page renders');
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  chain.stop();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`\nui e2e passed; screenshots in web/${ARTIFACTS}/`);
```

- [ ] **Step 4: Прогнать оба e2e**

Run: `cd ~/Desktop/rig/web && npm run test:e2e 2>&1 | tail -3 && npm run test:e2e-ui 2>&1 | tail -14`
Expected: `e2e passed`; `ui e2e passed`, все строки `ok`, скриншоты `web/e2e-artifacts/mine.png`, `stats.png`.

- [ ] **Step 5: Посмотреть скриншот и оценить дизайн** — открыть `web/e2e-artifacts/mine.png`; критерии: полоса раунда читается как таймлайн, засечки видны, крупная цифра хешрейта, нет переполнений на 1200px; затем `resize` до 400px в браузерных инструментах и повторить проверку вручную.

- [ ] **Step 6: Checkpoint** — `git status --short`.

---

## Self-Review

- **§6.3:** сессионный ключ в браузере, пополнение одним попапом (`ensureChain` + `sendEth`), баланс, экспорт, забыть — Task 4–5. Награды на сессионный ключ не приходят — гарантия контракта, в UI сказано.
- **§6.4 harvest:** `ViemHarvester.maybeHarvest` раз в 30 с при работающем майнере, если заданы `treasury`/`feeEscrow` — Task 5.
- **§6.5:** Mine (движки, хешрейт, найдено/отправлено, таймер, пул, ожидание, pending/claim, ключ), Stats (раунды из `roundInfo`, уникальные майнеры из `ShareBatch` за окно блоков), Docs — Task 5–6. Ограничение: суточная метрика заменена окном в 36 000 блоков (~1 ч на Robinhood); полноценная суточная статистика требует индексатора — вне v1.
- **§6.6:** RPC из `VITE_RPC_URL` (env) или `?rpc=`.
- **Дизайн:** сигнатура — полоса раунда; палитра и шрифты заданы токенами; фокус видим (`:focus-visible`), reduced-motion учтён, сетка складывается в одну колонку на ≤720px.
- **Имена:** `Snapshot.roundStartsAt/roundLength/releaseBps/roundWork/ownWork`, `MinerEvent`, `useMiner()` → `{sessionKey, sessionBalance, settings, running, snapshot, marks, status, start, stop, claim, forgetKey}`, testid’ы `session-address`, `session-balance`, `beneficiary`, `hash-rate`, `shares-sent`, `start-button`, `stop-button`, `status`, `rounds-table`, `unique-miners` одинаковы в компонентах и `e2e-ui.mjs`.

---

## Отклонения при исполнении (2026-09-14)

1. **Файлы из плана извлекались скриптом** (`scratchpad/extract_plan.py`): сначала тесты (красный прогон — четыре `Cannot find module`), потом реализация. Первый запуск записал их в `web/web/` из-за неверного корня; папка удалена, извлечение повторено.
2. **Тесты, поправленные под факт:** `formatTokens` группирует узким пробелом ` ` (ожидание в тесте было с обычным пробелом); `blockRanges(1000, 250, 100)` даёт `[901,1000],[801,900],[750,800]` — ожидание в плане было посчитано неверно; порог скорости WASM в `wasm.test.ts` снижен до 0.5 MH/s: vitest гоняет файлы параллельно, под нагрузкой 1.1 MH/s при 5.2 в одиночку — это sanity-проверка, не бенчмарк.
3. **`.card + .card { margin-top }`** сдвигал вторую карточку в сетке (та самая ловушка селекторов). Правило удалено, отступ у карточки аккаунтов задан инлайн.
4. **«Claimable now» → «Pending»**: `HashMine.pending()` включает оценку открытого раунда, `claim` её не выплачивает. Подпись и пояснение исправлены.
5. **UI e2e:** гонка с балансом сессионного ключа (первое чтение до пополнения) — ожидание переписано на конкретную сумму; добавлена проверка отсутствия горизонтального скролла на 400px и скриншот `mine-mobile.png`; «1 miners» → «1 miner».
6. **vitest:** 69 тестов (54 + format 6 + config 3 + wallet 3 + stats 2 + controller events 1).

---

## Рестайл под подачу hashcats.fun (2026-09-14, по просьбе пользователя)

Референс снят с живого сайта (computed styles): фон `#07070a`, текст `#dee9fc`/`#b9c4dd`, панели `#1d1f26`/`#2b2d33`, рамка `#3b3a45`, лайм `#add064`, зелёный `#65b24c`, циан `#6fd3d5`, янтарь `#eabe57`; шрифты DotGothic16 (текст), Jersey 10 (заголовки и подписи капсом с разрядкой 2.24px), VT323 (цифры); сетка 3px, радиусы 0, рамки 9-slice.

Что сделано:
- `scripts/gen-frames.mjs` → `src/app/pixel-frames.css`: собственные 9-slice рамки (SVG data URI, ступенчатые углы, фаска), 5 вариантов: night, work (лайм), green, ghost, input.
- `styles.css` переписан целиком; `main.tsx` грузит `@fontsource/{dotgothic16,jersey-10,vt323}`, старые шрифты удалены из зависимостей.
- Новый компонент `HashStrip.tsx`: последняя найденная шара как 256 пиксельных бит (4×64), ведущие нули — лаймом, плюс hex с подсветкой. Контроллер теперь кладёт `hash` и `bits` в событие `hit` (`MinerEvent`), `useMiner` хранит `lastShare`.
- Страницы перестроены в одну колонку 760px с панелями: MINER (рамка становится лаймовой при майнинге, статус с мигающей точкой), ROUND (циановая шапка), REWARDS, KEYS; сегмент CPU|GPU + ползунок ядер; пиксельный чекерный разделитель; футер в три колонки; пиксельная иконка видеокарты в бренде.
- e2e-ui: ядра задаются через `input[type=range]` (fill не работает для range — значение ставится через нативный сеттер + событие `input`), проверка `.hashstrip__bit--lead ≥ 8`, скриншот `docs.png`.

Отклонения: `Write` не смог перезаписать файлы, созданные скриптом извлечения (не были прочитаны) — записаны через shell. Заголовок Docs сменился на «How it works», e2e-проверка обновлена. Ненажатые кнопки сегмента при работе майнера тускнеют, нажатые остаются лаймовыми (иначе оба гасли в оливковый).
