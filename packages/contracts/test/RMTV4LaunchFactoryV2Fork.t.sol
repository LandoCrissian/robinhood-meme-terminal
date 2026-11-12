// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ILaunchPermit2V1, ILaunchPositionManagerV1} from "../src/RMTV4LaunchFactoryV1.sol";
import {RMTV4LaunchFactoryV2} from "../src/RMTV4LaunchFactoryV2.sol";
import {RMTV4LongevityLedger} from "../src/RMTV4LongevityLedger.sol";
import {GuardedLaunchFixture} from "./RMTV4LaunchFactoryV2.t.sol";
import {ILaunchUniversalRouterV1} from "./RMTV4LaunchFactoryV1Fork.t.sol";

contract RMTV4LaunchFactoryV2ForkTest is GuardedLaunchFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager private manager;
    PositionManager private positionManager;
    IAllowanceTransfer private permit2;
    ILaunchUniversalRouterV1 private router;
    IV4Quoter private quoter;
    RMTV4LaunchFactoryV2 private factory;
    address private creator = makeAddr("fork guarded creator");
    address private buyer = makeAddr("fork ordinary buyer and LP");
    address private treasury = makeAddr("fork project treasury");
    address private reserve = makeAddr("fork liquidity reserve");

    function testForkGuardedPoolQuotesSwapsIndependentLiquidityAndLongevityClaims() public {
        string memory upstream = vm.envOr("RMT_V4_BASE_SEPOLIA_RPC", string(""));
        if (bytes(upstream).length == 0) vm.skip(true);
        _forkAndVerify(upstream);
        vm.deal(creator, 2 ether);
        vm.deal(buyer, 2 ether);
        uint256 deadline = block.timestamp + 15 minutes;
        RMTV4LaunchFactoryV2.Terms memory terms = RMTV4LaunchFactoryV2.Terms(
            "Guarded Fork Launch", "FORKV2", "", bytes32(uint256(1)), 0, 8_000, 1 ether, deadline
        );
        RMTV4LongevityLedger.FeePolicy memory policy =
            RMTV4LongevityLedger.FeePolicy(treasury, reserve, 7_000, 2_000, 1_000);
        vm.prank(creator);
        address token = factory.launchWithLongevity{value: terms.nativeAmount}(terms, policy);
        (, uint256 lockedPosition, uint128 lockedLiquidity) = factory.positions(token);
        PoolKey memory key = _pool(token, address(factory.initializationGuard()));
        (PoolKey memory recordedKey,) = positionManager.getPoolAndPositionInfo(lockedPosition);
        assertEq(PoolId.unwrap(recordedKey.toId()), PoolId.unwrap(key.toId()));

        uint128 buyQuote = _trade(key, true, 0.2 ether, deadline);
        assertEq(IERC20(token).balanceOf(buyer), buyQuote);
        _addExternalLiquidity(key, deadline);
        uint128 sellAmount = uint128(IERC20(token).balanceOf(buyer) / 2);
        uint256 nativeBeforeSell = buyer.balance;
        uint128 sellQuote = _trade(key, false, sellAmount, deadline);
        assertEq(buyer.balance, nativeBeforeSell + sellQuote);

        _exerciseClaims(token, deadline);
        assertEq(positionManager.ownerOf(lockedPosition), address(factory));
        assertEq(positionManager.getPositionLiquidity(lockedPosition), lockedLiquidity);
    }

    function _forkAndVerify(string memory upstream) private {
        string memory pins = vm.readFile("test/fixtures/rmt-v4-deployment-identities.json");
        uint256 anchor = vm.parseJsonUint(pins, ".baseSepolia.block");
        vm.createSelectFork(upstream, anchor + 1);
        assertEq(block.chainid, vm.parseJsonUint(pins, ".baseSepolia.chainId"));
        assertEq(blockhash(anchor), vm.parseJsonBytes32(pins, ".baseSepolia.blockHash"));
        vm.rollFork(anchor);
        manager = IPoolManager(_verifiedAddress(pins, "poolManager"));
        positionManager = PositionManager(payable(_verifiedAddress(pins, "positionManager")));
        permit2 = IAllowanceTransfer(_verifiedAddress(pins, "permit2"));
        router = ILaunchUniversalRouterV1(_verifiedAddress(pins, "universalRouter"));
        quoter = IV4Quoter(_verifiedAddress(pins, "quoter"));
        _verifiedAddress(pins, "stateView");
        assertEq(address(router.poolManager()), address(manager));
        assertEq(address(quoter.poolManager()), address(manager));
        vm.chainId(31337);
        factory = _deployPair(
            manager,
            ILaunchPositionManagerV1(address(positionManager)),
            ILaunchPermit2V1(address(permit2)),
            _predictPair(manager)
        );
    }

    function _trade(PoolKey memory key, bool buy, uint128 amountIn, uint256 deadline) private returns (uint128 output) {
        (uint256 quote,) = quoter.quoteExactInputSingle(IV4Quoter.QuoteExactSingleParams(key, buy, amountIn, ""));
        assertGt(quote, 0);
        assertLt(quote, type(uint128).max);
        (uint160 price,, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(key.toId());
        assertEq(protocolFee, 0);
        uint160 boundary = TickMath.getSqrtPriceAtTick(buy ? factory.TICK_LOWER() : factory.TICK_UPPER());
        (uint160 next, uint256 netIn, uint256 mathOutput, uint256 fee) = SwapMath.computeSwapStep(
            price, boundary, manager.getLiquidity(key.toId()), -int256(uint256(amountIn)), lpFee
        );
        assertNotEq(next, boundary);
        assertEq(netIn + fee, amountIn);
        assertEq(quote, mathOutput);
        output = uint128(quote);

        IERC20 token = IERC20(Currency.unwrap(key.currency1));
        vm.startPrank(buyer);
        if (!buy) {
            token.approve(address(permit2), amountIn);
            permit2.approve(address(token), address(router), amountIn, uint48(deadline));
            vm.expectRevert();
            _swap(key, false, amountIn, output, block.timestamp - 1);
        }
        vm.expectRevert();
        _swap(key, buy, amountIn, output + 1, deadline);
        _swap(key, buy, amountIn, output, deadline);
        if (!buy) {
            assertEq(token.allowance(buyer, address(permit2)), 0);
            (uint160 allowance,,) = permit2.allowance(buyer, address(token), address(router));
            assertEq(allowance, 0);
        }
        vm.stopPrank();
    }

    function _addExternalLiquidity(PoolKey memory key, uint256 deadline) private {
        IERC20 token = IERC20(Currency.unwrap(key.currency1));
        (uint160 price,,,) = manager.getSlot0(key.toId());
        int24 lowerTick = factory.TICK_LOWER();
        int24 upperTick = factory.TICK_UPPER();
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lowerTick);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upperTick);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            price, sqrtLower, sqrtUpper, 0.01 ether, token.balanceOf(buyer) / 4
        );
        uint256 nativeRequired = SqrtPriceMath.getAmount0Delta(price, sqrtUpper, liquidity, true);
        uint256 tokenRequired = SqrtPriceMath.getAmount1Delta(sqrtLower, price, liquidity, true);
        assertGt(liquidity, 0);
        assertLe(nativeRequired, 0.01 ether);
        assertLe(tokenRequired, token.balanceOf(buyer) / 4);

        uint256 positionId = positionManager.nextTokenId();
        uint128 priorPoolLiquidity = manager.getLiquidity(key.toId());
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key, lowerTick, upperTick, liquidity, uint128(nativeRequired), uint128(tokenRequired), buyer, bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        vm.startPrank(buyer);
        token.approve(address(permit2), tokenRequired);
        permit2.approve(address(token), address(positionManager), uint160(tokenRequired), uint48(deadline));
        positionManager.modifyLiquidities{value: nativeRequired}(abi.encode(actions, params), deadline);
        vm.stopPrank();
        assertEq(positionManager.ownerOf(positionId), buyer);
        assertEq(positionManager.getPositionLiquidity(positionId), liquidity);
        assertEq(manager.getLiquidity(key.toId()), priorPoolLiquidity + liquidity);
    }

    function _exerciseClaims(address token, uint256 deadline) private {
        // Unrelated balances present before harvesting are outside lifetime collections.
        uint256 nativeSurplus = 3;
        uint256 tokenSurplus = 25;
        vm.deal(address(factory), nativeSurplus);
        vm.prank(creator);
        assertTrue(IERC20(token).transfer(address(factory), tokenSurplus));

        vm.prank(buyer);
        factory.collectFees(token, deadline);
        (uint256 nativeAccrued, uint256 tokenAccrued, uint256 nativeDust, uint256 tokenDust) = factory.feeTotals(token);
        assertGt(nativeAccrued, 0);
        assertGt(tokenAccrued, 0);
        assertEq(address(factory).balance, nativeSurplus + nativeAccrued);
        assertEq(IERC20(token).balanceOf(address(factory)), tokenSurplus + tokenAccrued);
        _claim(token, 0, creator, nativeAccrued * 7_000 / 10_000, tokenAccrued * 7_000 / 10_000);
        _claim(token, 1, treasury, nativeAccrued * 2_000 / 10_000, tokenAccrued * 2_000 / 10_000);
        _claim(token, 2, reserve, nativeAccrued * 1_000 / 10_000, tokenAccrued * 1_000 / 10_000);
        assertEq(address(factory).balance, nativeSurplus + nativeDust);
        assertEq(IERC20(token).balanceOf(address(factory)), tokenSurplus + tokenDust);
    }

    function _claim(address token, uint8 bucket, address recipient, uint256 expectedNative, uint256 expectedToken)
        private
    {
        (
            address actualRecipient,
            uint256 claimableNative,
            uint256 claimableToken,
            uint256 nativeSent,
            uint256 tokenSent
        ) = factory.feeBucket(token, bucket);
        assertEq(actualRecipient, recipient);
        assertEq(claimableNative, expectedNative);
        assertEq(claimableToken, expectedToken);
        assertEq(nativeSent, 0);
        assertEq(tokenSent, 0);
        uint256 nativeBefore = recipient.balance;
        uint256 tokenBefore = IERC20(token).balanceOf(recipient);
        vm.prank(recipient);
        factory.withdrawFees(token, bucket);
        assertEq(recipient.balance - nativeBefore, expectedNative);
        assertEq(IERC20(token).balanceOf(recipient) - tokenBefore, expectedToken);
        (, claimableNative, claimableToken, nativeSent, tokenSent) = factory.feeBucket(token, bucket);
        assertEq(claimableNative, 0);
        assertEq(claimableToken, 0);
        assertEq(nativeSent, expectedNative);
        assertEq(tokenSent, expectedToken);
    }

    function _verifiedAddress(string memory pins, string memory name) private view returns (address deployment) {
        string memory key = string.concat(".baseSepolia.", name);
        deployment = vm.parseJsonAddress(pins, string.concat(key, ".address"));
        assertGt(deployment.code.length, 0);
        assertEq(deployment.codehash, vm.parseJsonBytes32(pins, string.concat(key, ".runtimeHash")));
    }

    function _swap(PoolKey memory key, bool buy, uint128 amountIn, uint128 minimumOut, uint256 deadline) private {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE_ALL));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, buy, amountIn, minimumOut, ""));
        params[1] = abi.encode(buy ? key.currency0 : key.currency1, amountIn, true);
        params[2] = abi.encode(buy ? key.currency1 : key.currency0, minimumOut);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        router.execute{value: buy ? amountIn : 0}(hex"10", inputs, deadline);
    }
}
