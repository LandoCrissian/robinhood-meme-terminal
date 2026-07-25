from __future__ import annotations

import random
import unittest

from poh_model import (
    DAY,
    MAX_AGE,
    UINT192_MAX,
    WAD,
    PoHModel,
    loyalty_tier,
    multiplier_wad,
    reward_weight,
)

START = 1_800_000_000
SUPPLY = 1_000_000_000 * WAD


class PoHReferenceModelTests(unittest.TestCase):
    def make_model(self) -> PoHModel:
        return PoHModel(
            initial_holder="alice",
            initial_supply=SUPPLY,
            start_time=START,
        )

    def test_weighted_acquisition_prevents_aged_dust_attack(self) -> None:
        model = self.make_model()
        model.transfer("alice", "bob", 100 * WAD)
        model.advance(100 * DAY)
        model.transfer("alice", "bob", 900 * WAD)

        position = model.position_of("bob")
        self.assertEqual(position.eligible_balance, 1_000 * WAD)
        self.assertEqual(position.weighted_acquisition_time, model.now - 10 * DAY)
        self.assertEqual(model.holding_age("bob"), 10 * DAY)

    def test_partial_exit_preserves_age_and_full_exit_resets(self) -> None:
        model = self.make_model()
        model.advance(90 * DAY)
        age_before = model.holding_age("alice")

        model.transfer("alice", "bob", 250_000_000 * WAD)
        self.assertEqual(model.holding_age("alice"), age_before)
        self.assertEqual(
            model.position_of("alice").eligible_balance,
            750_000_000 * WAD,
        )

        model.transfer("alice", "bob", model.balances["alice"])
        closed = model.position_of("alice")
        self.assertEqual(closed.eligible_balance, 0)
        self.assertEqual(closed.weighted_acquisition_time, 0)
        self.assertEqual(closed.active_since, 0)
        self.assertEqual(model.holding_age("alice"), 0)

        model.advance(DAY)
        model.transfer("bob", "alice", WAD)
        reopened = model.position_of("alice")
        self.assertEqual(reopened.position_id, 2)
        self.assertEqual(reopened.weighted_acquisition_time, model.now)

    def test_recipient_never_inherits_sender_age(self) -> None:
        model = self.make_model()
        model.advance(365 * DAY)
        model.transfer("alice", "bob", 1_000 * WAD)

        self.assertEqual(model.holding_age("bob"), 0)
        self.assertEqual(model.continuous_holding_duration("bob"), 0)
        self.assertEqual(model.holding_age("alice"), 365 * DAY)

    def test_balance_seconds_and_exclusion_transitions(self) -> None:
        model = self.make_model()
        model.advance(7 * DAY)
        position = model.position_of("alice")
        self.assertEqual(position.active_balance_seconds, SUPPLY * 7 * DAY)
        self.assertEqual(position.lifetime_balance_seconds, SUPPLY * 7 * DAY)

        model.set_excluded("alice", True)
        self.assertEqual(model.position_of("alice").eligible_balance, 0)
        model.advance(30 * DAY)
        model.set_excluded("alice", False)
        restarted = model.position_of("alice")
        self.assertEqual(restarted.eligible_balance, SUPPLY)
        self.assertEqual(restarted.weighted_acquisition_time, model.now)
        self.assertEqual(restarted.position_id, 2)

    def test_policy_curve_is_monotonic_bounded_and_tiered(self) -> None:
        self.assertEqual(multiplier_wad(0), WAD)
        self.assertEqual(multiplier_wad(MAX_AGE), 1_750_000_000_000_000_000)
        self.assertEqual(multiplier_wad(10_000 * DAY), 1_750_000_000_000_000_000)

        previous = 0
        for day in range(0, 3_651):
            current = multiplier_wad(day * DAY)
            self.assertGreaterEqual(current, previous)
            self.assertLessEqual(current, 1_750_000_000_000_000_000)
            previous = current

        self.assertEqual(loyalty_tier(0), 0)
        self.assertEqual(loyalty_tier(7 * DAY), 1)
        self.assertEqual(loyalty_tier(30 * DAY), 2)
        self.assertEqual(loyalty_tier(90 * DAY), 3)
        self.assertEqual(loyalty_tier(180 * DAY), 4)
        self.assertEqual(loyalty_tier(365 * DAY), 5)
        self.assertGreaterEqual(reward_weight(1_000 * WAD, 365 * DAY), 1_000 * WAD)

    def test_supply_bound(self) -> None:
        with self.assertRaises(OverflowError):
            PoHModel(
                initial_holder="alice",
                initial_supply=UINT192_MAX + 1,
                start_time=START,
            )

    def test_50_000_randomized_operations_preserve_invariants(self) -> None:
        rng = random.Random(0x504F48)
        model = self.make_model()
        accounts = ["alice", "bob", "carol", "dave", "erin", "frank"]

        for step in range(50_000):
            model.advance(rng.randrange(0, 6 * 60 * 60 + 1))
            funded = [account for account in accounts if model.balances.get(account, 0)]
            if not funded:
                break

            sender = rng.choice(funded)
            sender_balance = model.balances[sender]

            if rng.randrange(10) == 0:
                amount = rng.randrange(0, sender_balance + 1)
                model.burn(sender, amount)
            else:
                recipient = rng.choice(accounts)
                amount = rng.randrange(0, sender_balance + 1)
                model.transfer(sender, recipient, amount)

            if step % 100 == 0:
                model.assert_internal_invariants(accounts)

        model.assert_internal_invariants(accounts)


if __name__ == "__main__":
    unittest.main()
