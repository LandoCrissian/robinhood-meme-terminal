from __future__ import annotations

import copy
import random
import tempfile
import unittest
from pathlib import Path

import epoch_builder as builder


FIXED_SOURCE_SHA256 = "00" * 32

BASE_INPUT = {
    "schema": builder.INPUT_SCHEMA,
    "chainId": 4663,
    "distributor": "0x1111111111111111111111111111111111111111",
    "pohToken": "0x2222222222222222222222222222222222222222",
    "pohAccounting": "0x3333333333333333333333333333333333333333",
    "pohPolicy": "0x4444444444444444444444444444444444444444",
    "rewardToken": "0x5555555555555555555555555555555555555555",
    "epochId": 7,
    "rewardAmount": "100000000000000000003",
    "sourceStartBlock": 100,
    "sourceEndBlock": 200,
    "epochStartTimestamp": 1_800_000_000,
    "epochEndTimestamp": 1_800_604_800,
    "excludedAccounts": ["0x9999999999999999999999999999999999999999"],
    "positions": [
        {
            "account": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "epochBalanceSeconds": str(1_000 * 604_800),
            "weightedAcquisitionTimestamp": 1_799_395_200,
        },
        {
            "account": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "epochBalanceSeconds": str(2_000 * 302_400),
            "weightedAcquisitionTimestamp": 1_797_408_000,
        },
        {
            "account": "0x9999999999999999999999999999999999999999",
            "epochBalanceSeconds": str(5_000 * 604_800),
            "weightedAcquisitionTimestamp": 1_790_000_000,
        },
        {
            "account": "0xcccccccccccccccccccccccccccccccccccccccc",
            "epochBalanceSeconds": str(3_000 * 604_800),
            "weightedAcquisitionTimestamp": 0,
        },
    ],
}

EXPECTED_SAMPLE_ROOT = "0x514e0688ad973ec95f197e4c9e814bd1e4f5d71ea6d319668dbefacc14bfbe8a"
EXPECTED_SAMPLE_DATASET_HASH = "0x5c1578fc9e381d9baf153a7030637ca35642de35b210d902114dec9402d85de5"


def address(index: int) -> str:
    return "0x" + index.to_bytes(20, "big").hex()


class EpochBuilderTest(unittest.TestCase):
    def test_ethereum_keccak_vectors(self) -> None:
        self.assertEqual(
            builder.keccak256(b"").hex(),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
        )
        self.assertEqual(
            builder.keccak256(b"abc").hex(),
            "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
        )

    def test_policy_and_leaf_domain_vectors(self) -> None:
        self.assertEqual(
            builder.to_hex(builder.policy_hash()),
            "0x9199827b32332fc31a20d3c88fef4a602275345bd7c6e0f2d18859c5d86042c4",
        )
        self.assertEqual(
            builder.to_hex(builder.leaf_domain()),
            "0x47313ccea952a5802ce51dd358acf64dacb52c83f873d74fff2bbf6f0fd2eb16",
        )

    def test_policy_curve_matches_contract_bounds(self) -> None:
        self.assertEqual(builder.loyalty_multiplier_wad(0), builder.WAD)
        self.assertEqual(
            builder.loyalty_multiplier_wad(builder.MAX_AGE_SECONDS),
            1_750_000_000_000_000_000,
        )
        self.assertEqual(
            builder.loyalty_multiplier_wad(10 * builder.MAX_AGE_SECONDS),
            1_750_000_000_000_000_000,
        )
        previous = 0
        for day in range(0, 3_651):
            current = builder.loyalty_multiplier_wad(day * 24 * 60 * 60)
            self.assertGreaterEqual(current, previous)
            previous = current

    def test_sample_epoch_vector(self) -> None:
        artifacts = builder.build_epoch(
            copy.deepcopy(BASE_INPUT),
            builder_source_sha256=FIXED_SOURCE_SHA256,
        )
        self.assertEqual(artifacts.manifest["merkleRoot"], EXPECTED_SAMPLE_ROOT)
        self.assertEqual(artifacts.manifest["datasetHash"], EXPECTED_SAMPLE_DATASET_HASH)
        self.assertEqual(artifacts.manifest["claimCount"], 3)
        self.assertEqual(
            [claim["amount"] for claim in artifacts.claims["claims"]],
            [
                "21285289747399702824",
                "22994056463595839525",
                "55720653789004457654",
            ],
        )
        builder.verify_artifacts(artifacts)

    def test_openzeppelin_tree_layout_vectors_for_odd_and_even_counts(self) -> None:
        expected_roots = {
            1: "0xda88faf89b518eb4774583fa174f46d7714a1097c24c6bd5357a594d62eec21e",
            2: "0xc49a4441f36dd72ae434f26396128198089e2dcca7d118c9fd98aeb9ba8b11cf",
            3: "0x022af45fdbdf7ef360aae7876757802114fe670555320d8c9a4a1fbf0c5c1276",
            5: "0x72b4e37f7a658bc1173c2a00fa362d503c41f031bf32d477fd62ee6243ba122c",
        }
        for leaf_count, expected_root in expected_roots.items():
            leaves = [builder.keccak256(f"leaf-{index}".encode()) for index in range(leaf_count)]
            tree, indices = builder.make_standard_merkle_tree(leaves)
            self.assertEqual(builder.to_hex(tree[0]), expected_root)
            for leaf, tree_index in zip(leaves, indices, strict=True):
                self.assertEqual(
                    builder.process_proof(leaf, builder.merkle_proof(tree, tree_index)),
                    tree[0],
                )

    def test_shuffled_duplicate_input_is_reproducible(self) -> None:
        raw = copy.deepcopy(BASE_INPUT)
        first = raw["positions"][0]
        amount = int(first["epochBalanceSeconds"])
        raw["positions"][0] = {
            **first,
            "epochBalanceSeconds": str(amount // 2),
        }
        raw["positions"].append(
            {
                **first,
                "epochBalanceSeconds": str(amount - amount // 2),
            }
        )
        expected = builder.build_epoch(raw, builder_source_sha256=FIXED_SOURCE_SHA256)

        rng = random.Random(0x504F48)
        for _ in range(25):
            shuffled = copy.deepcopy(raw)
            rng.shuffle(shuffled["positions"])
            rng.shuffle(shuffled["excludedAccounts"])
            actual = builder.build_epoch(
                shuffled,
                builder_source_sha256=FIXED_SOURCE_SHA256,
            )
            self.assertEqual(actual.manifest, expected.manifest)
            self.assertEqual(actual.dataset, expected.dataset)
            self.assertEqual(actual.claims, expected.claims)

    def test_conflicting_duplicate_timestamp_is_rejected(self) -> None:
        raw = copy.deepcopy(BASE_INPUT)
        duplicate = copy.deepcopy(raw["positions"][0])
        duplicate["weightedAcquisitionTimestamp"] += 1
        raw["positions"].append(duplicate)
        with self.assertRaisesRegex(builder.EpochBuilderError, "conflicting weighted"):
            builder.build_epoch(raw, builder_source_sha256=FIXED_SOURCE_SHA256)

    def test_unknown_fields_and_floats_are_rejected(self) -> None:
        raw = copy.deepcopy(BASE_INPUT)
        raw["unexpected"] = 1
        with self.assertRaisesRegex(builder.EpochBuilderError, "unknown fields"):
            builder.build_epoch(raw, builder_source_sha256=FIXED_SOURCE_SHA256)

        with self.assertRaisesRegex(builder.EpochBuilderError, "floating-point"):
            builder.canonical_json_bytes({"amount": 1.5})

    def test_zero_and_invalid_addresses_are_rejected(self) -> None:
        raw = copy.deepcopy(BASE_INPUT)
        raw["positions"][0]["account"] = builder.ZERO_ADDRESS
        with self.assertRaisesRegex(builder.EpochBuilderError, "zero address"):
            builder.build_epoch(raw, builder_source_sha256=FIXED_SOURCE_SHA256)

        raw = copy.deepcopy(BASE_INPUT)
        raw["rewardToken"] = "0x1234"
        with self.assertRaisesRegex(builder.EpochBuilderError, "exactly 20 bytes"):
            builder.build_epoch(raw, builder_source_sha256=FIXED_SOURCE_SHA256)

    def test_system_addresses_are_automatically_excluded(self) -> None:
        raw = copy.deepcopy(BASE_INPUT)
        raw["positions"].append(
            {
                "account": raw["distributor"],
                "epochBalanceSeconds": str(10_000 * 604_800),
                "weightedAcquisitionTimestamp": raw["epochStartTimestamp"],
            }
        )
        artifacts = builder.build_epoch(raw, builder_source_sha256=FIXED_SOURCE_SHA256)
        row = next(
            item for item in artifacts.dataset["rows"] if item["account"] == raw["distributor"]
        )
        self.assertTrue(row["excluded"])
        self.assertEqual(row["rewardWeight"], "0")
        self.assertEqual(row["allocation"], "0")

    def test_largest_remainder_tie_breaks_by_address(self) -> None:
        rows = [
            {
                "account": address(index),
                "excluded": False,
                "rewardWeight": "1",
                "allocation": "0",
            }
            for index in (3, 1, 2)
        ]
        builder._allocate(rows, 2)
        allocations = {row["account"]: int(row["allocation"]) for row in rows}
        self.assertEqual(allocations[address(1)], 1)
        self.assertEqual(allocations[address(2)], 1)
        self.assertEqual(allocations[address(3)], 0)

    def test_zero_allocations_are_not_merkle_leaves(self) -> None:
        raw = copy.deepcopy(BASE_INPUT)
        raw["rewardAmount"] = "1"
        artifacts = builder.build_epoch(raw, builder_source_sha256=FIXED_SOURCE_SHA256)
        self.assertEqual(artifacts.manifest["claimCount"], 1)
        self.assertEqual(artifacts.claims["claims"][0]["amount"], "1")
        self.assertEqual(
            sum(int(row["allocation"]) for row in artifacts.dataset["rows"]),
            1,
        )

    def test_source_digest_changes_commitments_but_not_allocation_root(self) -> None:
        first = builder.build_epoch(
            copy.deepcopy(BASE_INPUT),
            builder_source_sha256="00" * 32,
        )
        second = builder.build_epoch(
            copy.deepcopy(BASE_INPUT),
            builder_source_sha256="11" * 32,
        )
        self.assertEqual(first.manifest["merkleRoot"], second.manifest["merkleRoot"])
        self.assertNotEqual(first.manifest["calculationHash"], second.manifest["calculationHash"])
        self.assertNotEqual(first.manifest["datasetHash"], second.manifest["datasetHash"])

    def test_tampered_artifacts_are_rejected(self) -> None:
        artifacts = builder.build_epoch(
            copy.deepcopy(BASE_INPUT),
            builder_source_sha256=FIXED_SOURCE_SHA256,
        )
        artifacts.claims["claims"][0]["amount"] = "1"
        with self.assertRaisesRegex(builder.EpochBuilderError, "claims hash mismatch"):
            builder.verify_artifacts(artifacts)

    def test_write_load_and_verify_roundtrip(self) -> None:
        artifacts = builder.build_epoch(
            copy.deepcopy(BASE_INPUT),
            builder_source_sha256=FIXED_SOURCE_SHA256,
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            written = builder.write_artifacts(artifacts, directory, "epoch-7")
            self.assertEqual(len(written), 5)
            loaded = builder.load_artifacts(directory, "epoch-7")
            builder.verify_artifacts(loaded)
            self.assertEqual(loaded.manifest, artifacts.manifest)

    def test_randomized_largest_remainder_conservation_for_10000_datasets(self) -> None:
        rng = random.Random(0x504F4845504F4348)
        for _ in range(10_000):
            count = rng.randint(1, 30)
            reward_amount = rng.randint(1, 10**24)
            rows = [
                {
                    "account": address(index + 1),
                    "excluded": rng.randrange(11) == 0,
                    "rewardWeight": str(rng.randint(0, 10**30)),
                    "allocation": "0",
                }
                for index in range(count)
            ]
            if not any(not row["excluded"] and int(row["rewardWeight"]) > 0 for row in rows):
                rows[0]["excluded"] = False
                rows[0]["rewardWeight"] = "1"
            total_weight = builder._allocate(rows, reward_amount)
            self.assertGreater(total_weight, 0)
            self.assertEqual(
                sum(int(row["allocation"]) for row in rows),
                reward_amount,
            )
            self.assertTrue(
                all(
                    int(row["allocation"]) == 0
                    for row in rows
                    if row["excluded"] or int(row["rewardWeight"]) == 0
                )
            )

    def test_randomized_merkle_proofs(self) -> None:
        rng = random.Random(0x4D45524B4C45)
        for dataset_index in range(250):
            leaf_count = rng.randint(1, 32)
            leaves = [
                builder.keccak256(
                    dataset_index.to_bytes(4, "big")
                    + leaf_index.to_bytes(4, "big")
                    + rng.getrandbits(128).to_bytes(16, "big")
                )
                for leaf_index in range(leaf_count)
            ]
            tree, indices = builder.make_standard_merkle_tree(leaves)
            for leaf, tree_index in zip(leaves, indices, strict=True):
                proof = builder.merkle_proof(tree, tree_index)
                self.assertEqual(builder.process_proof(leaf, proof), tree[0])


if __name__ == "__main__":
    unittest.main()
