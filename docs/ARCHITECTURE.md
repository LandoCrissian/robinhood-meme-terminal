# Architecture

## Launch lifecycle

1. **Create.** The creator reviews normalized metadata, project beneficiaries, supply, exact creation fee and deployment identity. Signing belongs to the wallet. A confirmed receipt binds the original creation and its project registry record to the same chain, factory and token.
2. **Trade on the curve.** ETH buys and sells preserve actual backing and token inventory separately from virtual reserves. Quotes show fee and amount limits. Pending transactions remain recoverable by their original account, nonce and transaction identity.
3. **Graduate.** At the committed backing threshold, the engine uses the existing token and funded assets to initialize and fund the intended Uniswap v4 pool. Record the complete PoolKey, PoolId, verified deposits, liquidity and locked custody. Failed funding rolls back. No partially funded pool becomes live.
4. **Trade on v4 and claim.** Verifiable swaps use the supported router, bounded approvals, per-hop limits, deadlines and receipt settlement. Collection is restricted to fees earned by the original locked LP position. Native and token credits remain separately auditable.

Factory V2 and Token V2 commit to **one billion tokens with 18 decimals** for all projects. The sole mint credits the factory, which transfers the entire balance to the new curve. The curve releases up to 600 million tokens through sales and reserves 400 million for the original locked LP position at graduation. Registry V3 admits the pinned token runtime and verifies its exact supply. The first isolated project is RMT. Its [review inputs](evidence/fixed-supply/first-project.json) leave live values unassigned.

## Runtime boundaries

| Component | Responsibility |
| --- | --- |
| `apps/launch-website` | The Netlify website and its mobile create, discovery and project views. Public deployment has read-only transaction configuration. |
| `apps/indexer` | The Railway worker and PostgreSQL persistence used for canonical read models. New-engine receipt verification and replay have isolated test support. Historical records have separate source and checkpoint bindings. |
| Factory, curve and registry | Deterministic creation, fixed economics per launch, token and curve identity, and authorized same-token migration for projects in the new engine. |
| Graduation, custody and ledgers | Atomic v4 funding, original principal custody and independently claimable fee credits. |
| Governance directory | Three eligible signer identities, two signatures, current signer epoch and published notice for authorized actions. Signer rotation invalidates superseded authority while preserving creator consent. Registry V3 blocks canonical project reads for the token during migration settlement and publishes the new route after post-settlement checks. |

The historical V4/V6 registrations are independent archival records. A new-engine project is identified only by its verified chain, deployment and ERC-20 address. For v4, PoolId is derived from both currencies, fee, tick spacing and hook, and is scoped by chain and PoolManager. A verified pool and hosted external routing remain separate observations.

App and worker remain independently restartable. One authorized writer stores receipts, transfers, event identities and canonical checkpoints. Replay is idempotent. A reorg removes orphaned observations before publication. Missing trace evidence leaves settlement pending. Recovery starts from the original transaction intent and never automatically requests another signature or broadcasts again.

Production launch and trading are disabled. See [Deployment](DEPLOYMENT.md) for supported environments and [Security](SECURITY.md) for the frozen review boundary.
