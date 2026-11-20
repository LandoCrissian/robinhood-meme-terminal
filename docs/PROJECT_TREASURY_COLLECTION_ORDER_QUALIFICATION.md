# One collection and current-order qualification

**BLOCKED_NO_BROADCAST. NFT purchases remain OFF; production collection catalog remains EMPTY.**

[Task086 owner scope](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/679#issuecomment-7026749178) starts from exact Task085 PR679 `91e7c1914d2fd87287b3b4b0f243c982c1faf36f`, stacked on PR678 and earlier. The base has11 successful checks and two unwaived strict security failures. This task does not build another purchasing engine or change production Solidity, economics, beneficiaries, hosting, databases or royalties. Existing [native order admission](PROJECT_TREASURY_CURRENT_ORDER_ADMISSION.md) and [23-ID security register](evidence/rmt-task084/security/README.md) remain binding.

## Candidate and current-order verdict

Exactly one collection was investigated: **chain4663, `0x7a543c61c021e9a5c7949faBdc2f4e0a58088daf`, ERC721 token478**. This is a read-only feasibility candidate, not an approved collection, seller, order or treasury purchase. No additional marketplace exploration or candidate substitution is needed to explain the actual blockers.

The owner confirmed this same address as their LAMMBs contract during the task. That confirms the intended collection identity. NFT-holder order authorization, source-policy admission and any live permission changes remain separate decisions; none was inferred from collection ownership.

**`CURRENT_ORDER_UNAVAILABLE`.** The documented public OpenSea order endpoint returns HTTP401. Its lawful public collection page exposes a timestamped asking-price summary, without the complete OrderParameters, signature, current order hash/counter/status, full fees/royalties, zone or conduit. A UI listing ID is not asserted to be a Seaport hash. No synthetic signature, bid, old fill or validation event is substituted for the missing current payload. No account, private endpoint, authenticated session, API purchase or access-control bypass was attempted.

| Predicate | Evidence-based verdict |
| --- | --- |
| Direct Seaport seller authorization | The sampled current seller lacks per-token/direct operator approval for canonical Seaport; direct transferFrom fails `0x59c896be`, `TransferCallerNotOwnerNorApproved()` |
| OpenSea conduit authorization | Conduit approval is present in the recorded observation; that does not authorize the existing zero-conduit route |
| Validator restriction | Tested validator calls return `0xe1f1d02e`, `CreatorTokenTransferValidator__CallerOrFromMustBeWhitelisted()`; current caller/from whitelist policy is distinct from missing ERC721 approval |
| Receiver compatibility | The earlier revert is **not proof of an immutable Safe/vault receiver ban**. Receiver-specific checks and current caller/from restrictions are recorded separately |
| Runtime/source | Exact fixed EIP1167 implementation routing and observed source/code bindings are investigated; mutable issuer, validator/list authority and all unresolved closure details stay explicit |
| Signed order | Missing; exact executable all-in native amount, payees, order hash, expiry, full-fill/FULL_OPEN and zero-zone/conduit compatibility cannot be established |
| Purchase release | **NO_GO**; no approved catalog entry, live transaction or production-chain vault build |

Source/state evidence is retained under `docs/evidence/rmt-task086/collection/`. Successful, degraded and development captures have separate identities. A provider's missing archive state is unavailable evidence, never an EVM veto or a passed check. The final report records the exact block/hash/time/providers and scope; two RPC witnesses corroborate L2 observations, not independent Ethereum L1 finality.

The existing supported order subset remains one ERC721/1155 offer; FULL_OPEN, static/full-fill; native ETH; zero zone/zoneHash and both conduits; bounded exact consideration and recipient/royalty policy. Seller ownership, direct authorization, signature, cancellation/fill state, expiry, reserves/caps and canonical state must all be current. No route capability is silently broadened to fit this collection.

## Implemented bounded policy review

`collection-policy-review.mjs` snapshots bounded trusted collector data: exact chain/collection/token, canonical headers from both witnesses, at most8 source/runtime roles, issuer and approval authority, royalty source/state, transfer simulations and explicit unknowns. It requires the pinned4663 Seaport identity, exact corroboration and60-second freshness. Its code-binding, mutable-state and combined policy fingerprints are reproducible review identities. A fingerprint never grants owner consent or production admission.

Missing source/immutable bindings, unreviewed authority, missing direct authorization, unknown transfer evidence and mutable policy remain NO_GO. Revalidation requires fresh current observations and canonicality of the original anchor; changed source, validator, owner, ruleset, seller approval, royalty or other bound state invalidates the review. Regressed/reorganized state and interrupted reads fail closed. The production collection catalog remains compiled empty; no uploaded policy can insert an entry.

**Transaction-time limitation:** the immutable existing V2 purchase calldata does not bind the dynamic validator/ruleset/royalty policy fingerprint. Offchain latest/pending checks cannot prevent same-block privileged changes or a later collection freeze. This module does not pretend to add atomic enforcement. Mutable-policy findings remain an admission/release hold, not a reason to invent another engine or weaken the vault.

## Focused security and isolated acceptance

The three new genuine-Seaport Foundry regressions distinguish missing direct approval from validator veto, prove failed purchases/withdrawals preserve accounting and reservations, and demonstrate the intrinsic liveness risk of a mutable collection policy. A synthetic issuer can change exit policy inside a legitimate fee payout while payment and NFT custody remain exact; later withdrawal then reverts. This does not demonstrate protocol reserve extraction, real collection behavior or an independently cleared contract. It does show why unchanged code hashes alone cannot guarantee NFT withdrawability.

All23 active vault High observations remain individually retained and prioritized. Existing funding, native/ERC20 fulfillment, allowance revocation, withdrawals, reentrancy and principal/beneficiary safeguards are not removed. Core/dependencies22, TreasuryV1 six, acquisitionV1 22, active permanent ReclaimV2 seven and rejected historical ReclaimV1 four remain separate scopes. Full all101-detector strict gates remain unchanged. Production source changes require a demonstrated defect and fresh verification; no cosmetic warning-count reduction is pursued.

The connected helper reuses actual Seaport and the Task085 importer/watcher. Synthetic cases cover revoked approval, invalid signature, nonzero conduit, expiry, seller transfer, royalty drift and independent fee-cap enforcement, with exact asset/custody rollback. Existing cancelled/filled orders, reserve/caps, reorg, mined disable, multiple-transactions-per-block attribution, Safe2-of3, PostgreSQL18.6 restart and Chromium/WebKit acceptance remain. On the actual Robinhood fork, **read-only eth_call** tests transferFrom from canonical Seaport into the locally deployed existing V2 recipient plus separate validator/simulation reads. No real seller approval, impersonated signature, state override or NFT transfer is broadcast.

```sh
node --test --test-concurrency=1 scripts/seaport-acquisition/*.test.mjs packages/launchpad-common/seaport-vault-*.test.mjs
node --test docs/evidence/rmt-task086/security/review.test.mjs
forge test --root packages/contracts/seaport-acquisition --use /path/to/checksummed-solc0.8.26 -vvv
node scripts/seaport-acquisition/probe-collection-policy.mjs /isolated/collection-observation
# Existing workflow prepares exact dependencies, compiler, app/indexer builds,
# PostgreSQL18.6 and browsers. Execute both chromium/webkit, with and without fork.
node scripts/seaport-acquisition/browser-run.mjs --anvil /path/anvil \
  --solc /path/solc0.8.26 --pg-bin /path/postgres18.6/bin \
  --browser chromium --fork-robinhood --output /isolated/task086-rh-chromium
```

### Executed evidence and remaining CI boundary

Initial source `f027a1829b3f44200224ee1ba838de5689957560` completed all21 checks:14 passed, six unchanged strict security jobs failed, and default WebKit failed during the ninth synthetic Safe administration submission. Default Chromium and both Robinhood-fork Chromium/WebKit modes passed. The original failed job, partial receipts and screenshots are retained separately under [browser/failures/f027a182](evidence/rmt-task086/browser/failures/f027a182/README.md); it is not counted as passed acceptance. The callback stopped after the synthetic fault configuration mined and before a ninth submission record was retained. The original evidence cannot identify the exact callback error or establish a product defect.

Test-only diagnostics now retain bounded phase/error categories, prepared-request equality and selected recovery identity before existing assertions. They exclude raw signed transactions and SDK messages. Assertions, timeouts, signing/submission behavior and retry policy are unchanged. This is observability for a fresh source run, not a claimed correction of the original failure.

Local verification passed123 Node tests,57 Foundry tests across seven suites (512 fuzz runs;128 invariant runs with4,096 calls), and three security-evidence integrity tests. The standalone local Robinhood fork retained86 receipts,11 baseline cases and seven new reverted policy cases. First-source CI retained21 new rollback cases across the three passed modes,45 Safe executions with90 synthetic signature uses,12 PostgreSQL snapshots and24 matched row observations. [Offline replays](evidence/rmt-task086/browser/replay.test.mjs) verify the retained signatures, receipts, traces, database evidence and tamper rejection; they are not fresh chain execution. Additional diagnostic/replay tests pass separately.

The final two-provider collection capture remains **UNAVAILABLE**: Pocket returned37 matching anchored responses, then returned null for the concluding canonical block check. The earlier successful development capture is preserved without promotion to current evidence. No usable current-order payload or production collection policy is established.

Fresh-source CI results are recorded separately at closeout. Pending jobs are not passed. Local Windows memory/provider interruptions are separate from source defects and preserved as such; no failed test is replaced with synthetic success. Browser emulation is not physical-wallet acceptance.

## Minimum external input and next decision

The immediate external dependency is **an already seller-authorized complete signed supported Seaport order JSON that the owner is entitled to share, or an explicitly approved lawful complete-order data source**. No private key, seed phrase, API credential or new owner/seller signature is requested for this task. Code cannot reconstruct private signed terms from an asking-price summary.

Providing a payload authorizes read-only verification only. NFT478's present direct-approval and caller/from-policy blockers remain independent; receipt of a signed payload would not authorize changing those permissions or buying it. Do not approve the collection or request live approvals merely to make a trial pass. A future collection-admission decision must address source/authority closure and mutable transfer-policy risk first, while preserving separate deployment, funding and execution approvals.

Reclaim remains the frozen permanent-surrender trial. Own-token buybacks remain independently NO_GO. Fixed1B supply,600M/400M allocation,90/5/5 fee policy, original TreasuryV1 beneficiary rights and permanently locked LP principal remain unchanged.
