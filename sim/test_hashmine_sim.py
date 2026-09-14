import random
import unittest

from hashmine_sim import (
    MinerGroup, Params, Scenario, batch_gas, bits, choose_difficulty, min_difficulty, poisson, simulate,
)


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


class ClientPolicyTest(unittest.TestCase):
    def test_choose_difficulty_targets_at_most_32_shares(self):
        p = Params()
        # farm: 6e9 H/s * 600 s = 3.6e12 hashes; 2^36 -> 52 shares, 2^37 -> 26 shares.
        self.assertEqual(choose_difficulty(6e9, 600, 20, p), 37)
        # 4-core CPU: 23.2e6 * 600 = 1.392e10; 2^28 -> 51.9, 2^29 -> 25.9.
        self.assertEqual(choose_difficulty(23.2e6, 600, 20, p), 29)

    def test_choose_difficulty_raises_until_one_share_pays_twice_its_gas(self):
        # value 1e-13 $/hash, single-share gas $0.01, margin 2 -> 2^D >= 2e11 -> D = 38.
        d = choose_difficulty(23.2e6, 600, 20, Params(), value_per_hash=1e-13, single_share_gas_usd=0.01)
        self.assertEqual(d, 38)

    def test_choose_difficulty_respects_network_minimum(self):
        self.assertEqual(choose_difficulty(23.2e6, 600, 35, Params()), 35)


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
