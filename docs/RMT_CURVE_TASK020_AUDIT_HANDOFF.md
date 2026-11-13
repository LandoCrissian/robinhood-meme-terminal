# Curve launch readiness and audit handoff

Base [draft #587](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/587) at `5a164c56ef75396649a060d54756702513ad5464`. The checked-in deployment, settlement, migration and custody contracts retain their exact source. The original RMT token, deployed curves and historical direct-launch inputs remain outside this development task. The alternatives use offline compiler inputs and loopback Anvil. All economic terms are provisional.

## Security disposition

The [exact baseline Slither job](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43476388522/job/132061190311) used Slither 0.11.5 and 101 detectors on 241 contracts. It exited 255, with 28 high-severity `reentrancy-balance` rows on five curve functions. The detector follows pre-call balance values to post-call assertions. Guard coverage and the actual dependency call graph require a separate judgment. The matrix accounts for all rows by external call and observed balance. Local tests support these trust-boundary observations. Independent review owns the final disposition and the full gate remains required. [Detector source](https://github.com/crytic/slither/blob/0.11.5/slither/detectors/reentrancy/reentrancy_balance.py)

| Source and external call | Rows | Balance and transition | Boundary and available evidence |
| --- | ---: | --- | --- |
| `RMTV4CurveGraduationV1._fundPosition` line 356, token pull | 2 | Engine and manager token balances. The first receipt must equal the requested inventory. | Fixed factory token. The reviewed engine and active curve already hold their locks. Recovered `testCanonicalTokenHasNoCallbackAndFundingStillRejectsInjectedTokenFaults` covers the exact token identity, callbacks under fault injection and short transfer rollback. |
| Same function line 359, ERC-20 approval | 2 | Engine and manager token balances. Temporary allowance is limited to the funding amount. | Same fixed token and locks. The same test covers grant and residual ERC-20 allowance. |
| Same function line 360, Permit2 grant | 2 | Engine and manager token balances. The official PositionManager receives an exact, expiring authorization. | The immutable Permit2 pin is part of trust. Recovered `testHostilePermit2CannotReenterAndRetainedAllowanceRollsBack` covers both locks and grant/revoke phases with a local test substitute. |
| Same function line 374, position mint and settlement | 2 | Engine and manager token balances. The manager must receive both assets and the engine must own the original position. | Both locks and pinned dependencies. Recovered `testPositionManagerFundingCallbackCannotReenterOrReadTransientFees` and `testPositionManagerCorruptFundingRollsBackEveryBalanceAndCanRetry` cover mutation, transient preview, balances and custody. |
| Same function line 375, Permit2 revoke | 2 | Engine and manager token balances. The Permit2 amount must return to zero. | The Permit2 fixture covers revoke callbacks and retained allowance rollback. |
| Same function line 376, token approval clear | 2 | Engine and manager token balances. The token allowance must return to zero. | The canonical-token fixture covers clear and both locks. The final settlement still requires exact engine and manager deltas. |
| `RMTLaunchBondingCurveV1._graduate` line 323, token approval | 1 | Curve token balance. Graduation seals trading and clears the backing counter before calling the engine. | The factory-issued token has fixed ERC-20 code. The recovered canonical-token test exercises approval callback defense. |
| Same function lines 324–328, graduation engine | 1 | Curve token balance. Native and token depletion must match reported amounts. | Only the pinned engine can refund during the guarded transition. `testAtomicGraduationRefundOnlySeesFinalStateAndCanStillRevertEverything` and the funding rollback tests cover inconsistent settlement and refund behavior. |
| Same function line 329, token approval clear | 1 | Curve token balance. Clear funding allowance before committing the pool and position. | The fixed token and curve lock remain active. Recovered token callback evidence and existing rollback tests cover the approval boundary. |
| `RMTV4CurveGraduationV1.collectLpFees` line 317, zero-delta modify | 1 | Ledger token balance. Exact native and token payouts and fee growth must reconcile with unchanged NFT, range, liquidity and allowances. | One engine lock and a fixed ledger destination. Recovered `testPositionManagerHarvestRejectsReentryFeeDiversionAndPrincipalChange` covers substituted local behavior. The official fork exercises the exact zero-delta operation. |
| `RMTLaunchBondingCurveV1.migrateAssets` line 192, inventory transfer | 2 | Source and destination token balances. Predecessor seals before transfer. | The fixed token has no callback. Recovered `testTokenCallbackCannotReenterEitherCurveFactoryOrRegistry` exercises local fault injection. The existing false-success transfer test verifies exact delta rollback. |
| Same function line 193, successor acceptance | 2 | Source and destination token balances. The reviewed successor accepts exact backing and sold state. | Source, successor and registry guard their transitions. Recovered `testDestinationCodePinRejectsRuntimeSubstitution` and `testDestinationAcceptanceCallbackCannotReenterPredecessorFactoryOrRegistry` cover identity and closure. |
| Same function line 194, ledger writer handoff | 2 | Source and destination token balances. Ledger address and credits stay fixed, writer authority moves. | Recovered `testLedgerCallbackCannotReenterPredecessorFactoryOrRegistry` and `testLedgerCallbackTamperingAfterHandoffRevertsAllEffectsAndCanRetry` establish the tested atomic boundary. |
| `RMTLaunchHolderMigrationV1.redeem` line 125, original-token pull | 4 | Original holder, original escrow, replacement holder and replacement escrow token balances. Cumulative capacity is reserved before pulling the holder's exact allowance. | The separate 31337 escrow is guarded and validates the reviewed original and both deltas. Existing tests cover a callback, short transfer, false and malformed return values. Admission of any noncanonical original runtime remains review scope. |
| Same function line 131, replacement-token payout | 2 | Replacement holder and escrow balances. The exact 1:1 payout must settle after the original balance checks. | Replacement token is fixed ERC-20 code minted into escrow. Existing tests check exact transfer and rollback of both sides. |

The baseline already addressed the ignored factory inventory-transfer return, the ordering of curve closure and buyer payouts, and the position and fee ledger state exposed during funding. The new graduation funding helper's checked deadline cast is already in the baseline. These fixes do not clear the remaining rows. Historical direct-launch V1 and V2 SlithIR gaps affect their separate funding helpers and temporary approvals. Their rollback tests and separate manual audit scope still apply. [Task 019 report](RMT_LAUNCH_CURVE_TASK019_REVIEW.md#security-evidence) · [Historical direct-launch coverage](RMT_LAUNCH_RELEASE_CANDIDATE.md#independent-review-coverage)

Reviewers should independently check all admitted runtime hashes, exact balance assertions, reentrancy and read-only observation boundaries, temporary approvals, EIP-712 governance and liveness, accounting under interrupted execution, and both custody paths. The unit fixtures use substituted local contracts for boundary tests. The fork uses the official dependencies. Neither proves an independent audit or authorizes a live deployment.

## Migration viability

The existing factory admits `nextVersion == 2` only from version 1, and its immutable helper constructs V2 only. Execution selects `migrationCandidate[token][2]`. Registry candidate verification separately requires a V1 source and V2 successor. A new directory listing cannot change these immutable bindings. The recovered `testV2ToV3BlockedByFactoryRegistryAndPublicationWithoutLossOfExit` completes the genuine first transition, then verifies all these restrictions and an uninterrupted V2 sell. The token address, inventory, fees and history survive the rejected request.

Any forward version requires a separately reviewed factory and registry deployed together before launch. Carry over the current exact balance and economic commitment checks. Bind the transition to a factory-built successor for the next version, approved bytecode, source curve, creator, nonce, deadline, two distinct signatures and public delay. Preserve both closure and rollback and keep all existing entitlements on the original ledger. Maintain the deployed V2 runtime and exits for projects bound to the previous factory. A new registry alone cannot change those immutable bindings.

`RMTLaunchAdjacentMigrationProof.t.sol` supplies an isolated versioned factory, registry and V3 implementation with a closed V1 → V2 → V3 transition set. It reuses the existing asset transfer and ledger handoff. Each hop independently requires creator consent, the exact candidate and source, fresh two-signer authorization and a two-day delay. The test checks holder and fee balances, both reserves, supply, economics, history, rollback and the ability to sell and claim on V3. The test factory has no graduation dependency or production entry point. Carry over the baseline's cancellation and expiry handling and prove graduation, runtime admission and indexer evidence for a future reviewed release build.

## Exact review inputs

- Anvil 1.7.1, Node 22, pnpm 10.12.1 and Solc 0.8.26 commit `8a97fa7a`. Cancun, via IR, optimizer runs 200 and IPFS metadata. The harness checks the platform compiler SHA-256 and each pinned dependency source. [Offline compiler inputs and transformations](../packages/contracts/scripts/validate-curve-graduation-4663.mjs)
- Uniswap v4-core `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` and v4-periphery `ad04c9f24a170accf5ea1b2836bbafd514537ca6`, including the pinned transitive OpenZeppelin files. The fork verifies the PoolManager, PositionManager, Permit2, Quoter, StateView and Universal Router 2.1.2 runtime hashes and their bindings. [Dependency pins](../packages/contracts/scripts/install-v4-deps.sh) · [Official deployments](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663)
- Canonical Robinhood 4663 block `113412054`, hash `0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2`. The public archive feeds read-only state. The Anvil execution endpoint is loopback. The archive proxy rejects its write probe with HTTP 403.
- Normalized Standard JSON SHA-256 for 1 ETH `266baf006fc84650fa22665f54b5b6407317eecc39ff41c20d307527909fc050`, 2 ETH `7aced9f6ea3ac7afc14336dce29db2cce1d13ecc0fba2026a1eb8c4c9131362b`, and 4.20 ETH `8ee3435f9c9acd16b459a76d2b428e3c449e9f194135eddf75afbaa8a8ca6dc9`. The latter two adjust only the offline economics input as recorded in their manifests. The 1 ETH control matches #587. The source manifest and runtime and creation-template hashes are included in each evidence JSON.

## Reproduction

Run the existing pinned dependency setup, then use the following commands with a checksum-matched Solc binary.

```sh
cd packages/contracts
bash scripts/install-v4-deps.sh
forge test --match-path 'test/{RMTLaunchMigrationReadiness,RMTLaunchAdjacentMigrationProof,RMTLaunchBondingCurveV1,RMTLaunchProjectRegistryV1,RMTLaunchHolderMigrationV1,RMTV4CurveGraduationV1}.t.sol'
cd ../..
pnpm --filter web test:local-launchpad
pnpm --filter web typecheck
pnpm audit --prod --audit-level high
for backing in 1000000000000000000 2000000000000000000 4200000000000000000; do
  node packages/contracts/scripts/validate-curve-graduation-4663.mjs \
    --anvil "$(command -v anvil)" --solc /absolute/path/to/solc-0.8.26 \
    --archive pocket --backing-wei "$backing" > "/tmp/rmt-curve-$backing.json" || exit
done
node packages/contracts/scripts/measure-curve-fee-gas-4663.mjs \
  --fork-evidence /tmp/rmt-curve-1000000000000000000.json \
  --fork-evidence /tmp/rmt-curve-2000000000000000000.json \
  --fork-evidence /tmp/rmt-curve-4200000000000000000.json > /tmp/rmt-curve-fees.json
node packages/contracts/scripts/simulate-launch-curve-terms.mjs \
  --fork-evidence /tmp/rmt-curve-1000000000000000000.json \
  --fork-evidence /tmp/rmt-curve-2000000000000000000.json \
  --fork-evidence /tmp/rmt-curve-4200000000000000000.json \
  --gas-evidence /tmp/rmt-curve-fees.json
```

Run the unchanged [security workflow command](../.github/workflows/security-analysis.yml) from `packages/contracts` for the full gate. The [economics report](RMT_CURVE_TASK020_ECONOMICS.md) distinguishes fork receipts, read-only Nitro estimates and demand assumptions.

## Owner and release gates

| Gate | Required evidence or decision |
| --- | --- |
| Independent review | Commission review of the exact build, including governance and fee recipient liveness, future migration authority, the 28 balance rows, historic parser gaps and deployment provenance. Retain the full severity gate. |
| Economics | Approve threshold, virtual parameters, supply, provisional 1% fee, creator and treasury allocations, provisional 5% operating and 5% future reserve shares, recipients and LP collection policy. Review 2 ETH first. |
| Providers and indexing | Establish independently operated 4663 archive and trace endpoints, EIP-1898 and bounded canonical traces, quotas, indexing persistence, deep-reorg response, backup replay, retention and support ownership. Hosted routing and indexing require observations for the exact authorized factory and full guarded PoolKey. |
| Ethereum finality | Pin the L1 inbox and chain contracts and verify the actual batch, data availability and finalized L1 block independently. Keep L2 observations unfinalized when evidence is absent or conflicting. |
| Wallet | Complete physical iPhone testing on an authorized isolated target, including network selection, signer prompts, approvals and interrupted or missing-hash recovery. Browser screenshots and injected wallets establish fixture behavior. |
| Dependencies | Current production dependency audit reported nine moderate and two low advisories. Review remediation or documented acceptance without silently changing pinned audit inputs. |
| Signers and incidents | Name independent signer operators, key continuity and replacement process, public notice monitoring, cancellation and suspension ownership. The review uses local fixture signers. |

[Production data readiness and failure policy](RMT_LAUNCH_PRODUCTION_DATA_READINESS.md) · [Robinhood Chain finality](https://docs.robinhood.com/chain/transaction-finality/)
