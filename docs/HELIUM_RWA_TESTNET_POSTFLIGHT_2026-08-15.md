# Helium RWA evidence registry V0 — deployment postflight

**Status:** PREPARED, NOT EXECUTED  
**Network:** Robinhood Chain testnet (`chainId 46630`)  
**Deployment:** none  
**Blockchain transaction submitted:** none  
**Source published:** no

## Purpose

This runbook defines the evidence required after a separately authorized synthetic-registry testnet deployment. It does not authorize that deployment, the four configuration transactions, source publication, evidence publication, or any token or real-commodity action.

A contract address is not sufficient evidence of a valid release. RMT must independently bind the address to the reviewed source, CREATE2 inputs, deployment transaction, exact runtime code, EIP-712 domain, administrator, synthetic parties, instrument configuration, and absence of published evidence.

## Read-only deployment verifier

After a completed release record exists, run:

```bash
bash packages/contracts/scripts/verify-rmt-commodity-evidence-registry-v0-deployment.sh \
  packages/contracts/deployments/rmt-commodity-evidence-registry-v0.completed.json
```

The verifier accepts no private key, mnemonic, signature, wallet session, or broadcast flag. It performs only RPC reads and local Foundry simulation.

It rejects the release unless all of the following match:

- source commit and clean checked-out release inputs;
- Robinhood Chain testnet chain ID `46630`;
- canonical singleton CREATE2 deployer and pinned runtime hash;
- CREATE2 salt, initcode hash, and predicted address;
- zero-value deployment transaction to the canonical CREATE2 deployer;
- exact deployment calldata and successful receipt;
- empty predicted address immediately before the deployment block;
- runtime code present at the deployment block;
- live runtime-code hash equal to the locally rehearsed expected hash;
- administrator, target-chain constant, synthetic-only constant, and EIP-712 domain separator;
- zero native-currency balance;
- four successful administrator configuration transactions in strict order;
- exact sender, destination, zero value, calldata, calldata hash, chain, and receipt for each configuration transaction;
- public synthetic issuer, custodian, and attestor identities and role bitmaps;
- exact synthetic helium instrument configuration;
- no published evidence and no consumed batch nonce;
- no callable `mint(address,uint256)` or `totalSupply()` surface.

The Solidity postflight is implemented in:

```text
packages/contracts/script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol
```

Its focused tests cover the valid topology and rejection of a wrong runtime hash, wrong administrator, missing configuration, and wrong chain.

## Completed-record boundary

The read-only verifier expects a completed record whose status is one of:

```text
DEPLOYED_CONFIGURED
VERIFIED_CONFIGURED
```

A completed record must retain the original prepared CREATE2 values and add:

- approved administrator address;
- selected testnet deployment sender;
- deployment transaction hash and block;
- live runtime-code hash;
- live EIP-712 domain separator;
- four configuration transaction hashes;
- `instrument.configured = true`;
- historical testnet broadcast authorization;
- `boundaries.remoteTransactionSubmitted = true`.

Even after testnet deployment, these fields must remain false:

```text
authorization.mergeAuthorized
authorization.realInventoryAuthorized
authorization.tokenIssuanceAuthorized
```

The contract remains synthetic-only and creates no commodity, redemption, transfer, revenue, or RMT-token right.

## Exact source-verification dry run

After deployment postflight passes, generate and inspect the exact Blockscout compiler input locally:

```bash
bash packages/contracts/scripts/verify-rmt-commodity-evidence-registry-v0-sources.sh \
  packages/contracts/deployments/rmt-commodity-evidence-registry-v0.completed.json \
  --dry-run
```

The dry run validates:

```text
Solidity compiler: v0.8.26+commit.8a97fa7a
optimizer: enabled
optimizer runs: 200
via IR: true
EVM version: cancun
constructor argument: approved administrator address
contract: src/RMTCommodityEvidenceRegistryV0.sol:RMTCommodityEvidenceRegistryV0
```

Dry-run mode publishes nothing and submits no transaction.

## Public source-publication gate

Source publication is a separate public action. The script refuses live publication unless both completed-record authorizations are true and the operator supplies the explicit confirmation phrase:

```text
authorization.sourcePublicationAuthorized = true
sourceVerification.publishAuthorized = true
SOURCE_PUBLICATION_CONFIRMED=YES_PUBLISH_SYNTHETIC_REGISTRY_SOURCE
```

Only after a separate authorization would the command be:

```bash
SOURCE_PUBLICATION_CONFIRMED=YES_PUBLISH_SYNTHETIC_REGISTRY_SOURCE \
  bash packages/contracts/scripts/verify-rmt-commodity-evidence-registry-v0-sources.sh \
  packages/contracts/deployments/rmt-commodity-evidence-registry-v0.completed.json \
  --publish
```

This submits source metadata to the public testnet Blockscout API. It does not submit an EVM transaction.

## Current gate

No completed record exists because no administrator address has been approved and no deployment has been authorized. The checked-in deployment template therefore remains `UNDEPLOYED_TEMPLATE`, with zero addresses and every authorization disabled.
