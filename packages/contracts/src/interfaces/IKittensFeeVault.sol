// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IKittensFeeVault {
    /// @notice Accounts native-CASHCAT fee value already transferred into the vault by the bound pool hook.
    function creditFee(uint256 amount) external;
}
