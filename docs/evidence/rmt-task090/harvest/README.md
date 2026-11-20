# Task 090: one source/runtime-pinned LP-harvest finding

**Finding:** `c7bf2ac4fa4faa7416ab573d612269b829e795cf388551b323659cd99e12d48d`, Slither `reentrancy-balance`, `RMTV4CurveGraduationV1.collectLpFees`, PositionManager call at source line 317 and ledger balance snapshot at line 311.

**Technical result:** the reported uncontrolled mutation of that ledger baseline is excluded by the inspected exact call graph under the immutable bindings below. Five new tests execute the actual observed PoolManager, PositionManager and Permit2 bytecode, not substituted settlement mocks. They passed with 12 explicit before/after conservation snapshots, seven successful harvest call trees and four refused harvest call trees. This is a scoped internal source/runtime assessment with finite execution evidence, not an independent audit, whole-contract theorem or production activation.

**Release result:** preserve the original High observation, all 101 detectors, the raw strict gate, the other 17 stateful findings and seven governance Medium observations. This package grants no security-policy exception or financial authorization. `BLOCKED_NO_BROADCAST` remains.

## Exact implementation and test boundary

The immutable starting source is PR #684 head `b79515752ef42e88850ac2cea953955a3bb03087`. Shared protocol Solidity, economics and scanner code are unchanged. The source manifest records the engine, ledger, fixed token and the complete inspected external call path. Upstream source pins remain v4-core `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`, v4-periphery `ad04c9f24a170accf5ea1b2836bbafd514537ca6`; all 50 retained dependency-source digests were checked.

The test fixture preserves the **initial** 14-read official/Pocket observation at block **119193758**, hash `0x5a0b4a03bea9546106fc0d82a546100a55f981a7ce7c75b6b3c8289a6dcf8bcb`, in [the exact original capture](../graduation/initial-external-runtime-observation.json). Its SHA-256 is `751c7a08f486105718aaff62f0eec76c6e1ff78c4a3dcbc3e5f3037a98e6a9b1`. The separate newer six-role observation must not relabel this fixture's anchor.

| Runtime | Exact observed and tested code hash |
| --- | --- |
| PoolManager | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` |
| PositionManager | `0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2` |
| Permit2 | `0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca` |

All three actual byte strings execute at their canonical addresses in a fresh chain-31337 VM. Production storage is not copied. The PositionManager constructor's next-token counter is initialized to one; all pools, positions, tokens, balances, approvals and beneficiaries are synthetic. No fork, RPC, third-party account, live attack, signature, governance transaction or production write is used by the tests. Exact Permit2 runtime avoids silently substituting its existing simplified fixture or changing its original Solidity 0.8.17 pragma.

The RMT bootstrap, successor deployer and initialization guard are freshly compiled by the unchanged production-economic profile helper with checksum-pinned Solidity 0.8.26. The local input SHA-256 is `437fb783d7dce558a05317e8b15877f6d08b9571bc12aefec360382469d53648`. It preserves **0.0004 ETH, 1B supply, 600M/400M, 90/5/5, 1% and 2 ETH graduation**, with 4 ETH virtual reserve. This is the existing explicit local-chain variant, not the untransformed 1 ETH Foundry profile or a claim that local runtime bytes are deployed on chain 4663. `verify-fixtures.mjs` recompiles all 66 exact source inputs and compares all three embedded creation byte strings and every portable manifest field. It separately binds both providers' actual external code to the retained production pins. No filesystem permission was broadened; fixtures remain under the already-authorized `test/fixtures` read directory.

## Why the flagged counterfactual cannot enter this pinned path

1. The engine holds its mutation guard and verifies dependency code hashes, original token ID/PoolKey, owner, liquidity, NFT approval, subscriber absence and empty finite allowances before recording the current original-position fee growth.
2. The only encoded actions are **`0x0011`: zero-liquidity INCREASE_LIQUIDITY, then TAKE_PAIR**. The maximum token/native inputs and hook data are zero. The inspected PositionManager verifies the engine's ownership and uses the original token ID as the PoolManager position salt. No DECREASE or BURN action is exposed by this engine path.
3. The real PoolManager admits one unlock at a time. An outer unrelated unlock cannot enter this harvest. The original full-range PoolKey's guard permits only initialization; no liquidity hooks can call an arbitrary address. The original position has no subscriber, so its notifier does not dispatch a user callback.
4. TAKE_PAIR sends only this position's accrued currency credits to its immutable ledger. The native receiver checks that the caller is the pinned PoolManager and calls nobody. The admitted fixed TokenV2 transfers balances without ERC-777-style hooks or another application call. No beneficiary payment occurs during harvest. A preexisting donation therefore cannot become an interleaved claim or compensate for a diverted payout in the admitted graph.
5. After the external call, the engine rechecks original custody, liquidity, fee growth, allowances and **both exact ledger increments**, then records the same verified native/token amounts. Ledger recording validates actual asset coverage and credits cumulative immutable beneficiary entitlements. A later claim is a distinct guarded operation that debits its credit before paying.

These arguments require the inspected source-to-runtime bindings, immutable token/ledger semantics, fixed actions, disabled liquidity hooks/subscriber and retained postconditions. A different admitted dependency, token, hook, subscriber, action encoder, route or future implementation requires fresh assessment. A runtime hash alone is not proof that arbitrary replacement code is correct. The raw scan remains unchanged; tests alone are not the reason for the source-path assessment.

## New meaningful execution evidence

| Test | Evidence |
| --- | --- |
| Original-only collection, surplus and retry | A real outside LP position shares the pool. ETH/token swaps generate both fee assets. Forced ETH and direct token surplus are present in the manager and ledger before the snapshot. Harvest moves exactly original-position fees, leaves other principal/custody unchanged, credits only verified earnings, preserves unclaimable surplus, refuses duplicate collection, then correctly accumulates a second round. |
| Shared manager unlock | With existing nonzero ledger credits and new pending fees, a hostile outer unlock cannot harvest. Every recorded asset, entitlement and principal field is unchanged, and a top-level retry succeeds. |
| Real beneficiary callback | During its actual ledger claim, the beneficiary cannot reenter the same claim or complete a new same-ledger harvest. The latter's manager payout/fee poke rolls back when ledger recording meets the active claim lock. The original claim pays exactly once and preserves pending fees for a later valid collection. |
| Rejected native claim | A recipient that rejects ETH reverses its preceding token delivery and all claim accounting. A later token-only claim preserves the ETH entitlement and principal. |
| Runtime drift and principal theft refusal | An explicit local code substitution fails the real engine's dependency pin before settlement. With canonical code restored, an unapproved caller's original-position DECREASE action is refused. Asset/credit snapshots and original custody are unchanged. |

`proof-results.json` retains all 12 numerical snapshots and all 11 complete harvest subtrees. `extract-proof-results.mjs` independently checks the successful trace's exact action encoding, fixed callee set, immutable payout recipient, actual native/token delivery, ledger record amounts and before/after manager/ledger/assets/credits/principal conservation. Every snapshot's liabilities must equal verified accrual less prior claims; each harvest must credit exactly the four cumulative beneficiary increments for the committed synthetic 2250-bps treasury policy. It requires the exact five named tests and 12/7/4 evidence counts, and rejects a failed test or unexpected harvest callee. Its summary is **5 passed / 0 failed / 0 skipped; 7 successful / 4 refused harvest calls**.

For the first collected round, manager ETH falls by **81818181818181 wei** and launched-token balance by **2727272727272727272727 base units**. Ledger balances rise by exactly those amounts; its prior 23 wei / 41 base-unit surplus stays outside accrued entitlements. Original principal remains **28284271247461900976033 liquidity units**. These values are captured execution results, not expected mainnet fees.

The full final Foundry JSON is versioned in [foundry-full-traces-final.json.gz](foundry-full-traces-final.json.gz). Its compressed SHA-256 is `5c8ef617e7f888a3e55170935633e5aea57fdfc110f9978f8d1b8f2410712def` (3,766,968 bytes); verified lossless expansion is SHA-256 `4a288b8020160af7857fb2b574c3bf28066993cd63cc8d9f447aaaf37f68b429` (24,179,364 bytes). The compact report is a complete extraction of the harvest subtrees and explicit snapshot events, not a claim that discarded setup traces passed unexamined. The earlier trace before numerical snapshot logging is separately retained outside the checkout. An initial fixture-verifier failure caught a replaced provenance file; the fix points to the preserved original capture with identical original anchor/hash and code. The failed verifier output remains in `fixture-verification-before.txt`; no assertion or hash requirement was relaxed.

The unchanged Gitleaks 8.30.1 policy scan of the earlier 12-file source snapshot returned **raw exit 1 / seven `generic-api-key` matches**. All seven exact lines are the same synthetic ERC20 account address in decoded local harvest arguments. `gitleaks-classification.json` records the precise basis, and the raw redacted findings, exit and log are retained. That scoped snapshot excluded its five derived scanner outputs and the full traces. A separate scan of the losslessly expanded full final trace returned **raw exit 0 / zero findings** across all 24,179,364 bytes; `expanded-trace-scan.json` and the corresponding raw report/log/exit preserve its exact scope and hashes. No rule, allowlist or raw severity changed. Neither scoped scan is a full repository/history scan or overall raw green claim.

## Reproduction and remaining limits

Use the native pinned compiler on Windows, Linux or macOS and the existing exact pinned dependencies. Local Windows tool/archive/source identities and setup limitations are in `tool-and-source-manifest.json`. The test-only forced-ETH helper produces Solidity warning 5159 for `selfdestruct`; it models unsolicited surplus under Cancun and is not protocol/deployment code.

```text
node docs/evidence/rmt-task090/harvest/verify-fixtures.mjs --solc <pinned-solc-0.8.26>
forge test --offline --use <pinned-solc-0.8.26> --match-path test/Task090HarvestProof.t.sol -vv
forge test --offline --use <pinned-solc-0.8.26> --match-path test/Task090HarvestProof.t.sol --json -vvvv > <fresh-traces.json>
node docs/evidence/rmt-task090/harvest/extract-proof-results.mjs --traces <fresh-traces.json> --artifact packages/contracts/out/Task090HarvestProof.t.sol/Task090HarvestProofTest.json --output <fresh-proof-results.json>
```

Run Forge from `packages/contracts`; run the Node commands from the repository root and adjust trace/artifact paths accordingly. The new proof does not verify every production storage state, Ethereum L1 finality, physical-wallet behavior, future admission or other findings. No new defect requiring a versioned protocol patch was established. Production financial launch, publication and owner transactions remain separate NO-GO/authorization decisions.
