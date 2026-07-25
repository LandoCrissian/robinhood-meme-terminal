// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IProofOfHoldingCore } from "../src/interfaces/IProofOfHoldingCore.sol";
import { LoyaltyAccounting } from "../src/LoyaltyAccounting.sol";
import { PoHPolicyV1 } from "../src/PoHPolicyV1.sol";
import { ProofOfHoldingToken } from "../src/ProofOfHoldingToken.sol";
import { TestBase } from "./TestBase.sol";

contract MockSystem { }

contract LoyaltyAccountingTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant POOL = address(0xD3E);

    PoHPolicyV1 internal policy;
    ProofOfHoldingToken internal token;
    LoyaltyAccounting internal accounting;

    function setUp() public {
        vm.warp(1_800_000_000);
        policy = new PoHPolicyV1();

        address[] memory exclusions = new address[](1);
        exclusions[0] = POOL;

        token = new ProofOfHoldingToken(
            "Proof of Holding",
            "POH",
            1_000_000_000e18,
            ALICE,
            address(this),
            address(policy),
            exclusions
        );
        accounting = token.accounting();
    }

    function testInitialMintStartsPosition() public view {
        IProofOfHoldingCore.Position memory position = accounting.positionOf(ALICE);
        assertEq(position.eligibleBalance, 1_000_000_000e18);
        assertEq(position.positionId, 1);
        assertEq(position.weightedAcquisitionTime, block.timestamp);
        assertEq(position.activeSince, block.timestamp);
    }

    function testAdditionalPurchaseUsesWeightedTimestamp() public {
        vm.prank(ALICE);
        token.transfer(BOB, 100e18);

        vm.warp(block.timestamp + 100 days);

        vm.prank(ALICE);
        token.transfer(BOB, 900e18);

        IProofOfHoldingCore.Position memory position = accounting.positionOf(BOB);
        uint256 expectedTimestamp = block.timestamp - 10 days;

        assertGe(position.weightedAcquisitionTime, expectedTimestamp - 1);
        assertLe(position.weightedAcquisitionTime, expectedTimestamp + 1);
    }

    function testPartialSalePreservesRemainingAge() public {
        vm.warp(block.timestamp + 90 days);
        uint256 ageBefore = accounting.holdingAge(ALICE);

        vm.prank(ALICE);
        token.transfer(BOB, 250_000_000e18);

        uint256 ageAfter = accounting.holdingAge(ALICE);
        assertEq(ageAfter, ageBefore);
        assertEq(accounting.positionOf(ALICE).eligibleBalance, 750_000_000e18);
    }

    function testFullExitResetsActivePosition() public {
        vm.warp(block.timestamp + 30 days);

        uint256 aliceBalance = token.balanceOf(ALICE);
        vm.prank(ALICE);
        token.transfer(BOB, aliceBalance);

        IProofOfHoldingCore.Position memory closed = accounting.positionOf(ALICE);
        assertEq(closed.eligibleBalance, 0);
        assertEq(closed.weightedAcquisitionTime, 0);
        assertEq(closed.activeSince, 0);
        assertEq(accounting.holdingAge(ALICE), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(BOB);
        token.transfer(ALICE, 1e18);

        IProofOfHoldingCore.Position memory reopened = accounting.positionOf(ALICE);
        assertEq(reopened.positionId, 2);
        assertEq(reopened.weightedAcquisitionTime, block.timestamp);
    }

    function testRecipientDoesNotInheritSenderAge() public {
        vm.warp(block.timestamp + 365 days);

        vm.prank(ALICE);
        token.transfer(BOB, 1000e18);

        assertEq(accounting.holdingAge(BOB), 0);
        assertEq(accounting.continuousHoldingDuration(BOB), 0);
    }

    function testExcludedPoolNeverGetsPosition() public {
        vm.prank(ALICE);
        token.transfer(POOL, 10_000e18);

        assertEq(accounting.positionOf(POOL).eligibleBalance, 0);
        assertTrue(accounting.isExcluded(POOL));
    }

    function testUnexcludedBalanceStartsFresh() public {
        vm.prank(ALICE);
        token.transfer(POOL, 10_000e18);
        vm.warp(block.timestamp + 100 days);

        accounting.setExcluded(POOL, false, keccak256("TEST_UNEXCLUDE"));

        IProofOfHoldingCore.Position memory position = accounting.positionOf(POOL);
        assertEq(position.eligibleBalance, 10_000e18);
        assertEq(position.weightedAcquisitionTime, block.timestamp);
        assertEq(position.positionId, 1);
    }

    function testExcludingSystemAddressResetsLoyaltyWithoutMovingTokens() public {
        MockSystem system = new MockSystem();

        vm.prank(ALICE);
        token.transfer(address(system), 100e18);
        vm.warp(block.timestamp + 7 days);

        accounting.setExcluded(address(system), true, keccak256("TEST_SYSTEM_EXCLUSION"));

        IProofOfHoldingCore.Position memory position = accounting.positionOf(address(system));
        assertTrue(accounting.isExcluded(address(system)));
        assertEq(position.eligibleBalance, 0);
        assertEq(position.weightedAcquisitionTime, 0);
        assertEq(position.activeSince, 0);
        assertEq(position.lifetimeBalanceSeconds, 100e18 * 7 days);
        assertEq(position.lastPositionReset, block.timestamp);
        assertEq(token.balanceOf(address(system)), 100e18);
    }

    function testNonGovernanceCannotChangeEligibility() public {
        MockSystem system = new MockSystem();

        vm.expectRevert(LoyaltyAccounting.OnlyGovernance.selector);
        vm.prank(ALICE);
        accounting.setExcluded(address(system), true, keccak256("UNAUTHORIZED"));
    }

    function testGovernanceTransferIsTwoStep() public {
        accounting.transferGovernance(BOB);
        assertEq(accounting.governance(), address(this));
        assertEq(accounting.pendingGovernance(), BOB);

        vm.expectRevert(LoyaltyAccounting.OnlyPendingGovernance.selector);
        vm.prank(ALICE);
        accounting.acceptGovernance();

        vm.prank(BOB);
        accounting.acceptGovernance();
        assertEq(accounting.governance(), BOB);
        assertEq(accounting.pendingGovernance(), address(0));

        MockSystem system = new MockSystem();
        vm.expectRevert(LoyaltyAccounting.OnlyGovernance.selector);
        accounting.setExcluded(address(system), true, keccak256("OLD_GOVERNANCE"));

        vm.prank(BOB);
        accounting.setExcluded(address(system), true, keccak256("NEW_GOVERNANCE"));
        assertTrue(accounting.isExcluded(address(system)));
    }

    function testPermanentExclusionCannotBeRemoved() public {
        vm.expectRevert(LoyaltyAccounting.PermanentExclusion.selector);
        accounting.setExcluded(address(token), false, keccak256("INVALID_UNEXCLUDE"));
    }

    function testBalanceSecondsAccrueWithoutInteraction() public {
        vm.warp(block.timestamp + 7 days);
        IProofOfHoldingCore.Position memory position = accounting.positionOf(ALICE);

        assertEq(position.activeBalanceSeconds, 1_000_000_000e18 * 7 days);
        assertEq(position.lifetimeBalanceSeconds, 1_000_000_000e18 * 7 days);
    }

    function testSelfTransferDoesNotChangePosition() public {
        vm.warp(block.timestamp + 10 days);
        IProofOfHoldingCore.Position memory beforePosition = accounting.positionOf(ALICE);

        vm.prank(ALICE);
        token.transfer(ALICE, 100e18);

        IProofOfHoldingCore.Position memory afterPosition = accounting.positionOf(ALICE);
        assertEq(afterPosition.eligibleBalance, beforePosition.eligibleBalance);
        assertEq(afterPosition.weightedAcquisitionTime, beforePosition.weightedAcquisitionTime);
        assertEq(afterPosition.activeSince, beforePosition.activeSince);
    }

    function testZeroTransferDoesNotStartPosition() public {
        vm.prank(ALICE);
        token.transfer(BOB, 0);
        assertEq(accounting.positionOf(BOB).positionId, 0);
    }

    function testOnlyTokenCanCallTransferHook() public {
        vm.expectRevert(LoyaltyAccounting.OnlyToken.selector);
        accounting.onTokenTransfer(ALICE, BOB, 1e18);
    }

    function testFuzzTrackedBalancesMatchTokenBalances(uint128 aliceToBob, uint128 bobToAlice)
        public
    {
        uint256 amountAB = uint256(aliceToBob) % token.balanceOf(ALICE);
        vm.prank(ALICE);
        token.transfer(BOB, amountAB);

        uint256 bobBalance = token.balanceOf(BOB);
        uint256 amountBA = bobBalance == 0 ? 0 : uint256(bobToAlice) % (bobBalance + 1);
        vm.prank(BOB);
        token.transfer(ALICE, amountBA);

        assertEq(accounting.positionOf(ALICE).eligibleBalance, token.balanceOf(ALICE));
        assertEq(accounting.positionOf(BOB).eligibleBalance, token.balanceOf(BOB));
    }
}
