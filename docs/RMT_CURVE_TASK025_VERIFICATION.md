# Task 025 curve security and deployability

## Candidate and disposition

The reviewed Solidity is [draft #592 at 5fe80e04713cd0d72dedc087ede3a54ba2d6920d](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/592), source tree `e98de2eaedcf9d233bac0860094e7179db2ab562`. The baseline Slither workflow is blob `c1f29e7731ddfe671d4ad408f811fd9bc813bda5`. This task adds verification tooling and evidence. Solidity under `packages/contracts/src`, the website, the production locks, the established fee terms and the full-tree gate retain their baseline content.

The 18 active-engine observations are conservative under the reviewed deployment bindings. This review confirmed no concrete defect and made no contract corrections. The gate still requires independent disposition. The [Task 024 row matrix](RMT_CURVE_TASK024_SECURITY.md#exact-591-balance-check-rows) preserves the exact call, prior read and assertion for each baseline row. Rows 9–12 there were eliminated in #592. The remaining groups were reviewed as follows.

| Root cause and count | Assets and boundaries | Safeguards, tests and remaining assumptions |
| --- | --- | --- |
| Position funding, eight | The curve token pull, ERC-20 grant, Permit2 grant and PositionManager mint each cross engine and PoolManager token snapshots. ETH backing and unsold inventory settle into the canonical position. | Only the bound active curve can fund. The immutable Uniswap and hook runtimes are verified, the factory token has no callback hook, and the shared engine reentrancy guard stays held. Both exact finite grants must be consumed, manager and engine deltas must reconcile, and the position must have the exact pool, owner, range and liquidity. Foundry exercises false approval, a wrong Permit2 expiry, sticky allowances, corrupted funding and callback reentry. The official fork exercises actual allowance consumption. |
| Curve graduation, three | Grant, engine call and clearance all sit between genuine token balance observations. An invalid refund would affect real ETH backing or inventory. | The guarded curve closes trading and clears tracked backing before interacting. It binds the engine, matches the only authenticated dust transfer against the independent balance delta, and checks exact token movement and clearance. Foundry covers forced ETH, duplicate refund attempts, fake grants and failed clearance. The Halmos check explores a 0–3 wei refund against a declared 2 wei. This is a controlled engine fixture. |
| LP fee harvest, one | The pinned PositionManager call crosses a balance observation of the LP fee ledger. Fees, the original NFT and its principal are at stake. | The sole call uses zero added liquidity, zero input maxima and the fixed ledger recipient. Before/after verification covers the original owner, full pool key, ticks, liquidity, approvals, fee growth and exact proceeds. The engine exposes no NFT approval or transfer path. Foundry covers attempted reentry, diversion, principal corruption and claims. Fork swaps and claims retain the original ownership and liquidity. Halmos independently checks ledger credit and claim authorization, outside PositionManager. |
| Curve asset migration, six | Fixed-token transfer, original ledger writer handoff and adjacent successor acceptance each cross predecessor and successor inventory snapshots. | Creator consent, two signer approvals, the public delay, exact successor identity and runtime hash precede settlement. The old engine closes, the new engine stays inactive through writer handoff, and both asset deltas and sold/backing values are exact. The original fee claims stay in their ledger. Foundry exercises wrong identity, interrupted transfer/acceptance, hostile token and ledger callbacks, late suspension and retry. The fork executes both hops. Halmos checks a foreign caller with a symbolic destination and hash. Future governance-approved code still needs its own review. |
| Standalone holder escrow, six | The original-token pull and replacement payout cross independent holder and escrow balances. Four observations cover the pull and two cover payout. | Local-only escrow checks caller, exact spender allowance, runtime and supply, caps redemption and rechecks both asset balances after guarded calls. Foundry covers malformed ERC-20 responses, underpayment and callback attempts. A caller-selected registry/token pin does not establish canonical project provenance or trustworthy arbitrary token behaviour. The findings remain separate and open. |

Factory and registry ordering entries remain because candidate or successor publication follows checked external settlement. The scheduled execution authority is already consumed before the factory call, and aborting restores the notice. Read-only callbacks can still see a predecessor pointer during settlement. Readers should use finalized transaction state. The [historical direct V1 IR failure and V2 funding gap](RMT_LAUNCH_PRODUCTION_DATA_READINESS.md#exact-contract-scope-for-independent-review) remain in the historical analysis record.

## Scope and Slither reproduction

| Run | Contracts / detectors | High results |
| --- | ---: | --- |
| Unchanged full-tree CI with its existing reporting filter | 244 / 101 | 24. Eighteen curve rows and six standalone escrow rows. Exit 255. |
| Additional 4663 / 2 ETH compiler import closure, every detector, unfiltered, including inline ignored findings | 76 / 101 | 22. All 18 curve rows plus four imported library results. Exit 255. |

The [full-tree report](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511948049/job/132184137163) has 290 total results. The additional run has 215 results and no observed Slither parser errors. Its four additional highs are historical-library arithmetic patterns surfaced by including imported libraries. Two `incorrect-exp` reports cover intentional XOR inverse seeds in Uniswap `FullMath.mulDiv` and OpenZeppelin `Math.mulDiv`. For an odd denominator the low bits of `(3 * denominator) XOR 2` seed modular Newton iteration. Two `incorrect-shift` reports cover Yul bit-scan lookup logic in the pinned Uniswap `BitMath` implementation. These findings remain visible in the raw report.

The script uses compiler AST import edges from five roots: bootstrap, directory, registry, reviewed V2 deployer and reviewed V3 deployer. It includes all 65 reachable source files and verifies that the discovered 15 first-party inputs match the deployment compiler inputs, alongside 50 imported sources. The historical direct-launch implementations and the replacement-token escrow are absent from that closure. The bootstrap and factory create only their bound guard, graduation engine, fixed token, curve and ledgers. Dynamic migration requires reviewed directory admission and exact candidate hashes. This reachability conclusion is for the current reviewed templates. It cannot constrain future code that governance authorizes or arbitrary implementations of user and beneficiary callbacks.

The source analysis includes imported protocol and OpenZeppelin source. The already-deployed PoolManager, PositionManager and Permit2 are external runtime dependencies invoked by the launch contracts. The fork verifies their code hashes and bindings and exercises them. The Router, Quoter and StateView are verified end-to-end dependencies. The position NFT descriptor is outside the tested mint and harvest calls. Runtime hashes do not pin mutable upstream state such as the PoolManager fee controller. External runtime verification is separate from static analysis of the compiler graph.

```sh
node packages/contracts/scripts/validate-curve-graduation-4663.mjs \
  --anvil /path/to/anvil --solc /path/to/solc-0.8.26 --archive pocket \
  --backing-wei 2000000000000000000 > /tmp/curve-4663-2eth.json
node packages/contracts/scripts/analyze-curve-production-scope.mjs \
  --solc /path/to/solc-0.8.26 --fork-evidence /tmp/curve-4663-2eth.json \
  --output /tmp/curve-scope-new --python python3
```

Use Slither 0.11.5 and crytic-compile 0.3.11. The script writes the AST-derived source manifest, exact analysis compiler input, normalized source copies, raw Slither JSON and text log before returning the high-severity exit status. The analysis input SHA-256 was `d21d9f5df69b41b939bc01202002859ef630019e50faa10ba3781f2c827a8e70`. Keep the existing full-tree command from [Task 024](RMT_CURVE_TASK024_SECURITY.md#exact-baseline-and-reproduction) in addition to this run.

## Deployability

The pinned 4663 Anvil 1.7.1 Cancun fork used Robinhood block **113412054**, hash `0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2`. The 2 ETH input SHA-256 is `a28e0ae5a50ea1375644a0b737ad6d55d1da90d04bc1f169de0ad9e0553d0bd2`. Solidity `0.8.26+commit.8a97fa7a`, Cancun, via IR, optimizer 200 and the existing IPFS metadata settings produced the same candidate bytecode. The 4663 test compilation applies only the documented chain gates and threshold literal substitutions over the frozen source.

| Measurement | 2 ETH fork |
| --- | ---: |
| Bootstrap creation bytecode | 48,478 bytes |
| Constructor ABI encoding | 416 bytes, 13 static words |
| Exact submitted initcode | 48,894 bytes |
| EIP-3860 limit / headroom | 49,152 / **258 bytes** |
| EIP-3860 word metering / calldata byte gas | 3,056 / 715,596 gas |
| Bootstrap execution receipt / transaction limit | 9,951,309 / 14,000,000 gas |
| Factory runtime / EIP-170 headroom | 23,980 / 596 bytes |

Exact initcode SHA-256 is `99f4d4b955d574a5c2682a1a615f51a314e8618bbd123205a8e011b7aed593f6`. Fork-only bootstrap receipt `0xd97eaec695b8f0bb9637a378d30dc9ee3670d7e2c2081558204dc3279e09b64c` is in block 113412058. These are Anvil execution observations, excluding Nitro L1 posting and sequencer admission. [EIP-3860](https://eips.ethereum.org/EIPS/eip-3860) · [EIP-170](https://eips.ethereum.org/EIPS/eip-170) · [ArbOS EIP-3860 adoption](https://docs.arbitrum.io/run-a-node/arbos-releases/arbos11)

At the pinned anchor, independent Pocket and dRPC reads of ArbGasInfo at `0x000000000000000000000000000000000000006c` observe **32,000,000** maximum transaction and block gas. The very large header gas limit is a sentinel, so the observed ArbOS ceiling is the relevant comparison. For exact read-only posting evidence, compile the manifest using `buildCurveReviewCompilerInput` and ABI-encode the bootstrap with the constructor fields in the fork JSON. Call NodeInterface at `0x00000000000000000000000000000000000000c8` with `gasEstimateL1Component(address(0), true, initcode)` in `eth_call`, from the fixture deployer EOA, and bind the observation to the block hash. Both archive providers returned zero estimated posting gas at that block and an L2 base-fee estimate of 20,050,000 wei. An official RPC read at block 113691269 returned zero estimated posting gas and 20,026,000 wei. These point-in-time results do not guarantee a future zero posting cost. [Arbitrum gas estimates](https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas) · [Robinhood network](https://docs.robinhood.com/chain/connecting/)

No refactor is needed for the measured inputs. Static constructor widths make payload size stable across real values supplied to this ABI, while values change the byte distribution and posting estimate. Recheck exact initcode, runtime size and gas after any changed input, compiler setting or source. If a later candidate exceeds either limit, a separately reviewed version could use runtime-pinned deterministic deployment modules and withhold registry publication until all reciprocal bindings are verified. This would need new address derivations, rollback tests and an audit scope before any launch. Existing token addresses, claims and custody are outside a deployment refactor.

## Dynamic, symbolic and owner-test evidence

The full candidate regression at #592 passed 604 tests and retained the four known opt-in skips. A fresh focused run of nine suites passed **69/69**, with 2,048 quote/solvency fuzz inputs, 2,048 creation-refund fuzz inputs and 2,048 stateful accounting calls. The two fuzz tests used seed `0x25` and `FOUNDRY_FUZZ_RUNS=2048`. The invariant retains its checked-in 64×32 settings, fail-on-revert, zero reverts and zero discards. It checks token identity, backing, inventory, lifecycle and independent fee buckets before graduation. The new 2 ETH official fork passed both same-token migration hops, the interrupted funding path, v4 swaps and LP claims. It again deposited **1,999,999,999,999,999,952 wei** and preserved principal. [#592 Foundry run](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511947877/job/132184136532) · [#592 fork artifacts](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511947948/artifacts/14079376759)

Halmos 0.3.3 with Yices 2.6.4 returned three passes on the optional `RMTLaunchCurveSymbolic` harness. It used the original Solidity and the 31337 review optimizer and EVM settings. Its assertions cover unauthorized curve migration, unauthorized LP credit and payout, and exact refund settlement in a bounded 0–3 wei scenario. It uses a controlled graduation engine and does not symbolically execute Uniswap or a full governance lifecycle. This is bounded verification, independent of Slither's analysis method. It is not an independent professional audit. Aderyn's distributed Windows setup requires WSL and there is no installed distro. Mythril's supported Python runtime and binary distribution were unavailable on this host. [Aderyn](https://github.com/Cyfrin/aderyn) · [Mythril](https://github.com/ConsenSysDiligence/mythril) · [Halmos](https://github.com/a16z/halmos)

Forge coverage on the whole repository failed in the coverage-only compiler with a Yul stack-depth error. The isolated curve-and-escrow test source set completed with `--ir-minimum`, which can affect source mapping and emits different bytecode. The 13 first-party implementation files excluding escrow recorded 758/799 lines, 92/93 functions and 91/156 branches. Curve V1 recorded 98.09% lines and 70.37% branches, graduation 96.18% and 60.00%, factory 96.04% and 70.83%, registry 93.75% and 50.00%, LP ledger 96.88% and 77.78%, and escrow 88.24% and 30.77%. These are coverage diagnostics. Untested defensive paths remain.

### Complementary tool reproduction

From `packages/contracts`, use Foundry 1.7.1 and the existing checksum-pinned native compiler. Run `FOUNDRY_FUZZ_RUNS=2048 forge test --use "$SOLC" --fuzz-seed 0x25 --match-contract "$SUITES" -vv`, with `SUITES` an anchored alternation of the nine names below plus `Test`. For coverage, stage a temporary project with the 15 RMT source paths in the scope manifest and `src/RMTLaunchHolderMigrationV1.sol` using the original 31337 source files. Copy the nine tests below from `test/<name>.t.sol`, preserving their paths. Copy the original Foundry config and remappings, link the pinned `lib` directory, and add `solmate/=lib/v4-core/lib/solmate/` to the temporary remappings. Run `forge coverage --root "$STAGED" --use "$SOLC" --ir-minimum --exclude-tests --report summary --report lcov --report-file "$LCOV"`. The Windows LCOV SHA-256 was `36942bb7bb314fb906fb8e05366d56b28960f9734485a8f1625e5b5805adaa5f`.

The pinned Uniswap dependency's upstream `FullMathTest` and `TestBitMath` passed **37/37**. The pinned OpenZeppelin `MathTest` passed both `testMulDiv` and `testMulDivDomain`. The fuzz cases each ran 1,024 inputs. These results corroborate the dependency findings without removing them from either report.

```sh
forge test --root lib/v4-core --use "$SOLC" --out /tmp/uni-out \
  --cache-path /tmp/uni-cache --match-contract '^(FullMathTest|TestBitMath)$' --fuzz-runs 1024 -vv
FOUNDRY_TEST=test/utils/math forge test --root lib/v4-core/lib/openzeppelin-contracts \
  --use "$SOLC" --out /tmp/oz-out --cache-path /tmp/oz-cache \
  --match-contract '^MathTest$' --match-test '^testMulDiv' --fuzz-runs 1024 \
  -R "forge-std/=$(pwd)/lib/v4-core/lib/forge-std/src/" -R '@openzeppelin/=./' -vv
```

```text
RMTLaunchCurveAccountingInvariant
RMTLaunchBondingCurveV1
RMTLaunchCurveCreationFeeV1
RMTLaunchCurveDirectoryV1
RMTLaunchProjectRegistryV1
RMTLaunchMigrationReadiness
RMTLaunchHolderMigrationV1
RMTV4CurveGraduationV1
RMTLaunchAdjacentMigrationProof
```

For Halmos, stage the same original source and compiler configuration in a separate scratch project and copy only `test/RMTLaunchCurveSymbolic.t.sol`. With Halmos 0.3.3 and Yices 2.6.4 on the tool path, run:

```sh
FOUNDRY_SOLC="$SOLC" python -m halmos --root "$STAGED" \
  --contract RMTLaunchCurveSymbolic --solver yices-2.6.4 \
  --solver-threads 2 --solver-timeout-assertion 20s --no-status --json-output "$RESULT"
```

The Windows replay used Python 3.14.8 and Halmos in an isolated dependency directory. It used the `eth-hash[pycryptodome]` Keccak backend (`ETH_HASH_BACKEND=pycryptodome`) because the `safe-pysha3` wheel was unavailable. The bounded run reported no solver counterexamples and no bounded loops reached. Its JSON SHA-256 was `61e88580310c81ae6e5fe81c78b74bfcafd53393911164304cba3a2a42be1969`. The `check_` harness is opt-in and ordinary Forge test discovery does not count it as three additional passes.

Use the [private owner-test instructions](RMT_CURVE_TASK023_OWNER_TEST.md) with a fresh chain-31337 session, the exact candidate compiled as one consistent factory/successor set, and an iPhone on the same trusted Wi-Fi as the operator. Browser emulation can verify the signed transaction and settlement path. Physical iPhone and MetaMask acceptance need the device run.

Before funded testing, obtain an independent review of the open findings and exact intended binaries and constructor values, approve the actual economics, recipients and signer operations, complete physical wallet acceptance, and establish production archive/trace, L1 finality, persistent indexing and exact-PoolKey evidence. Funding, fee and deployment authority remain separate owner decisions. [Operations and approval manifest](RMT_CURVE_TASK022_OPERATIONS.md#owner-approval-manifest)
