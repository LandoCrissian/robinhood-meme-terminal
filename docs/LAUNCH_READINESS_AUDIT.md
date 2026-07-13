# RMT Launch-Readiness Audit

Status date: 2026-07-13  
Scope: deployed Robinhood Chain mainnet beta and repository `main`

## Executive assessment

RMT has a real mainnet vertical slice: launch, discover, buy, sell, accrue fees, claim rewards, and manage factory versions through delayed governance. Production graduation passes a mainnet-fork test against the deployed stack, but no live public token has graduated. The release is suitable only for a controlled low-value beta until an independent review, live graduation evidence, production indexing, monitoring, source verification, and operational/legal contacts are complete.

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
- **Dependency source verification incomplete.** Factory and registry are verified; every production-owned dependency must also publish matching source and compiler settings.
- **Private security contact and legal review outstanding.** Public beta disclosures are present, but a dedicated private security/support address and licensed legal review are required before broad promotion.
- **Permanent domain outstanding.** The Vercel hostname is operational but is not the final production identity.

## P1 — required before unrestricted traffic

- **Persistent indexer.** Cached feed APIs reduce browser scanning, but token/trade history needs a reorg-safe, idempotent indexer with retry and checkpoint behavior.
- **Production monitoring.** Monitor RPC freshness, registry/factory changes, launch events, market reserve invariants, graduation attempts, migration failures, reward claims, purpose-vault releases, and frontend/API availability.
- **Incident operations.** Assign responders, private contact channels, severity rules, communications ownership, and signer availability. Follow [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
- **Reproducible frontend installs.** Commit a pnpm lockfile and switch CI to frozen installs.
- **Frontend quality gates.** Add linting, component tests, wallet-flow tests, accessibility checks, and a small browser regression suite.
- **Metadata redundancy.** Use multiple IPFS gateways and visible fallbacks.

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
