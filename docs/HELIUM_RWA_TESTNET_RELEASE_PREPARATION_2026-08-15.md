# Helium RWA evidence registry V0 — testnet release preparation

**Status:** NO-KEY PREPARATION ONLY  
**Network:** Robinhood Chain testnet (`chainId 46630`)  
**Contract:** `RMTCommodityEvidenceRegistryV0`  
**Pull request:** draft PR #372  
**Deployment:** not performed  
**Remote transaction submission:** not authorized

## Purpose

This tranche prepares the synthetic commodity-evidence registry through the final pre-broadcast boundary without requiring Codex, a wallet connection, a private key, a funded account, or a remote transaction.

The release tool produces a source-bound CREATE2 deployment record for one explicitly supplied **public administrator address**. It independently derives the contract initcode, salt, predicted address, expected runtime bytecode hash, expected EIP-712 domain separator, and the four administrator configuration calls required for the synthetic helium demonstration.

It does not deploy, configure, publish evidence, verify source publicly, merge the pull request, or create a commodity or token right.

## Files

- `packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py`
  - accepts a public administrator address;
  - accepts no private key or mnemonic;
  - reads Robinhood Chain testnet only;
  - verifies the live canonical CREATE2 deployer and its runtime hash;
  - builds the exact reviewed contract artifact;
  - derives source- and administrator-bound CREATE2 material;
  - checks that the predicted address is empty at the recorded live block;
  - forks that exact block into a loopback Anvil instance;
  - submits the deployment calldata only to that local fork using an impersonated local account;
  - records the exact expected runtime hash and EIP-712 domain separator at the predicted address;
  - generates four unsigned administrator configuration payloads;
  - writes an expiring `PREPARED_UNDEPLOYED` record and a separate deployment-calldata file;
  - verifies a prepared record by regenerating it from source and repeating the local-fork rehearsal.

- `packages/contracts/deployments/rmt-commodity-evidence-registry-v0.template.json`
  - remains an `UNDEPLOYED_TEMPLATE` with zero addresses and no authorization;
  - records the actual compiler profile used by the repository: Solidity `0.8.26`, optimizer runs `200`, `viaIR=true`, EVM version `cancun`;
  - contains no prepared or deployed claim.

- `packages/contracts/test/RMTCommodityEvidenceRegistryV0Create2Readiness.t.sol`
  - proves salt-plus-initcode deployment reaches the exact CREATE2 prediction;
  - proves the constructor binds the approved administrator;
  - proves the EIP-712 domain and runtime hash bind the exact deployed address;
  - proves the same salt and initcode cannot be deployed twice;
  - proves zero-administrator and wrong-chain deployment fail closed.

## Why CREATE2 is used for preparation

The registry inherits OpenZeppelin EIP-712 behavior that caches the verifying contract address and chain ID. Consequently, the deployed runtime bytecode hash is not determined by source code and administrator alone: it also depends on the exact contract address.

A normal `CREATE` address depends on the deployer account and its live nonce. That would make the expected runtime hash unstable until a deployer and nonce were frozen.

The release tool instead uses the canonical singleton CREATE2 deployer already verified in the RMT repository:

```text
CREATE2 deployer:
0x4e59b44847b379578588920cA78FbF26c0B4956C

Expected runtime-code hash:
0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989
```

The CREATE2 salt is derived from:

```text
keccak256(
  abi.encode(
    keccak256("RMT_COMMODITY_EVIDENCE_REGISTRY_V0_CREATE2_SALT"),
    approvedAdministrator,
    bytes20(sourceCommit)
  )
)
```

This makes the predicted address bind:

- the canonical deployment mechanism;
- the exact initcode;
- the administrator address;
- the exact repository commit.

A later source or administrator change necessarily creates a different salt, initcode hash, or predicted address and requires a fresh record.

## Preparation command

From the repository root, after installing the pinned contract dependencies:

```bash
bash packages/contracts/scripts/install-v4-deps.sh

python3 packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py \
  prepare \
  --administrator 0xYOUR_PUBLIC_TESTNET_ADMINISTRATOR \
  --output packages/contracts/deployments/rmt-commodity-evidence-registry-v0.prepared.json
```

The RPC defaults to the official testnet endpoint already used by the repository. A different testnet RPC may be supplied without being written into the record:

```bash
ROBINHOOD_TESTNET_RPC_URL=https://your-testnet-rpc.example \
python3 packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py \
  prepare \
  --administrator 0xYOUR_PUBLIC_TESTNET_ADMINISTRATOR
```

The command refuses:

- the zero address;
- a malformed administrator address;
- any chain other than `46630`;
- a missing or altered canonical CREATE2 deployer;
- dirty tracked contract, compiler, remapping, or fixture inputs;
- a predicted address that already contains code;
- an existing output file unless `--overwrite` is explicit;
- overwriting the checked-in undeployed template.

## Generated artifacts

The default command writes three local files:

```text
packages/contracts/deployments/
  rmt-commodity-evidence-registry-v0.prepared.json
  rmt-commodity-evidence-registry-v0.prepared.deployment-calldata.txt
  rmt-commodity-evidence-registry-v0.prepared.sha256
```

They are not committed automatically.

The prepared record contains:

- source branch and full commit SHA;
- SHA-256 commitments for the contract, Foundry profile, remappings, and both synthetic fixtures;
- live testnet block number, hash, and timestamp;
- exact compiler settings;
- canonical CREATE2 deployer and verified runtime hash;
- source- and administrator-bound CREATE2 salt;
- creation code hash;
- ABI-encoded constructor arguments;
- initcode hash;
- predicted contract address;
- deployment-calldata hash;
- local-fork deployment gas used;
- expected deployed runtime-code hash;
- expected EIP-712 domain separator;
- public synthetic party addresses and party IDs;
- exact unsigned calldata for the three party registrations and instrument configuration;
- exact public and full synthetic fixture hashes;
- an explicit false value for every deployment, broadcast, merge, source-publication, real-inventory, and token authorization.

The record deliberately excludes:

- RPC credentials;
- private keys;
- mnemonics;
- signatures;
- wallet sessions;
- a selected funded deployer;
- any claim that the administrator was approved;
- any claim that a transaction occurred.

## Prepared-record verification

The prepared record expires six hours after the live snapshot used to build it. This prevents a stale empty-address check from being treated as current deployment authority.

Verification reruns the build and a fresh local-fork simulation and compares the deterministic release fields:

```bash
python3 packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py \
  verify \
  --record packages/contracts/deployments/rmt-commodity-evidence-registry-v0.prepared.json \
  --calldata packages/contracts/deployments/rmt-commodity-evidence-registry-v0.prepared.deployment-calldata.txt
```

A successful verification means only that the undeployed record matches the checked-out source and the current live testnet view. It does not authorize or submit a transaction.

## Local-fork safety boundary

The tool starts Anvil on a random `127.0.0.1` port and forks the recorded Robinhood testnet block. It impersonates an unfunded local-only address and assigns balance only inside that temporary fork.

The code contains:

- no private-key argument;
- no mnemonic argument;
- no `DEPLOYER_PRIVATE_KEY` read;
- no wallet connector;
- no remote `cast send` destination;
- no `forge ... --broadcast` command.

The temporary Anvil process is terminated whether the rehearsal succeeds or fails.

## Unsigned transaction sequence

A prepared record describes—but does not authorize—the following sequence:

1. Send zero value and the reviewed `salt || initcode` calldata to the canonical CREATE2 deployer.
2. From the approved administrator, register the public synthetic issuer address.
3. From the approved administrator, register the public synthetic custodian address.
4. From the approved administrator, register the public synthetic attestor address.
5. From the approved administrator, configure the synthetic helium instrument.

Evidence publication is not part of this preparation sequence and remains separately disabled.

The deployment signer and administrator may be different addresses. If the administrator is a Safe or another contract account, steps 2–5 must be executed through that account's own authorization process. This repository does not infer control of a public address.

## Separate broadcast gate

Before any real testnet submission, all of the following remain required:

1. PR #372 remains on a green, reviewed latest head.
2. The exact administrator public address is explicitly approved.
3. A fresh prepared record is generated and verified before expiry.
4. The completed record is reviewed for the source commit, salt, initcode hash, predicted address, expected runtime hash, expected domain separator, and every transaction payload.
5. The predicted address is rechecked as empty immediately before submission.
6. A dedicated testnet-only funded deployer is selected.
7. The deployment transaction is displayed with destination, value, calldata hash, gas estimate, and predicted result.
8. The owner separately authorizes the Robinhood Chain **testnet** broadcast.
9. The wallet signs without exposing its private key to the repository or chat.

No current file or instruction satisfies that broadcast gate.

## Post-deployment evidence required later

After a separately authorized deployment, a completed record must add:

- deployment sender;
- transaction hash;
- receipt status;
- block number and block hash;
- exact transaction input hash;
- live contract address;
- live runtime-code hash;
- live administrator;
- live target-chain and synthetic-only values;
- live EIP-712 domain separator;
- configuration transaction hashes;
- read-back of each synthetic party and instrument configuration;
- Blockscout source-verification result.

A deployed address alone is insufficient.

## Source verification plan

The repository compiler profile is:

```text
Solidity: v0.8.26+commit.8a97fa7a
optimizer: enabled
optimizer runs: 200
via IR: true
EVM version: cancun
```

After deployment and read-only postflight verification, exact source publication should use Blockscout at:

```text
https://explorer.testnet.chain.robinhood.com/api/
```

Constructor arguments are the ABI encoding of the approved administrator address. Source publication remains a separate public action and is not authorized by this preparation tranche.

## Codex coexistence

This work remains in the helium/RWA contract branch and draft PR #372. It does not modify:

- `apps/web`;
- terminal routes or UI;
- wallets or providers;
- VNext execution;
- Agent Engine or Arena;
- indexers;
- production environment files;
- production health checks;
- fee behavior;
- token economics;
- `ARCHITECTURE_FREEZE.md`;
- `ACTIVE_SYSTEM_MAP.md`.

Codex can continue the terminal and Agent Engine work independently. No merge, deployment, broadcast, public announcement, real commodity record, partner claim, or RMT-token change is created by this release-preparation package.
