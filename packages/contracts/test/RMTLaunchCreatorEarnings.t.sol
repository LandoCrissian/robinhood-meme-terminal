// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {RMTLaunchCurveRevenueLedgerV1 as CurveLedger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {RMTLaunchCurveLpFeeLedgerV1 as LpLedger} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {RMTLaunchCurveFactoryV2 as Factory} from "../src/RMTLaunchCurveFactoryV2.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1} from "../src/RMTLaunchBondingCurveV2.sol";
import {CreationFeeGraduationBinding, CreationFeeRegistry} from "./RMTLaunchCurveCreationFeeV1.t.sol";

interface EarningsSafe {
    function setup(address[] calldata, uint256, address, bytes calldata, address, address, uint256, address payable)
        external;
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function nonce() external view returns (uint256);
    function getTransactionHash(
        address,
        uint256,
        bytes calldata,
        uint8,
        uint256,
        uint256,
        uint256,
        address,
        address,
        uint256
    ) external view returns (bytes32);
    function execTransaction(
        address,
        uint256,
        bytes calldata,
        uint8,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes calldata
    ) external payable returns (bool);
}

interface EarningsSafeFactory {
    function createProxyWithNonce(address singleton, bytes calldata initializer, uint256 saltNonce)
        external
        returns (address);
}

contract EarningsTestAsset is ERC20 {
    bool public failTransfer;
    address public reentryLedger;
    bytes4 public reentryResult;

    constructor() ERC20("Earnings isolated asset", "EARN") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function configure(bool fails, address ledger) external {
        failTransfer = fails;
        reentryLedger = ledger;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTransfer) return false;
        if (reentryLedger != address(0)) {
            (bool success, bytes memory reason) = reentryLedger.call(abi.encodeCall(LpLedger.claimAsset, (false)));
            require(!success, "unexpected nested claim");
            reentryResult = bytes4(reason);
        }
        return super.transfer(to, amount);
    }
}

contract EarningsRecipient {
    bool public rejectNative;
    address public probe;
    bytes4 public reentryResult;

    function configure(bool reject, address reentry) external {
        rejectNative = reject;
        probe = reentry;
    }

    function curveClaim(CurveLedger ledger) external {
        ledger.claim();
    }

    function combinedClaim(LpLedger ledger) external {
        ledger.claim();
    }

    function assetClaim(LpLedger ledger, bool native) external {
        ledger.claimAsset(native);
    }

    receive() external payable {
        require(!rejectNative, "isolated recipient rejects native");
        if (probe != address(0)) {
            (bool success, bytes memory reason) = probe.call(abi.encodeCall(LpLedger.claimAsset, (false)));
            require(!success, "unexpected nested claim");
            reentryResult = bytes4(reason);
        }
    }
}

contract EarningsSuccessorAccrual {
    function accrue(CurveLedger ledger) external payable {
        ledger.accrue{value: msg.value}();
    }
}

/// @notice Earnings-specific acceptance; local assets only, with unmodified deployed-candidate source.
/// @dev Ledger units do not replace the existing migration and real-v4 custody suites.
contract RMTLaunchCreatorEarningsTest is Test {
    address private constant CREATOR = address(0x7101);
    address private constant TREASURY = address(0x7102);
    address private constant OPERATIONS = address(0x7103);
    address private constant RESERVE = address(0x7104);
    address private constant RELAYER = address(0x7105);
    uint256 private constant CREATION_FEE = 0.0004 ether;

    // Exact infrastructure retained from the already committed 4663 observation.
    address private constant SAFE_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address private constant SAFE_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address private constant SAFE_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    bytes32 private constant SINGLETON_HASH = 0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff;
    bytes32 private constant FACTORY_HASH = 0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317;
    bytes32 private constant HANDLER_HASH = 0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9;
    uint256 private constant KEY_ONE = 0x740001;
    uint256 private constant KEY_TWO = 0x740002;
    uint256 private constant KEY_THREE = 0x740003;

    EarningsTestAsset private asset;

    function setUp() external {
        vm.chainId(31_337);
        vm.deal(address(this), 100 ether);
        asset = new EarningsTestAsset();
    }

    function testCurveCumulativeRoundingAndOverlappingRolesHaveOneRecipientCredit() external {
        CurveLedger ledger = new CurveLedger(CREATOR, TREASURY, 2_250, CREATOR, RESERVE);
        for (uint256 i; i < 103; ++i) {
            ledger.accrue{value: 1}();
        }
        assertEq(ledger.bucketAccrued(0), 70);
        assertEq(ledger.bucketAccrued(1), 23);
        assertEq(ledger.bucketAccrued(2), 5);
        assertEq(ledger.bucketAccrued(3), 5);
        assertEq(ledger.claimable(CREATOR), 75, "creator and Operations roles aggregate at one address");
        assertEq(_curvePaid(ledger, CREATOR), 0);
        vm.prank(CREATOR);
        assertEq(ledger.claim(), 75);
        assertEq(_curvePaid(ledger, CREATOR), 75);
        ledger.accrue{value: 97}();
        uint256 additional = ledger.claimable(CREATOR);
        vm.prank(CREATOR);
        assertEq(ledger.claim(), additional);
        assertEq(_curvePaid(ledger, CREATOR), 145);
        assertEq(ledger.totalAccrued(), 200);
        assertEq(ledger.totalClaimed(), 145);
        vm.expectRevert(CurveLedger.NothingToClaim.selector);
        vm.prank(RELAYER);
        ledger.claim();
    }

    function testEntireProjectShareCanBelongToIndependentTreasury() external {
        CurveLedger ledger = new CurveLedger(CREATOR, TREASURY, 9_000, OPERATIONS, RESERVE);
        ledger.accrue{value: 199}();
        assertEq(ledger.claimable(CREATOR), 0);
        assertEq(ledger.claimable(TREASURY), 180);
        assertEq(ledger.claimable(OPERATIONS), 9);
        assertEq(ledger.claimable(RESERVE), 10);
        vm.expectRevert(CurveLedger.NothingToClaim.selector);
        vm.prank(CREATOR);
        ledger.claim();
        vm.prank(TREASURY);
        assertEq(ledger.claim(), 180);
        assertEq(_curvePaid(ledger, TREASURY), 180);
    }

    function testOriginalCurveLedgerRetainsRightsAfterAccrualAuthorityMoves() external {
        CurveLedger ledger = new CurveLedger(CREATOR, address(0), 0, OPERATIONS, RESERVE);
        ledger.accrue{value: 100}();
        EarningsSuccessorAccrual successor = new EarningsSuccessorAccrual();
        ledger.moveAccrual(address(successor));
        assertEq(ledger.curve(), address(this));
        assertEq(ledger.activeCurve(), address(successor));
        vm.expectRevert(CurveLedger.Unauthorized.selector);
        ledger.accrue{value: 1}();
        successor.accrue{value: 100}(ledger);
        vm.prank(CREATOR);
        assertEq(ledger.claim(), 180);
        assertEq(_curvePaid(ledger, CREATOR), 180);
        assertEq(ledger.claimable(OPERATIONS), 10);
        assertEq(ledger.claimable(RESERVE), 10);
    }

    function testLpSingleAssetClaimsKeepOtherAssetAndCumulativeRights() external {
        LpLedger ledger = _lp(CREATOR, TREASURY, 2_250, CREATOR);
        _record(ledger, 101, 77);
        (uint256 nativeCredit, uint256 tokenCredit) = ledger.claimable(CREATOR);
        vm.prank(CREATOR);
        (uint256 n, uint256 t) = ledger.claimAsset(true);
        assertEq(n, nativeCredit);
        assertEq(t, 0);
        (n, t) = ledger.claimable(CREATOR);
        assertEq(n, 0);
        assertEq(t, tokenCredit);
        _record(ledger, 99, 123);
        (, tokenCredit) = ledger.claimable(CREATOR);
        vm.prank(CREATOR);
        (n, t) = ledger.claimAsset(false);
        assertEq(n, 0);
        assertEq(t, tokenCredit);
        (uint256 paidNative, uint256 paidToken) = _lpPaid(ledger, CREATOR);
        assertEq(paidNative, nativeCredit);
        assertEq(paidToken, 145);
        (n, t) = ledger.claimable(CREATOR);
        assertGt(n, 0);
        assertEq(t, 0);
        vm.prank(CREATOR);
        ledger.claim();
        (paidNative, paidToken) = _lpPaid(ledger, CREATOR);
        assertEq(paidNative, 145);
        assertEq(paidToken, 145);
    }

    function testRejectedTokenClaimPreservesCreditsAndNativeOnlyCanRecover() external {
        LpLedger ledger = _lp(CREATOR, address(0), 0, OPERATIONS);
        _record(ledger, 100, 100);
        asset.configure(true, address(0));
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(asset)));
        vm.prank(CREATOR);
        ledger.claim();
        (uint256 n, uint256 t) = ledger.claimable(CREATOR);
        assertEq(n, 90);
        assertEq(t, 90);
        (n, t) = ledger.totalClaimed();
        assertEq(n, 0);
        assertEq(t, 0);
        vm.prank(CREATOR);
        ledger.claimAsset(true);
        (n, t) = ledger.claimable(CREATOR);
        assertEq(n, 0);
        assertEq(t, 90);
        asset.configure(false, address(0));
        vm.prank(CREATOR);
        ledger.claimAsset(false);
        (n, t) = _lpPaid(ledger, CREATOR);
        assertEq(n, 90);
        assertEq(t, 90);
    }

    function testRejectedNativeRollsBackTokenThenTokenOnlyAndRetryRemainPossible() external {
        EarningsRecipient recipient = new EarningsRecipient();
        LpLedger ledger = _lp(address(recipient), address(0), 0, OPERATIONS);
        _record(ledger, 100, 100);
        recipient.configure(true, address(0));
        vm.expectRevert(LpLedger.NativeTransferFailed.selector);
        recipient.combinedClaim(ledger);
        assertEq(asset.balanceOf(address(recipient)), 0, "failed combined payout is atomic");
        recipient.assetClaim(ledger, false);
        (uint256 n, uint256 t) = ledger.claimable(address(recipient));
        assertEq(n, 90);
        assertEq(t, 0);
        recipient.configure(false, address(ledger));
        recipient.assetClaim(ledger, true);
        assertEq(recipient.reentryResult(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(address(recipient).balance, 90);
        assertEq(asset.balanceOf(address(recipient)), 90);
        (n, t) = _lpPaid(ledger, address(recipient));
        assertEq(n, 90);
        assertEq(t, 90);
    }

    function testTokenCallbackCannotReenterClaimOrSpendAnotherBeneficiaryCredit() external {
        LpLedger ledger = _lp(CREATOR, TREASURY, 2_250, OPERATIONS);
        _record(ledger, 100, 100);
        (uint256 treasuryNative, uint256 treasuryToken) = ledger.claimable(TREASURY);
        asset.configure(false, address(ledger));
        vm.prank(CREATOR);
        ledger.claimAsset(false);
        assertEq(asset.reentryResult(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        (uint256 n, uint256 t) = ledger.claimable(TREASURY);
        assertEq(n, treasuryNative);
        assertEq(t, treasuryToken);
        vm.expectRevert(LpLedger.Unauthorized.selector);
        vm.prank(RELAYER);
        ledger.record(1, 1);
    }

    function testFuzzPartialClaimsConserveEveryAssetAndRole(uint96 nativeSeed, uint96 tokenSeed, uint8 partSeed)
        external
    {
        uint256 nativeTotal = bound(nativeSeed, 1, 1e12);
        uint256 tokenTotal = bound(tokenSeed, 1, 1e12);
        uint256 parts = bound(partSeed, 2, 16);
        LpLedger ledger = _lp(CREATOR, TREASURY, 2_250, CREATOR);
        uint256 previousNative;
        uint256 previousToken;
        for (uint256 i = 1; i <= parts; ++i) {
            uint256 nextNative = nativeTotal * i / parts;
            uint256 nextToken = tokenTotal * i / parts;
            _record(ledger, nextNative - previousNative, nextToken - previousToken);
            previousNative = nextNative;
            previousToken = nextToken;
            (uint256 n, uint256 t) = ledger.claimable(CREATOR);
            if ((i % 2 == 0 && n != 0) || (i % 2 == 1 && t != 0)) {
                vm.prank(CREATOR);
                ledger.claimAsset(i % 2 == 0);
            }
        }
        (uint256 accruedNative, uint256 accruedToken) = ledger.totalAccrued();
        (uint256 claimedNative, uint256 claimedToken) = ledger.totalClaimed();
        assertEq(accruedNative, nativeTotal);
        assertEq(accruedToken, tokenTotal);
        uint256 outstandingNative;
        uint256 outstandingToken;
        address[3] memory recipients = [CREATOR, TREASURY, RESERVE];
        for (uint256 i; i < recipients.length; ++i) {
            (uint256 n, uint256 t) = ledger.claimable(recipients[i]);
            outstandingNative += n;
            outstandingToken += t;
        }
        assertEq(claimedNative + outstandingNative, nativeTotal);
        assertEq(claimedToken + outstandingToken, tokenTotal);
        assertEq(address(ledger).balance, outstandingNative);
        assertEq(asset.balanceOf(address(ledger)), outstandingToken);
    }

    function testThirtyOneRealProjectsPreserveSeparateLedgersAndTreasuryEntitlements() external {
        Factory factory = _factory(OPERATIONS);
        address trader = address(0x7A00);
        vm.deal(trader, 1 ether);
        address[31] memory ledgers;
        for (uint256 i; i < ledgers.length; ++i) {
            address creator = address(uint160(0x8000 + i));
            vm.deal(creator, CREATION_FEE);
            vm.prank(creator);
            (address token, address curveAddress) = factory.create{value: CREATION_FEE}(
                "Independent project", "PROJ", "", TREASURY, 2_250, bytes32(i + 1), block.timestamp
            );
            Curve curve = Curve(payable(curveAddress));
            CurveLedger ledger = curve.revenueLedger();
            ledgers[i] = address(ledger);
            assertEq(IERC20(token).totalSupply(), 1_000_000_000 ether);
            assertEq(curve.backingReserve(), 0);
            (uint256 output,, uint256 fee,) = curve.quoteBuy(1e12);
            vm.prank(trader);
            curve.buy{value: 1e12}(output, block.timestamp);
            assertEq(ledger.totalAccrued(), fee);
            assertGt(ledger.claimable(creator), 0);
            assertGt(ledger.claimable(TREASURY), 0);
            assertEq(ledger.claimable(RELAYER), 0);
            for (uint256 j; j < i; ++j) {
                assertTrue(ledgers[j] != ledgers[i]);
            }
        }
        uint256 accrued = factory.creationFeesAccrued();
        assertEq(accrued, CREATION_FEE * 31);
        uint256 before = OPERATIONS.balance;
        vm.prank(RELAYER);
        assertEq(factory.claimCreationFees(), accrued);
        assertEq(OPERATIONS.balance - before, accrued);
        assertEq(RELAYER.balance, 0);
        for (uint256 i; i < ledgers.length; ++i) {
            assertGt(CurveLedger(ledgers[i]).claimable(TREASURY), 0);
        }
    }

    function testSafeCurveClaimUsesTwoOwnerSignaturesAndAttributesReceiptToSafe() external {
        EarningsSafe safe = _safe(1);
        CurveLedger ledger = new CurveLedger(address(safe), address(0), 0, OPERATIONS, RESERVE);
        ledger.accrue{value: 100}();
        vm.expectRevert(CurveLedger.NothingToClaim.selector);
        vm.prank(vm.addr(KEY_ONE));
        ledger.claim();
        vm.recordLogs();
        _execute(safe, address(ledger), 0, abi.encodeCall(CurveLedger.claim, ()));
        assertEq(address(safe).balance, 90);
        assertEq(vm.addr(KEY_ONE).balance, 0);
        assertEq(vm.addr(KEY_TWO).balance, 0);
        _assertClaimRecipient(
            vm.getRecordedLogs(), address(ledger), keccak256("CurveFeeClaimed(address,uint256)"), address(safe)
        );
        assertEq(_curvePaid(ledger, address(safe)), 90);
    }

    function testSafeLpCombinedSingleAssetClaimsAndAuthorizedSpending() external {
        EarningsSafe safe = _safe(2);
        LpLedger ledger = _lp(address(safe), TREASURY, 2_250, OPERATIONS);
        _record(ledger, 100, 200);
        (uint256 nativeCredit, uint256 tokenCredit) = ledger.claimable(address(safe));
        vm.recordLogs();
        _execute(safe, address(ledger), 0, abi.encodeCall(LpLedger.claim, ()));
        _assertClaimRecipient(
            vm.getRecordedLogs(), address(ledger), keccak256("LpFeesClaimed(address,uint256,uint256)"), address(safe)
        );
        assertEq(address(safe).balance, nativeCredit);
        assertEq(asset.balanceOf(address(safe)), tokenCredit);
        _record(ledger, 100, 100);
        (uint256 pendingNative, uint256 pendingToken) = ledger.claimable(address(safe));
        _execute(safe, address(ledger), 0, abi.encodeCall(LpLedger.claimAsset, (false)));
        (uint256 n, uint256 t) = ledger.claimable(address(safe));
        assertEq(n, pendingNative);
        assertEq(t, 0);
        _execute(safe, address(ledger), 0, abi.encodeCall(LpLedger.claimAsset, (true)));
        address spender = address(0x7777);
        _execute(safe, spender, nativeCredit + pendingNative, "");
        _execute(safe, address(asset), 0, abi.encodeCall(IERC20.transfer, (spender, tokenCredit + pendingToken)));
        assertEq(spender.balance, nativeCredit + pendingNative);
        assertEq(asset.balanceOf(spender), tokenCredit + pendingToken);
        assertEq(address(safe).balance, 0);
        assertEq(asset.balanceOf(address(safe)), 0);
        (uint256 treasuryNative,) = ledger.claimable(TREASURY);
        assertGt(treasuryNative, 0);
    }

    function testSafeRejectsInsufficientApprovalsReplayAndCrossSafeAuthorization() external {
        EarningsSafe safe = _safe(3);
        EarningsSafe other = _safe(4);
        CurveLedger ledger = new CurveLedger(address(safe), address(0), 0, OPERATIONS, RESERVE);
        ledger.accrue{value: 100}();
        bytes memory data = abi.encodeCall(CurveLedger.claim, ());
        bytes32 digest = _safeDigest(safe, address(ledger), 0, data);
        bytes memory signatures = _signatures(digest);
        vm.expectRevert(bytes("GS020"));
        safe.execTransaction(
            address(ledger), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), _sign(KEY_ONE, digest)
        );
        assertEq(ledger.claimable(address(safe)), 90);
        vm.expectRevert();
        other.execTransaction(address(ledger), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
        assertTrue(
            safe.execTransaction(address(ledger), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures)
        );
        vm.expectRevert();
        safe.execTransaction(address(ledger), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
        assertEq(address(safe).balance, 90);
        assertEq(ledger.claimable(address(safe)), 0);
    }

    function testPermissionlessCreationFeeReleasePaysSafeNotExecutorOrOwners() external {
        EarningsSafe operations = _safe(5);
        Factory factory = _factory(address(operations));
        vm.deal(CREATOR, CREATION_FEE);
        vm.prank(CREATOR);
        factory.create{value: CREATION_FEE}(
            "Fee project", "FEE", "", address(0), 0, bytes32(uint256(17)), block.timestamp
        );
        vm.recordLogs();
        vm.prank(RELAYER);
        assertEq(factory.claimCreationFees(), CREATION_FEE);
        _assertClaimRecipient(
            vm.getRecordedLogs(),
            address(factory),
            keccak256("CreationFeesClaimed(address,uint256)"),
            address(operations)
        );
        assertEq(address(operations).balance, CREATION_FEE);
        assertEq(RELAYER.balance, 0);
        assertEq(vm.addr(KEY_ONE).balance, 0);
        assertEq(factory.creationFeesAccrued(), 0);
        vm.expectRevert(Factory.NoCreationFees.selector);
        factory.claimCreationFees();
    }

    function _lp(address creator, address treasury, uint16 bps, address operations) private returns (LpLedger) {
        return new LpLedger(
            IERC20(address(asset)), address(this), LpLedger.Policy(creator, treasury, bps, operations, RESERVE)
        );
    }

    function _record(LpLedger ledger, uint256 nativeAmount, uint256 tokenAmount) private {
        asset.mint(address(ledger), tokenAmount);
        (bool sent,) = address(ledger).call{value: nativeAmount}("");
        require(sent);
        ledger.record(nativeAmount, tokenAmount);
    }

    function _curvePaid(CurveLedger ledger, address who) private view returns (uint256) {
        address[4] memory recipients =
            [ledger.creator(), ledger.treasury(), ledger.operatingRecipient(), ledger.futureReserveRecipient()];
        uint256 credited;
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == who) credited += ledger.bucketAccrued(i);
        }
        return credited - ledger.claimable(who);
    }

    function _lpPaid(LpLedger ledger, address who) private view returns (uint256 nativePaid, uint256 tokenPaid) {
        address[4] memory recipients =
            [ledger.creator(), ledger.treasury(), ledger.operatingRecipient(), ledger.futureReserveRecipient()];
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == who) {
                (uint256 n, uint256 t) = ledger.bucketAccrued(i);
                nativePaid += n;
                tokenPaid += t;
            }
        }
        (uint256 nativeLeft, uint256 tokenLeft) = ledger.claimable(who);
        return (nativePaid - nativeLeft, tokenPaid - tokenLeft);
    }

    function _factory(address operations) private returns (Factory) {
        CreationFeeRegistry registry = new CreationFeeRegistry();
        address successor = address(new RMTLaunchCurveSuccessorDeployerV1());
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        CreationFeeGraduationBinding graduation = new CreationFeeGraduationBinding(predicted);
        return new Factory(
            address(graduation), operations, RESERVE, address(registry), successor, successor.codehash, CREATION_FEE
        );
    }

    function _safe(uint256 salt) private returns (EarningsSafe safe) {
        string memory fixture = vm.readFile("test/fixtures/safe-1.4.1/runtime.json");
        vm.etch(SAFE_SINGLETON, vm.parseJsonBytes(fixture, ".contracts.safe_l2.code"));
        vm.etch(SAFE_FACTORY, vm.parseJsonBytes(fixture, ".contracts.safe_proxy_factory.code"));
        vm.etch(SAFE_HANDLER, vm.parseJsonBytes(fixture, ".contracts.compatibility_fallback_handler.code"));
        assertEq(SAFE_SINGLETON.codehash, SINGLETON_HASH);
        assertEq(SAFE_FACTORY.codehash, FACTORY_HASH);
        assertEq(SAFE_HANDLER.codehash, HANDLER_HASH);
        address[] memory owners = new address[](3);
        owners[0] = vm.addr(KEY_ONE);
        owners[1] = vm.addr(KEY_TWO);
        owners[2] = vm.addr(KEY_THREE);
        bytes memory initializer = abi.encodeCall(
            EarningsSafe.setup, (owners, 2, address(0), bytes(""), SAFE_HANDLER, address(0), 0, payable(address(0)))
        );
        safe = EarningsSafe(EarningsSafeFactory(SAFE_FACTORY).createProxyWithNonce(SAFE_SINGLETON, initializer, salt));
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners(), owners);
        assertEq(safe.nonce(), 0);
    }

    function _safeDigest(EarningsSafe safe, address target, uint256 value, bytes memory data)
        private
        view
        returns (bytes32)
    {
        return safe.getTransactionHash(target, value, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
    }

    function _execute(EarningsSafe safe, address target, uint256 value, bytes memory data) private {
        bytes memory signatures = _signatures(_safeDigest(safe, target, value, data));
        vm.prank(RELAYER);
        assertTrue(safe.execTransaction(target, value, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures));
    }

    function _signatures(bytes32 digest) private pure returns (bytes memory) {
        return vm.addr(KEY_ONE) < vm.addr(KEY_TWO)
            ? bytes.concat(_sign(KEY_ONE, digest), _sign(KEY_TWO, digest))
            : bytes.concat(_sign(KEY_TWO, digest), _sign(KEY_ONE, digest));
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _assertClaimRecipient(Vm.Log[] memory logs, address emitter, bytes32 eventId, address recipient)
        private
        pure
    {
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics.length == 2 && logs[i].topics[0] == eventId) {
                require(address(uint160(uint256(logs[i].topics[1]))) == recipient, "wrong receipt beneficiary");
                found = true;
            }
        }
        require(found, "missing attributed claim receipt");
    }
}
