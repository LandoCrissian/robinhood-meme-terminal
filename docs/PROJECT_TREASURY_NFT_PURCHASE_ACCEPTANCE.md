# Project Treasury NFT acquisition — isolated candidate

**Task 081 · BLOCKED_NO_BROADCAST. No production acquisition route or purchase authorization.**

Base: Task 080 PR #674, `c7e75623ff1163d8c36fd110fc7cf5188b814db1`. The [owner task](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/674#issuecomment-7009518192) authorizes implementation and synthetic testing only. Reclaim stays the frozen permanent-surrender trial. NFT acquisition and own-project-token buybacks have independent controls; buybacks retain their independent-price NO-GO gate.

## Marketplace verdict

OpenSea advertises Robinhood Chain support. Read-only official and Pocket RPC observations corroborate Seaport 1.6, its chain-bound domain and an open conduit at block **118245029**. This is not an unsupported-chain claim. [Exact provider, block, runtime and official-source evidence](evidence/rmt-task081/marketplace/).

The keyless current-listing API returned **401**, and explorer source APIs returned **403**. No current seller signature, executable listing or independently rebuilt marketplace source correspondence was obtained. A historical fulfilled-order receipt is historical execution evidence, not a still-open order. This new vault has **no Seaport adapter**. Its local signed-listing venue is explicitly synthetic and cannot deploy or execute on 4663. Public financial endpoints remain 404.

## Funding, identity and custody

Treasury V1 is unchanged. It has no NFT receiver or arbitrary-call capability; a UI toggle cannot add either. The new acquisition vault is an independently versioned, segregated sidecar for a verified project creator. It does not claim, reassign or automatically receive an original ledger beneficiary's credits. A creator must first settle assets under the existing beneficiary policy, then deliberately fund this vault through a separately reviewed transaction. Funds, spend counters and NFT custody are scoped to the exact chain, factory, vault and project. No Operations, Reserve, royalty or locked LP principal is diverted.

The dashboard accepts a supported canonical OpenSea **collection** URL or an NFT **contract address**. Wallet/profile/item URLs, spoofed hosts, ambiguous slugs, cross-chain hints, absent source evidence, incompatible standards, unsupported currency and stale/reorganized evidence fail closed. Resolution never fetches an arbitrary user URL. Collection identity, current listing validity, route support and execution availability are distinct. Metadata is untrusted plain text; no artwork or trait URL is fetched.

The vault starts OFF. Creator-confirmed collection/token-ID admission, all-in per-NFT ceiling, lifetime and fixed 24-hour per-vault budgets, currency and cooldown bind each exact order. Changing policy does not reset spend history. The fixed synthetic venue verifies seller signature, chain/domain, vault, asset, ID/quantity, time, nonce, cancellation/fill state and every fee/royalty recipient. ERC-721 and ERC-1155 transfers and payments must settle atomically. Approvals are bounded and cleared. There is no arbitrary executor, delegatecall, swap, bridge or fungible-token buyback.

Purchased NFTs remain in the vault. It implements actual safe-receiver interfaces and admits only the expected purchase callback. Later NFT or settled-asset transfer requires its separate typed two-day notice, bounded expiry, exact recipient/quantity and current controller epoch. Mature execution cannot redirect the notice. No hidden rescue or administrator sweep exists. Forced, unaccounted gifts can remain stuck; they do not create spend or withdrawal entitlements. Controller handoff has its own notice and invalidates stale authority. Native funding through a value-bearing Safe client profile remains unavailable; zero-value two-owner Safe administration/purchases and separately funded reserves are distinct capabilities.

## Evidence and checks

The separate module uses pinned solc 0.8.26, Cancun, optimizer 200 and viaIR. All production roots and reachable imports are included in its strict 101-detector analysis; test assets have a separate input and are never live collection admissions. Initial candidate input: `de1c5645525e7bc7b1a692974f158fec4e3f62f39a690db37d3377990c66838c`.

Initial analysis reports **48 observations / 23 High / 1 Medium / 15 Low / 9 Informational**, strict failure. Twenty-one highs concern exact balance baselines; two concern the constrained payment capabilities. They are not cleared by finite tests. Existing 22 core/dependency, six Treasury V1, seven active Reclaim V2 and four rejected historical Reclaim V1 highs remain separately recorded. No detector, assertion, severity or release gate was suppressed.

Actual Linux execution at `d01937b1d10310f1faa6e6520691632d3c366af3` passed all **30 Foundry tests**, two 512-run fuzz cases and 128 invariant runs / 4,096 calls without reverts. It also passed 20 resolver/trace/probe cases, indexer typecheck and five expanded provider-proof cases. [Exact source/compiler/report/test evidence](evidence/rmt-task081/security/linux-execution.json) remains separate from the original local syntax-only record. Full connected browser/PostgreSQL receipts and final-head CI are still **pending**; none is inferred from unit success. A successful compiler run or internal review is not an independent audit.

The first browser runs failed before the outsider authorization case because the valid loopback POST was classified invalid. The correction mirrors the existing handlers’ internal Next.js URL normalization while preserving exact external Host, Origin and port. The next run must corroborate that attribution and exercise the actual authorization case. Public mobile acceptance also caught 13px controls; the new route now reuses the existing treasury dashboard mobile styles, with its 16px / 44px assertions unchanged. The initial Knip failure concerned three consumed companion type declarations; they are registered using the existing exact-entry convention. The new PostgreSQL smoke initially expected a different error message for its correctly rejected wrong-chain input; its assertion now checks the exact actual rejection and retains every negative case.

The unchanged full-history secret scan reports one exact public OpenSea conduit identifier in an earlier review-branch commit. [Original report, source and independent SDK/chain binding](evidence/rmt-task081/marketplace/git-history-disposition.json) establish the public value; no credential was found. The history gate remains **failed**, with no ignore, detector change or history rewrite. A clean current-tree scan does not clear a history scan.

Task 080's archived browser evidence now verifies its original Git source bytes instead of requiring future website features to remain identical forever. Its raw hashes and outcomes are unchanged. Current Task 081 source is independently compiled, exercised and analyzed; an old pass does not clear changed code. CI fetches the exact historical source before that archival comparison.

Reproduce the connected local acceptance with existing approved tools:

```sh
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
node scripts/visual-qa/rmt-creator-integration.mjs --nft-acquisition-only \
  --anvil /path/to/anvil-1.7.1 --solc /path/to/pinned-solc-0.8.26 \
  --pg-bin /path/to/postgresql-18.6/bin --browser chromium --output /tmp/rmt-nft-acquisition
```

Repeat with WebKit and a new output path. The host starts one loopback chain and the existing authoritative indexer with an isolated named PostgreSQL database. It never targets the original Railway volume. Canonical checkpoint foreign keys enforce rollback; identical replay is idempotent and conflicting payloads fail. Native settlement requires the exact transaction trace, not block-end balance inference. Missing or contradictory evidence remains pending/unavailable. Recovery preserves the original account, nonce and hash without an automatic signature or resubmission. Physical iPhone acceptance is not implied by browser emulation.

## Separate release decisions

1. **Isolated engineering acceptance:** actual contract, database, browser and public-negative results; exact candidate source/compiler/runtime bindings; unresolved findings and honest limitations.
2. **Production adapter:** independently verify marketplace source/runtime, actual supported order/fee/conduit behavior, current listing provenance and all payment/custody proofs. A public collection page or historical purchase is insufficient.
3. **Vault deployment and funding:** separately reviewed production-chain build, exact project/controller/custody policy, explicit settled funding source and owner approval. This chain-31337-only candidate is not deployment bytecode for 4663.
4. **Public financial activation:** supported physical wallets, durable indexing/backups/provider/finality policies, material security disposition and separate authorization. Keep purchasing OFF and trading/claims holds unchanged until accepted.

No hosting change, paid service, production write, owner signature, mainnet transaction, actual RMT issuance, NFT purchase, royalty redirect or governance action is authorized or performed by this task.
