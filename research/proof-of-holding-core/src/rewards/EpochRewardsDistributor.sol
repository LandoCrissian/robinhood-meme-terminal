// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IPoHEpochRewards } from "../interfaces/IPoHEpochRewards.sol";

/// @title EpochRewardsDistributor
/// @notice Externally funded, review-delayed Merkle rewards for Proof of Holding epochs.
/// @dev The publisher can propose and cancel pending roots but cannot alter finalized roots,
/// withdraw finalized allocations, redirect claims, or recover the immutable reward token.
contract EpochRewardsDistributor is IPoHEpochRewards, IERC165, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint32 internal constant VERSION = 1000; // semantic version 0.1.0

    uint64 public constant REVIEW_DELAY = 48 hours;
    uint64 public constant CLAIM_PERIOD = 180 days;
    uint256 public constant MAX_BATCH_CLAIMS = 20;

    bytes32 public constant LEAF_DOMAIN = keccak256("POH_EPOCH_REWARD_LEAF_V1");

    IERC20 public immutable override rewardToken;

    address public publisher;
    address public pendingPublisher;

    uint256 public lastProposedEpoch;
    uint256 public pendingReserved;
    uint256 public finalizedReserved;
    uint256 public rolloverBalance;

    mapping(uint256 epochId => Epoch epochData) private _epochs;
    mapping(uint256 epochId => mapping(uint256 wordIndex => uint256 claimedWord))
        private _claimedBitMap;

    error OnlyPublisher();
    error OnlyPendingPublisher();
    error ZeroAddress();
    error InvalidRewardToken();
    error InvalidEpochOrder(uint256 epochId, uint256 lastEpochId);
    error InvalidMerkleRoot();
    error InvalidAllocation();
    error FundingMismatch(uint256 allocation, uint256 externalFunding, uint256 rolloverFunding);
    error InsufficientRollover(uint256 requested, uint256 available);
    error UnsupportedRewardTokenTransfer(uint256 requested, uint256 received);
    error InvalidSourceRange(uint64 sourceStartBlock, uint64 sourceEndBlock);
    error MissingCommitment();
    error InvalidEpochStatus(uint256 epochId, EpochStatus expected, EpochStatus actual);
    error ReviewPeriodActive(uint256 epochId, uint64 finalizableAt);
    error ClaimWindowClosed(uint256 epochId, uint64 claimDeadline);
    error InvalidClaim();
    error AlreadyClaimed(uint256 epochId, uint256 index);
    error InvalidProof();
    error AllocationExceeded(uint256 totalAllocation, uint256 attemptedTotalClaimed);
    error BatchSizeOutOfBounds(uint256 supplied, uint256 maximum);
    error NoUnaccountedRewards();
    error RewardAccountingInsolvent(uint256 tokenBalance, uint256 accountedBalance);
    error TimestampExceedsUint64(uint256 timestamp);

    event PublisherTransferStarted(
        address indexed currentPublisher,
        address indexed pendingPublisher
    );
    event PublisherTransferred(address indexed previousPublisher, address indexed newPublisher);

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert OnlyPublisher();
        _;
    }

    constructor(IERC20 rewardToken_, address publisher_) {
        if (address(rewardToken_) == address(0) || publisher_ == address(0)) revert ZeroAddress();
        if (address(rewardToken_).code.length == 0) revert InvalidRewardToken();

        rewardToken = rewardToken_;
        publisher = publisher_;
    }

    /// @inheritdoc IPoHEpochRewards
    function version() external pure override returns (uint32) {
        return VERSION;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IPoHEpochRewards).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    /// @inheritdoc IPoHEpochRewards
    function epoch(uint256 epochId) external view override returns (Epoch memory) {
        return _epochs[epochId];
    }

    /// @notice Begins a two-step publisher transfer.
    function transferPublisher(address newPublisher) external onlyPublisher {
        if (newPublisher == address(0)) revert ZeroAddress();
        pendingPublisher = newPublisher;
        emit PublisherTransferStarted(publisher, newPublisher);
    }

    /// @notice Accepts the publisher role after nomination.
    function acceptPublisher() external {
        if (msg.sender != pendingPublisher) revert OnlyPendingPublisher();
        address previousPublisher = publisher;
        publisher = msg.sender;
        pendingPublisher = address(0);
        emit PublisherTransferred(previousPublisher, msg.sender);
    }

    /// @notice Proposes a monotonically increasing reward epoch and reserves its exact funding.
    /// @dev `externalFunding + rolloverFunding` must equal `totalAllocation`.
    function proposeEpoch(
        uint256 epochId,
        bytes32 merkleRoot,
        uint256 totalAllocation,
        uint256 externalFunding,
        uint256 rolloverFunding,
        uint64 sourceStartBlock,
        uint64 sourceEndBlock,
        bytes32 policyHash,
        bytes32 datasetHash,
        bytes32 calculationHash
    ) external onlyPublisher nonReentrant {
        if (epochId <= lastProposedEpoch) {
            revert InvalidEpochOrder(epochId, lastProposedEpoch);
        }
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (totalAllocation == 0) revert InvalidAllocation();
        if (externalFunding + rolloverFunding != totalAllocation) {
            revert FundingMismatch(totalAllocation, externalFunding, rolloverFunding);
        }
        if (rolloverFunding > rolloverBalance) {
            revert InsufficientRollover(rolloverFunding, rolloverBalance);
        }
        if (sourceStartBlock > sourceEndBlock) {
            revert InvalidSourceRange(sourceStartBlock, sourceEndBlock);
        }
        if (policyHash == bytes32(0) || datasetHash == bytes32(0) || calculationHash == bytes32(0)) {
            revert MissingCommitment();
        }

        if (externalFunding != 0) {
            _pullExact(msg.sender, externalFunding);
        }

        uint64 proposedAt = _time();
        uint64 finalizableAt = _addTime(proposedAt, REVIEW_DELAY);

        rolloverBalance -= rolloverFunding;
        pendingReserved += totalAllocation;
        lastProposedEpoch = epochId;

        _epochs[epochId] = Epoch({
            merkleRoot: merkleRoot,
            policyHash: policyHash,
            datasetHash: datasetHash,
            calculationHash: calculationHash,
            funder: msg.sender,
            totalAllocation: totalAllocation,
            externalFunding: externalFunding,
            rolloverFunding: rolloverFunding,
            totalClaimed: 0,
            sourceStartBlock: sourceStartBlock,
            sourceEndBlock: sourceEndBlock,
            proposedAt: proposedAt,
            finalizableAt: finalizableAt,
            finalizedAt: 0,
            claimDeadline: 0,
            status: EpochStatus.Pending
        });

        _assertSolvent();

        emit EpochProposed(
            epochId,
            merkleRoot,
            totalAllocation,
            externalFunding,
            rolloverFunding,
            finalizableAt,
            policyHash,
            datasetHash,
            calculationHash
        );
    }

    /// @notice Cancels a pending epoch and restores each funding source.
    function cancelEpoch(uint256 epochId) external onlyPublisher nonReentrant {
        Epoch storage epochData = _epochs[epochId];
        _requireStatus(epochId, epochData.status, EpochStatus.Pending);

        epochData.status = EpochStatus.Cancelled;
        pendingReserved -= epochData.totalAllocation;
        rolloverBalance += epochData.rolloverFunding;

        uint256 externalRefund = epochData.externalFunding;
        if (externalRefund != 0) {
            rewardToken.safeTransfer(epochData.funder, externalRefund);
        }

        _assertSolvent();

        emit EpochCancelled(
            epochId,
            epochData.funder,
            externalRefund,
            epochData.rolloverFunding
        );
    }

    /// @notice Finalizes a reviewed epoch. Anyone may call after the immutable delay.
    function finalizeEpoch(uint256 epochId) external {
        Epoch storage epochData = _epochs[epochId];
        _requireStatus(epochId, epochData.status, EpochStatus.Pending);

        uint64 currentTime = _time();
        if (currentTime < epochData.finalizableAt) {
            revert ReviewPeriodActive(epochId, epochData.finalizableAt);
        }

        epochData.status = EpochStatus.Finalized;
        epochData.finalizedAt = currentTime;
        epochData.claimDeadline = _addTime(currentTime, CLAIM_PERIOD);

        pendingReserved -= epochData.totalAllocation;
        finalizedReserved += epochData.totalAllocation;

        _assertSolvent();

        emit EpochFinalized(
            epochId,
            epochData.merkleRoot,
            epochData.totalAllocation,
            epochData.claimDeadline
        );
    }

    /// @inheritdoc IPoHEpochRewards
    function claim(
        uint256 epochId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) external override nonReentrant {
        _claim(epochId, index, account, amount, proof);
    }

    /// @inheritdoc IPoHEpochRewards
    function claimBatch(Claim[] calldata claims) external override nonReentrant {
        uint256 length = claims.length;
        if (length == 0 || length > MAX_BATCH_CLAIMS) {
            revert BatchSizeOutOfBounds(length, MAX_BATCH_CLAIMS);
        }

        for (uint256 i; i < length; ++i) {
            Claim calldata claimData = claims[i];
            _claim(
                claimData.epochId,
                claimData.index,
                claimData.account,
                claimData.amount,
                claimData.proof
            );
        }
    }

    /// @notice Converts unclaimed finalized rewards into non-withdrawable rollover funding.
    function expireEpoch(uint256 epochId) external {
        Epoch storage epochData = _epochs[epochId];
        _requireStatus(epochId, epochData.status, EpochStatus.Finalized);

        uint64 currentTime = _time();
        if (currentTime <= epochData.claimDeadline) {
            revert ClaimWindowClosed(epochId, epochData.claimDeadline);
        }

        uint256 unclaimedAmount = epochData.totalAllocation - epochData.totalClaimed;
        epochData.status = EpochStatus.Expired;

        finalizedReserved -= unclaimedAmount;
        rolloverBalance += unclaimedAmount;

        _assertSolvent();

        emit EpochExpired(epochId, unclaimedAmount, rolloverBalance);
    }

    /// @notice Adds exact reward-token funding to the rollover reserve.
    function fundRollover(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAllocation();
        _pullExact(msg.sender, amount);
        rolloverBalance += amount;
        _assertSolvent();
        emit RolloverFunded(msg.sender, amount, rolloverBalance);
    }

    /// @notice Accounts for reward tokens transferred directly to this contract.
    /// @dev Synced tokens become rollover funding and can never be withdrawn by the publisher.
    function syncUnaccountedRewards() external {
        uint256 tokenBalance = rewardToken.balanceOf(address(this));
        uint256 accounted = accountedBalance();
        if (tokenBalance < accounted) revert RewardAccountingInsolvent(tokenBalance, accounted);

        uint256 amount = tokenBalance - accounted;
        if (amount == 0) revert NoUnaccountedRewards();

        rolloverBalance += amount;
        emit UnaccountedRewardsSynced(msg.sender, amount, rolloverBalance);
    }

    /// @inheritdoc IPoHEpochRewards
    function isClaimed(uint256 epochId, uint256 index) public view override returns (bool) {
        uint256 wordIndex = index >> 8;
        uint256 bitIndex = index & 255;
        uint256 word = _claimedBitMap[epochId][wordIndex];
        return word & (1 << bitIndex) != 0;
    }

    /// @inheritdoc IPoHEpochRewards
    function leafHash(
        uint256 epochId,
        uint256 index,
        address account,
        uint256 amount
    ) public view override returns (bytes32) {
        bytes32 innerHash = keccak256(
            abi.encode(
                LEAF_DOMAIN,
                block.chainid,
                address(this),
                epochId,
                index,
                account,
                amount
            )
        );
        return keccak256(bytes.concat(innerHash));
    }

    /// @inheritdoc IPoHEpochRewards
    function verifyClaim(
        uint256 epochId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) external view override returns (bool) {
        Epoch storage epochData = _epochs[epochId];
        if (epochData.status != EpochStatus.Finalized) return false;
        if (block.timestamp > epochData.claimDeadline) return false;
        if (account == address(0) || amount == 0 || isClaimed(epochId, index)) return false;

        return MerkleProof.verifyCalldata(
            proof,
            epochData.merkleRoot,
            leafHash(epochId, index, account, amount)
        );
    }

    /// @notice Returns the sum of pending, finalized-unclaimed, and rollover obligations.
    function accountedBalance() public view returns (uint256) {
        return pendingReserved + finalizedReserved + rolloverBalance;
    }

    /// @notice Returns reward tokens held above recorded obligations.
    function unaccountedBalance() external view returns (uint256) {
        uint256 tokenBalance = rewardToken.balanceOf(address(this));
        uint256 accounted = accountedBalance();
        return tokenBalance > accounted ? tokenBalance - accounted : 0;
    }

    /// @notice Returns whether the distributor currently covers every recorded obligation.
    function isSolvent() external view returns (bool) {
        return rewardToken.balanceOf(address(this)) >= accountedBalance();
    }

    function _claim(
        uint256 epochId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) internal {
        Epoch storage epochData = _epochs[epochId];
        _requireStatus(epochId, epochData.status, EpochStatus.Finalized);

        uint64 currentTime = _time();
        if (currentTime > epochData.claimDeadline) {
            revert ClaimWindowClosed(epochId, epochData.claimDeadline);
        }
        if (account == address(0) || amount == 0) revert InvalidClaim();
        if (isClaimed(epochId, index)) revert AlreadyClaimed(epochId, index);

        bytes32 leaf = leafHash(epochId, index, account, amount);
        if (!MerkleProof.verifyCalldata(proof, epochData.merkleRoot, leaf)) {
            revert InvalidProof();
        }

        uint256 newTotalClaimed = epochData.totalClaimed + amount;
        if (newTotalClaimed > epochData.totalAllocation) {
            revert AllocationExceeded(epochData.totalAllocation, newTotalClaimed);
        }

        _setClaimed(epochId, index);
        epochData.totalClaimed = newTotalClaimed;
        finalizedReserved -= amount;

        rewardToken.safeTransfer(account, amount);
        _assertSolvent();

        emit RewardClaimed(epochId, index, account, amount, msg.sender);
    }

    function _setClaimed(uint256 epochId, uint256 index) internal {
        uint256 wordIndex = index >> 8;
        uint256 bitIndex = index & 255;
        _claimedBitMap[epochId][wordIndex] |= 1 << bitIndex;
    }

    function _pullExact(address from, uint256 amount) internal {
        uint256 balanceBefore = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(from, address(this), amount);
        uint256 balanceAfter = rewardToken.balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;
        if (received != amount) revert UnsupportedRewardTokenTransfer(amount, received);
    }

    function _assertSolvent() internal view {
        uint256 tokenBalance = rewardToken.balanceOf(address(this));
        uint256 accounted = accountedBalance();
        if (tokenBalance < accounted) revert RewardAccountingInsolvent(tokenBalance, accounted);
    }

    function _requireStatus(
        uint256 epochId,
        EpochStatus actual,
        EpochStatus expected
    ) internal pure {
        if (actual != expected) revert InvalidEpochStatus(epochId, expected, actual);
    }

    function _time() internal view returns (uint64) {
        if (block.timestamp > type(uint64).max) {
            revert TimestampExceedsUint64(block.timestamp);
        }
        return uint64(block.timestamp);
    }

    function _addTime(uint64 timestamp, uint64 duration) internal pure returns (uint64) {
        uint256 result = uint256(timestamp) + uint256(duration);
        if (result > type(uint64).max) revert TimestampExceedsUint64(result);
        return uint64(result);
    }
}
