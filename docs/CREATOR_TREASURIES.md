# Creator treasuries

The [Task 081 isolated NFT acquisition candidate](PROJECT_TREASURY_NFT_PURCHASE_ACCEPTANCE.md) adds a separately funded project sidecar, verified collection input, bounded purchase policy and synthetic signed-listing venue on chain 31337. Creators independently choose a verified collection, review exact chain/contracts and order terms, set purchase/aggregate budgets and per-NFT caps, and retain an OFF-by-default, immediately stoppable control. Existing treasury V1 and the nonspending V2 prototype remain unchanged and do not gain purchase capability. Connected browser acceptance and the production marketplace adapter are separate gates; no real purchase is enabled.

The [Task 082 read-only Seaport verifier](PROJECT_TREASURY_SEAPORT_SECURITY_ACCEPTANCE.md) separates order cryptography, listing availability, payment, policy and custody evidence. It never authorizes execution. The current vault cannot account for Seaport deliveries; historical restricted bids and declared listing metadata do not establish current sell listings. Enabling a synthetic purchase policy grants standing, bounded authority to any caller; disabling it takes effect when mined. The creator reviews exact currency, per-NFT, lifetime, 24-hour and cooldown limits before confirmation. No background keeper or production route is activated.

The [Task 083 Seaport V2 candidate](PROJECT_TREASURY_SEAPORT_VAULT_ACCEPTANCE.md) adds separate custody and exact consideration accounting for a deliberately narrow Seaport order subset. Its chain31337-only funds/inventory never replace V1 beneficiary credits. Creator policies start OFF and bound each NFT price, lifetime spend, fixed UTC-day spend and cooldown; an explicitly enabled policy permits any eligible trigger. Gas belongs to the caller, consideration to the funded vault. Noticed withdrawals and controller rotation preserve exact custody and delay. The local EOA review and genuine Safe contract tests are separate acceptance scopes; no real current listing or production purchasing is enabled.

NFT acquisition is separate from buying a project's own fungible token. The latter's independent-price requirement remains a buyback release gate; it is not a claim that a verified NFT listing is a fungible-token quote. Future NFT execution needs its own approved marketplace/payment route, exact order/fees/royalties and receipt/custody verification. An OpenSea URL must never become an executable target. Reclaim remains a frozen, separately manually funded trial. No real purchase, royalty change or automatic reciprocal transfer is authorized by this direction.

Each launch can direct its own project earnings to the creator and an independent treasury. The treasury may receive **0–100% of the project's 90% share**. On creation, review both public beneficiary addresses and the exact allocation. RMT does not take custody of project earnings.

The development [creator earnings dashboard](CREATOR_EARNINGS.md) separates recipient-aware discovery, verified balances, original-ledger migration continuity and synthetic claim recovery. Production claims remain disabled.

The isolated [per-project treasury candidate](PROJECT_TREASURY_ACCEPTANCE.md) offers a unique deterministic contract address as an optional beneficiary. It preserves the existing core factory and uses two separate creator-confirmed transactions. A previewed address is never treated as deployed. Its controller can claim as the beneficiary contract, receive supported funding, notice withdrawals and rotate control. Purchase settings record intent only: the V1 contract has no executable purchase route. See its [separate security scope](PROJECT_TREASURY_SECURITY.md), including six new unresolved high findings in addition to the existing core findings.

[Task 077's separate V2 prototype](TREASURY_PURCHASE_V2_ACCEPTANCE.md) verifies source-bound quotes and rejects unsupported references without custody or spending authority. It is local-only and **NOT EXECUTABLE**. Its zero-high static result does not clear V1's six highs or enable purchases.

| Revenue | Project | RMT Operations | RMT Reserve |
| --- | ---: | ---: | ---: |
| Creation fee | — | 100% | — |
| Curve trading fees | 90% | 5% | 5% |
| Fees earned by the original locked LP position | 90% | 5% | 5% |

The owner approved the candidate rates and launch threshold for unsigned preparation. Production activation remains gated. After graduation, the ledger records fees earned by the original position in ETH and the launched token. The mechanism collects that position's earnings and leaves principal locked. Fees earned by other liquidity providers remain outside this allocation. [Approved configuration](evidence/mobile-signing/UNSIGNED_HANDOFF.md)

Beneficiaries claim only their own credits. ETH and ERC-20 claims can be tested separately when a recipient rejects one asset. The pinned fork exercised an EOA, controlled recipient fixtures and authorized Safe claims and spending. The two proposed protocol Safes use the same three owners and separate 2-of-3 custody. Their roles, balances, nonces and credits remain distinct. The owners currently share a phone, so signer continuity and incident response require a defined operator. Populate live beneficiary fields only after the two Safe deployments and their claims are separately authorized and verified. [Treasury and wallet fork evidence](evidence/rmt-task046/4663-shared-owner-safe-rehearsal.json) · [Unassigned live bindings](evidence/rmt-task047/treasury-live-bindings.json)

## Optional project expenses

A project can use its settled treasury funds for an explicitly approved expense with a verified asset, payee, amount, purpose and independent authorization. Preparation evidence covers distinct synthetic RMT and LAMMB spending decisions. A future LAMMB NFT purchase is a project treasury expense. It is not a general RMT marketplace, payout diversion or automatic reciprocal transfer. Project tokens and royalties remain under their existing authorities.

Factory V2 supports independent beneficiaries for the first RMT project and unrelated projects. RMT's own creator allocation can be committed to a project treasury. Optional earnings automation requires separately reviewed beneficiary rules and acceptance. No live purchase, sale, fee change or royalty redirect is authorized.

[Royalty authority evidence](evidence/rmt-task047/lammb-royalty-authority.md) · [Synthetic expense receipts](evidence/rmt-task047/4663-treasury-support-rehearsal.json)
