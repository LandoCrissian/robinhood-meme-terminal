// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Task090GraduationProofTest} from "./Task090GraduationProof.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTV4CurveGraduationV1 as Graduation} from "../src/RMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1 as Guard} from "../src/RMTV4CurveInitializationGuardV1.sol";

/// @notice Local-only acceptance probes at the remaining admission/signature boundary.
/// @dev Inherits the six Task090 real-runtime regression cases unchanged. Both
///      source31337 and exact canonical4663 modes use synthetic accounts/storage.
contract Task091AdmissionAcceptanceTest is Task090GraduationProofTest {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function testCanonicalInitializationCannotBeFrontRunAndUnrelatedPoolCannotRedirectGraduation() external {
        (IERC20 token, Curve curve) = _task091Fund();
        PoolKey memory canonical = engine.canonicalPoolKey(address(token));
        vm.expectRevert();
        vm.prank(stranger);
        manager.initialize(canonical, uint160(1 << 96));
        (uint160 beforePrice,,,) = manager.getSlot0(canonical.toId());
        assertEq(beforePrice, 0, "failed front-run must leave canonical pool uninitialized");
        Guard guard = engine.initializationGuard();
        vm.expectRevert(Guard.UnapprovedInitialization.selector);
        vm.prank(stranger);
        guard.beforeInitialize(address(engine), canonical, uint160(1 << 96));

        // A public manager may contain hostile unrelated pools. Full PoolKey,
        // rather than a currency pair or price assertion, defines our pool.
        PoolKey memory other = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 3000, 60, IHooks(address(0)));
        vm.prank(stranger);
        manager.initialize(other, uint160(1 << 96));
        assertNotEq(PoolId.unwrap(canonical.toId()), PoolId.unwrap(other.toId()));
        curve.graduate(block.timestamp);
        assertEq(curve.poolId(), PoolId.unwrap(canonical.toId()));
        assertGt(manager.getLiquidity(canonical.toId()), 0);
        assertEq(manager.getLiquidity(other.toId()), 0);
        (uint160 afterOtherPrice,,,) = manager.getSlot0(other.toId());
        assertEq(afterOtherPrice, uint160(1 << 96));
        (uint256 id, uint128 liquidity) = engine.positions(address(token));
        assertEq(positions.ownerOf(id), address(engine));
        assertEq(positions.getPositionLiquidity(id), liquidity);
        assertEq(positions.getApproved(id), address(0));
    }

    function testValidEoaPermitDoesNotAuthorizeContractEngineOrSignatureTransfer() external {
        (IERC20 token, Curve curve) = _task091Fund();
        address signer = vm.addr(9);
        IAllowanceTransfer.PermitSingle memory request = IAllowanceTransfer.PermitSingle(
            IAllowanceTransfer.PermitDetails(address(token), 7, uint48(block.timestamp + 60), 0), stranger, block.timestamp + 60);
        bytes32 detailsHash = keccak256(abi.encode(
            keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"),
            request.details.token, request.details.amount, request.details.expiration, request.details.nonce));
        bytes32 structHash = keccak256(abi.encode(keccak256(
            "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"),
            detailsHash, request.spender, request.sigDeadline));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", permit.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(9, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        vm.prank(buyer); token.transfer(signer, 7);
        vm.prank(signer); token.approve(PERMIT2, 7);
        // Positive control reaches actual Permit2 EOA signature verification.
        permit.permit(signer, request, signature);
        vm.prank(stranger); permit.transferFrom(signer, stranger, 7, address(token));
        assertEq(token.balanceOf(stranger), 7);

        vm.prank(buyer); token.transfer(address(engine), 13);
        // Contract owners require ERC1271. The immutable engine has no such
        // selector/fallback, arbitrary execution or key-derived signature path.
        vm.expectRevert();
        permit.permit(address(engine), request, signature);
        (uint160 amount, uint48 expiration, uint48 nonce) = permit.allowance(address(engine), address(token), stranger);
        assertEq(amount, 0); assertEq(expiration, 0); assertEq(nonce, 0);
        ISignatureTransfer.PermitTransferFrom memory oneShot = ISignatureTransfer.PermitTransferFrom(
            ISignatureTransfer.TokenPermissions(address(token), 1), 0, block.timestamp + 60);
        ISignatureTransfer.SignatureTransferDetails memory transfer = ISignatureTransfer.SignatureTransferDetails(stranger, 1);
        vm.expectRevert();
        vm.prank(stranger);
        ISignatureTransfer(PERMIT2).permitTransferFrom(oneShot, transfer, address(engine), signature);
        assertEq(ISignatureTransfer(PERMIT2).nonceBitmap(address(engine), 0), 0, "failed signature use rolls nonce back");
        assertEq(token.balanceOf(address(engine)), 13);
        curve.graduate(block.timestamp);
        assertEq(token.balanceOf(address(engine)), 13, "unrelated engine balance is preserved");
        assertEq(token.allowance(address(engine), PERMIT2), 0);
        (amount,,) = permit.allowance(address(engine), address(token), address(positions));
        assertEq(amount, 0);
    }

    function testUnadmittedCallerCannotFundOrAttachAnotherTokenToEngine() external {
        (IERC20 token, Curve curve) = _task091Fund();
        uint256 supply = token.totalSupply();
        uint256 backing = curve.GRADUATION_BACKING();
        uint256 virtualNative = curve.VIRTUAL_ETH();
        vm.expectRevert(Graduation.UnauthorizedCurve.selector);
        vm.prank(stranger);
        engine.graduate(address(token), backing, 400_000_000 ether,
            1_200_000_000 ether, virtualNative + backing, block.timestamp);
        assertEq(token.totalSupply(), supply);
        assertFalse(curve.graduated());
        assertEq(address(engine.lpFeeLedger(address(token))), address(0));
        curve.graduate(block.timestamp);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
    }

    function testOriginalNftSignatureAndSubscriptionPathsCannotAcquireEngineAuthority() external {
        (IERC20 token, Curve curve) = _task091Fund();
        curve.graduate(block.timestamp);
        (uint256 id, uint128 liquidity) = engine.positions(address(token));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(9, bytes32(uint256(91)));
        bytes memory signature = abi.encodePacked(r, s, v);
        // ERC721Permit_v4 verifies a contract owner through ERC1271 as well.
        // A valid unrelated synthetic key never delegates our engine's NFT.
        vm.expectRevert();
        positions.permit(stranger, id, block.timestamp + 60, 0, signature);
        vm.expectRevert();
        positions.permitForAll(address(engine), stranger, true, block.timestamp + 60, 0, signature);
        vm.expectRevert();
        vm.prank(stranger);
        positions.subscribe(id, stranger, "");
        assertEq(positions.ownerOf(id), address(engine));
        assertEq(positions.getApproved(id), address(0));
        assertFalse(positions.isApprovedForAll(address(engine), stranger));
        assertEq(address(positions.subscriber(id)), address(0));
        assertEq(positions.getPositionLiquidity(id), liquidity);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
    }

    function _task091Fund() private returns (IERC20 token, Curve curve) {
        uint256 fee = factory.creationFeeWei();
        vm.prank(creator);
        (address asset, address market) = factory.create{value: fee}(
            "Task091 synthetic admission", "T091", "", address(0), 0, bytes32(uint256(91001)), block.timestamp);
        token = IERC20(asset);
        curve = Curve(payable(market));
        uint256 budget = curve.GRADUATION_BACKING() * 2;
        uint256 terminal = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: budget}(terminal, block.timestamp);
    }
}
