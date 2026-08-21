# CCFF00 Community Engine — Robinhood Chain semantics V1

**Status:** PLANNING ONLY — CHAIN-SPECIFIC INTEGRATION RULES  
**Chain:** Robinhood Chain mainnet, chain ID `4663`

Robinhood Chain is EVM-compatible but has Arbitrum Orbit/L2 semantics that matter for timing, historical state, receipts, gas and finality. This document prevents generic-EVM assumptions from leaking into Community Engine logic.

## 1. Current network facts to revalidate at implementation time

Current Robinhood/hood.dev documentation identifies:

```text
chainId: 4663
native gas token: ETH
stack: Arbitrum Orbit L2 settling to Ethereum
public RPC: https://rpc.mainnet.chain.robinhood.com
explorer: https://robinhoodchain.blockscout.com
L2 block time: approximately 0.1 seconds
parent-chain block time: approximately 12 seconds
```

Provider/endpoints/performance can change. Chain ID is the primary immutable execution identity; endpoint support must be rechecked.

## 2. Critical block-number distinction

Current Robinhood/hood.dev documentation warns that Solidity:

```solidity
block.number
```

tracks the **parent-chain block number** under this stack, not a one-to-one ~0.1-second L2 block counter.

Therefore never use:

```text
Solidity block.number delta × assumed L2 block time
```

for Community Engine wall-clock timing.

This is especially important for:

- randomness lead windows;
- mint-stage expiry calculations;
- retry timeouts;
- gas-budget epochs;
- holding/admission age if a future policy ever uses it;
- timelock/cooldown interpretations.

## 3. Acquisition anchor uses RPC receipt/block identity

Normative Fair Allocation V1 anchor:

```text
confirmed acquisition transaction receipt
→ receipt.blockNumber
→ exact RPC block at that blockNumber
→ block.hash
→ block.timestamp
```

Store/hash:

```text
allocationAnchorBlock
allocationAnchorBlockHash
allocationAnchorTimestamp
```

The randomness target time derives from **timestamp**, not from multiplying a block count by an assumed duration.

## 4. Historical census uses the same RPC block identity

Allocation census:

```text
snapshotBlock == allocationAnchorBlock
snapshotBlockHash == allocationAnchorBlockHash
```

Every relevant historical read uses explicit `blockNumber`/block tag at that RPC block under an archive-capable provider.

Do not substitute:

- current latest state;
- Solidity parent block number;
- a block estimated from timestamps;
- an explorer page's presentation number without RPC confirmation.

## 5. Finality/confirmation depth is a policy, not block-time arithmetic

Package G/H must establish the appropriate current Robinhood confirmation/finality policy from live chain/provider behavior and current RMT conventions.

Do not say:

```text
"20 blocks = 2 seconds"
```

unless those are explicitly the correct RPC/L2 block semantics and evidence at implementation time.

Prefer explicit terms:

```text
receipt included
required L2 confirmation/reorg-depth policy satisfied
allocation/inventory finality gate satisfied
```

with measured evidence.

## 6. EVM contract block-number windows

If a third-party NFT contract uses `block.number` internally for a mint stage/cooldown:

- inspect the actual contract implementation;
- interpret it under Robinhood's Solidity block semantics;
- never convert the number into L2-block time by assumption.

Many NFT drop contracts use Unix timestamps instead, which are easier to verify for stage timing.

Adapter semantics must record whether a stage is:

```text
TIMESTAMP_BASED
SOLIDITY_BLOCK_NUMBER_BASED
CUSTOM
```

and validate accordingly.

## 7. Timestamp use

For offchain scheduling/future drand round derivation, use the canonical acquisition block's RPC timestamp.

Do not use:

- local server wall clock as anchor;
- provider response observedAt as anchor;
- operator-entered timestamp as anchor.

The fixed policy may add a reviewed number of seconds to the canonical block timestamp.

## 8. Chain ID everywhere

Every plan/evidence/policy domain that can cross environments must bind:

```text
chainId = 4663
```

Testnet is distinct and must never produce a mainnet-admitted proof by accident.

Robinhood testnet currently uses a different chain ID; revalidate exact current testnet identity before canary/test usage.

## 9. RPC provider strategy

### Public RPC

Appropriate for:

- ordinary current reads;
- low-volume evidence;
- fallback/testing as documented.

Current docs describe public RPC as rate-limited.

### Archive-capable RPC

Required for:

- acquisition-block historical `ownerOf`/TBA state;
- provenance/deployment-boundary historical code reads;
- deterministic reconstruction after time passes;
- fork/replay evidence where current provider cannot serve old state.

The archive provider is transport, not authority; exact block hash/runtime checks still apply.

## 10. Multi-RPC evidence

For critical release/canary evidence, a second independent provider can be used to corroborate:

- chain ID;
- block hash;
- runtime bytecode;
- receipt;
- historical state.

Do not require every normal read to hit multiple providers unless operations justify the cost/latency.

If independent providers disagree on a canonical block/runtime:

```text
STOP / DEGRADED
```

rather than choose the answer that allows execution.

## 11. RPC retry boundaries

Safe automatic retries:

```text
eth_chainId
eth_getBlockByNumber
eth_getCode
eth_call
eth_getLogs
eth_getTransactionReceipt
eth_estimateGas
```

subject to bounded backoff/timeouts.

Transaction submission is different:

```text
eth_sendRawTransaction / signer provider send
```

may have succeeded even if response timed out. That becomes `TX_UNCERTAIN` until reconciled.

## 12. Log ordering

Canonical ordering for merged chunk/provider log reads:

```text
blockNumber
transactionIndex
logIndex
```

Validate block identity/canonical receipt where required.

Do not rely on API response order alone.

## 13. Log chunking

Package B and future event reads should use bounded ranges because provider max-range/result limits vary.

Chunk size is an operational/provider setting, not evidence semantics.

Changing chunk size must not change canonical output/hash.

## 14. Reorg handling

Before a mint acquisition enters committed inventory/fairness:

- wait for admitted confirmation/finality policy;
- re-read canonical receipt/block;
- verify expected events/ownership.

Shallow reorg before commitment:

```text
reconcile/rebuild from canonical chain
```

Deep reorg affecting already committed allocation/delivery evidence:

```text
AUTOPAUSE_REORG
```

and require reviewed reconstruction; never silently select new winners.

## 15. Transaction receipt gas accounting

Confirmed native gas accounting should begin from receipt facts such as:

```text
gasUsed
effectiveGasPrice
```

then verify current Robinhood/Arbitrum receipt semantics for any separate L1/data fee components before defining total cost.

Do not double-count a fee that is already embedded in effective gas accounting.

Package G canary should capture raw relevant receipt fields so `GAS_COST_MODEL_V1.md` can freeze the correct formula from evidence.

## 16. Gas token

Native gas is ETH.

Community Collector V1 therefore needs native ETH for its own acquisition/delivery transactions unless a separately proven sponsorship rail is used later.

RMT itself is **not** the native chain gas token.

RMT Pay can make the user experience gasless/sponsored while RMT is burned for utility, but under the hood native network gas remains ETH-funded by the sponsor.

## 17. `msg.sender` and account abstraction

EVM/AA wrappers can change who is visible as `msg.sender` to downstream calls depending on execution pattern.

This matters for:

- CCFF00 TBA owner authorization;
- allowlist/minter identity;
- per-wallet mint limits;
- RMT Pay TBA execution.

Package J/F/G must test exact call stack/account model. Do not assume “same user” means same `msg.sender` under a smart-account wrapper.

## 18. Transaction ordering/front-running

A free mint may have limited supply and concurrent public minters.

The engine can:

- observe stage opening;
- submit within gas policy;
- reconcile actual success/failure.

It cannot guarantee mint capture.

Do not add unsafe gas bidding/front-running behavior to promise success.

A failed/reverted mint may still spend ETH gas and belongs in gas accounting.

## 19. Contract runtime identity

For every automated mint adapter:

- get exact code at target;
- classify direct/proxy/clone;
- bind implementation as needed;
- refresh immediately before sign.

Explorer verified-source status is enrichment, not runtime identity.

## 20. CREATE/CREATE2 assumptions

If a factory/collection uses CREATE2, deterministic address claims must bind exact deployer/factory/salt/initcode hash.

Do not infer “same address formula” across chains/factories without proving inputs.

This is primarily relevant if HoodMint/another factory family becomes an admitted discovery/mint adapter.

## 21. ERC-6551 registry/account semantics

CCFF00 canonical TBA evidence already binds:

```text
Robinhood chain ID
CCFF00 collection
token ID
registry
implementation
salt
```

Keep the same exact chain binding in future NFT custody/RMT Pay proofs.

A token-bound account calculated for another chain is not the same destination.

## 22. Testnet use

Robinhood docs recommend testnet-first for deployments/testing.

For Community Engine:

- pure census/fairness/provider observation can be mainnet read-only;
- new contract deployment should rehearse on testnet/fork as current RMT policy requires;
- a real mainnet third-party NFT mint may have no identical testnet collection, so adapter logic uses fixtures/forks before tightly authorized mainnet canary.

Never present testnet proof as mainnet runtime proof.

## 23. Time-zone independence

All chain/stage/policy timestamps in evidence are Unix/UTC canonical values.

UI may localize them, but hashing/eligibility must not depend on server/user timezone.

## 24. Chain-specific test cases

Future tests should include:

- chainId wrong/testnet instead of 4663;
- historical block hash mismatch;
- archive read unavailable;
- RPC block timestamp exact boundary for drand round;
- Solidity-block-number stage fixture under parent-block cadence;
- log chunks reordered/duplicated;
- two RPC providers disagree;
- reorged acquisition receipt;
- gas receipt fields captured without double counting;
- AA wrapper changes `msg.sender` and TBA authorization fails.

## 25. V1 rule

When a Robinhood-chain quirk conflicts with a generic Ethereum assumption:

> model the exact deployed/observed Robinhood behavior and fail closed rather than forcing the generic assumption.

That applies to block numbering, account abstraction, receipts, proxies and historical state.
