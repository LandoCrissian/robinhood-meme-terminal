# RMT Universal Claim Layer

**Status:** RESEARCH ONLY / READ-ONLY FIRST

## Opportunity

Wallets contain more than settled balances. They also contain rights and pending actions scattered across project-specific interfaces:

- stock tokens behind a claim link;
- vesting NFTs with releasable amounts;
- asynchronous RWA-vault deposit/redeem requests;
- bridge refunds;
- airdrop allocations;
- distribution entitlements;
- LP/protocol fees available to collect;
- queued lending withdrawals;
- subscription entitlements;
- NFT vault/redemption claims.

These are economically meaningful but often invisible in normal terminals.

## Product thesis

RMT can become a **spot + claims terminal**:

```text
ASSETS | POSITIONS | NFTs | CLAIMS
```

Normalized lifecycle:

```text
pending -> claimable -> claimed
       \-> partially_claimable
       \-> refundable
       \-> expired
       \-> blocked
```

RMT does not need to issue a token to make an existing claim visible.

## Canonical claim identity

Research key:

```text
eip155:4663 / source-contract / claim-locator
```

Locator forms:

- bytes32 claim/invoice/request ID;
- uint256 request/token ID;
- bounded opaque protocol identity where source contract remains exact.

A claim snapshot binds:

- source capability and exact contract;
- beneficiary/controller;
- claim kind;
- output asset and amount confidence;
- lifecycle state;
- request/claimable/expiry times;
- transferability;
- compliance state;
- rollup block/time;
- evidence source.

The tested model is `src/claim-layer.ts`.

## Initial claim kinds

| Kind | Example |
| --- | --- |
| `escrow_drop` | Givest stock-token drop. |
| `async_deposit` | ERC-7540 deposit request awaiting claimable shares. |
| `async_redeem` | RWA-vault redemption awaiting claimable assets. |
| `vesting` | ERC-5725 or project vesting NFT. |
| `airdrop` | Merkle/project reward. |
| `distribution` | Pull-based project/RMT distribution entitlement. |
| `bridge_refund` | Failed/expired cross-chain funding refund. |
| `subscription_entitlement` | Paid agent/service access. |
| `lending_withdrawal` | Queued lender withdrawal. |
| `fee_collection` | LP/protocol fees ready to collect. |

## Adapter contract

A source adapter should answer:

```text
identify(claim)
readState(claim, block)
readBeneficiary(claim)
readAssetAndAmount(claim)
readTimes(claim)
readTransferability(claim)
readCompliance(claim)
planAction(claim, action, recipient)
verifyAction(plan, freshState)
reconcileReceipt(receipt)
```

No generic arbitrary-call adapter.

## Authorization rule

A claim action is only plannable when:

- source capability is verification-ready or better;
- claim evidence is verified and fresh;
- lifecycle state permits the action;
- beneficiary/controller/recipient binding is exact;
- output asset/amount semantics are exact;
- compliance is allowed or not applicable;
- runtime identity is current;
- claim has not expired;
- target/selector/calldata are provider-specific;
- full simulation succeeds;
- action deadline is current.

## Fee rule

Claims do not silently inherit RMT's 25-bps buy/sell fee.

A claim adapter may disclose:

- external protocol fee;
- gas/relayer fee;
- withdrawal/redemption fee;
- output haircut;
- early-exit fee.

Any future RMT fee for claims requires a separate explicit policy and settlement proof.

## RWA and stock-token claims

When output is a Robinhood Stock Token:

- resolve canonical contract from Robinhood's registry;
- preserve ERC-8056 multiplier semantics;
- preserve jurisdiction/eligibility restrictions;
- never imply a claim link/NFT removes those restrictions;
- recheck recipient eligibility immediately before action where required.

For ERC-7943-style assets, transfer checks and frozen state remain authoritative.

For ERC-7540/7575 vault claims:

- distinguish request ID, controller, owner, receiver, shares, and assets;
- preserve Pending / Claimable / Claimed state;
- never show pending output as spendable;
- separate valuation from executable redemption.

## First adapters

### Givest

Strong first fixture because it has:

- exact source contract;
- claim-key identity;
- stock-token output;
- claim/refund state;
- expiry;
- relayer/gasless behavior;
- auditable events.

RMT can surface claims while Givest remains source and settlement authority.

### RMT Distribution Center

A pull-based external distribution can expose claim state; a direct RMT airdrop is already settled and should appear as a receipt, not a pending claim.

### Hoodsea rewards

Epoch reward allocations can become a project claim adapter after deployment/runtime/event proof.

### RWA vaults

ERC-7540/7575 adapters remain research until actual Robinhood deployments and compliance semantics are independently verified.

## Future optional Claim Position NFT

A later protocol could represent a transferable claim as:

- ERC-721 for unique rights;
- ERC-3525 for same-class/variable-value claims;
- ERC-1155 for identical units.

Possible fields:

```text
source protocol / source contract
underlying asset / amount
beneficiary / controller
maturity / expiry
lifecycle state
transferability / compliance
adapter identity / evidence hash
```

This is not the first step. Tokenizing a claim can alter legal ownership, tax, compliance, bankruptcy rights, transferability, and double-claim risk.

The first product is a read-only normalized graph over existing protocols.

## UX

```text
CLAIMS

Stock Drop 0x…        Claimable       0.40 NVDAx
Vault Redeem #182     Pending          est. 311 USDG
Reward Epoch 14       Claimable       12,500 TOKEN
Bridge Session #91    Refundable      0.21 ETH
```

Each row shows source, exact contract/claim ID, asset/amount confidence, lifecycle, claimable/expiry time, compliance, external fees, and verified action state.

## Flywheel effect

Claims create return visits even when users are not trading. Projects gain higher claim completion and fewer support requests. Users recover stranded value. RMT becomes an asset-lifecycle terminal without custody or copied protocols.
