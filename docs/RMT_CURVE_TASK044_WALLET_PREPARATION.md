# RMT Launch governance wallets and Safe treasuries

This preparation implements [#617](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/617) for [#611](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/611), stacked on [#616](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/616) at 891f3e45560410a901e6fffff47ac1f615173cce. The frozen contract candidate is d4d81d1153a11728d98e694c1f3976ceb3408915. **BLOCKED_NO_BROADCAST** and the failed exact 4663 Slither gate remain in effect. The [release manifest](evidence/rmt-task041-closeout/release-manifest.json) retains all 22 high findings, including 18 active-engine and four dependency findings.

## Proposed governance identities

| Owner label | EIP-55 address | 4663 account eligibility |
| --- | --- | --- |
| RMT-GOV-01 | 0xC447A378cFd8460Febc2eef67501D7a5473B9001 | Code empty, eligible at the observation block |
| RMT-GOV-02 | 0xC3600f2Df60929D2AB9ab294CFF42EEDCB984f51 | Code empty, eligible at the observation block |
| RMT-GOV-03 | 0x2Bcc3fAfCE77cCc7fdBED46E0B5bb80bA3E76697 | Code empty, eligible at the observation block |

The supplied strings each encode 20 bytes. EIP-55 changes their display capitalization and preserves their bytes. The official endpoint and Pinax corroborated chain 4663, block **114738660**, and block hash **0x8f3b3f2894f5d4d3f5fd8b462b10a6d38877ab2a3cff9acd8274e01ca563ef5e**. Both returned empty code for all three, with no delegation designation observed at that block. All three are distinct and above the directory's reserved address range. This satisfies the frozen directory's code and address checks for its 2-of-3 policy. Key control, device operation and L1 finality remain unverified. [Pinned RPC evidence](evidence/rmt-task044/governance-wallets.json)

The owner reports separate backups for the three Rabby wallets, currently held on one phone. The backups give separate key recovery paths. A compromise or loss of that phone can affect multiple signers at once. The owner accepts this shared-device exposure for preparation. The final continuity and incident assignments remain open. [Exact directory policy](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol) · [Owner instruction and public addresses](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/617)

The [provisional overlay](evidence/rmt-task044/provisional-owner-inputs.json) binds only these three public signer addresses. It carries no approval reference and is rejected as input by the production preflight. The [canonical owner sheet](evidence/rmt-task041-closeout/owner-inputs.json) remains the single approval record.

## Separate treasury proposals

| Proposal | Committed source | Spending and accounting |
| --- | --- | --- |
| RMT-OPERATIONS | Factory creation-fee revenue plus 5% of eligible curve fees and fees earned by the original locked v4 positions | Safe threshold approval for approved expenses and transfers. Record creation fees, curve ETH and LP ETH/ERC-20 separately. |
| RMT-RESERVE | Separate 5% share of those eligible curve and original-position fees | A separate Safe, ledger and approval record. Choose stronger effective approval coverage for reserve spending and require a documented reserve purpose before each transfer. |

The [machine-readable proposals](evidence/rmt-task044/safe-treasury-plans.json) leave both Safe addresses, owner lists, thresholds, salts and gas payers unassigned. **SafeL2 1.4.1** is the proposed profile based on the fork evidence. The configuration uses the verified standard singleton, factory and compatibility handler, with no setup delegatecall, modules, guard or setup payment. Reserve's additional review is an operating policy. Its eventual on-chain control comes from the selected Safe owners and threshold. The Safe hosted client recommends **1.5.0** on chain 4663. Both versions' canonical runtimes matched. A switch to 1.5.0 requires equivalent claims and transfer tests. [Safe infrastructure and cost evidence](RMT_CURVE_TASK044_SAFE_INFRASTRUCTURE.md)

The project share remains 90%, with each existing project payout policy, token, balances and original LP custody preserved. LAMMB royalty settings remain independent. A later spending transfer is a separately authorized transaction of the relevant Safe.

## Owner walkthrough

1. Choose the owners, threshold and operator for each treasury separately. Give the Reserve distinct controls and keep its funds and approvals separate from daily operating expenses. Confirm custody and recovery arrangements for both owner sets. Approve the Safe version and network before preparing any setup.
2. On the official Safe wallet tooling, select Robinhood Chain **4663** and inspect the exact factory, singleton, compatibility handler and transaction format. Check the supported connection method before relying on a phone. If the tool offers a different version, qualify its exact runtime and execution path before choosing it. [Safe infrastructure and hosted support](RMT_CURVE_TASK044_SAFE_INFRASTRUCTURE.md)
3. For future separately authorized creation, construct the initializer with the selected native Safe owners and threshold. Derive each address using the reviewed factory method, initializer and distinct confirmed salt. Check for address collision and existing code. Review the creation cost with the designated gas payer, then verify the eventual canonical ProxyCreation receipt, proxy runtime, singleton, owner set, threshold, fallback, empty module list and guard configuration.
4. Require both wallets to be created, separately owned and able to execute their own claims before entering their addresses into the canonical RMT approval sheet. A predicted Safe address can strand immutable fee entitlements if its actual deployment, owner set or claim capability diverges. The factory and fee ledgers have permanent beneficiary bindings.
5. Select one dedicated deployment EOA. Supply its public address after confirming control and chain-4663 code-empty eligibility. Assign exclusive use of that account to the release operator across both governance notice windows. The closeout tool reads latest and pending nonce directly and aborts on drift. [Input and nonce procedure](RMT_CURVE_TASK041_RELEASE_CLOSEOUT.md)

## Claim and transfer procedure

Use the Safe Transaction Builder or reviewed equivalent with the exact chain, Safe address, ledger address, ABI, call and zero ETH value. For the RMT receipt-proof profile, propose a single ordinary CALL with no gas refund or delegatecall. Verify the exact destination, calldata and Safe nonce in each owner review. An authorized executor supplies transaction gas. Gas payer, reimbursement policy and any spending remain separate owner decisions.

| Action | Contract and signer |
| --- | --- |
| Release factory creation fees | Call claimCreationFees() on the pinned factory. Any caller may trigger payment. The immutable Operations Safe receives the ETH. Verify the factory event, native settlement and balance credit. |
| Claim curve fees | The credited Safe executes claim() on the exact launch's immutable curve fee ledger. Check the claimable ETH first and attribute the settlement to the Safe beneficiary. |
| Claim v4 position fees | Once earned fees have been collected, the credited Safe executes claim() on the exact launch's original-position LP fee ledger. For a single asset use claimAsset(true) for ETH or claimAsset(false) for the launch ERC-20. Verify the actual asset transfer, remaining credit and unchanged position principal. |
| Spend after a claim | Use a separate Safe-approved ETH or ERC-20 transfer with its own recipient, amount and receipt. Record either the Operations expense or the Reserve decision, using the respective Safe's transaction history. |

Safe Transaction Service history can show proposals and confirmations for a supported account. Attribute settlement from the canonical receipt, exact beneficiary and asset evidence. Separate the Safe transaction hash from the mined transaction hash, and reconcile both before retrying. Physical-wallet acceptance remains open.

## Gas and release boundary

The pinned read-only SafeL2 1.4.1 quote was **313,391 gas** or **0.000006274714602 ETH** for one synthetic 2-of-3 setup. Two identical setups would total **0.000012549429204 ETH** at that quote. Actual Safe policies remain unassigned. Re-estimate both setups using the approved inputs, prevailing gas price and applicable L1 data fee. [Measurements for both Safe versions](RMT_CURVE_TASK044_SAFE_INFRASTRUCTURE.md#gas-estimates)

The previous RMT launch-contract rehearsal used **22,617,164 gas units** across nine transactions. Its constructor bindings and calldata used fixture identities. The approved treasury addresses, dedicated deployer and its current nonce are needed to rederive the exact runtime identities and obtain an input-specific estimate. [Frozen profile measurements](evidence/rmt-task043/4663-rotation-deployment-measurements.json)

## Verification and replay

The focused Foundry Directory V2 and Registry V2 suites passed **17 tests**. The Node checks passed **28 tests**, including governance address checks, the proposed inputs, Safe infrastructure evidence, unsigned-plan and nonce validation, typed-data domains and binding to the failed release gate. The Windows release-manifest test now normalizes its input before constructing the CRLF fixture, so the original hash assertion exercises the intended line endings.

On a loopback-only Anvil 1.7.1 fork pinned to Robinhood block **114549452**, the project treasury regression used an actual synthetic-owner Safe 1.4.1 and a 25% project-treasury allocation. Signed governance rotation invalidated an obsolete migration authorization, and a new approval epoch executed the re-proposed same-token migration. The run exercised curve and LP claims, both v4 swaps, native and ERC-20 outgoing transfers, insufficient signatures, replay rejection and unchanged locked principal. The upstream write probe received HTTP 403. [Project Safe receipts](evidence/rmt-task044/4663-project-safe-regression.json)

The separate platform rehearsal used a synthetic **2-of-3 Operations Safe** and **3-of-3 Reserve Safe** on the same fork. Its six distinct test owners authorized both treasuries' curve and LP claims, including combined and single-asset claims, and signed outgoing ETH and token transfers. Insufficient signatures and replay failed. The **0.0004 ETH** creation fee reached only Operations, with an exact native trace and an unchanged Reserve balance. The curve and LP fee distributions matched the retained EOA control case, including rounding, and the LP position stayed locked. Creating the two local Safe proxies used **305,811** and **305,799** gas respectively. These thresholds, addresses and costs belong to the test fixtures. [Platform Safe receipts](evidence/rmt-task044/4663-platform-safe-rehearsal.json)

Run these from the Task 044 checkout. Use the existing separate checkout at `8dca5773cbd4dc98f52a45616f420bce96b000f0` with pinned pnpm dependencies installed, Anvil **1.7.1**, the checksum-verified native Solidity **0.8.26** compiler, and the pinned Foundry libraries. Replace the tool paths for your environment.

```powershell
$env:RMT_DEPLOYMENT_TEST_CHECKOUT = "../rmt-task026-acceptance"
$anvil = "C:/path/to/anvil.exe"
$solc = "C:/path/to/solc-0.8.26.exe"
node --test docs/evidence/rmt-task044/preparation.test.mjs docs/evidence/rmt-task044/governance-wallets.test.mjs docs/evidence/rmt-task041-closeout/closeout.test.mjs docs/evidence/rmt-task041-closeout/preflight.test.mjs docs/evidence/rmt-task043/deploy-rotation.test.mjs
node docs/evidence/rmt-task044/governance-wallets.mjs --checkout $env:RMT_DEPLOYMENT_TEST_CHECKOUT
node docs/evidence/rmt-task043/run-rotation-fork.mjs --checkout $env:RMT_DEPLOYMENT_TEST_CHECKOUT --anvil $anvil --solc $solc --lib packages/contracts/lib --archive pinax --safe-only
node docs/evidence/rmt-task044/run-platform-safe-fork.mjs --checkout $env:RMT_DEPLOYMENT_TEST_CHECKOUT --anvil $anvil --solc $solc --lib packages/contracts/lib --archive pinax
```

The governance verifier restricts upstream calls to chain ID, block and code reads. The command above binds a fresh shared block. To request the exact original anchor, pass `--block 114738660` and its matching `--block-hash`. Later reads of that block encountered Pinax's HTTP 429 limit and the official endpoint's historical-state unavailability. Both providers confirmed empty code again at fresh block **114745436**. Fork rehearsals use public synthetic keys and their own test identities only. [Both observations and provider limits](evidence/rmt-task044/governance-wallets.json)

## Remaining owner decisions

- Choose both Safe owner sets, thresholds, version and gas payers, with stronger Reserve approval coverage.
- Supply a dedicated deployer public address and confirm governance and treasury control before assigning them to the canonical owner sheet.
- Explicitly approve the economic terms and name the signer-continuity and incident operators.
- Resolve the existing release findings and confirm production archive and trace capacity, independent L1 finality, indexing and hosted wallet acceptance. Safe creation, launch-contract deployment, funded acceptance and public activation require their own authorizations.
