// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RMTV4GrowthVaultV1} from "../src/RMTV4GrowthVaultV1.sol";
import {GrowthVaultFixture} from "./RMTV4GrowthVaultV1.t.sol";
import {ILaunchUniversalRouterV1} from "./RMTV4LaunchFactoryV1Fork.t.sol";

contract RMTV4GrowthVaultV1ForkTest is GrowthVaultFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    ILaunchUniversalRouterV1 private router;
    IV4Quoter private quoter;

    function testOfficialForkReinvestsEarnedFeesOnlyAfterReviewedPriceRecovery() public {
        string memory upstream = vm.envOr("RMT_V4_BASE_SEPOLIA_RPC", string(""));
        if (bytes(upstream).length == 0) vm.skip(true);
        _forkAndVerify(upstream);
        bytes32 intent = keccak256("fork growth proof");
        RMTV4GrowthVaultV1 vault = _createVault(intent);
        (address token, PoolKey memory key, uint160 reviewedPrice) = _launch(intent, address(vault));
        _roundTrip(token, key, 0.02 ether);
        _collectExactReserve(vault, token);

        RMTV4GrowthVaultV1.Snapshot memory collected = vault.snapshot();
        RMTV4GrowthVaultV1.Plan memory plan = _plan(vault, reviewedPrice);
        plan.maxNativeIn = uint128(collected.nativeHeld);
        plan.maxTokenIn = uint128(collected.tokenHeld);
        uint128 expectedLiquidity = LiquidityAmounts.getLiquidityForAmounts(
            reviewedPrice,
            TickMath.getSqrtPriceAtTick(factory.TICK_LOWER()),
            TickMath.getSqrtPriceAtTick(factory.TICK_UPPER()),
            plan.maxNativeIn,
            plan.maxTokenIn
        );
        // This minimum is based on the fixture's independent price reference, before the hostile swap.
        plan.minLiquidity = uint128(uint256(expectedLiquidity) * 9_950 / 10_000);
        assertGt(plan.minLiquidity, 0);

        uint128 bought = _trade(key, true, 0.2 ether);
        assertEq(_execute(vault, plan), PRICE_DEFERRED);
        assertEq(vault.snapshot().nativeHeld, collected.nativeHeld);
        assertEq(vault.snapshot().tokenHeld, collected.tokenHeld);
        assertEq(vault.nextNonce(), plan.nonce);
        _trade(key, false, bought);

        uint128 activeBefore = manager.getLiquidity(key.toId());
        assertEq(_execute(vault, plan), ADDED);
        RMTV4GrowthVaultV1.Snapshot memory added = vault.snapshot();
        assertGe(added.liquidityAdded, plan.minLiquidity);
        assertLe(added.nativeAdded, plan.maxNativeIn);
        assertLe(added.tokenAdded, plan.maxTokenIn);
        assertEq(manager.getLiquidity(key.toId()), activeBefore + added.liquidityAdded);
        _assertLocked(token, key, vault);
        _assertAccounting(added);
        (uint160 granted, uint48 expiration,) =
            IAllowanceTransfer(permit2).allowance(address(vault), token, address(positionManager));
        assertEq(granted, 0);
        assertLe(expiration, block.timestamp);

        _roundTrip(token, key, 0.02 ether);
        vault.harvestGrowthFees(_deadline());
        RMTV4GrowthVaultV1.Snapshot memory harvested = vault.snapshot();
        assertGt(harvested.nativePositionFees, 0);
        assertGt(harvested.tokenPositionFees, 0);
        assertEq(harvested.liquidityAdded, added.liquidityAdded);
        assertEq(vault.nextNonce(), 1);
        _assertLocked(token, key, vault);
        _assertAccounting(harvested);
    }

    function _collectExactReserve(RMTV4GrowthVaultV1 vault, address token) private {
        factory.collectFees(token, _deadline());
        (address recipient, uint256 nativeDue, uint256 tokenDue, uint256 sentNative, uint256 sentToken) =
            factory.feeBucket(token, 2);
        assertEq(recipient, address(vault));
        assertGt(nativeDue, 0);
        assertGt(tokenDue, 0);
        assertEq(sentNative, 0);
        assertEq(sentToken, 0);
        vm.prank(relayer);
        (uint256 nativeReceived, uint256 tokenReceived) = vault.collectReserve(_deadline());
        assertEq(nativeReceived, nativeDue);
        assertEq(tokenReceived, tokenDue);
        (, nativeDue, tokenDue, sentNative, sentToken) = factory.feeBucket(token, 2);
        assertEq(nativeDue, 0);
        assertEq(tokenDue, 0);
        assertEq(sentNative, nativeReceived);
        assertEq(sentToken, tokenReceived);
    }

    function _forkAndVerify(string memory upstream) private {
        string memory pins = vm.readFile("test/fixtures/rmt-v4-deployment-identities.json");
        uint256 anchor = vm.parseJsonUint(pins, ".baseSepolia.block");
        vm.createSelectFork(upstream, anchor + 1);
        assertEq(block.chainid, vm.parseJsonUint(pins, ".baseSepolia.chainId"));
        assertEq(blockhash(anchor), vm.parseJsonBytes32(pins, ".baseSepolia.blockHash"));
        vm.rollFork(anchor);
        IPoolManager officialManager = IPoolManager(_verifiedAddress(pins, "poolManager"));
        PositionManager officialPositionManager = PositionManager(payable(_verifiedAddress(pins, "positionManager")));
        address officialPermit2 = _verifiedAddress(pins, "permit2");
        router = ILaunchUniversalRouterV1(_verifiedAddress(pins, "universalRouter"));
        quoter = IV4Quoter(_verifiedAddress(pins, "quoter"));
        _verifiedAddress(pins, "stateView");
        assertEq(address(router.poolManager()), address(officialManager));
        assertEq(address(quoter.poolManager()), address(officialManager));
        vm.chainId(31337);
        _install(officialManager, officialPositionManager, officialPermit2);
    }

    function _verifiedAddress(string memory pins, string memory name) private view returns (address deployment) {
        string memory key = string.concat(".baseSepolia.", name);
        deployment = vm.parseJsonAddress(pins, string.concat(key, ".address"));
        assertGt(deployment.code.length, 0);
        assertEq(deployment.codehash, vm.parseJsonBytes32(pins, string.concat(key, ".runtimeHash")));
    }

    function _roundTrip(address token, PoolKey memory key, uint128 amountIn) private {
        uint128 acquired = _trade(key, true, amountIn);
        assertEq(IERC20(token).balanceOf(trader), acquired);
        _trade(key, false, acquired);
        assertEq(IERC20(token).balanceOf(trader), 0);
    }

    function _trade(PoolKey memory key, bool buy, uint128 amountIn) private returns (uint128 output) {
        (uint256 quote,) = quoter.quoteExactInputSingle(IV4Quoter.QuoteExactSingleParams(key, buy, amountIn, ""));
        assertGt(quote, 0);
        assertLe(quote, type(uint128).max);
        output = uint128(quote);
        address token = Currency.unwrap(key.currency1);
        uint256 deadline = _deadline();
        vm.startPrank(trader);
        if (!buy) {
            assertTrue(IERC20(token).approve(permit2, amountIn));
            IAllowanceTransfer(permit2).approve(token, address(router), amountIn, uint48(deadline));
        }
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE_ALL));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, buy, amountIn, output, ""));
        params[1] = abi.encode(buy ? key.currency0 : key.currency1, amountIn, true);
        params[2] = abi.encode(buy ? key.currency1 : key.currency0, output);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        router.execute{value: buy ? amountIn : 0}(hex"10", inputs, deadline);
        vm.stopPrank();
    }
}
