# CCFF00 Community Engine upstream reuse ledger V1

**Status:** PLANNING ONLY — PUBLIC UPSTREAM REVIEW AS OF 2026-08-21  
**Goal:** prevent future Codex work from rebuilding commodity infrastructure or re-evaluating already rejected dependencies without new evidence.

Provider support, pricing, licenses and deployment identities can change. Every external component still requires implementation-time revalidation before production admission.

## 1. Classification

Each upstream falls into one of four buckets:

```text
REUSE NOW        — already in RMT or directly appropriate for early bounded package
ADAPTER CANDIDATE — useful, but must be live-probed/runtime-verified before admission
REFERENCE ONLY   — architecture/implementation ideas worth copying conceptually, not adopting now
REJECT V1        — current hosted/support model does not fit Robinhood V1 or violates architecture
```

## 2. Existing RMT/standard stack — REUSE NOW

### viem

RMT already uses viem 2.x.

Use for:

- chain/RPC reads;
- ABI encode/decode;
- `eth_call`/simulation;
- log parsing;
- block/receipt reads;
- canonical EVM addresses/hashes;
- transaction preparation in later admitted packages.

Do not add ethers/web3.py merely because an upstream example uses them.

### Foundry + OpenZeppelin

Already established in `packages/contracts`.

Use only when a new contract is actually justified, e.g. future gas vault after Package H evidence.

Do not deploy a contract merely to solve an offchain orchestration problem.

### CCFF00 canonical ERC-6551 implementation

Already integrated in RMT through the exact collection/registry/implementation/salt evidence.

Do not add a generic Tokenbound SDK merely to resolve addresses RMT can already derive/verify directly.

## 3. OpenSea Drops API — ADAPTER CANDIDATE

Current documentation describes buyer-side APIs that can:

- discover drops;
- return stage/price/max-per-wallet details;
- check eligibility;
- build ready-to-sign mint transaction data containing target, calldata and native `value`.

Reference:

```text
https://docs.opensea.io/docs/mint-from-a-drop
https://docs.opensea.io/reference/get_drops
```

Current example stack uses Node.js 20+ and viem/ethers.

### RMT use

Package C only:

```text
OpenSea response
  ↓
normalize candidate
  ↓
local onchain verification
```

Package D may use provider-built transaction data as an **input**, but it must locally decode/rebuild/verify its semantics before a plan becomes admissible.

### Do not assume

- OpenSea listing = safe;
- provider price field = transaction value;
- provider collection identity = local runtime identity;
- a chain enum remains unchanged;
- provider transaction is signer-ready without local verification.

### Chain support nuance

The Drops API supports chain filtering, but the exact live Robinhood behavior must be capability-probed in Package C. If Robinhood is not directly filterable/usable, the engine degrades to other observation sources rather than scraping UI.

## 4. OpenSea SeaDrop — ADAPTER/REFERENCE CANDIDATE

Repository:

```text
https://github.com/ProjectOpenSea/seadrop
```

Current public repo is MIT-licensed and supports:

- public drops;
- Merkle allowlist stages;
- token-gated drops;
- server-side signed mints;
- separate payer/minter semantics when the NFT contract explicitly allows the payer.

Useful functions include:

```text
mintPublic
mintAllowList
mintSigned
```

SeaDrop's published deployment list does not currently establish a canonical Robinhood deployment in its README. Therefore:

> Do not hard-code the common Ethereum/Base SeaDrop address for Robinhood.

Package C/D must discover the actual Robinhood mint target and prove runtime/implementation identity for each admitted collection/family.

### Why useful

SeaDrop gives us a concrete, audited/open-source mint family with semantics we can positively decode rather than implementing generic arbitrary calldata.

### Why not fork/deploy it

The Community Engine is a **buyer/collector**, not a drop-creation platform. We only need an adapter for existing projects that use compatible semantics.

## 5. drand-client / Quicknet — ADAPTER CANDIDATE

Repository/docs:

```text
https://github.com/drand/drand-client
https://docs.drand.love/docs/specification/
```

The JavaScript client includes beacon verification and recommends keeping verification enabled with pinned chain verification parameters.

Current client supports:

- fetching by round/time;
- multiple HTTP relays;
- chain info verification;
- cryptographic beacon signature verification.

### RMT use

Package E:

```text
acquisition-block timestamp
+ fixed policy lead
→ deterministic future Quicknet round
→ fetch from one/multiple relays
→ cryptographically verify
→ VerifiedRandomnessRecordV1
```

The allocation domain must consume a verified record, not raw HTTP JSON.

### Important

The current Quicknet chain hash/public key/scheme/period/genesis values captured in `FAIRNESS_RANDOMNESS_V1.md` are planning evidence. Revalidate/pin them at Package E implementation time.

## 6. Robinhood Chain native infrastructure — REUSE NOW / AUTHORITY

Documentation:

```text
https://docs.robinhood.com/chain/
https://docs.robinhood.com/chain/connecting/
```

Current documented facts:

- mainnet chain ID `4663`;
- testnet chain ID `46630`;
- native gas token ETH;
- EVM compatibility;
- ERC-4337 account abstraction support;
- gas sponsorship, batching and session-key-capable infrastructure;
- archive RPC providers should be used for historical reads.

### RMT use

- exact chain identity everywhere;
- archive-capable reads for acquisition-block historical census;
- account-abstraction compatibility research in Package J.

## 7. Alchemy Robinhood infrastructure — ADAPTER CANDIDATE

Current supported-chain matrix lists both Robinhood Mainnet and Testnet with:

```text
Bundler              ✅
Gas Sponsorship      ✅
ERC-20 Gas Payments  ✅
```

References:

```text
https://www.alchemy.com/docs/wallets/supported-chains
https://www.alchemy.com/docs/wallets/low-level-infra/gas-manager/gas-sponsorship/using-sdk/pay-gas-with-any-erc20-token
```

### Important economic distinction

Alchemy's standard ERC-20 gas-payment product currently describes:

```text
native gas fronted by Alchemy
ERC-20 payment transferred to an application-controlled wallet
USD equivalent/admin fee billed to application
```

That is **not** RMT Pay V1's selected settlement because RMT Pay wants:

```text
RMT → 0x...dEaD
```

Therefore use Alchemy first as a candidate **sponsorship/AA rail**, not as authority over RMT burn settlement.

### Cost/operational note

Alchemy's current FAQ says mainnet gas sponsorship requires a paid tier and sponsorship fees/limits apply. RMT Pay Package J must measure real commercial/operational costs before any provider is selected.

### ERC-20 gas-token note

Alchemy currently says its ERC-20 Gas Manager supports tokens recognized by its Token Prices By Address API or enabled/requested through its admin/support path. This reinforces why RMT's direct burn + separate sponsorship design is more robust than assuming RMT is automatically admitted as a provider-native gas token.

## 8. Robinhood Blockscout — ADAPTER/ENRICHMENT CANDIDATE

Current Robinhood explorer:

```text
https://robinhoodchain.blockscout.com
```

It exposes verified source/ABI views and proxy/implementation identification for contracts.

### RMT use

Useful enrichment for:

- verified source presence;
- compiler/license metadata;
- proxy classification;
- ABI/source investigation;
- public proof links.

### Not authority for signing

Final execution evidence remains:

```text
RPC bytecode/runtime hash
proxy storage/implementation evidence
local calldata decode
simulation
receipt postconditions
```

Explorer verification is not a replacement for those checks.

## 9. Reservoir hosted NFT API — REJECT V1 HOSTED DEPENDENCY

Current hosted supported-chain list includes many EVM chains but does **not** list Robinhood Chain.

Reference:

```text
https://nft.reservoir.tools/reference/supported-chains
```

Therefore do not architect Community Engine V1 around Reservoir's hosted Robinhood endpoint.

If Reservoir adds Robinhood later, it can be reconsidered as another observation/transaction-building adapter, subject to the same local verification rules.

## 10. Mint.fun Base auto-mint bot — REFERENCE ONLY

Historical prior art:

```text
https://github.com/PrantaDas/Miintfun-NFT-Buy-Bot
```

MIT-licensed project demonstrating an older loop:

```text
poll free-mint feed
→ filter candidates
→ use Reservoir transaction endpoint
→ submit transactions
→ persist collection/transaction identity to avoid duplicate minting
```

Its README describes Base-specific Mint.fun/Reservoir usage and explicitly encountered nonce/gas-estimation issues during repeated mainnet transactions.

### What to reuse conceptually

- event/feed-driven discovery;
- deterministic dedupe;
- transaction lifecycle accounting;
- avoid browser/MetaMask UI automation.

### What not to reuse

- Python/Web3.py stack;
- private-key/mnemonic handling pattern;
- fixed-interval aggressive mint loop;
- Mint.fun dependency;
- Reservoir Base endpoint;
- absence of RMT's strict plan/runtime/fairness model.

Do not fork it into RMT.

## 11. thirdweb Engine Core — FUTURE REFERENCE / POSSIBLE PACKAGE H OPTION

Repository:

```text
https://github.com/thirdweb-dev/engine-core
```

Current project is MIT-licensed Rust transaction infrastructure with:

- Redis-backed queues;
- retries;
- graceful shutdown;
- chain RPC management;
- EOA execution workers;
- ERC-4337 support;
- monitoring/structured logging;
- lease/concurrency concepts.

### Why it matters

It is strong prior art for the exact hard operational problems Community Engine Package H will face:

- durable transaction jobs;
- single/leased execution ownership;
- uncertain transaction reconciliation;
- nonce handling;
- retries;
- horizontal worker design.

### Why not adopt now

RMT is currently TypeScript/pnpm-centric and Package H service/storage ownership is intentionally deferred.

Adopting Engine Core would add:

- Rust service;
- Redis;
- thirdweb credentials/integration;
- another operational stack.

Package H should compare this against a smaller RMT-native worker only after measured workload exists.

Do not install it during Packages A–G.

## 12. New generic indexer frameworks — REJECT FOR V1 EARLY PACKAGES

Do not introduce Ponder/Envio/Subgraph infrastructure merely to count CCFF00 holders or reconstruct ~hundreds/thousands of mint events.

Packages A/B can use:

- existing CCFF00 full-public snapshot reader;
- bounded chunked logs;
- archive-capable RPC;
- deterministic artifacts/checkpoints.

A persistent service is chosen only when Package H proves the operational requirement.

## 13. SIWE/EAS wallet linking — DEFERRED

One-human-across-wallets is deliberately unsolved in V1.

Do not add SIWE/EAS identity infrastructure to Packages A–H to guess/merge users.

If the owner later opens optional wallet linking:

- require explicit signatures from each wallet;
- preserve privacy/minimal data;
- make linking voluntary;
- define unlink/recovery semantics separately.

## 14. Generic browser automation — REJECT

Do not use Selenium/Playwright/DOM clicking/MetaMask extension automation for production minting.

Reasons:

- fragile changing frontend;
- unsafe wallet UI automation;
- difficult exact calldata evidence;
- weak replay/reconciliation semantics;
- provider pages are not execution authority.

Playwright remains appropriate for RMT UI acceptance tests, not for driving third-party mint websites with a signing wallet.

## 15. “Any calldata” execution frameworks — REJECT

Even if a provider/library can submit any arbitrary call, Community Engine must retain its own positive adapter allowlist.

Convenience infrastructure may transport an already verified transaction; it never decides what is safe to sign.

## 16. Final reuse plan by package

| Package | Reuse first | Do not add yet |
| --- | --- | --- |
| A Census | existing CCFF00 adapter + viem | indexer DB/provider NFT API |
| B Provenance | viem logs + archive RPC | universal indexer |
| C Observer | OpenSea API adapter + Blockscout enrichment | signer/Reservoir hosted RH dependency |
| D Mint plans | SeaDrop semantics + viem decode/simulate | arbitrary calldata executor |
| E Fairness | drand-client verification + pure TS allocator | blockhash/operator RNG |
| F TBA canary | existing CCFF00 proof patterns + Foundry/fork | new TBA contracts |
| G Collector | existing wallet/security principles | admin/treasury signer reuse |
| H Runtime | compare RMT-native worker vs Engine Core concepts | premature Rust/Redis commitment |
| I Gas vault | OpenZeppelin/Foundry + purpose-vault patterns | current revenue-policy mutation |
| J RMT Pay preflight | Robinhood AA + provider-neutral wallet tests + Alchemy as candidate | RMT redeploy/provider lock-in |
| K RMT Pay | current RMT + dead-address burn + proven sponsor rail | RMT→ETH sell loop |

## 17. Revalidation rule

Every Package C+ implementation PR should state which external assumptions were revalidated and on what date.

If upstream support changed, adapt the provider layer; do not weaken the underlying RMT safety/fairness rules to preserve an outdated integration.
