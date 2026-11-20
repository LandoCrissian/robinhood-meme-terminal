# PR680 completed CI boundary for Task087

PR680's final head `1f7160f5db5d67de348e041a84ccc2889786217e` completed all 21 checks: **15 success, six unwaived strict security failures, zero unexpected failures**. Its last check completed **2026-11-20 03:59:50 UTC**. This is the reviewed Task086 dependency snapshot before Task087 work, not a claim about later Task087 commits.

[Final roster](pr680-final-1f7160f5.json) retains only public check IDs/names, exact source SHA, status/conclusion, start/completion timestamps and job URLs from the [GitHub checks API](https://api.github.com/repos/LandoCrissian/robinhood-meme-terminal/commits/1f7160f5db5d67de348e041a84ccc2889786217e/check-runs?per_page=100). [manifest.json](manifest.json) records queries, selected fields, file SHA256 and counts. All 21 IDs are unique, every source matches, every check is completed, and each completion timestamp follows its start. No logs, headers, credentials, RPC data, wallet payloads or private artifacts are retained here.

The passed checks are repository, contracts, indexer, Operations Safe, Gitleaks, web, both core lifecycle modes, Seaport units/fork/four browser modes, and the Treasury purchase V2 prototype. The final [repository job](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44669749020/job/136067610880) passed the 215-test release-evidence suite, including the original Task083 preservation validator and portable Task086 historical-source checks.

| Unwaived failure | Exact final job |
| --- | --- |
| Core Slither | [136067611093](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44669748966/job/136067611093) |
| Fixed-supply 4663 | [136067611210](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44669748966/job/136067611210) |
| Project TreasuryV1 | [136067611059](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44669748966/job/136067611059) |
| Historical ReclaimV1 | [136067610862](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44669748966/job/136067610862) |
| Permanent ReclaimV2 | [136067610730](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44669748956/job/136067610730) |
| Seaport vault strict | [136067610958](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44669748981/job/136067610958) |

Earlier completed attempts remain failures, with separate exact-source rosters:

- [`fe4ee367f3af005eb5766a512b9571d913e0063d`](pr680-prior-fe4ee367.json): 14 success/seven failure. The additional [repository failure](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44667662558/job/136060814265) was a missing historical-source prerequisite in the shallow checkout: 210/211 release-evidence tests passed.
- [`b651635db2d5186ba8b2b47c9b67e339ba5ce4d1`](pr680-prior-b651635d.json): 14 success/seven failure. Its historical replay passed, but the added fetch line failed the original [Task083 CI-preservation check](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44668266200/job/136062788537): 210/211 release-evidence tests passed.

The final portable source proof resolves the prerequisite while preserving the six historical source-hash checks and restoring the original validator/CI workflow. It does not retroactively pass either failed attempt. The six security gates remain unwaived; CI completion grants no governance transaction, deployment or production authority.
