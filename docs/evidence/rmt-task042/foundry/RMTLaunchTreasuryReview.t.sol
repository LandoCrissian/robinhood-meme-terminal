// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTLaunchCurveRevenueLedgerV1 as CurveLedger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {RMTLaunchCurveLpFeeLedgerV1 as LpLedger} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {RMTLaunchCurveTokenV1} from "../src/RMTLaunchCurveTokenV1.sol";

/// @dev Synthetic receipt and spending account. This test helper is outside the release build.
contract FixtureProjectAccount {
    address private immutable owner;
    bool private receiveNative = true;
    error Unauthorized();

    constructor(address owner_) {
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    receive() external payable {
        require(receiveNative, "Native receipt paused");
    }

    function setReceiveNative(bool allowed) external onlyOwner {
        receiveNative = allowed;
    }

    function claimCurve(CurveLedger ledger) external onlyOwner {
        ledger.claim();
    }

    function claimLp(LpLedger ledger) external onlyOwner {
        ledger.claim();
    }

    function claimLpAsset(LpLedger ledger, bool native) external onlyOwner {
        ledger.claimAsset(native);
    }

    function fundSpendingWallet(RMTLaunchCurveTokenV1 asset, address payable recipient, uint256 native, uint256 tokens)
        external onlyOwner {
        require(asset.transfer(recipient, tokens));
        (bool sent,) = recipient.call{value: native}("");
        require(sent);
    }
}

contract RMTLaunchTreasuryReviewTest is Test {
    address private creator = makeAddr("creator");
    address private operating = makeAddr("operations");
    address private reserve = makeAddr("future reserve");
    address private projectEoa = makeAddr("project treasury");
    address private controller = makeAddr("smart treasury owner");
    address private spending = makeAddr("project spending wallet");
    address private unrelated = makeAddr("unrelated caller");

    uint256 private constant CURVE_FEES = 801_043;
    uint256 private constant NATIVE_LP_FEES = 501_387;
    uint256 private constant TOKEN_LP_FEES = 183_725;

    function setUp() external {
        vm.chainId(31_337);
        vm.deal(address(this), 1 ether);
    }

    function testSoloCreatorReceivesProjectShareInBothLedgers() external {
        _exerciseEoa(address(0), 0);
    }

    function testIndependentEoaReceivesQuarterOfProjectShareInBothLedgers() external {
        _exerciseEoa(projectEoa, 2_250);
    }

    function testSmartTreasuryReceivesHalfAndFundsAnIndependentSpendingWallet() external {
        FixtureProjectAccount account = new FixtureProjectAccount(controller);
        (CurveLedger curve, LpLedger lp, RMTLaunchCurveTokenV1 asset) = _fund(address(account), 4_500);
        _checkAllocations(curve, lp, address(account), 4_500);
        (uint256 nativeCredit, uint256 tokenCredit) = lp.claimable(address(account));
        uint256 nativeTotal = curve.claimable(address(account)) + nativeCredit;

        vm.prank(controller);
        account.claimCurve(curve);
        vm.prank(controller);
        account.claimLp(lp);
        assertEq(address(account).balance, nativeTotal);
        assertEq(asset.balanceOf(address(account)), tokenCredit);
        vm.prank(unrelated);
        vm.expectRevert(FixtureProjectAccount.Unauthorized.selector);
        account.fundSpendingWallet(asset, payable(spending), nativeTotal, tokenCredit);
        vm.prank(controller);
        account.fundSpendingWallet(asset, payable(spending), nativeTotal, tokenCredit);
        assertEq(spending.balance, nativeTotal);
        assertEq(asset.balanceOf(spending), tokenCredit);
        assertEq(address(account).balance, 0);
        assertEq(asset.balanceOf(address(account)), 0);
    }

    function testFullTreasuryShareKeepsPlatformSplitAndCanRecoverAnAssetSeparately() external {
        FixtureProjectAccount account = new FixtureProjectAccount(controller);
        (CurveLedger curve, LpLedger lp, RMTLaunchCurveTokenV1 asset) = _fund(address(account), 9_000);
        _checkAllocations(curve, lp, address(account), 9_000);
        assertEq(curve.claimable(creator), 0);
        (uint256 native, uint256 tokens) = lp.claimable(address(account));
        vm.prank(controller);
        account.setReceiveNative(false);
        vm.prank(controller);
        vm.expectRevert(CurveLedger.NativeTransferFailed.selector);
        account.claimCurve(curve);
        assertEq(curve.totalClaimed(), 0);
        vm.prank(controller);
        vm.expectRevert(LpLedger.NativeTransferFailed.selector);
        account.claimLp(lp);
        assertEq(asset.balanceOf(address(account)), 0);
        _assertLpCredit(lp, address(account), native, tokens);

        vm.prank(controller);
        account.claimLpAsset(lp, false);
        assertEq(asset.balanceOf(address(account)), tokens);
        _assertLpCredit(lp, address(account), native, 0);
        vm.prank(controller);
        vm.expectRevert(LpLedger.NothingToClaim.selector);
        account.claimLpAsset(lp, false);

        vm.prank(controller);
        account.setReceiveNative(true);
        uint256 curveCredit = curve.claimable(address(account));
        vm.prank(controller);
        account.claimCurve(curve);
        vm.prank(controller);
        account.claimLpAsset(lp, true);
        assertEq(address(account).balance, curveCredit + native);
        _assertLpCredit(lp, address(account), 0, 0);
    }

    function _exerciseEoa(address treasury, uint16 share) private {
        (CurveLedger curve, LpLedger lp, RMTLaunchCurveTokenV1 asset) = _fund(treasury, share);
        _checkAllocations(curve, lp, treasury, share);
        address[4] memory beneficiaries = [creator, treasury, operating, reserve];
        for (uint256 i; i < beneficiaries.length; ++i) {
            address account = beneficiaries[i];
            if (account == address(0)) continue;
            uint256 curveCredit = curve.claimable(account);
            (uint256 native, uint256 tokens) = lp.claimable(account);
            vm.prank(account);
            curve.claim();
            vm.prank(account);
            lp.claim();
            assertEq(account.balance, curveCredit + native);
            assertEq(asset.balanceOf(account), tokens);
        }
        assertEq(curve.totalClaimed(), CURVE_FEES);
        (uint256 nativeTotal, uint256 tokenTotal) = lp.totalClaimed();
        assertEq(nativeTotal, NATIVE_LP_FEES);
        assertEq(tokenTotal, TOKEN_LP_FEES);
    }

    function _fund(address treasury, uint16 share) private returns (CurveLedger curve, LpLedger lp, RMTLaunchCurveTokenV1 asset) {
        curve = new CurveLedger(creator, treasury, share, operating, reserve);
        asset = new RMTLaunchCurveTokenV1("Fixture Asset", "FIX", 1_000_000 ether);
        lp = new LpLedger(asset, address(this), LpLedger.Policy(creator, treasury, share, operating, reserve));
        curve.accrue{value: 1}();
        curve.accrue{value: CURVE_FEES - 1}();
        assertTrue(asset.transfer(address(lp), TOKEN_LP_FEES));
        (bool sent,) = payable(address(lp)).call{value: NATIVE_LP_FEES}("");
        require(sent);
        lp.record(1, 1);
        lp.record(NATIVE_LP_FEES - 1, TOKEN_LP_FEES - 1);
    }

    function _checkAllocations(CurveLedger curve, LpLedger lp, address treasury, uint16 share) private view {
        uint256[4] memory nativeCurve = _split(CURVE_FEES, share);
        uint256[4] memory nativeLp = _split(NATIVE_LP_FEES, share);
        uint256[4] memory tokenLp = _split(TOKEN_LP_FEES, share);
        address[4] memory beneficiaries = [creator, treasury, operating, reserve];
        for (uint256 i; i < beneficiaries.length; ++i) {
            assertEq(curve.claimable(beneficiaries[i]), nativeCurve[i]);
            (uint256 native, uint256 tokens) = lp.claimable(beneficiaries[i]);
            assertEq(native, nativeLp[i]);
            assertEq(tokens, tokenLp[i]);
        }
    }

    function _assertLpCredit(LpLedger lp, address recipient, uint256 native, uint256 tokens) private view {
        (uint256 actualNative, uint256 actualTokens) = lp.claimable(recipient);
        assertEq(actualNative, native);
        assertEq(actualTokens, tokens);
    }

    function _split(uint256 amount, uint16 share) private pure returns (uint256[4] memory result) {
        uint256 platform = amount / 10;
        uint256 project = amount - platform;
        uint256 treasury = project * share / 9_000;
        return [project - treasury, treasury, platform / 2, platform - platform / 2];
    }
}
