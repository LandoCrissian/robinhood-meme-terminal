// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Keeps a predictable pool key uninitialized until its bonded assets can settle atomically.
/// @dev The low address bits enable only beforeInitialize. The hook has no admin or external calls.
contract RMTV4CurveInitializationGuardV1 {
    IPoolManager public immutable poolManager;
    address public immutable graduationEngine;

    error InvalidGuard();
    error UnapprovedInitialization();

    constructor(IPoolManager manager, address engine) {
        if (
            uint160(address(this)) & Hooks.ALL_HOOK_MASK != Hooks.BEFORE_INITIALIZE_FLAG
                || address(manager).code.length == 0 || engine == address(0)
        ) revert InvalidGuard();
        poolManager = manager;
        graduationEngine = engine;
    }

    function getHookPermissions() external pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view returns (bytes4) {
        if (
            msg.sender != address(poolManager) || sender != graduationEngine || address(key.hooks) != address(this)
                || Currency.unwrap(key.currency0) != address(0) || Currency.unwrap(key.currency1) == address(0)
                || key.fee != 3_000 || key.tickSpacing != 60
        ) revert UnapprovedInitialization();
        return IHooks.beforeInitialize.selector;
    }
}
