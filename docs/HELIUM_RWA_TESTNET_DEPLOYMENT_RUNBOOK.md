# RMT commodity evidence registry V0 — testnet deployment runbook

**Status:** PRE-BROADCAST PREPARATION ONLY  
**Target:** Robinhood Chain testnet (`chainId 46630`)  
**Authoritative mechanism:** canonical singleton CREATE2  
**Current authorization:** no deployment, no broadcast, no configuration, no evidence publication, no merge

## Scope

This runbook defines the only supported path from the synthetic evidence-registry proof to a separately authorized Robinhood Chain testnet deployment. The contract remains synthetic-only and creates no helium ownership, commodity title, custody right, redemption right, transferable instrument, token, price, fee, revenue right, or RMT-token entitlement.

The former direct `CREATE` plan based on an externally owned account's pending nonce is not an approved alternative. It was removed because a changing account nonce would change the predicted address and therefore the address-bound EIP-712 domain and runtime commitment. There must be one reviewable transaction packet, not two possible signing paths.

## Fixed deployment mechanism

The authoritative deployment transaction targets the canonical singleton CREATE2 deployer:

```text
CREATE2 deployer: 0x4e59b44847b379578588920cA78FbF26c0B4956C
Expected deployer runtime-code hash:
0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989
```

The preparation tool verifies that runtime hash at the recorded testnet block before producing a packet. The predicted registry address is derived from the fixed deployer, a source-and-administrator-bound salt, and the exact initcode hash.

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

A change to source, constructor argument, canonical deployer, or salt necessarily invalidates the packet and requires a new prediction, runtime rehearsal, domain separator, and review.

## Required public inputs

Preparation requires only:

1. `ADMINISTRATOR_ADDRESS` — the public testnet address permitted to register synthetic parties, configure the synthetic instrument, and apply administrative evidence states.
2. An approved Robinhood Chain testnet RPC endpoint. The RPC value is used at execution time and is not written into the release record.

A separately selected funded **deployment sender** is required only if broadcast is later authorized. The sender submits zero-value calldata to the fixed CREATE2 deployer; the sender's account nonce does not determine the registry address. The deployment sender and administrator may be different addresses.

No seed phrase, raw private key, mnemonic, wallet export, or password belongs in the repository, issue, pull request, manifest, CI secret, shell transcript, or chat.

## Source-freeze gate

Before generating a final packet:

1. confirm the exact PR head and current `main`;
2. ensure the feature branch is not behind `main`;
3. require every latest-head workflow to be green;
4. confirm the diff remains isolated to the evidence-registry tranche;
5. install the pinned contract dependencies;
6. require a clean working tree for every source, compiler, dependency, and fixture input bound by the preparation utility;
7. prohibit source changes after the packet is approved.

A source change invalidates the salt, creation code, initcode, predicted address, runtime hash, EIP-712 domain separator, gas rehearsal, and unsigned transaction payload.

## Authoritative no-key preparation

From the repository root:

```bash
bash packages/contracts/scripts/install-v4-deps.sh

python3 packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py \
  prepare \
  --administrator 0xYOUR_PUBLIC_TESTNET_ADMINISTRATOR \
  --output packages/contracts/deployments/rmt-commodity-evidence-registry-v0.prepared.json
```

The command:

- verifies chain ID `46630`;
- verifies the canonical CREATE2 deployer and exact runtime hash;
- builds the exact checked-in contract source with the pinned compiler profile;
- binds the constructor to the supplied administrator;
- derives the source-bound salt, initcode hash, and predicted address;
- checks that the predicted address is empty at the recorded block;
- forks that exact block into a temporary loopback Anvil instance;
- submits the deployment calldata only to the local fork;
- records locally measured gas used;
- records the exact runtime-code hash and EIP-712 domain separator at the predicted address;
- generates four unsigned administrator configuration payloads;
- leaves every authorization flag false;
- submits no remote transaction.

The generated prepared record expires after six hours. It must be regenerated if expired, if the branch changes, if the administrator changes, if the predicted address gains code, or if any deterministic commitment differs.

## Required packet contents

The final review packet must bind all of the following:

- exact repository branch and commit;
- contract, Foundry profile, remappings, dependency-installer, entrypoint, implementation, and fixture commitments;
- chain ID and testnet snapshot block/hash/timestamp;
- Solidity/compiler/optimizer/via-IR/EVM settings;
- approved administrator address;
- canonical CREATE2 deployer address and runtime-code hash;
- salt domain, salt, constructor arguments, creation-code hash, initcode hash, and deployment-calldata hash;
- predicted registry address and proof it was empty at the snapshot;
- expected runtime-code hash;
- expected EIP-712 domain separator;
- local-fork deployment gas used;
- destination, zero value, calldata file, calldata hash, and predicted result;
- the exact four unsigned configuration calls;
- false deployment, broadcast, configuration, evidence-publication, source-publication, merge, real-inventory, and token-issuance authorizations.

A packet missing any of these fields is not signable release evidence.

## Packet verification

Immediately before any owner review or future broadcast, regenerate and compare the packet:

```bash
python3 packages/contracts/scripts/prepare-rmt-commodity-evidence-registry-v0.py \
  verify \
  --record packages/contracts/deployments/rmt-commodity-evidence-registry-v0.prepared.json \
  --calldata packages/contracts/deployments/rmt-commodity-evidence-registry-v0.prepared.deployment-calldata.txt
```

Verification repeats the source checks and local-fork CREATE2 rehearsal. A successful result means only that the undeployed packet matches the checked-out source and current testnet view. It does not authorize signature or submission.

## Separate broadcast gate

A testnet broadcast requires a new explicit authorization naming the exact:

- network and chain ID;
- source commit;
- administrator address;
- selected deployment sender;
- fixed CREATE2 deployer destination;
- transaction value (`0`);
- salt;
- initcode hash;
- deployment-calldata hash;
- predicted registry address;
- expected runtime-code hash;
- expected domain separator;
- gas limit and maximum fee.

Immediately before signature, the predicted address must still contain no code and the prepared record must still be unexpired. The wallet review must show one zero-value call to the fixed CREATE2 deployer with the exact approved calldata. No configuration call may be bundled into the deployment transaction.

This runbook contains no broadcast command and grants no signing authority.

## Synthetic configuration sequence

Deployment and configuration are separate actions. Each later call requires its own exact transaction review and authorization:

1. deploy the registry through the fixed CREATE2 deployer;
2. register the public synthetic issuer address;
3. register the public synthetic custodian address;
4. register the public synthetic attestor address;
5. configure the synthetic helium instrument;
6. build one registry-address-specific EIP-712 evidence package;
7. obtain the three public synthetic role signatures;
8. publish the synthetic evidence package only after a separate publication authorization;
9. inspect stored/effective status through RPC and explorer logs.

The current authorization reaches none of these remote transactions.

## Post-deployment verification

After a separately authorized and mined deployment, create a completed release record and run:

```bash
bash packages/contracts/scripts/verify-rmt-commodity-evidence-registry-v0-deployment.sh \
  packages/contracts/deployments/rmt-commodity-evidence-registry-v0.completed.json
```

The read-only verifier must establish at minimum:

- exact deployment transaction destination, input, value, sender, receipt, block, and CREATE2 prediction;
- canonical deployer runtime provenance;
- runtime code at the predicted address and exact runtime-code hash;
- immutable administrator, target-chain constant, and synthetic-only constant;
- exact EIP-712 domain separator;
- zero retained native balance;
- strict-order configuration receipts and state read-back;
- exact synthetic party identities and role bitmaps;
- exact synthetic instrument configuration;
- no published evidence;
- no mint or supply surface.

Source publication remains a separate public action and is not authorized by deployment or postflight success.

## Stop conditions

Invalidate the packet immediately if:

- chain ID is not `46630`;
- source head or any bound file changes;
- `main` advances without review and synchronization;
- any latest-head workflow is not green;
- the administrator changes;
- the canonical CREATE2 deployer code/hash differs;
- the predicted address contains code;
- any salt, bytecode, constructor, calldata, runtime, domain, or fixture commitment differs;
- the prepared record expires;
- gas or fees exceed the approved ceiling;
- wallet review shows the wrong destination, nonzero value, altered calldata, or bundled calls;
- a signing secret appears in any file, log, environment output, or chat;
- any language suggests real inventory, title, backing, redemption, Robinhood endorsement, or token issuance.

## Remaining authorization gates

Separate explicit owner authorization is still required for:

- freezing the administrator address;
- selecting and funding a testnet-only deployment sender;
- broadcasting the exact testnet deployment packet;
- registering synthetic parties;
- configuring the synthetic instrument;
- publishing synthetic evidence;
- publishing source metadata;
- merging PR #372;
- connecting a UI;
- making a public demonstration or announcement;
- contacting Robinhood, a producer, custodian, laboratory, attestor, or other partner;
- introducing real inventory or any token/economic mechanism.
