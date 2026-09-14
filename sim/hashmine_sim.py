"""HashMine parameter simulation (spec section 7, item 6). Python stdlib only."""
from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass
from typing import Dict, List

ROUNDS_PER_DAY = 144
MAX_NONCES = 64
EXEC_GAS_ONE = 48_007  # plan 01 gas report: submit 1 share, new miner, active round
EXEC_GAS_64 = 80_658  # plan 01 gas report: submit 64 shares, new miner, active round
TARGET_SHARES_PER_MINER = 32  # client policy: about one batch per round


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


def choose_difficulty(
    hashrate: float,
    round_length: int,
    network_min: int,
    p: Params,
    value_per_hash: float = 0.0,
    single_share_gas_usd: float = 0.0,
) -> int:
    """Client policy: smallest D >= network minimum with at most ~32 expected shares per round and,
    when a share value estimate is known, where one share pays `profit_margin` times its own gas."""
    expected_hashes = hashrate * round_length
    d = network_min
    while d < p.max_difficulty and expected_hashes / 2**d > TARGET_SHARES_PER_MINER:
        d += 1
    if value_per_hash > 0 and single_share_gas_usd > 0:
        while d < p.max_difficulty and value_per_hash * 2**d < p.profit_margin * single_share_gas_usd:
            d += 1
    return d


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
        g.name: {"reward": 0.0, "gas": 0.0, "submitted": 0, "skipped": 0, "empty": 0, "count": g.count, "difficulty_sum": 0}
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
        expected_network_work = network_hashrate * p.round_length
        release_estimate = pool * p.release_bps / 10_000
        value_per_hash = release_estimate / expected_network_work
        single_share_gas = _gas_usd(1, s)

        works: List[tuple] = []
        for name, hashrate in miners:
            miner_d = choose_difficulty(hashrate, p.round_length, d, p, value_per_hash, single_share_gas)
            share_value = 2**miner_d
            stats[name]["difficulty_sum"] += miner_d
            shares = min(MAX_NONCES, poisson(rng, hashrate * p.round_length / share_value))
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
            "avg_chosen_difficulty": v["difficulty_sum"] / per_miner_rounds,
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
        lines.append("| Группа | Майнеров | D клиента | Награда $/сут | Газ $/сут | Чистыми $/сут | Отправлял раундов | Пропуск (невыгодно) | Без шар | Доля наград |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|")
        for g in res["groups"]:
            lines.append(
                f"| {g['name']} | {g['count']} | {g['avg_chosen_difficulty']:.1f} | {g['reward_usd_per_miner_day']:.4f} | {g['gas_usd_per_miner_day']:.4f} | "
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
