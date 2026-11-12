// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Authorizes exactly one factory to initialize pools using this hook.
/// @dev No method makes an external call, including calls back into PoolManager.
contract RMTV4InitializationGuard {
    IPoolManager public immutable poolManager;
    address public immutable factory;

    error InvalidGuardAddress();
    error UnexpectedManager();
    error UnexpectedInitializer();
    error UnexpectedPoolKey();

    constructor(IPoolManager poolManager_, address factory_) {
        if (uint160(address(this)) & Hooks.ALL_HOOK_MASK != Hooks.BEFORE_INITIALIZE_FLAG) {
            revert InvalidGuardAddress();
        }
        if (address(poolManager_).code.length == 0) revert UnexpectedManager();
        if (factory_ == address(0)) revert UnexpectedInitializer();
        poolManager = poolManager_;
        factory = factory_;
    }

    function getHookPermissions() external pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view returns (bytes4) {
        if (msg.sender != address(poolManager)) revert UnexpectedManager();
        if (sender != factory) revert UnexpectedInitializer();
        if (address(key.hooks) != address(this)) revert UnexpectedPoolKey();
        return IHooks.beforeInitialize.selector;
    }
}
