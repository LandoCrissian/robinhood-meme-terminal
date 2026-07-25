"""Independent integer reference model for PoH Epoch Rewards v0.1."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


REVIEW_DELAY = 48 * 60 * 60
CLAIM_PERIOD = 180 * 24 * 60 * 60


class EpochStatus(IntEnum):
    NONE = 0
    PENDING = 1
    FINALIZED = 2
    CANCELLED = 3
    EXPIRED = 4


@dataclass(slots=True)
class Epoch:
    allocation: int
    external_funding: int
    rollover_funding: int
    proposed_at: int
    finalizable_at: int
    status: EpochStatus = EpochStatus.PENDING
    finalized_at: int = 0
    claim_deadline: int = 0
    total_claimed: int = 0
    claimed_indices: set[int] = field(default_factory=set)


@dataclass(slots=True)
class RewardsModel:
    now: int = 1_800_000_000
    contract_balance: int = 0
    publisher_balance: int = 0
    pending_reserved: int = 0
    finalized_reserved: int = 0
    rollover_balance: int = 0
    last_epoch_id: int = 0
    epochs: dict[int, Epoch] = field(default_factory=dict)

    def accounted_balance(self) -> int:
        return self.pending_reserved + self.finalized_reserved + self.rollover_balance

    def unaccounted_balance(self) -> int:
        return max(0, self.contract_balance - self.accounted_balance())

    def advance(self, seconds: int) -> None:
        if seconds < 0:
            raise ValueError("negative time")
        self.now += seconds
        self.assert_invariants()

    def fund_rollover(self, amount: int) -> None:
        self._require_positive(amount)
        if amount > self.publisher_balance:
            raise ValueError("insufficient publisher balance")
        self.publisher_balance -= amount
        self.contract_balance += amount
        self.rollover_balance += amount
        self.assert_invariants()

    def direct_transfer(self, amount: int) -> None:
        self._require_positive(amount)
        if amount > self.publisher_balance:
            raise ValueError("insufficient publisher balance")
        self.publisher_balance -= amount
        self.contract_balance += amount
        self.assert_invariants()

    def sync_unaccounted(self) -> int:
        amount = self.unaccounted_balance()
        if amount == 0:
            raise ValueError("no unaccounted rewards")
        self.rollover_balance += amount
        self.assert_invariants()
        return amount

    def propose(
        self,
        epoch_id: int,
        allocation: int,
        external_funding: int,
        rollover_funding: int,
    ) -> None:
        if epoch_id <= self.last_epoch_id:
            raise ValueError("epoch order")
        self._require_positive(allocation)
        if external_funding < 0 or rollover_funding < 0:
            raise ValueError("negative funding")
        if external_funding + rollover_funding != allocation:
            raise ValueError("funding mismatch")
        if rollover_funding > self.rollover_balance:
            raise ValueError("insufficient rollover")
        if external_funding > self.publisher_balance:
            raise ValueError("insufficient publisher balance")

        self.publisher_balance -= external_funding
        self.contract_balance += external_funding
        self.rollover_balance -= rollover_funding
        self.pending_reserved += allocation
        self.last_epoch_id = epoch_id
        self.epochs[epoch_id] = Epoch(
            allocation=allocation,
            external_funding=external_funding,
            rollover_funding=rollover_funding,
            proposed_at=self.now,
            finalizable_at=self.now + REVIEW_DELAY,
        )
        self.assert_invariants()

    def cancel(self, epoch_id: int) -> None:
        epoch = self._epoch_with_status(epoch_id, EpochStatus.PENDING)
        epoch.status = EpochStatus.CANCELLED
        self.pending_reserved -= epoch.allocation
        self.rollover_balance += epoch.rollover_funding
        self.contract_balance -= epoch.external_funding
        self.publisher_balance += epoch.external_funding
        self.assert_invariants()

    def finalize(self, epoch_id: int) -> None:
        epoch = self._epoch_with_status(epoch_id, EpochStatus.PENDING)
        if self.now < epoch.finalizable_at:
            raise ValueError("review period active")
        epoch.status = EpochStatus.FINALIZED
        epoch.finalized_at = self.now
        epoch.claim_deadline = self.now + CLAIM_PERIOD
        self.pending_reserved -= epoch.allocation
        self.finalized_reserved += epoch.allocation
        self.assert_invariants()

    def claim(self, epoch_id: int, index: int, amount: int) -> None:
        epoch = self._epoch_with_status(epoch_id, EpochStatus.FINALIZED)
        self._require_positive(amount)
        if self.now > epoch.claim_deadline:
            raise ValueError("claim window closed")
        if index in epoch.claimed_indices:
            raise ValueError("already claimed")
        attempted = epoch.total_claimed + amount
        if attempted > epoch.allocation:
            raise ValueError("allocation exceeded")

        epoch.claimed_indices.add(index)
        epoch.total_claimed = attempted
        self.finalized_reserved -= amount
        self.contract_balance -= amount
        self.assert_invariants()

    def expire(self, epoch_id: int) -> int:
        epoch = self._epoch_with_status(epoch_id, EpochStatus.FINALIZED)
        if self.now <= epoch.claim_deadline:
            raise ValueError("claim window open")
        unclaimed = epoch.allocation - epoch.total_claimed
        epoch.status = EpochStatus.EXPIRED
        self.finalized_reserved -= unclaimed
        self.rollover_balance += unclaimed
        self.assert_invariants()
        return unclaimed

    def assert_invariants(self) -> None:
        if min(
            self.contract_balance,
            self.publisher_balance,
            self.pending_reserved,
            self.finalized_reserved,
            self.rollover_balance,
        ) < 0:
            raise AssertionError("negative accounting state")
        if self.contract_balance < self.accounted_balance():
            raise AssertionError("reward accounting insolvent")
        for epoch_id, epoch in self.epochs.items():
            if epoch_id <= 0 or epoch_id > self.last_epoch_id:
                raise AssertionError("invalid epoch identifier")
            if not 0 <= epoch.total_claimed <= epoch.allocation:
                raise AssertionError("claim conservation")
            if epoch.status in (EpochStatus.PENDING, EpochStatus.CANCELLED):
                if epoch.total_claimed != 0 or epoch.claim_deadline != 0:
                    raise AssertionError("pre-finalization claim state")
            if epoch.status in (EpochStatus.FINALIZED, EpochStatus.EXPIRED):
                if epoch.finalized_at == 0 or epoch.claim_deadline <= epoch.finalized_at:
                    raise AssertionError("finalization timing")

    def _epoch_with_status(self, epoch_id: int, expected: EpochStatus) -> Epoch:
        epoch = self.epochs.get(epoch_id)
        if epoch is None or epoch.status != expected:
            raise ValueError("invalid epoch status")
        return epoch

    @staticmethod
    def _require_positive(value: int) -> None:
        if value <= 0:
            raise ValueError("value must be positive")
