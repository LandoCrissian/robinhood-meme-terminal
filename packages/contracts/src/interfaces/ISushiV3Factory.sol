// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal Sushi V3 factory ABI needed to bind one canonical pool.
interface ISushiV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24 tickSpacing);
}
