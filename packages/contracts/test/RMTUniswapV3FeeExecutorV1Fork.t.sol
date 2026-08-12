// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV3FeeExecutorV1} from "../src/RMTUniswapV3FeeExecutorV1.sol";

interface FeeExecutorForkToken {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface FeeExecutorForkWeth is FeeExecutorForkToken {
    function deposit() external payable;
}

interface FeeExecutorForkRouterState {
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

interface FeeExecutorForkFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface FeeExecutorForkQuoter {
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

/// @dev Opt-in, read/write fork simulation only. Foundry never broadcasts these calls.
///      Run with: RMT_RUN_MAINNET_FORK=true forge test --match-path test/RMTUniswapV3FeeExecutorV1Fork.t.sol -vv
contract RMTUniswapV3FeeExecutorV1ForkTest is Test {
    address private constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant WALLET = address(0xA11CE);
    address private constant TEST_TREASURY = address(0xBEEF); // test-only, not a production treasury
    bytes32 private constant ROUTER_RUNTIME_HASH = 0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc;
    bytes32 private constant FACTORY_RUNTIME_HASH = 0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739;
    bytes32 private constant WETH_RUNTIME_HASH = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;
    bytes32 private constant POLICY_ID_HASH = 0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb;
    bytes32 private constant POLICY_HASH = 0x3ea1930a2d170062b04acdb6584059d47a095305b70ccc8b4037aef149c58824;
    uint24 private constant FEE = 100;

    bool private enabled;
    RMTUniswapV3FeeExecutorV1 private executor;

    function setUp() public {
        enabled = vm.envOr("RMT_RUN_MAINNET_FORK", false);
        if (!enabled) return;
        vm.createSelectFork("robinhood_mainnet");
        address[] memory eligibleFeeAssets = new address[](2);
        eligibleFeeAssets[0] = WETH;
        eligibleFeeAssets[1] = USDG;
        executor = new RMTUniswapV3FeeExecutorV1(
            ROUTER,
            ROUTER_RUNTIME_HASH,
            FACTORY,
            FACTORY_RUNTIME_HASH,
            WETH,
            WETH_RUNTIME_HASH,
            TEST_TREASURY,
            eligibleFeeAssets,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            25,
            1,
            0
        );
    }

    function testCanonicalRuntimeDependenciesAndAtomicRoundTrip() public {
        if (!enabled) return;
        assertEq(block.chainid, 4_663);
        assertEq(ROUTER.codehash, ROUTER_RUNTIME_HASH);
        assertEq(FACTORY.codehash, FACTORY_RUNTIME_HASH);
        assertEq(WETH.codehash, WETH_RUNTIME_HASH);
        assertEq(FeeExecutorForkRouterState(ROUTER).factory(), FACTORY);
        assertEq(FeeExecutorForkRouterState(ROUTER).WETH9(), WETH);
        address pool = FeeExecutorForkFactory(FACTORY).getPool(WETH, USDG, FEE);
        assertTrue(pool != address(0) && pool.code.length != 0);

        vm.deal(WALLET, 1 ether);
        uint256 grossWethInput = 0.001 ether;
        uint256 inputFee = grossWethInput * 25 / 10_000;
        uint256 providerWethInput = grossWethInput - inputFee;
        uint256 treasuryWethInitial = FeeExecutorForkToken(WETH).balanceOf(TEST_TREASURY);
        vm.startPrank(WALLET);
        FeeExecutorForkWeth(WETH).deposit{value: grossWethInput}();
        FeeExecutorForkWeth(WETH).approve(address(executor), grossWethInput);
        vm.stopPrank();
        (uint256 expectedUsdg,,,) = FeeExecutorForkQuoter(QUOTER)
            .quoteExactInputSingle(
                FeeExecutorForkQuoter.QuoteExactInputSingleParams({
                tokenIn: WETH, tokenOut: USDG, amountIn: providerWethInput, fee: FEE, sqrtPriceLimitX96: 0
            })
            );
        uint256 minimumUsdg = expectedUsdg * 99 / 100;
        RMTUniswapV3FeeExecutorV1.Route memory buyRoute = _route(WETH, USDG, pool);
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory buy = RMTUniswapV3FeeExecutorV1.FeeAuthorization({
            executionId: keccak256("fork-input-side"),
            policyIdHash: POLICY_ID_HASH,
            policyVersion: 1,
            policyHash: POLICY_HASH,
            feeBps: 25,
            feeSide: RMTUniswapV3FeeExecutorV1.FeeSide.INPUT,
            feeAsset: WETH,
            expectedFeeAtomic: inputFee,
            maximumFeeAtomic: inputFee,
            trader: WALLET,
            userGrossInput: grossWethInput,
            providerInput: providerWethInput,
            expectedGrossOutput: expectedUsdg,
            routerMinimumGrossOutput: minimumUsdg,
            protectedUserNetOutput: minimumUsdg,
            deadline: block.timestamp + 5 minutes,
            routeIdentity: executor.routeIdentity(buyRoute)
        });
        uint256 usdgBefore = FeeExecutorForkToken(USDG).balanceOf(WALLET);
        vm.prank(WALLET);
        (uint256 actualUsdg, uint256 settledInputFee,) = executor.executeInputFee(buy, buyRoute);
        assertGe(actualUsdg, minimumUsdg);
        assertEq(settledInputFee, inputFee);
        assertEq(FeeExecutorForkToken(USDG).balanceOf(WALLET) - usdgBefore, actualUsdg);
        assertEq(FeeExecutorForkToken(WETH).balanceOf(TEST_TREASURY) - treasuryWethInitial, inputFee);
        assertEq(FeeExecutorForkToken(WETH).allowance(address(executor), ROUTER), 0);

        vm.prank(WALLET);
        FeeExecutorForkToken(USDG).approve(address(executor), actualUsdg);
        (uint256 expectedWeth,,,) = FeeExecutorForkQuoter(QUOTER)
            .quoteExactInputSingle(
                FeeExecutorForkQuoter.QuoteExactInputSingleParams({
                tokenIn: USDG, tokenOut: WETH, amountIn: actualUsdg, fee: FEE, sqrtPriceLimitX96: 0
            })
            );
        uint256 maximumOutputFee = expectedWeth * 25 / 10_000;
        uint256 protectedGrossWeth = expectedWeth * 99 / 100;
        uint256 protectedOutputFee = protectedGrossWeth * 25 / 10_000;
        RMTUniswapV3FeeExecutorV1.Route memory sellRoute = _route(USDG, WETH, pool);
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory sell = RMTUniswapV3FeeExecutorV1.FeeAuthorization({
            executionId: keccak256("fork-output-side"),
            policyIdHash: POLICY_ID_HASH,
            policyVersion: 1,
            policyHash: POLICY_HASH,
            feeBps: 25,
            feeSide: RMTUniswapV3FeeExecutorV1.FeeSide.OUTPUT,
            feeAsset: WETH,
            expectedFeeAtomic: maximumOutputFee,
            maximumFeeAtomic: maximumOutputFee,
            trader: WALLET,
            userGrossInput: actualUsdg,
            providerInput: actualUsdg,
            expectedGrossOutput: expectedWeth,
            routerMinimumGrossOutput: protectedGrossWeth,
            protectedUserNetOutput: protectedGrossWeth - protectedOutputFee,
            deadline: block.timestamp + 5 minutes,
            routeIdentity: executor.routeIdentity(sellRoute)
        });
        uint256 walletWethBefore = FeeExecutorForkToken(WETH).balanceOf(WALLET);
        uint256 treasuryWethBefore = FeeExecutorForkToken(WETH).balanceOf(TEST_TREASURY);
        vm.prank(WALLET);
        (uint256 grossWeth, uint256 outputFee, uint256 netWeth) = executor.executeOutputFee(sell, sellRoute);
        assertEq(outputFee, grossWeth * 25 / 10_000 > maximumOutputFee ? maximumOutputFee : grossWeth * 25 / 10_000);
        assertEq(netWeth, grossWeth - outputFee);
        assertGe(netWeth, sell.protectedUserNetOutput);
        assertEq(FeeExecutorForkToken(WETH).balanceOf(WALLET) - walletWethBefore, netWeth);
        assertEq(FeeExecutorForkToken(WETH).balanceOf(TEST_TREASURY) - treasuryWethBefore, outputFee);
        assertEq(FeeExecutorForkToken(USDG).allowance(address(executor), ROUTER), 0);
        assertEq(FeeExecutorForkToken(WETH).balanceOf(address(executor)), 0);
        assertEq(FeeExecutorForkToken(USDG).balanceOf(address(executor)), 0);
    }

    function _route(address tokenIn, address tokenOut, address pool)
        private
        pure
        returns (RMTUniswapV3FeeExecutorV1.Route memory)
    {
        return RMTUniswapV3FeeExecutorV1.Route({
            kind: RMTUniswapV3FeeExecutorV1.RouteKind.EXACT_INPUT_SINGLE,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee0: FEE,
            fee1: 0,
            pool0: pool,
            pool1: address(0)
        });
    }
}
