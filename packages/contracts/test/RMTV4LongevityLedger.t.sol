// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {RMTV4LongevityLedger} from "../src/RMTV4LongevityLedger.sol";

contract LongevityLedgerHarness is RMTV4LongevityLedger {
    receive() external payable {}

    function commit(address token, address creator, FeePolicy memory policy) external {
        _commitFeePolicy(token, creator, policy);
    }

    function settle(address token, uint256 tokenAmount) external payable nonReentrant {
        uint256 beforeToken = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(msg.sender, address(this), tokenAmount));
        _accrueFees(token, msg.value, IERC20(token).balanceOf(address(this)) - beforeToken);
    }
}

contract LongevityLedgerTestToken is ERC20 {
    constructor() ERC20("Fee Ledger Test Token", "FEE") {
        _mint(msg.sender, type(uint128).max);
    }
}

contract RejectingLongevityRecipient {
    receive() external payable {
        revert();
    }

    function claim(LongevityLedgerHarness ledger, address token, uint8 bucket) external {
        ledger.withdrawFees(token, bucket);
    }
}

contract ReentrantLongevityRecipient {
    LongevityLedgerHarness private immutable ledger;
    address private immutable token;
    bool public nestedWithdrawalFailed;

    constructor(LongevityLedgerHarness ledger_, address token_) {
        ledger = ledger_;
        token = token_;
    }

    receive() external payable {
        // The nested claim has another nonempty balance for the same authorized recipient.
        (bool succeeded,) = address(ledger).call(abi.encodeCall(ledger.withdrawFees, (token, 0)));
        nestedWithdrawalFailed = !succeeded;
    }

    function claim(address sourceToken) external {
        ledger.withdrawFees(sourceToken, 0);
    }
}

contract RMTV4LongevityLedgerTest is Test {
    uint16 private constant ALL_FEES = 10_000;
    LongevityLedgerHarness private ledger;
    LongevityLedgerTestToken private first;
    LongevityLedgerTestToken private second;
    address private creator;
    address private treasury;
    address private reserve;

    function setUp() public {
        vm.chainId(31_337);
        ledger = new LongevityLedgerHarness();
        first = new LongevityLedgerTestToken();
        second = new LongevityLedgerTestToken();
        first.approve(address(ledger), type(uint256).max);
        second.approve(address(ledger), type(uint256).max);
        vm.deal(address(this), type(uint128).max);
        creator = makeAddr("creator");
        treasury = makeAddr("treasury");
        reserve = makeAddr("reserve");
    }

    function testCreatorOnlyPolicyHasNoDustAndCanClaimBothAssets() public {
        ledger.commit(address(first), creator, _defaultPolicy());
        ledger.settle{value: 7}(address(first), 11);

        _assertBucket(address(first), 0, creator, 7, 11, 0, 0);
        _assertBucket(address(first), 1, address(0), 0, 0, 0, 0);
        _assertBucket(address(first), 2, address(0), 0, 0, 0, 0);
        _assertTotals(address(first), 7, 11, 0, 0);
        uint256 nativeBefore = creator.balance;
        vm.prank(creator);
        ledger.withdrawFees(address(first), 0);

        assertEq(creator.balance, nativeBefore + 7);
        assertEq(first.balanceOf(creator), 11);
        _assertBucket(address(first), 0, creator, 0, 0, 7, 11);
        _assertTotals(address(first), 7, 11, 0, 0);
        vm.expectRevert(RMTV4LongevityLedger.NoClaimableFees.selector);
        vm.prank(creator);
        ledger.withdrawFees(address(first), 0);
    }

    function testRejectsInvalidAndReplacementCommitments() public {
        _expectInvalid(address(first), creator, RMTV4LongevityLedger.FeePolicy(treasury, reserve, 5000, 3000, 1999));
        _expectInvalid(address(first), creator, RMTV4LongevityLedger.FeePolicy(address(0), reserve, 5000, 3000, 2000));
        _expectInvalid(address(first), creator, RMTV4LongevityLedger.FeePolicy(treasury, reserve, 5000, 5000, 0));
        _expectInvalid(address(first), creator, RMTV4LongevityLedger.FeePolicy(creator, reserve, 5000, 3000, 2000));
        _expectInvalid(address(first), creator, RMTV4LongevityLedger.FeePolicy(treasury, treasury, 5000, 3000, 2000));
        _expectInvalid(
            address(first), creator, RMTV4LongevityLedger.FeePolicy(address(ledger), reserve, 5000, 3000, 2000)
        );
        _expectInvalid(
            address(first), creator, RMTV4LongevityLedger.FeePolicy(treasury, address(first), 5000, 3000, 2000)
        );
        _expectInvalid(address(first), address(0), _defaultPolicy());
        _expectInvalid(address(0), creator, _defaultPolicy());

        vm.expectRevert(RMTV4LongevityLedger.FeePolicyUnavailable.selector);
        ledger.settle{value: 1}(address(first), 1);
        assertEq(address(ledger).balance, 0);
        assertEq(first.balanceOf(address(ledger)), 0);

        ledger.commit(address(first), creator, _splitPolicy());
        vm.expectRevert(RMTV4LongevityLedger.FeePolicyAlreadyCommitted.selector);
        ledger.commit(address(first), reserve, _defaultPolicy());
        (address recordedCreator, address recordedTreasury, address recordedReserve, uint16 c, uint16 t, uint16 r) =
            ledger.feePolicy(address(first));
        assertEq(recordedCreator, creator);
        assertEq(recordedTreasury, treasury);
        assertEq(recordedReserve, reserve);
        assertEq(c, 3333);
        assertEq(t, 3333);
        assertEq(r, 3334);
    }

    function testCannotClaimAnotherBucketOrWithdrawOnAnotherChain() public {
        ledger.commit(address(first), creator, _splitPolicy());
        ledger.settle{value: 30}(address(first), 100);
        vm.expectRevert(RMTV4LongevityLedger.UnauthorizedFeeRecipient.selector);
        vm.prank(creator);
        ledger.withdrawFees(address(first), 1);
        vm.expectRevert(RMTV4LongevityLedger.UnauthorizedFeeRecipient.selector);
        vm.prank(treasury);
        ledger.withdrawFees(address(first), 2);
        vm.expectRevert(RMTV4LongevityLedger.InvalidFeeBucket.selector);
        ledger.withdrawFees(address(first), 3);
        vm.chainId(1);
        vm.expectRevert(RMTV4LongevityLedger.FeeReleaseChainUnavailable.selector);
        vm.prank(creator);
        ledger.withdrawFees(address(first), 0);
        _assertBucket(address(first), 0, creator, 9, 33, 0, 0);
    }

    function testRoundingDustBecomesClaimableOnlyAsFurtherFeesAreCollected() public {
        ledger.commit(address(first), creator, _splitPolicy());
        ledger.settle{value: 2}(address(first), 3);
        _assertTotals(address(first), 2, 3, 2, 2);
        _assertBucket(address(first), 2, reserve, 0, 1, 0, 0);

        vm.prank(reserve);
        ledger.withdrawFees(address(first), 2);
        ledger.settle{value: 9_998}(address(first), 9_997);
        _assertTotals(address(first), 10_000, 10_000, 0, 0);
        _assertBucket(address(first), 0, creator, 3333, 3333, 0, 0);
        _assertBucket(address(first), 1, treasury, 3333, 3333, 0, 0);
        _assertBucket(address(first), 2, reserve, 3334, 3333, 0, 1);
    }

    function testBalanceDonationsAndOtherLaunchFeesCannotBeClaimed() public {
        ledger.commit(address(first), creator, _defaultPolicy());
        ledger.commit(address(second), reserve, _defaultPolicy());
        vm.deal(address(ledger), 13);
        first.transfer(address(ledger), 17);
        ledger.settle{value: 7}(address(first), 19);
        ledger.settle{value: 53}(address(second), 79);

        vm.expectRevert(RMTV4LongevityLedger.UnauthorizedFeeRecipient.selector);
        vm.prank(creator);
        ledger.withdrawFees(address(second), 0);
        vm.prank(creator);
        ledger.withdrawFees(address(first), 0);

        assertEq(address(ledger).balance, 13 + 53);
        assertEq(first.balanceOf(address(ledger)), 17);
        assertEq(second.balanceOf(address(ledger)), 79);
        _assertBucket(address(second), 0, reserve, 53, 79, 0, 0);
        vm.prank(reserve);
        ledger.withdrawFees(address(second), 0);
        assertEq(address(ledger).balance, 13);
        assertEq(second.balanceOf(address(ledger)), 0);
    }

    function testRejectingRecipientCannotBlockOtherBucketsOrFurtherCollections() public {
        RejectingLongevityRecipient rejected = new RejectingLongevityRecipient();
        ledger.commit(
            address(first), creator, RMTV4LongevityLedger.FeePolicy(address(rejected), reserve, 6000, 2500, 1500)
        );
        ledger.settle{value: 10_000}(address(first), 20_000);

        vm.expectRevert(RMTV4LongevityLedger.NativeFeeTransferFailed.selector);
        rejected.claim(ledger, address(first), 1);
        _assertBucket(address(first), 1, address(rejected), 2500, 5000, 0, 0);
        assertEq(first.balanceOf(address(rejected)), 0);

        ledger.settle{value: 10_000}(address(first), 20_000);
        vm.prank(reserve);
        ledger.withdrawFees(address(first), 2);
        _assertBucket(address(first), 2, reserve, 0, 0, 3000, 6000);
        _assertBucket(address(first), 1, address(rejected), 5000, 10_000, 0, 0);
    }

    function testReentrantRecipientCannotWithdrawAnotherLaunchDuringPayout() public {
        ReentrantLongevityRecipient recipient = new ReentrantLongevityRecipient(ledger, address(second));
        ledger.commit(address(first), address(recipient), _defaultPolicy());
        ledger.commit(address(second), address(recipient), _defaultPolicy());
        ledger.settle{value: 10}(address(first), 50);
        ledger.settle{value: 20}(address(second), 70);

        recipient.claim(address(first));
        assertTrue(recipient.nestedWithdrawalFailed());
        _assertBucket(address(first), 0, address(recipient), 0, 0, 10, 50);
        _assertBucket(address(second), 0, address(recipient), 20, 70, 0, 0);
        assertEq(address(ledger).balance, 20);
    }

    function testFuzzFragmentedCollectionsPreserveEntitlements(
        uint96 nativeOne,
        uint96 nativeTwo,
        uint96 tokenOne,
        uint96 tokenTwo
    ) public {
        ledger.commit(address(first), creator, _splitPolicy());
        ledger.commit(address(second), creator, _splitPolicy());
        ledger.settle{value: nativeOne}(address(first), tokenOne);
        ledger.settle{value: nativeTwo}(address(first), tokenTwo);
        ledger.settle{value: uint256(nativeOne) + nativeTwo}(address(second), uint256(tokenOne) + tokenTwo);

        for (uint8 bucket; bucket < 3; ++bucket) {
            (, uint256 nativeClaimable, uint256 tokenClaimable,,) = ledger.feeBucket(address(first), bucket);
            (, uint256 fullNative, uint256 fullToken,,) = ledger.feeBucket(address(second), bucket);
            assertEq(nativeClaimable, fullNative);
            assertEq(tokenClaimable, fullToken);
        }
        (,, uint256 nativeDust, uint256 tokenDust) = ledger.feeTotals(address(first));
        assertLe(nativeDust, 2);
        assertLe(tokenDust, 2);
    }

    function testFuzzInterleavedWithdrawalsConserveBothAssets(
        uint16 creatorSeed,
        uint16 treasurySeed,
        uint96 nativeOne,
        uint96 nativeTwo,
        uint96 tokenOne,
        uint96 tokenTwo
    ) public {
        uint16 creatorBps = uint16(bound(creatorSeed, 0, ALL_FEES));
        uint16 treasuryBps = uint16(bound(treasurySeed, 0, ALL_FEES - creatorBps));
        uint16 reserveBps = ALL_FEES - creatorBps - treasuryBps;
        ledger.commit(
            address(first),
            creator,
            RMTV4LongevityLedger.FeePolicy(
                treasuryBps == 0 ? address(0) : treasury,
                reserveBps == 0 ? address(0) : reserve,
                creatorBps,
                treasuryBps,
                reserveBps
            )
        );
        ledger.settle{value: nativeOne}(address(first), tokenOne);
        _withdrawAvailable(address(first), 2);
        _withdrawAvailable(address(first), 0);

        ledger.settle{value: nativeTwo}(address(first), tokenTwo);
        uint16[3] memory shares = [creatorBps, treasuryBps, reserveBps];
        (uint256 nativeTotal, uint256 tokenTotal, uint256 nativeDust, uint256 tokenDust) =
            ledger.feeTotals(address(first));
        assertEq(nativeTotal, uint256(nativeOne) + nativeTwo);
        assertEq(tokenTotal, uint256(tokenOne) + tokenTwo);
        for (uint8 bucket; bucket < shares.length; ++bucket) {
            _withdrawAvailable(address(first), bucket);
            (, uint256 nativePending, uint256 tokenPending, uint256 nativePaid, uint256 tokenPaid) =
                ledger.feeBucket(address(first), bucket);
            assertEq(nativePending, 0);
            assertEq(tokenPending, 0);
            assertEq(nativePaid, nativeTotal * shares[bucket] / ALL_FEES);
            assertEq(tokenPaid, tokenTotal * shares[bucket] / ALL_FEES);
        }
        assertEq(address(ledger).balance, nativeDust);
        assertEq(first.balanceOf(address(ledger)), tokenDust);
        assertLe(nativeDust, 2);
        assertLe(tokenDust, 2);
    }

    function _withdrawAvailable(address token, uint8 bucket) private {
        (address recipient, uint256 nativeClaimable, uint256 tokenClaimable,,) = ledger.feeBucket(token, bucket);
        if (nativeClaimable == 0 && tokenClaimable == 0) return;
        vm.prank(recipient);
        ledger.withdrawFees(token, bucket);
    }

    function _defaultPolicy() private pure returns (RMTV4LongevityLedger.FeePolicy memory) {
        return RMTV4LongevityLedger.FeePolicy(address(0), address(0), ALL_FEES, 0, 0);
    }

    function _splitPolicy() private view returns (RMTV4LongevityLedger.FeePolicy memory) {
        return RMTV4LongevityLedger.FeePolicy(treasury, reserve, 3333, 3333, 3334);
    }

    function _expectInvalid(address token, address recipient, RMTV4LongevityLedger.FeePolicy memory policy) private {
        vm.expectRevert(RMTV4LongevityLedger.InvalidFeePolicy.selector);
        ledger.commit(token, recipient, policy);
    }

    function _assertBucket(
        address token,
        uint8 bucket,
        address recipient,
        uint256 pendingNative,
        uint256 pendingToken,
        uint256 paidNative,
        uint256 paidToken
    ) private view {
        (
            address actual,
            uint256 claimableNative,
            uint256 claimableToken,
            uint256 distributedNative,
            uint256 distributedToken
        ) = ledger.feeBucket(token, bucket);
        assertEq(actual, recipient);
        assertEq(claimableNative, pendingNative);
        assertEq(claimableToken, pendingToken);
        assertEq(distributedNative, paidNative);
        assertEq(distributedToken, paidToken);
    }

    function _assertTotals(
        address token,
        uint256 nativeTotal,
        uint256 tokenTotal,
        uint256 nativeDust,
        uint256 tokenDust
    ) private view {
        (uint256 nativeAccrued, uint256 tokenAccrued, uint256 actualNativeDust, uint256 actualTokenDust) =
            ledger.feeTotals(token);
        assertEq(nativeAccrued, nativeTotal);
        assertEq(tokenAccrued, tokenTotal);
        assertEq(actualNativeDust, nativeDust);
        assertEq(actualTokenDust, tokenDust);
    }
}
