// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IProofOfHoldingCore
/// @notice Objective, token-specific wallet holding-state interface.
interface IProofOfHoldingCore {
    /// @dev `eligibleBalance` is bounded to uint192 so balance-seconds cannot overflow when
    /// multiplied by a uint64 timestamp interval.
    struct Position {
        uint192 eligibleBalance;
        uint64 weightedAcquisitionTime;
        uint256 activeBalanceSeconds;
        uint256 lifetimeBalanceSeconds;
        uint64 activeSince;
        uint64 lastUpdated;
        uint64 lastPositionReset;
        uint64 positionId;
    }

    event PositionCheckpoint(
        address indexed account,
        uint64 indexed positionId,
        uint192 eligibleBalance,
        uint64 weightedAcquisitionTime,
        uint64 activeSince,
        uint256 activeBalanceSeconds,
        uint256 lifetimeBalanceSeconds,
        uint64 checkpointTime
    );

    event PositionClosed(
        address indexed account,
        uint64 indexed positionId,
        uint64 activeSince,
        uint64 closedAt,
        uint256 finalActiveBalanceSeconds,
        bytes32 indexed reason
    );

    event EligibilityUpdated(
        address indexed account, bool excluded, bytes32 indexed reasonHash, uint64 effectiveAt
    );

    function token() external view returns (address);

    function policy() external view returns (address);

    function policyHash() external view returns (bytes32);

    function version() external pure returns (uint32);

    function positionOf(address account) external view returns (Position memory);

    function holdingAge(address account) external view returns (uint256);

    function continuousHoldingDuration(address account) external view returns (uint256);

    function isExcluded(address account) external view returns (bool);

    /// @notice Materializes time accrued since the account's last checkpoint.
    /// @dev Anyone may call this. It never changes token balances or holding timestamps.
    function sync(address account) external;
}
