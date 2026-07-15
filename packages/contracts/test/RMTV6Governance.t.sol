// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV6Governance} from "../src/RMTV6Governance.sol";

interface RMTV6GovernanceVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function deal(address account, uint256 balance) external;
}

contract GovernanceCallTarget {
    uint256 public calls;
    uint256 public received;

    function record(uint256 amount) external payable returns (bytes32) {
        ++calls;
        received += msg.value;
        return keccak256(abi.encode(amount, msg.value));
    }
}

contract ReentrantGovernanceCallTarget {
    RMTV6Governance private immutable _governance;
    uint256 public nestedTransactionId;
    bool public nestedExecutionBlocked;

    constructor(RMTV6Governance governance_) {
        _governance = governance_;
    }

    function setNestedTransaction(uint256 transactionId) external {
        nestedTransactionId = transactionId;
    }

    function attemptNestedExecution() external {
        (bool success,) = address(_governance).call(abi.encodeCall(_governance.execute, (nestedTransactionId)));
        nestedExecutionBlocked = !success;
    }
}

contract RMTV6GovernanceTest {
    RMTV6GovernanceVm private constant vm = RMTV6GovernanceVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SECOND = address(0xBEEF);
    address private constant THIRD = address(0xCAFE);
    address private constant OUTSIDER = address(0xBAD);
    uint8 private constant ACTION_ADD = 1;
    uint8 private constant ACTION_REPLACE = 2;
    uint64 private constant DELAY = 1 days;
    uint64 private constant WINDOW = 7 days;

    function testStartsAsInspectableOneOfOneWithFixedTiming() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget target = new GovernanceCallTarget();
        bytes memory data = abi.encodeCall(target.record, (17));

        uint256 id = governance.propose(address(target), 0, data);
        RMTV6Governance.Transaction memory transaction = governance.getTransaction(id);

        require(governance.isSigner(address(this)), "initial signer missing");
        require(governance.signerCount() == 1, "wrong signer count");
        require(governance.threshold() == 1, "wrong threshold");
        require(governance.configurationEpoch() == 1, "wrong initial epoch");
        require(governance.executionDelay() == DELAY, "wrong delay");
        require(governance.executionWindow() == WINDOW, "wrong window");
        require(governance.transactionCount() == 1, "proposal not counted");
        require(transaction.proposer == address(this), "wrong proposer");
        require(transaction.target == address(target), "wrong target");
        require(keccak256(transaction.data) == keccak256(data), "call data hidden");
        require(transaction.executeAfter == block.timestamp + DELAY, "wrong earliest execution");
        require(transaction.executeBefore == transaction.executeAfter + WINDOW, "wrong expiry");
        require(transaction.configurationEpoch == 1, "wrong proposal epoch");
        require(transaction.confirmations == 1, "proposal not confirmed");
        require(governance.confirmedBy(id, address(this)), "confirmation not public");
    }

    function testRejectsZeroDelayOrWindow() public {
        try new RMTV6Governance(address(this), 0, WINDOW) returns (RMTV6Governance deployed) {
            require(address(deployed) == address(0), "zero-delay governance deployed");
        } catch {}
        try new RMTV6Governance(address(this), DELAY, 0) returns (RMTV6Governance deployed) {
            require(address(deployed) == address(0), "zero-window governance deployed");
        } catch {}
    }

    function testPermissionlessExecutionOnlyAfterDelay() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget target = new GovernanceCallTarget();
        uint256 id = governance.propose(address(target), 0, abi.encodeCall(target.record, (9)));

        vm.prank(OUTSIDER);
        (bool early,) = address(governance).call(abi.encodeCall(governance.execute, (id)));
        require(!early, "delay bypassed");

        vm.warp(block.timestamp + DELAY);
        vm.prank(OUTSIDER);
        bytes memory output = governance.execute(id);
        require(abi.decode(output, (bytes32)) == keccak256(abi.encode(uint256(9), uint256(0))), "wrong output");
        require(target.calls() == 1, "generic call did not execute");
    }

    function testGenericProposalCanTransferGovernanceEthButExecutorGetsNothing() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget target = new GovernanceCallTarget();
        vm.deal(address(governance), 3 ether);

        uint256 id = governance.propose(address(target), 2 ether, abi.encodeCall(target.record, (2)));
        vm.warp(block.timestamp + DELAY);
        vm.prank(OUTSIDER);
        governance.execute(id);

        require(target.received() == 2 ether, "target value missing");
        require(OUTSIDER.balance == 0, "executor received governance funds");
    }

    function testExecutionMutexBlocksCrossTransactionReentrancyWithoutDisablingPermissionlessExecution() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget nestedTarget = new GovernanceCallTarget();
        ReentrantGovernanceCallTarget outerTarget = new ReentrantGovernanceCallTarget(governance);

        uint256 nestedId = governance.propose(address(nestedTarget), 0, abi.encodeCall(nestedTarget.record, (99)));
        outerTarget.setNestedTransaction(nestedId);
        uint256 outerId =
            governance.propose(address(outerTarget), 0, abi.encodeCall(outerTarget.attemptNestedExecution, ()));

        vm.warp(block.timestamp + DELAY);
        vm.prank(OUTSIDER);
        governance.execute(outerId);

        require(outerTarget.nestedExecutionBlocked(), "nested execution was not blocked");
        require(nestedTarget.calls() == 0, "nested target executed reentrantly");
        RMTV6Governance.Transaction memory nestedTransaction = governance.getTransaction(nestedId);
        require(!nestedTransaction.executed, "nested transaction consumed");

        vm.prank(OUTSIDER);
        governance.execute(nestedId);
        require(nestedTarget.calls() == 1, "top-level permissionless execution blocked");
    }

    function testAddSignerAndThresholdTwoIsAtomicAndNeverOneOfTwo() public {
        RMTV6Governance governance = _newGovernance();
        _acceptSignerAddition(governance, SECOND, 2);

        uint256 unsafeId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 1))
        );
        vm.warp(block.timestamp + DELAY);
        (bool unsafeConfiguration,) = address(governance).call(abi.encodeCall(governance.execute, (unsafeId)));
        require(!unsafeConfiguration, "unsafe 1-of-2 accepted");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "partial signer transition");

        governance.cancel(unsafeId);
        uint256 addId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.warp(block.timestamp + DELAY);
        governance.execute(addId);

        require(governance.isSigner(SECOND), "second signer missing");
        require(governance.signerCount() == 2, "wrong signer count");
        require(governance.threshold() == 2, "threshold did not change atomically");
        require(governance.configurationEpoch() == 2, "epoch not advanced");
        require(_acceptanceEpoch(governance, SECOND) == 0, "acceptance not consumed");

        GovernanceCallTarget target = new GovernanceCallTarget();
        uint256 targetId = governance.propose(address(target), 0, abi.encodeCall(target.record, (1)));
        vm.warp(block.timestamp + DELAY);
        (bool oneOfTwo,) = address(governance).call(abi.encodeCall(governance.execute, (targetId)));
        require(!oneOfTwo, "one signer executed in 2-of-2");
        vm.prank(SECOND);
        governance.confirm(targetId);
        vm.prank(OUTSIDER);
        governance.execute(targetId);
        require(target.calls() == 1, "fully approved call did not execute");
    }

    function testAddSignerRejectsMissingOrWrongWalletAcceptance() public {
        RMTV6Governance governance = _newGovernance();
        _acceptSignerAddition(governance, THIRD, 2);

        uint256 addId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.warp(block.timestamp + DELAY);
        (bool addedWithoutAcceptance,) = address(governance).call(abi.encodeCall(governance.execute, (addId)));

        require(!addedWithoutAcceptance, "uncontrolled signer activated");
        require(!governance.isSigner(SECOND), "unaccepted signer recorded");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "failed add changed configuration");
        require(_acceptanceEpoch(governance, THIRD) == 1, "wrong-wallet acceptance consumed");
    }

    function testProspectiveSignerCanRevokeConsentBeforeExecution() public {
        RMTV6Governance governance = _newGovernance();
        _acceptSignerAddition(governance, SECOND, 2);
        uint64 acceptedEpoch = governance.configurationEpoch();

        uint256 addId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.prank(SECOND);
        governance.revokeSignerRoleAcceptance(acceptedEpoch);
        require(_acceptanceEpoch(governance, SECOND) == 0, "revoked acceptance remains");

        vm.warp(block.timestamp + DELAY);
        (bool addedAfterRevocation,) = address(governance).call(abi.encodeCall(governance.execute, (addId)));
        require(!addedAfterRevocation, "revoked candidate activated");
        require(!governance.isSigner(SECOND), "revoked signer recorded");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "revocation changed configuration");
        require(governance.configurationEpoch() == 1, "failed add advanced epoch");
    }

    function testSignerAcceptanceRevocationRejectsWrongOrMissingEpoch() public {
        RMTV6Governance governance = _newGovernance();
        _acceptSignerAddition(governance, SECOND, 2);

        vm.prank(SECOND);
        (bool wrongEpochRevoked,) =
            address(governance).call(abi.encodeCall(governance.revokeSignerRoleAcceptance, (uint64(2))));
        require(!wrongEpochRevoked, "wrong acceptance epoch revoked");
        require(_acceptanceEpoch(governance, SECOND) == 1, "acceptance changed after wrong epoch");

        vm.prank(THIRD);
        (bool missingAcceptanceRevoked,) =
            address(governance).call(abi.encodeCall(governance.revokeSignerRoleAcceptance, (uint64(1))));
        require(!missingAcceptanceRevoked, "missing acceptance revoked");
    }

    function testSignerAcceptanceCannotAuthorizeADifferentTransition() public {
        RMTV6Governance governance = _newGovernance();
        _acceptSignerAddition(governance, SECOND, 2);

        uint256 replaceId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.replaceSignerAndSetThreshold, (address(this), SECOND, 1))
        );
        vm.warp(block.timestamp + DELAY);
        (bool replacedWithAdditionConsent,) = address(governance).call(abi.encodeCall(governance.execute, (replaceId)));

        require(!replacedWithAdditionConsent, "addition consent authorized replacement");
        require(governance.isSigner(address(this)), "original signer removed");
        require(!governance.isSigner(SECOND), "candidate added through wrong action");
        require(_acceptanceEpoch(governance, SECOND) == 1, "mismatched consent consumed");
    }

    function testSignerAcceptanceExpires() public {
        RMTV6Governance governance = _newGovernance();
        uint64 epoch = governance.configurationEpoch();
        uint64 expiresAt = uint64(block.timestamp + DELAY);
        vm.prank(SECOND);
        governance.acceptSignerRole(epoch, ACTION_ADD, address(0), 2, expiresAt);

        uint256 addId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.warp(uint256(expiresAt) + 1);
        (bool addedAfterExpiry,) = address(governance).call(abi.encodeCall(governance.execute, (addId)));

        require(!addedAfterExpiry, "expired candidate activated");
        require(!governance.isSigner(SECOND), "expired signer recorded");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "expiry changed configuration");
    }

    function testSignerAcceptanceRejectsWrongEpochAndExpiresAfterConfigurationChange() public {
        RMTV6Governance governance = _newGovernance();
        uint64 futureEpoch = governance.configurationEpoch() + 1;

        vm.prank(SECOND);
        (bool futureEpochAccepted,) = address(governance)
            .call(
                abi.encodeCall(
                    governance.acceptSignerRole,
                    (futureEpoch, ACTION_ADD, address(0), 2, uint64(block.timestamp + DELAY + WINDOW))
                )
            );
        require(!futureEpochAccepted, "future epoch accepted");
        require(_acceptanceEpoch(governance, SECOND) == 0, "wrong epoch recorded");

        _acceptSignerAddition(governance, SECOND, 2);
        _acceptSignerReplacement(governance, THIRD, address(this), 1);
        uint256 replaceId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.replaceSignerAndSetThreshold, (address(this), THIRD, 1))
        );
        vm.warp(block.timestamp + DELAY);
        governance.execute(replaceId);
        require(governance.configurationEpoch() == 2, "replacement epoch missing");
        require(_acceptanceEpoch(governance, SECOND) == 1, "stale acceptance unexpectedly changed");

        vm.prank(THIRD);
        uint256 staleAddId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.warp(block.timestamp + DELAY);
        (bool staleAcceptanceUsed,) = address(governance).call(abi.encodeCall(governance.execute, (staleAddId)));
        require(!staleAcceptanceUsed, "stale acceptance activated signer");
        require(!governance.isSigner(SECOND), "stale signer recorded");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "stale add changed configuration");
    }

    function testRemoveSignerAndThresholdOneIsAtomic() public {
        RMTV6Governance governance = _newGovernance();
        _addSecondSigner(governance);

        uint256 removeId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.removeSignerAndSetThreshold, (SECOND, 1))
        );
        vm.prank(SECOND);
        governance.confirm(removeId);
        vm.warp(block.timestamp + DELAY);
        governance.execute(removeId);

        require(!governance.isSigner(SECOND), "removed signer remains active");
        require(governance.signerCount() == 1, "wrong remaining count");
        require(governance.threshold() == 1, "wrong remaining threshold");
        require(governance.configurationEpoch() == 3, "removal did not advance epoch");

        vm.prank(SECOND);
        (bool removedCanPropose,) =
            address(governance).call(abi.encodeCall(governance.propose, (address(governance), 0, bytes(""))));
        require(!removedCanPropose, "removed signer retained authority");
    }

    function testReplaceSignerRotatesSoleSignerAndInvalidatesOldAuthority() public {
        RMTV6Governance governance = _newGovernance();
        _acceptSignerReplacement(governance, SECOND, address(this), 1);
        uint256 replaceId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.replaceSignerAndSetThreshold, (address(this), SECOND, 1))
        );
        vm.warp(block.timestamp + DELAY);
        governance.execute(replaceId);

        require(!governance.isSigner(address(this)), "old signer retained authority");
        require(governance.isSigner(SECOND), "replacement signer missing");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "rotation changed shape");
        require(governance.configurationEpoch() == 2, "rotation did not advance epoch");
        require(_acceptanceEpoch(governance, SECOND) == 0, "replacement acceptance not consumed");

        (bool oldCanPropose,) =
            address(governance).call(abi.encodeCall(governance.propose, (address(governance), 0, bytes(""))));
        require(!oldCanPropose, "old signer can still propose");
        vm.prank(SECOND);
        governance.propose(address(governance), 0, "");
    }

    function testReplacementRejectsMissingAcceptance() public {
        RMTV6Governance governance = _newGovernance();
        uint256 replaceId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.replaceSignerAndSetThreshold, (address(this), SECOND, 1))
        );
        vm.warp(block.timestamp + DELAY);
        (bool replacedWithoutAcceptance,) = address(governance).call(abi.encodeCall(governance.execute, (replaceId)));

        require(!replacedWithoutAcceptance, "uncontrolled replacement activated");
        require(governance.isSigner(address(this)), "original signer removed");
        require(!governance.isSigner(SECOND), "unaccepted replacement recorded");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "failed replacement changed shape");
        require(governance.configurationEpoch() == 1, "failed replacement advanced epoch");
    }

    function testConsumedAcceptanceCannotBeReusedAfterSignerRemoval() public {
        RMTV6Governance governance = _newGovernance();
        _addSecondSigner(governance);
        require(_acceptanceEpoch(governance, SECOND) == 0, "initial acceptance remains");

        uint256 removeId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.removeSignerAndSetThreshold, (SECOND, 1))
        );
        vm.prank(SECOND);
        governance.confirm(removeId);
        vm.warp(block.timestamp + DELAY);
        governance.execute(removeId);
        require(governance.configurationEpoch() == 3, "removal epoch missing");

        uint256 readdId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.warp(block.timestamp + DELAY);
        (bool reusedAcceptance,) = address(governance).call(abi.encodeCall(governance.execute, (readdId)));
        require(!reusedAcceptance, "consumed acceptance reused");
        require(!governance.isSigner(SECOND), "removed signer reactivated");
        require(governance.signerCount() == 1 && governance.threshold() == 1, "reuse changed configuration");
    }

    function testConfigurationEpochPreventsStaleProposalRevival() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget target = new GovernanceCallTarget();
        _acceptSignerAddition(governance, SECOND, 2);

        uint256 staleId = governance.propose(address(target), 0, abi.encodeCall(target.record, (1)));
        uint256 addId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.warp(block.timestamp + DELAY);
        governance.execute(addId);

        (bool staleAtTwoOfTwo,) = address(governance).call(abi.encodeCall(governance.execute, (staleId)));
        require(!staleAtTwoOfTwo, "old-epoch proposal executed");

        uint256 removeId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.removeSignerAndSetThreshold, (SECOND, 1))
        );
        vm.prank(SECOND);
        governance.confirm(removeId);
        vm.warp(block.timestamp + DELAY);
        governance.execute(removeId);
        require(governance.configurationEpoch() == 3, "second transition missing");

        (bool staleRevived,) = address(governance).call(abi.encodeCall(governance.execute, (staleId)));
        require(!staleRevived, "old proposal revived after threshold returned to one");
        require(target.calls() == 0, "stale target was called");
    }

    function testSignerCanCancelPendingProposal() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget target = new GovernanceCallTarget();
        uint256 id = governance.propose(address(target), 0, abi.encodeCall(target.record, (1)));

        vm.prank(OUTSIDER);
        (bool outsiderCancelled,) = address(governance).call(abi.encodeCall(governance.cancel, (id)));
        require(!outsiderCancelled, "outsider cancelled proposal");

        governance.cancel(id);
        RMTV6Governance.Transaction memory transaction = governance.getTransaction(id);
        require(transaction.cancelled, "cancellation not visible");
        vm.warp(block.timestamp + DELAY);
        (bool executed,) = address(governance).call(abi.encodeCall(governance.execute, (id)));
        require(!executed, "cancelled proposal executed");
    }

    function testAnyCurrentSignerCanCancelPendingProposal() public {
        RMTV6Governance governance = _newGovernance();
        _addSecondSigner(governance);
        GovernanceCallTarget target = new GovernanceCallTarget();
        uint256 id = governance.propose(address(target), 0, abi.encodeCall(target.record, (1)));

        vm.prank(SECOND);
        governance.cancel(id);
        RMTV6Governance.Transaction memory transaction = governance.getTransaction(id);
        require(transaction.cancelled, "second signer could not cancel");
    }

    function testProposalExpiresAfterFixedWindow() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget target = new GovernanceCallTarget();
        uint256 id = governance.propose(address(target), 0, abi.encodeCall(target.record, (1)));
        RMTV6Governance.Transaction memory transaction = governance.getTransaction(id);

        vm.warp(uint256(transaction.executeBefore) + 1);
        (bool executed,) = address(governance).call(abi.encodeCall(governance.execute, (id)));
        require(!executed, "expired proposal executed");
        (bool cancelled,) = address(governance).call(abi.encodeCall(governance.cancel, (id)));
        require(!cancelled, "expired proposal remained pending");
        require(target.calls() == 0, "expired target was called");
    }

    function testExecutionAtLastWindowSecondIsAllowed() public {
        RMTV6Governance governance = _newGovernance();
        GovernanceCallTarget target = new GovernanceCallTarget();
        uint256 id = governance.propose(address(target), 0, abi.encodeCall(target.record, (1)));
        RMTV6Governance.Transaction memory transaction = governance.getTransaction(id);

        vm.warp(transaction.executeBefore);
        vm.prank(OUTSIDER);
        governance.execute(id);
        require(target.calls() == 1, "last valid second rejected");
    }

    function testMultiSignerReplacementRequiresFullCurrentApproval() public {
        RMTV6Governance governance = _newGovernance();
        _addSecondSigner(governance);
        _acceptSignerReplacement(governance, THIRD, SECOND, 2);

        uint256 replaceId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.replaceSignerAndSetThreshold, (SECOND, THIRD, 2))
        );
        vm.warp(block.timestamp + DELAY);
        (bool oneApproval,) = address(governance).call(abi.encodeCall(governance.execute, (replaceId)));
        require(!oneApproval, "replacement bypassed threshold");

        vm.prank(SECOND);
        governance.confirm(replaceId);
        governance.execute(replaceId);
        require(!governance.isSigner(SECOND) && governance.isSigner(THIRD), "replacement failed");
        require(governance.threshold() == 2 && governance.configurationEpoch() == 3, "wrong replacement config");
    }

    function _newGovernance() private returns (RMTV6Governance) {
        return new RMTV6Governance(address(this), DELAY, WINDOW);
    }

    function _addSecondSigner(RMTV6Governance governance) private {
        _acceptSignerAddition(governance, SECOND, 2);
        uint256 id = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSignerAndSetThreshold, (SECOND, 2))
        );
        vm.warp(block.timestamp + DELAY);
        governance.execute(id);
    }

    function _acceptSignerAddition(RMTV6Governance governance, address signer, uint256 nextThreshold) private {
        uint64 epoch = governance.configurationEpoch();
        vm.prank(signer);
        governance.acceptSignerRole(
            epoch, ACTION_ADD, address(0), nextThreshold, uint64(block.timestamp + DELAY + WINDOW)
        );
    }

    function _acceptSignerReplacement(
        RMTV6Governance governance,
        address signer,
        address currentSigner,
        uint256 nextThreshold
    ) private {
        uint64 epoch = governance.configurationEpoch();
        vm.prank(signer);
        governance.acceptSignerRole(
            epoch, ACTION_REPLACE, currentSigner, nextThreshold, uint64(block.timestamp + DELAY + WINDOW)
        );
    }

    function _acceptanceEpoch(RMTV6Governance governance, address signer) private view returns (uint64 epoch) {
        (epoch,,,,) = governance.signerRoleAcceptances(signer);
    }
}
