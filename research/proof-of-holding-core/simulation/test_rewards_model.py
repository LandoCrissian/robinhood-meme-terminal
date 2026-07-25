from __future__ import annotations

import random
import unittest

from rewards_model import CLAIM_PERIOD, REVIEW_DELAY, EpochStatus, RewardsModel


class RewardsModelTest(unittest.TestCase):
    def setUp(self) -> None:
        self.model = RewardsModel(publisher_balance=10**30)

    def test_full_funding_claim_lifecycle(self) -> None:
        self.model.propose(1, 100, 100, 0)
        self.model.advance(REVIEW_DELAY)
        self.model.finalize(1)
        self.model.claim(1, 0, 40)
        self.model.claim(1, 1, 60)

        self.assertEqual(self.model.contract_balance, 0)
        self.assertEqual(self.model.accounted_balance(), 0)
        self.assertEqual(self.model.epochs[1].total_claimed, 100)

    def test_cancel_restores_each_funding_source(self) -> None:
        self.model.fund_rollover(25)
        publisher_before = self.model.publisher_balance
        self.model.propose(1, 100, 75, 25)
        self.model.cancel(1)

        self.assertEqual(self.model.publisher_balance, publisher_before)
        self.assertEqual(self.model.rollover_balance, 25)
        self.assertEqual(self.model.pending_reserved, 0)
        self.assertEqual(self.model.epochs[1].status, EpochStatus.CANCELLED)

    def test_expiration_moves_only_unclaimed_value_to_rollover(self) -> None:
        self.model.propose(1, 100, 100, 0)
        self.model.advance(REVIEW_DELAY)
        self.model.finalize(1)
        self.model.claim(1, 0, 35)
        self.model.advance(CLAIM_PERIOD + 1)
        unclaimed = self.model.expire(1)

        self.assertEqual(unclaimed, 65)
        self.assertEqual(self.model.rollover_balance, 65)
        self.assertEqual(self.model.finalized_reserved, 0)
        self.assertEqual(self.model.contract_balance, 65)

    def test_direct_transfer_requires_explicit_sync(self) -> None:
        self.model.direct_transfer(17)
        self.assertEqual(self.model.unaccounted_balance(), 17)
        self.model.sync_unaccounted()
        self.assertEqual(self.model.unaccounted_balance(), 0)
        self.assertEqual(self.model.rollover_balance, 17)

    def test_claim_at_deadline_is_valid_but_expiration_is_not(self) -> None:
        self.model.propose(1, 1, 1, 0)
        self.model.advance(REVIEW_DELAY)
        self.model.finalize(1)
        self.model.advance(CLAIM_PERIOD)
        self.model.claim(1, 0, 1)
        with self.assertRaises(ValueError):
            self.model.expire(1)

    def test_randomized_reward_conservation(self) -> None:
        rng = random.Random(0x504F48524557415244)
        model = RewardsModel(publisher_balance=10**36)
        next_epoch = 1

        for _ in range(50_000):
            operation = rng.randrange(8)

            if operation == 0 and next_epoch <= 128:
                allocation = rng.randint(1, 10**18)
                rollover = min(model.rollover_balance, rng.randint(0, allocation))
                external = allocation - rollover
                model.propose(next_epoch, allocation, external, rollover)
                next_epoch += 1
            elif operation == 1:
                model.advance(rng.randint(0, 30 * 24 * 60 * 60))
            elif operation == 2:
                pending = [
                    epoch_id
                    for epoch_id, epoch in model.epochs.items()
                    if epoch.status == EpochStatus.PENDING and model.now >= epoch.finalizable_at
                ]
                if pending:
                    model.finalize(rng.choice(pending))
            elif operation == 3:
                finalized = [
                    epoch_id
                    for epoch_id, epoch in model.epochs.items()
                    if epoch.status == EpochStatus.FINALIZED
                    and model.now <= epoch.claim_deadline
                    and epoch.total_claimed < epoch.allocation
                ]
                if finalized:
                    epoch_id = rng.choice(finalized)
                    epoch = model.epochs[epoch_id]
                    remaining = epoch.allocation - epoch.total_claimed
                    amount = rng.randint(1, remaining)
                    model.claim(epoch_id, len(epoch.claimed_indices), amount)
            elif operation == 4:
                expirable = [
                    epoch_id
                    for epoch_id, epoch in model.epochs.items()
                    if epoch.status == EpochStatus.FINALIZED and model.now > epoch.claim_deadline
                ]
                if expirable:
                    model.expire(rng.choice(expirable))
            elif operation == 5:
                pending = [
                    epoch_id
                    for epoch_id, epoch in model.epochs.items()
                    if epoch.status == EpochStatus.PENDING
                ]
                if pending:
                    model.cancel(rng.choice(pending))
            elif operation == 6:
                model.fund_rollover(rng.randint(1, 10**18))
            else:
                model.direct_transfer(rng.randint(1, 10**18))
                model.sync_unaccounted()

            model.assert_invariants()

        self.assertLessEqual(model.accounted_balance(), model.contract_balance)
        for epoch in model.epochs.values():
            self.assertLessEqual(epoch.total_claimed, epoch.allocation)


if __name__ == "__main__":
    unittest.main()
