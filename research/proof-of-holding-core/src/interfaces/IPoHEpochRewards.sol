// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IPoHEpochRewards
/// @notice Standardized surface for externally funded, Merkle-based Proof of Holding reward epochs.
interface IPoHEpochRewards {
    enum EpochStatus {
        None,
        Pending,
        Finalized,
        Cancelled,
        Expired
    }

    struct Epoch {
        bytes32 merkleRoot;
        bytes32 policyHash;
        bytes32 datasetHash;
        bytes32 calculationHash;
        address funder;
        uint256 totalAllocation;
        uint256 externalFunding;
        uint256 rolloverFunding;
        uint256 totalClaimed;
        uint64 sourceStartBlock;
        uint64 sourceEndBlock;
        uint64 proposedAt;
        uint64 finalizableAt;
        uint64 finalizedAt;
        uint64 claimDeadline;
        EpochStatus status;
    }

    struct Claim {
        uint256 epochId;
        uint256 index;
        address account;
        uint256 amount;
        bytes32[] proof;
    }

    event EpochProposed(
        uint256 indexed epochId,
        bytes32 indexed merkleRoot,
        uint256 totalAllocation,
        uint256 externalFunding,
        uint256 rolloverFunding,
        uint64 finalizableAt,
        bytes32 indexed policyHash,
        bytes32 datasetHash,
        bytes32 calculationHash
    );

    event EpochCancelled(
        uint256 indexed epochId,
        address indexed funder,
        uint256 refundedExternalFunding,
        uint256 restoredRolloverFunding
    );

    event EpochFinalized(
        uint256 indexed epochId,
        bytes32 indexed merkleRoot,
        uint256 totalAllocation,
        uint64 claimDeadline
    );

    event RewardClaimed(
        uint256 indexed epochId,
        uint256 indexed index,
        address indexed account,
        uint256 amount,
        address submitter
    );

    event EpochExpired(
        uint256 indexed epochId,
        uint256 unclaimedAmount,
        uint256 newRolloverBalance
    );

    event RolloverFunded(address indexed funder, uint256 amount, uint256 newRolloverBalance);

    event UnaccountedRewardsSynced(
        address indexed caller,
        uint256 amount,
        uint256 newRolloverBalance
    );

    function rewardToken() external view returns (IERC20);

    function version() external pure returns (uint32);

    function epoch(uint256 epochId) external view returns (Epoch memory);

    function isClaimed(uint256 epochId, uint256 index) external view returns (bool);

    function leafHash(
        uint256 epochId,
        uint256 index,
        address account,
        uint256 amount
    ) external view returns (bytes32);

    function verifyClaim(
        uint256 epochId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) external view returns (bool);

    function claim(
        uint256 epochId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) external;

    function claimBatch(Claim[] calldata claims) external;
}
