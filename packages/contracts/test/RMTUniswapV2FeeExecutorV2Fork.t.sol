// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTUniswapV2FeeExecutorV2, IRMTArbSysUniswapV2} from "../src/RMTUniswapV2FeeExecutorV2.sol";

interface ICanonicalUniswapV2RouterQuote {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

/// @notice Opt-in, non-broadcast Robinhood mainnet fork proof for the canonical WETH/PONS V2 pair.
/// @dev Run with RMT_RUN_UNISWAP_V2_FEE_FORK=true forge test --match-contract RMTUniswapV2FeeExecutorV2ForkTest -vvv
contract RMTUniswapV2FeeExecutorV2ForkTest is Test {
    address private constant ROUTER = 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba;
    address private constant FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant PONS = 0x39dBED3a2bd333467115dE45665cC57F813C4571;
    address private constant WETH_PONS_PAIR = 0x8018Ee3ad3c0321bE0e69536733CD28e29564dD4;
    address private constant TREASURY = 0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC;
    address private constant TRADER = address(0xA11CE);
    bytes32 private constant ROUTER_HASH = 0xbd55ea26b2f8d42a8ff151511cef92a326a9817686899fe96a8a8f81ee7fc55e;
    bytes32 private constant FACTORY_HASH = 0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0;
    bytes32 private constant PAIR_HASH = 0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5;
    bytes32 private constant WETH_HASH = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;
    bytes32 private constant POLICY_HASH = 0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484;
    bool private enabled;
    RMTUniswapV2FeeExecutorV2 private executor;

    function setUp() public {
        enabled = vm.envOr("RMT_RUN_UNISWAP_V2_FEE_FORK", false);
        if (!enabled) return;
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com/"));
        vm.createSelectFork(rpc);
        vm.mockCall(
            address(100), abi.encodeWithSelector(IRMTArbSysUniswapV2.arbBlockNumber.selector), abi.encode(block.number)
        );
        executor = new RMTUniswapV2FeeExecutorV2(
            ROUTER,
            ROUTER_HASH,
            FACTORY,
            FACTORY_HASH,
            PAIR_HASH,
            WETH,
            WETH_HASH,
            TREASURY,
            keccak256("RMT_EXECUTION_V2"),
            2,
            POLICY_HASH,
            25,
            51_296_658,
            0
        );
        vm.deal(TRADER, 1 ether);
    }

    function testCanonicalNativeToTokenAndTokenToNativeRoundTrip() public {
        if (!enabled) return;
        uint256 grossNative = 100_000_000_000_000;
        RMTUniswapV2FeeExecutorV2.Route memory buyRoute = _route(WETH, PONS);
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory buy =
            _authorization(buyRoute, address(0), PONS, grossNative, keccak256("fork-buy"));
        uint256 treasuryNativeBefore = TREASURY.balance;
        uint256 traderTokenBefore = IERC20(PONS).balanceOf(TRADER);
        vm.prank(TRADER);
        executor.execute{value: grossNative}(buy, buyRoute);
        uint256 acquired = IERC20(PONS).balanceOf(TRADER) - traderTokenBefore;
        assertGe(acquired, buy.protectedOutput);
        assertEq(TREASURY.balance - treasuryNativeBefore, buy.expectedFeeAtomic);
        _assertClean(PONS);

        uint256 grossToken = acquired;
        RMTUniswapV2FeeExecutorV2.Route memory sellRoute = _route(PONS, WETH);
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory sell =
            _authorization(sellRoute, PONS, address(0), grossToken, keccak256("fork-sell"));
        uint256 treasuryTokenBefore = IERC20(PONS).balanceOf(TREASURY);
        uint256 traderNativeBefore = TRADER.balance;
        vm.prank(TRADER);
        IERC20(PONS).approve(address(executor), grossToken);
        vm.prank(TRADER);
        executor.execute(sell, sellRoute);
        assertGe(TRADER.balance - traderNativeBefore, sell.protectedOutput);
        assertEq(IERC20(PONS).balanceOf(TREASURY) - treasuryTokenBefore, sell.expectedFeeAtomic);
        assertEq(IERC20(PONS).allowance(TRADER, address(executor)), 0);
        _assertClean(PONS);
    }

    function _route(address tokenIn, address tokenOut) private pure returns (RMTUniswapV2FeeExecutorV2.Route memory) {
        return RMTUniswapV2FeeExecutorV2.Route({
            kind: RMTUniswapV2FeeExecutorV2.RouteKind.DIRECT,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            pair0: WETH_PONS_PAIR,
            pair1: address(0)
        });
    }

    function _authorization(
        RMTUniswapV2FeeExecutorV2.Route memory route,
        address requestedInput,
        address requestedOutput,
        uint256 gross,
        bytes32 executionId
    ) private view returns (RMTUniswapV2FeeExecutorV2.FeeAuthorization memory) {
        uint256 fee = gross * 25 / 10_000;
        uint256 providerInput = gross - fee;
        address[] memory path = new address[](2);
        path[0] = route.tokenIn;
        path[1] = route.tokenOut;
        uint256[] memory amounts = ICanonicalUniswapV2RouterQuote(ROUTER).getAmountsOut(providerInput, path);
        uint256 expected = amounts[1];
        return RMTUniswapV2FeeExecutorV2.FeeAuthorization({
            executionId: executionId,
            policyIdHash: keccak256("RMT_EXECUTION_V2"),
            policyVersion: 2,
            policyHash: POLICY_HASH,
            feeBps: 25,
            feeSide: RMTUniswapV2FeeExecutorV2.FeeSide.INPUT,
            feeAsset: requestedInput,
            treasury: TREASURY,
            trader: TRADER,
            requestedInputAsset: requestedInput,
            requestedOutputAsset: requestedOutput,
            routedInputAsset: route.tokenIn,
            routedOutputAsset: route.tokenOut,
            userGrossInput: gross,
            expectedFeeAtomic: fee,
            maximumFeeAtomic: fee,
            providerInput: providerInput,
            expectedProviderOutput: expected,
            protectedOutput: expected * 99 / 100,
            deadline: block.timestamp + 4 minutes,
            routeIdentity: executor.routeIdentity(route)
        });
    }

    function _assertClean(address token) private view {
        assertEq(address(executor).balance, 0);
        assertEq(IERC20(WETH).balanceOf(address(executor)), 0);
        assertEq(IERC20(token).balanceOf(address(executor)), 0);
        assertEq(IERC20(token).allowance(address(executor), ROUTER), 0);
    }
}
