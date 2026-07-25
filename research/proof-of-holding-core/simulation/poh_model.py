"""Independent integer reference model for Proof of Holding Core v0.1.

The model intentionally mirrors the Solidity transition rules without importing
or executing the Solidity implementation. It is suitable for differential-test
vectors and long-duration economic simulations; it is not a blockchain client.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from math import isqrt
from typing import Dict, Iterable

WAD = 10**18
DAY = 86_400
MAX_AGE = 365 * DAY
MAX_BONUS_WAD = 750_000_000_000_000_000
UINT192_MAX = (1 << 192) - 1
UINT64_MAX = (1 << 64) - 1


@dataclass(slots=True)
class Position:
    eligible_balance: int = 0
    weighted_acquisition_time: int = 0
    active_balance_seconds: int = 0
    lifetime_balance_seconds: int = 0
    active_since: int = 0
    last_updated: int = 0
    last_position_reset: int = 0
    position_id: int = 0


class PoHModel:
    """Single-token, single-chain PoH state machine."""

    def __init__(
        self,
        *,
        initial_holder: str,
        initial_supply: int,
        start_time: int,
        excluded: Iterable[str] = (),
    ) -> None:
        if not initial_holder:
            raise ValueError("initial holder is required")
        if initial_supply <= 0:
            raise ValueError("initial supply must be positive")
        if initial_supply > UINT192_MAX:
            raise OverflowError("initial supply exceeds uint192 accounting bound")
        self._validate_time(start_time)

        self.now = start_time
        self.total_supply = initial_supply
        self.balances: Dict[str, int] = {initial_holder: initial_supply}
        self.positions: Dict[str, Position] = {}
        self.excluded = set(excluded)

        if initial_holder not in self.excluded:
            self._increase(initial_holder, initial_supply)

    @staticmethod
    def _validate_time(timestamp: int) -> None:
        if timestamp < 0 or timestamp > UINT64_MAX:
            raise OverflowError("timestamp is outside uint64")

    def _position(self, account: str) -> Position:
        return self.positions.setdefault(account, Position())

    def warp(self, new_time: int) -> None:
        self._validate_time(new_time)
        if new_time < self.now:
            raise ValueError("time cannot move backward")
        self.now = new_time

    def advance(self, seconds: int) -> None:
        if seconds < 0:
            raise ValueError("elapsed time cannot be negative")
        self.warp(self.now + seconds)

    def _accrue(self, account: str) -> None:
        position = self._position(account)
        if position.last_updated == 0:
            position.last_updated = self.now
            return

        elapsed = self.now - position.last_updated
        if elapsed == 0:
            return

        if position.eligible_balance:
            accrued = position.eligible_balance * elapsed
            position.active_balance_seconds += accrued
            position.lifetime_balance_seconds += accrued

        position.last_updated = self.now

    def position_of(self, account: str) -> Position:
        """Return a projected current position without mutating stored state."""
        position = replace(self._position(account))
        if account in self.excluded or position.eligible_balance == 0:
            return position

        elapsed = self.now - position.last_updated
        if elapsed:
            accrued = position.eligible_balance * elapsed
            position.active_balance_seconds += accrued
            position.lifetime_balance_seconds += accrued
            position.last_updated = self.now
        return position

    def holding_age(self, account: str) -> int:
        position = self._position(account)
        if account in self.excluded or position.eligible_balance == 0:
            return 0
        return self.now - position.weighted_acquisition_time

    def continuous_holding_duration(self, account: str) -> int:
        position = self._position(account)
        if account in self.excluded or position.eligible_balance == 0:
            return 0
        return self.now - position.active_since

    def sync(self, account: str) -> None:
        if account not in self.excluded:
            self._accrue(account)

    def _increase(self, account: str, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount cannot be negative")
        if amount > UINT192_MAX:
            raise OverflowError("amount exceeds uint192")

        self._accrue(account)
        position = self._position(account)
        old_balance = position.eligible_balance
        new_balance = old_balance + amount
        if new_balance > UINT192_MAX:
            raise OverflowError("eligible balance exceeds uint192")

        if old_balance == 0:
            position.position_id += 1
            position.eligible_balance = new_balance
            position.weighted_acquisition_time = self.now
            position.active_since = self.now
            position.last_updated = self.now
            position.active_balance_seconds = 0
            return

        elapsed_from_weighted_time = self.now - position.weighted_acquisition_time
        timestamp_shift = amount * elapsed_from_weighted_time // new_balance
        position.weighted_acquisition_time += timestamp_shift
        position.eligible_balance = new_balance

    def _decrease(self, account: str, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount cannot be negative")

        self._accrue(account)
        position = self._position(account)
        if amount > position.eligible_balance:
            raise ValueError("accounting balance underflow")

        remaining = position.eligible_balance - amount
        if remaining:
            position.eligible_balance = remaining
            return

        position.eligible_balance = 0
        position.weighted_acquisition_time = 0
        position.active_balance_seconds = 0
        position.active_since = 0
        position.last_updated = self.now
        position.last_position_reset = self.now

    def transfer(self, sender: str, recipient: str, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount cannot be negative")
        sender_balance = self.balances.get(sender, 0)
        if amount > sender_balance:
            raise ValueError("insufficient balance")

        if amount == 0 or sender == recipient:
            return

        self.balances[sender] = sender_balance - amount
        self.balances[recipient] = self.balances.get(recipient, 0) + amount

        if sender not in self.excluded:
            self._decrease(sender, amount)
        if recipient not in self.excluded:
            self._increase(recipient, amount)

    def burn(self, account: str, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount cannot be negative")
        balance = self.balances.get(account, 0)
        if amount > balance:
            raise ValueError("insufficient balance")
        if amount == 0:
            return

        self.balances[account] = balance - amount
        self.total_supply -= amount
        if account not in self.excluded:
            self._decrease(account, amount)

    def set_excluded(self, account: str, excluded: bool) -> None:
        if excluded == (account in self.excluded):
            raise ValueError("eligibility state is unchanged")

        if excluded:
            self._accrue(account)
            position = self._position(account)
            position.eligible_balance = 0
            position.weighted_acquisition_time = 0
            position.active_balance_seconds = 0
            position.active_since = 0
            position.last_updated = self.now
            position.last_position_reset = self.now
            self.excluded.add(account)
            return

        self.excluded.remove(account)
        balance = self.balances.get(account, 0)
        position = self._position(account)
        position.last_updated = self.now
        if balance:
            position.position_id += 1
            position.eligible_balance = balance
            position.weighted_acquisition_time = self.now
            position.active_balance_seconds = 0
            position.active_since = self.now

    def assert_internal_invariants(self, accounts: Iterable[str] | None = None) -> None:
        checked = set(accounts or ()) | set(self.balances) | set(self.positions)
        tracked_supply = 0
        eligible_token_supply = 0

        for account in checked:
            balance = self.balances.get(account, 0)
            position = self._position(account)

            if account in self.excluded:
                if position.eligible_balance != 0:
                    raise AssertionError(f"excluded account {account} has tracked balance")
                continue

            if position.eligible_balance != balance:
                raise AssertionError(
                    f"tracked balance mismatch for {account}: "
                    f"{position.eligible_balance} != {balance}"
                )

            tracked_supply += position.eligible_balance
            eligible_token_supply += balance

            if position.eligible_balance == 0:
                if position.weighted_acquisition_time != 0 or position.active_since != 0:
                    raise AssertionError(f"zero-balance account {account} retains active age")
            else:
                if not (
                    position.active_since
                    <= position.weighted_acquisition_time
                    <= self.now
                ):
                    raise AssertionError(f"invalid timestamps for {account}")
                if position.active_balance_seconds > position.lifetime_balance_seconds:
                    raise AssertionError(f"active history exceeds lifetime history for {account}")

        if tracked_supply != eligible_token_supply:
            raise AssertionError("tracked eligible supply is inconsistent")
        if sum(self.balances.values()) != self.total_supply:
            raise AssertionError("token balances do not conserve total supply")


def multiplier_wad(age_seconds: int) -> int:
    if age_seconds < 0:
        raise ValueError("age cannot be negative")
    capped_age = min(age_seconds, MAX_AGE)
    scaled_root = isqrt(capped_age * MAX_AGE)
    bonus = MAX_BONUS_WAD * scaled_root // MAX_AGE
    return WAD + bonus


def loyalty_tier(age_seconds: int) -> int:
    if age_seconds < 0:
        raise ValueError("age cannot be negative")
    if age_seconds < 7 * DAY:
        return 0
    if age_seconds < 30 * DAY:
        return 1
    if age_seconds < 90 * DAY:
        return 2
    if age_seconds < 180 * DAY:
        return 3
    if age_seconds < 365 * DAY:
        return 4
    return 5


def reward_weight(average_eligible_balance: int, age_seconds: int) -> int:
    if average_eligible_balance < 0:
        raise ValueError("balance cannot be negative")
    return average_eligible_balance * multiplier_wad(age_seconds) // WAD
