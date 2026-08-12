# RMT terminal completion gate

**Status: CURRENT — release gate**
**Rule:** Profiles/community/creator product work cannot re-enter the roadmap until this gate is explicitly reviewed and marked complete.

“100% complete” means every applicable item below has evidence. A polished screen or a merged cutover PR is not sufficient.

## Product ownership

- [ ] VNext is served from production `/` and no competing terminal architecture remains active.
- [ ] Legacy routes are compatibility-only, redirected or retired after their VNext replacement is proven.
- [ ] One VNext component/design-system ownership model serves mobile and desktop.

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

- [ ] No hidden RMT fee or accidental 25-bps default exists.
- [ ] Any future policy model remains versioned, disclosed and disabled until explicitly approved.
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
- [ ] Legacy global CSS/runtime layers are isolated or retired as their routes migrate.
- [ ] Final cutover evidence is reviewed and the owner explicitly marks this document complete.

## Current known gaps

VNext remains at `/vnext`; its asset workspace and authoritative wallet holdings no longer depend on `/market/[address]` or `/portfolio`, while both routes remain preserved for production compatibility; external-wallet reliability still requires supported-device acceptance; legacy CSS is globally loaded. up-v2/up-cl read-only discovery and live-fee/gauge enrichment still require shadow backfill evidence before this gate can pass. Their disabled-by-default VNext quote adapters now compare direct and WETH-hop outcomes with block-pinned live fee evidence, but strict verification and wallet authorization are not implemented. StonkBrokers has a fail-closed source candidate, but production launcher contract/event evidence, backfill and authoritative claims remain unavailable, so its gate is not complete. Across production proof is incomplete; profiles/community/creator source remains preserved; production cutover has not occurred.

## Explicit completion decision

Status: **INCOMPLETE**
Owner approval: **not granted**
Profile reintroduction: **not authorized**
