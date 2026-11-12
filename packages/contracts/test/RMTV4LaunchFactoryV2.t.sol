// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IERC721Permit_v4} from "@uniswap/v4-periphery/src/interfaces/IERC721Permit_v4.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ILaunchPermit2V1, ILaunchPositionManagerV1, RMTV4LaunchTokenV1} from "../src/RMTV4LaunchFactoryV1.sol";
import {RMTV4LaunchFactoryV2} from "../src/RMTV4LaunchFactoryV2.sol";
import {RMTV4LaunchDeploymentV2} from "../src/RMTV4LaunchDeploymentV2.sol";
import {RMTV4InitializationGuard} from "../src/RMTV4InitializationGuard.sol";
import {RMTV4LongevityLedger} from "../src/RMTV4LongevityLedger.sol";
import {LaunchAllowanceHarness} from "./RMTV4LaunchFactoryV1.t.sol";

abstract contract GuardedLaunchFixture is Test {
    struct PairPrediction {
        address deployment;
        address factory;
        address guard;
        bytes32 salt;
    }

    function _predictPair(IPoolManager manager) internal view returns (PairPrediction memory pair) {
        pair.deployment = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        pair.factory = vm.computeCreateAddress(pair.deployment, 2);
        (pair.guard, pair.salt) = HookMiner.find(
            pair.deployment,
            Hooks.BEFORE_INITIALIZE_FLAG,
            type(RMTV4InitializationGuard).creationCode,
            abi.encode(manager, pair.factory)
        );
    }

    function _deployPair(
        IPoolManager manager,
        ILaunchPositionManagerV1 positionManager,
        ILaunchPermit2V1 permit2,
        PairPrediction memory pair
    ) internal returns (RMTV4LaunchFactoryV2 factory) {
        RMTV4LaunchDeploymentV2 deployment = new RMTV4LaunchDeploymentV2(
            manager,
            positionManager,
            permit2,
            address(manager).codehash,
            address(positionManager).codehash,
            address(permit2).codehash,
            pair.salt
        );
        factory = deployment.factory();
        RMTV4InitializationGuard guard = deployment.initializationGuard();
        assertEq(address(deployment), pair.deployment);
        assertEq(address(factory), pair.factory);
        assertEq(address(guard), pair.guard);
        assertEq(address(factory.initializationGuard()), address(guard));
        assertEq(factory.initializationGuardRuntimeHash(), address(guard).codehash);
        assertEq(guard.factory(), address(factory));
        assertEq(address(guard.poolManager()), address(manager));
        assertEq(uint160(address(guard)) & Hooks.ALL_HOOK_MASK, Hooks.BEFORE_INITIALIZE_FLAG);
    }

    function _pool(address token, address guard) internal pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(token), 3000, 60, IHooks(guard));
    }
}

contract RMTV4LaunchFactoryV2Test is GuardedLaunchFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager private manager;
    ILaunchPositionManagerV1 private positionManager;
    ILaunchPermit2V1 private permit2;
    address private creator = makeAddr("guarded creator");
    address private stranger = makeAddr("guarded stranger");

    function setUp() public {
        vm.chainId(31337);
        manager = new PoolManager(address(this));
        permit2 = ILaunchPermit2V1(address(new LaunchAllowanceHarness()));
        positionManager = ILaunchPositionManagerV1(
            address(
                new PositionManager(
                    manager,
                    IAllowanceTransfer(address(permit2)),
                    10_000,
                    IPositionDescriptor(address(0)),
                    IWETH9(address(0))
                )
            )
        );
        vm.deal(creator, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    function testHostileInitializationFailsBeforeAndAfterGuardDeployment() public {
        PairPrediction memory pair = _predictPair(manager);
        RMTV4LaunchFactoryV2.Terms memory terms = _terms();
        address predictedToken = _predictToken(pair.factory, terms);
        PoolKey memory guarded = _pool(predictedToken, pair.guard);
        PoolKey memory alternate = _pool(predictedToken, address(0));
        assertNotEq(PoolId.unwrap(guarded.toId()), PoolId.unwrap(alternate.toId()));
        assertEq(pair.guard.code.length, 0);
        assertEq(predictedToken.code.length, 0);

        // A low-bit hook address without code cannot return the required callback selector.
        vm.expectRevert(Hooks.InvalidHookResponse.selector);
        vm.prank(stranger);
        manager.initialize(guarded, uint160(1) << 96);

        RMTV4LaunchFactoryV2 factory = _deployPair(manager, positionManager, permit2, pair);
        (uint256 totalSupply,, uint160 price, uint128 liquidity, uint128 amount0, uint128 amount1) =
            factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        _assertHostileInitializeReverts(guarded, price);
        _assertHostileInitializeReverts(guarded, price / 2);
        vm.prank(stranger);
        manager.initialize(alternate, price / 2);
        (uint160 guardedPrice,,,) = manager.getSlot0(guarded.toId());
        assertEq(guardedPrice, 0);

        uint256 priorManagerBalance = address(manager).balance;
        uint256 priorCreatorBalance = creator.balance;
        vm.prank(creator);
        address token = factory.launch{value: terms.nativeAmount}(terms);
        assertEq(token, predictedToken);
        assertEq(factory.launches(creator, terms.intentId), token);
        assertEq(address(manager).balance - priorManagerBalance, amount0);
        assertEq(priorCreatorBalance - creator.balance, amount0);
        assertEq(IERC20(token).balanceOf(address(manager)), amount1);
        assertEq(IERC20(token).balanceOf(creator), totalSupply - amount1);
        (, uint256 positionId, uint128 locked) = factory.positions(token);
        assertEq(locked, liquidity);
        assertEq(positionManager.ownerOf(positionId), address(factory));
        assertEq(positionManager.getPositionLiquidity(positionId), liquidity);
        (guardedPrice,,,) = manager.getSlot0(guarded.toId());
        (uint160 alternatePrice,,,) = manager.getSlot0(alternate.toId());
        assertEq(guardedPrice, price);
        assertEq(alternatePrice, price / 2);
    }

    function testGuardRejectsSpoofedManagerFactoryAndPoolKey() public {
        RMTV4LaunchFactoryV2 factory = _deployPair(manager, positionManager, permit2, _predictPair(manager));
        RMTV4InitializationGuard guard = factory.initializationGuard();
        PoolKey memory key = _pool(address(1), address(guard));
        vm.expectRevert(RMTV4InitializationGuard.UnexpectedManager.selector);
        vm.prank(stranger);
        guard.beforeInitialize(address(factory), key, 1);
        vm.expectRevert(RMTV4InitializationGuard.UnexpectedInitializer.selector);
        vm.prank(address(manager));
        guard.beforeInitialize(stranger, key, 1);
        key.hooks = IHooks(address(0));
        vm.expectRevert(RMTV4InitializationGuard.UnexpectedPoolKey.selector);
        vm.prank(address(manager));
        guard.beforeInitialize(address(factory), key, 1);
    }

    function testWrongSaltAndWrongChainFailClosed() public {
        PairPrediction memory pair = _predictPair(manager);
        bytes memory guardInitCode =
            abi.encodePacked(type(RMTV4InitializationGuard).creationCode, abi.encode(manager, pair.factory));
        uint256 wrongSalt = uint256(pair.salt) + 1;
        while (
            uint160(HookMiner.computeAddress(pair.deployment, wrongSalt, guardInitCode)) & Hooks.ALL_HOOK_MASK
                == Hooks.BEFORE_INITIALIZE_FLAG
        ) {
            ++wrongSalt;
        }
        vm.expectRevert(RMTV4InitializationGuard.InvalidGuardAddress.selector);
        new RMTV4LaunchDeploymentV2(
            manager,
            positionManager,
            permit2,
            address(manager).codehash,
            address(positionManager).codehash,
            address(permit2).codehash,
            bytes32(wrongSalt)
        );
        assertEq(pair.deployment.code.length, 0);
        assertEq(pair.factory.code.length, 0);
        assertEq(pair.guard.code.length, 0);

        vm.chainId(1);
        vm.expectRevert(RMTV4LaunchDeploymentV2.WrongChain.selector);
        new RMTV4LaunchDeploymentV2(manager, positionManager, permit2, bytes32(0), bytes32(0), bytes32(0), bytes32(0));
    }

    function testInvalidPolicyRollsBackAndDuplicateIntentCannotChangeIt() public {
        RMTV4LaunchFactoryV2 factory = _deployPair(manager, positionManager, permit2, _predictPair(manager));
        RMTV4LaunchFactoryV2.Terms memory terms = _terms();
        address predictedToken = _predictToken(address(factory), terms);
        PoolKey memory key = _pool(predictedToken, address(factory.initializationGuard()));
        RMTV4LongevityLedger.FeePolicy memory policy =
            RMTV4LongevityLedger.FeePolicy(stranger, stranger, 6_000, 3_000, 1_000);
        vm.expectRevert(RMTV4LongevityLedger.InvalidFeePolicy.selector);
        vm.prank(creator);
        factory.launchWithLongevity{value: terms.nativeAmount}(terms, policy);
        assertEq(predictedToken.code.length, 0);
        assertEq(factory.launches(creator, terms.intentId), address(0));
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertEq(price, 0);

        policy.reserve = makeAddr("guarded liquidity reserve");
        vm.prank(creator);
        address token = factory.launchWithLongevity{value: terms.nativeAmount}(terms, policy);
        policy.treasury = makeAddr("second project treasury");
        vm.expectRevert(RMTV4LaunchFactoryV2.DuplicateIntent.selector);
        vm.prank(creator);
        factory.launchWithLongevity{value: terms.nativeAmount}(terms, policy);
        (, address treasury, address reserve, uint16 creatorBps, uint16 treasuryBps, uint16 reserveBps) =
            factory.feePolicy(token);
        assertEq(treasury, stranger);
        assertEq(reserve, policy.reserve);
        assertEq(creatorBps, 6_000);
        assertEq(treasuryBps, 3_000);
        assertEq(reserveBps, 1_000);
    }

    function testCreatorAndPoolManagerAdminCannotMoveOrRemovePrincipal() public {
        RMTV4LaunchFactoryV2 factory = _deployPair(manager, positionManager, permit2, _predictPair(manager));
        RMTV4LaunchFactoryV2.Terms memory terms = _terms();
        vm.prank(creator);
        address token = factory.launch{value: terms.nativeAmount}(terms);
        (, uint256 positionId, uint128 liquidity) = factory.positions(token);
        IERC721 positionNFT = IERC721(address(positionManager));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(positionId, uint256(liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(address(0)), Currency.wrap(token), creator);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        vm.prank(creator);
        positionNFT.transferFrom(address(factory), creator, positionId);
        vm.expectRevert(abi.encodeWithSelector(IPositionManager.NotApproved.selector, creator));
        vm.prank(creator);
        positionManager.modifyLiquidities(abi.encode(actions, params), terms.deadline);
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        positionNFT.transferFrom(address(factory), address(this), positionId);
        vm.expectRevert(IERC721Permit_v4.Unauthorized.selector);
        positionNFT.approve(address(this), positionId);
        vm.expectRevert(abi.encodeWithSelector(IPositionManager.NotApproved.selector, address(this)));
        positionManager.modifyLiquidities(abi.encode(actions, params), terms.deadline);
        factory.collectFees(token, terms.deadline);
        assertEq(positionNFT.ownerOf(positionId), address(factory));
        assertEq(positionManager.getPositionLiquidity(positionId), liquidity);
    }

    function testFactoryRejectsChangedGuardRuntime() public {
        RMTV4LaunchFactoryV2 factory = _deployPair(manager, positionManager, permit2, _predictPair(manager));
        RMTV4LaunchFactoryV2.Terms memory terms = _terms();
        vm.etch(address(factory.initializationGuard()), hex"00");
        vm.expectRevert(RMTV4LaunchFactoryV2.RuntimeIdentityMismatch.selector);
        vm.prank(creator);
        factory.launch{value: terms.nativeAmount}(terms);
    }

    function testRejectsUnsolicitedNativePaymentAndUnknownFeeCollection() public {
        RMTV4LaunchFactoryV2 factory = _deployPair(manager, positionManager, permit2, _predictPair(manager));
        vm.prank(stranger);
        (bool paid, bytes memory reason) = address(factory).call{value: 1}("");
        assertFalse(paid);
        assertEq(reason, abi.encodeWithSelector(RMTV4LaunchFactoryV2.UnexpectedNativePayment.selector));
        assertEq(address(factory).balance, 0);
        vm.expectRevert(RMTV4LaunchFactoryV2.UnknownLaunch.selector);
        factory.collectFees(address(1), block.timestamp);
    }

    function _assertHostileInitializeReverts(PoolKey memory key, uint160 price) private {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(key.hooks),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(RMTV4InitializationGuard.UnexpectedInitializer.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        vm.prank(stranger);
        manager.initialize(key, price);
    }

    function _terms() private view returns (RMTV4LaunchFactoryV2.Terms memory) {
        return RMTV4LaunchFactoryV2.Terms(
            "Guarded Launch", "GUARDED", "", bytes32(uint256(1)), 0, 8_000, 1 ether, block.timestamp
        );
    }

    function _predictToken(address factory, RMTV4LaunchFactoryV2.Terms memory terms) private view returns (address) {
        return Create2.computeAddress(
            keccak256(abi.encode(creator, terms.intentId)),
            keccak256(
                abi.encodePacked(
                    type(RMTV4LaunchTokenV1).creationCode,
                    abi.encode(terms.name, terms.symbol, terms.projectURI, 1_000_000 ether)
                )
            ),
            factory
        );
    }
}
