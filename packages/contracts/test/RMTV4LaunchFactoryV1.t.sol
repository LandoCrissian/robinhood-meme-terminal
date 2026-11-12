// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IERC721Permit_v4} from "@uniswap/v4-periphery/src/interfaces/IERC721Permit_v4.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {
    ILaunchPermit2V1,
    ILaunchPositionManagerV1,
    RMTV4LaunchFactoryV1,
    RMTV4LaunchTokenV1
} from "../src/RMTV4LaunchFactoryV1.sol";

/// @dev Local allowance model. The separate fork test uses deployed Permit2 bytecode.
contract LaunchAllowanceHarness {
    struct Grant {
        uint160 amount;
        uint48 expiration;
    }

    mapping(address owner => mapping(address token => mapping(address spender => Grant))) public grants;

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        grants[msg.sender][token][spender] = Grant(amount, expiration);
    }

    function transferFrom(address owner, address recipient, uint160 amount, address token) external {
        Grant storage grant = grants[owner][token][msg.sender];
        require(amount <= grant.amount && block.timestamp <= grant.expiration, "unapproved");
        grant.amount -= amount;
        require(IERC20(token).transferFrom(owner, recipient, amount), "transfer failed");
    }
}

contract RefundReentryProbe {
    RMTV4LaunchFactoryV1 internal immutable factory;
    bool public attempted;
    bytes4 public failure;

    constructor(RMTV4LaunchFactoryV1 factory_) {
        factory = factory_;
    }

    function launch(RMTV4LaunchFactoryV1.Terms calldata terms) external payable returns (address) {
        return factory.launch{value: msg.value}(terms);
    }

    receive() external payable {
        attempted = true;
        try factory.collectFees(address(0), block.timestamp) {}
        catch (bytes memory reason) {
            failure = bytes4(reason);
        }
    }
}

contract LaunchCustodyProbe {
    RMTV4LaunchFactoryV1 internal immutable factory;
    PoolSwapTest internal immutable router;
    address[] public tokens;

    constructor(RMTV4LaunchFactoryV1 factory_, IPoolManager manager) {
        factory = factory_;
        router = new PoolSwapTest(manager);
    }

    receive() external payable {}

    function launch(uint32 seed) external {
        if (tokens.length >= 3) return;
        uint128 amount = uint128(0.1 ether + uint256(seed));
        RMTV4LaunchFactoryV1.Terms memory terms = RMTV4LaunchFactoryV1.Terms(
            "Invariant Token",
            "INVARIANT",
            "",
            bytes32(tokens.length + 1),
            uint8(seed % 3),
            uint16(1_000 + seed % 9_001),
            amount,
            block.timestamp
        );
        tokens.push(factory.launch{value: amount}(terms));
    }

    function buy(uint32 index) external {
        if (tokens.length == 0) return;
        PoolKey memory key = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(tokens[index % tokens.length]), 3000, 60, IHooks(address(0))
        );
        router.swap{value: 0.01 ether}(
            key, SwapParams(true, -0.01 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), ""
        );
    }

    function collect(uint32 index) external {
        if (tokens.length == 0) return;
        factory.collectFees(tokens[index % tokens.length], block.timestamp);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }
}

/// @dev Calls the real PoolManager directly to exercise an undeployed currency.
contract EmptyPoolPriceProbe is IUnlockCallback {
    IPoolManager internal immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function movePrice(PoolKey calldata key, uint160 limit) external returns (BalanceDelta) {
        return abi.decode(manager.unlock(abi.encode(key, limit)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (PoolKey memory key, uint160 limit) = abi.decode(data, (PoolKey, uint160));
        return abi.encode(manager.swap(key, SwapParams(true, -1, limit), ""));
    }
}

/// @dev Test-only model of an immutable, initialization-only hook.
contract LaunchInitializationGateProbe {
    address internal immutable manager;
    address internal immutable initializer;

    error UnexpectedManager();
    error UnexpectedInitializer();

    constructor(address manager_, address initializer_) {
        manager = manager_;
        initializer = initializer_;
    }

    function beforeInitialize(address sender, PoolKey calldata, uint160) external view returns (bytes4) {
        if (msg.sender != manager) revert UnexpectedManager();
        if (sender != initializer) revert UnexpectedInitializer();
        return IHooks.beforeInitialize.selector;
    }
}

contract RMTV4LaunchFactoryV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager internal manager;
    PositionManager internal positionManager;
    LaunchAllowanceHarness internal permit2;
    RMTV4LaunchFactoryV1 internal factory;
    LaunchCustodyProbe internal custodyProbe;
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.chainId(31337);
        manager = new PoolManager(address(this));
        permit2 = new LaunchAllowanceHarness();
        positionManager = new PositionManager(
            manager, IAllowanceTransfer(address(permit2)), 10_000, IPositionDescriptor(address(0)), IWETH9(address(0))
        );
        factory = new RMTV4LaunchFactoryV1(
            manager,
            ILaunchPositionManagerV1(address(positionManager)),
            ILaunchPermit2V1(address(permit2)),
            address(manager).codehash,
            address(positionManager).codehash,
            address(permit2).codehash
        );
        vm.deal(creator, 200 ether);
        vm.deal(stranger, 200 ether);
        custodyProbe = new LaunchCustodyProbe(factory, manager);
        vm.deal(address(custodyProbe), 200 ether);
        targetContract(address(custodyProbe));
    }

    function testExactFundingAndCreatorAllocation() public {
        _assertLaunch(_terms());
    }

    function testFuzzExactFundingAndRounding(uint8 preset, uint16 allocationBps, uint128 nativeAmount) public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        terms.supplyPreset = uint8(bound(preset, 0, 2));
        terms.poolAllocationBps = uint16(bound(allocationBps, 1_000, 10_000));
        terms.nativeAmount = uint128(bound(nativeAmount, 0.001 ether, 100 ether));
        _assertLaunch(terms);
    }

    function testPreinitializedPoolFailsAtomicallyAndNewIntentCanLaunch() public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        (,, uint160 price,,,) = factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        _assertPreinitializationRollsBack(terms, price);

        terms.intentId = keccak256("retry");
        _assertLaunch(terms);
    }

    function testWrongPriceAndPredictableRetryCanBothBePreinitialized() public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        (,, uint160 price,,,) = factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        _assertPreinitializationRollsBack(terms, price / 2);

        terms.intentId = keccak256("prepared retry");
        _assertPreinitializationRollsBack(terms, price / 2);

        terms.intentId = keccak256("unpoisoned retry");
        _assertLaunch(terms);
    }

    function testFundingOrDeadlineChangesPreserveThePoisonedPoolIdentity() public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        address predicted = _predictToken(terms);
        (,, uint160 price,,,) = factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);

        terms.nativeAmount = 2 ether;
        terms.poolAllocationBps = 5_000;
        terms.deadline = block.timestamp + 10 minutes;
        (,, uint160 newPrice,,,) = factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        assertNotEq(price, newPrice);
        assertEq(_predictToken(terms), predicted);
        _assertPreinitializationRollsBack(terms, price);
    }

    function testUnfundedPoolPriceCanMoveBeforeTokenExists() public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        address predicted = _predictToken(terms);
        PoolKey memory key = _pool(predicted);
        (,, uint160 price,,,) = factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);

        vm.prank(stranger);
        manager.initialize(key, price);
        EmptyPoolPriceProbe probe = new EmptyPoolPriceProbe(manager);
        vm.prank(stranger);
        BalanceDelta result = probe.movePrice(key, price / 2);

        assertEq(BalanceDelta.unwrap(result), BalanceDelta.unwrap(BalanceDeltaLibrary.ZERO_DELTA));
        (uint160 storedPrice,,,) = manager.getSlot0(key.toId());
        assertEq(storedPrice, price / 2);
        assertEq(manager.getLiquidity(key.toId()), 0);
        assertEq(address(manager).balance, 0);
        assertEq(predicted.code.length, 0);
    }

    function testInitializationOnlyHookBlocksPreinitializationAndAllowsNormalTrading() public {
        (address expectedHook, bytes32 salt) = HookMiner.find(
            address(this),
            Hooks.BEFORE_INITIALIZE_FLAG,
            type(LaunchInitializationGateProbe).creationCode,
            abi.encode(address(manager), address(this))
        );
        LaunchInitializationGateProbe hook =
            new LaunchInitializationGateProbe{salt: salt}(address(manager), address(this));
        assertEq(address(hook), expectedHook);
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, Hooks.BEFORE_INITIALIZE_FLAG);

        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        (uint256 supply,, uint160 price, uint128 liquidity, uint128 amount0, uint128 amount1) =
            factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        bytes32 tokenSalt = keccak256("gate-probe token");
        address predicted = Create2.computeAddress(
            tokenSalt,
            keccak256(
                abi.encodePacked(
                    type(RMTV4LaunchTokenV1).creationCode,
                    abi.encode(terms.name, terms.symbol, terms.projectURI, supply)
                )
            ),
            address(this)
        );
        PoolKey memory unguarded = _pool(predicted);
        PoolKey memory guarded = _pool(predicted);
        guarded.hooks = IHooks(address(hook));
        assertNotEq(PoolId.unwrap(unguarded.toId()), PoolId.unwrap(guarded.toId()));

        vm.prank(stranger);
        vm.expectRevert(LaunchInitializationGateProbe.UnexpectedManager.selector);
        hook.beforeInitialize(address(this), guarded, price);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(LaunchInitializationGateProbe.UnexpectedInitializer.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        manager.initialize(guarded, price / 2);
        (uint160 uninitializedPrice,,,) = manager.getSlot0(guarded.toId());
        assertEq(uninitializedPrice, 0);

        vm.prank(stranger);
        manager.initialize(unguarded, price / 2);
        RMTV4LaunchTokenV1 token =
            new RMTV4LaunchTokenV1{salt: tokenSalt}(terms.name, terms.symbol, terms.projectURI, supply);
        assertEq(address(token), predicted);

        manager.initialize(guarded, price);
        vm.deal(address(this), terms.nativeAmount);
        token.approve(address(permit2), amount1);
        permit2.approve(address(token), address(positionManager), amount1, uint48(terms.deadline));
        bytes[] memory params = new bytes[](2);
        uint256 positionId = positionManager.nextTokenId();
        params[0] = abi.encode(
            guarded, factory.TICK_LOWER(), factory.TICK_UPPER(), liquidity, amount0, amount1, address(this), bytes("")
        );
        params[1] = abi.encode(guarded.currency0, guarded.currency1);
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        positionManager.modifyLiquidities{value: amount0}(abi.encode(actions, params), terms.deadline);
        assertEq(positionManager.ownerOf(positionId), address(this));
        assertEq(manager.getLiquidity(guarded.toId()), liquidity);
        assertEq(manager.getLiquidity(unguarded.toId()), 0);

        PoolSwapTest router = new PoolSwapTest(manager);
        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings(false, false);
        vm.startPrank(stranger);
        router.swap{value: 0.1 ether}(guarded, SwapParams(true, -0.1 ether, TickMath.MIN_SQRT_PRICE + 1), settings, "");
        uint256 bought = token.balanceOf(stranger);
        assertGt(bought, 0);
        token.approve(address(router), bought);
        uint256 nativeBeforeSale = stranger.balance;
        router.swap(guarded, SwapParams(false, -int256(bought), TickMath.MAX_SQRT_PRICE - 1), settings, "");
        vm.stopPrank();
        assertEq(token.balanceOf(stranger), 0);
        assertGt(stranger.balance, nativeBeforeSale);
    }

    function testSameIntentIsBoundToCreatorAndCannotLaunchTwice() public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        address firstToken = _launch(creator, terms);
        vm.prank(creator);
        vm.expectRevert(RMTV4LaunchFactoryV1.DuplicateIntent.selector);
        factory.launch{value: terms.nativeAmount}(terms);
        assertNotEq(_launch(stranger, terms), firstToken);
    }

    function testRejectsInvalidEconomicsIdentityValueAndDeadlines() public {
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidTerms.selector);
        factory.preview(3, 1_000, 0.001 ether);
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidTerms.selector);
        factory.preview(0, 999, 0.001 ether);
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidTerms.selector);
        factory.preview(0, 10_001, 0.001 ether);
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidTerms.selector);
        factory.preview(0, 1_000, 0.001 ether - 1);
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidTerms.selector);
        factory.preview(0, 1_000, 100 ether + 1);

        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        vm.startPrank(creator);
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidTerms.selector);
        factory.launch{value: terms.nativeAmount - 1}(terms);
        terms.symbol = "unsafe token";
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidTerms.selector);
        factory.launch{value: terms.nativeAmount}(terms);
        terms.deadline = block.timestamp - 1;
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidDeadline.selector);
        factory.launch{value: terms.nativeAmount}(terms);
        terms.deadline = block.timestamp + 30 minutes + 1;
        vm.expectRevert(RMTV4LaunchFactoryV1.InvalidDeadline.selector);
        factory.launch{value: terms.nativeAmount}(terms);
        vm.stopPrank();
    }

    function testWrongChainOrRuntimeFailsClosed() public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        vm.chainId(4663);
        vm.prank(creator);
        vm.expectRevert(RMTV4LaunchFactoryV1.WrongChain.selector);
        factory.launch{value: terms.nativeAmount}(terms);
        vm.chainId(31337);
        vm.etch(address(permit2), hex"6000");
        vm.prank(creator);
        vm.expectRevert(RMTV4LaunchFactoryV1.RuntimeIdentityMismatch.selector);
        factory.launch{value: terms.nativeAmount}(terms);
    }

    function testCreatorAndPoolAdminCannotTransferOrRemovePrincipal() public {
        address token = _launch(creator, _terms());
        (, uint256 tokenId, uint128 liquidity) = factory.positions(token);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(1), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(address(0)), Currency.wrap(token), creator);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(IPositionManager.NotApproved.selector, creator));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(IPositionManager.NotApproved.selector, address(this)));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        vm.prank(creator);
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        positionManager.transferFrom(address(factory), creator, tokenId);
        vm.expectRevert(IERC721Permit_v4.Unauthorized.selector);
        positionManager.approve(address(this), tokenId);
        vm.prank(stranger);
        vm.expectRevert(RMTV4LaunchFactoryV1.UnauthorizedCreator.selector);
        factory.collectFees(token, block.timestamp);
        assertEq(positionManager.ownerOf(tokenId), address(factory));
        assertEq(positionManager.getPositionLiquidity(tokenId), liquidity);
    }

    function testBuySellAndCollectNativeAndTokenFeesWithoutPrincipal() public {
        address token = _launch(creator, _terms());
        PoolSwapTest router = new PoolSwapTest(manager);
        PoolKey memory key = _pool(token);
        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings(false, false);
        vm.startPrank(stranger);
        router.swap{value: 0.2 ether}(key, SwapParams(true, -0.2 ether, TickMath.MIN_SQRT_PRICE + 1), settings, "");
        uint256 bought = IERC20(token).balanceOf(stranger);
        assertGt(bought, 0);
        IERC20(token).approve(address(router), bought);
        router.swap(key, SwapParams(false, -int256(bought), TickMath.MAX_SQRT_PRICE - 1), settings, "");
        assertEq(IERC20(token).balanceOf(stranger), 0);
        vm.stopPrank();

        uint256 nativeBefore = creator.balance;
        uint256 tokensBefore = IERC20(token).balanceOf(creator);
        (, uint256 tokenId, uint128 liquidity) = factory.positions(token);
        vm.prank(creator);
        factory.collectFees(token, block.timestamp);
        assertGt(creator.balance, nativeBefore);
        assertGt(IERC20(token).balanceOf(creator), tokensBefore);
        assertEq(positionManager.getPositionLiquidity(tokenId), liquidity);
        assertEq(positionManager.ownerOf(tokenId), address(factory));

        nativeBefore = creator.balance;
        tokensBefore = IERC20(token).balanceOf(creator);
        vm.prank(creator);
        factory.collectFees(token, block.timestamp);
        assertEq(creator.balance, nativeBefore);
        assertEq(IERC20(token).balanceOf(creator), tokensBefore);
    }

    function testNativeRefundRejectsReentry() public {
        RMTV4LaunchFactoryV1.Terms memory terms = _terms();
        terms.nativeAmount = 100 ether;
        (,,,, uint128 nativeDeposited,) =
            factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        assertLt(nativeDeposited, terms.nativeAmount, "test setup needs a rounding refund");
        RefundReentryProbe probe = new RefundReentryProbe(factory);
        vm.prank(creator);
        address token = probe.launch{value: terms.nativeAmount}(terms);
        assertTrue(probe.attempted());
        assertEq(probe.failure(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(address(probe).balance, terms.nativeAmount - nativeDeposited);
        assertEq(factory.launches(address(probe), terms.intentId), token);
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 32
    /// forge-config: default.invariant.fail-on-revert = true
    function invariantPositionsRemainLockedAcrossLaunchesSwapsAndClaims() public view {
        assertEq(address(factory).balance, 0);
        uint256 count = custodyProbe.tokenCount();
        for (uint256 i; i < count; ++i) {
            address token = custodyProbe.tokens(i);
            (address recordedCreator, uint256 id, uint128 liquidity) = factory.positions(token);
            assertEq(recordedCreator, address(custodyProbe));
            assertGt(liquidity, 0);
            assertEq(positionManager.ownerOf(id), address(factory));
            assertEq(positionManager.getPositionLiquidity(id), liquidity);
            assertEq(IERC20(token).balanceOf(address(factory)), 0);
            assertEq(IERC20(token).allowance(address(factory), address(permit2)), 0);
        }
    }

    function _assertLaunch(RMTV4LaunchFactoryV1.Terms memory terms) internal {
        (uint256 supply, uint128 maximum, uint160 price, uint128 liquidity, uint128 amount0, uint128 amount1) =
            factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        uint256 nativeBefore = creator.balance;
        address token = _launch(creator, terms);
        (address recordedCreator, uint256 positionId, uint128 recordedLiquidity) = factory.positions(token);
        assertEq(recordedCreator, creator);
        assertEq(positionManager.ownerOf(positionId), address(factory));
        assertEq(positionManager.getPositionLiquidity(positionId), recordedLiquidity);
        assertEq(recordedLiquidity, liquidity);
        assertEq(address(manager).balance, amount0);
        assertEq(IERC20(token).balanceOf(address(manager)), amount1);
        assertEq(IERC20(token).balanceOf(creator), supply - amount1);
        assertEq(IERC20(token).totalSupply(), supply);
        assertEq(creator.balance, nativeBefore - amount0);
        assertEq(address(factory).balance, 0);
        assertEq(address(positionManager).balance, 0);
        assertEq(IERC20(token).balanceOf(address(factory)), 0);
        assertEq(IERC20(token).allowance(address(factory), address(permit2)), 0);
        (uint160 grant,) = permit2.grants(address(factory), token, address(positionManager));
        assertEq(grant, 0);
        assertLe(amount1, maximum);
        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertEq(manager.getLiquidity(_pool(token).toId()), liquidity);
        (uint160 slotPrice, int24 tick,,) = manager.getSlot0(_pool(token).toId());
        assertEq(slotPrice, price);
        assertGt(tick, factory.TICK_LOWER());
        assertLt(tick, factory.TICK_UPPER());
    }

    function _assertPreinitializationRollsBack(RMTV4LaunchFactoryV1.Terms memory terms, uint160 poisonPrice) internal {
        address predicted = _predictToken(terms);
        PoolKey memory key = _pool(predicted);
        assertEq(predicted.code.length, 0);
        uint256 nativeBefore = address(manager).balance;
        uint256 creatorNativeBefore = creator.balance;
        uint256 firstPosition = positionManager.nextTokenId();

        vm.prank(stranger);
        manager.initialize(key, poisonPrice);

        vm.prank(creator);
        vm.expectRevert(Pool.PoolAlreadyInitialized.selector);
        factory.launch{value: terms.nativeAmount}(terms);
        assertEq(predicted.code.length, 0);
        assertEq(factory.launches(creator, terms.intentId), address(0));
        (address recordedCreator, uint256 recordedId, uint128 recordedLiquidity) = factory.positions(predicted);
        assertEq(recordedCreator, address(0));
        assertEq(recordedId, 0);
        assertEq(recordedLiquidity, 0);
        assertEq(positionManager.nextTokenId(), firstPosition);
        assertEq(address(manager).balance, nativeBefore);
        assertEq(creator.balance, creatorNativeBefore);
        assertEq(address(factory).balance, 0);
        assertEq(manager.getLiquidity(key.toId()), 0);
        (uint160 storedPrice,,,) = manager.getSlot0(key.toId());
        assertEq(storedPrice, poisonPrice);
    }

    function _predictToken(RMTV4LaunchFactoryV1.Terms memory terms) internal view returns (address) {
        (uint256 supply,,,,,) = factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        return Create2.computeAddress(
            keccak256(abi.encode(creator, terms.intentId)),
            keccak256(
                abi.encodePacked(
                    type(RMTV4LaunchTokenV1).creationCode,
                    abi.encode(terms.name, terms.symbol, terms.projectURI, supply)
                )
            ),
            address(factory)
        );
    }

    function _launch(address account, RMTV4LaunchFactoryV1.Terms memory terms) internal returns (address) {
        vm.prank(account);
        return factory.launch{value: terms.nativeAmount}(terms);
    }

    function _terms() internal view returns (RMTV4LaunchFactoryV1.Terms memory) {
        return RMTV4LaunchFactoryV1.Terms(
            "Local Launch",
            "LOCAL",
            "ipfs://local-test",
            bytes32(uint256(1)),
            0,
            8_000,
            1 ether,
            block.timestamp + 15 minutes
        );
    }

    function _pool(address token) internal pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(token), 3000, 60, IHooks(address(0)));
    }
}
