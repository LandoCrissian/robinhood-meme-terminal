// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTPositionGuardExecutor} from "../src/RMTPositionGuardExecutor.sol";

interface PositionGuardVm {
    function prank(address caller) external;
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
    uint160 public sqrtPriceX96 = uint160(1 << 96);
    bool public unlocked = true;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setPrice(uint160 value) external {
        sqrtPriceX96 = value;
    }

    function setUnlocked(bool value) external {
        unlocked = value;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 1, 1, 0, unlocked);
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

    GuardToken private token;
    GuardToken private weth;
    GuardPool private pool;
    GuardFactory private factory;
    GuardRouter private router;
    RMTPositionGuardExecutor private executor;

    function setUp() public {
        vm.warp(1_000_000);
        token = new GuardToken();
        weth = new GuardToken();
        factory = new GuardFactory();
        router = new GuardRouter(weth);
        pool = new GuardPool(address(token), address(weth));
        factory.setPool(address(token), address(weth), FEE, address(pool));
        executor = new RMTPositionGuardExecutor(address(factory), address(router), address(weth));
        token.mint(WALLET, 1_000 ether);
        vm.prank(WALLET);
        token.approve(address(executor), 1_000 ether);
    }

    function testExecutesExactExitAndReturnsWethOnlyToCallingWallet() public {
        RMTPositionGuardExecutor.Exit memory exit = _exit(100 ether, 99 ether, keccak256("one"));
        vm.prank(WALLET);
        uint256 amountOut = executor.executeV3Exit(exit);

        require(amountOut == 100 ether, "output");
        require(token.balanceOf(WALLET) == 900 ether, "wallet input");
        require(weth.balanceOf(WALLET) == 100 ether, "wallet output");
        require(token.balanceOf(address(executor)) == 0, "executor custody");
        require(weth.balanceOf(address(executor)) == 0, "executor output custody");
        require(token.allowance(address(executor), address(router)) == 0, "router allowance");
        require(executor.orderConsumed(WALLET, exit.orderId), "order not consumed");
    }

    function testCannotReplayAnExecutedOrder() public {
        RMTPositionGuardExecutor.Exit memory exit = _exit(10 ether, 9.9 ether, keccak256("replay"));
        vm.prank(WALLET);
        executor.executeV3Exit(exit);
        vm.expectRevert(RMTPositionGuardExecutor.OrderAlreadyConsumed.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(exit);
    }

    function testRejectsAWeakMinimumOutputEvenWhenRouterWouldAcceptIt() public {
        vm.prank(WALLET);
        (bool success,) = address(executor)
            .call(abi.encodeCall(executor.executeV3Exit, (_exit(100 ether, 94 ether, keccak256("weak-minimum")))));
        require(!success, "weak minimum accepted");
        require(token.balanceOf(WALLET) == 1_000 ether, "rejected order moved tokens");
    }

    function testRejectsUnboundedSlippageAndDeadlines() public {
        RMTPositionGuardExecutor.Exit memory excessive = _exit(100 ether, 99 ether, keccak256("slippage"));
        excessive.maxSlippageBps = 501;
        vm.expectRevert(RMTPositionGuardExecutor.InvalidExit.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(excessive);

        RMTPositionGuardExecutor.Exit memory late = _exit(100 ether, 99 ether, keccak256("deadline"));
        late.deadline = block.timestamp + 10 minutes + 1;
        vm.expectRevert(RMTPositionGuardExecutor.InvalidExit.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(late);
    }

    function testRejectsFeeOnTransferTokensWithoutLeavingCustody() public {
        token.setChargeTransferFee(true);
        vm.expectRevert(RMTPositionGuardExecutor.UnsupportedTransferBehavior.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(100 ether, 99 ether, keccak256("fee-token")));
        require(token.balanceOf(WALLET) == 1_000 ether, "revert did not restore wallet");
        require(token.balanceOf(address(executor)) == 0, "revert left custody");
    }

    function testTokenCallbackCannotReenterExecutor() public {
        RMTPositionGuardExecutor.Exit memory nested = _exit(1 ether, 0.99 ether, keccak256("nested"));
        token.setReentry(address(executor), abi.encodeCall(executor.executeV3Exit, (nested)));

        vm.prank(WALLET);
        executor.executeV3Exit(_exit(100 ether, 99 ether, keccak256("outer")));

        require(token.balanceOf(WALLET) == 900 ether, "outer exit failed");
        require(weth.balanceOf(WALLET) == 100 ether, "output missing");
        require(!executor.orderConsumed(address(token), nested.orderId), "nested order consumed");
    }

    function testRejectsAnUnregisteredOrMismatchedPool() public {
        factory.setPool(address(token), address(weth), FEE, address(0));
        vm.expectRevert(RMTPositionGuardExecutor.InvalidPool.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(100 ether, 99 ether, keccak256("missing-pool")));

        GuardToken other = new GuardToken();
        GuardPool wrongPool = new GuardPool(address(token), address(other));
        factory.setPool(address(token), address(weth), FEE, address(wrongPool));
        vm.expectRevert(RMTPositionGuardExecutor.InvalidPool.selector);
        vm.prank(WALLET);
        executor.executeV3Exit(_exit(100 ether, 99 ether, keccak256("wrong-pool")));
    }

    function testARevertedRouterCallDoesNotConsumeTheOrderOrTokens() public {
        router.setOutputBps(9_800);
        bytes32 orderId = keccak256("router-revert");
        vm.prank(WALLET);
        (bool success,) =
            address(executor).call(abi.encodeCall(executor.executeV3Exit, (_exit(100 ether, 99 ether, orderId))));
        require(!success, "unsafe router result accepted");
        require(!executor.orderConsumed(WALLET, orderId), "reverted order consumed");
        require(token.balanceOf(WALLET) == 1_000 ether, "reverted tokens moved");
    }

    function _exit(uint256 amountIn, uint256 amountOutMinimum, bytes32 orderId)
        private
        view
        returns (RMTPositionGuardExecutor.Exit memory)
    {
        return RMTPositionGuardExecutor.Exit({
            token: address(token),
            fee: FEE,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            maxSlippageBps: 100,
            deadline: block.timestamp + 5 minutes,
            orderId: orderId
        });
    }
}
