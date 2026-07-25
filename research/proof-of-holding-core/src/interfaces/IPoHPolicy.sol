// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IPoHPolicy
/// @notice Policy surface for converting objective holding metrics into application-specific values.
/// @dev Holding history and policy interpretation are deliberately separated.
interface IPoHPolicy {
    /// @notice Returns the immutable identifier for this policy's formula and parameters.
    function policyHash() external pure returns (bytes32);

    /// @notice Returns the loyalty multiplier in 18-decimal fixed-point units.
    function multiplierWad(uint256 ageSeconds) external pure returns (uint256);

    /// @notice Returns the display tier for a holding age.
    function loyaltyTier(uint256 ageSeconds) external pure returns (uint8);

    /// @notice Converts an average eligible balance and holding age into reward weight.
    function rewardWeight(uint256 averageEligibleBalance, uint256 ageSeconds)
        external
        pure
        returns (uint256);
}
