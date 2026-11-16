// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveDeploymentV2} from "../src/RMTLaunchCurveDeploymentV2.sol";
import {RMTLaunchCurveFactoryV2 as Factory} from "../src/RMTLaunchCurveFactoryV2.sol";
import {RMTLaunchCurveLpFeeLedgerV1} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {ICurvePermit2V1, ICurvePositionManagerV1, RMTV4CurveGraduationV1} from "../src/RMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1} from "../src/RMTV4CurveInitializationGuardV1.sol";
import {CurvePermit2Fixture} from "./RMTV4CurveGraduationV1.t.sol";

/// @dev Models an independent PoolManager caller while the shared unlock is active.
contract SharedPoolUnlockProbe is IUnlockCallback {
    IPoolManager private immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function tryNested(address target, bytes memory data) external returns (bytes4) {
        return abi.decode(manager.unlock(abi.encode(target, data)), (bytes4));
    }

    function unlockCallback(bytes calldata request) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (address target, bytes memory data) = abi.decode(request, (address, bytes));
        (bool success, bytes memory result) = target.call(data);
        require(!success, "nested settlement unexpectedly succeeded");
        return abi.encode(bytes4(result));
    }
}

contract RMTV4SharedPoolSettlementTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager private manager;
    PositionManager private positions;
    RMTV4CurveGraduationV1 private graduation;
    Factory private factory;
    SharedPoolUnlockProbe private probe;
    address private buyer = makeAddr("shared-pool buyer");

    function setUp() external {
        vm.chainId(31337);
        manager = new PoolManager(address(this));
        CurvePermit2Fixture permit = new CurvePermit2Fixture();
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
        RMTLaunchCurveSuccessorDeployerV1 successor = new RMTLaunchCurveSuccessorDeployerV1();
        address deploymentAddress = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        (, bytes32 guardSalt) = HookMiner.find(
            deploymentAddress,
            Hooks.BEFORE_INITIALIZE_FLAG,
            type(RMTV4CurveInitializationGuardV1).creationCode,
            abi.encode(manager, vm.computeCreateAddress(deploymentAddress, 2))
        );
        RMTLaunchCurveDeploymentV2 deployment = new RMTLaunchCurveDeploymentV2(
            dependencies,
            guardSalt,
            address(0x51),
            address(0x52),
            address(0),
            address(successor),
            address(successor).codehash,
            0
        );
        graduation = deployment.graduationEngine();
        factory = deployment.factory();
        probe = new SharedPoolUnlockProbe(manager);
        vm.deal(buyer, 10 ether);
    }

    function testSharedUnlockRejectsNestedGraduationAndPrefundedBalancesAreExcluded() external {
        (IERC20 first, Curve firstCurve) = _reachGraduation("FIRST");
        firstCurve.graduate(block.timestamp);
        uint256 firstPoolTokens = first.balanceOf(address(manager));

        (IERC20 second, Curve secondCurve) = _reachGraduation("SECOND");
        uint256 priorNative = address(manager).balance;
        assertGt(priorNative, 0);
        uint256 donatedTokens = 10_000 ether;
        vm.prank(buyer);
        assertTrue(second.transfer(address(manager), donatedTokens));
        assertEq(second.balanceOf(address(manager)), donatedTokens);

        uint256 backing = secondCurve.backingReserve();
        uint256 inventory = second.balanceOf(address(secondCurve));
        uint256 nextId = positions.nextTokenId();
        PoolKey memory pool = graduation.canonicalPoolKey(address(second));
        manager.sync(Currency.wrap(address(second)));
        assertEq(
            probe.tryNested(address(secondCurve), abi.encodeCall(Curve.graduate, (block.timestamp))),
            IPoolManager.AlreadyUnlocked.selector
        );
        (uint160 absentPrice,,,) = manager.getSlot0(pool.toId());
        assertEq(absentPrice, 0);
        assertEq(positions.nextTokenId(), nextId);
        assertFalse(secondCurve.graduated());
        assertEq(secondCurve.backingReserve(), backing);
        assertEq(address(secondCurve).balance, backing);
        assertEq(second.balanceOf(address(secondCurve)), inventory);
        assertEq(second.allowance(address(secondCurve), address(graduation)), 0);
        assertEq(address(manager).balance, priorNative);
        assertEq(second.balanceOf(address(manager)), donatedTokens);

        secondCurve.graduate(block.timestamp);
        assertEq(address(manager).balance, priorNative + backing - secondCurve.nativeDust());
        assertEq(second.balanceOf(address(manager)), donatedTokens + inventory - secondCurve.tokenDust());
        assertEq(first.balanceOf(address(manager)), firstPoolTokens);
        assertEq(positions.ownerOf(nextId), address(graduation));
        assertGt(positions.getPositionLiquidity(nextId), 0);
    }

    function testSharedUnlockCannotHarvestOrAlterOriginalPosition() external {
        (IERC20 asset, Curve curve) = _reachGraduation("HARVEST");
        curve.graduate(block.timestamp);
        (IERC20 other, Curve otherCurve) = _reachGraduation("UNRELATED");
        otherCurve.graduate(block.timestamp);
        uint256 otherTokens = other.balanceOf(address(manager));

        _swapBothWays(asset);
        address token = address(asset);
        (uint256 nativeFee, uint256 tokenFee) = graduation.previewLpFees(token);
        assertGt(nativeFee, 0);
        assertGt(tokenFee, 0);
        (uint256 id, uint128 principal) = graduation.positions(token);
        RMTLaunchCurveLpFeeLedgerV1 ledger = graduation.lpFeeLedger(token);
        uint256 priorNative = address(manager).balance;
        uint256 priorTokens = asset.balanceOf(address(manager));

        assertEq(
            probe.tryNested(
                address(graduation), abi.encodeCall(RMTV4CurveGraduationV1.collectLpFees, (token, block.timestamp))
            ),
            IPoolManager.AlreadyUnlocked.selector
        );
        (uint256 pendingNative, uint256 pendingToken) = graduation.previewLpFees(token);
        assertEq(pendingNative, nativeFee);
        assertEq(pendingToken, tokenFee);
        assertEq(address(ledger).balance, 0);
        assertEq(asset.balanceOf(address(ledger)), 0);
        assertEq(address(manager).balance, priorNative);
        assertEq(asset.balanceOf(address(manager)), priorTokens);

        (uint256 paidNative, uint256 paidToken) = graduation.collectLpFees(token, block.timestamp);
        assertEq(paidNative, nativeFee);
        assertEq(paidToken, tokenFee);
        assertEq(address(ledger).balance, nativeFee);
        assertEq(asset.balanceOf(address(ledger)), tokenFee);
        assertEq(address(manager).balance, priorNative - nativeFee);
        assertEq(asset.balanceOf(address(manager)), priorTokens - tokenFee);
        assertEq(other.balanceOf(address(manager)), otherTokens);
        assertEq(positions.ownerOf(id), address(graduation));
        assertEq(positions.getPositionLiquidity(id), principal);
    }

    function _reachGraduation(string memory label) private returns (IERC20 asset, Curve curve) {
        (address token, address market) =
            factory.create(label, label, "", address(0), 0, keccak256(bytes(label)), block.timestamp);
        asset = IERC20(token);
        curve = Curve(payable(market));
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, block.timestamp);
    }

    function _swapBothWays(IERC20 asset) private {
        PoolSwapTest swapper = new PoolSwapTest(manager);
        PoolKey memory pool = graduation.canonicalPoolKey(address(asset));
        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings(false, false);
        vm.startPrank(buyer);
        swapper.swap{value: 0.03 ether}(pool, SwapParams(true, -0.03 ether, TickMath.MIN_SQRT_PRICE + 1), settings, "");
        assertTrue(asset.approve(address(swapper), 1_000_000 ether));
        swapper.swap(pool, SwapParams(false, -1_000_000 ether, TickMath.MAX_SQRT_PRICE - 1), settings, "");
        vm.stopPrank();
    }
}
