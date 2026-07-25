// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IPoHEpochRewards } from "../src/interfaces/IPoHEpochRewards.sol";
import { EpochRewardsDistributor } from "../src/rewards/EpochRewardsDistributor.sol";
import { TestBase, Vm } from "./TestBase.sol";
import { MockRewardToken } from "./mocks/MockRewardToken.sol";

contract EpochRewardsHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant MAX_EPOCHS = 24;

    bytes32 internal constant POLICY_HASH = keccak256("POH_POLICY_V1");
    bytes32 internal constant DATASET_HASH = keccak256("DATASET_V1");
    bytes32 internal constant CALCULATION_HASH = keccak256("CALCULATION_V1");

    MockRewardToken public immutable token;
    EpochRewardsDistributor public immutable distributor;

    address[3] internal _actors;
    uint256 public nextEpochId = 1;

    mapping(uint256 epochId => address account) public accountByEpoch;
    mapping(uint256 epochId => uint256 allocation) public allocationByEpoch;

    constructor(
        MockRewardToken token_,
        EpochRewardsDistributor distributor_,
        address[3] memory actors_
    ) {
        token = token_;
        distributor = distributor_;
        _actors = actors_;
        token_.approve(address(distributor_), type(uint256).max);
    }

    function acceptPublisher() external {
        if (distributor.pendingPublisher() != address(this)) return;
        distributor.acceptPublisher();
    }

    function propose(uint96 rawAmount, uint8 actorSeed) external {
        if (nextEpochId > MAX_EPOCHS) return;

        uint256 amount = uint256(rawAmount) % 100e18 + 1;
        if (token.balanceOf(address(this)) < amount) return;

        uint256 epochId = nextEpochId;
        address account = _actors[uint256(actorSeed) % _actors.length];
        bytes32 root = distributor.leafHash(epochId, 0, account, amount);

        distributor.proposeEpoch(
            epochId,
            root,
            amount,
            amount,
            0,
            uint64(epochId * 100),
            uint64(epochId * 100 + 99),
            POLICY_HASH,
            DATASET_HASH,
            CALCULATION_HASH
        );

        accountByEpoch[epochId] = account;
        allocationByEpoch[epochId] = amount;
        nextEpochId = epochId + 1;
    }

    function finalize(uint8 epochSeed) external {
        uint256 epochId = _selectEpoch(epochSeed);
        if (epochId == 0) return;

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(epochId);
        if (
            epochData.status == IPoHEpochRewards.EpochStatus.Pending
                && block.timestamp >= epochData.finalizableAt
        ) {
            distributor.finalizeEpoch(epochId);
        }
    }

    function claim(uint8 epochSeed) external {
        uint256 epochId = _selectEpoch(epochSeed);
        if (epochId == 0) return;

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(epochId);
        if (
            epochData.status != IPoHEpochRewards.EpochStatus.Finalized
                || block.timestamp > epochData.claimDeadline || distributor.isClaimed(epochId, 0)
        ) {
            return;
        }

        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(epochId, 0, accountByEpoch[epochId], allocationByEpoch[epochId], proof);
    }

    function expire(uint8 epochSeed) external {
        uint256 epochId = _selectEpoch(epochSeed);
        if (epochId == 0) return;

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(epochId);
        if (
            epochData.status == IPoHEpochRewards.EpochStatus.Finalized
                && block.timestamp > epochData.claimDeadline
        ) {
            distributor.expireEpoch(epochId);
        }
    }

    function cancel(uint8 epochSeed) external {
        uint256 epochId = _selectEpoch(epochSeed);
        if (epochId == 0) return;

        IPoHEpochRewards.Epoch memory epochData = distributor.epoch(epochId);
        if (epochData.status == IPoHEpochRewards.EpochStatus.Pending) {
            distributor.cancelEpoch(epochId);
        }
    }

    function advanceTime(uint32 rawSeconds) external {
        uint256 elapsed = uint256(rawSeconds) % (200 days + 1);
        vm.warp(block.timestamp + elapsed);
    }

    function fundRollover(uint96 rawAmount) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = uint256(rawAmount) % balance + 1;
        distributor.fundRollover(amount);
    }

    function donateAndSync(uint96 rawAmount) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = uint256(rawAmount) % balance + 1;
        token.transfer(address(distributor), amount);
        distributor.syncUnaccountedRewards();
    }

    function _selectEpoch(uint8 epochSeed) internal view returns (uint256) {
        uint256 count = nextEpochId - 1;
        if (count == 0) return 0;
        return uint256(epochSeed) % count + 1;
    }
}

contract EpochRewardsInvariantTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA401);

    MockRewardToken internal token;
    EpochRewardsDistributor internal distributor;
    EpochRewardsHandler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockRewardToken();
        distributor = new EpochRewardsDistributor(token, address(this));

        address[3] memory actors = [ALICE, BOB, CAROL];
        handler = new EpochRewardsHandler(token, distributor, actors);
        token.mint(address(handler), 1_000_000_000e18);

        distributor.transferPublisher(address(handler));
        handler.acceptPublisher();
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariantRecordedObligationsAreFullyCollateralized() public view {
        uint256 accounted = distributor.accountedBalance();
        assertEq(
            accounted,
            distributor.pendingReserved() + distributor.finalizedReserved()
                + distributor.rolloverBalance()
        );
        assertGe(token.balanceOf(address(distributor)), accounted);
        assertTrue(distributor.isSolvent());
    }

    function invariantEpochClaimsNeverExceedAllocations() public view {
        uint256 lastEpoch = distributor.lastProposedEpoch();
        for (uint256 epochId = 1; epochId <= lastEpoch; ++epochId) {
            IPoHEpochRewards.Epoch memory epochData = distributor.epoch(epochId);
            assertLe(epochData.totalClaimed, epochData.totalAllocation);

            if (
                epochData.status == IPoHEpochRewards.EpochStatus.Pending
                    || epochData.status == IPoHEpochRewards.EpochStatus.Cancelled
            ) {
                assertEq(epochData.totalClaimed, 0);
                assertEq(epochData.claimDeadline, 0);
            }

            if (
                epochData.status == IPoHEpochRewards.EpochStatus.Finalized
                    || epochData.status == IPoHEpochRewards.EpochStatus.Expired
            ) {
                assertTrue(epochData.finalizedAt != 0);
                assertTrue(epochData.claimDeadline > epochData.finalizedAt);
            }
        }
    }

    function invariantEpochIdentifiersRemainMonotonic() public view {
        assertEq(distributor.lastProposedEpoch(), handler.nextEpochId() - 1);
    }
}
