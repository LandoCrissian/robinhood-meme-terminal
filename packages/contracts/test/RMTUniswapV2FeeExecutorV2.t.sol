// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV2FeeExecutorV2, IRMTArbSysUniswapV2} from "../src/RMTUniswapV2FeeExecutorV2.sol";
import {FeeExecutorToken} from "./RMTUniswapV3FeeExecutorV1.t.sol";

contract V2PairMock {
    address public factory;
    address public token0;
    address public token1;

    constructor(address factory_, address a, address b) {
        factory = factory_;
        (token0, token1) = a < b ? (a, b) : (b, a);
    }
}

contract V2FactoryMock {
    mapping(bytes32 => address) private pairs;

    function setPair(address a, address b, address pair) external {
        pairs[_key(a, b)] = pair;
    }

    function getPair(address a, address b) external view returns (address) {
        return pairs[_key(a, b)];
    }

    function _key(address a, address b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}

contract V2RouterMock {
    address public immutable factory;
    address public immutable WETH;
    uint256 public lastAmountIn;
    address[] private lastPath;
    bool public failSwap;
    bool public lieAboutOutput;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH = weth_;
    }
    receive() external payable {}

    function setBehavior(bool failSwap_, bool lie_) external {
        failSwap = failSwap_;
        lieAboutOutput = lie_;
    }

    function recordedPath() external view returns (address[] memory) {
        return lastPath;
    }

    function _record(uint256 amountIn, address[] calldata path) private {
        if (failSwap) revert("swap failed");
        lastAmountIn = amountIn;
        delete lastPath;
        for (uint256 i; i < path.length; ++i) {
            lastPath.push(path[i]);
        }
    }

    function _amounts(uint256 amountIn, uint256 length) private view returns (uint256[] memory amounts) {
        amounts = new uint256[](length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < length; ++i) {
            amounts[i] = amountIn;
        }
        if (lieAboutOutput) amounts[length - 1] += 1;
    }

    function swapExactETHForTokens(uint256 minimum, address[] calldata path, address to, uint256)
        external
        payable
        returns (uint256[] memory amounts)
    {
        _record(msg.value, path);
        require(msg.value >= minimum, "minimum");
        FeeExecutorToken(path[path.length - 1]).mint(to, msg.value);
        return _amounts(msg.value, path.length);
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minimum, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory amounts)
    {
        _record(amountIn, path);
        require(amountIn >= minimum, "minimum");
        FeeExecutorToken(path[0]).transferFrom(msg.sender, address(this), amountIn);
        FeeExecutorToken(path[path.length - 1]).mint(to, amountIn);
        return _amounts(amountIn, path.length);
    }

    function swapExactTokensForETH(uint256 amountIn, uint256 minimum, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory amounts)
    {
        _record(amountIn, path);
        require(amountIn >= minimum, "minimum");
        FeeExecutorToken(path[0]).transferFrom(msg.sender, address(this), amountIn);
        (bool ok,) = to.call{value: amountIn}("");
        require(ok, "native");
        return _amounts(amountIn, path.length);
    }
}

contract RMTUniswapV2FeeExecutorV2Test is Test {
    address private constant TRADER = address(0xA11CE);
    address private constant TREASURY = address(0xBEEF);
    bytes32 private constant POLICY_HASH = keccak256("test-rmt-execution-v2");
    FeeExecutorToken private input;
    FeeExecutorToken private output;
    FeeExecutorToken private other;
    FeeExecutorToken private weth;
    V2FactoryMock private factory;
    V2RouterMock private router;
    V2PairMock private directPair;
    V2PairMock private inputWethPair;
    V2PairMock private wethOutputPair;
    RMTUniswapV2FeeExecutorV2 private executor;

    function setUp() public {
        vm.chainId(4_663);
        vm.warp(1_000_000);
        vm.mockCall(address(100), abi.encodeWithSelector(IRMTArbSysUniswapV2.arbBlockNumber.selector), abi.encode(100));
        input = new FeeExecutorToken();
        output = new FeeExecutorToken();
        other = new FeeExecutorToken();
        weth = new FeeExecutorToken();
        factory = new V2FactoryMock();
        router = new V2RouterMock(address(factory), address(weth));
        directPair = new V2PairMock(address(factory), address(input), address(output));
        inputWethPair = new V2PairMock(address(factory), address(input), address(weth));
        wethOutputPair = new V2PairMock(address(factory), address(weth), address(output));
        factory.setPair(address(input), address(output), address(directPair));
        factory.setPair(address(input), address(weth), address(inputWethPair));
        factory.setPair(address(weth), address(output), address(wethOutputPair));
        executor = _deploy();
        input.mint(TRADER, 1_000_000);
        other.mint(TRADER, 1_000_000);
        vm.deal(TRADER, 1 ether);
        vm.deal(address(router), 1 ether);
    }

    function testNativeToErc20DirectSettlesExactInputFee() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(weth), address(output), address(wethOutputPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(0), address(output), 40_000, keccak256("native"));
        uint256 treasuryBefore = TREASURY.balance;
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, route);
        assertEq(router.lastAmountIn(), 39_900);
        assertEq(TREASURY.balance - treasuryBefore, 100);
        assertEq(output.balanceOf(TRADER), 39_900);
        _assertClean(address(input), address(output));
    }

    function testErc20ToNativeDirectSettlesTokenFeeAndNativeOutput() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(weth), address(inputWethPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), address(0), 40_000, keccak256("sell"));
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        uint256 beforeNative = TRADER.balance;
        vm.prank(TRADER);
        executor.execute(auth, route);
        assertEq(TRADER.balance - beforeNative, 39_900);
        assertEq(input.balanceOf(TREASURY), 100);
        assertEq(input.allowance(TRADER, address(executor)), 0);
        _assertClean(address(input), address(weth));
    }

    function testErc20ToErc20DirectUsesProviderInput() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(directPair));
        _executeToken(route, address(output), 40_000, keccak256("direct"));
        assertEq(router.lastAmountIn(), 39_900);
        assertEq(input.balanceOf(TREASURY), 100);
        assertEq(output.balanceOf(TRADER), 39_900);
        _assertClean(address(input), address(output));
    }

    function testErc20ToErc20WethHopUsesOnlyCanonicalPath() public {
        V2PairMock otherPair = new V2PairMock(address(factory), address(weth), address(other));
        factory.setPair(address(weth), address(other), address(otherPair));
        RMTUniswapV2FeeExecutorV2.Route memory route = RMTUniswapV2FeeExecutorV2.Route({
            kind: RMTUniswapV2FeeExecutorV2.RouteKind.WETH_HOP,
            tokenIn: address(input),
            tokenOut: address(other),
            pair0: address(inputWethPair),
            pair1: address(otherPair)
        });
        _executeToken(route, address(other), 40_000, keccak256("hop"));
        address[] memory path = router.recordedPath();
        assertEq(path.length, 3);
        assertEq(path[0], address(input));
        assertEq(path[1], address(weth));
        assertEq(path[2], address(other));
    }

    function testExactApprovalReplayDeadlineAndMutationsFailClosed() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(directPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), address(output), 40_000, keccak256("guards"));
        vm.prank(TRADER);
        input.approve(address(executor), 40_001);
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(auth, route);
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.ExecutionAlreadyConsumed.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);

        auth = _auth(route, address(input), address(output), 40_000, keccak256("expired"));
        auth.deadline = block.timestamp - 1;
        _expectRejected(auth, route);
        auth = _auth(route, address(input), address(output), 40_000, keccak256("policy"));
        auth.policyHash = bytes32(uint256(1));
        _expectRejected(auth, route);
        auth = _auth(route, address(input), address(output), 40_000, keccak256("fee"));
        auth.expectedFeeAtomic += 1;
        _expectRejected(auth, route);
        RMTUniswapV2FeeExecutorV2.Route memory wrong = route;
        wrong.pair0 = address(inputWethPair);
        auth = _auth(wrong, address(input), address(output), 40_000, keccak256("pair"));
        _expectRejected(auth, wrong);
    }

    function testRuntimePairAndAtomicFailuresRejectWithoutFee() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(directPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), address(output), 40_000, keccak256("runtime"));
        bytes memory original = address(router).code;
        vm.etch(address(router), hex"00");
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.RuntimeIdentityChanged.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
        vm.etch(address(router), original);
        router.setBehavior(true, false);
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(auth, route);
        assertEq(input.balanceOf(TREASURY), 0);
        assertFalse(executor.executionConsumed(auth.executionId));
        router.setBehavior(false, true);
        auth.executionId = keccak256("lying");
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
        assertEq(input.balanceOf(TREASURY), 0);
    }

    function testEveryPinnedRuntimeAndCanonicalPairIdentityFailClosed() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(directPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), address(output), 40_000, keccak256("runtime-matrix"));
        _expectRuntimeMutation(address(router), auth, route);
        _expectRuntimeMutation(address(factory), auth, route);
        _expectRuntimeMutation(address(weth), auth, route);
        bytes memory pairCode = address(directPair).code;
        vm.etch(address(directPair), hex"00");
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.InvalidPair.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
        vm.etch(address(directPair), pairCode);
        V2PairMock impostor = new V2PairMock(address(factory), address(input), address(output));
        route.pair0 = address(impostor);
        auth.routeIdentity = executor.routeIdentity(route);
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.InvalidPair.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
    }

    function testAuthorizationFieldMutationMatrixFailsClosed() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(directPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory base =
            _auth(route, address(input), address(output), 40_000, keccak256("matrix"));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory changed = base;
        changed.trader = address(0xB0B);
        _expectRejected(changed, route);
        changed = base;
        changed.treasury = address(0xB0B);
        _expectRejected(changed, route);
        changed = base;
        changed.feeBps = 26;
        _expectRejected(changed, route);
        changed = base;
        changed.feeAsset = address(output);
        _expectRejected(changed, route);
        changed = base;
        changed.userGrossInput = 40_001;
        _expectRejected(changed, route);
        changed = base;
        changed.providerInput = 39_899;
        _expectRejected(changed, route);
        changed = base;
        changed.requestedInputAsset = address(other);
        _expectRejected(changed, route);
        changed = base;
        changed.requestedOutputAsset = address(other);
        _expectRejected(changed, route);
        changed = base;
        changed.routeIdentity = bytes32(uint256(1));
        _expectRejected(changed, route);
        changed = base;
        changed.policyIdHash = keccak256("other");
        _expectRejected(changed, route);
        changed = base;
        changed.policyVersion = 3;
        _expectRejected(changed, route);
        changed = base;
        changed.executionId = bytes32(0);
        _expectRejected(changed, route);
    }

    function testFeeTransferFailureAndForcedResidualRevertAtomically() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(directPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), address(output), 40_000, keccak256("fee-failure"));
        input.setFailingRecipient(TREASURY);
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(auth, route);
        assertEq(input.balanceOf(TREASURY), 0);
        assertEq(output.balanceOf(TRADER), 0);
        assertFalse(executor.executionConsumed(auth.executionId));
        input.setFailingRecipient(address(0));
        vm.deal(address(executor), 1);
        auth.executionId = keccak256("forced-residual");
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
        vm.prank(TRADER);
        (bool ok,) = address(executor).call{value: 1}("");
        assertFalse(ok, "unsolicited native accepted");
    }

    function testTransferTaxInputAndArbitrarySurfacesRejected() public {
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(directPair));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), address(output), 40_000, keccak256("tax"));
        input.setFeeOnTransfer(true);
        vm.prank(TRADER);
        input.approve(address(executor), 40_000);
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
        bytes[5] memory calls = [
            abi.encodeWithSignature("owner()"),
            abi.encodeWithSignature("rescue(address)", address(input)),
            abi.encodeWithSignature("upgradeTo(address)", address(input)),
            abi.encodeWithSignature("execute(address,bytes)", address(router), hex"00"),
            abi.encodeWithSignature("setTreasury(address)", TRADER)
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool ok,) = address(executor).call(calls[i]);
            assertFalse(ok);
        }
    }

    function testPolicyProviderAndFloorMathAreExact() public view {
        assertEq(executor.POLICY_ID_HASH(), keccak256("RMT_EXECUTION_V2"));
        assertEq(executor.POLICY_VERSION(), 2);
        assertEq(executor.FEE_BPS(), 25);
        assertEq(executor.PROVIDER_ID(), keccak256("RMT_UNISWAP_V2_ROUTER_V2"));
        assertTrue(executor.PROVIDER_ID() != keccak256("RMT_UNISWAP_V3_ROUTER02_V2"));
        assertEq(executor.calculateFee(399), 0);
        assertEq(executor.calculateFee(400), 1);
        assertEq(executor.calculateFee(40_000), 100);
    }

    function testFuzzFeeAndProviderInputMatchIndependentReference(uint128 rawGross) public view {
        uint256 gross = bound(uint256(rawGross), 1, type(uint128).max);
        uint256 expectedFee = gross * 25 / 10_000;
        assertEq(executor.calculateFee(gross), expectedFee);
        assertEq(gross - executor.calculateFee(gross), gross - expectedFee);
    }

    function testWrongPairTokenIdentityAndRedundantWethHopAreRejected() public {
        V2PairMock wrongTokens = new V2PairMock(address(factory), address(input), address(other));
        factory.setPair(address(input), address(output), address(wrongTokens));
        RMTUniswapV2FeeExecutorV2.Route memory route = _direct(address(input), address(output), address(wrongTokens));
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), address(output), 40_000, keccak256("wrong-token-ordering"));
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.InvalidPair.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);

        route = RMTUniswapV2FeeExecutorV2.Route({
            kind: RMTUniswapV2FeeExecutorV2.RouteKind.WETH_HOP,
            tokenIn: address(weth),
            tokenOut: address(output),
            pair0: address(wethOutputPair),
            pair1: address(wethOutputPair)
        });
        auth = _auth(route, address(0), address(output), 40_000, keccak256("redundant-weth"));
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.InvalidRoute.selector);
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, route);
    }

    function _deploy() private returns (RMTUniswapV2FeeExecutorV2) {
        return new RMTUniswapV2FeeExecutorV2(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(directPair).codehash,
            address(weth),
            address(weth).codehash,
            TREASURY,
            keccak256("RMT_EXECUTION_V2"),
            2,
            POLICY_HASH,
            25,
            1,
            0
        );
    }

    function _direct(address a, address b, address pair) private pure returns (RMTUniswapV2FeeExecutorV2.Route memory) {
        return RMTUniswapV2FeeExecutorV2.Route({
            kind: RMTUniswapV2FeeExecutorV2.RouteKind.DIRECT, tokenIn: a, tokenOut: b, pair0: pair, pair1: address(0)
        });
    }

    function _executeToken(
        RMTUniswapV2FeeExecutorV2.Route memory route,
        address requestedOutput,
        uint256 gross,
        bytes32 id
    ) private {
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth =
            _auth(route, address(input), requestedOutput, gross, id);
        vm.prank(TRADER);
        input.approve(address(executor), gross);
        vm.prank(TRADER);
        executor.execute(auth, route);
    }

    function _auth(
        RMTUniswapV2FeeExecutorV2.Route memory route,
        address requestedInput,
        address requestedOutput,
        uint256 gross,
        bytes32 id
    ) private view returns (RMTUniswapV2FeeExecutorV2.FeeAuthorization memory) {
        uint256 fee = gross * 25 / 10_000;
        uint256 providerInput = gross - fee;
        return RMTUniswapV2FeeExecutorV2.FeeAuthorization({
            executionId: id,
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
            expectedProviderOutput: providerInput,
            protectedOutput: providerInput * 99 / 100,
            deadline: block.timestamp + 4 minutes,
            routeIdentity: executor.routeIdentity(route)
        });
    }

    function _expectRejected(
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth,
        RMTUniswapV2FeeExecutorV2.Route memory route
    ) private {
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(auth, route);
    }

    function _expectRuntimeMutation(
        address target,
        RMTUniswapV2FeeExecutorV2.FeeAuthorization memory auth,
        RMTUniswapV2FeeExecutorV2.Route memory route
    ) private {
        bytes memory code = target.code;
        vm.etch(target, hex"00");
        vm.expectRevert(RMTUniswapV2FeeExecutorV2.RuntimeIdentityChanged.selector);
        vm.prank(TRADER);
        executor.execute(auth, route);
        vm.etch(target, code);
    }

    function _assertClean(address inputToken, address outputToken) private view {
        assertEq(FeeExecutorToken(inputToken).balanceOf(address(executor)), 0);
        assertEq(FeeExecutorToken(outputToken).balanceOf(address(executor)), 0);
        assertEq(FeeExecutorToken(inputToken).allowance(address(executor), address(router)), 0);
        assertEq(address(executor).balance, 0);
    }
}
