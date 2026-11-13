// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveTokenV1 as Token} from "../src/RMTLaunchCurveTokenV1.sol";
import {RMTLaunchCurveRevenueLedgerV1 as RevenueLedger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {RMTLaunchCurveLpFeeLedgerV1 as LpLedger} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {IRMTV4CurveGraduationV1} from "../src/interfaces/IRMTV4CurveGraduationV1.sol";

/// @dev Fixture for one controlled discrepancy between the reported and transferred native dust.
contract SymbolicGraduationRefund is IRMTV4CurveGraduationV1 {
    address public immutable factory = msg.sender;
    uint256 public refund;

    function setRefund(uint256 amount) external {
        refund = amount;
    }

    function graduate(address token, uint256 nativeReserve, uint256 tokenReserve, uint256, uint256, uint256)
        external
        payable
        returns (bytes32, uint256, uint256, uint256)
    {
        assert(IERC20(token).transferFrom(msg.sender, address(this), tokenReserve));
        if (refund != 0) {
            (bool returned,) = msg.sender.call{value: refund}("");
            assert(returned);
        }
        return (bytes32(uint256(1)), 1, nativeReserve - 2, tokenReserve);
    }
}

/// @notice Optional Halmos checks. The funding fixture isolates the curve, without mocking its deployed-code behavior.
contract RMTLaunchCurveSymbolic is Test {
    address private constant CREATOR = address(0x1001);
    address private constant OPERATING = address(0x1002);
    address private constant FUTURE = address(0x1003);
    uint256 private constant SUPPLY = 1_000_000 ether;
    uint256 private constant THRESHOLD_BUY = 1_010_101_010_101_010_102;

    Token private token;
    Curve private curve;
    LpLedger private lpLedger;
    SymbolicGraduationRefund private engine;

    receive() external payable {}

    function setUp() public {
        token = new Token("Symbolic", "SYM", SUPPLY);
        engine = new SymbolicGraduationRefund();
        curve = new Curve(
            IERC20(address(token)),
            CREATOR,
            address(0),
            0,
            OPERATING,
            FUTURE,
            engine,
            address(0),
            address(this),
            address(0),
            RevenueLedger(address(0))
        );
        assert(token.transfer(address(curve), SUPPLY));
        vm.deal(address(this), 2 ether);
        curve.buy{value: THRESHOLD_BUY}(1, block.timestamp);
        assert(curve.backingReserve() == 1 ether && curve.sold() == curve.graduationSold());

        lpLedger = new LpLedger(
            IERC20(address(token)), address(engine), LpLedger.Policy(CREATOR, address(0), 0, OPERATING, FUTURE)
        );
        assert(token.transfer(address(lpLedger), 110));
        vm.deal(address(lpLedger), 110);
        lpLedger.record(100, 100);
    }

    function check_ForeignCallerCannotMoveCurveAssets(address caller, address destination, bytes32 runtimeHash)
        external
    {
        vm.assume(caller != address(this));
        uint256 backing = curve.backingReserve();
        uint256 inventory = token.balanceOf(address(curve));
        vm.prank(caller);
        (bool success, bytes memory failure) =
            address(curve).call(abi.encodeCall(Curve.migrateAssets, (payable(destination), runtimeHash)));
        assert(!success && bytes4(failure) == Curve.UnauthorizedMigration.selector);
        assert(curve.active() && curve.backingReserve() == backing && address(curve).balance == backing);
        assert(token.balanceOf(address(curve)) == inventory);
        assert(curve.revenueLedger().activeCurve() == address(curve));
    }

    function check_GraduationRequiresMatchingNativeRefund(uint256 refund) external {
        vm.assume(refund <= 3);
        engine.setRefund(refund);
        uint256 inventory = token.balanceOf(address(curve));
        address writer = curve.revenueLedger().activeCurve();
        (bool success, bytes memory failure) = address(curve).call(abi.encodeCall(Curve.graduate, (block.timestamp)));
        if (refund == 2) {
            assert(success && curve.graduated() && curve.nativeDust() == 2);
            assert(curve.backingReserve() == 0 && address(curve).balance == 2);
            assert(token.balanceOf(address(engine)) == inventory && token.balanceOf(address(curve)) == 0);
        } else {
            assert(!success && bytes4(failure) == Curve.InvalidGraduationSettlement.selector);
            assert(curve.active() && !curve.graduated() && curve.backingReserve() == 1 ether);
            assert(address(curve).balance == 1 ether && token.balanceOf(address(curve)) == inventory);
            assert(address(engine).balance == 0 && token.balanceOf(address(engine)) == 0);
        }
        assert(token.allowance(address(curve), address(engine)) == 0);
        assert(curve.revenueLedger().activeCurve() == writer);
    }

    function check_ForeignCallerCannotCreditOrTakeLpFees(address caller, uint256 nativeAmount, uint256 tokenAmount)
        external
    {
        vm.assume(caller != address(this) && caller != CREATOR && caller != OPERATING && caller != FUTURE);
        vm.prank(caller);
        (bool credited, bytes memory creditFailure) =
            address(lpLedger).call(abi.encodeCall(LpLedger.record, (nativeAmount, tokenAmount)));
        assert(!credited && bytes4(creditFailure) == LpLedger.Unauthorized.selector);
        vm.prank(caller);
        (bool claimed, bytes memory claimFailure) = address(lpLedger).call(abi.encodeCall(LpLedger.claim, ()));
        assert(!claimed && bytes4(claimFailure) == LpLedger.NothingToClaim.selector);
        (uint256 nativeCredit, uint256 tokenCredit) = lpLedger.claimable(CREATOR);
        assert(nativeCredit == 90 && tokenCredit == 90);
        assert(address(lpLedger).balance == 110 && token.balanceOf(address(lpLedger)) == 110);
    }
}
