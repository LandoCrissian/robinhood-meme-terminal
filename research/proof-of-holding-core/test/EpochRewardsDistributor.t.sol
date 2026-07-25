// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IPoHEpochRewards } from "../src/interfaces/IPoHEpochRewards.sol";
import { EpochRewardsDistributor } from "../src/rewards/EpochRewardsDistributor.sol";
import { TestBase } from "./TestBase.sol";
import { MockOutboundFeeToken } from "./mocks/MockOutboundFeeToken.sol";
import { MockRewardToken } from "./mocks/MockRewardToken.sol";

contract EpochRewardsDistributorTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant RELAYER = address(0xBEEF);

    bytes32 internal constant POLICY_HASH = keccak256("POH_POLICY_V1");
    bytes32 internal constant DATASET_HASH = keccak256("DATASET_V1");
    bytes32 internal constant CALCULATION_HASH = keccak256("CALCULATION_V1");

    MockRewardToken internal token;
    EpochRewardsDistributor internal distributor;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockRewardToken();
        distributor = new EpochRewardsDistributor(token, address(this));
        token.mint(address(this), 1_000_000e18);
        token.approve(address(distributor), type(uint256).max);
    }

    function testProposalReservesExactExternalAndRolloverFunding() public {
        distributor.fundRollover(25e18);
        uint256 publisherBalanceBefore = token.balanceOf(address(this));

        _proposeSingle(1, ALICE, 100e18, 75e18, 25e18);

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(1);
        assertEq(uint256(epochData.status), uint256(IPoHEpochRewards.EpochStatus.Pending));
        assertEq(epochData.totalAllocation, 100e18);
        assertEq(epochData.externalFunding, 75e18);
        assertEq(epochData.rolloverFunding, 25e18);
        assertEq(distributor.pendingReserved(), 100e18);
        assertEq(distributor.rolloverBalance(), 0);
        assertEq(distributor.accountedBalance(), 100e18);
        assertEq(token.balanceOf(address(distributor)), 100e18);
        assertEq(token.balanceOf(address(this)), publisherBalanceBefore - 75e18);
        assertTrue(distributor.isSolvent());
    }

    function testFinalizationRequiresImmutableReviewDelayAndIsPermissionless() public {
        _proposeSingle(1, ALICE, 100e18, 100e18, 0);

        uint64 finalizableAt = distributor.epoch(1).finalizableAt;
        vm.expectRevert(
            abi.encodeWithSelector(
                EpochRewardsDistributor.ReviewPeriodActive.selector, 1, finalizableAt
            )
        );
        distributor.finalizeEpoch(1);

        vm.warp(block.timestamp + distributor.REVIEW_DELAY());
        vm.prank(RELAYER);
        distributor.finalizeEpoch(1);

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(1);
        assertEq(uint256(epochData.status), uint256(IPoHEpochRewards.EpochStatus.Finalized));
        assertEq(epochData.finalizedAt, block.timestamp);
        assertEq(epochData.claimDeadline, block.timestamp + distributor.CLAIM_PERIOD());
        assertEq(distributor.pendingReserved(), 0);
        assertEq(distributor.finalizedReserved(), 100e18);
    }

    function testThirdPartyClaimAlwaysPaysBeneficiary() public {
        _proposeSingle(1, ALICE, 100e18, 100e18, 0);
        _finalize(1);

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(RELAYER);
        distributor.claim(1, 0, ALICE, 100e18, proof);

        assertEq(token.balanceOf(ALICE), 100e18);
        assertEq(token.balanceOf(RELAYER), 0);
        assertTrue(distributor.isClaimed(1, 0));
        assertEq(distributor.epoch(1).totalClaimed, 100e18);
        assertEq(distributor.finalizedReserved(), 0);
        assertTrue(distributor.isSolvent());
    }

    function testClaimCannotBeReplayed() public {
        _proposeSingle(1, ALICE, 100e18, 100e18, 0);
        _finalize(1);

        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(1, 0, ALICE, 100e18, proof);

        vm.expectRevert(
            abi.encodeWithSelector(EpochRewardsDistributor.AlreadyClaimed.selector, 1, 0)
        );
        distributor.claim(1, 0, ALICE, 100e18, proof);
    }

    function testInvalidMerkleProofIsRejected() public {
        _proposeSingle(1, ALICE, 100e18, 100e18, 0);
        _finalize(1);

        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(EpochRewardsDistributor.InvalidProof.selector);
        distributor.claim(1, 0, BOB, 100e18, proof);
    }

    function testRootCannotPayMoreThanReservedAllocation() public {
        bytes32 oversizedLeaf = distributor.leafHash(1, 0, ALICE, 101e18);
        distributor.proposeEpoch(
            1, oversizedLeaf, 100e18, 100e18, 0, 1, 100, POLICY_HASH, DATASET_HASH, CALCULATION_HASH
        );
        _finalize(1);

        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(
            abi.encodeWithSelector(
                EpochRewardsDistributor.AllocationExceeded.selector, 100e18, 101e18
            )
        );
        distributor.claim(1, 0, ALICE, 101e18, proof);

        assertEq(distributor.epoch(1).totalClaimed, 0);
        assertEq(distributor.finalizedReserved(), 100e18);
    }

    function testBatchClaimsUseBoundedLoopAndIndependentProofs() public {
        uint256 aliceAmount = 40e18;
        uint256 bobAmount = 60e18;
        bytes32 aliceLeaf = distributor.leafHash(1, 0, ALICE, aliceAmount);
        bytes32 bobLeaf = distributor.leafHash(1, 1, BOB, bobAmount);
        bytes32 root = _hashPair(aliceLeaf, bobLeaf);

        distributor.proposeEpoch(
            1,
            root,
            aliceAmount + bobAmount,
            aliceAmount + bobAmount,
            0,
            1,
            100,
            POLICY_HASH,
            DATASET_HASH,
            CALCULATION_HASH
        );
        _finalize(1);

        bytes32[] memory aliceProof = new bytes32[](1);
        aliceProof[0] = bobLeaf;
        bytes32[] memory bobProof = new bytes32[](1);
        bobProof[0] = aliceLeaf;

        IPoHEpochRewards.Claim[] memory claims = new IPoHEpochRewards.Claim[](2);
        claims[0] = IPoHEpochRewards.Claim({
            epochId: 1, index: 0, account: ALICE, amount: aliceAmount, proof: aliceProof
        });
        claims[1] = IPoHEpochRewards.Claim({
            epochId: 1, index: 1, account: BOB, amount: bobAmount, proof: bobProof
        });

        vm.prank(RELAYER);
        distributor.claimBatch(claims);

        assertEq(token.balanceOf(ALICE), aliceAmount);
        assertEq(token.balanceOf(BOB), bobAmount);
        assertEq(distributor.finalizedReserved(), 0);
    }

    function testPendingEpochCancellationRefundsExternalAndRestoresRollover() public {
        distributor.fundRollover(20e18);
        uint256 publisherBalanceBefore = token.balanceOf(address(this));

        _proposeSingle(1, ALICE, 100e18, 80e18, 20e18);
        distributor.cancelEpoch(1);

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(1);
        assertEq(uint256(epochData.status), uint256(IPoHEpochRewards.EpochStatus.Cancelled));
        assertEq(distributor.pendingReserved(), 0);
        assertEq(distributor.rolloverBalance(), 20e18);
        assertEq(token.balanceOf(address(distributor)), 20e18);
        assertEq(token.balanceOf(address(this)), publisherBalanceBefore);
        assertTrue(distributor.isSolvent());
    }

    function testExpiredUnclaimedRewardsBecomeNonWithdrawableRollover() public {
        uint256 aliceAmount = 40e18;
        uint256 bobAmount = 60e18;
        bytes32 aliceLeaf = distributor.leafHash(1, 0, ALICE, aliceAmount);
        bytes32 bobLeaf = distributor.leafHash(1, 1, BOB, bobAmount);
        bytes32 root = _hashPair(aliceLeaf, bobLeaf);

        distributor.proposeEpoch(
            1, root, 100e18, 100e18, 0, 1, 100, POLICY_HASH, DATASET_HASH, CALCULATION_HASH
        );
        _finalize(1);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bobLeaf;
        distributor.claim(1, 0, ALICE, aliceAmount, proof);

        IPoHEpochRewards.Epoch memory finalizedEpoch = distributor.epoch(1);
        vm.warp(uint256(finalizedEpoch.claimDeadline) + 1);
        vm.prank(RELAYER);
        distributor.expireEpoch(1);

        IPoHEpochRewards.Epoch memory expiredEpoch = distributor.epoch(1);
        assertEq(uint256(expiredEpoch.status), uint256(IPoHEpochRewards.EpochStatus.Expired));
        assertEq(distributor.finalizedReserved(), 0);
        assertEq(distributor.rolloverBalance(), bobAmount);
        assertEq(token.balanceOf(address(distributor)), bobAmount);
    }

    function testDirectRewardTransferCanOnlyBeSyncedIntoRollover() public {
        token.transfer(address(distributor), 5e18);
        assertEq(distributor.unaccountedBalance(), 5e18);

        vm.prank(RELAYER);
        distributor.syncUnaccountedRewards();

        assertEq(distributor.unaccountedBalance(), 0);
        assertEq(distributor.rolloverBalance(), 5e18);
        assertEq(distributor.accountedBalance(), 5e18);
    }

    function testOutboundFeeRewardTokenCannotUnderpayBeneficiary() public {
        MockOutboundFeeToken feeToken = new MockOutboundFeeToken();
        EpochRewardsDistributor feeDistributor =
            new EpochRewardsDistributor(feeToken, address(this));
        feeToken.mint(address(this), 100e18);
        feeToken.approve(address(feeDistributor), type(uint256).max);

        bytes32 root = feeDistributor.leafHash(1, 0, ALICE, 100e18);
        feeDistributor.proposeEpoch(
            1, root, 100e18, 100e18, 0, 1, 100, POLICY_HASH, DATASET_HASH, CALCULATION_HASH
        );
        feeToken.setTaxedSender(address(feeDistributor));
        vm.warp(block.timestamp + feeDistributor.REVIEW_DELAY());
        feeDistributor.finalizeEpoch(1);

        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(
            abi.encodeWithSelector(
                EpochRewardsDistributor.UnsupportedRewardTokenPayout.selector,
                ALICE,
                100e18,
                100e18,
                90e18
            )
        );
        feeDistributor.claim(1, 0, ALICE, 100e18, proof);

        assertTrue(!feeDistributor.isClaimed(1, 0));
        assertEq(feeDistributor.finalizedReserved(), 100e18);
        assertEq(feeToken.balanceOf(ALICE), 0);
    }

    function testLeafIsDomainSeparatedByDistributorAddress() public {
        EpochRewardsDistributor secondDistributor =
            new EpochRewardsDistributor(token, address(this));
        bytes32 firstLeaf = distributor.leafHash(1, 0, ALICE, 100e18);
        bytes32 secondLeaf = secondDistributor.leafHash(1, 0, ALICE, 100e18);
        assertTrue(firstLeaf != secondLeaf);
    }

    function testPublisherTransferRequiresAcceptance() public {
        distributor.transferPublisher(BOB);
        assertEq(distributor.publisher(), address(this));
        assertEq(distributor.pendingPublisher(), BOB);

        vm.expectRevert(EpochRewardsDistributor.OnlyPendingPublisher.selector);
        vm.prank(ALICE);
        distributor.acceptPublisher();

        vm.prank(BOB);
        distributor.acceptPublisher();
        assertEq(distributor.publisher(), BOB);
        assertEq(distributor.pendingPublisher(), address(0));

        bytes32 root = distributor.leafHash(1, 0, ALICE, 1e18);
        vm.expectRevert(EpochRewardsDistributor.OnlyPublisher.selector);
        distributor.proposeEpoch(
            1, root, 1e18, 1e18, 0, 1, 100, POLICY_HASH, DATASET_HASH, CALCULATION_HASH
        );
    }

    function testEpochIdentifiersMustIncreaseMonotonically() public {
        _proposeSingle(2, ALICE, 1e18, 1e18, 0);

        bytes32 root = distributor.leafHash(1, 0, ALICE, 1e18);
        vm.expectRevert(
            abi.encodeWithSelector(EpochRewardsDistributor.InvalidEpochOrder.selector, 1, 2)
        );
        distributor.proposeEpoch(
            1, root, 1e18, 1e18, 0, 1, 100, POLICY_HASH, DATASET_HASH, CALCULATION_HASH
        );
    }

    function testClaimsCloseOnlyAfterDeadline() public {
        _proposeSingle(1, ALICE, 100e18, 100e18, 0);
        _finalize(1);

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(1);
        vm.warp(epochData.claimDeadline);

        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(1, 0, ALICE, 100e18, proof);
        assertEq(token.balanceOf(ALICE), 100e18);
    }

    function testFuzzExactSingleLeafClaimsRemainConserved(uint96 rawAmount) public {
        uint256 amount = uint256(rawAmount) % 10_000e18 + 1;
        _proposeSingle(1, ALICE, amount, amount, 0);
        _finalize(1);

        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(1, 0, ALICE, amount, proof);

        assertEq(distributor.epoch(1).totalClaimed, amount);
        assertEq(distributor.accountedBalance(), 0);
        assertEq(token.balanceOf(address(distributor)), 0);
    }

    function _proposeSingle(
        uint256 epochId,
        address account,
        uint256 allocation,
        uint256 externalFunding,
        uint256 rolloverFunding
    ) internal {
        bytes32 root = distributor.leafHash(epochId, 0, account, allocation);
        distributor.proposeEpoch(
            epochId,
            root,
            allocation,
            externalFunding,
            rolloverFunding,
            1,
            100,
            POLICY_HASH,
            DATASET_HASH,
            CALCULATION_HASH
        );
    }

    function _finalize(uint256 epochId) internal {
        vm.warp(block.timestamp + distributor.REVIEW_DELAY());
        distributor.finalizeEpoch(epochId);
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}
