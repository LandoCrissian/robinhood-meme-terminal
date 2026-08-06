// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTPositionGuardExecutor, IRMTPositionGuardSwapRouter02} from "../src/RMTPositionGuardExecutor.sol";

interface PositionGuardForkVm {
    function createSelectFork(string calldata rpcAlias) external returns (uint256 forkId);
    function deal(address account, uint256 balance) external;
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
}

interface PositionGuardForkToken {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface PositionGuardForkWeth is PositionGuardForkToken {
    function deposit() external payable;
}

/// @dev Opt-in fork rehearsal against the canonical Robinhood Chain deployment. It never broadcasts.
///      The wallet buys the live token, grants an exact allowance, registers a TWAP-bound order, verifies its immutable
///      route and settings, cancels it onchain, and clears the allowance.
///      Run with: RMT_RUN_MAINNET_FORK=true forge test --match-path test/RMTPositionGuardExecutorFork.t.sol -vv
contract RMTPositionGuardExecutorForkTest {
    PositionGuardForkVm private constant vm =
        PositionGuardForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant TOKEN = 0x232CDFc415D10b673845D83Dc02ba2eaBe7e30d1; // gitleaks:allow -- public token address
    address private constant WALLET = address(0xA11CE);
    uint24 private constant FEE = 10_000;

    bool private enabled;

    function setUp() public {
        enabled = vm.envOr("RMT_RUN_MAINNET_FORK", false);
        if (!enabled) return;
        vm.createSelectFork("robinhood_mainnet");
    }

    function testCanonicalBuyRegisterAndRevoke() public {
        if (!enabled) return;

        RMTPositionGuardExecutor executor = new RMTPositionGuardExecutor(FACTORY, ROUTER, WETH);
        vm.deal(WALLET, 1 ether);

        vm.startPrank(WALLET);
        PositionGuardForkWeth(WETH).deposit{value: 0.001 ether}();
        PositionGuardForkWeth(WETH).approve(ROUTER, 0.001 ether);
        uint256 tokenAmount = IRMTPositionGuardSwapRouter02(ROUTER).exactInputSingle(
            IRMTPositionGuardSwapRouter02.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: TOKEN,
                fee: FEE,
                recipient: WALLET,
                amountIn: 0.001 ether,
                amountOutMinimum: 1,
                sqrtPriceLimitX96: 0
            })
        );
        uint128 protectedAmount = tokenAmount > type(uint128).max ? type(uint128).max : uint128(tokenAmount);
        PositionGuardForkToken(TOKEN).approve(address(executor), protectedAmount);
        vm.stopPrank();

        bytes32 orderId = keccak256("canonical-fork-order-v2");
        vm.prank(WALLET);
        executor.registerV3Order(
            RMTPositionGuardExecutor.RegisterV3Order({
                token: TOKEN,
                fee: FEE,
                amountIn: protectedAmount,
                stopLossBps: 2_000,
                trailingStopBps: 2_000,
                breakEvenActivationBps: 5_000,
                maxSlippageBps: 100,
                twapSeconds: 300,
                expiresAt: uint64(block.timestamp + 1 days),
                orderId: orderId
            })
        );

        RMTPositionGuardExecutor.V3Order memory order = executor.getV3Order(WALLET, orderId);
        require(order.status == RMTPositionGuardExecutor.OrderStatus.Active, "order inactive");
        require(order.token == TOKEN, "token mismatch");
        require(order.amountIn == protectedAmount, "amount mismatch");
        require(order.fee == FEE, "fee mismatch");
        require(order.entryUnitQuoteX18 > 0, "entry TWAP missing");
        require(order.highWatermarkUnitQuoteX18 == order.entryUnitQuoteX18, "initial high watermark mismatch");
        require(PositionGuardForkToken(TOKEN).allowance(WALLET, address(executor)) == protectedAmount, "allowance mismatch");

        vm.startPrank(WALLET);
        executor.cancelV3Order(orderId);
        PositionGuardForkToken(TOKEN).approve(address(executor), 0);
        vm.stopPrank();

        order = executor.getV3Order(WALLET, orderId);
        require(order.status == RMTPositionGuardExecutor.OrderStatus.Cancelled, "order not cancelled");
        require(PositionGuardForkToken(TOKEN).allowance(WALLET, address(executor)) == 0, "allowance remained");
        require(PositionGuardForkToken(TOKEN).balanceOf(address(executor)) == 0, "executor retained token");
        require(PositionGuardForkToken(WETH).balanceOf(address(executor)) == 0, "executor retained WETH");
    }
}
