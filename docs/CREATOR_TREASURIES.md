# Creator treasuries

Each launch can direct its own project earnings to the creator and an independent treasury. The treasury may receive **0–100% of the project's 90% share**. On creation, review both public beneficiary addresses and the exact allocation. RMT does not take custody of project earnings.

| Revenue | Project | RMT Operations | RMT Reserve |
| --- | ---: | ---: | ---: |
| Creation fee | — | 100% | — |
| Curve trading fees | 90% | 5% | 5% |
| Fees earned by the original locked LP position | 90% | 5% | 5% |

The fee rates and launch threshold remain provisional. After graduation, the ledger records fees earned by the original position in ETH and the launched token. The mechanism collects that position's earnings and leaves principal locked. Fees earned by other liquidity providers remain outside this allocation.

Beneficiaries claim only their own credits. ETH and ERC-20 claims can be tested separately when a recipient rejects one asset. The pinned fork exercised an EOA, controlled recipient fixtures and authorized Safe claims and spending. The two proposed protocol Safes use the same three owners and separate 2-of-3 custody. Their roles, balances, nonces and credits remain distinct. The owners currently share a phone, so signer continuity and incident response require a defined operator. Populate live beneficiary fields only after the two Safe deployments and their claims are separately authorized and verified. [Treasury and wallet fork evidence](evidence/rmt-task046/4663-shared-owner-safe-rehearsal.json) · [Unassigned live bindings](evidence/rmt-task047/treasury-live-bindings.json)

## Optional project expenses

A project can use its settled treasury funds for an explicitly approved expense with a verified asset, payee, amount, purpose and independent authorization. Preparation evidence covers distinct synthetic RMT and LAMMB spending decisions. A future LAMMB NFT purchase is a project treasury expense. It is not a general RMT marketplace, payout diversion or automatic reciprocal transfer. Project tokens and royalties remain under their existing authorities.

Factory V2 supports independent beneficiaries for the first RMT project and unrelated projects. RMT's own creator allocation can be committed to a project treasury. Optional earnings automation requires separately reviewed beneficiary rules and acceptance. No live purchase, sale, fee change or royalty redirect is authorized.

[Royalty authority evidence](evidence/rmt-task047/lammb-royalty-authority.md) · [Synthetic expense receipts](evidence/rmt-task047/4663-treasury-support-rehearsal.json)
