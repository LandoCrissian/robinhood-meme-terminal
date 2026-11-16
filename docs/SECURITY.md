# Security

**BLOCKED_NO_BROADCAST.** The exact 4663 profile reports **22 high findings**, with all 22 finding IDs unchanged from #629. The 18 engine findings remain open for independent assessment. The four dependency findings have arithmetic evidence supporting an internal false-positive assessment. The seven governance-medium findings retain separate dispositions. [Finding-by-finding matrix](evidence/fixed-supply-security/findings.md) · [Candidate evidence manifest](evidence/fixed-supply-security/release-manifest.json) · [Exact Slither report](evidence/fixed-supply-security/slither-4663.json.gz) · [Independent-review packet](evidence/production-readiness/independent-review.md)

## Required controls

- Bind chain, factory, authorized account, recipient, calldata, amount, nonce and expiry before requested wallet confirmation. Require tight approvals and slippage, simulation where supported and canonical receipt/trace verification.
- Conserve token supply, actual backing, inventory and fee entitlements. A failed funding or migration reverses the entire operation. Registered projects retain their economic commitments through an approved same-token successor. Original LP principal stays permanently locked.
- Require current independent governance signatures and published notice for migrations and required administrative actions. Signer rotation changes signer epoch and invalidates obsolete signatures. Preserve creator migration consent and disclose the consequence of losing quorum.
- Keep launch registrations, verified pool funding, hosted availability and Ethereum L1 finality separate. A timed-out or missing receipt stays pending. Immutable identities and scoped checkpoints support idempotent replay and rollback.
- Keep credentials private and use loopback environments for synthetic execution. Hosted launchpad production remains read-only.

## Retained review coverage

The candidate also guards the factory's route during migration. The pre-fix tests observed the inactive predecessor through the factory getter during a synthetic callback. The new regression checks both lookup barriers, unrelated project reads, and atomic rollback when a mature signer rotation occurs during the funded successor callback. The retry preserves token identity, backing and fee credits. The registry post-return warning remains visible because canonical writes follow external settlement and verification. [Migration regression](../packages/contracts/test/RMTLaunchMigrationReadiness.t.sol) · [Shared v4 settlement checks](evidence/fixed-supply-security/v4-settlement-reachability.md)

Slither 0.11.5 with Crytic Compile 0.3.11 ran all 101 detectors on each exact 4663 input. The earlier closure produced 231 findings and this candidate produced 233. The changes are one Low and one Informational finding. Repository-wide analysis also retains its strict gate. Both runs are required evidence for this review scope. Historical analysis limitations and their evidence remain recorded. [Earlier fixed-supply review](evidence/fixed-supply/security-review.md) · [Frozen findings](evidence/rmt-task047/security-triage.md)

User reports should use [GitHub private vulnerability reporting](https://github.com/LandoCrissian/robinhood-meme-terminal/security/advisories/new) when available. Include the exact version, affected path, expected and observed behavior, and a local reproduction. Leave wallet secrets and production credentials out of any report.
