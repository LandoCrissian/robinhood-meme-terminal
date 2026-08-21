# CCFF00 Community Engine discovery sources V1

**Status:** PLANNING ONLY — OBSERVER SOURCE CANDIDATES AS OF 2026-08-21  
**Package:** C discovery / D adapter research

The Community Engine should not depend on one marketplace feed. Discovery is intentionally multi-source while execution remains locally verified and positive-adapter-bound.

## 1. Source roles

Separate four roles:

```text
DISCOVERY SOURCE
  says a drop/project may exist

PROJECT PROVENANCE SOURCE
  helps identify who controls/claims the project

MINT TRANSACTION BUILDER
  may suggest target/calldata/value

EXECUTION AUTHORITY
  RMT local verification only
```

No external website/API is V1 execution authority.

## 2. OpenSea Drops API

Role:

```text
DISCOVERY SOURCE
MINT TRANSACTION BUILDER candidate
MARKETPLACE/PROJECT corroboration
```

Planning-time capabilities:

- list/discover drops;
- stage price/timing/limits where available;
- eligibility checks;
- build target/calldata/value mint transaction data.

Implementation-time requirements:

- live probe exact Robinhood support;
- normalize chain/collection/target/stage;
- locally read/verify runtime/state;
- locally decode/rebuild semantics;
- exact native value zero;
- no provider transaction signing directly.

## 3. HoodMint NFT launchpad (`hoodmint.online`)

### Why it matters

As of planning research, HoodMint has a dedicated Robinhood NFT drop surface and an `Open drops` page displaying live/open collections and phase progression including multiple `Free` phases.

Its FAQ currently states:

- creators deploy creator-owned ERC-721 collections through HoodMint;
- free phases use price zero and HoodMint adds no protocol mint fee to free mints;
- mint limits are enforced in the collection contract per phase;
- multiple pre/public phases are supported;
- allowlist phases use signed authorizations;
- allowlist authorization checks wallet, phase, price, deadline and version;
- price, phase timing, wallet limits, supply caps, total supply and allowlist authorization are enforced onchain rather than only by the web UI;
- metadata base URI can remain mutable until frozen.

References to revalidate:

```text
https://hoodmint.online/
https://hoodmint.online/drops/open
https://hoodmint.online/faq
```

### Package C role

HoodMint is a **Robinhood-native discovery source candidate**.

Preferred integration order:

1. determine whether a stable public data/API endpoint exists;
2. if yes, build a bounded read-only adapter;
3. if no stable API exists, use the public drop page only as a discovery clue/reference and derive collection/mint state from chain/explorer evidence;
4. do not automate browser/MetaMask clicks.

### Package D role

HoodMint may also represent a reusable **mint contract family** if current deployed collections share independently verifiable bytecode/interface semantics.

Package D should investigate:

```text
factory address/runtime
collection implementation/runtime families
proxy/clone model if any
mint function selector(s)
phase state getters
phase price getter/storage
wallet-limit getter/accounting
supply-cap getter
allowlist signature format
authorization signer validation
version/replay semantics
fee path for free mint
receipt events
transferability controls
metadata freeze/admin controls
```

Do not infer ABI solely from FAQ prose. Resolve exact deployed/verified contracts.

### Useful property for V1

HoodMint's documented rule that a free phase has **zero project mint price and no HoodMint primary-mint protocol fee** is directionally aligned with Collector V1. Still require exact transaction `value == 0` on every admitted plan.

### Signed allowlist caution

A HoodMint allowlist signature may bind the individual wallet/minter. A CCFF00-holder whitelist therefore does **not** automatically make the centralized collector eligible.

Package D must prove exact signed-message fields and whether any legitimate collector/delegated payer model exists. Never impersonate/reuse a holder's authorization.

## 4. HoodStreet/CCFF00 official sources

Role:

```text
PROJECT/COMMUNITY PROVENANCE
WATCH evidence
```

Current official HoodStreet/CCFF00 sources explicitly describe:

- CCFF00 as the founding membership collection;
- each Square as an ERC-6551 wallet capable of holding NFTs/tokens/ETH;
- control of TBA contents following Square ownership;
- community/holder benefit/early-access direction.

These sources are useful to verify a claim such as:

```text
"CCFF00 holders were granted a project allocation"
```

when the statement originates from an attributable official channel.

They do **not** replace exact mint-contract allowlist/eligibility verification.

## 5. Robinhood Blockscout / explorer

Role:

```text
ONCHAIN ENRICHMENT
SOURCE/ABI/PROXY evidence
PUBLIC proof links
```

Planning validation confirms current Robinhood Blockscout presents ERC-721 zero-address transfers as minting events, consistent with Package B's provenance model.

Package C/D can use Blockscout to help resolve:

- collection contract;
- verified source/ABI;
- proxy/implementation;
- transaction/log history;
- token transfers.

Execution authority remains direct RPC/runtime/simulation/receipt evidence.

## 6. Robinhood native RPC

Role:

```text
AUTHORITATIVE CHAIN READS
```

Current official documentation publishes:

```text
mainnet chainId: 4663
mainnet RPC: https://rpc.mainnet.chain.robinhood.com
```

and recommends testnet-first for contract deployment/testing.

Package A/B/E historical reads need archive-capable RPC behavior; if the default public RPC does not satisfy historical access/reliability at implementation time, use an admitted archive provider without changing evidence semantics.

## 7. HOODIES Marketplace / `robinhoodnfts.com`

Planning research found a Robinhood-native marketplace surface with examples of free airdrops to token-holder snapshots and a collection submission/verification surface.

Potential role:

```text
ECOSYSTEM DISCOVERY/PROVENANCE CLUE
```

It is **not** a preferred V1 transaction source without stronger technical/API/runtime evidence.

Do not rely on website branding/verification badge alone. If Package C finds a stable public feed/API with useful Robinhood collection data, it can be considered under the same adapter/evidence rules.

## 8. Direct project WATCH input

Role:

```text
HUMAN-SUPPLIED DISCOVERY/PROVENANCE
```

Input may come from a community announcement before aggregators index it.

A strong WATCH record can include:

```text
official project source URL
exact contract address
expected stage time
expected free price
expected CCFF00 allocation
collector-specific proof/reference if legitimately supplied
```

RMT independently validates everything executable.

WATCH priority is especially useful for short allowlist windows.

## 9. Onchain factory/event discovery later

A future source adapter may watch known/admitted NFT factories for new collections/drop configuration events.

This can reduce reliance on marketplace APIs, but only after a specific factory family is proven.

Do not scan every contract on chain and attempt generic mint inference.

For a HoodMint-like factory, an admitted adapter could watch:

```text
collection-created events
phase-configuration events
publish/freeze events
```

only if exact source/runtime/event semantics are verified.

## 10. Source-confidence combination

Candidate discovery benefits from multiple independent sources.

Example:

```text
HoodMint open-drop feed
+ verified deployed collection
+ official project contract reference
+ onchain phase price zero
```

is stronger than:

```text
one anonymous social post saying "free mint"
```

But no amount of discovery confidence bypasses Package D hard safety.

## 11. Duplicate-source normalization

The same collection/stage may appear in:

```text
OpenSea
HoodMint
WATCH
project website
Blockscout
```

Normalize into one candidate/stage identity with multiple evidence sources rather than creating competing mint jobs.

Provider/source disagreement is evidence to resolve, not a reason to choose the most favorable price/limit.

## 12. Stage-source precedence

For execution-sensitive fields such as:

```text
mint price
start/end
wallet max
remaining supply
allowlist root/signer
```

onchain contract state under the admitted adapter is authoritative.

Provider fields are discovery/presentation evidence only.

## 13. Discovery polling/event cadence

Package C should choose conservative provider polling based on:

- API limits;
- drop timing resolution;
- WATCH priority;
- avoiding unnecessary cost.

A later runtime can increase checking around a known stage-opening window, but maximum cadence must remain within supported scheduler/provider limits and need not be subsecond.

No package should promise guaranteed capture of every limited free mint.

## 14. New source admission checklist

Before adding another discovery source:

- [ ] materially improves coverage/latency/provenance;
- [ ] bounded API/page access possible;
- [ ] clear source identity;
- [ ] no wallet automation required;
- [ ] output normalizes into existing candidate schema;
- [ ] provider secrets server-only;
- [ ] provider failure degrades safely;
- [ ] source cannot bypass quality/safety;
- [ ] duplication with existing sources is resolved deterministically.

## 15. Package C implementation priority

Recommended current research order when Package C opens:

1. OpenSea Drops live Robinhood capability probe;
2. HoodMint drop/data/factory discovery probe;
3. WATCH PROJECT input;
4. Blockscout/onchain enrichment;
5. only then assess whether another source materially improves coverage.

This keeps V1 focused while adding a Robinhood-native source that demonstrably advertises free NFT phases today.
