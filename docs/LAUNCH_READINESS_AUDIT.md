# RMT Launch-Readiness Audit

Status date: 2026-07-13  
Scope: deployed Robinhood Chain mainnet beta and repository `main`

## Executive assessment

RMT has a real mainnet vertical slice: launch, discover, buy, sell, accrue fees, claim rewards, and manage factory versions through delayed governance. Production graduation passes a mainnet-fork test against the deployed stack, but no live public token has graduated. The release is suitable only for a controlled low-value beta until an independent review, live graduation evidence, production indexer deployment, independent monitoring/RPC redundancy, and operational/legal contacts are complete.

## Proven mainnet behavior

- 14-address stack deployed and application-verified
- active factory resolved through the version registry
- 2-of-3 governance and delayed controlled actions
- disposable mainnet token launch
- low-value buy and sell
- fee accrual and creator claim
- exact deployed factory exercised through graduation and Uniswap V4 migration on a mainnet fork
- production web build and full Foundry suite green on every merged change

## P0 — blocks broad public promotion

- **Independent review outstanding.** Factory, clone initialization, curve accounting, rewards, governance, vaults, hook, router, adapter, graduation, MEV assumptions, and economic parameters require an external reviewer. Automated tests are not independence.
- **Live graduation outstanding.** The exact deployed contracts pass fork validation, but a real public token has not yet reached the immutable 1 ETH target and migrated on live mainnet.
- **Private security contact and legal review outstanding.** Public beta disclosures are present, but a dedicated private security/support address and licensed legal review are required before broad promotion.

## P1 — required before unrestricted traffic

- **Persistent indexer deployment.** The reorg-safe, idempotent PostgreSQL indexer is implemented and CI-tested. It still needs managed PostgreSQL, continuous-worker hosting, a complete historical reconciliation, and production cutover.
- **Production monitoring hardening.** Five-minute application/protocol checks are live on the canonical domain. Add an independent uptime provider, primary production RPC, backup RPC, and alerts for indexer lag, reorgs, graduation attempts, migration failures, and invariant drift.
- **Incident operations.** Assign responders, private contact channels, severity rules, communications ownership, and signer availability. Follow [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
- **Frontend quality gates.** Add linting, component tests, wallet-flow tests, accessibility checks, and a small browser regression suite.
- **Metadata redundancy.** Use multiple IPFS gateways and visible fallbacks.

## Completed broad-launch foundations

- Canonical domain: https://www.rmtlaunch.fun with permanent apex redirect
- All 14 RMT-owned production contracts publish exact-match source records
- Provider-ready external audit scope and deployed-bytecode handoff
- Public terms, privacy, risk, support, system-status, and incident-response pages
- Five-minute protocol and application monitoring
- Persistent confirmation-aware, reorg-safe indexer implementation with PostgreSQL schema smoke tests
- Reproducible pnpm dependency graph with frozen web and indexer CI installs

## Narrow beta boundary

A controlled mainnet beta may support:

1. Wallet connection.
2. Standard fixed-supply launch.
3. Optional artwork and social links.
4. Curve buy and sell.
5. Market, reserve, and recent-trade visibility.
6. Permanent token pages and sharing.
7. Transparent reward accounting and claims.

The interface must say mainnet beta, not audited, and never guarantee safety, liquidity, graduation, price, or rewards.

## Definition of broad-launch ready

- independent review has no unresolved critical/high findings
- a bounded real mainnet graduation and DEX migration is documented
- all RMT-owned production dependencies are source-verified
- the indexer survives reorgs, retries, restarts, and RPC outages
- monitoring and incident alerting are operational
- governance signers have tested propose/confirm/execute and incident availability
- public terms, privacy, risks, support, security contact, and domain are final
- every public product claim can be proven from deployed configuration
