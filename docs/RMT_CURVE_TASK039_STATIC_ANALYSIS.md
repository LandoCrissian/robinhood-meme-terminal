# RMT Launch static analysis and offline build

The reviewed contracts are [PR #592](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/592) at `5fe80e04713cd0d72dedc087ede3a54ba2d6920d`, Solidity tree `e98de2eaedcf9d233bac0860094e7179db2ab562`. The #593 analyzer and #594 fixture share that tree. PR #606 consumes the fixture separately. Its local contract tree is a different source input. [Review source and build pins](RMT_CURVE_TASK039_REVIEW_HANDOFF.md).

## Reproduced findings

On 2026-11-14, Windows x64 replay used Forge 1.7.1 (`4072e487`), Node 22.23.2, Python 3.14.8, Slither 0.11.5, crytic-compile 0.3.11 and native Solidity `0.8.26+commit.8a97fa7a`. The compiler executable SHA-256 was `537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67`.

| Run | Contracts / detectors | Findings | High findings | Gate |
| --- | ---: | ---: | --- | --- |
| #592 full Foundry tree, existing reporting filter, LF source export | 244 / 101 | 316 | 18 active engine, 6 standalone holder escrow, 22 outside the new engine and escrow | Failed |
| #592 full Foundry tree, existing reporting filter, Windows checkout | 244 / 101 | 316 | Same 46 | Failed |
| Exact 4663 / 2 ETH compiler source closure with imported libraries and inline ignored findings visible | 76 / 101 | 215 | 18 active engine, 4 imported libraries | Failed |
| Recorded Linux PR workflow checkout | 244 / 101 | 290 | 18 active engine, 6 standalone holder escrow | Failed |

Both Windows full-tree runs exited `-1` (Windows representation of the high finding exit). The closure analyzer records raw `4294967295` and reports exit `255`. The Linux job exited `255`. All three fresh analyses report the same 18 active-engine call, prior balance and assertion combinations. Local detector IDs agree between the checkout and the closure. The LF staging path produces different IDs, with all 18 descriptions matching after line-coordinate normalization. [Individual findings](RMT_CURVE_TASK039_FINDINGS.md) · [Attached raw output](evidence/rmt-task039/slither-reports.tar.gz).

The Linux job metadata names #592's head. The runner checked out merge commit `ad32e2619c2c13416277f1534c40cf1a0d0e512e`, whose tree is identical to #593 and whose Solidity tree matches #592. The two native Windows reruns reproduce the 18 active and six escrow findings and also emit seven `arbitrary-send-eth`, four `reentrancy-eth` and eleven additional `reentrancy-balance` rows elsewhere in the tree. The difference persisted with Git-exported LF source, so the cause of the aggregate Linux-versus-Windows count difference remains unresolved. Treat both outputs as evidence and keep the existing full-tree gate. [Linux output and exit status](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511948049/job/132184137163).

The full-tree replay still reports a Slither IR generation failure in the older direct-launch `RMTV4LaunchFactoryV1._fundPosition`. The source span is lines 240–266 at #592. The Windows diagnostic points to lines 235–260 and reports `'NoneType' object has no attribute 'parameters'`. The separate historical scoped run could not analyze the older V2 funding helper at `deadline.toUint48()`, lines 257–283. Those gaps affect conclusions about allowance setup, final funding, balance checks and custody in the historical direct-launch paths. Retain their rollback tests and coverage caveats. The 4663 curve closure emitted zero parser diagnostics. [Historical funding coverage](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/9829e0ad40c4716f86e7c7246fa5eb90175f0367/docs/RMT_LAUNCH_PRODUCTION_DATA_READINESS.md#exact-contract-scope-for-independent-review).

## Scope and artifacts

The analyzer derives compiler AST import reachability from the bootstrap, directory, registry and reviewed V2 and V3 implementation files. It verifies that all 15 reachable first-party sources match the review input and includes 50 reachable dependency sources. The standalone holder escrow and historical direct-launch paths remain in the full-tree gate. Their source files have no edge from the reviewed deployment roots. Changing a successor template requires new authorization, runtime pins and review. The installed PoolManager, PositionManager and Permit2 code are external runtime boundaries. Their identities and bindings are checked separately. The four imported High findings are the XOR inverse seeds in Uniswap `FullMath` and OpenZeppelin `Math`, and both Yul bit scans in Uniswap `BitMath`. The raw report retains every row. [Source graph, pins and finding counts](evidence/rmt-task039/scope-report.json) · [Read-only 4663 observations](RMT_CURVE_TASK039_4663.md).

| Artifact | SHA-256 |
| --- | --- |
| [Raw Slither JSON and text logs](evidence/rmt-task039/slither-reports.tar.gz) | `ea5ad0c1286c74a7bf739534b4636b5950424e36c8f7b9bc3aea520c92778800` |
| [Compiler closure manifest](evidence/rmt-task039/scope-report.json) | `2e7ea841ed92e4053cc6deb5724feabf948d63632e78a514a561772a295022af` |
| Exact 4663 review compiler input | `a28e0ae5a50ea1375644a0b737ad6d55d1da90d04bc1f169de0ad9e0553d0bd2` |
| Slither compiler input | `d21d9f5df69b41b939bc01202002859ef630019e50faa10ba3781f2c827a8e70` |
| Byte-exact recorded 2 ETH fork JSON before projection | `a4c46f7d7abe5fd4d01221cdad580e005e1f6d04783daf428bc883f738f680e3` |
| [Offline bytecode replay result](evidence/rmt-task039/offline-bytecode.json) | `d495c2fe6ba484374f1b750a64dd030b508fb29e3c5e4f65f654cbd68d777e0d` |

The archive replaces only machine-specific directory prefixes. Its `SHA256.json` preserves original and attached hashes for each member. The IDs, detector, impact, confidence and descriptions were checked for equality before archiving. Use the [review projection](evidence/rmt-task039/historical-4663-fork-2eth.json) for compiler and constructor values. Raw fork receipt evidence is historical and identifies loopback Anvil results. [Historical #592 fork artifacts](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511947948/artifacts/14079376759).

## Reproduce

Install the pinned dependency sources with `packages/contracts/scripts/install-v4-deps.sh` in isolated checkouts of #592 and #593. Install their locked web dependencies for the compiler helper's `viem` ABI tooling. Keep the checkout path clear of the workflow's path patterns, since Slither filters absolute source paths. Use the native compiler hash for your platform from the [compiler pin table](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/9829e0ad40c4716f86e7c7246fa5eb90175f0367/packages/contracts/scripts/validate-curve-graduation-4663.mjs#L20-L24). The repo's checked workflow remains as-is. [Full-tree workflow](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/.github/workflows/security-analysis.yml).

```bash
python -m pip install slither-analyzer==0.11.5 crytic-compile==0.3.11
cd "$CONTRACT_CHECKOUT_592/packages/contracts"
export FOUNDRY_SOLC="$PINNED_SOLC"
export FOUNDRY_OFFLINE=true
python -m slither . --fail-high \
  --filter-paths '(lib/|test/|script/|broadcast/|src/BondingCurveMarket.sol|src/LaunchRewardVault.sol|src/MemeLaunchFactory.sol|src/LowCostMemeLaunchFactory.sol|src/LowCostMemeLaunchFactoryV2.sol|src/LowCostMemeLaunchFactoryV3.sol|src/clone/CloneBondingCurveMarket.sol)' \
  --json "$NEW_FULL_TREE_REPORT" > "$NEW_FULL_TREE_LOG" 2>&1
```

The fresh full-tree run uses the same detector and filter arguments and adds raw JSON output. Crytic Compile runs the Foundry build with build-info. To reproduce the clean staged replay, extract `git archive 5fe80e04713cd0d72dedc087ede3a54ba2d6920d packages/contracts` into a new work area, point its `packages/contracts/lib` at the installed pinned libraries, and run the same command there.

```bash
cd "$ANALYZER_CHECKOUT_593"
node packages/contracts/scripts/analyze-curve-production-scope.mjs \
  --solc "$PINNED_SOLC" --fork-evidence "$RECORDED_FORK_JSON" \
  --output "$NEW_SCOPE_DIRECTORY" --python "$PINNED_PYTHON"
```

The attached run uses the original historical JSON. A fresh run with the checked-in projection produced the same compiler input, all 215 detector rows and the same high-finding exit. Its scope manifest differs only in the SHA-256 of the supplied fork evidence file. Expect a nonzero gate exit from both analysis commands.

```bash
node "$TASK039_CHECKOUT/docs/evidence/rmt-task039/verify-4663-bytecode.mjs" \
  "$ANALYZER_CHECKOUT_593" "$PINNED_SOLC" "$RECORDED_FORK_JSON" "$NEW_BYTECODE_REPORT"
```

The offline compiler replay checked all 14 creation and runtime templates against the recorded manifest. It reconstructed the constructor input, bootstrap, engine and factory CREATE addresses, CREATE2 hook address and `beforeInitialize` permission bit from fixture inputs. The raw and projected fork evidence produced the same computed results. The helper performs only local compilation and encoding. The ABI-encoded bootstrap was **48,894 bytes**, containing 416 constructor bytes and leaving **258 bytes** under EIP-3860. Its SHA-256 was `99f4d4b955d574a5c2682a1a615f51a314e8618bbd123205a8e011b7aed593f6`. The exact fixture data gives 3,056 initcode metering gas and 715,596 calldata byte gas. The factory runtime was 23,980 bytes with 596 bytes of EIP-170 headroom. Recompute all limits, input hashes, runtime bindings and the resulting code identities for the exact approved release build and constructor inputs. [Offline verification helper](evidence/rmt-task039/verify-4663-bytecode.mjs) · [Template and initcode result](evidence/rmt-task039/offline-bytecode.json).
