# Task087 read-only governance evidence

**BLOCKED_NO_BROADCAST.** This package observes existing production infrastructure and the scheduled factory action. It contains no deployment, signing service, production configuration change or token creation.

Base: exact PR #680 `1f7160f5db5d67de348e041a84ccc2889786217e`, after all 21 checks completed: 15 passed, six unchanged strict security failures. The original shallow-history and immutable-preservation-guard failures are retained separately. [Owner decision memo](../../RMT_GOVERNANCE_WINDOW_READINESS_2026-11-19.md).

| Evidence | Scope |
| --- | --- |
| [chain](chain/) |Original schedule, original quorum verification and four timestamped two-provider notice observations; exact ephemeral execution simulation/indicative cost. Compressed files preserve the originals. No raw governance signatures are exported. |
| [bindings](bindings/README.md) |Two-provider current/pending protocol, v4 and Safe bindings; original failed collector attempt preserved; source-publication GET403 remains unknown. |
| [operations](operations/README.md) |17 public GETs plus selected existing hosting metadata. Fresh worker advancement is separate from the production website's stale historical fallback and unverified authenticated data delivery. |
| [finality](finality/) |31-read discovery capture remains UNVERIFIED; separate eight-read exact-receipt corroboration establishes only historical schedule-batch posting under the documented trust boundary. |
| [ci](ci/README.md) |Final and prior exact-source GitHub check rosters, original bytes gzip-preserved, source/ID/time/count validation. |

## Executed focused checks

```sh
node --test --test-concurrency=1 'docs/evidence/rmt-task087/**/*.test.mjs'
node --test --test-concurrency=1 \
  scripts/production-readiness/check-governance-notice.test.mjs \
  packages/contracts/scripts/governance-transaction.test.mjs \
  packages/contracts/scripts/governance-publication.test.mjs
```

**32 new evidence/scope tests and 13 existing governance tests passed**, zero failures/skips in their final runs. They check actual retained observations, byte identity, source linkage, ABI/digest/nonce/epoch binding, window boundaries, blocked signing/broadcast methods and provider-failure behavior. Local data fixtures in unit tests are not live execution evidence.

Live producers are explicit opt-in CLI commands, separate from tests:

```sh
node scripts/production-readiness/check-governance-notice.mjs --output /fresh/notice.json
node docs/evidence/rmt-task087/chain/capture-cost.mjs --notice /fresh/notice.json --output /fresh/cost.json
```

Both use read-only RPC. Cost preparation performs ephemeral `eth_call` and gas-estimate simulations; no real transaction is signed or submitted. All wallet/production-activation authorization flags remain false. Quotes and state must be refreshed before any later separately approved transaction; this is not a signing packet.

The original cost collector's uint48 normalization failure and the bindings collector's unsupported V1 getter/number normalization failure remain preserved, with their corrected observational tests. The first existing-governance local run had four ENOENT failures from a skipped tracked Safe runtime fixture; restoring that exact Git blob produced 13/13 passes without changing tests. Materialized sparse-checkout inputs were hash-compared with HEAD; historical tracked contents remain unchanged. A separate local Windows Knip attempt could not allocate the OXC array buffer; no assertion or linter rule was bypassed. The final Linux base repository check passed, and this report PR has its own CI.

No new Foundry/fork/browser campaign was run: existing verified base lifecycle evidence is reused because Solidity, application code, deployment settings and economics are unchanged. The 22 core/dependency Highs, seven governance Mediums, 23 Seaport Highs and other scoped holds are not cleared by these checks.

Privacy scans use unchanged Gitleaks 8.30.1/configuration. Chain decompressed originals/current producer and bindings/finality originals scanned clean. Operations' original plaintext scan retained eight matches, each an exact public historical ERC20 address, all classified and zero unknowns; raw zero is not claimed. Original public responses are gzip-preserved; no detector, source/path exemption or gate change was introduced. Credentials, private backup/key material, wallet secrets and production user records were not read or exported.
