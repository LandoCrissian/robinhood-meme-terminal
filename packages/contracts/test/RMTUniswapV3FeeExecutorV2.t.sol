// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV3FeeExecutorV2, IRMTArbSysV2} from "../src/RMTUniswapV3FeeExecutorV2.sol";
import {
    FeeExecutorToken,
    FeeExecutorPool,
    FeeExecutorFactory,
    FeeExecutorRouter,
    RejectNativeTreasury
} from "./RMTUniswapV3FeeExecutorV1.t.sol";

contract FeeExecutorWethV2 is FeeExecutorToken {
    receive() external payable {}

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "weth balance");
        balanceOf[msg.sender] -= amount;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "native transfer");
    }
}

contract FeeExecutorWethImplementationV2 {}

contract RMTUniswapV3FeeExecutorV2Test is Test {
    address private constant TRADER = address(0xA11CE);
    address private constant OTHER_TRADER = address(0xB0B);
    address private constant TEST_TREASURY = address(0xBEEF); // test-only; no production treasury is selected
    bytes32 private constant POLICY_ID_HASH = keccak256("RMT_EXECUTION_V2");
    bytes32 private constant POLICY_HASH = keccak256("test-only-rmt-execution-v2-policy");
    uint24 private constant FEE = 500;

    FeeExecutorToken private input;
    FeeExecutorToken private output;
    FeeExecutorToken private other;
    FeeExecutorWethV2 private weth;
    FeeExecutorWethImplementationV2 private wethImplementation;
    FeeExecutorFactory private factory;
    FeeExecutorRouter private router;
    FeeExecutorPool private directPool;
    FeeExecutorPool private inputWethPool;
    FeeExecutorPool private wethOutputPool;
    FeeExecutorPool private wethOtherPool;
    RMTUniswapV3FeeExecutorV2 private executor;

    function setUp() public {
        vm.chainId(4_663);
        vm.roll(100);
        vm.warp(1_000_000);
        vm.mockCall(
            address(100), abi.encodeWithSelector(IRMTArbSysV2.arbBlockNumber.selector), abi.encode(uint256(100))
        );
        input = new FeeExecutorToken();
        output = new FeeExecutorToken();
        other = new FeeExecutorToken();
        weth = new FeeExecutorWethV2();
        wethImplementation = new FeeExecutorWethImplementationV2();
        factory = new FeeExecutorFactory();
        router = new FeeExecutorRouter(address(factory), address(weth));
        directPool = new FeeExecutorPool(address(input), address(output));
        inputWethPool = new FeeExecutorPool(address(input), address(weth));
        wethOutputPool = new FeeExecutorPool(address(weth), address(output));
        wethOtherPool = new FeeExecutorPool(address(weth), address(other));
        factory.setPool(address(input), address(output), FEE, address(directPool));
        factory.setPool(address(input), address(weth), FEE, address(inputWethPool));
        factory.setPool(address(weth), address(output), FEE, address(wethOutputPool));
        factory.setPool(address(weth), address(other), 3_000, address(wethOtherPool));
        executor = _deploy(TEST_TREASURY);
        input.mint(TRADER, 2_000_000);
        output.mint(TRADER, 2_000_000);
        vm.deal(TRADER, 10 ether);
        vm.deal(address(weth), 10 ether);
    }

    function testErc20ToErc20DirectSettlesExactUniversalInputFee() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(output), 40_000, keccak256("direct"));
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.prank(TRADER);
        (uint256 amountOut, uint256 fee) = executor.execute(authorization, route);

        assertEq(amountOut, 39_900);
        assertEq(fee, 100);
        assertEq(input.balanceOf(TEST_TREASURY), 100);
        assertEq(output.balanceOf(TRADER), 2_039_900);
        _assertClean(address(input), address(output));
    }

    function testErc20ToErc20WethHopUsesOnlyCanonicalTwoLegPath() public {
        RMTUniswapV3FeeExecutorV2.Route memory route = _hopRoute(address(input), address(other));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(other), 40_000, keccak256("hop"));
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(authorization, route);

        assertEq(
            router.lastPath(),
            abi.encodePacked(address(input), uint24(FEE), address(weth), uint24(3_000), address(other))
        );
        assertEq(other.balanceOf(TRADER), 39_900);
        _assertClean(address(input), address(other));
    }

    function testNativeToErc20DirectUsesProviderInputAndRetainsNoEth() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(weth), address(output), address(wethOutputPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(0), address(output), 40_000, keccak256("native-input"));
        uint256 treasuryBefore = TEST_TREASURY.balance;
        vm.prank(TRADER);
        executor.execute{value: 40_000}(authorization, route);

        assertEq(router.lastAmountIn(), 39_900);
        assertEq(TEST_TREASURY.balance - treasuryBefore, 100);
        assertEq(address(executor).balance, 0);
        assertEq(output.balanceOf(address(executor)), 0);
    }

    function testErc20ToNativeUnwrapsExactWethToTrader() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(weth), address(inputWethPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(0), 40_000, keccak256("native-output"));
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        uint256 nativeBefore = TRADER.balance;
        vm.prank(TRADER);
        (uint256 amountOut,) = executor.execute(authorization, route);

        assertEq(TRADER.balance - nativeBefore, amountOut);
        assertEq(amountOut, 39_900);
        assertEq(weth.balanceOf(address(executor)), 0);
        assertEq(address(executor).balance, 0);
        assertEq(input.balanceOf(TEST_TREASURY), 100);
        assertEq(input.allowance(address(executor), address(router)), 0);
    }

    function testArbitraryNewStandardTokenNeedsNoConstructorRegistration() public {
        FeeExecutorToken newToken = new FeeExecutorToken();
        FeeExecutorPool pool = new FeeExecutorPool(address(newToken), address(output));
        factory.setPool(address(newToken), address(output), FEE, address(pool));
        newToken.mint(TRADER, 40_000);
        RMTUniswapV3FeeExecutorV2.Route memory route = _directRoute(address(newToken), address(output), address(pool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(newToken), address(output), 40_000, keccak256("new-token"));
        vm.prank(TRADER);
        newToken.approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(authorization, route);

        assertEq(newToken.balanceOf(TEST_TREASURY), 100);
        (bool registryExists,) =
            address(executor).staticcall(abi.encodeWithSignature("feeAssetEligible(address)", address(newToken)));
        assertFalse(registryExists, "a static fee-token registry exists");
    }

    function testFloorMathAndZeroRoundedFee() public {
        assertEq(executor.calculateFee(1), 0);
        assertEq(executor.calculateFee(399), 0);
        assertEq(executor.calculateFee(400), 1);
        assertEq(executor.calculateFee(10_000), 25);

        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(output), 399, keccak256("zero-fee"));
        vm.prank(TRADER);
        input.approve(address(executor), 399);
        vm.prank(TRADER);
        (, uint256 fee) = executor.execute(authorization, route);
        assertEq(fee, 0);
        assertEq(router.lastAmountIn(), 399);
    }

    function testMutatedEconomicsAndIdentityAreRejected() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory base =
            _authorization(route, address(input), address(output), 40_000, keccak256("mutations"));

        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory changed = base;
        changed.feeBps = 26;
        _expectRejected(changed, route);
        changed = base;
        changed.expectedFeeAtomic = 99;
        _expectRejected(changed, route);
        changed = base;
        changed.maximumFeeAtomic = 101;
        _expectRejected(changed, route);
        changed = base;
        changed.providerInput = 39_899;
        _expectRejected(changed, route);
        changed = base;
        changed.userGrossInput = 40_001;
        _expectRejected(changed, route);
        changed = base;
        changed.trader = OTHER_TRADER;
        _expectRejected(changed, route);
        changed = base;
        changed.requestedOutputAsset = address(other);
        _expectRejected(changed, route);
        changed = base;
        changed.policyHash = keccak256("changed-policy");
        _expectRejected(changed, route);
        changed = base;
        changed.treasury = OTHER_TRADER;
        _expectRejected(changed, route);
    }

    function testRoutePoolAndFeeMutationsAreRejected() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(output), 40_000, keccak256("route-mutations"));

        RMTUniswapV3FeeExecutorV2.Route memory changed = route;
        changed.pool0 = address(inputWethPool);
        authorization.routeIdentity = executor.routeIdentity(changed);
        _expectRejected(authorization, changed);
        changed = route;
        changed.fee0 = 250;
        authorization.routeIdentity = executor.routeIdentity(changed);
        _expectRejected(authorization, changed);
        changed = route;
        changed.tokenOut = address(other);
        authorization.routeIdentity = executor.routeIdentity(changed);
        _expectRejected(authorization, changed);
    }

    function testDeadlinePolicyBoundaryAndReplayFailClosed() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(output), 40_000, keccak256("deadline"));
        authorization.deadline = block.timestamp - 1;
        _expectRejected(authorization, route);
        authorization.deadline = block.timestamp + 5 minutes + 1;
        _expectRejected(authorization, route);

        authorization = _authorization(route, address(input), address(output), 40_000, keccak256("replay"));
        vm.prank(TRADER);
        input.approve(address(executor), 80_000);
        vm.prank(TRADER);
        executor.execute(authorization, route);
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.ExecutionAlreadyConsumed.selector);
        vm.prank(TRADER);
        executor.execute(authorization, route);

        RMTUniswapV3FeeExecutorV2 future = _deployWithBoundary(TEST_TREASURY, 101, 0);
        authorization = _authorizationFor(future, route, address(input), address(output), 40_000, keccak256("future"));
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.PolicyInactive.selector);
        vm.prank(TRADER);
        future.execute(authorization, route);
    }

    function testRuntimeIdentityMutationsFailClosed() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(output), 40_000, keccak256("runtime"));

        _expectRuntimeMutation(address(router), authorization, route);
        _expectRuntimeMutation(address(factory), authorization, route);
        _expectRuntimeMutation(address(weth), authorization, route);
        _expectRuntimeMutation(address(wethImplementation), authorization, route);
    }

    function testFeeOnTransferInputAndAbnormalDeltasAreRejected() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(output), 40_000, keccak256("fee-on-transfer"));
        input.setFeeOnTransfer(true);
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(authorization, route);
        input.setFeeOnTransfer(false);

        authorization.executionId = keccak256("input-dust");
        router.setBehavior(false, false, true, true, false);
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(authorization, route);
        router.setBehavior(false, false, true, false, true);
        authorization.executionId = keccak256("lying-output");
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(authorization, route);
    }

    function testSwapOutputAndTreasuryFailuresSettleZeroFeeAtomically() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorization(route, address(input), address(output), 40_000, keccak256("swap-failure"));
        vm.prank(TRADER);
        input.approve(address(executor), 120_000);
        router.setBehavior(true, false, true, false, false);
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(authorization, route);
        assertEq(input.balanceOf(TEST_TREASURY), 0);
        assertFalse(executor.executionConsumed(authorization.executionId));

        router.setBehavior(false, true, true, false, false);
        router.setOutputBps(9_000);
        authorization.executionId = keccak256("output-failure");
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(authorization, route);
        assertEq(input.balanceOf(TEST_TREASURY), 0);

        router.setOutputBps(10_000);
        input.setFailingRecipient(TEST_TREASURY);
        authorization.executionId = keccak256("treasury-failure");
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(authorization, route);
        assertEq(input.balanceOf(TEST_TREASURY), 0);
        assertEq(output.balanceOf(TRADER), 2_000_000);
    }

    function testNativeTreasuryFailureRevertsCompletedSwap() public {
        RejectNativeTreasury rejectingTreasury = new RejectNativeTreasury();
        RMTUniswapV3FeeExecutorV2 rejecting = _deploy(address(rejectingTreasury));
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(weth), address(output), address(wethOutputPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization =
            _authorizationFor(rejecting, route, address(0), address(output), 40_000, keccak256("native-treasury"));
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.NativeTransferFailed.selector);
        vm.prank(TRADER);
        rejecting.execute{value: 40_000}(authorization, route);
        assertEq(output.balanceOf(TRADER), 2_000_000);
    }

    function testTokenCallbackCannotReenter() public {
        RMTUniswapV3FeeExecutorV2.Route memory route =
            _directRoute(address(input), address(output), address(directPool));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory nested =
            _authorization(route, address(input), address(output), 400, keccak256("nested"));
        input.setReentry(address(executor), abi.encodeCall(executor.execute, (nested, route)));
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory outer =
            _authorization(route, address(input), address(output), 40_000, keccak256("outer"));
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(outer, route);
        assertFalse(executor.executionConsumed(nested.executionId));
        assertTrue(executor.executionConsumed(outer.executionId));
    }

    function testNoAdminUpgradeRescueArbitraryCallOrDirectRouterBypassSurface() public {
        bytes[7] memory calls = [
            abi.encodeWithSignature("owner()"),
            abi.encodeWithSignature("setTreasury(address)", address(0xBAD)),
            abi.encodeWithSignature("upgradeTo(address)", address(0xBAD)),
            abi.encodeWithSignature("rescue(address)", address(input)),
            abi.encodeWithSignature("execute(address,bytes)", address(router), hex"00"),
            abi.encodeWithSignature("delegateExecute(address,bytes)", address(router), hex"00"),
            abi.encodeWithSignature("feeAssetEligible(address)", address(input))
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool success,) = address(executor).call(calls[i]);
            assertFalse(success, "prohibited capability exists");
        }
        assertEq(executor.treasury(), TEST_TREASURY);
        assertEq(executor.router(), address(router));
    }

    function testConstructorPinsExactV2PolicyAndDependencies() public {
        assertEq(executor.POLICY_ID_HASH(), POLICY_ID_HASH);
        assertEq(executor.POLICY_VERSION(), 2);
        assertEq(executor.FEE_BPS(), 25);
        assertEq(executor.policyHash(), POLICY_HASH);
        assertEq(executor.wethImplementation(), address(wethImplementation));

        vm.expectRevert(RMTUniswapV3FeeExecutorV2.InvalidPolicy.selector);
        _construct(TEST_TREASURY, POLICY_ID_HASH, 1, POLICY_HASH, 25, 1, 0);
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.InvalidPolicy.selector);
        _construct(TEST_TREASURY, POLICY_ID_HASH, 2, POLICY_HASH, 26, 1, 0);
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.InvalidPolicy.selector);
        _construct(TEST_TREASURY, keccak256("other-policy"), 2, POLICY_HASH, 25, 1, 0);
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.InvalidConfiguration.selector);
        _construct(address(router), POLICY_ID_HASH, 2, POLICY_HASH, 25, 1, 0);
    }

    function _deploy(address treasury_) private returns (RMTUniswapV3FeeExecutorV2) {
        return _construct(treasury_, POLICY_ID_HASH, 2, POLICY_HASH, 25, 1, 0);
    }

    function _deployWithBoundary(address treasury_, uint256 fromBlock, uint256 beforeBlock)
        private
        returns (RMTUniswapV3FeeExecutorV2)
    {
        return _construct(treasury_, POLICY_ID_HASH, 2, POLICY_HASH, 25, fromBlock, beforeBlock);
    }

    function _construct(
        address treasury_,
        bytes32 policyIdHash_,
        uint256 version_,
        bytes32 policyHash_,
        uint16 feeBps_,
        uint256 fromBlock_,
        uint256 beforeBlock_
    ) private returns (RMTUniswapV3FeeExecutorV2) {
        return new RMTUniswapV3FeeExecutorV2(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            address(wethImplementation),
            address(wethImplementation).codehash,
            treasury_,
            policyIdHash_,
            version_,
            policyHash_,
            feeBps_,
            fromBlock_,
            beforeBlock_
        );
    }

    function _directRoute(address tokenIn, address tokenOut, address pool)
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

    function _hopRoute(address tokenIn, address tokenOut)
        private
        view
        returns (RMTUniswapV3FeeExecutorV2.Route memory)
    {
        return RMTUniswapV3FeeExecutorV2.Route({
            kind: RMTUniswapV3FeeExecutorV2.RouteKind.EXACT_INPUT_WETH_HOP,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee0: FEE,
            fee1: 3_000,
            pool0: address(inputWethPool),
            pool1: address(wethOtherPool)
        });
    }

    function _authorization(
        RMTUniswapV3FeeExecutorV2.Route memory route,
        address requestedInput,
        address requestedOutput,
        uint256 gross,
        bytes32 executionId
    ) private view returns (RMTUniswapV3FeeExecutorV2.FeeAuthorization memory) {
        return _authorizationFor(executor, route, requestedInput, requestedOutput, gross, executionId);
    }

    function _authorizationFor(
        RMTUniswapV3FeeExecutorV2 target,
        RMTUniswapV3FeeExecutorV2.Route memory route,
        address requestedInput,
        address requestedOutput,
        uint256 gross,
        bytes32 executionId
    ) private view returns (RMTUniswapV3FeeExecutorV2.FeeAuthorization memory) {
        uint256 fee = gross * 25 / 10_000;
        uint256 providerInput = gross - fee;
        return RMTUniswapV3FeeExecutorV2.FeeAuthorization({
            executionId: executionId,
            policyIdHash: POLICY_ID_HASH,
            policyVersion: 2,
            policyHash: POLICY_HASH,
            feeBps: 25,
            feeSide: RMTUniswapV3FeeExecutorV2.FeeSide.INPUT,
            feeAsset: requestedInput,
            treasury: target.treasury(),
            trader: TRADER,
            requestedInputAsset: requestedInput,
            requestedOutputAsset: requestedOutput,
            routedInputAsset: route.tokenIn,
            routedOutputAsset: route.tokenOut,
            userGrossInput: gross,
            expectedFeeAtomic: fee,
            maximumFeeAtomic: fee,
            providerInput: providerInput,
            expectedProviderOutput: providerInput,
            protectedOutput: providerInput * 97 / 100,
            deadline: block.timestamp + 4 minutes,
            routeIdentity: target.routeIdentity(route)
        });
    }

    function _expectRejected(
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization,
        RMTUniswapV3FeeExecutorV2.Route memory route
    ) private {
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(authorization, route);
    }

    function _expectRuntimeMutation(
        address target,
        RMTUniswapV3FeeExecutorV2.FeeAuthorization memory authorization,
        RMTUniswapV3FeeExecutorV2.Route memory route
    ) private {
        bytes memory originalCode = target.code;
        vm.etch(target, hex"00");
        vm.expectRevert(RMTUniswapV3FeeExecutorV2.RuntimeIdentityChanged.selector);
        vm.prank(TRADER);
        executor.execute(authorization, route);
        vm.etch(target, originalCode);
    }

    function _assertClean(address inputToken, address outputToken) private view {
        assertEq(FeeExecutorToken(inputToken).balanceOf(address(executor)), 0, "input retained");
        assertEq(FeeExecutorToken(outputToken).balanceOf(address(executor)), 0, "output retained");
        assertEq(FeeExecutorToken(inputToken).allowance(address(executor), address(router)), 0, "allowance retained");
        assertEq(weth.balanceOf(address(executor)), 0, "WETH retained");
        assertEq(address(executor).balance, 0, "native retained");
    }
}
