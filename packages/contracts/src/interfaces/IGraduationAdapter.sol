// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IGraduationAdapter {
    function prepare(address token) external returns (bytes32 poolId);

    function bindMarket(address token, address market) external;

    function graduate(address token, uint256 tokenAmount) external payable returns (address pool, uint256 liquidity);
}
