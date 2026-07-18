// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal Sushi V3 pool ABI needed for immutable configuration checks.
interface ISushiV3Pool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
}
