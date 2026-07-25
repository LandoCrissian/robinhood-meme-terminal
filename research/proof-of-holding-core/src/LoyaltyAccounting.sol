// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IPoHPolicy } from "./interfaces/IPoHPolicy.sol";
import { IProofOfHoldingCore } from "./interfaces/IProofOfHoldingCore.sol";

/// @title LoyaltyAccounting
/// @notice Transfer-aware, non-custodial holding-state accounting for one ERC-20 token.
/// @dev Only the immutable token may mutate positions through `onTokenTransfer`.
contract LoyaltyAccounting is IProofOfHoldingCore, IERC165 {
    uint32 internal constant VERSION = 1000; // semantic version 0.1.0

    bytes32 public constant RESET_FULL_EXIT = keccak256("POH_RESET_FULL_EXIT");
    bytes32 public constant RESET_EXCLUDED = keccak256("POH_RESET_EXCLUDED");

    address public immutable override token;
    address public immutable override policy;
    bytes32 public immutable override policyHash;

    address public governance;
    address public pendingGovernance;

    mapping(address account => Position position) private _positions;
    mapping(address account => bool excluded) private _excluded;
    mapping(address account => bool permanentlyExcluded) public permanentExcluded;

    error OnlyToken();
    error OnlyGovernance();
    error OnlyPendingGovernance();
    error ZeroAddress();
    error InvalidPolicy();
    error NoEligibilityChange();
    error PermanentExclusion();
    error AccountingBalanceUnderflow(address account, uint256 trackedBalance, uint256 amount);
    error BalanceExceedsUint192(uint256 balance);
    error TimestampExceedsUint64(uint256 timestamp);

    event GovernanceTransferStarted(
        address indexed currentGovernance, address indexed pendingGovernance
    );
    event GovernanceTransferred(address indexed previousGovernance, address indexed newGovernance);

    modifier onlyToken() {
        if (msg.sender != token) revert OnlyToken();
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    constructor(
        address token_,
        address governance_,
        address policy_,
        address[] memory initialExcluded
    ) {
        if (token_ == address(0) || governance_ == address(0)) {
            revert ZeroAddress();
        }
        if (policy_ == address(0) || policy_.code.length == 0) revert InvalidPolicy();

        token = token_;
        governance = governance_;
        policy = policy_;
        policyHash = IPoHPolicy(policy_).policyHash();

        _setPermanentExclusion(address(0));
        _setPermanentExclusion(token_);
        _setPermanentExclusion(address(this));

        for (uint256 i; i < initialExcluded.length; ++i) {
            address account = initialExcluded[i];
            if (account == address(0)) continue;
            _excluded[account] = true;
            emit EligibilityUpdated(account, true, keccak256("POH_INITIAL_EXCLUSION"), _time());
        }
    }

    /// @notice Called by the reference token after a successful mint, burn, or transfer.
    function onTokenTransfer(address from, address to, uint256 amount) external onlyToken {
        if (amount == 0 || from == to) return;

        uint64 checkpointTime = _time();

        if (from != address(0) && !_excluded[from]) {
            _decrease(from, amount, checkpointTime);
        }

        if (to != address(0) && !_excluded[to]) {
            _increase(to, amount, checkpointTime);
        }
    }

    /// @inheritdoc IProofOfHoldingCore
    function version() external pure override returns (uint32) {
        return VERSION;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IProofOfHoldingCore).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    /// @inheritdoc IProofOfHoldingCore
    function positionOf(address account) public view override returns (Position memory position) {
        position = _positions[account];

        if (_excluded[account] || position.eligibleBalance == 0) return position;

        uint64 currentTime = _timeView();
        uint64 elapsed = currentTime - position.lastUpdated;
        if (elapsed == 0) return position;

        uint256 accrued = uint256(position.eligibleBalance) * uint256(elapsed);
        position.activeBalanceSeconds += accrued;
        position.lifetimeBalanceSeconds += accrued;
        position.lastUpdated = currentTime;
    }

    /// @inheritdoc IProofOfHoldingCore
    function holdingAge(address account) external view override returns (uint256) {
        Position memory position = _positions[account];
        if (_excluded[account] || position.eligibleBalance == 0) return 0;
        return uint256(_timeView() - position.weightedAcquisitionTime);
    }

    /// @inheritdoc IProofOfHoldingCore
    function continuousHoldingDuration(address account) external view override returns (uint256) {
        Position memory position = _positions[account];
        if (_excluded[account] || position.eligibleBalance == 0) return 0;
        return uint256(_timeView() - position.activeSince);
    }

    /// @inheritdoc IProofOfHoldingCore
    function isExcluded(address account) external view override returns (bool) {
        return _excluded[account];
    }

    /// @inheritdoc IProofOfHoldingCore
    function sync(address account) external override {
        if (_excluded[account]) return;

        uint64 checkpointTime = _time();
        _accrue(account, checkpointTime);
        _emitCheckpoint(account, checkpointTime);
    }

    /// @notice Begins a two-step governance transfer.
    function transferGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        pendingGovernance = newGovernance;
        emit GovernanceTransferStarted(governance, newGovernance);
    }

    /// @notice Accepts governance after being nominated.
    function acceptGovernance() external {
        if (msg.sender != pendingGovernance) revert OnlyPendingGovernance();
        address previous = governance;
        governance = msg.sender;
        pendingGovernance = address(0);
        emit GovernanceTransferred(previous, msg.sender);
    }

    /// @notice Adds or removes a system-address exclusion.
    /// @dev Unexcluding an account starts a new position at the current timestamp using its
    /// current token balance. No historical age is restored.
    function setExcluded(address account, bool excluded, bytes32 reasonHash)
        external
        onlyGovernance
    {
        if (account == address(0)) revert ZeroAddress();
        if (_excluded[account] == excluded) revert NoEligibilityChange();
        if (!excluded && permanentExcluded[account]) revert PermanentExclusion();

        uint64 checkpointTime = _time();

        if (excluded) {
            _closeForExclusion(account, checkpointTime);
            _excluded[account] = true;
        } else {
            _excluded[account] = false;
            _startFromActualBalance(account, checkpointTime);
        }

        emit EligibilityUpdated(account, excluded, reasonHash, checkpointTime);
        _emitCheckpoint(account, checkpointTime);
    }

    function _increase(address account, uint256 amount, uint64 checkpointTime) internal {
        if (amount > type(uint192).max) revert BalanceExceedsUint192(amount);

        _accrue(account, checkpointTime);
        Position storage position = _positions[account];

        uint256 previousBalance = uint256(position.eligibleBalance);
        uint256 newBalance = previousBalance + amount;
        if (newBalance > type(uint192).max) revert BalanceExceedsUint192(newBalance);

        if (previousBalance == 0) {
            position.positionId += 1;
            position.eligibleBalance = uint192(newBalance);
            position.weightedAcquisitionTime = checkpointTime;
            position.activeSince = checkpointTime;
            position.lastUpdated = checkpointTime;
            position.activeBalanceSeconds = 0;
        } else {
            uint256 previousTimestamp = uint256(position.weightedAcquisitionTime);
            uint256 elapsedFromWeightedTime = uint256(checkpointTime) - previousTimestamp;

            // Algebraically equivalent to:
            // (previousBalance * previousTimestamp + amount * checkpointTime) / newBalance
            // but avoids overflowing the timestamp products.
            uint256 timestampShift = Math.mulDiv(amount, elapsedFromWeightedTime, newBalance);

            position.weightedAcquisitionTime = uint64(previousTimestamp + timestampShift);
            position.eligibleBalance = uint192(newBalance);
        }

        _emitCheckpoint(account, checkpointTime);
    }

    function _decrease(address account, uint256 amount, uint64 checkpointTime) internal {
        _accrue(account, checkpointTime);
        Position storage position = _positions[account];

        uint256 trackedBalance = uint256(position.eligibleBalance);
        if (amount > trackedBalance) {
            revert AccountingBalanceUnderflow(account, trackedBalance, amount);
        }

        uint256 remainingBalance = trackedBalance - amount;
        if (remainingBalance == 0) {
            uint64 closedPositionId = position.positionId;
            uint64 activeSince = position.activeSince;
            uint256 finalActiveBalanceSeconds = position.activeBalanceSeconds;

            emit PositionClosed(
                account,
                closedPositionId,
                activeSince,
                checkpointTime,
                finalActiveBalanceSeconds,
                RESET_FULL_EXIT
            );

            position.eligibleBalance = 0;
            position.weightedAcquisitionTime = 0;
            position.activeBalanceSeconds = 0;
            position.activeSince = 0;
            position.lastUpdated = checkpointTime;
            position.lastPositionReset = checkpointTime;
        } else {
            position.eligibleBalance = uint192(remainingBalance);
        }

        _emitCheckpoint(account, checkpointTime);
    }

    function _accrue(address account, uint64 checkpointTime) internal {
        Position storage position = _positions[account];

        if (position.lastUpdated == 0) {
            position.lastUpdated = checkpointTime;
            return;
        }

        uint64 elapsed = checkpointTime - position.lastUpdated;
        if (elapsed == 0) return;

        if (position.eligibleBalance != 0) {
            uint256 accrued = uint256(position.eligibleBalance) * uint256(elapsed);
            position.activeBalanceSeconds += accrued;
            position.lifetimeBalanceSeconds += accrued;
        }

        position.lastUpdated = checkpointTime;
    }

    function _closeForExclusion(address account, uint64 checkpointTime) internal {
        _accrue(account, checkpointTime);
        Position storage position = _positions[account];

        if (position.eligibleBalance != 0) {
            emit PositionClosed(
                account,
                position.positionId,
                position.activeSince,
                checkpointTime,
                position.activeBalanceSeconds,
                RESET_EXCLUDED
            );
        }

        position.eligibleBalance = 0;
        position.weightedAcquisitionTime = 0;
        position.activeBalanceSeconds = 0;
        position.activeSince = 0;
        position.lastUpdated = checkpointTime;
        position.lastPositionReset = checkpointTime;
    }

    function _startFromActualBalance(address account, uint64 checkpointTime) internal {
        uint256 actualBalance = IERC20(token).balanceOf(account);
        if (actualBalance > type(uint192).max) revert BalanceExceedsUint192(actualBalance);

        Position storage position = _positions[account];
        position.lastUpdated = checkpointTime;

        if (actualBalance == 0) return;

        position.positionId += 1;
        position.eligibleBalance = uint192(actualBalance);
        position.weightedAcquisitionTime = checkpointTime;
        position.activeBalanceSeconds = 0;
        position.activeSince = checkpointTime;
    }

    function _setPermanentExclusion(address account) internal {
        _excluded[account] = true;
        permanentExcluded[account] = true;
        emit EligibilityUpdated(account, true, keccak256("POH_PERMANENT_EXCLUSION"), _time());
    }

    function _emitCheckpoint(address account, uint64 checkpointTime) internal {
        Position storage position = _positions[account];
        emit PositionCheckpoint(
            account,
            position.positionId,
            position.eligibleBalance,
            position.weightedAcquisitionTime,
            position.activeSince,
            position.activeBalanceSeconds,
            position.lifetimeBalanceSeconds,
            checkpointTime
        );
    }

    function _time() internal view returns (uint64) {
        if (block.timestamp > type(uint64).max) {
            revert TimestampExceedsUint64(block.timestamp);
        }
        return uint64(block.timestamp);
    }

    function _timeView() internal view returns (uint64) {
        if (block.timestamp > type(uint64).max) {
            revert TimestampExceedsUint64(block.timestamp);
        }
        return uint64(block.timestamp);
    }
}
