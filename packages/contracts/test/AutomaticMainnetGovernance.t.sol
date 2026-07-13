// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ProtocolPurposeVault} from "../src/ProtocolPurposeVault.sol";
import {TwoOfThreeTimelock} from "../src/TwoOfThreeTimelock.sol";

interface AutomaticGovernanceVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract GovernanceCallReceiver {
    uint256 public value;
    uint256 public received;

    function setValue(uint256 value_) external payable {
        value = value_;
        received += msg.value;
    }

    receive() external payable {
        received += msg.value;
    }
}

contract ReentrantGovernanceReceiver {
    TwoOfThreeTimelock private immutable governance;
    uint256 public nestedTransactionId;
    bool public nestedExecutionBlocked;

    constructor(TwoOfThreeTimelock governance_) {
        governance = governance_;
    }

    function setNestedTransaction(uint256 transactionId) external {
        nestedTransactionId = transactionId;
    }

    function attemptNestedExecution() external {
        (bool success,) =
            address(governance).call(abi.encodeCall(governance.execute, (nestedTransactionId)));
        nestedExecutionBlocked = !success;
    }
}

contract AutomaticMainnetGovernanceTest {
    AutomaticGovernanceVm private constant vm =
        AutomaticGovernanceVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SIGNER_ONE = address(0x1001);
    address private constant SIGNER_TWO = address(0x1002);
    address private constant SIGNER_THREE = address(0x1003);
    address private constant REPLACEMENT = address(0x1004);
    bytes32 private constant TREASURY_PURPOSE = keccak256("PROTOCOL_TREASURY");

    TwoOfThreeTimelock private governance;

    function setUp() public {
        vm.deal(address(this), 10 ether);
        governance = new TwoOfThreeTimelock([SIGNER_ONE, SIGNER_TWO, SIGNER_THREE], 1 days);
    }

    function testTwoIndependentConfirmationsAndDelayAreRequired() public {
        GovernanceCallReceiver receiver = new GovernanceCallReceiver();

        vm.prank(SIGNER_ONE);
        uint256 transactionId =
            governance.propose(address(receiver), 0.25 ether, abi.encodeCall(receiver.setValue, (42)));

        (bool oneSignerExecuted,) =
            address(governance).call(abi.encodeCall(governance.execute, (transactionId)));
        require(!oneSignerExecuted, "one signer executed");

        vm.prank(SIGNER_TWO);
        governance.confirm(transactionId);

        (bool earlyExecuted,) =
            address(governance).call(abi.encodeCall(governance.execute, (transactionId)));
        require(!earlyExecuted, "delay bypassed");

        vm.deal(address(governance), 1 ether);
        vm.warp(block.timestamp + 1 days);
        governance.execute(transactionId);

        require(receiver.value() == 42, "target call");
        require(receiver.received() == 0.25 ether, "value transfer");
        (,,,, bool executed,,) = governance.getTransaction(transactionId);
        require(executed, "execution state");
    }

    function testExecutionMutexBlocksCrossTransactionReentrancy() public {
        ReentrantGovernanceReceiver receiver = new ReentrantGovernanceReceiver(governance);
        GovernanceCallReceiver secondTarget = new GovernanceCallReceiver();

        vm.prank(SIGNER_ONE);
        uint256 nestedId =
            governance.propose(address(secondTarget), 0, abi.encodeCall(secondTarget.setValue, (99)));
        vm.prank(SIGNER_TWO);
        governance.confirm(nestedId);
        receiver.setNestedTransaction(nestedId);

        vm.prank(SIGNER_ONE);
        uint256 outerId =
            governance.propose(address(receiver), 0, abi.encodeCall(receiver.attemptNestedExecution, ()));
        vm.prank(SIGNER_THREE);
        governance.confirm(outerId);

        vm.warp(block.timestamp + 1 days);
        governance.execute(outerId);

        require(receiver.nestedExecutionBlocked(), "nested execution was not blocked");
        require(secondTarget.value() == 0, "nested target executed");
        (,,,, bool outerExecuted,,) = governance.getTransaction(outerId);
        (,,,, bool nestedExecuted,,) = governance.getTransaction(nestedId);
        require(outerExecuted, "outer transaction not executed");
        require(!nestedExecuted, "nested transaction executed");
    }

    function testNonSignerCannotProposeOrConfirm() public {
        GovernanceCallReceiver receiver = new GovernanceCallReceiver();

        (bool proposed,) = address(governance).call(
            abi.encodeCall(governance.propose, (address(receiver), 0, abi.encodeCall(receiver.setValue, (1))))
        );
        require(!proposed, "non-signer proposal");

        vm.prank(SIGNER_ONE);
        uint256 transactionId =
            governance.propose(address(receiver), 0, abi.encodeCall(receiver.setValue, (2)));

        (bool confirmed,) =
            address(governance).call(abi.encodeCall(governance.confirm, (transactionId)));
        require(!confirmed, "non-signer confirmation");
    }

    function testSignerRotationRequiresTwoOfThreeThroughSelfCall() public {
        vm.prank(SIGNER_ONE);
        uint256 transactionId = governance.propose(
            address(governance),
            0,
            abi.encodeCall(governance.replaceSigner, (SIGNER_THREE, REPLACEMENT))
        );

        vm.prank(SIGNER_TWO);
        governance.confirm(transactionId);
        vm.warp(block.timestamp + 1 days);
        governance.execute(transactionId);

        require(!governance.isSigner(SIGNER_THREE), "old signer active");
        require(governance.isSigner(REPLACEMENT), "replacement inactive");
    }

    function testPurposeVaultCanOnlyReleaseThroughDelayedGovernance() public {
        ProtocolPurposeVault vault = new ProtocolPurposeVault(address(governance), TREASURY_PURPOSE);
        GovernanceCallReceiver recipient = new GovernanceCallReceiver();

        (bool funded,) = address(vault).call{value: 2 ether}("");
        require(funded, "vault funding");

        (bool directRelease,) =
            address(vault).call(abi.encodeCall(vault.release, (payable(address(recipient)), 1 ether)));
        require(!directRelease, "direct vault release");

        vm.prank(SIGNER_ONE);
        uint256 transactionId = governance.propose(
            address(vault),
            0,
            abi.encodeCall(vault.release, (payable(address(recipient)), 1 ether))
        );
        vm.prank(SIGNER_THREE);
        governance.confirm(transactionId);

        vm.warp(block.timestamp + 1 days);
        governance.execute(transactionId);

        require(recipient.received() == 1 ether, "recipient amount");
        require(vault.totalReceived() == 2 ether, "received accounting");
        require(vault.totalReleased() == 1 ether, "release accounting");
    }

    function testDuplicateSignerConfigurationIsRejected() public {
        try new TwoOfThreeTimelock([SIGNER_ONE, SIGNER_ONE, SIGNER_THREE], 0) {
            revert("duplicate signer accepted");
        } catch {}
    }

    receive() external payable {}
}
