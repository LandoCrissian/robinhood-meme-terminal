# Task086 completed CI observations

The two machine-readable reports retain actual GitHub check-run identities, source SHA, URLs and completion times. They are read-only observations, not a waiver or release approval.

- Initial implementation `f027a1829b3f44200224ee1ba838de5689957560`:21 completed checks,14 passed, seven failed. Six failures are strict security gates; the additional default-WebKit failure is retained separately with partial original evidence.
- Diagnostic code `1be772c8787b47fbc0c791a03a694cb2a5673d86`:21 completed checks,15 passed, six failed. All four Seaport browser modes and both core lifecycle browser modes passed. The earlier callback failure's exact cause remains unknown.

The six failed jobs are `slither`, `fixed-supply-4663`, `project-treasury-v1`, `reclaim-v1`, `reclaim-permanent-v2` and `seaport-vault-strict-security`. Their strict gates were not edited. The fresh Seaport report retains all101 detectors and23 High observations; other contract scopes and historical findings remain separate. Passing functional jobs is not contract security clearance.

The validation report also records the exact base-to-source contract delta: only the added test `Task086CollectionPolicy.t.sol`. There is no production contract, application, configuration, workflow, package or lockfile delta. Subsequent closeout commits contain evidence, offline replay and documentation only; their automatically scheduled checks are distinct from these completed validation results and must not be inferred to have passed.

The production collection catalog remains empty; current signed order is unavailable. Production stays **BLOCKED_NO_BROADCAST**.

## Final evidence-head CI prerequisite correction

On evidence head `fe4ee367f3af005eb5766a512b9571d913e0063d`, [repository job136060814265](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44667662558/job/136060814265) failed one of211 release-evidence tests. The newly retained1be archive requires six exact historical Git-blob comparisons. The shallow Linux checkout did not fetch that source commit; `git show 1be772c8787b47fbc0c791a03a694cb2a5673d86:scripts/seaport-acquisition/browser-safe-admin.mjs` failed before its hash comparison. Local full-history replay passed; this is not a contract or browser failure.

The existing explicit historical-source fetch step now also fetches that exact1be commit at depth1. Replay code, all six source/hash checks, timeouts, detectors and release gates remain unchanged. Fetch failure or a mismatched source still fails closed. This repairs a concrete CI prerequisite rather than replacing provenance checks with a fallback or waived result. The original failed job remains evidence; only the corrected head's actual results can establish completed final CI.
