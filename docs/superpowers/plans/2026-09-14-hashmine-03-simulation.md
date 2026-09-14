# HashMine Parameter Simulation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверить стартовые параметры `HashMine` (§5.1: раунд 600 с, выпуск 0.48%, 4096 шар, порог 20 бит) на сценариях §7 п.6. Получить цифры: награда и газ на майнера в сутки, доля раундов, где отправка выгоднее газа, доля фермы.

**Architecture:** Один скрипт на Python stdlib `sim/hashmine_sim.py`: модель раундов, сложности, газа и пула. Формулы `bits`/`minDifficulty` повторяют контракт и проверяются теми же векторами, что в `HashMine.t.sol`. Тесты — `unittest` в `sim/test_hashmine_sim.py`. Результаты — `sim/RESULTS.md`.

**Tech Stack:** Python 3.9 stdlib (`random`, `math`, `dataclasses`, `unittest`, `json`, `argparse`).

**Спека:** §5.1, §6.4, §7 п.6. **Git:** коммиты только по команде пользователя.

---

## Модель

- Раунд `r`: минимальная сложность `D` считается по работе якоря, как в контракте. Раунд без отправленных шар не активен: выпуска нет, `gap` растёт.
- Майнер с хешрейтом `h` находит за раунд `Poisson(h · 600 / 2^D)` шар. Каждая шара весит `2^D`.
- Клиент (§6.4) отправляет шары батчами по ≤ 64, но только если ожидаемая награда ≥ 2 × стоимость газа всех батчей. Ожидаемая награда = `pool · 0.48% · работа_майнера / ожидаемая_работа_сети`.
- Газ батча из `n` шар: исполнение по замеру плана 01 (`48 007` при n=1, `80 658` при n=64, линейно между ними) плюс calldata `16 · (4 + 32 · (5 + n))`.
- Пул в USD: каждый раунд приходит `суточный_оборот · 2.7% / 144`. При закрытии активного раунда выпускается `pool · 48 / 10000`, делится по работе.
- Цена токена в модели не меняется, награды считаются в USD.

## Сценарии

| Имя | Майнеры | Оборот, $/сутки | Газ, gwei |
|---|---|---|---|
| `baseline` | 1 ферма 6 GH/s; 333 × 50 MH/s, 333 × 150 MH/s, 334 × 250 MH/s (браузер GPU); 1000 × 23.2 MH/s (4 ядра CPU) | 100 000 все 7 дней | 0.0735 |
| `spike_decay` | как baseline | 1 000 000, дальше ×0.5 каждый день | 0.0735 |
| `gas_10x` | как baseline | 100 000 | 0.735 |
| `dead_volume` | как baseline | 200 000 в день 1, дальше 0 | 0.0735 |

---

### Task 1: Функции модели и тесты

**Files:**
- Create: `sim/hashmine_sim.py`
- Create: `sim/test_hashmine_sim.py`

- [ ] **Step 1: Записать падающие тесты `sim/test_hashmine_sim.py`**

```python
import random
import unittest

from hashmine_sim import MinerGroup, Params, Scenario, batch_gas, bits, min_difficulty, poisson, simulate


class ContractFormulaTest(unittest.TestCase):
    def test_bits_matches_contract_vectors(self):
        # Same vectors as HashMine.t.sol (targetShares = 4).
        self.assertEqual(bits(1024, 4), 8)
        self.assertEqual(bits(320, 4), 7)
        self.assertEqual(bits(4, 4), 0)
        self.assertEqual(bits(5, 4), 1)

    def test_min_difficulty_decays_one_bit_per_empty_round_and_clamps(self):
        p = Params(target_shares=4, min_difficulty=4)
        self.assertEqual(min_difficulty(1024, 0, p), 8)
        self.assertEqual(min_difficulty(1024, 1, p), 7)
        self.assertEqual(min_difficulty(1024, 3, p), 5)
        self.assertEqual(min_difficulty(1024, 94, p), 4)
        self.assertEqual(min_difficulty(0, 0, Params()), 20)

    def test_batch_gas_hits_measured_endpoints(self):
        self.assertEqual(batch_gas(1), 48_007 + 16 * (4 + 32 * 6))
        self.assertEqual(batch_gas(64), 80_658 + 16 * (4 + 32 * 69))


class SamplerTest(unittest.TestCase):
    def test_poisson_mean(self):
        rng = random.Random(7)
        for lam in (0.3, 5.0, 400.0):
            samples = [poisson(rng, lam) for _ in range(20_000)]
            self.assertAlmostEqual(sum(samples) / len(samples), lam, delta=max(0.05, lam * 0.02))


class SimulationTest(unittest.TestCase):
    def _scenario(self, volume):
        return Scenario(
            name="t",
            groups=[MinerGroup("farm", 1, 6e9), MinerGroup("gpu", 20, 150e6)],
            daily_volume_usd=volume,
            days=2,
        )

    def test_rewards_plus_pool_equal_fees(self):
        result = simulate(self._scenario([100_000.0, 100_000.0]), Params(), seed=1)
        paid = sum(g["reward_usd_total"] for g in result["groups"])
        self.assertAlmostEqual(paid + result["pool_end_usd"], result["fees_usd_total"], places=6)

    def test_no_volume_means_no_rewards(self):
        result = simulate(self._scenario([0.0, 0.0]), Params(), seed=1)
        self.assertEqual(sum(g["reward_usd_total"] for g in result["groups"]), 0.0)

    def test_same_seed_is_deterministic(self):
        a = simulate(self._scenario([50_000.0, 10_000.0]), Params(), seed=3)
        b = simulate(self._scenario([50_000.0, 10_000.0]), Params(), seed=3)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd ~/Desktop/rig/sim && python3 -m unittest test_hashmine_sim -v`
Expected: `ModuleNotFoundError: No module named 'hashmine_sim'`.

- [ ] **Step 3: Записать `sim/hashmine_sim.py`**

```python
"""HashMine parameter simulation (spec section 7, item 6). Python stdlib only."""
from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass, field
from typing import Dict, List

ROUNDS_PER_DAY = 144
MAX_NONCES = 64
EXEC_GAS_ONE = 48_007  # plan 01 gas report: submit 1 share, new miner, active round
EXEC_GAS_64 = 80_658  # plan 01 gas report: submit 64 shares, new miner, active round


@dataclass(frozen=True)
class Params:
    round_length: int = 600
    release_bps: int = 48
    target_shares: int = 4096
    min_difficulty: int = 20
    max_difficulty: int = 96
    profit_margin: float = 2.0  # client submits only if expected reward >= margin * gas


@dataclass(frozen=True)
class MinerGroup:
    name: str
    count: int
    hashrate: float  # hashes per second, per miner


@dataclass
class Scenario:
    name: str
    groups: List[MinerGroup]
    daily_volume_usd: List[float]
    days: int = 7
    gas_price_gwei: float = 0.0735
    eth_usd: float = 2526.0
    fee_share: float = 0.027


def bits(work: int, target_shares: int) -> int:
    """ceil(log2(ceilDiv(work, target))) or 0, exactly as HashMine._bits."""
    if work <= target_shares:
        return 0
    q = -(-work // target_shares)
    return (q - 1).bit_length()


def min_difficulty(anchor_work: int, gap: int, p: Params) -> int:
    d = bits(anchor_work, p.target_shares) - gap
    return max(p.min_difficulty, min(p.max_difficulty, d))


def batch_gas(shares: int) -> int:
    execution = EXEC_GAS_ONE + (EXEC_GAS_64 - EXEC_GAS_ONE) * (shares - 1) // (MAX_NONCES - 1)
    calldata = 16 * (4 + 32 * (5 + shares))
    return execution + calldata


def poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam < 30:
        limit, k, prod = math.exp(-lam), 0, 1.0
        while True:
            prod *= rng.random()
            if prod <= limit:
                return k
            k += 1
    return max(0, int(round(rng.gauss(lam, math.sqrt(lam)))))


def _gas_usd(shares: int, s: Scenario) -> float:
    full, rest = divmod(shares, MAX_NONCES)
    gas = full * batch_gas(MAX_NONCES) + (batch_gas(rest) if rest else 0)
    return gas * s.gas_price_gwei * 1e-9 * s.eth_usd


def simulate(s: Scenario, p: Params, seed: int) -> Dict:
    rng = random.Random(seed)
    miners = [(g.name, g.hashrate) for g in s.groups for _ in range(g.count)]
    network_hashrate = sum(h for _, h in miners)
    stats = {
        g.name: {"reward": 0.0, "gas": 0.0, "submitted": 0, "skipped": 0, "empty": 0, "count": g.count}
        for g in s.groups
    }
    pool = fees_total = 0.0
    anchor_work, gap = 0, 0
    difficulties: List[int] = []
    shares_per_active_round: List[int] = []

    for r in range(s.days * ROUNDS_PER_DAY):
        day = r // ROUNDS_PER_DAY
        volume = s.daily_volume_usd[day] if day < len(s.daily_volume_usd) else 0.0
        income = volume * s.fee_share / ROUNDS_PER_DAY
        pool += income
        fees_total += income

        d = min_difficulty(anchor_work, gap, p)
        difficulties.append(d)
        share_value = 2**d
        expected_network_work = network_hashrate * p.round_length
        release_estimate = pool * p.release_bps / 10_000

        works: List[tuple] = []
        for name, hashrate in miners:
            shares = poisson(rng, hashrate * p.round_length / share_value)
            if shares == 0:
                stats[name]["empty"] += 1
                continue
            work = shares * share_value
            expected_reward = release_estimate * work / max(expected_network_work, work)
            gas = _gas_usd(shares, s)
            if expected_reward < p.profit_margin * gas:
                stats[name]["skipped"] += 1
                continue
            stats[name]["submitted"] += 1
            stats[name]["gas"] += gas
            works.append((name, work, shares))

        total_work = sum(w for _, w, _ in works)
        if total_work == 0:
            gap += 1
            continue
        release = pool * p.release_bps / 10_000
        pool -= release
        for name, work, _ in works:
            stats[name]["reward"] += release * work / total_work
        shares_per_active_round.append(sum(n for _, _, n in works))
        anchor_work, gap = total_work, 0

    days = float(s.days)
    total_reward = sum(v["reward"] for v in stats.values()) or 1.0
    rounds = s.days * ROUNDS_PER_DAY
    groups = []
    for g in s.groups:
        v = stats[g.name]
        per_miner_rounds = rounds * g.count
        groups.append({
            "name": g.name,
            "count": g.count,
            "hashrate": g.hashrate,
            "reward_usd_total": v["reward"],
            "reward_usd_per_miner_day": v["reward"] / g.count / days,
            "gas_usd_per_miner_day": v["gas"] / g.count / days,
            "net_usd_per_miner_day": (v["reward"] - v["gas"]) / g.count / days,
            "rounds_submitted_pct": 100.0 * v["submitted"] / per_miner_rounds,
            "rounds_skipped_unprofitable_pct": 100.0 * v["skipped"] / per_miner_rounds,
            "rounds_without_share_pct": 100.0 * v["empty"] / per_miner_rounds,
            "reward_share_pct": 100.0 * v["reward"] / total_reward,
        })
    return {
        "scenario": s.name,
        "fees_usd_total": fees_total,
        "pool_end_usd": pool,
        "difficulty_min": min(difficulties),
        "difficulty_max": max(difficulties),
        "active_rounds_pct": 100.0 * len(shares_per_active_round) / rounds,
        "avg_shares_per_active_round": (
            sum(shares_per_active_round) / len(shares_per_active_round) if shares_per_active_round else 0.0
        ),
        "groups": groups,
    }


def default_scenarios() -> List[Scenario]:
    miners = [
        MinerGroup("farm_6GH", 1, 6e9),
        MinerGroup("gpu_50MH", 333, 50e6),
        MinerGroup("gpu_150MH", 333, 150e6),
        MinerGroup("gpu_250MH", 334, 250e6),
        MinerGroup("cpu_23MH", 1000, 23.2e6),
    ]
    return [
        Scenario("baseline", miners, [100_000.0] * 7),
        Scenario("spike_decay", miners, [1_000_000.0 * 0.5**d for d in range(7)]),
        Scenario("gas_10x", miners, [100_000.0] * 7, gas_price_gwei=0.735),
        Scenario("dead_volume", miners, [200_000.0] + [0.0] * 6),
    ]


def to_markdown(results: List[Dict]) -> str:
    lines = []
    for res in results:
        lines.append(f"### {res['scenario']}")
        lines.append("")
        lines.append(
            f"Комиссии за период ${res['fees_usd_total']:,.0f}, остаток пула ${res['pool_end_usd']:,.0f}, "
            f"активных раундов {res['active_rounds_pct']:.1f}%, шар на активный раунд {res['avg_shares_per_active_round']:.0f}, "
            f"сложность {res['difficulty_min']}–{res['difficulty_max']} бит."
        )
        lines.append("")
        lines.append("| Группа | Майнеров | Награда $/сут | Газ $/сут | Чистыми $/сут | Отправлял раундов | Пропуск (невыгодно) | Без шар | Доля наград |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for g in res["groups"]:
            lines.append(
                f"| {g['name']} | {g['count']} | {g['reward_usd_per_miner_day']:.4f} | {g['gas_usd_per_miner_day']:.4f} | "
                f"{g['net_usd_per_miner_day']:.4f} | {g['rounds_submitted_pct']:.1f}% | {g['rounds_skipped_unprofitable_pct']:.1f}% | "
                f"{g['rounds_without_share_pct']:.1f}% | {g['reward_share_pct']:.1f}% |"
            )
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--json", default="results.json")
    args = parser.parse_args()
    results = [simulate(s, Params(), args.seed) for s in default_scenarios()]
    with open(args.json, "w") as fh:
        json.dump(results, fh, indent=2)
    print(to_markdown(results))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd ~/Desktop/rig/sim && python3 -m unittest test_hashmine_sim -v`
Expected: `Ran 7 tests ... OK`.

- [ ] **Step 5: Checkpoint** — `git status --short`.

---

### Task 2: Прогон сценариев и выводы

**Files:**
- Create: `sim/results.json` (генерирует скрипт), `sim/RESULTS.md`

- [ ] **Step 1: Прогнать**

Run: `cd ~/Desktop/rig/sim && time python3 hashmine_sim.py --seed 1 --json results.json`
Expected: четыре таблицы markdown, файл `results.json`, время < 5 мин.

- [ ] **Step 2: Проверить устойчивость к seed**

Run: `cd ~/Desktop/rig/sim && python3 hashmine_sim.py --seed 2 --json results_seed2.json > /dev/null && python3 -c "import json;a=json.load(open('results.json'));b=json.load(open('results_seed2.json'));[print(x['scenario'],g['name'],round(g['reward_share_pct'],1),round(h['reward_share_pct'],1)) for x,y in zip(a,b) for g,h in zip(x['groups'],y['groups'])]"`
Expected: доли наград по группам между seed 1 и 2 отличаются не больше чем на 1–2 п.п.

- [ ] **Step 3: Записать `sim/RESULTS.md`**

Содержание:
- дата и команда;
- таблицы из шага 1;
- ответы на три вопроса с цифрами:
  1. Сколько получает браузерный майнер (GPU 150 MH/s и CPU 23 MH/s) в сутки в `baseline` и сколько платит газа.
  2. Какая доля раундов пропускается как невыгодная у малых майнеров в `baseline` и `gas_10x`.
  3. Как быстро падает выпуск в `dead_volume`: остаток пула к дню 7.
- решение по §5.1: оставить параметры или изменить, с причиной. Если меняется хотя бы один параметр — правка §5.1 спеки и `PonsTreasury` констант отдельной задачей с прогоном форк-тестов.

- [ ] **Step 4: Checkpoint** — `git status --short`.

---

## Self-Review

- **Покрытие §7 п.6:** оба сценария из спеки (`baseline` = «1 ферма + 1000 браузеров по 50–250 MH/s», `spike_decay` = «всплеск и затухание»), плюс `gas_10x` (риск §9 п.4) и `dead_volume` (риск §9 п.1). Выходы: награда на майнера в сутки, доля выгодных батчей.
- **Совпадение с контрактом:** `bits` и `min_difficulty` проверяются теми же векторами, что в `HashMine.t.sol`; газ взят из замера плана 01.
- **Упрощения, названные явно:** цена токена постоянна; harvest равномерный; ожидаемая работа сети известна клиенту точно.

---

## Отклонения при исполнении (2026-09-14)

1. **Политика клиента в модели изменена дважды.**
   - Модель из плана (`D = minDifficulty`) дала 0 активных раундов во всех сценариях — тупик.
   - Добавлен `choose_difficulty`: наименьшая `D ≥ minDifficulty` с ≤ 32 ожидаемыми шарами за раунд. Тупик ушёл, но мелкие майнеры пропускали 78–93% раундов как невыгодные.
   - Добавлено второе условие: одна шара окупает свой газ с запасом `profit_margin` (×2).
   - Тестов стало 10: добавлены `ClientPolicyTest` (3 теста).
2. **`simulate`:** шар за раунд у майнера не больше 64 (`min(MAX_NONCES, poisson(...))`), одна транзакция на раунд. В выводе появилась колонка `D клиента`.
3. **Итоги** в `sim/RESULTS.md`. Параметры §5.1 не меняются. §6.4 спеки обновлён под финальную политику клиента.
