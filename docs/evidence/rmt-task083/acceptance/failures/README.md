# Retained browser failures

These are original **failed** attempts, not browser acceptance. All execution was isolated chain31337; production remains NO-GO. The [diagnostic index](index.json) binds each selected file to its source commit, run, job, artifact ZIP digest and exact raw SHA-256.

| Source / browser | Observed failure | Retained context |
| --- | --- | --- |
| `b928ce22` Chromium | Outer trace/index checkpoint readiness timeout | Earlier same-block indexer acceptance and the bounded Next startup log are retained. No worker diagnostics or inner last-failure record was available. |
| `b928ce22` WebKit | Initial outer trace/index checkpoint readiness timeout | No worker diagnostics or indexer acceptance file was available. |
| `e73a5c0a` Chromium | Required same-block query returned zero rows instead of one | Worker snapshot reported READY, two successful cycles, target/checkpoint57648372 and `lastFailure: null`. This is retained as the stale-checkpoint/readiness mismatch observation. |
| `e73a5c0a` WebKit | `selectOption` timed out after45,000ms waiting for the exact Action label | Same-block indexer acceptance passed; worker snapshot reported READY after40 cycles, target/checkpoint57648379 and `lastFailure: null`. |

An outer timeout without an inner failure record does not establish a particular worker, provider or contract cause. A READY snapshot and a partial indexer PASS do not establish complete browser acceptance. The WebKit record proves the locator timeout; it does not, by itself, prove a particular DOM cause. Subsequent fixes and passing checks belong to their own source-bound records.

All four ZIPs were downloaded into memory and hashed. Their digests matched GitHub's reported SHA-256 values. Only existing `failure.json`, `worker-diagnostics.json`, `indexer-acceptance.json` and bounded `next.log` files were extracted. The ten selected originals total6,695 bytes. No chain files, deployment manifests, PostgreSQL data, credentials, private files or screenshots were extracted or published.

Gitleaks8.30.1 scanned the selected raw diagnostics and extraction inventory with the unchanged repository configuration **before compression**: exit0, findings0, unknowns0. [The original scanner report](raw-gitleaks-report.json.gz) is retained. Every compressed file decompresses byte-for-byte to its selected original, with hashes in the index. The complete ZIPs are intentionally not retained here.
