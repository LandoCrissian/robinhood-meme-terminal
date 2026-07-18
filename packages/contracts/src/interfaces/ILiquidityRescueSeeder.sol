// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Narrow adapter used by the RMT Liquidity Rescue vault to create one destination pool.
/// @dev A reviewed Sushi-specific implementation can satisfy this interface once its canonical
///      Robinhood Chain pool contracts and initialization path are confirmed.
interface ILiquidityRescueSeeder {
    function seedLiquidity(
        address pairedToken,
        address weth,
        uint256 pairedTokenAmount,
        uint256 wethAmount,
        uint256 minimumLiquidity,
        uint256 deadline,
        address liquidityCustodian
    ) external returns (bytes32 positionId, uint256 liquidity);
}
