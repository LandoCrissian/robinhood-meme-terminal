# Task 088 source-file checksum adjudication

This is public-data evidence correction for the website repair. It does not clear a raw secret scan, contract finding, financial hold or production release.

## Why the unchanged gate failed

The first website candidate's full-history Gitleaks 8.30.1 run reported seven raw matches. Five are the existing Task 082 exact public identities. The two new matches are public source-file checksums in the original Task 088 test manifest, at immutable commit `3ec076fdd77e6dd502061040698c998eadc81b7b`, lines 14 and 15. The manifest records the SHA-256 of the actual launch-history API source and test. Both values were independently recomputed from their exact Git source bytes; neither is an authentication credential.

The original CI raw report, raw exit 1 and failed five-record classification are retained here. Its downloaded redacted archive SHA-256 is `5adb13820f92a28a6dd9ce15c6c8ff53c6cb34646e0cc282570b5a059310d51a`. Artifact [14604263838](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44682350976/artifacts/14604263838) and job [136108480341](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44682350976/job/136108480341) remain historical failures. No history rewrite removes those observations.

## Narrow proof

The [supplemental policy](exact-source-checksums.json) admits only those two immutable fingerprints. The new verifier pins the policy's complete digest, exact commit, manifest path, each permitted line/source path, complete manifest/source Git blobs, line digests, reported-value digests and exact redacted-match digests. It recomputes the reported checksum from the actual source file at that same immutable commit. A field merely named hash, a different source, a future commit or the same value elsewhere receives no exception.

The original five-record Task 082 policy and verifier are unchanged. A separate combination preserves all seven raw findings in its result. It succeeds only for exactly the five original identities plus these two source proofs. Every unknown, altered, duplicate or missing record blocks. The original scanner command, version, configuration, existing ignore file, raw-exit treatment and random-canary checks remain unchanged. The actual raw scanner still exits **1**; a successful public-data classification does not mean the raw scan is clean.

## Reproduction and negative coverage

The original baseline was reproduced locally with public branch refs available: 2,105 commits / approximately 54.27 MB, seven raw findings, five classified and two unclassified, wrapper exit 1. Its actual unrelated random key-shaped canary was detected and rejected.

The existing CI test entry now imports the supplemental test module while preserving all four original tests and assertions. **52 tests passed, zero failed/skipped** on Node 22.16.0: four original tests plus 48 supplemental tests. Coverage includes missing/duplicate observations, altered commit/path/line/rule/fingerprint/match/value, future identical values, mutated immutable source/manifest bytes, proof-policy tampering, configuration/ignore/original-policy tampering, and malformed/oversized input. Full raw reports remain byte-preserved under deterministic gzip; generated canary bytes are not retained.

The final unchanged scanner/canary run completed with raw **exit 1 / seven matches**, all seven exactly classified, zero unknown/missing, wrapper exit 0. The before/after raw observations are semantically identical. The actual random canary was detected (raw exit 1) and rejected by the combined gate. These outputs are retained here. A separate unchanged-rule scan of the newly added proof/source content reported zero additional matches before publication. Candidate CI remains independent evidence for the subsequently committed source. No contract source, detector suppression, severity downgrade, financial activation or production action is part of this correction.
