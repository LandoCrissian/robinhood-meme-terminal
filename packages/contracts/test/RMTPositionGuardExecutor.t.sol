// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTPositionGuardExecutor} from "../src/RMTPositionGuardExecutor.sol";

interface PositionGuardVm {
    function prank(address caller) external;
    function roll(uint256 blockNumber) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract GuardToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    bool public chargeTransferFee;
    address public reentryTarget;
    bytes public reentryData;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function setChargeTransferFee(bool value) external {
        chargeTransferFee = value;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool) {
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
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += chargeTransferFee ? amount - 1 : amount;
    }
}

contract GuardPool {
    address public token0;
    address public token1;
    int24 public twapTick;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setTick(int24 value) external {
        twapTick = value;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 index; index < secondsAgos.length; index++) {
            tickCumulatives[index] = int56(-int256(twapTick) * int256(uint256(secondsAgos[index])));
        }
    }
}

contract GuardFactory {
    mapping(bytes32 key => address pool) public pools;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[keccak256(abi.encode(tokenA < tokenB ? tokenA : tokenB, tokenA < tokenB ? tokenB : tokenA, fee))] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[keccak256(abi.encode(tokenA < tokenB ? tokenA : tokenB, tokenA < tokenB ? tokenB : tokenA, fee))];
    }
}

contract GuardRouter {
    GuardToken public immutable weth;
    uint256 public outputBps = 10_000;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    constructor(GuardToken weth_) {
        weth = weth_;
    }

    function setOutputBps(uint256 value) external {
        outputBps = value;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        require(params.tokenOut == address(weth), "output");
        require(GuardToken(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn), "input");
        amountOut = params.amountIn * outputBps / 10_000;
        require(amountOut >= params.amountOutMinimum, "minimum");
        weth.mint(params.recipient, amountOut);
    }
}

contract RMTPositionGuardExecutorTest {
    PositionGuardVm private constant vm = PositionGuardVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant WALLET = address(0xA11CE);
    uint24 private constant FEE = 3_000;
    uint256 private constant AMOUNT = 100 ether;

    GuardToken private token;
    GuardToken private weth;
    GuardPool private pool;
    GuardFactory private factory;
    GuardRouter private router;
    RMTPositionGuardExecutor private executor;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        token = new GuardToken();
        weth = new GuardToken();
        factory = new GuardFactory();
        router = new GuardRouter(weth);
        pool = new GuardPool(address(token), address(weth));
        factory.setPool(address(token), address(weth), FEE, address(pool));
        executor = new RMTPositionGuardExecutor(address(factory), address(router), address(weth));
        token.mint(WALLET, 1_000 ether);
    }

    function testRegisteredOrderExecutesOnlyAfterTwapConfirmation() public {
        bytes32 orderId = keccak256("confirmed");
        _register(orderId, AMOUNT);
        pool.setTick(-1_200);

        vm.prank(WALLET);
        RMTPositionGuardExecutor.V3OrderPreview memory first = executor.checkpointV3Order(orderId);
        require(first.state == RMTPositionGuardExecutor.TriggerState.Confirming, "not confirming");
        require(first.firstBelowFloorAt == block.timestamp, "missing confirmation time");
        require(first.firstBelowFloorBlock == block.number, "missing confirmation block");

        vm.warp(block.timestamp + 4);
        vm.roll(block.number + 1);
        RMTPositionGuardExecutor.V3OrderPreview memory ready = executor.previewV3Order(WALLET, orderId);
        require(ready.state == RMTPositionGuardExecutor.TriggerState.Triggered, "not triggered");

        vm.prank(WALLET);
        uint256 amountOut = executor.executeV3Exit(_exit(orderId, ready.twapAmountOut * 99 / 100));
        require(amountOut == AMOUNT, "output");
        require(token.balanceOf(WALLET) == 900 ether, "wallet input");
        require(weth.balanceOf(WALLET) == AMOUNT, "wallet output");
        require(token.balanceOf(address(executor)) == 0, "executor custody");
        require(weth.balanceOf(address(executor)) == 0, "executor output custody");
        require(token.allowance(address(executor), address(router)) == 0, "router allowance");
        require(executor.orderConsumed(WALLET, orderId), "order not consumed");
        RMTPositionGuardExecutor.V3Order memory order = executor.getV3Order(WALLET, orderId);
        require(order.status == RMTPositionGuardExecutor.OrderStatus.Executed, "order not executed");
    }

    function testUnregisteredHealthyAndUnconfirmedOrdersCannotExecute() public {
        vm.expectRevert(RMTPositionGuardExecutor.OrderNotActive.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(keccak256("missing"), 99 ether));

        bytes32 orderId = keccak256("healthy");
        _register(orderId, AMOUNT);
        vm.expectRevert(RMTPositionGuardExecutor.OrderNotTriggered.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, 99 ether));

        pool.setTick(-1_200);
        vm.expectRevert(RMTPositionGuardExecutor.ConfirmationRequired.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, 88 ether));

        vm.prank(WALLET);
        executor.checkpointV3Order(orderId);
        vm.warp(block.timestamp + 4);
        vm.expectRevert(RMTPositionGuardExecutor.ConfirmationRequired.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, 88 ether));
    }

    function testCheckpointRaisesButNeverLowersHighWatermark() public {
        bytes32 orderId = keccak256("high-watermark");
        _register(orderId, AMOUNT);
        RMTPositionGuardExecutor.V3Order memory registered = executor.getV3Order(WALLET, orderId);

        pool.setTick(1_200);
        vm.prank(WALLET);
        RMTPositionGuardExecutor.V3OrderPreview memory higher = executor.checkpointV3Order(orderId);
        require(higher.highWatermarkUnitQuoteX18 > registered.entryUnitQuoteX18, "high watermark did not rise");
        require(higher.state == RMTPositionGuardExecutor.TriggerState.Healthy, "gain marked unsafe");

        pool.setTick(0);
        vm.prank(WALLET);
        RMTPositionGuardExecutor.V3OrderPreview memory falling = executor.checkpointV3Order(orderId);
        require(falling.state == RMTPositionGuardExecutor.TriggerState.Confirming, "trailing floor not reached");
        require(falling.highWatermarkUnitQuoteX18 == higher.highWatermarkUnitQuoteX18, "high watermark moved back");
    }

    function testWeakMinimumOutputIsRejectedAgainstTwap() public {
        bytes32 orderId = keccak256("weak-minimum");
        _register(orderId, AMOUNT);
        RMTPositionGuardExecutor.V3OrderPreview memory ready = _trigger(orderId, -1_200);
        uint256 required = ready.twapAmountOut * 99 / 100;
        vm.expectRevert(RMTPositionGuardExecutor.UnsafeMinimumOutput.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, required - 1));
        require(token.balanceOf(WALLET) == 1_000 ether, "rejected order moved tokens");
        require(!executor.orderConsumed(WALLET, orderId), "rejected order consumed");
    }

    function testRegistrationAndExecutionRequireExactAllowanceAndBalance() public {
        bytes32 orderId = keccak256("authority");
        _approve(AMOUNT + 1);
        vm.expectRevert(RMTPositionGuardExecutor.ExactAllowanceRequired.selector);
        vm.prank(WALLET);
        executor.registerV3Order(_registration(orderId, AMOUNT));

        _register(orderId, AMOUNT);
        _trigger(orderId, -1_200);
        _approve(AMOUNT + 1);
        vm.expectRevert(RMTPositionGuardExecutor.ExactAllowanceRequired.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, 88 ether));

        _approve(AMOUNT);
        vm.prank(WALLET);
        token.transfer(address(0xCAFE), 901 ether);
        vm.expectRevert(RMTPositionGuardExecutor.InsufficientBalance.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, 88 ether));
    }

    function testCancellationAndExpiryEndOnchainOrder() public {
        bytes32 cancelled = keccak256("cancelled");
        _register(cancelled, AMOUNT);
        vm.prank(WALLET);
        executor.cancelV3Order(cancelled);
        RMTPositionGuardExecutor.V3Order memory cancelledOrder = executor.getV3Order(WALLET, cancelled);
        require(cancelledOrder.status == RMTPositionGuardExecutor.OrderStatus.Cancelled, "not cancelled");
        vm.expectRevert(RMTPositionGuardExecutor.OrderNotActive.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(cancelled, 99 ether));

        bytes32 expired = keccak256("expired");
        _register(expired, AMOUNT);
        RMTPositionGuardExecutor.V3Order memory activeOrder = executor.getV3Order(WALLET, expired);
        vm.warp(uint256(activeOrder.expiresAt) + 1);
        vm.prank(WALLET);
        RMTPositionGuardExecutor.V3OrderPreview memory preview = executor.checkpointV3Order(expired);
        require(preview.state == RMTPositionGuardExecutor.TriggerState.Expired, "not expired");
        RMTPositionGuardExecutor.V3Order memory expiredOrder = executor.getV3Order(WALLET, expired);
        require(expiredOrder.status == RMTPositionGuardExecutor.OrderStatus.Expired, "expiry not stored");
    }

    function testOrderIdCannotBeReused() public {
        bytes32 orderId = keccak256("one-time-id");
        _register(orderId, AMOUNT);
        vm.prank(WALLET);
        executor.cancelV3Order(orderId);
        vm.expectRevert(RMTPositionGuardExecutor.OrderAlreadyExists.selector);
        vm.prank(WALLET);
        executor.registerV3Order(_registration(orderId, AMOUNT));
    }

    function testFactoryPoolSubstitutionIsRejected() public {
        bytes32 orderId = keccak256("pool-binding");
        _register(orderId, AMOUNT);
        _trigger(orderId, -1_200);
        GuardPool replacement = new GuardPool(address(token), address(weth));
        replacement.setTick(-1_200);
        factory.setPool(address(token), address(weth), FEE, address(replacement));
        vm.expectRevert(RMTPositionGuardExecutor.InvalidPool.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, 88 ether));
    }

    function testInvalidPoolAndUnsafeBoundsAreRejected() public {
        factory.setPool(address(token), address(weth), FEE, address(0));
        _approve(AMOUNT);
        vm.expectRevert(RMTPositionGuardExecutor.InvalidPool.selector);
        vm.prank(WALLET);
        executor.registerV3Order(_registration(keccak256("missing-pool"), AMOUNT));

        factory.setPool(address(token), address(weth), FEE, address(pool));
        RMTPositionGuardExecutor.RegisterV3Order memory unsafe = _registration(keccak256("unsafe"), AMOUNT);
        unsafe.maxSlippageBps = 501;
        vm.expectRevert(RMTPositionGuardExecutor.InvalidOrder.selector);
        vm.prank(WALLET);
        executor.registerV3Order(unsafe);

        unsafe = _registration(keccak256("short-twap"), AMOUNT);
        unsafe.twapSeconds = 59;
        vm.expectRevert(RMTPositionGuardExecutor.InvalidOrder.selector);
        vm.prank(WALLET);
        executor.registerV3Order(unsafe);
    }

    function testFeeOnTransferAndReentryRemainBlocked() public {
        bytes32 orderId = keccak256("fee-token");
        _register(orderId, AMOUNT);
        RMTPositionGuardExecutor.V3OrderPreview memory ready = _trigger(orderId, -1_200);
        uint256 minimum = ready.twapAmountOut * 99 / 100;

        token.setChargeTransferFee(true);
        vm.expectRevert(RMTPositionGuardExecutor.UnsupportedTransferBehavior.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, minimum));
        require(token.balanceOf(WALLET) == 1_000 ether, "revert did not restore wallet");
        require(token.balanceOf(address(executor)) == 0, "revert left custody");

        token.setChargeTransferFee(false);
        token.setReentry(
            address(executor),
            abi.encodeCall(executor.executeV3Exit, (_exit(keccak256("nested"), 1)))
        );
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(orderId, minimum));
        require(weth.balanceOf(WALLET) == AMOUNT, "outer output missing");
    }

    function testRouterRevertRestoresOrderAndFunds() public {
        bytes32 orderId = keccak256("router-revert");
        _register(orderId, AMOUNT);
        RMTPositionGuardExecutor.V3OrderPreview memory ready = _trigger(orderId, -1_200);
        router.setOutputBps(8_000);
        vm.prank(WALLET);
        (bool success,) = address(executor).call(
            abi.encodeCall(executor.executeV3Exit, (_exit(orderId, ready.twapAmountOut * 99 / 100)))
        );
        require(!success, "unsafe router result accepted");
        require(!executor.orderConsumed(WALLET, orderId), "reverted order consumed");
        RMTPositionGuardExecutor.V3Order memory order = executor.getV3Order(WALLET, orderId);
        require(order.status == RMTPositionGuardExecutor.OrderStatus.Active, "reverted order not restored");
        require(token.balanceOf(WALLET) == 1_000 ether, "reverted tokens moved");
        require(token.balanceOf(address(executor)) == 0, "executor retained token");
    }

    function _trigger(bytes32 orderId, int24 tick)
        private
        returns (RMTPositionGuardExecutor.V3OrderPreview memory ready)
    {
        pool.setTick(tick);
        vm.prank(WALLET);
        executor.checkpointV3Order(orderId);
        vm.warp(block.timestamp + 4);
        vm.roll(block.number + 1);
        ready = executor.previewV3Order(WALLET, orderId);
        require(ready.state == RMTPositionGuardExecutor.TriggerState.Triggered, "trigger helper failed");
    }

    function _register(bytes32 orderId, uint256 amount) private {
        _approve(amount);
        vm.prank(WALLET);
        executor.registerV3Order(_registration(orderId, amount));
    }

    function _approve(uint256 amount) private {
        vm.prank(WALLET);
        token.approve(address(executor), amount);
    }

    function _registration(bytes32 orderId, uint256 amount)
        private
        view
        returns (RMTPositionGuardExecutor.RegisterV3Order memory)
    {
        return RMTPositionGuardExecutor.RegisterV3Order({
            token: address(token),
            fee: FEE,
            amountIn: uint128(amount),
            stopLossBps: 1_000,
            trailingStopBps: 1_000,
            breakEvenActivationBps: 5_000,
            maxSlippageBps: 100,
            twapSeconds: 300,
            expiresAt: uint64(block.timestamp + 1 days),
            orderId: orderId
        });
    }

    function _exit(bytes32 orderId, uint256 amountOutMinimum)
        private
        view
        returns (RMTPositionGuardExecutor.ExecuteV3Exit memory)
    {
        return RMTPositionGuardExecutor.ExecuteV3Exit({
            orderId: orderId,
            amountOutMinimum: amountOutMinimum,
            deadline: block.timestamp + 5 minutes
        });
    }
}
