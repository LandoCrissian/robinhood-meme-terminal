// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IGraduationAdapter {
    function graduate(address token, uint256 tokenAmount) external payable returns (address pool, uint256 liquidity);
}
