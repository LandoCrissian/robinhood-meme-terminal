// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTLaunchBondingCurveV1} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveFactoryV1} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchCurveRevenueLedgerV1} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {IRMTV4CurveGraduationV1} from "../src/interfaces/IRMTV4CurveGraduationV1.sol";

contract CurveGraduationProbe is IRMTV4CurveGraduationV1 {
    address public immutable factory;
    uint8 public behavior;
    bytes32 public constant EXPECTED_POOL = keccak256("test pool");

    constructor(address factory_) {
        factory = factory_;
    }

    function setBehavior(uint8 behavior_) external {
        behavior = behavior_;
    }

    function graduate(
        address token,
        uint256 nativeReserve,
        uint256 tokenReserve,
        uint256 priceNumerator,
        uint256 priceDenominator,
        uint256 deadline
    ) external payable returns (bytes32, uint256, uint256, uint256) {
        require(block.timestamp <= deadline && msg.value == nativeReserve && nativeReserve == 1 ether);
        require(priceNumerator == tokenReserve * 3 && priceDenominator == nativeReserve * 3);
        require(RMTLaunchCurveFactoryV1(factory).curveForToken(token) == msg.sender);
        (bool entered, bytes memory failure) =
            msg.sender.call(abi.encodeCall(RMTLaunchBondingCurveV1.graduate, (deadline)));
        require(!entered && bytes4(failure) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        require(IERC20(token).transferFrom(msg.sender, address(this), tokenReserve - 2));
        (bool refunded,) = msg.sender.call{value: 1}("");
        require(refunded);
        if (behavior == 1) revert("interrupted funding");
        return (EXPECTED_POOL, 1, nativeReserve - behavior - 1, tokenReserve - 2);
    }
}

contract CurvePaymentProbe {
    RMTLaunchBondingCurveV1 private curve;
    RMTLaunchCurveRevenueLedgerV1 private ledger;
    bool public rejectPayment;
    bool private claiming;
    uint256 public reentryFailures;
    bool public sawFinalizedGraduation;

    function setTargets(RMTLaunchBondingCurveV1 curve_) external {
        curve = curve_;
        ledger = curve_.revenueLedger();
    }

    function setRejectPayment(bool reject_) external {
        rejectPayment = reject_;
    }

    function claim() external {
        claiming = true;
        ledger.claim();
        claiming = false;
    }

    receive() external payable {
        require(!rejectPayment, "test payment rejection");
        if (!claiming && curve.graduated()) {
            require(curve.backingReserve() == 0 && curve.poolId() != bytes32(0) && curve.positionTokenId() != 0);
            sawFinalizedGraduation = true;
        }
        (bool entered, bytes memory failure) = claiming
            ? address(ledger).call(abi.encodeCall(ledger.claim, ()))
            : address(curve).call(abi.encodeCall(curve.buy, (1, block.timestamp)));
        require(!entered && bytes4(failure) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        ++reentryFailures;
    }
}

contract CurveRegistryProbe {
    mapping(address token => address curve) public registered;

    function register(address token, address curve) external {
        registered[token] = curve;
    }

    function migrationTemplate(address factory, uint32 version) external view returns (address deployer, bytes32 hash) {
        if (version == 1) {
            deployer = address(RMTLaunchCurveFactoryV1(factory).successorDeployer());
            hash = deployer.codehash;
        }
    }

    function migrate(RMTLaunchCurveFactoryV1 factory, address token, address successor, bytes32 codeHash) external {
        factory.executeMigration(token, successor, codeHash);
    }
}

contract RMTLaunchBondingCurveV1Test is Test {
    address private constant CREATOR = address(0x101);
    address private constant TREASURY = address(0x102);
    address private constant OPERATING = address(0x103);
    address private constant FUTURE = address(0x104);
    address private constant ALICE = address(0x105);
    address private constant BOB = address(0x106);
    uint256 private constant FILL = 1_010_101_010_101_010_102;

    RMTLaunchCurveFactoryV1 private factory;
    RMTLaunchBondingCurveV1 private curve;
    RMTLaunchCurveRevenueLedgerV1 private ledger;
    IERC20 private token;
    CurveGraduationProbe private graduation;
    CurveRegistryProbe private registry;

    function setUp() external {
        vm.chainId(31_337);
        registry = new CurveRegistryProbe();
        address successorDeployer = address(new RMTLaunchCurveSuccessorDeployerV1());
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        graduation = new CurveGraduationProbe(predicted);
        factory = new RMTLaunchCurveFactoryV1(
            address(graduation), OPERATING, FUTURE, address(registry), successorDeployer, successorDeployer.codehash, 0
        );
        (token, curve) = _create(CREATOR, TREASURY, 2_500, 0, bytes32(uint256(1)));
        ledger = curve.revenueLedger();
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
    }

    function testGasOnlyCreatesFixedSupplyAndIsolatesSameIntentAcrossCreators() external {
        assertEq(address(factory).balance, 0);
        assertEq(address(curve).balance, 0);
        assertEq(address(ledger).balance, 0);
        assertEq(curve.backingReserve(), 0);
        assertEq(token.totalSupply(), 1_000_000 ether);
        assertEq(token.balanceOf(address(curve)), token.totalSupply());
        assertEq(token.balanceOf(CREATOR), 0);
        assertEq(factory.engineVersion(), 1);
        assertEq(factory.curveForToken(address(token)), address(curve));
        assertEq(factory.tokenForIntent(CREATOR, bytes32(uint256(1))), address(token));
        vm.prank(CREATOR);
        vm.expectRevert(RMTLaunchCurveFactoryV1.DuplicateIntent.selector);
        factory.create("Another", "RMT", "", 0, address(0), 0, bytes32(uint256(1)), block.timestamp);
        (IERC20 other, RMTLaunchBondingCurveV1 otherCurve) = _create(ALICE, address(0), 0, 2, bytes32(uint256(1)));
        assertTrue(address(other) != address(token));
        assertEq(other.totalSupply(), 100_000_000 ether);
        assertEq(other.balanceOf(address(otherCurve)), other.totalSupply());
        vm.prank(CREATOR);
        (bool minted,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", CREATOR, 1));
        assertFalse(minted);
    }

    function testInvalidCreationPolicyAndUnsolicitedNativeValueCannotPublishAToken() external {
        bytes32 intent = bytes32(uint256(2));
        vm.startPrank(CREATOR);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidLaunch.selector);
        factory.create("Token", "TEST", "", 0, address(0), 1, intent, block.timestamp);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidLaunch.selector);
        factory.create("Token", "TEST", "", 0, CREATOR, 9_000, intent, block.timestamp);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidLaunch.selector);
        factory.create("Token", "TEST", "", 0, TREASURY, 9_001, intent, block.timestamp);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidLaunch.selector);
        factory.create("Token", "TEST", "", 3, address(0), 0, intent, block.timestamp);
        vm.deal(CREATOR, 1);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidLaunch.selector);
        factory.create{value: 1}("Token", "TEST", "", 3, address(0), 0, intent, block.timestamp);
        (bool accepted,) = address(factory).call{value: 1}("");
        vm.stopPrank();
        assertFalse(accepted);
        assertEq(factory.tokenForIntent(CREATOR, intent), address(0));
        assertEq(address(factory).balance, 0);
        assertEq(factory.creationFeesAccrued(), 0);
    }

    function testBuySellRoundTripReturnsBackingAndSeparatesAllFeeClaims() external {
        uint256 initialBalance = ALICE.balance;
        uint256 bought = _buy(ALICE, 0.4 ether);
        (uint256 payout, uint256 released, uint256 sellFee) = curve.quoteSell(bought);
        assertEq(curve.backingReserve(), released);
        assertEq(address(curve).balance, released);
        assertEq(payout + sellFee, released);
        assertEq(_sell(ALICE, bought, payout), payout);
        uint256 fees = ledger.totalAccrued();
        assertEq(ALICE.balance, initialBalance - fees);
        assertEq(curve.backingReserve(), 0);
        assertEq(address(curve).balance, 0);
        assertEq(curve.sold(), 0);
        assertEq(token.balanceOf(address(curve)), token.totalSupply());
        assertEq(address(ledger).balance, fees);
        assertEq(
            ledger.bucketAccrued(0) + ledger.bucketAccrued(1) + ledger.bucketAccrued(2) + ledger.bucketAccrued(3), fees
        );
        assertEq(ledger.bucketAccrued(2) + ledger.bucketAccrued(3), fees / 10);
        _claim(CREATOR);
        _claim(TREASURY);
        _claim(OPERATING);
        _claim(FUTURE);
        assertEq(ledger.totalClaimed(), fees);
        assertEq(address(ledger).balance, 0);
        vm.prank(CREATOR);
        vm.expectRevert(RMTLaunchCurveRevenueLedgerV1.NothingToClaim.selector);
        ledger.claim();
    }

    function testFuzzQuotesRoundingAndSolvencyAcrossAllSupplySizes(uint8 preset, uint96 raw, uint96 portion) external {
        preset = uint8(bound(preset, 0, 2));
        (token, curve) = _create(CREATOR, address(0), 0, preset, bytes32(uint256(2)));
        uint256 budget = bound(raw, 3, 3 ether);
        uint256 tokensOut = _buy(ALICE, budget);
        uint256 soldBefore = curve.sold();
        uint256 backing = curve.backingReserve();
        assertEq(tokensOut, soldBefore);
        assertLe(tokensOut, curve.graduationSold());
        assertEq(backing, address(curve).balance);
        assertEq(token.balanceOf(ALICE) + token.balanceOf(address(curve)), token.totalSupply());
        assertGt(tokensOut, 0);
        uint256 part = bound(portion, 1, tokensOut);
        (uint256 nativeOut, uint256 released,) = curve.quoteSell(part);
        if (nativeOut == 0) return;
        assertLe(released, backing);
        _sell(ALICE, part, nativeOut);
        assertEq(curve.sold(), soldBefore - part);
        assertEq(curve.backingReserve(), backing - released);
        assertEq(curve.backingReserve(), address(curve).balance);
        assertEq(token.balanceOf(ALICE) + token.balanceOf(address(curve)), token.totalSupply());
    }

    function testFrontRunningAffectsQuoteAndFailedTradeLeavesAccountingUnchanged() external {
        (uint256 stale,,,) = curve.quoteBuy(0.3 ether);
        _buy(BOB, 0.3 ether);
        uint256 soldBefore = curve.sold();
        uint256 backing = curve.backingReserve();
        uint256 fees = ledger.totalAccrued();
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.SlippageExceeded.selector);
        curve.buy{value: 0.3 ether}(stale, block.timestamp);
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.SlippageExceeded.selector);
        curve.sell(soldBefore + 1, 1, block.timestamp);
        vm.prank(ALICE);
        vm.expectRevert();
        curve.sell(soldBefore, 1, block.timestamp);
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.InvalidTrade.selector);
        curve.buy{value: 1 ether}(0, block.timestamp);
        assertEq(curve.sold(), soldBefore);
        assertEq(curve.backingReserve(), backing);
        assertEq(ledger.totalAccrued(), fees);
        assertEq(token.balanceOf(ALICE), 0);
    }

    function testExpiredOperationsAndPrematureGraduationFail() external {
        vm.warp(100);
        vm.prank(CREATOR);
        vm.expectRevert(RMTLaunchCurveFactoryV1.DeadlineExpired.selector);
        factory.create("Token", "TEST", "", 0, address(0), 0, bytes32(uint256(2)), block.timestamp - 1);
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.DeadlineExpired.selector);
        curve.buy{value: 1 ether}(1, block.timestamp - 1);
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.DeadlineExpired.selector);
        curve.sell(1, 1, block.timestamp - 1);
        vm.expectRevert(RMTLaunchBondingCurveV1.GraduationNotReady.selector);
        curve.graduate(block.timestamp);
    }

    function testOverfillRefundAndPermissionlessGraduationWithAtomicRetries() external {
        uint256 initialBalance = ALICE.balance;
        uint256 bought = _buy(ALICE, 5 ether);
        assertEq(ALICE.balance, initialBalance - FILL);
        assertEq(bought, curve.graduationSold());
        assertEq(address(curve).balance, 1 ether);
        assertEq(curve.backingReserve(), 1 ether);
        assertEq(address(ledger).balance, FILL - 1 ether);
        uint256 held = token.balanceOf(address(curve));
        graduation.setBehavior(1);
        vm.prank(BOB);
        vm.expectRevert(bytes("interrupted funding"));
        curve.graduate(block.timestamp);
        graduation.setBehavior(2);
        vm.prank(BOB);
        vm.expectRevert(RMTLaunchBondingCurveV1.InvalidGraduationSettlement.selector);
        curve.graduate(block.timestamp);
        assertEq(token.balanceOf(address(curve)), held);
        assertEq(token.balanceOf(address(graduation)), 0);
        assertEq(address(graduation).balance, 0);
        assertEq(token.allowance(address(curve), address(graduation)), 0);
        assertFalse(curve.graduated());
        assertEq(curve.backingReserve(), 1 ether);
        (uint256 proceeds,,) = curve.quoteSell(1 ether);
        assertGt(proceeds, 0);
        _sell(ALICE, 1 ether, proceeds);
        vm.expectRevert(RMTLaunchBondingCurveV1.GraduationNotReady.selector);
        curve.graduate(block.timestamp);
        _buy(BOB, 1 ether);
        graduation.setBehavior(0);
        vm.prank(BOB);
        curve.graduate(block.timestamp);
        assertEq(curve.poolId(), graduation.EXPECTED_POOL());
        assertEq(curve.positionTokenId(), 1);
        assertEq(curve.backingReserve(), 0);
        assertEq(token.allowance(address(curve), address(graduation)), 0);
        assertEq(curve.nativeDust(), 1);
        assertEq(curve.tokenDust(), 2);
        assertEq(token.balanceOf(address(curve)), 2);
        assertEq(address(curve).balance, 1);
        assertEq(token.totalSupply(), 1_000_000 ether);
        assertTrue(curve.graduated());
        vm.expectRevert(RMTLaunchBondingCurveV1.CurveClosed.selector);
        curve.graduate(block.timestamp);
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.CurveClosed.selector);
        curve.sell(1 ether, 1, block.timestamp);
        _claim(CREATOR);
    }

    function testCannotWithdrawBackingOrAccrueFeesAsCreator() external {
        _buy(ALICE, 0.4 ether);
        uint256 backing = curve.backingReserve();
        vm.prank(CREATOR);
        (bool withdrew,) = address(curve).call(abi.encodeWithSignature("withdraw(uint256)", backing));
        assertFalse(withdrew);
        vm.prank(CREATOR);
        vm.expectRevert(RMTLaunchCurveRevenueLedgerV1.Unauthorized.selector);
        ledger.accrue();
        _claim(CREATOR);
        assertEq(address(curve).balance, backing);
    }

    function testDonationsDoNotChangeQuotesBackingOrGraduationAmounts() external {
        uint256 bought = _buy(ALICE, 0.3 ether);
        uint256 backing = curve.backingReserve();
        (uint256 beforeDonation,,,) = curve.quoteBuy(0.2 ether);
        vm.deal(address(curve), backing + 1 ether);
        vm.prank(ALICE);
        token.transfer(address(curve), bought);
        (uint256 afterDonation,,,) = curve.quoteBuy(0.2 ether);
        assertEq(afterDonation, beforeDonation);
        assertEq(curve.backingReserve(), backing);
        vm.expectRevert(RMTLaunchBondingCurveV1.GraduationNotReady.selector);
        curve.graduate(block.timestamp);
        _buy(BOB, 1 ether);
        curve.graduate(block.timestamp);
        assertEq(address(curve).balance, 1 ether + curve.nativeDust());
        assertEq(token.balanceOf(address(curve)), bought + curve.tokenDust());
    }

    function testExplicitThresholdBuyAndGraduationSettleAtomically() external {
        uint256 originalEth = ALICE.balance;
        uint256 originalInventory = token.balanceOf(address(curve));
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.GraduationNotReady.selector);
        curve.buyAndGraduate{value: 0.5 ether}(1, block.timestamp);
        graduation.setBehavior(1);
        uint256 requiredOut = curve.graduationSold();
        vm.prank(ALICE);
        vm.expectRevert(bytes("interrupted funding"));
        curve.buyAndGraduate{value: 3 ether}(requiredOut, block.timestamp);
        assertEq(ALICE.balance, originalEth);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(address(curve)), originalInventory);
        assertEq(curve.sold(), 0);
        assertEq(curve.backingReserve(), 0);
        assertEq(ledger.totalAccrued(), 0);
        assertEq(address(ledger).balance, 0);
        assertEq(token.allowance(address(curve), address(graduation)), 0);
        graduation.setBehavior(0);
        vm.prank(ALICE);
        assertEq(curve.buyAndGraduate{value: 3 ether}(requiredOut, block.timestamp), requiredOut);
        assertEq(ALICE.balance, originalEth - FILL);
        assertEq(token.balanceOf(ALICE), requiredOut);
        assertTrue(curve.graduated());
        assertEq(ledger.totalAccrued(), FILL - 1 ether);
    }

    function testRefundFailureAndReentrancyPreserveTradeAndFeeState() external {
        CurvePaymentProbe malicious = new CurvePaymentProbe();
        (token, curve) = _create(address(malicious), address(0), 0, 0, bytes32(uint256(3)));
        malicious.setTargets(curve);
        ledger = curve.revenueLedger();
        vm.deal(address(malicious), 5 ether);
        malicious.setRejectPayment(true);
        vm.prank(address(malicious));
        vm.expectRevert(RMTLaunchBondingCurveV1.NativeTransferFailed.selector);
        curve.buy{value: 5 ether}(1, block.timestamp);
        assertEq(curve.sold(), 0);
        assertEq(ledger.totalAccrued(), 0);
        malicious.setRejectPayment(false);
        _buy(address(malicious), 5 ether);
        assertEq(malicious.reentryFailures(), 1);
        uint256 claimable = ledger.claimable(address(malicious));
        malicious.setRejectPayment(true);
        vm.expectRevert(RMTLaunchCurveRevenueLedgerV1.NativeTransferFailed.selector);
        malicious.claim();
        assertEq(ledger.claimable(address(malicious)), claimable);
        malicious.setRejectPayment(false);
        malicious.claim();
        assertEq(ledger.claimable(address(malicious)), 0);
        assertEq(malicious.reentryFailures(), 2);
        assertEq(curve.backingReserve(), 1 ether);
    }

    function testAtomicGraduationRefundOnlySeesFinalStateAndCanStillRevertEverything() external {
        CurvePaymentProbe hostile = new CurvePaymentProbe();
        hostile.setTargets(curve);
        vm.deal(address(hostile), 5 ether);
        uint256 threshold = curve.graduationSold();
        uint256 originalInventory = token.balanceOf(address(curve));
        hostile.setRejectPayment(true);
        vm.prank(address(hostile));
        vm.expectRevert(RMTLaunchBondingCurveV1.NativeTransferFailed.selector);
        curve.buyAndGraduate{value: 3 ether}(threshold, block.timestamp);
        assertFalse(curve.graduated());
        assertEq(curve.poolId(), bytes32(0));
        assertEq(curve.backingReserve(), 0);
        assertEq(curve.sold(), 0);
        assertEq(token.balanceOf(address(curve)), originalInventory);
        assertEq(token.balanceOf(address(graduation)), 0);
        assertEq(address(graduation).balance, 0);
        assertEq(ledger.totalAccrued(), 0);
        assertEq(address(hostile).balance, 5 ether);
        hostile.setRejectPayment(false);
        graduation.setBehavior(2);
        vm.prank(address(hostile));
        vm.expectRevert(RMTLaunchBondingCurveV1.InvalidGraduationSettlement.selector);
        curve.buyAndGraduate{value: 3 ether}(threshold, block.timestamp);
        assertFalse(hostile.sawFinalizedGraduation());
        assertEq(token.balanceOf(address(hostile)), 0);
        assertEq(ledger.totalAccrued(), 0);
        graduation.setBehavior(0);
        vm.prank(address(hostile));
        assertEq(curve.buyAndGraduate{value: 3 ether}(threshold, block.timestamp), threshold);
        assertTrue(hostile.sawFinalizedGraduation());
        assertEq(hostile.reentryFailures(), 1);
        assertEq(address(hostile).balance, 5 ether - FILL);
        assertEq(token.balanceOf(address(hostile)), threshold);
        assertEq(ledger.totalAccrued(), FILL - 1 ether);
        assertEq(address(curve).balance, curve.nativeDust());
        assertEq(token.balanceOf(address(curve)), curve.tokenDust());
    }

    function testFeeSplitIsIndependentOfTradeFragmentationForSameFeesCollected() external {
        RMTLaunchCurveRevenueLedgerV1 other =
            new RMTLaunchCurveRevenueLedgerV1(CREATOR, TREASURY, 9_000, OPERATING, FUTURE);
        RMTLaunchCurveRevenueLedgerV1 whole =
            new RMTLaunchCurveRevenueLedgerV1(CREATOR, TREASURY, 9_000, OPERATING, FUTURE);
        vm.deal(address(this), 40);
        for (uint256 index = 0; index < 20; ++index) {
            other.accrue{value: 1}();
        }
        whole.accrue{value: 20}();
        for (uint256 bucket = 0; bucket < 4; ++bucket) {
            assertEq(other.bucketAccrued(bucket), whole.bucketAccrued(bucket));
        }
        assertEq(other.bucketAccrued(0), 0);
        assertEq(other.bucketAccrued(1), 18);
        assertEq(other.bucketAccrued(2), 1);
        assertEq(other.bucketAccrued(3), 1);
    }

    function testAuthorizedAssetMigrationPreservesTokenInventoryBackingAndClaims() external {
        uint256 bought = _buy(ALICE, 0.4 ether);
        uint256 backing = curve.backingReserve();
        uint256 inventory = token.balanceOf(address(curve));
        uint256 creatorCredit = ledger.claimable(CREATOR);
        uint256 accrued = ledger.totalAccrued();
        (uint256 beforeBuy,,,) = curve.quoteBuy(0.2 ether);
        (uint256 beforeSell,,) = curve.quoteSell(bought);
        RMTLaunchBondingCurveV1 previous = curve;
        address successor = factory.prepareMigration(address(token), 2);
        RMTLaunchBondingCurveV1 next = RMTLaunchBondingCurveV1(payable(successor));
        assertFalse(next.active());
        assertEq(successor.balance, 0);
        assertEq(token.balanceOf(successor), 0);
        assertEq(factory.prepareMigration(address(token), 2), successor);
        assertTrue(address(previous).codehash != successor.codehash);
        assertEq(registry.registered(address(token)), address(previous));
        vm.prank(CREATOR);
        vm.expectRevert(RMTLaunchBondingCurveV1.UnauthorizedMigration.selector);
        previous.migrateAssets(payable(successor), successor.codehash);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidMigration.selector);
        registry.migrate(factory, address(token), successor, bytes32(uint256(1)));
        registry.migrate(factory, address(token), successor, successor.codehash);
        curve = next;
        assertEq(factory.curveForToken(address(token)), successor);
        assertEq(factory.originCurveForToken(address(token)), address(previous));
        assertEq(previous.migratedTo(), successor);
        assertFalse(previous.active());
        assertEq(previous.backingReserve(), 0);
        assertEq(address(previous).balance, 0);
        assertEq(token.balanceOf(address(previous)), 0);
        assertTrue(next.active());
        assertEq(next.migrationSource(), address(previous));
        assertEq(curve.executionVersion(), 2);
        assertEq(curve.executionEngine(), successor);
        assertEq(curve.executionEngineRuntimeHash(), successor.codehash);
        assertEq(curve.migrationCommitment(), previous.migrationCommitment());
        assertEq(address(curve.token()), address(token));
        assertEq(address(curve.revenueLedger()), address(ledger));
        assertEq(ledger.activeCurve(), successor);
        assertEq(ledger.curve(), address(previous));
        assertEq(curve.sold(), bought);
        assertEq(curve.backingReserve(), backing);
        assertEq(successor.balance, backing);
        assertEq(token.balanceOf(successor), inventory);
        assertEq(token.balanceOf(ALICE), bought);
        assertEq(ledger.claimable(CREATOR), creatorCredit);
        assertEq(ledger.totalAccrued(), accrued);
        (uint256 afterBuy,,,) = curve.quoteBuy(0.2 ether);
        (uint256 afterSell,,) = curve.quoteSell(bought);
        assertEq(afterBuy, beforeBuy);
        assertEq(afterSell, beforeSell);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidMigration.selector);
        registry.migrate(factory, address(token), successor, successor.codehash);
        vm.deal(CREATOR, 1 ether);
        vm.prank(CREATOR);
        vm.expectRevert(RMTLaunchBondingCurveV1.CurveClosed.selector);
        previous.buy{value: 0.2 ether}(1, block.timestamp);
        vm.prank(ALICE);
        vm.expectRevert(RMTLaunchBondingCurveV1.CurveClosed.selector);
        previous.sell(bought, 1, block.timestamp);
        vm.expectRevert(RMTLaunchBondingCurveV1.CurveClosed.selector);
        previous.graduate(block.timestamp);
        _sell(ALICE, bought, beforeSell);
        assertGt(ledger.totalAccrued(), accrued);
        _claim(CREATOR);
        assertEq(curve.backingReserve(), 0);
    }

    function testUnregisteredDestinationAndInterruptedMigrationLeaveOldCurveTradable() external {
        uint256 bought = _buy(ALICE, 0.4 ether);
        (uint256 payout,,) = curve.quoteSell(bought);
        address successor = factory.prepareMigration(address(token), 2);
        uint256 backing = curve.backingReserve();
        uint256 inventory = token.balanceOf(address(curve));
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidMigration.selector);
        registry.migrate(factory, address(token), address(graduation), address(graduation).codehash);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidMigration.selector);
        factory.executeMigration(address(token), successor, successor.codehash);
        vm.mockCallRevert(
            successor,
            abi.encodeCall(curve.acceptMigration, (bought, backing, inventory)),
            bytes("interrupted migration")
        );
        vm.expectRevert(bytes("interrupted migration"));
        registry.migrate(factory, address(token), successor, successor.codehash);
        vm.clearMockedCalls();
        assertTrue(curve.active());
        assertEq(curve.migratedTo(), address(0));
        assertEq(factory.curveForToken(address(token)), address(curve));
        assertEq(ledger.activeCurve(), address(curve));
        assertEq(address(curve).balance, backing);
        assertEq(token.balanceOf(address(curve)), inventory);
        assertEq(token.balanceOf(successor), 0);
        assertEq(successor.balance, 0);
        assertEq(_sell(ALICE, bought, payout), payout);
        assertEq(curve.backingReserve(), 0);
    }

    function testMigrationRejectsInsufficientBackingAndPreservesUntrackedSurpluses() external {
        uint256 bought = _buy(ALICE, 0.4 ether);
        uint256 backing = curve.backingReserve();
        uint256 inventory = token.balanceOf(address(curve));
        address successor = factory.prepareMigration(address(token), 2);
        vm.deal(address(curve), backing - 1);
        vm.expectRevert(RMTLaunchBondingCurveV1.InvalidMigrationSettlement.selector);
        registry.migrate(factory, address(token), successor, successor.codehash);
        assertTrue(curve.active());
        assertEq(ledger.activeCurve(), address(curve));
        vm.deal(address(curve), backing + 7);
        vm.deal(successor, 9);
        vm.startPrank(ALICE);
        token.transfer(address(curve), 5);
        token.transfer(successor, 11);
        vm.stopPrank();
        registry.migrate(factory, address(token), successor, successor.codehash);
        RMTLaunchBondingCurveV1 next = RMTLaunchBondingCurveV1(payable(successor));
        assertEq(address(curve).balance, 7);
        assertEq(token.balanceOf(address(curve)), 5);
        assertEq(successor.balance, backing + 9);
        assertEq(token.balanceOf(successor), inventory + 11);
        assertEq(next.backingReserve(), backing);
        assertEq(next.sold(), bought);
    }

    function testUnexpectedTransferSettlementRevertsBothCurvesAndPreservesLedger() external {
        uint256 bought = _buy(ALICE, 0.4 ether);
        uint256 backing = curve.backingReserve();
        uint256 inventory = token.balanceOf(address(curve));
        address successor = factory.prepareMigration(address(token), 2);
        // Simulate a compromised transfer response that returns success without moving inventory.
        // Pre-fund the candidate so its independent minimum balance check alone would pass.
        vm.prank(ALICE);
        token.transfer(successor, 1);
        deal(address(token), successor, inventory);
        vm.mockCall(address(token), abi.encodeCall(token.transfer, (successor, inventory)), abi.encode(true));
        vm.expectRevert(RMTLaunchBondingCurveV1.InvalidMigrationSettlement.selector);
        registry.migrate(factory, address(token), successor, successor.codehash);
        vm.clearMockedCalls();
        assertEq(factory.curveForToken(address(token)), address(curve));
        assertEq(ledger.activeCurve(), address(curve));
        assertEq(curve.sold(), bought);
        assertEq(curve.backingReserve(), backing);
        assertEq(token.balanceOf(address(curve)), inventory);
        assertEq(token.balanceOf(successor), inventory);
        assertEq(successor.balance, 0);
        assertFalse(RMTLaunchBondingCurveV1(payable(successor)).active());
    }

    function testGraduatedCurveRejectsEvenAuthorizedAssetMigration() external {
        address successor = factory.prepareMigration(address(token), 2);
        _buy(ALICE, 3 ether);
        curve.graduate(block.timestamp);
        vm.expectRevert(RMTLaunchBondingCurveV1.CurveClosed.selector);
        registry.migrate(factory, address(token), successor, successor.codehash);
        assertEq(curve.executionVersion(), 1);
        assertEq(curve.positionTokenId(), 1);
    }

    function _create(address creator, address treasury, uint16 share, uint8 preset, bytes32 intent)
        private
        returns (IERC20, RMTLaunchBondingCurveV1)
    {
        vm.prank(creator);
        (address deployedToken, address deployedCurve) =
            factory.create("Curve Token", "CURVE", "", preset, treasury, share, intent, block.timestamp);
        return (IERC20(deployedToken), RMTLaunchBondingCurveV1(payable(deployedCurve)));
    }

    function _buy(address account, uint256 budget) private returns (uint256 amount) {
        uint256 used;
        uint256 refund;
        (amount, used,, refund) = curve.quoteBuy(budget);
        assertEq(used + refund, budget);
        vm.prank(account);
        assertEq(curve.buy{value: budget}(amount, block.timestamp), amount);
    }

    function _sell(address account, uint256 amount, uint256 minimum) private returns (uint256) {
        vm.startPrank(account);
        token.approve(address(curve), amount);
        uint256 result = curve.sell(amount, minimum, block.timestamp);
        vm.stopPrank();
        return result;
    }

    function _claim(address recipient) private {
        uint256 amount = ledger.claimable(recipient);
        uint256 beforeBalance = recipient.balance;
        vm.prank(recipient);
        assertEq(ledger.claim(), amount);
        assertEq(recipient.balance, beforeBalance + amount);
    }
}
