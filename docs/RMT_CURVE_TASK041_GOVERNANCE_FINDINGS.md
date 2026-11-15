# Governance medium-finding dispositions

Review basis is [#615 at `d4d81d1153a11728d98e694c1f3976ceb3408915`](https://github.com/LandoCrissian/robinhood-meme-terminal/tree/d4d81d1153a11728d98e694c1f3976ceb3408915), the 66-source deployment profile `rmt-curve-v1-4663-governance-rotation-v2`, and compiler input SHA-256 `90122536b22c847aebc0182d75290b9ba281399481d90daffc8b0f66ed92f65b`. Slither 0.11.5 with Crytic Compile 0.3.11 classified all seven rows below as medium impact. The review establishes **six internally assessed false positives, one unresolved observation, and zero confirmed defects**. These are internal dispositions. All detector findings and the failed release gate remain recorded. [Compiler profile](evidence/rmt-task043/4663-rotation-profile.json) · [Complete 4663 report](evidence/rmt-task043/slither-4663-full.json.gz)

## Directory V2

Each `incorrect-equality` row has high detector confidence and medium impact. In these six paths, the equality operates on an empty-slot sentinel, a digest, or the exact fields of a signed action. These checks read authorization storage and the chain clock. The only writers of the pending slots are the authenticated schedule paths and the matching clear paths. The typed action schemas and the pinned OpenZeppelin EIP-712 domain bind the message type, chain ID and verifying contract. Date comparisons intentionally keep the last eligible second executable and open permissionless clearing after it. The remaining uncertainties are stated per row. [Directory source](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol#L19) · [Pinned dependency source hashes](evidence/rmt-task043/4663-rotation-profile.json)

### `cancel`

Slither ID `3cd51805fd1434fbebe83c5d8ccea7221aa34f6a344f02c5e05d0f116deb762e`. Detector `incorrect-equality`, `packages/contracts/src/RMTLaunchCurveDirectoryV2.sol:194–202`, flagged predicate at `197–198`. [Exact source](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol#L194)

**Internally assessed false positive.** Accidental cancellation of a different action could erase a valid publication or resume. The function requires a nonempty pending slot and an exact target digest in `action.runtimeHash`, with the cancel action's version and factory encoded as zero. `_authorize` at `351–369` then checks the current nonce, epoch, deadline and two distinct eligible signers. The direct `testCloseoutOrdinaryCancellationRequiresExactDigestAndQuorum` check rejects a wrong digest with two valid signatures and a duplicate signer on the right digest. It confirms the accepted cancellation consumes only the ordinary action nonce and prevents execution of the old publication. Submission ordering between an eligible execution and an authorized cancellation remains a same-block race governed by which transaction commits first.

### `clearExpiredRotation`

Slither ID `482a490313e8d48b48c19d58b0081dc965f2f40c25196cde75c93b6d0fa786fe`. Detector `incorrect-equality`, `packages/contracts/src/RMTLaunchCurveDirectoryV2.sol:303–308`, flagged predicate at `305`. [Exact source](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol#L303)

**Internally assessed false positive.** A permissionless clearing call could otherwise consume an unexpired rotation. The stored zero digest means no scheduled rotation. The timestamp gate preserves the proposal through its recorded expiry. `testCancellationAndExpiryConsumeRotationNonceWithoutEpochChange` tests rejection at the expiry second, execution rejection immediately afterward, permissionless clearing, nonce consumption and unchanged signer epoch. The boundary was exercised with a synthetic clock, and live transaction inclusion and ordering around expiry remain operational dependencies. [Pinned test](../packages/contracts/test/RMTLaunchCurveDirectoryV2.t.sol#L134)

### `cancelSignerRotation`

Slither ID `6b197e5f0cda483c73a57c88133a65b6b09ce7aca23e68695d186143eb1f223f`. Detector `incorrect-equality`, `packages/contracts/src/RMTLaunchCurveDirectoryV2.sol:288–301`, flagged predicate at `294–296`. [Exact source](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol#L288)

**Internally assessed false positive.** A stale cancellation or a cancellation of a different replacement could disrupt governance recovery. The exact pending digest, epoch, rotation nonce and deadline are checked before verifying two current signers over the dedicated cancellation schema. `testCloseoutRotationRequiresExactPendingAndCancellationDigests` rejects a wrong digest carrying two valid signatures. `testCancellationAndExpiryConsumeRotationNonceWithoutEpochChange` covers duplicate signer rejection and successful cancellation. Timely delivery of a valid cancellation before a competing eligible execution remains operational. [Pinned test](../packages/contracts/test/RMTLaunchCurveDirectoryV2.t.sol#L134)

### `clearExpired`

Slither ID `8842e601802f78aadd94d70c0377a6faefece97a1c6a415cd0ff177215826787`. Detector `incorrect-equality`, `packages/contracts/src/RMTLaunchCurveDirectoryV2.sol:204–207`, flagged predicate at `205`. [Exact source](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol#L204)

**Internally assessed false positive.** Premature public clearing could erase a valid scheduled action. Reading a zero digest distinguishes the empty slot. Clearing a populated slot requires a timestamp strictly greater than `expiresAt`. `testCloseoutOrdinaryExpiryOpensStrictlyAfterExpiry` exercises the empty slot, equality at expiry, execution failure just after expiry, permissionless clearing and the separate ordinary nonce. Live keeper availability and inclusion time remain operational dependencies.

### `execute`

Slither ID `a3c49d47c8df04d59e47a5e0988a80b9ba5469cf2a58fbaabd2bdded6e55276e`. Detector `incorrect-equality`, `packages/contracts/src/RMTLaunchCurveDirectoryV2.sol:161–183`, flagged predicate at `164–166`. [Exact source](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol#L161)

**Internally assessed false positive.** An execution with an altered payload, old signer epoch or expired window could apply a publication or resume without its effective authorization. The pending digest must exactly match the EIP-712 action, nonce and epoch must still match, and the block must fit the stored window. Factory and migration-template identity checks run again on publication. `testCloseoutOrdinaryExecutionRequiresExactPendingDigest` rejects a changed deadline after notice and executes the original action. The pinned `testRotationInvalidatesPendingPublicationAndReaddedKeyCannotReplay` and `testRotationDuringSuspensionPreservesPauseAndFreshResumeDelay` cover stale authorization and renewed notice. The internal assessment relies on the cryptographic digest binding and the pinned publication targets. Other future governance payloads and dependency changes fall outside these tests. [Pinned publication and resume tests](../packages/contracts/test/RMTLaunchCurveDirectoryV2.t.sol#L184)

### `executeSignerRotation`

Slither ID `bdc7359b9bc3e2006ce9ba0a98584a7fa503daacb6784159255ec183e4813962`. Detector `incorrect-equality`, `packages/contracts/src/RMTLaunchCurveDirectoryV2.sol:271–286`, flagged predicate at `274–275`. [Exact source](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol#L271)

**Internally assessed false positive.** Replacing the incoming signer or extending the deadline after scheduling could bypass the accepted rotation. The exact stored digest binds every rotation field. `_validateRotation` repeats the membership, account eligibility, deadline, epoch and rotation nonce checks. `testCloseoutRotationRequiresExactPendingAndCancellationDigests` confirms a changed deadline reverts after notice and the original rotation succeeds. The pinned `testOtherTwoSignersReplaceUnavailableMemberAfterNotice` and `testIncomingAccountTypeIsRecheckedAtExecution` cover early execution, replay and a change in incoming account eligibility. Live signing-key control, authorized relayer operations and timely execution still require the owner ceremony. [Pinned rotation timing test](../packages/contracts/test/RMTLaunchCurveDirectoryV2.t.sol#L36) · [Pinned eligibility test](../packages/contracts/test/RMTLaunchCurveDirectoryV2.t.sol#L107)

## Project Registry V2

### `executeMigration`

Slither ID `5793500c59f4c62b9749c976e52e0c4a1768c3db465138aed73a0840ad2cd1b3`. Detector `reentrancy-no-eth`, medium confidence and medium impact. The source is `packages/contracts/src/RMTLaunchProjectRegistryV2.sol:179–224`. The external factory call is at `199`, and `item.version`, `item.engine` and `item.curve` are written at `219–221`. Slither also names the public `project` getter at `67`, `_migrationDigest` at `140–157`, and `nextMigrationVersion` at `280–290` as read paths. [Exact source](../packages/contracts/src/RMTLaunchProjectRegistryV2.sol#L179)

**Unresolved observation.** Migration intentionally leaves the old project pointer in storage until settlement checks pass. A nested caller could observe that old pointer during settlement. The write paths are guarded by the pinned OpenZeppelin `ReentrancyGuard`, and `_consume` deletes the proposal and increments its nonce before the factory call. The pinned factory admits only the bound registry and the exact candidate runtime, then checks the adjacent version and migration commitment. The pinned curve moves the tracked inventory, backing and accrual and validates the balance changes and successor state. The registry rechecks suspension, the signer epoch and the factory, old-curve and successor state after return before publishing the new pointer. The observed call and delayed state publication are real. The exact pinned paths reviewed establish no concrete unsafe state transition. [Registry authorization consumption](../packages/contracts/src/RMTLaunchProjectRegistryV2.sol#L292) · [Pinned factory source](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/RMTLaunchCurveFactoryV1.sol#L215) · [Pinned curve settlement](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/RMTLaunchBondingCurveV1.sol#L167)

`testSettlementCannotCommitIfFixtureExecutesMatureRotationInCallback` forces a mature directory rotation within the factory callback and verifies rollback of signer epoch, proposal, nonce and original project state. With the callback removed, the migration and later rotation succeed. The separate pinned-loopback 4663 receipts cite the real factory and successors and show preserved backing and claims. The test models a rotation callback, so read-only reentrancy across all consumers, alternative admitted successor code and dependencies, and callback composition remain open. The accompanying low-severity history-write finding in the full report also remains visible. [Callback test](../packages/contracts/test/RMTLaunchProjectRegistryV2.t.sol#L261) · [Real fork receipts](evidence/rmt-task043/4663-rotation-treasury-matrix.json)

## Evidence and gate

The historical 18 active-engine highs retain their internally investigated and independently unresolved dispositions. The four dependency highs remain open. The exact 4663 gate continues to fail with **22 highs**. Repository-scoped CI applies a different source scope. The historical Windows run of 505 passed, one failed and one skipped retains its separate V3 metadata-hash failure outside the 4663 closure. [Active findings](RMT_CURVE_TASK039_FINDINGS.md) · [Prior dispositions](RMT_CURVE_TASK040_REVIEW.md) · [Legacy Windows metadata evidence](evidence/rmt-task041/legacy-v3-bytecode.json)

Reproduced with Forge 1.7.1 and the pinned Windows Solidity 0.8.26 compiler, SHA-256 `537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67`. The 17 original focused tests passed. Four additional signed tests passed in an isolated scratch fixture with the deployment source unchanged. The fixture uses the existing deterministic synthetic signer keys. The snippet below applies to a scratch copy of the exact #615 test contract. Fork and Foundry time advancement serve as evidence about on-chain boundary logic. Production still requires the actual notice and execution intervals.

<details>
<summary>Reproduce the four additional test cases</summary>

In a disposable copy of `packages/contracts` at the pinned commit, use the existing pinned dependencies and original profile. Insert these functions before the closing brace of `RMTLaunchCurveDirectoryV2Test` in `test/RMTLaunchCurveDirectoryV2.t.sol`.

```solidity
    function testCloseoutOrdinaryCancellationRequiresExactDigestAndQuorum() public {
        Directory.Action memory publication = _publication();
        _schedule(publication, A, B);
        (bytes32 pending,,) = directory.pending();
        Directory.Action memory cancel = _action(Directory.ActionKind.Cancel);
        cancel.runtimeHash = bytes32(uint256(pending) ^ 1);
        bytes32 digest = directory.actionDigest(cancel);
        bytes memory first = _sign(A, digest);
        bytes memory second = _sign(B, digest);
        vm.expectRevert(Directory.InvalidAction.selector);
        directory.cancel(cancel, first, second);

        cancel.runtimeHash = pending;
        digest = directory.actionDigest(cancel);
        first = _sign(A, digest);
        second = _sign(B, digest);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.cancel(cancel, first, first);
        directory.cancel(cancel, first, second);
        (bytes32 cleared,,) = directory.pending();
        assertEq(cleared, bytes32(0));
        assertEq(directory.nonce(), 1);
        assertEq(directory.rotationNonce(), 0);
        assertEq(directory.signerSetEpoch(), 1);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(publication);
    }

    function testCloseoutOrdinaryExpiryOpensStrictlyAfterExpiry() public {
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.clearExpired();
        Directory.Action memory publication = _publication();
        _schedule(publication, A, B);
        (,, uint48 expiry) = directory.pending();
        vm.warp(expiry);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.clearExpired();
        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(publication);
        directory.clearExpired();
        (bytes32 cleared,,) = directory.pending();
        assertEq(cleared, bytes32(0));
        assertEq(directory.nonce(), 1);
        assertEq(directory.rotationNonce(), 0);
        assertEq(directory.signerSetEpoch(), 1);
    }

    function testCloseoutOrdinaryExecutionRequiresExactPendingDigest() public {
        Directory.Action memory publication = _publication();
        _schedule(publication, A, B);
        Directory.Action memory altered = _publication();
        altered.deadline += 1;
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(altered);
        directory.execute(publication);
        assertEq(directory.currentFactory().factory, factory);
    }

    function testCloseoutRotationRequiresExactPendingAndCancellationDigests() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        _scheduleRotation(rotation, B, C, D);
        bytes32 pending = directory.signerRotationDigest(rotation);
        Directory.RotationCancellation memory cancel = Directory.RotationCancellation(
            bytes32(uint256(pending) ^ 1),
            directory.signerSetEpoch(),
            directory.rotationNonce(),
            rotation.deadline
        );
        bytes32 digest = directory.rotationCancellationDigest(cancel);
        bytes memory first = _sign(B, digest);
        bytes memory second = _sign(C, digest);
        vm.expectRevert(Directory.InvalidRotation.selector);
        directory.cancelSignerRotation(cancel, first, second);

        Directory.SignerRotation memory altered = _rotation(signerA, signerD);
        altered.deadline += 1;
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.executeSignerRotation(altered);
        directory.executeSignerRotation(rotation);
        assertEq(directory.signerSetEpoch(), 2);
    }
```

Run these commands from the disposable contract directory with `PINNED_SOLC` set to the verified native compiler.

```sh
forge test --offline --use "$PINNED_SOLC" --match-contract '^(RMTLaunchCurveDirectoryV2Test|RMTLaunchProjectRegistryV2Test)$' --no-match-test '^testCloseout' -vv
forge test --offline --use "$PINNED_SOLC" --match-test '^testCloseout' -vv
```

</details>
