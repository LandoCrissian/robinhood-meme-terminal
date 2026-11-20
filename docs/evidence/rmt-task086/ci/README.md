# Task086 completed CI observations

The two machine-readable reports retain actual GitHub check-run identities, source SHA, URLs and completion times. They are read-only observations, not a waiver or release approval.

- Initial implementation `f027a1829b3f44200224ee1ba838de5689957560`:21 completed checks,14 passed, seven failed. Six failures are strict security gates; the additional default-WebKit failure is retained separately with partial original evidence.
- Diagnostic code `1be772c8787b47fbc0c791a03a694cb2a5673d86`:21 completed checks,15 passed, six failed. All four Seaport browser modes and both core lifecycle browser modes passed. The earlier callback failure's exact cause remains unknown.

The six failed jobs are `slither`, `fixed-supply-4663`, `project-treasury-v1`, `reclaim-v1`, `reclaim-permanent-v2` and `seaport-vault-strict-security`. Their strict gates were not edited. The fresh Seaport report retains all101 detectors and23 High observations; other contract scopes and historical findings remain separate. Passing functional jobs is not contract security clearance.

The validation report also records the exact base-to-source contract delta: only the added test `Task086CollectionPolicy.t.sol`. There is no production contract, application, configuration, workflow, package or lockfile delta. Subsequent closeout commits contain evidence, offline replay and documentation only; their automatically scheduled checks are distinct from these completed validation results and must not be inferred to have passed.

The production collection catalog remains empty; current signed order is unavailable. Production stays **BLOCKED_NO_BROADCAST**.

## Final evidence-head CI prerequisite correction

On evidence head `fe4ee367f3af005eb5766a512b9571d913e0063d`, [repository job136060814265](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44667662558/job/136060814265) failed one of211 release-evidence tests. The newly retained1be archive requires six exact historical Git-blob comparisons. The shallow Linux checkout did not fetch that source commit; `git show 1be772c8787b47fbc0c791a03a694cb2a5673d86:scripts/seaport-acquisition/browser-safe-admin.mjs` failed before its hash comparison. Local full-history replay passed; this is not a contract or browser failure.

Intermediate head `b651635db2d5186ba8b2b47c9b67e339ba5ce4d1` added one exact historical fetch. The retained Task083 preservation guard correctly rejected that addition: its CI comparison permits only its original exact preservation-base fetch. The guard is itself checksummed historical evidence. Neither that validator nor its original integrity manifest was changed.

The repair removes only the intermediate fetch line, restoring the existing CI workflow bytes. Task086 instead retains `browser/1be772c8/source-1be772c8.pack`:29,465 bytes containing exactly10 public Git objects (one authentic1be commit, three ancestor path trees and six source blobs;84,876 uncompressed bytes). All10 original uncompressed objects were scanned before retention using unchanged Gitleaks8.30.1 and `.gitleaks.toml`:exit0, zero findings, no added suppression. Object identities, sizes, SHA256 values and the original scanner result are pinned in that archive's integrity manifest.

Replay always imports the bounded pack into an initially empty temporary bare repository, with empty Git configuration/templates, no hooks/remotes/alternates, disabled protocols and no inherited Git object paths. It verifies the exact object closure, Git object hashes and commit/tree/path bindings, then performs the same six historical `git show` byte/SHA256 comparisons. It never substitutes current files or fetches history. Focused negatives reject tampered/oversized packs, wrong commit identity, a valid pack missing a required blob, swapped tree identities and changed scanner provenance. Cleanup is restricted to the verified temporary directory created by that invocation.

The original failed jobs remain evidence. This is an offline provenance repair; original assertions, timeouts, detectors, strict findings and release holds remain. Only the corrected head's actual CI results can establish completed final checks. Task087 implementation remains gated on that review.
