// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationAdapter} from "./IGraduationAdapter.sol";

/// @notice V6 graduation extension that binds immutable fee routing before a market is activated.
interface IV6GraduationAdapter is IGraduationAdapter {
    function poolFee() external view returns (uint24);

    function configureFeeRouting(address token, address feeSplitter, uint16 postGraduationFeeBps) external;

    function collectFees(address token) external returns (uint256 nativeAmount, uint256 tokenAmount);
}
