// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ClonePurposeRewardVault} from "../src/clone/ClonePurposeRewardVault.sol";
import {PurposeRewardsController} from "../src/PurposeRewardsController.sol";

interface PurposeControllerVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract PurposePayoutReceiver {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}

contract ReentrantPurposeRecipient {
    PurposeRewardsController public immutable controller;
    uint256 public proposalId;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(PurposeRewardsController controller_) {
        controller = controller_;
    }

    function setProposalId(uint256 proposalId_) external {
        proposalId = proposalId_;
    }

    receive() external payable {
        reentryAttempted = true;
        (reentrySucceeded,) =
            address(controller).call(abi.encodeCall(controller.executeRelease, (proposalId)));
    }
}

contract PurposeRewardsControllerTest {
    PurposeControllerVm private constant vm =
        PurposeControllerVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant GOVERNANCE = address(0xBEEF);
    address private constant TOKEN = address(0xCAFE);
    bytes32 private constant PURPOSE = keccak256("COMMUNITY_TREASURY");

    PurposeRewardsController private controller;
    ClonePurposeRewardVault private vault;

    function setUp() public {
        vm.deal(address(this), 10 ether);
        controller = new PurposeRewardsController(address(this), GOVERNANCE, 1 days);
        controller.bindFactory(address(this));

        vault = new ClonePurposeRewardVault();
        vault.initialize(address(controller), TOKEN, PURPOSE);
        controller.registerVault(address(vault), TOKEN, PURPOSE);
        (bool funded,) = address(vault).call{value: 2 ether}("");
        require(funded, "vault funding");
    }

    function testRegisteredVaultReleaseRequiresGovernanceAndDelay() public {
        PurposePayoutReceiver recipient = new PurposePayoutReceiver();

        (bool unauthorized,) = address(controller).call(
            abi.encodeCall(controller.proposeRelease, (address(vault), payable(address(recipient)), 1 ether))
        );
        require(!unauthorized, "unauthorized proposal");

        vm.prank(GOVERNANCE);
        uint256 proposalId = controller.proposeRelease(address(vault), payable(address(recipient)), 1 ether);

        (bool early,) =
            address(controller).call(abi.encodeCall(controller.executeRelease, (proposalId)));
        require(!early, "early release");

        vm.warp(block.timestamp + 1 days);
        controller.executeRelease(proposalId);

        require(recipient.received() == 1 ether, "recipient payment");
        require(vault.totalReleased() == 1 ether, "vault accounting");
        (,,,, bool executed, bool cancelled) = controller.proposals(proposalId);
        require(executed && !cancelled, "proposal state");
    }

    function testGovernanceCanCancelButCannotModifyProposal() public {
        PurposePayoutReceiver recipient = new PurposePayoutReceiver();
        vm.prank(GOVERNANCE);
        uint256 proposalId = controller.proposeRelease(address(vault), payable(address(recipient)), 0.5 ether);

        vm.prank(GOVERNANCE);
        controller.cancelRelease(proposalId);
        vm.warp(block.timestamp + 1 days);

        (bool executed,) =
            address(controller).call(abi.encodeCall(controller.executeRelease, (proposalId)));
        require(!executed, "cancelled release executed");
        require(recipient.received() == 0, "cancelled payment");
    }

    function testUnregisteredVaultCannotBeProposed() public {
        ClonePurposeRewardVault unregistered = new ClonePurposeRewardVault();
        unregistered.initialize(address(controller), TOKEN, PURPOSE);
        (bool funded,) = address(unregistered).call{value: 1 ether}("");
        require(funded, "unregistered funding");

        vm.prank(GOVERNANCE);
        (bool proposed,) = address(controller).call(
            abi.encodeCall(controller.proposeRelease, (address(unregistered), payable(address(this)), 1 ether))
        );
        require(!proposed, "unregistered vault accepted");
    }

    function testRecipientCannotReenterRelease() public {
        ReentrantPurposeRecipient recipient = new ReentrantPurposeRecipient(controller);
        vm.prank(GOVERNANCE);
        uint256 proposalId = controller.proposeRelease(address(vault), payable(address(recipient)), 1 ether);
        recipient.setProposalId(proposalId);

        vm.warp(block.timestamp + 1 days);
        controller.executeRelease(proposalId);

        require(recipient.reentryAttempted(), "reentry not attempted");
        require(!recipient.reentrySucceeded(), "reentry succeeded");
        require(vault.totalReleased() == 1 ether, "duplicate release");
    }

    receive() external payable {}
}
