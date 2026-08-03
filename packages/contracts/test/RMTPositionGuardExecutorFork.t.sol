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

interface PositionGuardForkQuoter {
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

/// @dev Opt-in fork test against the canonical Robinhood Chain deployment. It never broadcasts.
///      Run with: RMT_RUN_MAINNET_FORK=true forge test --match-path test/RMTPositionGuardExecutorFork.t.sol -vv
contract RMTPositionGuardExecutorForkTest {
    PositionGuardForkVm private constant vm =
        PositionGuardForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
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

    function testCanonicalBuyThenProtectedExit() public {
        if (!enabled) return;

        RMTPositionGuardExecutor executor = new RMTPositionGuardExecutor(FACTORY, ROUTER, WETH);
        vm.deal(WALLET, 1 ether);

        vm.startPrank(WALLET);
        PositionGuardForkWeth(WETH).deposit{value: 0.001 ether}();
        PositionGuardForkWeth(WETH).approve(ROUTER, 0.001 ether);
        uint256 tokenAmount = IRMTPositionGuardSwapRouter02(ROUTER)
            .exactInputSingle(
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
        PositionGuardForkToken(TOKEN).approve(address(executor), tokenAmount);
        vm.stopPrank();

        vm.prank(WALLET);
        (uint256 quotedWeth,,,) = PositionGuardForkQuoter(QUOTER)
            .quoteExactInputSingle(
                PositionGuardForkQuoter.QuoteExactInputSingleParams({
                tokenIn: TOKEN, tokenOut: WETH, amountIn: tokenAmount, fee: FEE, sqrtPriceLimitX96: 0
            })
            );
        uint256 minimumWeth = quotedWeth * 99 / 100;
        uint256 wethBefore = PositionGuardForkToken(WETH).balanceOf(WALLET);

        vm.prank(WALLET);
        uint256 amountOut = executor.executeV3Exit(
            RMTPositionGuardExecutor.Exit({
                token: TOKEN,
                fee: FEE,
                amountIn: tokenAmount,
                amountOutMinimum: minimumWeth,
                maxSlippageBps: 500,
                deadline: block.timestamp + 5 minutes,
                orderId: keccak256("canonical-fork-exit")
            })
        );

        require(amountOut >= minimumWeth, "protected output below minimum");
        require(PositionGuardForkToken(TOKEN).balanceOf(WALLET) == 0, "protected token remained");
        require(PositionGuardForkToken(WETH).balanceOf(WALLET) == wethBefore + amountOut, "WETH not returned");
        require(PositionGuardForkToken(TOKEN).balanceOf(address(executor)) == 0, "executor retained token");
        require(PositionGuardForkToken(WETH).balanceOf(address(executor)) == 0, "executor retained WETH");
        require(PositionGuardForkToken(TOKEN).allowance(address(executor), ROUTER) == 0, "router allowance remained");
    }
}
