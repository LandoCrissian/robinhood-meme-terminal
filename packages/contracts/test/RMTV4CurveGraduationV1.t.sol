// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RMTLaunchBondingCurveV1} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveFactoryV1} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchCurveDeploymentV1} from "../src/RMTLaunchCurveDeploymentV1.sol";
import {ICurvePermit2V1, ICurvePositionManagerV1, RMTV4CurveGraduationV1} from "../src/RMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1} from "../src/RMTV4CurveInitializationGuardV1.sol";

/// @dev Models Permit2 allowance spending and a failure within funding, after v4 initialization.
contract CurvePermit2Fixture {
    mapping(address => mapping(address => mapping(address => uint160))) public amount;
    bool public settlementFails;

    error FundingInterrupted();

    function setFailure(bool fails) external {
        settlementFails = fails;
    }

    function approve(address token, address spender, uint160 grant, uint48) external {
        amount[msg.sender][token][spender] = grant;
    }

    function transferFrom(address from, address to, uint160 spend, address token) external {
        amount[from][token][msg.sender] -= spend;
        require(IERC20(token).transferFrom(from, to, spend));
        if (settlementFails) revert FundingInterrupted();
    }
}

contract RMTV4CurveGraduationV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager private manager;
    PositionManager private positions;
    CurvePermit2Fixture private permit;
    RMTLaunchCurveFactoryV1 private factory;
    RMTV4CurveGraduationV1 private graduation;
    address private creator = makeAddr("creator");
    address private buyer = makeAddr("buyer");
    address private stranger = makeAddr("stranger");

    function setUp() public {
        vm.chainId(31337);
        manager = new PoolManager(address(this));
        permit = new CurvePermit2Fixture();
        positions = new PositionManager(
            manager, IAllowanceTransfer(address(permit)), 10_000, IPositionDescriptor(address(0)), IWETH9(address(0))
        );
        RMTV4CurveGraduationV1.Dependencies memory dependencies = RMTV4CurveGraduationV1.Dependencies(
            manager,
            ICurvePositionManagerV1(address(positions)),
            ICurvePermit2V1(address(permit)),
            address(manager).codehash,
            address(positions).codehash,
            address(permit).codehash
        );
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address engine = vm.computeCreateAddress(predicted, 2);
        (address expectedGuard, bytes32 salt) = HookMiner.find(
            predicted,
            Hooks.BEFORE_INITIALIZE_FLAG,
            type(RMTV4CurveInitializationGuardV1).creationCode,
            abi.encode(manager, engine)
        );
        RMTLaunchCurveDeploymentV1 deployment =
            new RMTLaunchCurveDeploymentV1(dependencies, salt, makeAddr("operating"), makeAddr("reserve"), address(0));
        graduation = deployment.graduationEngine();
        factory = deployment.factory();
        assertEq(address(graduation), engine);
        assertEq(address(graduation.factory()), address(factory));
        assertEq(address(graduation.initializationGuard()), expectedGuard);
        assertEq(address(factory.graduationEngine()), engine);
        vm.deal(buyer, 10 ether);
    }

    function testFundingUsesCurveSpotAndRealCapitalAcrossPresets() public view {
        uint256[3] memory supply = [uint256(1_000_000 ether), 10_000_000 ether, 100_000_000 ether];
        for (uint256 i; i < supply.length; ++i) {
            uint256 tokenReserve = supply[i] * 2 / 5;
            uint256 numerator = supply[i] * 6 / 5;
            uint256 denominator = 3 ether;
            RMTV4CurveGraduationV1.Funding memory funding =
                graduation.previewFunding(1 ether, tokenReserve, numerator, denominator);
            uint256 q192Price = Math.mulDiv(numerator, 1 << 192, denominator);
            uint256 root = uint256(funding.sqrtPriceX96);
            assertLe(root * root, q192Price);
            assertGt((root + 1) * (root + 1), q192Price);
            assertGt(funding.liquidity, 0);
            assertLe(1 ether - funding.nativeUsed, 100_000);
            assertLe(tokenReserve - funding.tokenUsed, 100_000);
        }
    }

    function testUnbalancedOrUnfundedMigrationRejected() public {
        vm.expectRevert(RMTV4CurveGraduationV1.InvalidFunding.selector);
        graduation.previewFunding(0, 100 ether, 100 ether, 1 ether);
        vm.expectRevert(RMTV4CurveGraduationV1.InvalidFunding.selector);
        graduation.previewFunding(1 ether, 200 ether, 100 ether, 1 ether);
    }

    function testGuardBlocksFrontRunAndOnlyRegisteredCurveCanFund() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        PoolKey memory key = graduation.canonicalPoolKey(token);
        vm.expectRevert();
        vm.prank(stranger);
        manager.initialize(key, uint160(1 << 96));

        PoolKey memory otherKey = PoolKey(key.currency0, key.currency1, key.fee, key.tickSpacing, IHooks(address(0)));
        vm.prank(stranger);
        manager.initialize(otherKey, uint160(1 << 96));
        (uint160 unopenedPrice,,,) = manager.getSlot0(key.toId());
        assertEq(unopenedPrice, 0);
        assertNotEq(PoolId.unwrap(otherKey.toId()), PoolId.unwrap(key.toId()));

        vm.expectRevert(RMTV4CurveGraduationV1.UnauthorizedCurve.selector);
        vm.prank(stranger);
        graduation.graduate(token, 0, 0, 0, 0, block.timestamp);
        assertFalse(curve.graduated());
    }

    function testFundingRollbackKeepsCurveBackingAndRetriableGraduation() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        uint256 deadline = block.timestamp + 1 minutes;
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, deadline);
        uint256 inventory = IERC20(token).balanceOf(address(curve));
        uint256 backing = curve.backingReserve();
        uint256 nextId = positions.nextTokenId();
        PoolKey memory key = graduation.canonicalPoolKey(token);
        permit.setFailure(true);

        vm.expectRevert(CurvePermit2Fixture.FundingInterrupted.selector);
        vm.prank(stranger);
        curve.graduate(deadline);
        (uint160 unopenedPrice,,,) = manager.getSlot0(key.toId());
        assertEq(unopenedPrice, 0);
        assertEq(positions.nextTokenId(), nextId);
        assertEq(curve.backingReserve(), backing);
        assertEq(address(curve).balance, backing);
        assertEq(IERC20(token).balanceOf(address(curve)), inventory);
        assertEq(IERC20(token).allowance(address(curve), address(graduation)), 0);
        assertFalse(curve.graduated());

        permit.setFailure(false);
        vm.prank(stranger);
        curve.graduate(deadline);
        assertTrue(curve.graduated());
        assertEq(curve.poolId(), PoolId.unwrap(key.toId()));
        assertEq(curve.positionTokenId(), nextId);
        assertEq(positions.ownerOf(nextId), address(graduation));
        (, uint128 liquidity) = graduation.positions(token);
        assertGt(liquidity, 0);
        assertEq(positions.getPositionLiquidity(nextId), liquidity);
        assertEq(IERC20(token).allowance(address(curve), address(graduation)), 0);
        assertEq(IERC20(token).allowance(address(graduation), address(permit)), 0);
        assertEq(permit.amount(address(graduation), token, address(positions)), 0);
        assertEq(address(manager).balance + address(curve).balance, backing);
        assertEq(IERC20(token).balanceOf(address(manager)) + IERC20(token).balanceOf(address(curve)), inventory);
        assertEq(IERC20(token).totalSupply(), 1_000_000 ether);

        vm.expectRevert();
        vm.prank(creator);
        IERC721(address(positions)).transferFrom(address(graduation), creator, nextId);
        vm.expectRevert();
        vm.prank(creator);
        IERC721(address(positions)).approve(creator, nextId);
        vm.expectRevert();
        vm.prank(creator);
        curve.graduate(deadline);
        assertEq(positions.ownerOf(nextId), address(graduation));
        assertEq(positions.getPositionLiquidity(nextId), liquidity);
    }

    function _create() private returns (address token, RMTLaunchBondingCurveV1 curve) {
        vm.prank(creator);
        address curveAddress;
        (token, curveAddress) =
            factory.create("Graduation Test", "GRAD", "", 0, address(0), 0, bytes32(uint256(1)), block.timestamp);
        curve = RMTLaunchBondingCurveV1(payable(curveAddress));
    }
}
