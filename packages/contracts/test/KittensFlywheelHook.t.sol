// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {KittensFlywheelHook} from "../src/KittensFlywheelHook.sol";
import {KittensToken} from "../src/KittensToken.sol";
import {IKittensFeeVault} from "../src/interfaces/IKittensFeeVault.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

contract MockKittensFeeVault is IKittensFeeVault {
    uint256 public credited;

    function creditFee(uint256 amount) external {
        credited += amount;
    }
}

contract TestKittensFlywheelHook is KittensFlywheelHook {
    constructor(IPoolManager manager, address token, IKittensFeeVault vault, int24 spacing)
        KittensFlywheelHook(manager, token, vault, spacing, msg.sender)
    {}

    function validateHookAddress(BaseHook) internal pure override {}
}

contract MockKittensPoolManager {
    Currency public lastCurrency;
    address public lastRecipient;
    uint256 public lastTakeAmount;

    function take(Currency currency, address to, uint256 amount) external {
        lastCurrency = currency;
        lastRecipient = to;
        lastTakeAmount = amount;
    }

    function initialize(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        return hook.beforeInitialize(sender, key, 1 << 96);
    }

    function addLiquidity(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -200, tickUpper: 200, liquidityDelta: 1, salt: bytes32(0)});
        return hook.beforeAddLiquidity(sender, key, params, "");
    }

    function removeLiquidity(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -200, tickUpper: 200, liquidityDelta: -1, salt: bytes32(0)});
        return hook.beforeRemoveLiquidity(sender, key, params, "");
    }

    function beforeSwap(IHooks hook, address sender, PoolKey calldata key, SwapParams calldata params)
        external
        returns (BeforeSwapDelta hookDelta, uint24 feeOverride)
    {
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) = hook.beforeSwap(sender, key, params, "");
        require(selector == IHooks.beforeSwap.selector, "selector");
        return (delta, fee);
    }

    function afterSwap(
        IHooks hook,
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta
    ) external returns (int128 hookDelta) {
        (bytes4 selector, int128 returnedDelta) = hook.afterSwap(sender, key, params, delta, "");
        require(selector == IHooks.afterSwap.selector, "selector");
        return returnedDelta;
    }

    function donate(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        return hook.beforeDonate(sender, key, 1, 1, "");
    }
}

contract KittensFlywheelHookTest {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;

    function _deploy()
        private
        returns (
            MockKittensPoolManager manager,
            TestKittensFlywheelHook hook,
            MockKittensFeeVault vault,
            PoolKey memory key
        )
    {
        manager = new MockKittensPoolManager();
        vault = new MockKittensFeeVault();
        KittensToken token = new KittensToken(address(this));
        hook = new TestKittensFlywheelHook(IPoolManager(address(manager)), address(token), vault, 200);
        hook.bindLiquidityController(address(this));
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: 200,
            hooks: IHooks(address(hook))
        });
    }

    function testCanonicalPoolIsControllerInitializedAndLiquidityCannotBeRemoved() public {
        (MockKittensPoolManager manager, TestKittensFlywheelHook hook,, PoolKey memory key) = _deploy();

        require(
            manager.initialize(hook, address(this), key) == IHooks.beforeInitialize.selector,
            "controller initialize blocked"
        );
        require(
            manager.addLiquidity(hook, address(this), key) == IHooks.beforeAddLiquidity.selector,
            "controller liquidity blocked"
        );

        (bool outsideLiquidity,) =
            address(manager).call(abi.encodeCall(manager.addLiquidity, (hook, address(0xBAD), key)));
        require(!outsideLiquidity, "outside liquidity accepted");

        (bool removal,) = address(manager).call(abi.encodeCall(manager.removeLiquidity, (hook, address(this), key)));
        require(!removal, "locked liquidity removed");
    }

    function testSwapsRemainClosedUntilOneWayOpen() public {
        (MockKittensPoolManager manager, TestKittensFlywheelHook hook,, PoolKey memory key) = _deploy();
        SwapParams memory buy = SwapParams({zeroForOne: true, amountSpecified: -10_000, sqrtPriceLimitX96: 1});

        (bool closed,) = address(manager).call(abi.encodeCall(manager.beforeSwap, (hook, address(this), key, buy)));
        require(!closed, "pre-open swap accepted");

        hook.openSwaps();
        manager.beforeSwap(hook, address(this), key, buy);
        (bool secondOpen,) = address(hook).call(abi.encodeCall(hook.openSwaps, ()));
        require(!secondOpen, "swaps opened twice");
    }

    function testExactInputBuyChargesOnePercentNativeBeforePoolSwap() public {
        (MockKittensPoolManager manager, TestKittensFlywheelHook hook, MockKittensFeeVault vault, PoolKey memory key) =
            _deploy();
        hook.openSwaps();
        SwapParams memory buy = SwapParams({zeroForOne: true, amountSpecified: -10_000, sqrtPriceLimitX96: 1});

        (BeforeSwapDelta delta, uint24 feeOverride) = manager.beforeSwap(hook, address(0xCAFE), key, buy);
        require(delta.getSpecifiedDelta() == 100, "wrong buy fee delta");
        require(delta.getUnspecifiedDelta() == 0, "unexpected buy output delta");
        require(feeOverride == 0, "lp fee override used");
        require(manager.lastTakeAmount() == 100, "native buy fee not taken");
        require(Currency.unwrap(manager.lastCurrency()) == address(0), "buy fee not native");
        require(manager.lastRecipient() == address(vault), "buy fee wrong recipient");
        require(vault.credited() == 100, "buy fee not credited");
    }

    function testExactInputSellChargesOnePercentOfActualNativeOutput() public {
        (MockKittensPoolManager manager, TestKittensFlywheelHook hook, MockKittensFeeVault vault, PoolKey memory key) =
            _deploy();
        hook.openSwaps();
        SwapParams memory sell = SwapParams({zeroForOne: false, amountSpecified: -20_000, sqrtPriceLimitX96: type(uint160).max});

        (BeforeSwapDelta beforeDelta,) = manager.beforeSwap(hook, address(0xCAFE), key, sell);
        require(BeforeSwapDelta.unwrap(beforeDelta) == 0, "sell charged before output exists");

        BalanceDelta poolDelta = toBalanceDelta(10_000, -20_000);
        int128 afterDelta = manager.afterSwap(hook, address(0xCAFE), key, sell, poolDelta);
        require(afterDelta == 100, "wrong sell output fee");
        require(manager.lastTakeAmount() == 100, "native sell fee not taken");
        require(Currency.unwrap(manager.lastCurrency()) == address(0), "sell fee not native");
        require(manager.lastRecipient() == address(vault), "sell fee wrong recipient");
        require(vault.credited() == 100, "sell fee not credited");
    }

    function testExactOutputIsRejectedInBothDirections() public {
        (MockKittensPoolManager manager, TestKittensFlywheelHook hook,, PoolKey memory key) = _deploy();
        hook.openSwaps();
        SwapParams memory exactOutputBuy =
            SwapParams({zeroForOne: true, amountSpecified: 1_000, sqrtPriceLimitX96: 1});
        SwapParams memory exactOutputSell =
            SwapParams({zeroForOne: false, amountSpecified: 1_000, sqrtPriceLimitX96: type(uint160).max});

        (bool buyAccepted,) =
            address(manager).call(abi.encodeCall(manager.beforeSwap, (hook, address(this), key, exactOutputBuy)));
        (bool sellAccepted,) =
            address(manager).call(abi.encodeCall(manager.beforeSwap, (hook, address(this), key, exactOutputSell)));
        require(!buyAccepted && !sellAccepted, "exact output enabled");
    }

    function testWrongPoolAndDonationsFailClosed() public {
        (MockKittensPoolManager manager, TestKittensFlywheelHook hook,, PoolKey memory key) = _deploy();
        hook.openSwaps();

        PoolKey memory wrongKey = key;
        wrongKey.fee = 5_000;
        SwapParams memory buy = SwapParams({zeroForOne: true, amountSpecified: -10_000, sqrtPriceLimitX96: 1});
        (bool wrongPool,) =
            address(manager).call(abi.encodeCall(manager.beforeSwap, (hook, address(this), wrongKey, buy)));
        require(!wrongPool, "wrong pool accepted");

        (bool donation,) = address(manager).call(abi.encodeCall(manager.donate, (hook, address(this), key)));
        require(!donation, "donation accepted");
    }

    function testLiquidityControllerBindingIsDeployerOnlyAndPermanent() public {
        MockKittensPoolManager manager = new MockKittensPoolManager();
        MockKittensFeeVault vault = new MockKittensFeeVault();
        KittensToken token = new KittensToken(address(this));
        TestKittensFlywheelHook hook =
            new TestKittensFlywheelHook(IPoolManager(address(manager)), address(token), vault, 200);

        (bool eoaController,) = address(hook).call(abi.encodeCall(hook.bindLiquidityController, (address(0xCAFE))));
        require(!eoaController, "EOA controller bound");
        hook.bindLiquidityController(address(this));
        (bool rebound,) = address(hook).call(abi.encodeCall(hook.bindLiquidityController, (address(this))));
        require(!rebound, "controller rebound");
    }
}
