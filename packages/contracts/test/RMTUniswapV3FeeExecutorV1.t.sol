// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {RMTUniswapV3FeeExecutorV1, IRMTUniswapSwapRouter02V1, IRMTArbSysV1} from "../src/RMTUniswapV3FeeExecutorV1.sol";

contract FeeExecutorToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    bool public feeOnTransfer;
    bool public falseReturn;
    address public failingRecipient;
    address public reentryTarget;
    bytes public reentryData;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function setFeeOnTransfer(bool value) external {
        feeOnTransfer = value;
    }

    function setFalseReturn(bool value) external {
        falseReturn = value;
    }

    function setFailingRecipient(address value) external {
        failingRecipient = value;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return !falseReturn;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (falseReturn) return false;
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool) {
        if (falseReturn) return false;
        uint256 approved = allowance[owner][msg.sender];
        require(approved >= amount, "allowance");
        allowance[owner][msg.sender] = approved - amount;
        if (reentryTarget != address(0)) {
            address target = reentryTarget;
            bytes memory data = reentryData;
            reentryTarget = address(0);
            (bool success,) = target.call(data);
            require(!success, "reentry succeeded");
        }
        _transfer(owner, recipient, amount);
        return true;
    }

    function _transfer(address owner, address recipient, uint256 amount) private {
        require(recipient != failingRecipient, "recipient rejected");
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += feeOnTransfer && amount != 0 ? amount - 1 : amount;
    }
}

contract FeeExecutorNoReturnToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address recipient, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external {
        uint256 approved = allowance[owner][msg.sender];
        require(approved >= amount, "allowance");
        allowance[owner][msg.sender] = approved - amount;
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
    }
}

contract FeeExecutorPool {
    address public immutable token0;
    address public immutable token1;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }
}

contract FeeExecutorFactory {
    mapping(bytes32 key => address pool) public pools;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenA < tokenB ? tokenA : tokenB, tokenA < tokenB ? tokenB : tokenA, fee));
    }
}

contract FeeExecutorRouter {
    address public immutable factory;
    address public immutable WETH9;
    uint256 public outputBps = 10_000;
    bool public swapReverts;
    bool public ignoreMinimum;
    bool public spendInput = true;
    bool public mintInputDust;
    bool public lieAboutOutput;

    address public lastTokenIn;
    address public lastTokenOut;
    address public lastRecipient;
    uint256 public lastAmountIn;
    uint256 public lastMinimumOut;
    bytes public lastPath;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    function setOutputBps(uint256 value) external {
        outputBps = value;
    }

    function setBehavior(bool reverts_, bool ignoreMinimum_, bool spendInput_, bool mintInputDust_, bool lie_)
        external
    {
        swapReverts = reverts_;
        ignoreMinimum = ignoreMinimum_;
        spendInput = spendInput_;
        mintInputDust = mintInputDust_;
        lieAboutOutput = lie_;
    }

    function exactInputSingle(IRMTUniswapSwapRouter02V1.ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        return _swap(params.tokenIn, params.tokenOut, params.recipient, params.amountIn, params.amountOutMinimum);
    }

    function exactInput(IRMTUniswapSwapRouter02V1.ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        require(params.path.length == 66, "path length");
        (address tokenIn, address middle, address tokenOut) = _pathTokens(params.path);
        require(middle == WETH9, "middle");
        lastPath = params.path;
        return _swap(tokenIn, tokenOut, params.recipient, params.amountIn, params.amountOutMinimum);
    }

    function _swap(address tokenIn, address tokenOut, address recipient, uint256 amountIn, uint256 minimumOut)
        private
        returns (uint256 amountOut)
    {
        require(!swapReverts, "router revert");
        lastTokenIn = tokenIn;
        lastTokenOut = tokenOut;
        lastRecipient = recipient;
        lastAmountIn = amountIn;
        lastMinimumOut = minimumOut;
        if (msg.value != 0) {
            require(tokenIn == WETH9 && msg.value == amountIn, "native input");
        } else if (spendInput) {
            _callToken(
                tokenIn,
                abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amountIn)
            );
        }
        if (mintInputDust) _callToken(tokenIn, abi.encodeWithSignature("mint(address,uint256)", msg.sender, 1));
        amountOut = amountIn * outputBps / 10_000;
        if (!ignoreMinimum) require(amountOut >= minimumOut, "minimum");
        _callToken(tokenOut, abi.encodeWithSignature("mint(address,uint256)", recipient, amountOut));
        if (lieAboutOutput) return amountOut + 1;
    }

    function _callToken(address token, bytes memory data) private {
        (bool success, bytes memory result) = token.call(data);
        require(success && (result.length == 0 || abi.decode(result, (bool))), "token call");
    }

    function _pathTokens(bytes calldata path) private pure returns (address tokenIn, address middle, address tokenOut) {
        assembly ("memory-safe") {
            tokenIn := shr(96, calldataload(path.offset))
            middle := shr(96, calldataload(add(path.offset, 23)))
            tokenOut := shr(96, calldataload(add(path.offset, 46)))
        }
    }
}

contract RejectNativeTreasury {
    receive() external payable {
        revert("no native");
    }
}

contract RMTUniswapV3FeeExecutorV1Test is Test {
    address private constant TRADER = address(0xA11CE);
    address private constant TEST_TREASURY = address(0xBEEF); // test-only fixture, never a production recipient
    bytes32 private constant POLICY_ID_HASH = 0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb;
    bytes32 private constant POLICY_HASH = 0x3ea1930a2d170062b04acdb6584059d47a095305b70ccc8b4037aef149c58824;
    uint24 private constant POOL_FEE = 500;
    uint16 private constant FEE_BPS = 25;

    FeeExecutorToken private input;
    FeeExecutorToken private output;
    FeeExecutorToken private weth;
    FeeExecutorToken private middleOutput;
    FeeExecutorFactory private factory;
    FeeExecutorRouter private router;
    FeeExecutorPool private directPool;
    FeeExecutorPool private hopPool0;
    FeeExecutorPool private hopPool1;
    RMTUniswapV3FeeExecutorV1 private executor;

    event RMTUniswapV3FeeSettled(
        bytes32 indexed executionId,
        bytes32 indexed policyHash,
        address indexed trader,
        bytes32 policyIdHash,
        uint256 policyVersion,
        bytes32 providerId,
        address router,
        bytes32 routeIdentity,
        address feeAsset,
        uint16 feeBps,
        RMTUniswapV3FeeExecutorV1.FeeSide feeSide,
        uint256 userGrossInput,
        uint256 providerInput,
        uint256 grossActualOutput,
        uint256 actualRmtFee,
        uint256 actualUserNetOutput,
        address treasury
    );

    function setUp() public {
        vm.chainId(4_663);
        vm.roll(100);
        vm.warp(1_000_000);
        vm.mockCall(
            address(100), abi.encodeWithSelector(IRMTArbSysV1.arbBlockNumber.selector), abi.encode(uint256(100))
        );
        input = new FeeExecutorToken();
        output = new FeeExecutorToken();
        weth = new FeeExecutorToken();
        middleOutput = new FeeExecutorToken();
        factory = new FeeExecutorFactory();
        router = new FeeExecutorRouter(address(factory), address(weth));
        directPool = new FeeExecutorPool(address(input), address(output));
        hopPool0 = new FeeExecutorPool(address(input), address(weth));
        hopPool1 = new FeeExecutorPool(address(weth), address(middleOutput));
        factory.setPool(address(input), address(output), POOL_FEE, address(directPool));
        factory.setPool(address(input), address(weth), POOL_FEE, address(hopPool0));
        factory.setPool(address(weth), address(middleOutput), 3_000, address(hopPool1));
        executor = _deploy(TEST_TREASURY, FEE_BPS, POLICY_HASH);
        input.mint(TRADER, 1_000_000);
        weth.mint(TRADER, 1_000_000);
        vm.startPrank(TRADER);
        input.approve(address(executor), type(uint256).max);
        weth.approve(address(executor), type(uint256).max);
        vm.stopPrank();
        vm.deal(TRADER, 10 ether);
    }

    function testInputSideFeeSettlesAtomicallyAndEmitsCanonicalEvent() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("input"));
        bytes32 routeId = executor.routeIdentity(route);
        vm.expectEmit(true, true, true, true, address(executor));
        emit RMTUniswapV3FeeSettled(
            authorization.executionId,
            POLICY_HASH,
            TRADER,
            POLICY_ID_HASH,
            1,
            executor.PROVIDER_ID(),
            address(router),
            routeId,
            address(input),
            25,
            RMTUniswapV3FeeExecutorV1.FeeSide.INPUT,
            40_000,
            39_900,
            39_900,
            100,
            39_900,
            TEST_TREASURY
        );
        vm.prank(TRADER);
        (uint256 gross, uint256 fee, uint256 net) = executor.executeInputFee(authorization, route);

        assertEq(gross, 39_900);
        assertEq(fee, 100);
        assertEq(net, 39_900);
        assertEq(input.balanceOf(TEST_TREASURY), 100);
        assertEq(output.balanceOf(TRADER), 39_900);
        _assertClean(address(input), address(output));
    }

    function testOutputSideFeeSettlesAtomically() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _outputAuthorization(route, 40_000, keccak256("output"));
        vm.prank(TRADER);
        (uint256 gross, uint256 fee, uint256 net) = executor.executeOutputFee(authorization, route);

        assertEq(gross, 40_000);
        assertEq(fee, 100);
        assertEq(net, 39_900);
        assertEq(output.balanceOf(TEST_TREASURY), 100);
        assertEq(output.balanceOf(TRADER), 39_900);
        _assertClean(address(input), address(output));
    }

    function testDifferentPolicyFeeBelowCeiling() public {
        RMTUniswapV3FeeExecutorV1 fifty = _deploy(TEST_TREASURY, 50, keccak256("fifty-bps-policy"));
        vm.prank(TRADER);
        input.approve(address(fifty), type(uint256).max);
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("fifty"));
        authorization.policyHash = keccak256("fifty-bps-policy");
        authorization.feeBps = 50;
        authorization.expectedFeeAtomic = 200;
        authorization.maximumFeeAtomic = 200;
        authorization.providerInput = 39_800;
        vm.prank(TRADER);
        (, uint256 fee,) = fifty.executeInputFee(authorization, route);
        assertEq(fee, 200);
    }

    function testTinyTradeRoundsFeeDownToZero() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 399, keccak256("tiny"));
        vm.prank(TRADER);
        (uint256 gross, uint256 fee, uint256 net) = executor.executeInputFee(authorization, route);
        assertEq(gross, 399);
        assertEq(fee, 0);
        assertEq(net, 399);
        assertTrue(executor.executionConsumed(authorization.executionId));
    }

    function testPositiveSlippageFeeIsCappedAndRemainderBelongsToTrader() public {
        router.setOutputBps(11_000);
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _outputAuthorization(route, 40_000, keccak256("positive"));
        vm.prank(TRADER);
        (uint256 gross, uint256 fee, uint256 net) = executor.executeOutputFee(authorization, route);
        assertEq(gross, 44_000);
        assertEq(fee, 100, "fee exceeded wallet-authorized maximum");
        assertEq(net, 43_900, "positive slippage was not returned to trader");
    }

    function testWethHopUsesOnlyTypedCanonicalPath() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _hopRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("hop"));
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        assertEq(
            router.lastPath(),
            abi.encodePacked(address(input), uint24(500), address(weth), uint24(3_000), address(middleOutput))
        );
        assertEq(middleOutput.balanceOf(TRADER), 39_900);
    }

    function testNativeWethInputPaysInputSideFeeWithoutRetainingNativeCurrency() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = RMTUniswapV3FeeExecutorV1.Route({
            kind: RMTUniswapV3FeeExecutorV1.RouteKind.EXACT_INPUT_SINGLE,
            tokenIn: address(weth),
            tokenOut: address(middleOutput),
            fee0: POOL_FEE,
            fee1: 0,
            pool0: address(new FeeExecutorPool(address(weth), address(middleOutput))),
            pool1: address(0)
        });
        factory.setPool(address(weth), address(middleOutput), POOL_FEE, route.pool0);
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("native"));
        authorization.feeAsset = address(0);
        uint256 treasuryBefore = TEST_TREASURY.balance;
        vm.prank(TRADER);
        executor.executeInputFee{value: 40_000}(authorization, route);
        assertEq(TEST_TREASURY.balance, treasuryBefore + 100);
        assertEq(address(executor).balance, 0);
    }

    function testRouterRevertAndOutputProtectionRevertPayNoFeeAndDoNotConsumeId() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("router-revert"));
        router.setBehavior(true, false, true, false, false);
        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        assertEq(input.balanceOf(TEST_TREASURY), 0);
        assertFalse(executor.executionConsumed(authorization.executionId));

        router.setBehavior(false, true, true, false, false);
        router.setOutputBps(9_000);
        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        assertEq(input.balanceOf(TEST_TREASURY), 0);
        assertFalse(executor.executionConsumed(authorization.executionId));
    }

    function testLaterFeeTransferFailureRevertsEntireSwap() public {
        output.setFailingRecipient(TEST_TREASURY);
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _outputAuthorization(route, 40_000, keccak256("fee-fail"));
        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeOutputFee(authorization, route);
        assertEq(input.balanceOf(TRADER), 1_000_000);
        assertEq(output.balanceOf(TRADER), 0);
        assertEq(output.balanceOf(TEST_TREASURY), 0);
        assertFalse(executor.executionConsumed(authorization.executionId));
    }

    function testNativeFeeTransferFailureRevertsEntireSwap() public {
        RejectNativeTreasury rejecting = new RejectNativeTreasury();
        RMTUniswapV3FeeExecutorV1 nativeExecutor = _deploy(address(rejecting), FEE_BPS, POLICY_HASH);
        RMTUniswapV3FeeExecutorV1.Route memory route = RMTUniswapV3FeeExecutorV1.Route({
            kind: RMTUniswapV3FeeExecutorV1.RouteKind.EXACT_INPUT_SINGLE,
            tokenIn: address(weth),
            tokenOut: address(middleOutput),
            fee0: POOL_FEE,
            fee1: 0,
            pool0: address(new FeeExecutorPool(address(weth), address(middleOutput))),
            pool1: address(0)
        });
        factory.setPool(address(weth), address(middleOutput), POOL_FEE, route.pool0);
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("native-fail"));
        authorization.feeAsset = address(0);
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.NativeTransferFailed.selector);
        vm.prank(TRADER);
        nativeExecutor.executeInputFee{value: 40_000}(authorization, route);
        assertEq(middleOutput.balanceOf(TRADER), 0);
    }

    function testExecutionIdCannotReplayButRevertedIdCanRetry() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("replay"));
        router.setBehavior(true, false, true, false, false);
        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        assertFalse(executor.executionConsumed(authorization.executionId));

        router.setBehavior(false, false, true, false, false);
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        assertTrue(executor.executionConsumed(authorization.executionId));
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.ExecutionAlreadyConsumed.selector);
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
    }

    function testAuthorizationMutationsFailClosed() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory base =
            _outputAuthorization(route, 40_000, keccak256("mutations"));

        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory mutated = base;
        mutated.policyHash = bytes32(uint256(POLICY_HASH) + 1);
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.policyIdHash = bytes32(uint256(POLICY_ID_HASH) + 1);
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.policyVersion = 2;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.feeBps = 26;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.feeSide = RMTUniswapV3FeeExecutorV1.FeeSide.INPUT;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.feeAsset = address(input);
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.expectedFeeAtomic += 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.maximumFeeAtomic += 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.userGrossInput += 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.providerInput += 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.expectedGrossOutput += 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.routerMinimumGrossOutput += 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.protectedUserNetOutput += 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.deadline = block.timestamp - 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.deadline = block.timestamp + 5 minutes + 1;
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.routeIdentity = bytes32(uint256(base.routeIdentity) + 1);
        _expectOutputRejected(mutated, route);
        mutated = base;
        mutated.trader = address(0xBAD);
        _expectOutputRejected(mutated, route);

        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeInputFee(base, route);
    }

    function testRoutePoolAndPathMutationsFailClosed() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("route-mutations"));
        RMTUniswapV3FeeExecutorV1.Route memory mutated = route;
        mutated.tokenIn = address(weth);
        authorization.routeIdentity = executor.routeIdentity(mutated);
        _expectInputRejected(authorization, mutated);
        mutated = route;
        mutated.tokenOut = address(middleOutput);
        authorization.routeIdentity = executor.routeIdentity(mutated);
        _expectInputRejected(authorization, mutated);
        mutated = route;
        mutated.fee0 = 3_000;
        authorization.routeIdentity = executor.routeIdentity(mutated);
        _expectInputRejected(authorization, mutated);
        mutated = route;
        mutated.pool0 = address(hopPool0);
        authorization.routeIdentity = executor.routeIdentity(mutated);
        _expectInputRejected(authorization, mutated);
        mutated = route;
        mutated.fee1 = 500;
        authorization.routeIdentity = executor.routeIdentity(mutated);
        _expectInputRejected(authorization, mutated);
    }

    function testWrongTransactionValueAndTrailingCalldataFailClosed() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("value"));
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.InvalidAuthorization.selector);
        vm.prank(TRADER);
        executor.executeInputFee{value: 1}(authorization, route);

        bytes memory normal = abi.encodeCall(executor.executeInputFee, (authorization, route));
        bytes memory trailing = bytes.concat(normal, hex"00");
        vm.prank(TRADER);
        (bool success, bytes memory result) = address(executor).call(trailing);
        assertFalse(success);
        assertEq(bytes4(result), RMTUniswapV3FeeExecutorV1.InvalidAuthorization.selector);
        vm.prank(TRADER);
        (success,) = address(executor).call(hex"12345678");
        assertFalse(success, "unknown selector accepted");
    }

    function testFeeOnTransferFalseReturnAndAbnormalTokensFailSafely() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("fot-input"));
        input.setFeeOnTransfer(true);
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        input.setFeeOnTransfer(false);

        output.setFeeOnTransfer(true);
        authorization = _outputAuthorization(route, 40_000, keccak256("fot-output"));
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.executeOutputFee(authorization, route);
        output.setFeeOnTransfer(false);

        input.setFalseReturn(true);
        authorization = _inputAuthorization(route, 40_000, keccak256("false-return"));
        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        input.setFalseReturn(false);

        router.setBehavior(false, false, true, true, false);
        authorization = _outputAuthorization(route, 40_000, keccak256("rebase-dust"));
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.executeOutputFee(authorization, route);
    }

    function testNoReturnInputTokenIsSupportedWithoutBroadApproval() public {
        FeeExecutorNoReturnToken noReturn = new FeeExecutorNoReturnToken();
        FeeExecutorPool pool = new FeeExecutorPool(address(noReturn), address(output));
        factory.setPool(address(noReturn), address(output), POOL_FEE, address(pool));
        address[] memory eligible = _eligibleAssets();
        address[] memory expanded = new address[](eligible.length + 1);
        for (uint256 i; i < eligible.length; ++i) {
            expanded[i] = eligible[i];
        }
        expanded[eligible.length] = address(noReturn);
        RMTUniswapV3FeeExecutorV1 noReturnExecutor = new RMTUniswapV3FeeExecutorV1(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            TEST_TREASURY,
            expanded,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            FEE_BPS,
            1,
            0
        );
        noReturn.mint(TRADER, 40_000);
        vm.prank(TRADER);
        noReturn.approve(address(noReturnExecutor), 40_000);
        RMTUniswapV3FeeExecutorV1.Route memory route = RMTUniswapV3FeeExecutorV1.Route({
            kind: RMTUniswapV3FeeExecutorV1.RouteKind.EXACT_INPUT_SINGLE,
            tokenIn: address(noReturn),
            tokenOut: address(output),
            fee0: POOL_FEE,
            fee1: 0,
            pool0: address(pool),
            pool1: address(0)
        });
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("no-return"));
        authorization.routeIdentity = noReturnExecutor.routeIdentity(route);
        vm.prank(TRADER);
        noReturnExecutor.executeInputFee(authorization, route);
        assertEq(noReturn.allowance(address(noReturnExecutor), address(router)), 0);
        assertEq(noReturn.balanceOf(address(noReturnExecutor)), 0);
    }

    function testAllowanceIsExactThenClearedAndRouterCannotLeaveInputBehind() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("allowance"));
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        assertEq(router.lastAmountIn(), 39_900);
        assertEq(input.allowance(address(executor), address(router)), 0);

        router.setBehavior(false, false, false, false, false);
        authorization = _inputAuthorization(route, 40_000, keccak256("unspent"));
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        assertEq(input.allowance(address(executor), address(router)), 0);
    }

    function testDonatedBalancesArePreservedAndCannotBeSwept() public {
        input.mint(address(executor), 777);
        output.mint(address(executor), 888);
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _outputAuthorization(route, 40_000, keccak256("donations"));
        vm.prank(TRADER);
        executor.executeOutputFee(authorization, route);
        assertEq(input.balanceOf(address(executor)), 777);
        assertEq(output.balanceOf(address(executor)), 888);
        vm.prank(TRADER);
        (bool success,) = address(executor).call(abi.encodeWithSignature("sweep(address)", address(output)));
        assertFalse(success, "sweep surface exists");
    }

    function testNoAdminUpgradeArbitraryCallOrMutableRouterTreasurySurface() public {
        bytes[5] memory calls = [
            abi.encodeWithSignature("setTreasury(address)", address(0xBAD)),
            abi.encodeWithSignature("setRouter(address)", address(0xBAD)),
            abi.encodeWithSignature("upgradeTo(address)", address(0xBAD)),
            abi.encodeWithSignature("execute(address,bytes)", address(0xBAD), hex"00"),
            abi.encodeWithSignature("delegateExecute(address,bytes)", address(0xBAD), hex"00")
        ];
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(TRADER);
            (bool success,) = address(executor).call(calls[i]);
            assertFalse(success, "prohibited capability exists");
        }
        assertEq(executor.router(), address(router));
        assertEq(executor.treasury(), TEST_TREASURY);
    }

    function testIneligibleFeeAssetAndDuplicateDeploymentAssetsFailClosed() public {
        FeeExecutorToken unapproved = new FeeExecutorToken();
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("asset"));
        authorization.feeAsset = address(unapproved);
        _expectInputRejected(authorization, route);

        address[] memory duplicates = new address[](2);
        duplicates[0] = address(input);
        duplicates[1] = address(input);
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.InvalidPolicy.selector);
        new RMTUniswapV3FeeExecutorV1(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            TEST_TREASURY,
            duplicates,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            FEE_BPS,
            1,
            0
        );
    }

    function testExactlyOneCanonicalSettlementEventIsEmitted() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("one-event"));
        vm.recordLogs();
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 signature = keccak256(
            "RMTUniswapV3FeeSettled(bytes32,bytes32,address,bytes32,uint256,bytes32,address,bytes32,address,uint16,uint8,uint256,uint256,uint256,uint256,uint256,address)"
        );
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(executor) && logs[i].topics[0] == signature) ++count;
        }
        assertEq(count, 1);
    }

    function testTokenCallbackCannotReenter() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory nested = _inputAuthorization(route, 400, keccak256("nested"));
        input.setReentry(address(executor), abi.encodeCall(executor.executeInputFee, (nested, route)));
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory outer = _inputAuthorization(route, 40_000, keccak256("outer"));
        vm.prank(TRADER);
        executor.executeInputFee(outer, route);
        assertFalse(executor.executionConsumed(nested.executionId));
        assertTrue(executor.executionConsumed(outer.executionId));
    }

    function testMaliciousRouterReturnAndRuntimeMutationFailClosed() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("lying-router"));
        router.setBehavior(false, false, true, false, true);
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);

        bytes memory originalCode = address(router).code;
        vm.etch(address(router), hex"00");
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.RuntimeIdentityChanged.selector);
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
        vm.etch(address(router), originalCode);
    }

    function testConstructorRejectsRuntimePolicyAndFeeCeilingMismatches() public {
        address[] memory eligible = _eligibleAssets();
        vm.chainId(1);
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.InvalidConfiguration.selector);
        new RMTUniswapV3FeeExecutorV1(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            TEST_TREASURY,
            eligible,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            25,
            1,
            0
        );
        vm.chainId(4_663);
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.RuntimeIdentityChanged.selector);
        new RMTUniswapV3FeeExecutorV1(
            address(router),
            bytes32(uint256(address(router).codehash) + 1),
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            TEST_TREASURY,
            eligible,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            25,
            1,
            0
        );
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.InvalidPolicy.selector);
        new RMTUniswapV3FeeExecutorV1(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            TEST_TREASURY,
            eligible,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            101,
            1,
            0
        );
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.InvalidConfiguration.selector);
        new RMTUniswapV3FeeExecutorV1(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            address(router),
            eligible,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            25,
            1,
            0
        );
    }

    function testPolicyBlockBoundaryFailsClosed() public {
        address[] memory eligible = _eligibleAssets();
        RMTUniswapV3FeeExecutorV1 future = new RMTUniswapV3FeeExecutorV1(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            TEST_TREASURY,
            eligible,
            true,
            POLICY_ID_HASH,
            1,
            POLICY_HASH,
            FEE_BPS,
            block.number + 1,
            0
        );
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("future"));
        authorization.routeIdentity = future.routeIdentity(route);
        vm.expectRevert(RMTUniswapV3FeeExecutorV1.PolicyInactive.selector);
        vm.prank(TRADER);
        future.executeInputFee(authorization, route);
    }

    function testPolicyBoundaryUsesRobinhoodL2BlockNumber() public {
        assertEq(executor.currentPolicyBlock(), 100);
        vm.roll(1);
        assertEq(block.number, 1);
        assertEq(executor.currentPolicyBlock(), 100);

        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("l2-policy-block"));
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
    }

    function testFeeMathBoundariesMatchReviewedFloorFormula() public view {
        assertEq(executor.calculateFee(1, 25), 0);
        assertEq(executor.calculateFee(399, 25), 0);
        assertEq(executor.calculateFee(400, 25), 1);
        assertEq(executor.calculateFee(10_000, 25), 25);
        assertEq(executor.calculateFee(type(uint128).max, 100), uint256(type(uint128).max) / 100);
    }

    function testSharedTypeScriptSolidityDifferentialFixture() public view {
        string memory fixture = vm.readFile("test/fixtures/rmt-uniswap-v3-fee-v1.json");
        assertEq(vm.parseJsonBytes32(fixture, ".policy.policyIdHash"), POLICY_ID_HASH);
        assertEq(vm.parseJsonBytes32(fixture, ".policy.policyHash"), POLICY_HASH);
        for (uint256 i; i < 6; ++i) {
            string memory root = string.concat(".feeVectors[", vm.toString(i), "]");
            uint256 amount = vm.parseJsonUint(fixture, string.concat(root, ".amount"));
            uint16 bps = uint16(vm.parseJsonUint(fixture, string.concat(root, ".feeBps")));
            uint256 expected = vm.parseJsonUint(fixture, string.concat(root, ".fee"));
            assertEq(executor.calculateFee(amount, bps), expected);
        }
    }

    function testMaximumUintMathFailsClosedInsteadOfWrapping() public {
        vm.expectRevert();
        executor.calculateFee(type(uint256).max, 100);
    }

    function testFuzzFeeMathMatchesReference(uint128 amount, uint8 rawBps) public view {
        uint16 bps = uint16(bound(uint256(rawBps), 1, 100));
        assertEq(executor.calculateFee(amount, bps), uint256(amount) * bps / 10_000);
    }

    function testZeroOutputAndUnsupportedFeeAreRejected() public {
        RMTUniswapV3FeeExecutorV1.Route memory route = _directRoute();
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization =
            _inputAuthorization(route, 40_000, keccak256("zero-output"));
        authorization.expectedGrossOutput = 0;
        _expectInputRejected(authorization, route);
        route.fee0 = 250;
        authorization = _inputAuthorization(route, 40_000, keccak256("bad-fee"));
        _expectInputRejected(authorization, route);
    }

    function _deploy(address treasury_, uint16 bps, bytes32 policyHash_)
        private
        returns (RMTUniswapV3FeeExecutorV1 deployed)
    {
        address[] memory eligible = _eligibleAssets();
        deployed = new RMTUniswapV3FeeExecutorV1(
            address(router),
            address(router).codehash,
            address(factory),
            address(factory).codehash,
            address(weth),
            address(weth).codehash,
            treasury_,
            eligible,
            true,
            POLICY_ID_HASH,
            1,
            policyHash_,
            bps,
            1,
            0
        );
    }

    function _eligibleAssets() private view returns (address[] memory eligible) {
        eligible = new address[](4);
        eligible[0] = address(input);
        eligible[1] = address(output);
        eligible[2] = address(weth);
        eligible[3] = address(middleOutput);
    }

    function _directRoute() private view returns (RMTUniswapV3FeeExecutorV1.Route memory) {
        return RMTUniswapV3FeeExecutorV1.Route({
            kind: RMTUniswapV3FeeExecutorV1.RouteKind.EXACT_INPUT_SINGLE,
            tokenIn: address(input),
            tokenOut: address(output),
            fee0: POOL_FEE,
            fee1: 0,
            pool0: address(directPool),
            pool1: address(0)
        });
    }

    function _hopRoute() private view returns (RMTUniswapV3FeeExecutorV1.Route memory) {
        return RMTUniswapV3FeeExecutorV1.Route({
            kind: RMTUniswapV3FeeExecutorV1.RouteKind.EXACT_INPUT_WETH_HOP,
            tokenIn: address(input),
            tokenOut: address(middleOutput),
            fee0: POOL_FEE,
            fee1: 3_000,
            pool0: address(hopPool0),
            pool1: address(hopPool1)
        });
    }

    function _inputAuthorization(RMTUniswapV3FeeExecutorV1.Route memory route, uint256 gross, bytes32 executionId)
        private
        view
        returns (RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization)
    {
        uint256 fee = gross * FEE_BPS / 10_000;
        uint256 provider = gross - fee;
        authorization = RMTUniswapV3FeeExecutorV1.FeeAuthorization({
            executionId: executionId,
            policyIdHash: POLICY_ID_HASH,
            policyVersion: 1,
            policyHash: POLICY_HASH,
            feeBps: FEE_BPS,
            feeSide: RMTUniswapV3FeeExecutorV1.FeeSide.INPUT,
            feeAsset: route.tokenIn,
            expectedFeeAtomic: fee,
            maximumFeeAtomic: fee,
            trader: TRADER,
            userGrossInput: gross,
            providerInput: provider,
            expectedGrossOutput: provider,
            routerMinimumGrossOutput: provider * 97 / 100,
            protectedUserNetOutput: provider * 97 / 100,
            deadline: block.timestamp + 5 minutes,
            routeIdentity: executor.routeIdentity(route)
        });
    }

    function _outputAuthorization(RMTUniswapV3FeeExecutorV1.Route memory route, uint256 gross, bytes32 executionId)
        private
        view
        returns (RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization)
    {
        uint256 expectedGross = gross;
        uint256 maximumFee = expectedGross * FEE_BPS / 10_000;
        uint256 protectedGross = expectedGross * 975 / 1_000;
        uint256 protectedFee = protectedGross * FEE_BPS / 10_000;
        authorization = RMTUniswapV3FeeExecutorV1.FeeAuthorization({
            executionId: executionId,
            policyIdHash: POLICY_ID_HASH,
            policyVersion: 1,
            policyHash: POLICY_HASH,
            feeBps: FEE_BPS,
            feeSide: RMTUniswapV3FeeExecutorV1.FeeSide.OUTPUT,
            feeAsset: route.tokenOut,
            expectedFeeAtomic: maximumFee,
            maximumFeeAtomic: maximumFee,
            trader: TRADER,
            userGrossInput: gross,
            providerInput: gross,
            expectedGrossOutput: expectedGross,
            routerMinimumGrossOutput: protectedGross,
            protectedUserNetOutput: protectedGross - protectedFee,
            deadline: block.timestamp + 5 minutes,
            routeIdentity: executor.routeIdentity(route)
        });
    }

    function _expectInputRejected(
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization,
        RMTUniswapV3FeeExecutorV1.Route memory route
    ) private {
        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeInputFee(authorization, route);
    }

    function _expectOutputRejected(
        RMTUniswapV3FeeExecutorV1.FeeAuthorization memory authorization,
        RMTUniswapV3FeeExecutorV1.Route memory route
    ) private {
        vm.expectRevert();
        vm.prank(TRADER);
        executor.executeOutputFee(authorization, route);
    }

    function _assertClean(address inputToken, address outputToken) private view {
        assertEq(FeeExecutorToken(inputToken).balanceOf(address(executor)), 0, "input retained");
        assertEq(FeeExecutorToken(outputToken).balanceOf(address(executor)), 0, "output retained");
        assertEq(FeeExecutorToken(inputToken).allowance(address(executor), address(router)), 0, "allowance retained");
    }
}
