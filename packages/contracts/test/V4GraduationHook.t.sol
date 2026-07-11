// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract TestV4GraduationHook is V4GraduationHook {
    constructor(IPoolManager manager) V4GraduationHook(manager) {}

    function validateHookAddress(BaseHook) internal pure override {}
}

contract MockV4PoolManager {
    function initialize(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        return hook.beforeInitialize(sender, key, 1 << 96);
    }

    function addLiquidity(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1, salt: bytes32(0)});
        return hook.beforeAddLiquidity(sender, key, params, "");
    }

    function swap(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        (bytes4 selector,,) = hook.beforeSwap(sender, key, params, "");
        return selector;
    }
}

contract UnauthorizedHookCaller {
    function bindAdapter(V4GraduationHook hook, address adapter) external returns (bool success) {
        (success,) = address(hook).call(abi.encodeCall(hook.bindAdapter, (adapter)));
    }

    function reserve(V4GraduationHook hook, PoolKey calldata key) external returns (bool success) {
        (success,) = address(hook).call(abi.encodeCall(hook.reserve, (key)));
    }

    function open(V4GraduationHook hook, PoolKey calldata key) external returns (bool success) {
        (success,) = address(hook).call(abi.encodeCall(hook.open, (key)));
    }
}

contract V4GraduationHookTest {
    MockV4PoolManager private manager;
    TestV4GraduationHook private hook;
    PoolKey private key;

    function setUp() public {
        manager = new MockV4PoolManager();
        hook = new TestV4GraduationHook(IPoolManager(address(manager)));
        hook.bindAdapter(address(this));
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(0xBEEF)),
            fee: 10_000,
            tickSpacing: 200,
            hooks: IHooks(address(hook))
        });
    }

    function testOnlyAdapterCanReserveAndOpen() public {
        UnauthorizedHookCaller caller = new UnauthorizedHookCaller();
        require(!caller.reserve(hook, key), "unauthorized reserve accepted");

        hook.reserve(key);
        require(!caller.open(hook, key), "unauthorized open accepted");
        hook.open(key);
    }

    function testAdapterBindingIsDeployerOnlyAndPermanent() public {
        TestV4GraduationHook unboundHook = new TestV4GraduationHook(IPoolManager(address(manager)));
        UnauthorizedHookCaller caller = new UnauthorizedHookCaller();
        require(!caller.bindAdapter(unboundHook, address(caller)), "unauthorized binding accepted");

        unboundHook.bindAdapter(address(this));
        (bool rebound,) = address(unboundHook).call(abi.encodeCall(unboundHook.bindAdapter, (address(caller))));
        require(!rebound, "adapter rebound");
        require(unboundHook.adapter() == address(this), "adapter changed");
    }

    function testInitializationRequiresAtomicReservationAndAdapter() public {
        (bool unreserved,) = address(manager).call(abi.encodeCall(manager.initialize, (hook, address(this), key)));
        require(!unreserved, "unreserved initialization accepted");

        hook.reserve(key);
        (bool wrongSender,) = address(manager).call(abi.encodeCall(manager.initialize, (hook, address(0xBAD), key)));
        require(!wrongSender, "non-adapter initialization accepted");
        require(
            manager.initialize(hook, address(this), key) == IHooks.beforeInitialize.selector, "initialization blocked"
        );
    }

    function testPoolBlocksPublicLiquidityAndSwapsUntilOpened() public {
        hook.reserve(key);
        manager.initialize(hook, address(this), key);

        (bool publicLiquidity,) =
            address(manager).call(abi.encodeCall(manager.addLiquidity, (hook, address(0xBAD), key)));
        require(!publicLiquidity, "public pre-graduation liquidity accepted");
        require(
            manager.addLiquidity(hook, address(this), key) == IHooks.beforeAddLiquidity.selector,
            "adapter seed liquidity blocked"
        );

        (bool preGraduationSwap,) = address(manager).call(abi.encodeCall(manager.swap, (hook, address(0xBAD), key)));
        require(!preGraduationSwap, "pre-graduation swap accepted");

        hook.open(key);
        require(
            manager.addLiquidity(hook, address(0xBAD), key) == IHooks.beforeAddLiquidity.selector,
            "public liquidity blocked after opening"
        );
        require(manager.swap(hook, address(0xBAD), key) == IHooks.beforeSwap.selector, "swap blocked after opening");
    }

    function testReservationAndOpeningAreOneTime() public {
        hook.reserve(key);
        (bool duplicateReserve,) = address(hook).call(abi.encodeCall(hook.reserve, (key)));
        require(!duplicateReserve, "duplicate reservation accepted");

        hook.open(key);
        (bool duplicateOpen,) = address(hook).call(abi.encodeCall(hook.open, (key)));
        require(!duplicateOpen, "duplicate open accepted");
    }
}
