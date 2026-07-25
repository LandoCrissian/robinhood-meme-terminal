# PoH Epoch Builder v0.1

This directory contains the dependency-free deterministic allocation and Merkle-artifact builder for
PoH Epoch Rewards.

## Build a fixture

```bash
python epoch_builder.py build \
  --input fixtures/epoch-input-v0.1.json \
  --output-directory ./out \
  --prefix epoch-7
```

## Verify artifacts

```bash
python epoch_builder.py verify \
  --directory ./out \
  --prefix epoch-7
```

## Run tests

```bash
python -m py_compile epoch_builder.py
python -m unittest -v test_epoch_builder.py
```

The test suite covers Ethereum Keccak vectors, PoHPolicyV1 integer math, ABI leaf vectors,
OpenZeppelin complete-tree construction, proof generation, deterministic normalization, exact
largest-remainder allocation, 10,000 randomized allocation datasets, 250 randomized Merkle
datasets, artifact tamper detection, and write/load verification.

GitHub Actions also rebuilds the fixture and cross-checks its root, leaves, and proofs with
`@openzeppelin/merkle-tree@1.0.8`. Foundry independently verifies the same fixture with OpenZeppelin
Contracts `MerkleProof`.

This tool does not retrieve chain data and does not prove that an upstream event indexer was
complete. Generated artifacts are non-production test vectors until independent chain-history
reconstruction, finality policy, timelocked root publication, fork testing, audit, monitoring, and a
bug bounty are complete.
