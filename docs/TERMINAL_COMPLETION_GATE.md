# RMT terminal completion gate

**Status: CURRENT — release gate**
**Rule:** Profiles/community/creator product work cannot re-enter the roadmap until this gate is explicitly reviewed and marked complete.

“100% complete” means every applicable item below has evidence. A polished screen or a merged cutover PR is not sufficient.

## Product ownership

- [x] VNext is served from production `/` and no competing terminal architecture remains active.
- [x] Legacy routes are compatibility-only, redirected or retired after their VNext replacement is proven.
- [x] One VNext state/execution and design-system ownership model serves dedicated mobile and desktop presentations.

## Discovery and workspace

- [ ] Live market discovery, exact token/pool lookup, search, ranking/filtering and truthful stale/source-delay states are complete.
- [ ] Origin, venue, age, liquidity, activity/volume and valuation are available.
- [x] Selected assets remain inside VNext for identity, chart, activity, holders, liquidity, risk, origin, verified markets, RWA relationships, wallet position and trading.
- [x] No permanent `/market/[address]` dependency remains.

## Wallet and balances

- [ ] External wallet-first connection is reliable on supported mobile and desktop paths.
- [x] Holdings and authoritative Spend Balance are available inside VNext.
- [x] Gas reserve is separate from Spend Balance and pending funds are never spendable.
- [x] No permanent `/portfolio` dependency remains.

## Execution and funding

- [ ] One VNext orchestrator owns intent, quote observation, normalized economics, selection, strict verification, authorization, wallet submission, reconciliation, failure classification and recovery.
- [ ] Production-supported Sushi and Uniswap paths are regression clean.
- [ ] up-v2 and up-cl reach their separately approved discovery/quote/verification levels with live fee evidence; Slipstream is never treated as Uniswap V3.
- [ ] UniswapX, 0x and other providers stop at the highest independently safe capability level.
- [ ] If Across remains baseline, quote verification, source submission, destination confirmation, refund/recovery, cross-device restoration and confirmed-only Spend Balance all pass.

## Origin, attribution and markets

- [ ] StonkBrokers source identity is verified; `source-listed` remains distinct from launcher-created.
- [ ] Stonk projects show every verified market and are never forced through up.
- [ ] up-v2 and up-cl discovery, live fees and gauge enrichment are independently anchored; nongauged pools remain visible.
- [ ] Project origin, market venue and RMT execution origin remain separate records.
- [ ] Ecosystem volume, RMT-originated volume and actual RMT fee evidence are independent metrics.

## RWA and policy

- [ ] Canonical stock-token registry and provenance are current.
- [ ] Canonical RWA identity and RWA-paired markets are visibly distinct.
- [ ] A useful RWA market surface exists and policy/jurisdiction restrictions remain independent from route availability.

## Economics

- [x] No hidden RMT fee or implicit fee-free wallet fallback exists; V2 is exactly 25 bps on gross input for every wallet-executable RMT trade and providers without registered atomic V2 settlement remain quote-only.
- [x] `RMT_EXECUTION_V1` is publicly active for the deployed, runtime-verified Uniswap V3 executor after approved disclosure, reconciliation, treasury, controlled-proof and release gates. No other provider inherits that activation.
- [ ] Every wallet-executable provider has a separately reviewed, deployed, runtime-verified and registered `RMT_EXECUTION_V2` atomic settlement mode; foundation types alone do not satisfy this gate.
- [ ] No historical V6 split is reused as forward terminal policy.

## Quality, reliability and security

- [ ] Mobile and desktop share a coherent hierarchy with no major overflow, loading loop, refresh flicker or unstable trade action.
- [ ] Keyboard/focus, touch targets, reduced motion and readable evidence pass acceptance.
- [ ] Requests are bounded; stale/expiry states, receipts, fallbacks, duplicate prevention and uncertain-transaction recovery are truthful.
- [ ] Recipients, approvals, provider targets, calldata/order economics and required simulations are exact and fail closed.
- [ ] Deployment/runtime provenance, adversarial tests, secrets and diagnostic redaction pass.

## Operations and documentation

- [ ] Required CI, health checks and monitoring reflect the canonical terminal.
- [ ] No paused-product worker remains actively scheduled.
- [ ] README, `AGENTS.md`, architecture docs, status docs, env examples and implementation agree.
- [x] Legacy terminal CSS/runtime layers are retired; shared public-route styles remain outside the scoped VNext design system.
- [ ] Final cutover evidence is reviewed and the owner explicitly marks this document complete.

## Current known gaps

VNext is the production root and `/vnext`, `/market/[address]` and `/portfolio` converge on that canonical terminal. Retired terminal CSS generations are no longer globally loaded. External-wallet reliability still requires supported-device acceptance. The selected-asset workspace independently verifies exact displayed and USDG/WETH up. pools, live fees and gauge state directly onchain, while broader up-v2/up-cl discovery still requires shadow backfill evidence. Shadow market-indexer rows do not influence the public terminal. up. authorization remains default-off pending controlled proof. StonkBrokers remains a fail-closed candidate without production launcher evidence or authoritative claims. Across public funding remains incomplete and disabled. Profiles/community/creator source remains preserved and paused. The exact-wallet Uniswap V3 fee proof is complete and reconciled; public Uniswap V3 fee routing was explicitly released at Robinhood block `37805030`. Free read-only settlement monitoring is available, while an operational alerting decision remains separate from terminal completion.

## Explicit completion decision

Status: **INCOMPLETE**
Owner approval: **not granted**
Profile reintroduction: **not authorized**
