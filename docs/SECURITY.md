# Security

**BLOCKED_NO_BROADCAST.** The exact frozen 4663 closure retains **22 high findings** (18 active engine and four dependencies) and **seven governance-medium findings**. Its Slither gate is `FAIL_HIGH`. Task 049 requires a fresh analysis of its changed candidate. The restored chain-31337 source has a separate strict Slither job and reports 18 high findings. Passing builds and regression tests apply to their own scopes. [Release manifest](evidence/rmt-task041-closeout/release-manifest.json) · [Exact Slither report](evidence/rmt-task043/slither-4663-full.json.gz) · [Finding-by-finding triage](evidence/rmt-task047/security-triage.md)

## Required controls

- Bind chain, factory, authorized account, recipient, calldata, amount, nonce and expiry before requested wallet confirmation. Require tight approvals and slippage, simulation where supported and canonical receipt/trace verification.
- Conserve token supply, actual backing, inventory and fee entitlements. A failed funding or migration reverses the entire operation. Registered projects retain their economic commitments through an approved same-token successor. Original LP principal stays permanently locked.
- Require current independent governance signatures and published notice for migrations and required administrative actions. Signer rotation changes signer epoch and invalidates obsolete signatures. Preserve creator migration consent and disclose the consequence of losing quorum.
- Keep launch registrations, verified pool funding, hosted availability and Ethereum L1 finality separate. A timed-out or missing receipt stays pending. Immutable identities and scoped checkpoints support idempotent replay and rollback.
- Keep credentials private and use loopback environments for synthetic execution. Hosted launchpad production remains read-only.

## Retained review coverage

Internal dispositions cover the exact 18 engine rows, four dependency rows and seven governance-medium rows. The registry's in-flight-state observation remains open. The bit-shift and exponent dependency warnings and the directory equality observations have internal assessments in the triage. Independent disposition remains outstanding. The archived V1/V2 parser gaps, standalone replacement-token escrow and historical Windows V3 metadata failure retain their separate scopes. [Latest triage](evidence/rmt-task047/security-triage.md) · [Earlier funding and migration findings](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK039_FINDINGS.md) · [Legacy metadata evidence](evidence/rmt-task041/legacy-v3-bytecode.json)

Reproduce the exact gate using Slither 0.11.5, Crytic Compile 0.3.11 and the recorded compiler binary hash. The verifier binds the original archive to the exact input. The [previous governance review](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK041_GOVERNANCE_FINDINGS.md) includes the supplemental signed test snippets. [Static-analysis replay](evidence/rmt-task047/security-triage.md#reproduction-and-release-treatment) · [Deployment rehearsal](DEPLOYMENT.md)

User reports should use [GitHub private vulnerability reporting](https://github.com/LandoCrissian/robinhood-meme-terminal/security/advisories/new) when available. Include the exact version, affected path, expected and observed behavior, and a local reproduction. Leave wallet secrets and production credentials out of any report.
