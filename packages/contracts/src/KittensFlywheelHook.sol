// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IKittensFeeVault} from "./interfaces/IKittensFeeVault.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title KittensFlywheelHook
/// @notice Canonical KITTENS/native-CASHCAT Uniswap v4 hook for the isolated RMT Labs experiment.
/// @dev V1 deliberately supports exact-input swaps only. A 1% hook fee is always denominated in the chain's
///      native currency: buys reserve 1% of native input before the pool swap; sells reserve 1% of native output
///      after the pool swap. KITTENS transfers themselves remain untaxed.
contract KittensFlywheelHook is BaseHook {
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant HOOK_FEE_BPS = 100; // 1.00%
    uint24 public constant CORE_LP_FEE = 0;

    address public immutable token;
    IKittensFeeVault public immutable feeVault;
    address public immutable deployer;
    int24 public immutable tickSpacing;

    address public liquidityController;
    bool public swapsOpen;

    event LiquidityControllerBound(address indexed controller);
    event SwapsOpened(address indexed controller);
    event FlywheelFeeAccrued(address indexed trader, bool indexed isBuy, uint256 nativeAmount);

    error OnlyDeployer();
    error OnlyLiquidityController();
    error ControllerAlreadyBound();
    error InvalidConfiguration();
    error InvalidPool();
    error SwapsClosed();
    error SwapsAlreadyOpen();
    error ExactOutputDisabled();
    error FeeAmountTooLarge();
    error LiquidityLocked();
    error DonationsDisabled();

    modifier onlyLiquidityController() {
        if (msg.sender != liquidityController) revert OnlyLiquidityController();
        _;
    }

    constructor(
        IPoolManager manager,
        address token_,
        IKittensFeeVault feeVault_,
        int24 tickSpacing_,
        address deployer_
    ) BaseHook(manager) {
        if (
            token_ == address(0) || token_.code.length == 0 || address(feeVault_) == address(0)
                || address(feeVault_).code.length == 0 || tickSpacing_ <= 0 || tickSpacing_ > 32_767
                || deployer_ == address(0)
        ) revert InvalidConfiguration();
        token = token_;
        feeVault = feeVault_;
        tickSpacing = tickSpacing_;
        deployer = deployer_;
    }

    function bindLiquidityController(address controller) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (liquidityController != address(0)) revert ControllerAlreadyBound();
        if (controller == address(0) || controller.code.length == 0) revert InvalidConfiguration();
        liquidityController = controller;
        emit LiquidityControllerBound(controller);
    }

    /// @notice Irreversibly opens swaps after the deployment controller has seeded and verified liquidity.
    function openSwaps() external onlyLiquidityController {
        if (swapsOpen) revert SwapsAlreadyOpen();
        swapsOpen = true;
        emit SwapsOpened(msg.sender);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeAddLiquidity = true;
        permissions.beforeRemoveLiquidity = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
        permissions.beforeDonate = true;
        permissions.beforeSwapReturnDelta = true;
        permissions.afterSwapReturnDelta = true;
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160)
        internal
        view
        override
        returns (bytes4)
    {
        _validatePool(key);
        if (sender != liquidityController || liquidityController == address(0)) revert OnlyLiquidityController();
        return BaseHook.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        _validatePool(key);
        if (sender != liquidityController || liquidityController == address(0)) revert OnlyLiquidityController();
        return BaseHook.beforeAddLiquidity.selector;
    }

    /// @dev There is intentionally no principal-removal path, including for the liquidity controller.
    function _beforeRemoveLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        _validatePool(key);
        revert LiquidityLocked();
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _validateTrade(key, params);

        // Native CASHCAT is currency0 and KITTENS is currency1. zeroForOne is therefore a buy.
        if (!params.zeroForOne) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 inputAmount = uint256(-params.amountSpecified);
        uint256 feeAmount = inputAmount * HOOK_FEE_BPS / BPS_DENOMINATOR;
        if (feeAmount == 0) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        if (feeAmount > uint256(uint128(type(int128).max))) revert FeeAmountTooLarge();

        // Positive specified delta gives the hook a claim against PoolManager and reduces the amount sent to the pool.
        poolManager.take(key.currency0, address(feeVault), feeAmount);
        feeVault.creditFee(feeAmount);
        emit FlywheelFeeAccrued(sender, true, feeAmount);

        return (
            BaseHook.beforeSwap.selector,
            toBeforeSwapDelta(int128(int256(feeAmount)), 0),
            0
        );
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        _validateTrade(key, params);

        // Buys were charged from native input in beforeSwap. Sells are charged from actual native output here.
        if (params.zeroForOne) return (BaseHook.afterSwap.selector, 0);

        int128 nativeOutput = delta.amount0();
        if (nativeOutput <= 0) revert InvalidPool();
        uint256 feeAmount = uint256(uint128(nativeOutput)) * HOOK_FEE_BPS / BPS_DENOMINATOR;
        if (feeAmount == 0) return (BaseHook.afterSwap.selector, 0);
        if (feeAmount > uint256(uint128(type(int128).max))) revert FeeAmountTooLarge();

        // Positive unspecified delta gives the hook a claim against native output and reduces trader proceeds.
        poolManager.take(key.currency0, address(feeVault), feeAmount);
        feeVault.creditFee(feeAmount);
        emit FlywheelFeeAccrued(sender, false, feeAmount);
        return (BaseHook.afterSwap.selector, int128(int256(feeAmount)));
    }

    function _beforeDonate(address, PoolKey calldata key, uint256, uint256, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        _validatePool(key);
        revert DonationsDisabled();
    }

    function _validateTrade(PoolKey calldata key, SwapParams calldata params) private view {
        _validatePool(key);
        if (!swapsOpen) revert SwapsClosed();
        if (params.amountSpecified >= 0 || params.amountSpecified == type(int256).min) revert ExactOutputDisabled();
    }

    function _validatePool(PoolKey calldata key) private view {
        if (
            Currency.unwrap(key.currency0) != address(0) || Currency.unwrap(key.currency1) != token
                || key.fee != CORE_LP_FEE || key.tickSpacing != tickSpacing || address(key.hooks) != address(this)
        ) revert InvalidPool();
    }
}
