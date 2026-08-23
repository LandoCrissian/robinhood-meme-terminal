// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV3FeeExecutorV2, IRMTArbSysV2} from "../src/RMTUniswapV3FeeExecutorV2.sol";

interface FeeExecutorForkTokenV2 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface FeeExecutorForkRouterStateV2 {
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

interface FeeExecutorForkFactoryV2 {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface FeeExecutorForkQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @dev Opt-in read/write fork simulation only. No call is ever broadcast.
///      Run with: RMT_RUN_MAINNET_FORK=true forge test --match-path test/RMTUniswapV3FeeExecutorV2Fork.t.sol -vv
contract RMTUniswapV3FeeExecutorV2ForkTest is Test {
    address private constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant WETH_IMPLEMENTATION = 0xC6B81b429797E0f555440b70cD99e032D7AE947e;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant WALLET = address(0xA11CE);
    address private constant TEST_TREASURY = address(0xBEEF); // test-only; no production treasury is selected
    bytes32 private constant ROUTER_RUNTIME_HASH = 0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc;
    bytes32 private constant FACTORY_RUNTIME_HASH = 0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739;
    bytes32 private constant WETH_RUNTIME_HASH = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;
    bytes32 private constant WETH_IMPLEMENTATION_RUNTIME_HASH =
        0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650;
    bytes32 private constant EIP1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant POLICY_HASH = keccak256("test-only-v2-fork-policy");
    bytes32 private constant POLICY_ID_HASH = keccak256("RMT_EXECUTION_V2");
    uint24 private constant FEE = 100;

    bool private enabled;
    RMTUniswapV3FeeExecutorV2 private executor;

    function setUp() public {
        enabled = vm.envOr("RMT_RUN_MAINNET_FORK", false);
        if (!enabled) return;
        vm.createSelectFork("robinhood_mainnet");
        vm.mockCall(
            address(100), abi.encodeWithSelector(IRMTArbSysV2.arbBlockNumber.selector), abi.encode(block.number)
        );
        executor = new RMTUniswapV3FeeExecutorV2(
            ROUTER,
            ROUTER_RUNTIME_HASH,
            FACTORY,
            FACTORY_RUNTIME_HASH,
            WETH,
            WETH_RUNTIME_HASH,
            WETH_IMPLEMENTATION,
            WETH_IMPLEMENTATION_RUNTIME_HASH,
            TEST_TREASURY,
            POLICY_ID_HASH,
            2,
            POLICY_HASH,
            25,
            1,
            0
        );
    }

    function testCanonicalRuntimeAndNativeTokenRoundTrip() public {
        if (!enabled) return;
        assertEq(block.chainid, 4_663);
        assertEq(executor.currentPolicyBlock(), block.number);
        assertEq(ROUTER.codehash, ROUTER_RUNTIME_HASH);
        assertEq(FACTORY.codehash, FACTORY_RUNTIME_HASH);
        assertEq(WETH.codehash, WETH_RUNTIME_HASH);
        assertEq(address(uint160(uint256(vm.load(WETH, EIP1967_IMPLEMENTATION_SLOT)))), WETH_IMPLEMENTATION);
        assertEq(WETH_IMPLEMENTATION.codehash, WETH_IMPLEMENTATION_RUNTIME_HASH);
        assertEq(FeeExecutorForkRouterStateV2(ROUTER).factory(), FACTORY);
        assertEq(FeeExecutorForkRouterStateV2(ROUTER).WETH9(), WETH);
        address pool = FeeExecutorForkFactoryV2(FACTORY).getPool(WETH, USDG, FEE);
        assertTrue(pool != address(0) && pool.code.length != 0);

        vm.deal(WALLET, 1 ether);
        uint256 grossNativeInput = 0.001 ether;
        uint256 nativeFee = grossNativeInput * 25 / 10_000;
        uint256 nativeProviderInput = grossNativeInput - nativeFee;
        (uint256 expectedUsdg,,,) = FeeExecutorForkQuoterV2(QUOTER)
            .quoteExactInputSingle(
                FeeExecutorForkQuoterV2.QuoteExactInputSingleParams({
                tokenIn: WETH, tokenOut: USDG, amountIn: nativeProviderInput, fee: FEE, sqrtPriceLimitX96: 0
            })
            );
        uint256 minimumUsdg = expectedUsdg * 99 / 100;
        RMTUniswapV3FeeExecutorV2.Route memory buyRoute = _route(WETH, USDG, pool);
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory buy = _authorization(
            keccak256("fork-v2-native-buy"), address(0), USDG, grossNativeInput, expectedUsdg, minimumUsdg, buyRoute
        );
        uint256 walletUsdgBefore = FeeExecutorForkTokenV2(USDG).balanceOf(WALLET);
        uint256 treasuryNativeBefore = TEST_TREASURY.balance;
        vm.prank(WALLET);
        (uint256 actualUsdg, uint256 settledNativeFee) = executor.execute{value: grossNativeInput}(buy, buyRoute);
        assertGe(actualUsdg, minimumUsdg);
        assertEq(settledNativeFee, nativeFee);
        assertEq(TEST_TREASURY.balance - treasuryNativeBefore, nativeFee);
        assertEq(FeeExecutorForkTokenV2(USDG).balanceOf(WALLET) - walletUsdgBefore, actualUsdg);
        assertEq(address(executor).balance, 0);

        uint256 sellFee = actualUsdg * 25 / 10_000;
        uint256 sellProviderInput = actualUsdg - sellFee;
        (uint256 expectedNative,,,) = FeeExecutorForkQuoterV2(QUOTER)
            .quoteExactInputSingle(
                FeeExecutorForkQuoterV2.QuoteExactInputSingleParams({
                tokenIn: USDG, tokenOut: WETH, amountIn: sellProviderInput, fee: FEE, sqrtPriceLimitX96: 0
            })
            );
        uint256 minimumNative = expectedNative * 99 / 100;
        RMTUniswapV3FeeExecutorV2.Route memory sellRoute = _route(USDG, WETH, pool);
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory sell = _authorization(
            keccak256("fork-v2-native-sell"), USDG, address(0), actualUsdg, expectedNative, minimumNative, sellRoute
        );
        vm.prank(WALLET);
        FeeExecutorForkTokenV2(USDG).approve(address(executor), actualUsdg);
        uint256 walletNativeBefore = WALLET.balance;
        uint256 treasuryUsdgBefore = FeeExecutorForkTokenV2(USDG).balanceOf(TEST_TREASURY);
        vm.prank(WALLET);
        (uint256 actualNative, uint256 settledUsdgFee) = executor.execute(sell, sellRoute);
        assertGe(actualNative, minimumNative);
        assertEq(settledUsdgFee, sellFee);
        assertEq(WALLET.balance - walletNativeBefore, actualNative);
        assertEq(FeeExecutorForkTokenV2(USDG).balanceOf(TEST_TREASURY) - treasuryUsdgBefore, sellFee);
        assertEq(FeeExecutorForkTokenV2(USDG).allowance(address(executor), ROUTER), 0);
        assertEq(FeeExecutorForkTokenV2(USDG).balanceOf(address(executor)), 0);
        assertEq(FeeExecutorForkTokenV2(WETH).balanceOf(address(executor)), 0);
        assertEq(address(executor).balance, 0);

        vm.expectRevert(RMTUniswapV3FeeExecutorV2.ExecutionAlreadyConsumed.selector);
        vm.prank(WALLET);
        executor.execute(sell, sellRoute);
    }

    function _route(address tokenIn, address tokenOut, address pool)
        private
        pure
        returns (RMTUniswapV3FeeExecutorV2.Route memory)
    {
        return RMTUniswapV3FeeExecutorV2.Route({
            kind: RMTUniswapV3FeeExecutorV2.RouteKind.EXACT_INPUT_SINGLE,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee0: FEE,
            fee1: 0,
            pool0: pool,
            pool1: address(0)
        });
    }

    function _authorization(
        bytes32 executionId,
        address requestedInput,
        address requestedOutput,
        uint256 grossInput,
        uint256 expectedOutput,
        uint256 protectedOutput,
        RMTUniswapV3FeeExecutorV2.Route memory route
    ) private view returns (RMTUniswapV3FeeExecutorV2.FeeAuthorization memory) {
        uint256 fee = executor.calculateFee(grossInput);
        return RMTUniswapV3FeeExecutorV2.FeeAuthorization({
            executionId: executionId,
            policyIdHash: executor.POLICY_ID_HASH(),
            policyVersion: 2,
            policyHash: POLICY_HASH,
            feeBps: 25,
            feeSide: RMTUniswapV3FeeExecutorV2.FeeSide.INPUT,
            feeAsset: requestedInput,
            treasury: TEST_TREASURY,
            trader: WALLET,
            requestedInputAsset: requestedInput,
            requestedOutputAsset: requestedOutput,
            routedInputAsset: route.tokenIn,
            routedOutputAsset: route.tokenOut,
            userGrossInput: grossInput,
            expectedFeeAtomic: fee,
            maximumFeeAtomic: fee,
            providerInput: grossInput - fee,
            expectedProviderOutput: expectedOutput,
            protectedOutput: protectedOutput,
            deadline: block.timestamp + 5 minutes,
            routeIdentity: executor.routeIdentity(route)
        });
    }
}
