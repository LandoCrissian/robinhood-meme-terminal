# Current Task084 acceptance: source73

The corrected acceptance is source 73fc6d03d3160e19ac3d19af38138da3461bdb3f: [fresh evidence and scope](source-73fc6d0/README.md), [source/job/member manifest](source-73fc6d0/manifest.json). All four current Chromium/WebKit default/Robinhood-fork journeys passed. All29 source CI checks completed:22 success and7 unwaived strict-security failures; production release remains held.

Fresh raw scanning reported448 findings;448 were individually classified and0 remain unknown. It is not a zero-finding raw scan. Offline replay passed60 receipt/trace proofs,120 signature uses and120 tamper rejections across1996 trace frames. The new archive contains unchanged raw JSON bytes as deterministic gzip and20 unchanged screenshots. It includes strict raw account-code admission and the explicitly synthetic known7702 incoming-controller state fixture.

The [original d9 RH Chromium old-EOA pending observation](failures/d9-rh-chromium/README.md) is preserved and its cause remains unknown. Current success and added diagnostics are not claimed as its causal fix. The earlier98eb acceptance below remains historical; its original artifacts and bindings are unchanged.

---

# Task084 connected Safe administration evidence

These are successful isolated tests of source 98eb1be7d0a02e77e1a37f6109410f3e79f36ded, from [run 44618301617](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44618301617). They implement the bounded [Task084 owner instruction](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/677#issuecomment-7019806025). This evidence grants no production release or wallet authority.

| Fixture mode | Engine | Successful job | Artifact |
| --- | --- | --- | --- |
| Source-derived Seaport, real fixed 1B core | Chromium | [135892807150](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44618301617/job/135892807150) | 14575906765 |
| Source-derived Seaport, real fixed 1B core | WebKit | [135892807411](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44618301617/job/135892807411) | 14576761767 |
| Actual pinned Robinhood Seaport, synthetic project-binding stub | Chromium | [135892807536](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44618301617/job/135892807536) | 14577026009 |
| Actual pinned Robinhood Seaport, synthetic project-binding stub | WebKit | [135892807492](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44618301617/job/135892807492) | 14576512059 |

All four execute on new private chain31337 forks with fresh synthetic accounts/assets, isolated PostgreSQL 18.6 and the existing production-built Next application. The Robinhood mode reads genuine pinned4663 Seaport but does not transact on4663. Its project-binding stub is distinct from the default real fixed-supply core proof.

Each engine/mode records 15 proposals, 28 genuine EIP712 test-owner signatures, 15 outer reviews, 13 submitted Safe outer transactions, 18 recovery responses and 16 negative checks. Twelve administration rows remain canonical: eleven successful and one reverted. The thirteenth observed transaction succeeds before the intentional reorg and is then removed from the durable read model. The 22 Safe checks and five watcher checks pass in every bundle.

The real journey covers matured controller handoff, threshold rejection with one owner and no unsigned request/wallet call, owner/payer rejection, bounded policy enable/disable, collection disable/readmission, admitted fee cap, separate Safe native funding, exact ERC20 funding approval/consumption, controller proposal/cancellation, owner/module drift, missing hashes, canonical recovery after local review expiry and a later Safe nonce, trace outage, and reorg downgrade without resubmission. PostgreSQL is actually stopped/restarted with pg_ctl; Next is also actually stopped/restarted. Original journals and durable data survive. GS013 failed-inner execution preserves the Safe nonce and vault token balance.

The watcher runs through the existing worker's verified-cycle hook and the same leased private database. Three forced synthetic polls prove actual owner-supplied current-order verification, unsigned purchase simulation, persistence across another PostgreSQL server restart, duplicate suppression and invalidation after the mined Safe disable. It receives no signer or submission function. This does not prove an authenticated public listing feed or an autonomous production keeper.

[manifest.json](manifest.json) binds the four original ZIP digests, every selected member's original and stored SHA256/size, source identity and exact job/artifact IDs. Original JSON bytes are retained as deterministic mtime=0 gzip; all 20 PNGs are unchanged. Configuration/password files, PostgreSQL cluster data, read keys and private keys are excluded.

The original plaintext was scanned before compression and before any blob retention with Gitleaks 8.30.1 and the existing repository configuration. **339 raw findings were reported; 339 were individually classified; zero remain unknown.** This is not a zero-finding raw scan. [raw-gitleaks-report.json.gz](raw-gitleaks-report.json.gz) preserves scanner exit codes, full redacted finding objects and each rule/line/field classification. Findings are public synthetic contract addresses/runtime bindings and official source API response hashes. The latter are accepted only after exact equality to the preserved Task082 official source-manifest inputs at this source commit; its Git blob is recorded in the manifest. No ignore rule or full-history scan gate changed.

Every Safe UI execution includes the original RPC receipt, transaction and block JSON, callTracer tree and exact historical pre/post Safe states. Capture uses a private fixture read channel for archival; that channel is never supplied to the worker during the tested trace outage. [replay-raw-proofs.mjs](replay-raw-proofs.mjs) replays the retained genuine signatures, exact decoded Safe envelope, bounded inner call and trace, successful Safe outcome or actual GS013 error. It checks original-byte hashes before reading retained JSON. The executed memory replay passed 52 transaction/trace proofs, 104 signature uses and 104 nonce/extra-CALL tamper rejections, spanning 1,760 trace frames and four reverted receipts.

From a checkout with the existing indexer dependencies available:

    node docs/evidence/rmt-task084/browser/replay-raw-proofs.mjs

The dashboard frames show desktop/portrait/landscape viewport states in an emulated iPhone browser context, at device scale three. Separate region captures show the full two-owner inner CALL review and the distinct payer's maximum network-cost review. These are engine/device emulation, not physical iPhone validation. The viewport frames do not claim every review field is visible at once.

Remaining boundaries: canonical Safe1.4.1, three plain EOA owners, threshold two, empty modules, no guard, CALL only, zero Safe gas/refund fields, and one transaction per block for exact Safe nonce/fee attribution. Unsupported authority or missing canonical evidence stays pending. Standard SafeTx signatures have no onchain expiry; local freshness cannot revoke them. Explicit metadata refresh preserves identical collected approvals, while retry after a terminal GS013 revert currently requires a new proposal and owner signatures. Safe creator CREATE remains unavailable. Production financial routes, real funds/signatures, and authenticated public-feed/production payment admission remain outside this acceptance; strict security gates remain held.
