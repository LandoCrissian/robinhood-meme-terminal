// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

contract V4GraduationHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    address public immutable deployer;
    address public adapter;
    mapping(PoolId poolId => bool reserved) public isReserved;
    mapping(PoolId poolId => bool open) public isOpen;

    event PoolReserved(PoolId indexed poolId);
    event PoolOpened(PoolId indexed poolId);
    event AdapterBound(address indexed adapter);

    error OnlyAdapter();
    error OnlyDeployer();
    error AdapterAlreadyBound();
    error PoolAlreadyReserved();
    error PoolNotReserved();
    error PoolAlreadyOpen();
    error PoolClosed();

    modifier onlyAdapter() {
        if (msg.sender != adapter) revert OnlyAdapter();
        _;
    }

    constructor(IPoolManager manager) BaseHook(manager) {
        deployer = msg.sender;
    }

    function bindAdapter(address adapter_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (adapter != address(0)) revert AdapterAlreadyBound();
        if (adapter_ == address(0)) revert OnlyAdapter();
        adapter = adapter_;
        emit AdapterBound(adapter_);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeAddLiquidity = true;
        permissions.beforeSwap = true;
    }

    function reserve(PoolKey calldata key) external onlyAdapter returns (PoolId poolId) {
        poolId = key.toId();
        if (isReserved[poolId]) revert PoolAlreadyReserved();
        isReserved[poolId] = true;
        emit PoolReserved(poolId);
    }

    function open(PoolKey calldata key) external onlyAdapter {
        PoolId poolId = key.toId();
        if (!isReserved[poolId]) revert PoolNotReserved();
        if (isOpen[poolId]) revert PoolAlreadyOpen();
        isOpen[poolId] = true;
        emit PoolOpened(poolId);
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        if (sender != adapter) revert OnlyAdapter();
        if (!isReserved[key.toId()]) revert PoolNotReserved();
        return BaseHook.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (!isReserved[key.toId()]) revert PoolNotReserved();
        if (!isOpen[key.toId()] && sender != adapter) revert PoolClosed();
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!isOpen[key.toId()]) revert PoolClosed();
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}
