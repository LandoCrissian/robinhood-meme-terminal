# Proof of Holding Epoch Builder Specification v0.1

Status: experimental engineering draft  
Builder version: `0.1.0`  
Input schema: `poh-epoch-input-v0.1`

## 1. Purpose

The PoH Epoch Builder converts a finite, token-specific epoch dataset into exact reward allocations,
a Merkle root, per-wallet proofs, and reproducibility commitments for `EpochRewardsDistributor`.

The builder is deterministic: the same semantic input and builder source produce identical
normalized input, calculation metadata, allocation dataset, claims, proofs, hashes, and Merkle root.

The builder does not retrieve chain data. It consumes already-reconstructed epoch balance-seconds
and weighted acquisition timestamps from an indexer or other independently verified source.

## 2. Input schema

A v0.1 input contains exactly:

```json
{
  "schema": "poh-epoch-input-v0.1",
  "chainId": 4663,
  "distributor": "0x...",
  "pohToken": "0x...",
  "pohAccounting": "0x...",
  "pohPolicy": "0x...",
  "policyHash": "0x9199827b32332fc31a20d3c88fef4a602275345bd7c6e0f2d18859c5d86042c4",
  "rewardToken": "0x...",
  "epochId": 1,
  "rewardAmount": "100000000000000000000",
  "sourceStartBlock": 10000000,
  "sourceEndBlock": 10100000,
  "epochStartTimestamp": 1800000000,
  "epochEndTimestamp": 1800604800,
  "excludedAccounts": ["0x..."],
  "positions": [
    {
      "account": "0x...",
      "epochBalanceSeconds": "604800000000000000000000",
      "weightedAcquisitionTimestamp": 1790000000
    }
  ]
}
```

Unknown fields are rejected. Token amounts and balance-seconds are canonical unsigned decimal
strings. Floating-point values are forbidden.

`policyHash` is mandatory. Version 0.1 accepts only the exact `PoHPolicyV1` hash defined in section
6. A policy address alone is not treated as evidence that the expected formula was used.

`sourceStartBlock` and `sourceEndBlock` are inclusive commitments to the event range used by the
upstream data producer. They are not used as a substitute for an explicit finality policy.

## 3. Address normalization and exclusions

Every address must contain exactly 20 bytes. Addresses are normalized to lowercase hexadecimal.
The zero address is invalid as a project, distributor, reward-token, excluded, or holder address.

The effective exclusion set is the union of:

- explicit input exclusions;
- reward distributor;
- PoH token;
- PoH accounting contract;
- PoH policy contract;
- reward token.

An excluded row remains visible in the dataset but receives zero reward weight and zero allocation.

## 4. Duplicate positions

Rows with the same normalized wallet are merged by summing `epochBalanceSeconds`.

Duplicate rows must report the same `weightedAcquisitionTimestamp`. A conflict is rejected instead
of being guessed or silently averaged.

The normalized output contains the merged economic position rather than the number of source rows.
Therefore a single row and a semantically equivalent split set of rows produce identical artifacts.
Input row order and exclusion order do not affect output.

## 5. Time-weighted metrics

For an epoch duration:

```text
epochDuration = epochEndTimestamp - epochStartTimestamp
```

The average eligible balance is:

```text
averageEligibleBalance = floor(epochBalanceSeconds / epochDuration)
```

Because PoH Core bounds eligible balances to `uint192`, the builder rejects any row or merged row
that violates:

```text
epochBalanceSeconds <= type(uint192).max * epochDuration
```

The age used for PoHPolicyV1 is:

```text
ageSeconds = 0                                      when weightedTimestamp = 0
ageSeconds = epochEndTimestamp - weightedTimestamp otherwise
```

A zero weighted timestamp represents no active aged position at epoch close. The wallet may still
have earned base-weighted exposure through balance-seconds earlier in the epoch.

A weighted timestamp after the epoch end is invalid.

## 6. PoHPolicyV1 math

The builder reproduces the Solidity policy using integer arithmetic:

```text
WAD            = 1e18
MAX_BONUS_WAD  = 0.75e18
MAX_AGE        = 365 days
cappedAge      = min(ageSeconds, MAX_AGE)
scaledRoot     = floor(sqrt(cappedAge * MAX_AGE))
bonus          = floor(MAX_BONUS_WAD * scaledRoot / MAX_AGE)
multiplierWad  = WAD + bonus
rewardWeight   = floor(averageEligibleBalance * multiplierWad / WAD)
```

The policy hash is:

```text
keccak256(
  "POH_POLICY_V1|curve=sqrt|base=1e18|maxBonus=0.75e18|"
  "maxAge=365days|tiers=7,30,90,180,365"
)
```

Its v0.1 value is:

```text
0x9199827b32332fc31a20d3c88fef4a602275345bd7c6e0f2d18859c5d86042c4
```

The builder recomputes this value and rejects a different input commitment. No binary
floating-point arithmetic is used.

## 7. Reward allocation

Only non-excluded rows with positive reward weight participate.

```text
totalWeight = sum(walletWeight)
baseAllocation = floor(rewardAmount * walletWeight / totalWeight)
remainder = (rewardAmount * walletWeight) mod totalWeight
```

After base allocations, remaining base units are assigned in this order:

1. larger remainder first;
2. normalized address ascending as the deterministic tie-break.

This is `largest-remainder-v1`.

The builder enforces:

```text
sum(allocation) = rewardAmount
```

Rows receiving zero base units remain in the public dataset but are omitted from the Merkle tree.

## 8. Leaf indices

Positive allocations are sorted by normalized beneficiary address. Contiguous indices beginning at
zero are then assigned.

The index is part of the on-chain claim leaf. An index is not a tree-array position.

## 9. Ethereum leaf hash

The domain is:

```text
LEAF_DOMAIN = keccak256("POH_EPOCH_REWARD_LEAF_V1")
```

Each claim leaf is:

```solidity
innerHash = keccak256(
    abi.encode(
        LEAF_DOMAIN,
        chainId,
        distributor,
        epochId,
        index,
        account,
        amount
    )
);

leaf = keccak256(bytes.concat(innerHash));
```

The builder implements Ethereum Keccak-256 directly. It does not use NIST SHA3-256.

## 10. Merkle tree

The builder matches OpenZeppelin `StandardMerkleTree` format `standard-v1` with default leaf
sorting:

- leaves are sorted by their 32-byte hash;
- the tree is a complete binary tree represented by an array of `2n - 1` nodes;
- sorted leaves are written in reverse order at the end of the array;
- parents are generated from the last internal node back to index zero;
- internal node inputs are sorted as bytes32 values;
- internal node hash is `keccak256(minNode || maxNode)`;
- a proof walks the array sibling and parent indices to the root.

Odd leaf counts are not handled by duplicating or promoting the final leaf. The complete-array
layout determines varying leaf depths.

## 11. Canonical JSON

PoH JSON v0.1 is:

- UTF-8;
- object keys sorted lexicographically;
- no insignificant whitespace;
- integer and string values only;
- no NaN, Infinity, or floating point;
- normalized lowercase addresses.

Artifact hashes are Ethereum Keccak-256 of the canonical object bytes. Human-readable files are
written with indentation; verification reparses and canonicalizes them before hashing.

## 12. Artifacts

A build writes five files.

### Normalized input

Commits to merged positions, normalized addresses, epoch bounds, effective exclusions, deployment
identifiers, and the fixed policy hash.

### Calculation manifest

Commits to:

- builder version;
- SHA-256 of the exact builder source;
- Keccak and ABI conventions;
- Merkle format;
- policy constants and formulas;
- allocation and tie-break rules.

### Dataset

Contains every normalized wallet row, derived metric, reward weight, allocation, exclusion status,
and optional leaf index.

### Claims

Contains positive allocations, exact leaf hashes, tree indices, and proofs.

### Manifest

Contains deployment identifiers, source block and time bounds, total allocation, total weight,
claim count, Merkle root, and hashes of all other artifact layers.

## 13. Verification

The `verify` command does not merely check whether the supplied files are internally
self-consistent. It:

- reconstructs the allowed v0.1 calculation manifest from the committed builder-source digest;
- rejects altered formulas, policy constants, tree rules, or allocation semantics;
- reconstructs and canonicalizes normalized input;
- deterministically rebuilds the complete dataset, claims, proofs, root, and manifest;
- compares rebuilt objects with every supplied artifact;
- recalculates every artifact hash;
- checks contiguous claim indices;
- recomputes each ABI-encoded double-hashed leaf;
- verifies every proof against the manifest root;
- verifies the sum of claim amounts equals total allocation;
- verifies claims and manifest commit to the same dataset and root.

This prevents a mathematically altered artifact set from passing merely because an attacker also
recalculated its hashes.

The included CI additionally cross-checks the fixture root, leaves, and proofs against the official
`@openzeppelin/merkle-tree` package and against OpenZeppelin Contracts `MerkleProof` in Solidity.

## 14. CLI

Build:

```bash
python epoch_builder.py build \
  --input fixtures/epoch-input-v0.1.json \
  --output-directory ./out \
  --prefix epoch-1
```

Verify:

```bash
python epoch_builder.py verify \
  --directory ./out \
  --prefix epoch-1
```

## 15. Upstream indexer requirements

The upstream producer must independently establish:

- canonical token and accounting deployment addresses;
- canonical policy address and matching `policyHash`;
- canonical block range and finality threshold;
- complete transfer and exclusion-event ingestion;
- deterministic balance-seconds at both epoch boundaries;
- weighted acquisition timestamp at epoch close;
- chain-reorganization recovery;
- duplicate-event protection;
- source RPC and archive-node provenance;
- exclusion-registry version;
- data-export hash.

The builder cannot detect a transfer event that was never supplied.

## 16. Security limitations

The builder provides deterministic calculation, not objective chain-history proof.

Production use remains blocked until:

- an independently implemented event indexer reproduces the same input;
- the source range is sufficiently final for the target chain;
- generated roots are reproduced by an independent operator;
- the root publisher is timelocked and multisignature-controlled;
- target-chain WETH and distributor fork tests pass;
- the complete system receives independent security review;
- monitoring, incident response, and a public bug bounty are active.
