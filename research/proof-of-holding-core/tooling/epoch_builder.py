"""Deterministic Proof of Holding epoch allocation and Merkle artifact builder.

The implementation is dependency-free. It uses Ethereum Keccak-256, fixed-width ABI encoding,
the OpenZeppelin StandardMerkleTree v1 layout, and integer-only allocation math.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

BUILDER_VERSION = "0.1.0"

INPUT_SCHEMA = "poh-epoch-input-v0.1"
NORMALIZED_INPUT_SCHEMA = "poh-epoch-normalized-input-v0.1"
CALCULATION_SCHEMA = "poh-epoch-calculation-v0.1"
DATASET_SCHEMA = "poh-epoch-dataset-v0.1"
CLAIMS_SCHEMA = "poh-epoch-claims-v0.1"
MANIFEST_SCHEMA = "poh-epoch-manifest-v0.1"

UINT64_MAX = (1 << 64) - 1
UINT192_MAX = (1 << 192) - 1
UINT256_MAX = (1 << 256) - 1
MASK64 = (1 << 64) - 1

WAD = 10**18
MAX_BONUS_WAD = 750_000_000_000_000_000
MAX_AGE_SECONDS = 365 * 24 * 60 * 60

POLICY_DESCRIPTION = (
    b"POH_POLICY_V1|curve=sqrt|base=1e18|maxBonus=0.75e18|maxAge=365days|"
    b"tiers=7,30,90,180,365"
)
LEAF_DOMAIN_DESCRIPTION = b"POH_EPOCH_REWARD_LEAF_V1"

ZERO_ADDRESS = "0x" + "00" * 20
_DECIMAL_RE = re.compile(r"(?:0|[1-9][0-9]*)\Z")
_HEX_RE = re.compile(r"[0-9a-fA-F]*\Z")

_ROTATION_OFFSETS = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)

_ROUND_CONSTANTS = (
    0x0000000000000001,
    0x0000000000008082,
    0x800000000000808A,
    0x8000000080008000,
    0x000000000000808B,
    0x0000000080000001,
    0x8000000080008081,
    0x8000000000008009,
    0x000000000000008A,
    0x0000000000000088,
    0x0000000080008009,
    0x000000008000000A,
    0x000000008000808B,
    0x800000000000008B,
    0x8000000000008089,
    0x8000000000008003,
    0x8000000000008002,
    0x8000000000000080,
    0x000000000000800A,
    0x800000008000000A,
    0x8000000080008081,
    0x8000000000008080,
    0x0000000080000001,
    0x8000000080008008,
)


class EpochBuilderError(ValueError):
    """Raised when an epoch input or artifact set is invalid."""


@dataclass(frozen=True, slots=True)
class BuildArtifacts:
    normalized_input: dict[str, Any]
    calculation: dict[str, Any]
    dataset: dict[str, Any]
    claims: dict[str, Any]
    manifest: dict[str, Any]

    def as_mapping(self) -> dict[str, dict[str, Any]]:
        return {
            "normalized-input": self.normalized_input,
            "calculation": self.calculation,
            "dataset": self.dataset,
            "claims": self.claims,
            "manifest": self.manifest,
        }


def _rotate_left_64(value: int, offset: int) -> int:
    if offset == 0:
        return value & MASK64
    return ((value << offset) | (value >> (64 - offset))) & MASK64


def _keccak_f1600(state: Sequence[int]) -> list[int]:
    lanes = list(state)
    if len(lanes) != 25:
        raise AssertionError("Keccak state must contain 25 lanes")

    for round_constant in _ROUND_CONSTANTS:
        column_parity = [
            lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20]
            for x in range(5)
        ]
        theta = [
            column_parity[(x - 1) % 5] ^ _rotate_left_64(column_parity[(x + 1) % 5], 1)
            for x in range(5)
        ]
        for y in range(5):
            for x in range(5):
                lanes[x + 5 * y] ^= theta[x]

        rotated = [0] * 25
        for y in range(5):
            for x in range(5):
                new_x = y
                new_y = (2 * x + 3 * y) % 5
                rotated[new_x + 5 * new_y] = _rotate_left_64(
                    lanes[x + 5 * y], _ROTATION_OFFSETS[x][y]
                )

        for y in range(5):
            for x in range(5):
                lanes[x + 5 * y] = (
                    rotated[x + 5 * y]
                    ^ ((~rotated[(x + 1) % 5 + 5 * y]) & rotated[(x + 2) % 5 + 5 * y])
                ) & MASK64

        lanes[0] ^= round_constant

    return lanes


def keccak256(data: bytes) -> bytes:
    """Return Ethereum Keccak-256, not NIST SHA3-256."""

    if not isinstance(data, bytes):
        raise TypeError("keccak256 input must be bytes")

    rate = 136
    pad_length = rate - (len(data) % rate)
    if pad_length == 1:
        padded = data + b"\x81"
    else:
        padded = data + b"\x01" + b"\x00" * (pad_length - 2) + b"\x80"

    state = [0] * 25
    for offset in range(0, len(padded), rate):
        block = padded[offset : offset + rate]
        for lane_index in range(rate // 8):
            lane = int.from_bytes(block[8 * lane_index : 8 * lane_index + 8], "little")
            state[lane_index] ^= lane
        state = _keccak_f1600(state)

    output = b"".join(lane.to_bytes(8, "little") for lane in state[: rate // 8])
    return output[:32]


def to_hex(data: bytes) -> str:
    return "0x" + data.hex()


def _parse_fixed_hex(value: Any, byte_length: int, field: str) -> bytes:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise EpochBuilderError(f"{field} must be a 0x-prefixed hex string")
    payload = value[2:]
    if len(payload) != byte_length * 2 or _HEX_RE.fullmatch(payload) is None:
        raise EpochBuilderError(f"{field} must contain exactly {byte_length} bytes")
    return bytes.fromhex(payload)


def normalize_address(value: Any, field: str = "address", *, allow_zero: bool = False) -> str:
    address = to_hex(_parse_fixed_hex(value, 20, field))
    if not allow_zero and address == ZERO_ADDRESS:
        raise EpochBuilderError(f"{field} must not be the zero address")
    return address


def normalize_bytes32(value: Any, field: str) -> str:
    return to_hex(_parse_fixed_hex(value, 32, field))


def parse_decimal_string(value: Any, field: str, *, maximum: int = UINT256_MAX) -> int:
    if not isinstance(value, str) or _DECIMAL_RE.fullmatch(value) is None:
        raise EpochBuilderError(f"{field} must be a canonical unsigned decimal string")
    result = int(value, 10)
    if result > maximum:
        raise EpochBuilderError(f"{field} exceeds its maximum value")
    return result


def parse_integer(
    value: Any,
    field: str,
    *,
    minimum: int = 0,
    maximum: int = UINT256_MAX,
) -> int:
    if isinstance(value, bool):
        raise EpochBuilderError(f"{field} must be an integer")
    if isinstance(value, str):
        if _DECIMAL_RE.fullmatch(value) is None:
            raise EpochBuilderError(f"{field} must be an unsigned integer")
        result = int(value, 10)
    elif isinstance(value, int):
        result = value
    else:
        raise EpochBuilderError(f"{field} must be an integer")
    if result < minimum or result > maximum:
        raise EpochBuilderError(f"{field} is outside the allowed range")
    return result


def encode_uint256(value: int) -> bytes:
    if value < 0 or value > UINT256_MAX:
        raise EpochBuilderError("uint256 value is outside the allowed range")
    return value.to_bytes(32, "big")


def encode_address(address: str) -> bytes:
    return b"\x00" * 12 + _parse_fixed_hex(address, 20, "address")


def canonical_json_bytes(value: Any) -> bytes:
    """Canonical PoH JSON: UTF-8, sorted keys, no insignificant whitespace, no floats."""

    _reject_floats(value)
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def canonical_keccak(value: Any) -> str:
    return to_hex(keccak256(canonical_json_bytes(value)))


def _reject_floats(value: Any, path: str = "$") -> None:
    if isinstance(value, float):
        raise EpochBuilderError(f"floating-point value is forbidden at {path}")
    if isinstance(value, Mapping):
        for key, item in value.items():
            _reject_floats(item, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _reject_floats(item, f"{path}[{index}]")


def _require_object(
    value: Any,
    field: str,
    *,
    required: Iterable[str],
    optional: Iterable[str] = (),
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise EpochBuilderError(f"{field} must be an object")
    required_set = set(required)
    allowed = required_set | set(optional)
    missing = sorted(required_set - set(value))
    unknown = sorted(set(value) - allowed)
    if missing:
        raise EpochBuilderError(f"{field} is missing required fields: {', '.join(missing)}")
    if unknown:
        raise EpochBuilderError(f"{field} contains unknown fields: {', '.join(unknown)}")
    return value


def policy_hash() -> bytes:
    return keccak256(POLICY_DESCRIPTION)


def leaf_domain() -> bytes:
    return keccak256(LEAF_DOMAIN_DESCRIPTION)


def loyalty_multiplier_wad(age_seconds: int) -> int:
    if age_seconds < 0:
        raise EpochBuilderError("holding age must not be negative")
    capped_age = min(age_seconds, MAX_AGE_SECONDS)
    scaled_root = math.isqrt(capped_age * MAX_AGE_SECONDS)
    bonus = MAX_BONUS_WAD * scaled_root // MAX_AGE_SECONDS
    return WAD + bonus


def reward_weight(average_eligible_balance: int, age_seconds: int) -> int:
    if average_eligible_balance < 0:
        raise EpochBuilderError("average eligible balance must not be negative")
    result = average_eligible_balance * loyalty_multiplier_wad(age_seconds) // WAD
    if result > UINT256_MAX:
        raise EpochBuilderError("reward weight exceeds uint256")
    return result


def epoch_leaf_hash(
    *,
    chain_id: int,
    distributor: str,
    epoch_id: int,
    index: int,
    account: str,
    amount: int,
) -> bytes:
    encoded = b"".join(
        (
            leaf_domain(),
            encode_uint256(chain_id),
            encode_address(distributor),
            encode_uint256(epoch_id),
            encode_uint256(index),
            encode_address(account),
            encode_uint256(amount),
        )
    )
    inner_hash = keccak256(encoded)
    return keccak256(inner_hash)


def standard_node_hash(left: bytes, right: bytes) -> bytes:
    if len(left) != 32 or len(right) != 32:
        raise EpochBuilderError("Merkle nodes must be 32 bytes")
    return keccak256(left + right if left < right else right + left)


def make_standard_merkle_tree(leaves: Sequence[bytes]) -> tuple[list[bytes], list[int]]:
    """Match OpenZeppelin StandardMerkleTree v1 with sortLeaves=true."""

    if not leaves:
        raise EpochBuilderError("at least one positive allocation is required")
    if any(len(leaf) != 32 for leaf in leaves):
        raise EpochBuilderError("Merkle leaves must be 32 bytes")
    if len(set(leaves)) != len(leaves):
        raise EpochBuilderError("duplicate Merkle leaves are forbidden")

    indexed = sorted(enumerate(leaves), key=lambda item: item[1])
    tree = [b""] * (2 * len(leaves) - 1)
    tree_indices = [0] * len(leaves)

    for sorted_index, (original_index, leaf) in enumerate(indexed):
        tree_index = len(tree) - 1 - sorted_index
        tree[tree_index] = leaf
        tree_indices[original_index] = tree_index

    for tree_index in range(len(tree) - 1 - len(leaves), -1, -1):
        left = tree[2 * tree_index + 1]
        right = tree[2 * tree_index + 2]
        tree[tree_index] = standard_node_hash(left, right)

    return tree, tree_indices


def merkle_proof(tree: Sequence[bytes], tree_index: int) -> list[bytes]:
    if tree_index < 0 or tree_index >= len(tree):
        raise EpochBuilderError("tree index is outside the Merkle tree")
    proof: list[bytes] = []
    current = tree_index
    while current > 0:
        sibling = current - (1 if current % 2 == 0 else -1)
        proof.append(tree[sibling])
        current = (current - 1) // 2
    return proof


def process_proof(leaf: bytes, proof: Sequence[bytes]) -> bytes:
    result = leaf
    for sibling in proof:
        result = standard_node_hash(result, sibling)
    return result


def _normalize_input(raw: Any) -> dict[str, Any]:
    source = _require_object(
        raw,
        "input",
        required=(
            "schema",
            "chainId",
            "distributor",
            "pohToken",
            "pohAccounting",
            "pohPolicy",
            "policyHash",
            "rewardToken",
            "epochId",
            "rewardAmount",
            "sourceStartBlock",
            "sourceEndBlock",
            "epochStartTimestamp",
            "epochEndTimestamp",
            "excludedAccounts",
            "positions",
        ),
    )
    if source["schema"] != INPUT_SCHEMA:
        raise EpochBuilderError(f"schema must equal {INPUT_SCHEMA!r}")

    chain_id = parse_integer(source["chainId"], "chainId", minimum=1)
    epoch_id = parse_integer(source["epochId"], "epochId", minimum=1)
    reward_amount = parse_decimal_string(source["rewardAmount"], "rewardAmount")
    if reward_amount == 0:
        raise EpochBuilderError("rewardAmount must be greater than zero")

    source_start_block = parse_integer(
        source["sourceStartBlock"], "sourceStartBlock", maximum=UINT64_MAX
    )
    source_end_block = parse_integer(
        source["sourceEndBlock"], "sourceEndBlock", maximum=UINT64_MAX
    )
    if source_start_block > source_end_block:
        raise EpochBuilderError("sourceStartBlock must not exceed sourceEndBlock")

    epoch_start = parse_integer(
        source["epochStartTimestamp"], "epochStartTimestamp", maximum=UINT64_MAX
    )
    epoch_end = parse_integer(
        source["epochEndTimestamp"], "epochEndTimestamp", maximum=UINT64_MAX
    )
    if epoch_end <= epoch_start:
        raise EpochBuilderError("epochEndTimestamp must be greater than epochStartTimestamp")
    epoch_duration = epoch_end - epoch_start
    maximum_balance_seconds = UINT192_MAX * epoch_duration

    distributor = normalize_address(source["distributor"], "distributor")
    poh_token = normalize_address(source["pohToken"], "pohToken")
    poh_accounting = normalize_address(source["pohAccounting"], "pohAccounting")
    poh_policy = normalize_address(source["pohPolicy"], "pohPolicy")
    provided_policy_hash = normalize_bytes32(source["policyHash"], "policyHash")
    expected_policy_hash = to_hex(policy_hash())
    if provided_policy_hash != expected_policy_hash:
        raise EpochBuilderError(
            f"policyHash must equal the PoHPolicyV1 hash {expected_policy_hash}"
        )
    reward_token = normalize_address(source["rewardToken"], "rewardToken")

    excluded_raw = source["excludedAccounts"]
    if not isinstance(excluded_raw, list):
        raise EpochBuilderError("excludedAccounts must be an array")
    explicitly_excluded = {
        normalize_address(account, f"excludedAccounts[{index}]")
        for index, account in enumerate(excluded_raw)
    }
    system_excluded = {distributor, poh_token, poh_accounting, poh_policy, reward_token}
    effective_excluded = explicitly_excluded | system_excluded

    positions_raw = source["positions"]
    if not isinstance(positions_raw, list) or not positions_raw:
        raise EpochBuilderError("positions must be a non-empty array")

    merged: dict[str, dict[str, int]] = {}
    for row_index, row_raw in enumerate(positions_raw):
        row = _require_object(
            row_raw,
            f"positions[{row_index}]",
            required=("account", "epochBalanceSeconds", "weightedAcquisitionTimestamp"),
        )
        account = normalize_address(row["account"], f"positions[{row_index}].account")
        balance_seconds = parse_decimal_string(
            row["epochBalanceSeconds"],
            f"positions[{row_index}].epochBalanceSeconds",
        )
        if balance_seconds > maximum_balance_seconds:
            raise EpochBuilderError(
                f"positions[{row_index}].epochBalanceSeconds exceeds uint192 balance capacity"
            )
        weighted_timestamp = parse_integer(
            row["weightedAcquisitionTimestamp"],
            f"positions[{row_index}].weightedAcquisitionTimestamp",
            maximum=UINT64_MAX,
        )
        if weighted_timestamp > epoch_end:
            raise EpochBuilderError(
                f"positions[{row_index}].weightedAcquisitionTimestamp exceeds epoch end"
            )

        existing = merged.get(account)
        if existing is None:
            merged[account] = {
                "epochBalanceSeconds": balance_seconds,
                "weightedAcquisitionTimestamp": weighted_timestamp,
            }
        else:
            if existing["weightedAcquisitionTimestamp"] != weighted_timestamp:
                raise EpochBuilderError(
                    f"duplicate position rows for {account} have conflicting weighted timestamps"
                )
            combined = existing["epochBalanceSeconds"] + balance_seconds
            if combined > maximum_balance_seconds:
                raise EpochBuilderError(
                    f"merged epochBalanceSeconds for {account} exceeds uint192 balance capacity"
                )
            existing["epochBalanceSeconds"] = combined

    positions = [
        {
            "account": account,
            "epochBalanceSeconds": str(values["epochBalanceSeconds"]),
            "weightedAcquisitionTimestamp": values["weightedAcquisitionTimestamp"],
        }
        for account, values in sorted(merged.items())
    ]

    return {
        "schema": NORMALIZED_INPUT_SCHEMA,
        "chainId": chain_id,
        "distributor": distributor,
        "pohToken": poh_token,
        "pohAccounting": poh_accounting,
        "pohPolicy": poh_policy,
        "policyHash": provided_policy_hash,
        "rewardToken": reward_token,
        "epochId": epoch_id,
        "rewardAmount": str(reward_amount),
        "sourceStartBlock": source_start_block,
        "sourceEndBlock": source_end_block,
        "epochStartTimestamp": epoch_start,
        "epochEndTimestamp": epoch_end,
        "epochDurationSeconds": epoch_duration,
        "explicitlyExcludedAccounts": sorted(explicitly_excluded),
        "systemExcludedAccounts": sorted(system_excluded),
        "effectiveExcludedAccounts": sorted(effective_excluded),
        "positions": positions,
    }


def _calculation_manifest(builder_source_sha256: str) -> dict[str, Any]:
    if re.fullmatch(r"[0-9a-f]{64}", builder_source_sha256) is None:
        raise EpochBuilderError("builder source SHA-256 must be 64 lowercase hex characters")
    return {
        "schema": CALCULATION_SCHEMA,
        "builderVersion": BUILDER_VERSION,
        "builderSourceSha256": builder_source_sha256,
        "integerMath": True,
        "canonicalJson": "poh-json-v0.1:utf8+sorted-keys+compact+integer-only",
        "keccak": "ethereum-keccak-256",
        "abiEncoding": [
            "bytes32",
            "uint256",
            "address",
            "uint256",
            "uint256",
            "address",
            "uint256",
        ],
        "leafDomain": to_hex(leaf_domain()),
        "leafHash": "keccak256(keccak256(abi.encode(domain,chain,distributor,epoch,index,account,amount)))",
        "nodeHash": "keccak256(sort-bytes32(a,b))",
        "tree": {
            "format": "openzeppelin-standard-v1",
            "sortLeaves": True,
            "layout": "complete-array-reverse-leaf-placement",
        },
        "policy": {
            "name": "PoHPolicyV1",
            "policyHash": to_hex(policy_hash()),
            "curve": "sqrt",
            "wad": str(WAD),
            "maximumBonusWad": str(MAX_BONUS_WAD),
            "maximumAgeSeconds": MAX_AGE_SECONDS,
            "averageBalance": "floor(epochBalanceSeconds/epochDurationSeconds)",
            "rewardWeight": "floor(averageEligibleBalance*multiplierWad/1e18)",
        },
        "allocation": {
            "method": "largest-remainder-v1",
            "base": "floor(rewardAmount*rewardWeight/totalRewardWeight)",
            "remainderOrder": "descending-remainder,ascending-address",
            "leafIndexOrder": "ascending-address-after-zero-allocation-removal",
        },
    }


def _allocate(rows: list[dict[str, Any]], reward_amount: int) -> int:
    weighted_rows = [row for row in rows if not row["excluded"] and int(row["rewardWeight"]) > 0]
    if not weighted_rows:
        raise EpochBuilderError("no non-excluded position has positive reward weight")

    total_weight = sum(int(row["rewardWeight"]) for row in weighted_rows)
    if total_weight <= 0 or total_weight > UINT256_MAX:
        raise EpochBuilderError("total reward weight is outside uint256")

    allocated = 0
    for row in weighted_rows:
        numerator = reward_amount * int(row["rewardWeight"])
        base, remainder = divmod(numerator, total_weight)
        row["allocation"] = str(base)
        row["_remainder"] = remainder
        allocated += base

    remainder_units = reward_amount - allocated
    if remainder_units < 0 or remainder_units >= len(weighted_rows):
        raise AssertionError("largest-remainder allocation bound violated")

    ranked = sorted(weighted_rows, key=lambda row: (-row["_remainder"], row["account"]))
    for row in ranked[:remainder_units]:
        row["allocation"] = str(int(row["allocation"]) + 1)

    for row in rows:
        row.pop("_remainder", None)

    if sum(int(row["allocation"]) for row in rows) != reward_amount:
        raise AssertionError("allocation conservation violated")

    return total_weight


def _derive_artifacts(
    normalized: dict[str, Any],
    calculation: dict[str, Any],
) -> BuildArtifacts:
    calculation_hash = canonical_keccak(calculation)
    normalized_input_hash = canonical_keccak(normalized)

    duration = normalized["epochDurationSeconds"]
    epoch_end = normalized["epochEndTimestamp"]
    excluded = set(normalized["effectiveExcludedAccounts"])

    rows: list[dict[str, Any]] = []
    for position in normalized["positions"]:
        balance_seconds = int(position["epochBalanceSeconds"])
        weighted_timestamp = position["weightedAcquisitionTimestamp"]
        age = 0 if weighted_timestamp == 0 else epoch_end - weighted_timestamp
        average_balance = balance_seconds // duration
        multiplier = loyalty_multiplier_wad(age)
        excluded_account = position["account"] in excluded
        weight = 0 if excluded_account else reward_weight(average_balance, age)

        rows.append(
            {
                "account": position["account"],
                "excluded": excluded_account,
                "epochBalanceSeconds": str(balance_seconds),
                "weightedAcquisitionTimestamp": weighted_timestamp,
                "ageSeconds": age,
                "averageEligibleBalance": str(average_balance),
                "multiplierWad": str(multiplier),
                "rewardWeight": str(weight),
                "allocation": "0",
                "leafIndex": None,
            }
        )

    reward_amount = int(normalized["rewardAmount"])
    total_weight = _allocate(rows, reward_amount)

    claimable_rows = [row for row in rows if int(row["allocation"]) > 0]
    claimable_rows.sort(key=lambda row: row["account"])
    for leaf_index, row in enumerate(claimable_rows):
        row["leafIndex"] = leaf_index

    dataset = {
        "schema": DATASET_SCHEMA,
        "chainId": normalized["chainId"],
        "distributor": normalized["distributor"],
        "pohToken": normalized["pohToken"],
        "pohAccounting": normalized["pohAccounting"],
        "pohPolicy": normalized["pohPolicy"],
        "policyHash": normalized["policyHash"],
        "rewardToken": normalized["rewardToken"],
        "epochId": normalized["epochId"],
        "rewardAmount": normalized["rewardAmount"],
        "sourceStartBlock": normalized["sourceStartBlock"],
        "sourceEndBlock": normalized["sourceEndBlock"],
        "epochStartTimestamp": normalized["epochStartTimestamp"],
        "epochEndTimestamp": normalized["epochEndTimestamp"],
        "epochDurationSeconds": duration,
        "normalizedInputHash": normalized_input_hash,
        "calculationHash": calculation_hash,
        "totalRewardWeight": str(total_weight),
        "rows": rows,
    }
    dataset_hash = canonical_keccak(dataset)

    leaves = [
        epoch_leaf_hash(
            chain_id=normalized["chainId"],
            distributor=normalized["distributor"],
            epoch_id=normalized["epochId"],
            index=row["leafIndex"],
            account=row["account"],
            amount=int(row["allocation"]),
        )
        for row in claimable_rows
    ]
    tree, tree_indices = make_standard_merkle_tree(leaves)
    root = tree[0]

    claims_list: list[dict[str, Any]] = []
    for row, leaf, tree_index in zip(claimable_rows, leaves, tree_indices, strict=True):
        proof = merkle_proof(tree, tree_index)
        if process_proof(leaf, proof) != root:
            raise AssertionError("generated proof does not resolve to the Merkle root")
        claims_list.append(
            {
                "index": row["leafIndex"],
                "account": row["account"],
                "amount": row["allocation"],
                "leaf": to_hex(leaf),
                "treeIndex": tree_index,
                "proof": [to_hex(node) for node in proof],
            }
        )

    claims = {
        "schema": CLAIMS_SCHEMA,
        "chainId": normalized["chainId"],
        "distributor": normalized["distributor"],
        "epochId": normalized["epochId"],
        "datasetHash": dataset_hash,
        "merkleRoot": to_hex(root),
        "claims": claims_list,
    }
    claims_hash = canonical_keccak(claims)

    manifest = {
        "schema": MANIFEST_SCHEMA,
        "builderVersion": BUILDER_VERSION,
        "chainId": normalized["chainId"],
        "distributor": normalized["distributor"],
        "pohToken": normalized["pohToken"],
        "pohAccounting": normalized["pohAccounting"],
        "pohPolicy": normalized["pohPolicy"],
        "policyHash": normalized["policyHash"],
        "rewardToken": normalized["rewardToken"],
        "epochId": normalized["epochId"],
        "sourceStartBlock": normalized["sourceStartBlock"],
        "sourceEndBlock": normalized["sourceEndBlock"],
        "epochStartTimestamp": normalized["epochStartTimestamp"],
        "epochEndTimestamp": normalized["epochEndTimestamp"],
        "totalAllocation": normalized["rewardAmount"],
        "totalRewardWeight": str(total_weight),
        "claimCount": len(claims_list),
        "excludedAccountCount": sum(1 for row in rows if row["excluded"]),
        "zeroAllocationCount": sum(1 for row in rows if int(row["allocation"]) == 0),
        "normalizedInputHash": normalized_input_hash,
        "calculationHash": calculation_hash,
        "datasetHash": dataset_hash,
        "claimsHash": claims_hash,
        "merkleRoot": to_hex(root),
        "canonicalHashRule": "keccak256(poh-json-v0.1 canonical object bytes)",
    }

    return BuildArtifacts(normalized, calculation, dataset, claims, manifest)


def build_epoch(
    raw_input: Any,
    *,
    builder_source_sha256: str | None = None,
) -> BuildArtifacts:
    normalized = _normalize_input(raw_input)
    if builder_source_sha256 is None:
        builder_source_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

    artifacts = _derive_artifacts(
        normalized,
        _calculation_manifest(builder_source_sha256),
    )
    verify_artifacts(artifacts)
    return artifacts


def _raw_input_from_normalized(normalized: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schema": INPUT_SCHEMA,
        "chainId": normalized["chainId"],
        "distributor": normalized["distributor"],
        "pohToken": normalized["pohToken"],
        "pohAccounting": normalized["pohAccounting"],
        "pohPolicy": normalized["pohPolicy"],
        "policyHash": normalized["policyHash"],
        "rewardToken": normalized["rewardToken"],
        "epochId": normalized["epochId"],
        "rewardAmount": normalized["rewardAmount"],
        "sourceStartBlock": normalized["sourceStartBlock"],
        "sourceEndBlock": normalized["sourceEndBlock"],
        "epochStartTimestamp": normalized["epochStartTimestamp"],
        "epochEndTimestamp": normalized["epochEndTimestamp"],
        "excludedAccounts": normalized["explicitlyExcludedAccounts"],
        "positions": normalized["positions"],
    }


def verify_artifacts(artifacts: BuildArtifacts) -> None:
    manifest = artifacts.manifest
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise EpochBuilderError("manifest schema is invalid")
    if artifacts.normalized_input.get("schema") != NORMALIZED_INPUT_SCHEMA:
        raise EpochBuilderError("normalized input schema is invalid")
    if artifacts.calculation.get("schema") != CALCULATION_SCHEMA:
        raise EpochBuilderError("calculation schema is invalid")
    if artifacts.dataset.get("schema") != DATASET_SCHEMA:
        raise EpochBuilderError("dataset schema is invalid")
    if artifacts.claims.get("schema") != CLAIMS_SCHEMA:
        raise EpochBuilderError("claims schema is invalid")

    source_digest = artifacts.calculation.get("builderSourceSha256")
    if not isinstance(source_digest, str):
        raise EpochBuilderError("calculation builderSourceSha256 is invalid")
    expected_calculation = _calculation_manifest(source_digest)
    if artifacts.calculation != expected_calculation:
        raise EpochBuilderError("calculation semantics do not match PoH Epoch Builder v0.1")

    try:
        expected_normalized = _normalize_input(
            _raw_input_from_normalized(artifacts.normalized_input)
        )
    except (KeyError, TypeError) as exc:
        raise EpochBuilderError("normalized input structure is invalid") from exc
    if artifacts.normalized_input != expected_normalized:
        raise EpochBuilderError("normalized input is not canonical")

    expected = _derive_artifacts(expected_normalized, expected_calculation)
    if artifacts.dataset != expected.dataset:
        raise EpochBuilderError("dataset does not match deterministic epoch calculation")
    if artifacts.claims != expected.claims:
        raise EpochBuilderError("claims do not match deterministic epoch calculation")
    if artifacts.manifest != expected.manifest:
        raise EpochBuilderError("manifest does not match deterministic epoch calculation")

    if canonical_keccak(artifacts.normalized_input) != manifest["normalizedInputHash"]:
        raise EpochBuilderError("normalized input hash mismatch")
    if canonical_keccak(artifacts.calculation) != manifest["calculationHash"]:
        raise EpochBuilderError("calculation hash mismatch")
    if canonical_keccak(artifacts.dataset) != manifest["datasetHash"]:
        raise EpochBuilderError("dataset hash mismatch")
    if canonical_keccak(artifacts.claims) != manifest["claimsHash"]:
        raise EpochBuilderError("claims hash mismatch")

    claims = artifacts.claims["claims"]
    if not isinstance(claims, list) or not claims:
        raise EpochBuilderError("claims artifact must contain at least one claim")
    if manifest["claimCount"] != len(claims):
        raise EpochBuilderError("claim count mismatch")

    expected_indices = list(range(len(claims)))
    actual_indices = [parse_integer(claim["index"], "claim.index") for claim in claims]
    if actual_indices != expected_indices:
        raise EpochBuilderError("claim indices must be contiguous and ordered")

    root = _parse_fixed_hex(manifest["merkleRoot"], 32, "merkleRoot")
    allocated = 0
    for claim in claims:
        account = normalize_address(claim["account"], "claim.account")
        amount = parse_decimal_string(claim["amount"], "claim.amount")
        index = parse_integer(claim["index"], "claim.index")
        leaf = epoch_leaf_hash(
            chain_id=manifest["chainId"],
            distributor=manifest["distributor"],
            epoch_id=manifest["epochId"],
            index=index,
            account=account,
            amount=amount,
        )
        if to_hex(leaf) != normalize_bytes32(claim["leaf"], "claim.leaf"):
            raise EpochBuilderError(f"leaf mismatch at index {index}")
        proof_raw = claim["proof"]
        if not isinstance(proof_raw, list):
            raise EpochBuilderError(f"proof at index {index} must be an array")
        proof = [
            _parse_fixed_hex(node, 32, f"claim[{index}].proof[{proof_index}]")
            for proof_index, node in enumerate(proof_raw)
        ]
        if process_proof(leaf, proof) != root:
            raise EpochBuilderError(f"invalid proof at index {index}")
        allocated += amount

    if allocated != parse_decimal_string(manifest["totalAllocation"], "totalAllocation"):
        raise EpochBuilderError("claim allocation sum does not equal total allocation")
    if artifacts.claims["merkleRoot"] != manifest["merkleRoot"]:
        raise EpochBuilderError("claims and manifest roots differ")
    if artifacts.claims["datasetHash"] != manifest["datasetHash"]:
        raise EpochBuilderError("claims and manifest dataset hashes differ")


def _load_json(path: Path) -> Any:
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            parse_float=lambda value: (_ for _ in ()).throw(
                EpochBuilderError(f"floating-point JSON value {value!r} is forbidden")
            ),
        )
    except OSError as exc:
        raise EpochBuilderError(f"unable to read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise EpochBuilderError(f"invalid JSON in {path}: {exc}") from exc


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def write_artifacts(artifacts: BuildArtifacts, output_directory: Path, prefix: str) -> list[Path]:
    if not prefix or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for character in prefix):
        raise EpochBuilderError("prefix must contain only letters, digits, hyphen, or underscore")
    output_directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for suffix, value in artifacts.as_mapping().items():
        destination = output_directory / f"{prefix}.{suffix}.json"
        _write_json(destination, value)
        written.append(destination)
    return written


def load_artifacts(directory: Path, prefix: str) -> BuildArtifacts:
    return BuildArtifacts(
        normalized_input=_load_json(directory / f"{prefix}.normalized-input.json"),
        calculation=_load_json(directory / f"{prefix}.calculation.json"),
        dataset=_load_json(directory / f"{prefix}.dataset.json"),
        claims=_load_json(directory / f"{prefix}.claims.json"),
        manifest=_load_json(directory / f"{prefix}.manifest.json"),
    )


def _build_command(args: argparse.Namespace) -> int:
    raw = _load_json(args.input)
    artifacts = build_epoch(raw)
    written = write_artifacts(artifacts, args.output_directory, args.prefix)
    print(
        json.dumps(
            {
                "merkleRoot": artifacts.manifest["merkleRoot"],
                "datasetHash": artifacts.manifest["datasetHash"],
                "calculationHash": artifacts.manifest["calculationHash"],
                "totalAllocation": artifacts.manifest["totalAllocation"],
                "claimCount": artifacts.manifest["claimCount"],
                "files": [str(path) for path in written],
            },
            sort_keys=True,
        )
    )
    return 0


def _verify_command(args: argparse.Namespace) -> int:
    artifacts = load_artifacts(args.directory, args.prefix)
    verify_artifacts(artifacts)
    print(
        json.dumps(
            {
                "valid": True,
                "merkleRoot": artifacts.manifest["merkleRoot"],
                "datasetHash": artifacts.manifest["datasetHash"],
                "claimCount": artifacts.manifest["claimCount"],
            },
            sort_keys=True,
        )
    )
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser("build", help="build deterministic epoch artifacts")
    build_parser.add_argument("--input", type=Path, required=True)
    build_parser.add_argument("--output-directory", type=Path, required=True)
    build_parser.add_argument("--prefix", required=True)
    build_parser.set_defaults(handler=_build_command)

    verify_parser = subparsers.add_parser("verify", help="verify a generated artifact set")
    verify_parser.add_argument("--directory", type=Path, required=True)
    verify_parser.add_argument("--prefix", required=True)
    verify_parser.set_defaults(handler=_verify_command)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.handler(args)
    except EpochBuilderError as exc:
        print(f"epoch-builder error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
