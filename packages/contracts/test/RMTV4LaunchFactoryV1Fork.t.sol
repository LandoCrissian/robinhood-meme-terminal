// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ILaunchPermit2V1, ILaunchPositionManagerV1, RMTV4LaunchFactoryV1} from "../src/RMTV4LaunchFactoryV1.sol";

interface ILaunchUniversalRouterV1 {
    function poolManager() external view returns (IPoolManager);
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

contract RMTV4LaunchFactoryV1ForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function testForkLaunchQuoteBuySellAndClaimWithOfficialUniswap() public {
        string memory upstream = vm.envOr("RMT_V4_BASE_SEPOLIA_RPC", string(""));
        if (bytes(upstream).length == 0) vm.skip(true);
        string memory pins = vm.readFile("test/fixtures/rmt-v4-deployment-identities.json");
        vm.createSelectFork(upstream, vm.parseJsonUint(pins, ".baseSepolia.block"));
        assertEq(block.chainid, vm.parseJsonUint(pins, ".baseSepolia.chainId"));

        IPoolManager manager = IPoolManager(_verifiedAddress(pins, "poolManager"));
        ILaunchPositionManagerV1 positionManager = ILaunchPositionManagerV1(_verifiedAddress(pins, "positionManager"));
        IAllowanceTransfer permit2 = IAllowanceTransfer(_verifiedAddress(pins, "permit2"));
        ILaunchUniversalRouterV1 router = ILaunchUniversalRouterV1(_verifiedAddress(pins, "universalRouter"));
        IV4Quoter quoter = IV4Quoter(_verifiedAddress(pins, "quoter"));
        _verifiedAddress(pins, "stateView");
        assertEq(address(router.poolManager()), address(manager));
        assertEq(address(quoter.poolManager()), address(manager));
        vm.chainId(31337);

        RMTV4LaunchFactoryV1 factory = new RMTV4LaunchFactoryV1(
            manager,
            positionManager,
            ILaunchPermit2V1(address(permit2)),
            address(manager).codehash,
            address(positionManager).codehash,
            address(permit2).codehash
        );
        address creator = makeAddr("fork creator");
        address buyer = makeAddr("fork buyer");
        vm.deal(creator, 2 ether);
        vm.deal(buyer, 2 ether);
        uint256 deadline = block.timestamp + 15 minutes;
        RMTV4LaunchFactoryV1.Terms memory terms =
            RMTV4LaunchFactoryV1.Terms("Fork Launch", "FORK", "", bytes32(uint256(1)), 0, 8_000, 1 ether, deadline);
        vm.prank(creator);
        address token = factory.launch{value: 1 ether}(terms);
        (, uint256 positionId, uint128 liquidity) = factory.positions(token);
        PoolKey memory pool = PoolKey(Currency.wrap(address(0)), Currency.wrap(token), 3000, 60, IHooks(address(0)));

        uint128 buyAmount = 0.2 ether;
        (uint256 buyQuote,) = quoter.quoteExactInputSingle(IV4Quoter.QuoteExactSingleParams(pool, true, buyAmount, ""));
        assertGt(buyQuote, 0);
        assertEq(buyQuote, _singleRangeOutput(manager, pool, liquidity, true, buyAmount));
        vm.startPrank(buyer);
        vm.expectRevert();
        _swap(router, pool, true, buyAmount, uint128(buyQuote + 1), deadline);
        _swap(router, pool, true, buyAmount, uint128(buyQuote), deadline);
        assertEq(IERC20(token).balanceOf(buyer), buyQuote);

        uint128 sellAmount = uint128(buyQuote / 2);
        (uint256 sellQuote,) =
            quoter.quoteExactInputSingle(IV4Quoter.QuoteExactSingleParams(pool, false, sellAmount, ""));
        assertGt(sellQuote, 0);
        assertEq(sellQuote, _singleRangeOutput(manager, pool, liquidity, false, sellAmount));
        IERC20(token).approve(address(permit2), sellAmount);
        permit2.approve(token, address(router), sellAmount, uint48(deadline));
        uint256 buyerNative = buyer.balance;
        vm.expectRevert();
        _swap(router, pool, false, sellAmount, uint128(sellQuote), block.timestamp - 1);
        _swap(router, pool, false, sellAmount, uint128(sellQuote), deadline);
        assertEq(buyer.balance, buyerNative + sellQuote);
        assertEq(IERC20(token).balanceOf(buyer), buyQuote - sellAmount);
        assertEq(IERC20(token).allowance(buyer, address(permit2)), 0);
        (uint160 allowance,,) = permit2.allowance(buyer, token, address(router));
        assertEq(allowance, 0);
        vm.stopPrank();

        uint256 creatorNative = creator.balance;
        uint256 creatorTokens = IERC20(token).balanceOf(creator);
        vm.prank(creator);
        factory.collectFees(token, deadline);
        assertGt(creator.balance, creatorNative);
        assertGt(IERC20(token).balanceOf(creator), creatorTokens);
        assertEq(positionManager.ownerOf(positionId), address(factory));
        assertEq(positionManager.getPositionLiquidity(positionId), liquidity);
    }

    function _verifiedAddress(string memory pins, string memory name) private view returns (address deployment) {
        string memory key = string.concat(".baseSepolia.", name);
        deployment = vm.parseJsonAddress(pins, string.concat(key, ".address"));
        assertGt(deployment.code.length, 0);
        assertEq(deployment.codehash, vm.parseJsonBytes32(pins, string.concat(key, ".runtimeHash")));
    }

    function _singleRangeOutput(
        IPoolManager manager,
        PoolKey memory pool,
        uint128 liquidity,
        bool buy,
        uint128 grossInput
    ) private view returns (uint256 output) {
        (uint160 price,, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(pool.toId());
        assertEq(protocolFee, 0);
        uint160 boundary = TickMath.getSqrtPriceAtTick(buy ? int24(-887_220) : int24(887_220));
        (uint160 next, uint256 netInput, uint256 received, uint256 fee) =
            SwapMath.computeSwapStep(price, boundary, liquidity, -int256(uint256(grossInput)), lpFee);
        assertNotEq(next, boundary);
        assertEq(netInput + fee, grossInput);
        return received;
    }

    function _swap(
        ILaunchUniversalRouterV1 router,
        PoolKey memory pool,
        bool zeroForOne,
        uint128 amountIn,
        uint128 minimumOut,
        uint256 deadline
    ) private {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE_ALL)
        );
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(pool, zeroForOne, amountIn, minimumOut, ""));
        params[1] = abi.encode(zeroForOne ? pool.currency0 : pool.currency1, amountIn, true);
        params[2] = abi.encode(zeroForOne ? pool.currency1 : pool.currency0, minimumOut);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        router.execute{value: zeroForOne ? amountIn : 0}(hex"10", inputs, deadline);
    }
}
