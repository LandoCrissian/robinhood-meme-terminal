// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {V4GraduationHook} from "./V4GraduationHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice V5 deployment identity for the graduation-hook behavior shared by the V6 foundation.
contract V5GraduationHook is V4GraduationHook {
    constructor(IPoolManager manager, address deployer) V4GraduationHook(manager, deployer) {}
}
