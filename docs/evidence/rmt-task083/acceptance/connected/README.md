# Connected browser evidence: local candidate only

Frozen functional source: `f5a9f40ce2ffb292c8cd12f985158d00416fd3fd`.
Both jobs passed in [run 44587226489](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44587226489).
Production purchasing remains **NO-GO**. No current live listing, production deployment, production transaction, real owner signature, or physical iPhone verification is claimed.

| Engine | Job | Artifact | Retained observations |
| --- | --- | --- | --- |
| Chromium | [135783338439](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44587226489/job/135783338439) | 14562416134 | 11 fixture cases, 82 fixture receipts; 8 reviews, 7 wallet submissions, 1 wallet rejection, 10 recovery responses |
| WebKit | [135783338787](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44587226489/job/135783338787) | 14561910768 | 11 fixture cases, 82 fixture receipts; 8 reviews, 7 wallet submissions, 1 wallet rejection, 10 recovery responses |

The per-engine chain report contains 74 successful and 8 reverted fixture receipt observations, including a deliberately orphaned fill. These 82 receipts are separate from the 7 browser wallet submissions. They are retained observations across local snapshots, not a claim that every observed transaction remains canonical at the final checkpoint.

Each job used fresh synthetic accounts, loopback Anvil chain 31337, genuine fixed 1 billion supply launch core with actual factory/project binding, source-derived Seaport 1.6, new V2 vault and checks helper, synthetic ERC721/ERC1155 and immutable ERC20 fixtures, and PostgreSQL 18.6. The Base Sepolia upstream anchor is recorded with its block hash; upstream access was read-only. This connected run deployed Seaport locally and did **not** use the canonical Robinhood 4663 Seaport runtime. The separate [Robinhood fork evidence](../../marketplace/README.md) records that other boundary. Neither run admits production controller metadata, proxy currency governance, or current listing availability.

The successful sequence includes explicit configuration; loss of returned configure/purchase/disable hashes and bounded read-only recovery; wallet error 4001 before signing; an explicit fresh review after rejection; form edits invalidating review while preserving pending identity; native purchase; indexer restart with a new database connection and page reload; actual seller cancellation followed by a mined reverted purchase and terminal retry; ERC20 purchase with trace evidence temporarily unavailable; and disable confirmation. The PostgreSQL server and Next server were not restarted.

The final `evm_revert` orphaned **both** the token purchase and the later disable transaction. The worker removed the old settlement; the latest disable journal changed from confirmed to pending while preserving its review/hash, with no wallet invocation or resubmission and preparation blocked. There is no canonical post-reorg replacement. The raw response records the pending result; exact journal preservation and old row invalidation are source-bound assertions in the successful browser harness, not separate archived journal/database dumps. After this local reorg, synthetic policy can be ON again. Production remains unavailable independently.

The actual three-transaction same-block case places an unrelated native payment first, a valid purchase second, and a cooldown-reverted purchase third. The fee recipient's block delta is 32 trillion wei, while exact purchase receipt/call-tree attribution is 25 trillion wei. The indexer accepts only the valid order. The genuine Safe 1.4.1 seller remains truthfully marked as a proxy with no new source recompilation claim; the old Task082 verifier rejects that unsupported proxy, while the separate V2 profile checks exact runtime/singleton/handler, three owners, threshold two, no modules/guard, SafeMessage signatures, and EIP1271 magic.

## Retention and privacy

Only nine allowlisted members per artifact were extracted from ZIPs held in memory: five JSON reports and four PNGs. No PostgreSQL files, private keys, environment/config files, or unrelated artifact manifests were extracted. The complete ZIP SHA256 matched GitHub's reported digest for each artifact. `manifest.json` binds run/job/artifact/source identity, ZIP and selected file hashes, raw byte lengths, deployment and compiler identities, and every scanner finding. The complete ZIP itself is not retained.

Gitleaks **8.30.1**, using the unchanged repository configuration, scanned selected original plaintext bytes before compression. Its raw redacted report is retained byte-for-byte as `raw-gitleaks-report.json.gz`: 76 `generic-api-key` findings, all public fixture addresses/runtime hashes or preserved public source-response hashes, **zero unclassified findings**. Every match retains its original file, line, line hash, value hash and exact public binding. Synthetic asset addresses were independently derived from CREATE receipts; pinned Solidity 0.8.26 independently reproduced their creation/runtime bytes before classification. Project identity was checked against the genuine factory event and unique 1 billion token mint. Public source hashes were recomputed from preserved Task082 responses. No scanner rules, ignores, history, raw responses, or raw findings were modified.

## Verification and screenshot limits

Run from the repository root:

```sh
node --test docs/evidence/rmt-task083/acceptance/connected/connected.test.mjs
```

The seven passing checks audit selected raw/stored bytes, PNG signatures, all finding classifications, CREATE/project identities, independently materialized Seaport/controller runtimes, review hashes and ABI selectors, exact EIP1559 envelope fields, every settlement identity and payment, restart equality, reverted/pending/reorg observations, genuine Safe signatures, and all six archived successful purchase traces. Tamper cases change archive bytes, transaction nonce, operation selector labeling, NFT identity, database payee amount, duplicate submission, and same-block trace payment amount; each is rejected. This is an offline audit of the retained actual run, not a new chain execution or a cryptographic reconstruction of browser transaction signatures from unsigned review envelopes.

Each engine retains unchanged desktop, portrait, landscape, and purchase-review portrait PNGs. All six layout checks report no horizontal overflow. These use Playwright device emulation, not physical phones. The review screenshots are viewport captures: Chromium shows the review heading near the lower edge; WebKit shows account/chain/nonce/vault/network cost and order identity, with lower consideration content below the viewport. They do not establish full cost/consideration visual coverage. The raw review records contain those exact values and are checked against submission/recovery evidence.
