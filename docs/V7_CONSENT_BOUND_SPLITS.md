# V7 consent-bound collaborator splits

Status: source-level implementation only

Date: July 30, 2026

Deployment: none

Audit: none

## Purpose

`RMTV7ConsentBoundSplitModule` and `RMTV7ConsentBoundSplit` provide the narrow payout primitive required before marketplace settlement. A creator cannot silently assign a collaborator a share, change a recovery wallet after consent, or redirect funds through an RMT administrator.

This increment is not a marketplace, fee router, royalty guarantee, escrow, investment product or RMT token flywheel. No contract is deployed, registered or enabled in the product.

## Exact consent boundary

The earlier creator-collaboration invitation proves that a collaborator accepted an asset role and proposed share before release preparation. Split deployment requires a second, narrower EIP-712 signature from every payout recipient. That signature binds:

- the chain and exact split-module deployment through the EIP-712 domain;
- the release registry and release ID;
- the immutable release creator;
- the split module;
- the complete split configuration hash;
- the exact payout-manifest hash;
- the recipient wallet;
- the recipient's basis-point share;
- the recipient's optional recovery wallet;
- a deadline no more than 30 days in the future.

Changing any recipient, order, share, recovery address, deadline, release, creator, registry, module or chain invalidates the signature. Both EOA signatures and ERC-1271 contract-wallet signatures are supported.

The web manifest builder canonically orders recipients, rejects duplicates, requires one to 32 recipients and requires shares to total exactly 10,000 basis points. It creates unsigned review packets and never signs or broadcasts.

After signatures are supplied, the separate transaction-simulation builder validates their one-to-one positional relationship with the frozen configuration and produces:

- exact `deploySplit` calldata;
- configuration, payout and consent manifest hashes;
- a fingerprint of every included signature;
- plain-language immutable commitments and future payout behavior;
- explicit empty asset-movement, token-approval and platform-fee lists; and
- every live-chain condition that remains unverified.

The builder does not verify EOA or ERC-1271 signatures and cannot prove current chain state. It keeps wallet signing, broadcasting and contract execution disabled.

## Deployment conditions

A split can be deployed only when:

1. the module is still the active kind `3`, version `1` implementation in the append-only module registry;
2. its interface and current runtime code hash still match the registry record;
3. the caller is the exact creator of a frozen release;
4. that release froze the exact split-module key and configuration hash;
5. that release committed the exact payout-manifest hash;
6. every recipient signature validates against the same configuration;
7. the consent deadline is still live; and
8. no split was already deployed for the release.

The split contract independently recomputes the payout, consent and configuration hashes in its constructor. A direct deployment cannot publish dishonest immutable fingerprints.

## Payment behavior

The split accepts native currency and standard non-rebasing ERC-20 tokens. Funds are not pushed to every recipient in one loop. Each recipient's lifetime entitlement is:

```text
floor((current split balance + lifetime amount already released) × signed share / 10,000)
```

Anyone may trigger a normal release, but the destination is always the exact recipient. A recovery release can be triggered only by that recipient or the recovery wallet they signed, and it can pay only that recovery wallet.

If a native or token transfer reverts, the entire release and its accounting revert. Other recipients remain able to withdraw independently. There is no owner, RMT administrator, creator override, sweep, arbitrary redirect, fee, proxy or upgrade function.

Rounding dust remains in the split until later deposits make it distributable. Fee-on-transfer, rebasing, callback-heavy and otherwise non-standard ERC-20s are not supported by this version and must not be presented as compatible.

## Economic separation

The payout-manifest hash represents creator/collaborator proceeds. It does not authorize an RMT marketplace fee or divide RMT treasury revenue. A future settlement contract must:

1. calculate and disclose the approved marketplace fee;
2. separate that fee from net creator proceeds;
3. send only net creator proceeds to this split;
4. handle buyer refunds and failed settlement before treasury allocation; and
5. keep any later token action under separate delayed governance and public accounting.

V6 token-market 70/30 fees remain a separate accounting domain.

## Tested properties

`RMTV7ConsentBoundSplitModule.t.sol` verifies:

- exact EOA and ERC-1271 recipient consent;
- one deterministic split per frozen release;
- immutable creator, recipients, shares, recoveries, deadline and manifest hashes;
- native and ERC-20 lifetime distribution;
- failed native transfers preserve all accounting and funds;
- recipient-authorized recovery works while unrelated callers fail;
- signatures cannot replay across releases;
- wrong signers and expired consent fail;
- payout-manifest and creator mismatches fail;
- duplicate recipients and invalid share totals fail;
- module deactivation blocks new deployment;
- direct deployment cannot lie about hashes;
- the module rejects native-asset custody; and
- Solidity and TypeScript share fixed configuration vectors.

## Remaining blockers

- independent smart-contract security review;
- property/invariant fuzzing beyond the current adversarial unit suite;
- a production fee policy and separately reviewed settlement contract;
- independently reviewed production anchors, RPC finality policy and a second live verification immediately before any wallet request;
- product disclosure for recipient, recovery, supported-token and rounding behavior;
- deployment scripts, verification artifacts, monitoring and incident response;
- explicit authorization for testnet deployment; and
- separate explicit authorization for any later mainnet deployment.
