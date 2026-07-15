// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";
import {RMTV6Governance} from "../src/RMTV6Governance.sol";

interface SplitterVm {
    function deal(address account, uint256 balance) external;
    function prank(address caller) external;
    function warp(uint256 newTimestamp) external;
}

contract AcceptingRecipient {
    receive() external payable {}
}

contract RejectingRecipient {
    bool public accepts;

    function setAccepts(bool value) external {
        accepts = value;
    }

    receive() external payable {
        require(accepts, "reject");
    }

    function claim(DirectLaunchFeeSplitter splitter) external {
        splitter.claimDeferred();
    }

    function claimToken(DirectLaunchFeeSplitter splitter, address token) external {
        splitter.claimDeferredToken(token);
    }
}

contract SplitterTestToken {
    mapping(address account => uint256 amount) public balanceOf;
    address public rejectedRecipient;

    constructor(uint256 supply) {
        balanceOf[msg.sender] = supply;
    }

    function setRejectedRecipient(address recipient) external {
        rejectedRecipient = recipient;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (recipient == rejectedRecipient) return false;
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract SplitterFeeSource {
    receive() external payable {}

    function sendNative(DirectLaunchFeeSplitter splitter, uint256 amount) external {
        (bool success,) = address(splitter).call{value: amount}("");
        require(success, "splitter funding");
    }

    function depositNative(DirectLaunchFeeSplitter splitter, uint256 amount) external {
        splitter.deposit{value: amount}();
    }

    function depositToken(DirectLaunchFeeSplitter splitter, SplitterTestToken token, uint256 amount) external {
        require(token.transfer(address(splitter), amount), "splitter funding");
        splitter.depositToken(address(token), amount);
    }
}

contract ReenteringRecipient {
    DirectLaunchFeeSplitter public splitter;

    function configure(DirectLaunchFeeSplitter splitter_) external {
        splitter = splitter_;
    }

    receive() external payable {
        splitter.deposit{value: 1 wei}();
    }
}

contract GasBurningRecipient {
    receive() external payable {
        while (true) {}
    }
}

contract DirectLaunchFeeSplitterTest {
    SplitterVm private constant vm = SplitterVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    receive() external payable {}

    function testOnlyBoundMarketAndAdapterCanAccountProtocolFees() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        SplitterFeeSource market = new SplitterFeeSource();
        SplitterFeeSource adapter = new SplitterFeeSource();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(market),
            address(adapter)
        );

        address attacker = address(0xBAD);
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        (bool nativeGiftAccepted,) = address(splitter).call{value: 1 ether}("");
        require(!nativeGiftAccepted, "unauthorized native fee accounted");
        vm.prank(attacker);
        (bool nativeDepositAccepted,) = address(splitter).call{value: 1 ether}(abi.encodeCall(splitter.deposit, ()));
        require(!nativeDepositAccepted, "unauthorized native deposit accounted");
        require(splitter.totalReceived() == 0, "native fee total inflated");
        vm.deal(address(splitter), 1 wei); // Simulate native currency forced in without either fee source.
        require(splitter.totalReceived() == 0, "forced native balance inflated fees");

        require(token.transfer(address(splitter), 1 ether), "direct token gift");
        vm.prank(attacker);
        (bool tokenDepositAccepted,) =
            address(splitter).call(abi.encodeCall(splitter.depositToken, (address(token), 1 ether)));
        require(!tokenDepositAccepted, "unauthorized token fee accounted");
        require(splitter.totalTokenReceived(address(token)) == 0, "token fee total inflated");

        vm.deal(address(market), 1 ether);
        (bool rawMarketTransferAccepted,) = address(market).call(abi.encodeCall(market.sendNative, (splitter, 1 ether)));
        require(!rawMarketTransferAccepted, "market principal entered receive path");
        market.depositNative(splitter, 1 ether);
        require(splitter.totalReceived() == 1 ether, "market fee not accounted");
        require(address(splitter).balance == 1 wei, "forced native gift distributed");

        require(token.transfer(address(adapter), 100 ether), "adapter token funding");
        adapter.depositToken(splitter, token, 100 ether);
        require(splitter.totalTokenReceived(address(token)) == 100 ether, "adapter token fee not accounted");
        require(token.balanceOf(address(splitter)) == 1 ether, "unaccounted token gift moved");
    }

    function testCollectionTimeRedirectBoundaryRoutesHeldFeesToGovernedRecipient() public {
        AcceptingRecipient originalCreator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        SplitterFeeSource market = new SplitterFeeSource();
        SplitterFeeSource adapter = new SplitterFeeSource();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(originalCreator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(market),
            address(adapter)
        );

        // Simulate post-graduation fees that have accrued to, but have not yet been collected from, the adapter.
        vm.deal(address(adapter), 1 ether);
        require(token.transfer(address(adapter), 100 ether), "held token fees");
        require(splitter.totalReceived() == 0, "held native fees counted early");
        require(splitter.totalTokenReceived(address(token)) == 0, "held token fees counted early");

        splitter.setCreatorWallet(payable(address(treasury)), keccak256("collection-boundary-evidence"), 0);
        adapter.depositNative(splitter, 1 ether);
        adapter.depositToken(splitter, token, 100 ether);

        require(address(originalCreator).balance == 0, "old creator received post-redirect collection");
        require(token.balanceOf(address(originalCreator)) == 0, "old creator received collected tokens");
        require(address(treasury).balance == 1 ether, "treasury native collection");
        require(token.balanceOf(address(treasury)) == 100 ether, "treasury token collection");
    }

    function testInitializationRejectsNonContractFeeSources() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(1 ether);
        SplitterFeeSource validSource = new SplitterFeeSource();

        DirectLaunchFeeSplitter badMarketSplitter = new DirectLaunchFeeSplitter();
        (bool badMarketAccepted,) = address(badMarketSplitter)
            .call(
                abi.encodeCall(
                    badMarketSplitter.initialize,
                    (
                        payable(address(creator)),
                        payable(address(treasury)),
                        address(token),
                        7_000,
                        address(this),
                        address(0xCAFE),
                        address(validSource)
                    )
                )
            );
        require(!badMarketAccepted, "non-contract market source accepted");

        DirectLaunchFeeSplitter badAdapterSplitter = new DirectLaunchFeeSplitter();
        (bool badAdapterAccepted,) = address(badAdapterSplitter)
            .call(
                abi.encodeCall(
                    badAdapterSplitter.initialize,
                    (
                        payable(address(creator)),
                        payable(address(treasury)),
                        address(token),
                        7_000,
                        address(this),
                        address(validSource),
                        address(0xBEEF)
                    )
                )
            );
        require(!badAdapterAccepted, "non-contract adapter source accepted");
    }

    function testPaysCreatorAndProtocolDirectly() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();

        require(address(creator).balance == 0.7 ether, "creator split");
        require(address(treasury).balance == 0.3 ether, "protocol split");
        require(address(splitter).balance == 0, "no retained balance");
        require(splitter.totalReceived() == 1 ether, "received accounting");
        require(splitter.totalPaid() == 1 ether, "paid accounting");
    }

    function testZeroValueDepositsCannotChangeAccounting() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(1 ether);
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        (bool nativeSuccess,) = address(splitter).call(abi.encodeCall(splitter.deposit, ()));
        (bool tokenSuccess,) = address(splitter).call(abi.encodeCall(splitter.depositToken, (address(token), 0)));

        require(!nativeSuccess && !tokenSuccess, "zero fee deposit accepted");
        require(splitter.totalReceived() == 0 && splitter.totalPaid() == 0, "zero native accounting changed");
        require(
            splitter.totalTokenReceived(address(token)) == 0 && splitter.totalTokenPaid(address(token)) == 0,
            "zero token accounting changed"
        );
    }

    function testProtocolPaymentFailuresRemainClaimableOnlyByTreasury() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        RejectingRecipient treasury = new RejectingRecipient();
        SplitterTestToken token = new SplitterTestToken(100 ether);
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(this)
        );
        token.setRejectedRecipient(address(treasury));

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();
        require(token.transfer(address(splitter), 100 ether), "fund protocol token test");
        splitter.depositToken(address(token), 100 ether);

        require(address(creator).balance == 0.7 ether, "creator native payment blocked");
        require(token.balanceOf(address(creator)) == 70 ether, "creator token payment blocked");
        require(splitter.pending(address(treasury)) == 0.3 ether, "protocol native not deferred");
        require(splitter.pendingToken(address(token), address(treasury)) == 30 ether, "protocol token not deferred");
        (bool outsiderNativeClaim,) = address(splitter).call(abi.encodeCall(splitter.claimDeferred, ()));
        (bool outsiderTokenClaim,) =
            address(splitter).call(abi.encodeCall(splitter.claimDeferredToken, (address(token))));
        require(!outsiderNativeClaim && !outsiderTokenClaim, "outsider claimed protocol fees");

        treasury.setAccepts(true);
        token.setRejectedRecipient(address(0));
        treasury.claim(splitter);
        treasury.claimToken(splitter, address(token));

        require(address(treasury).balance == 0.3 ether, "protocol native recovery");
        require(token.balanceOf(address(treasury)) == 30 ether, "protocol token recovery");
        require(splitter.pending(address(treasury)) == 0, "protocol native pending not cleared");
        require(splitter.pendingToken(address(token), address(treasury)) == 0, "protocol token pending not cleared");
    }

    function testCoincidentRecipientsStillConserveAccounting() public {
        AcceptingRecipient recipient = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(100 ether);
        SplitterFeeSource adapter = new SplitterFeeSource();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(recipient)),
            payable(address(recipient)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(adapter)
        );

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();
        require(token.transfer(address(adapter), 100 ether), "fund official token fees");
        adapter.depositToken(splitter, token, 100 ether);

        require(address(recipient).balance == 1 ether, "native aggregate");
        require(token.balanceOf(address(recipient)) == 100 ether, "token aggregate");
        require(splitter.totalReceived() == 1 ether && splitter.totalPaid() == 1 ether, "native double accounting");
        require(
            splitter.totalTokenReceived(address(token)) == 100 ether
                && splitter.totalTokenPaid(address(token)) == 100 ether,
            "token double accounting"
        );
    }

    function testTinyNativeDepositsPreserveCumulativeSeventyThirtySplit() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterFeeSource market = new SplitterFeeSource();
        SplitterFeeSource adapter = new SplitterFeeSource();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(market),
            address(adapter)
        );

        vm.deal(address(market), 10 wei);
        for (uint256 i; i < 10; ++i) {
            market.depositNative(splitter, 1 wei);
        }

        require(address(creator).balance == 7 wei, "tiny native creator split");
        require(address(treasury).balance == 3 wei, "tiny native protocol split");
        require(splitter.totalReceived() == 10 wei, "tiny native received");
        require(splitter.totalPaid() == 10 wei, "tiny native paid");
        require(splitter.nativeCreatorShareRemainder(address(creator)) == 0, "native carry not settled");
    }

    function testTinyTokenDepositsPreserveCumulativeSeventyThirtySplit() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(10);
        SplitterFeeSource market = new SplitterFeeSource();
        SplitterFeeSource adapter = new SplitterFeeSource();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(market),
            address(adapter)
        );

        require(token.transfer(address(adapter), 10), "fund token fee source");
        for (uint256 i; i < 10; ++i) {
            adapter.depositToken(splitter, token, 1);
        }

        require(token.balanceOf(address(creator)) == 7, "tiny token creator split");
        require(token.balanceOf(address(treasury)) == 3, "tiny token protocol split");
        require(splitter.totalTokenReceived(address(token)) == 10, "tiny token received");
        require(splitter.totalTokenPaid(address(token)) == 10, "tiny token paid");
        require(splitter.tokenCreatorShareRemainder(address(token), address(creator)) == 0, "token carry not settled");
    }

    function testRedirectKeepsNativeAndTokenRoundingCarryWithTheEarningRecipient() public {
        AcceptingRecipient originalCreator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(11);
        SplitterFeeSource market = new SplitterFeeSource();
        SplitterFeeSource adapter = new SplitterFeeSource();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(originalCreator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(market),
            address(adapter)
        );
        vm.deal(address(market), 11 wei);
        require(token.transfer(address(adapter), 11), "fund redirect token fees");

        market.depositNative(splitter, 1 wei);
        adapter.depositToken(splitter, token, 1);
        require(splitter.nativeCreatorShareRemainder(address(originalCreator)) == 7_000, "original native carry");
        require(
            splitter.tokenCreatorShareRemainder(address(token), address(originalCreator)) == 7_000,
            "original token carry"
        );

        splitter.setCreatorWallet(payable(address(treasury)), keccak256("rounding-carry-redirect"), 0);
        market.depositNative(splitter, 1 wei);
        adapter.depositToken(splitter, token, 1);
        require(splitter.nativeCreatorShareRemainder(address(treasury)) == 7_000, "treasury native carry");
        require(splitter.tokenCreatorShareRemainder(address(token), address(treasury)) == 7_000, "treasury token carry");

        splitter.setCreatorWallet(payable(address(originalCreator)), keccak256("rounding-carry-restore"), 1);
        market.depositNative(splitter, 9 wei);
        adapter.depositToken(splitter, token, 9);

        require(address(originalCreator).balance == 7 wei, "restored native creator split");
        require(token.balanceOf(address(originalCreator)) == 7, "restored token creator split");
        require(address(treasury).balance == 4 wei, "redirect native protocol conservation");
        require(token.balanceOf(address(treasury)) == 4, "redirect token protocol conservation");
        require(splitter.totalReceived() == 11 wei && splitter.totalPaid() == 11 wei, "native conservation");
        require(
            splitter.totalTokenReceived(address(token)) == 11 && splitter.totalTokenPaid(address(token)) == 11,
            "token conservation"
        );
        require(splitter.nativeCreatorShareRemainder(address(originalCreator)) == 0, "original native carry settled");
        require(
            splitter.tokenCreatorShareRemainder(address(token), address(originalCreator)) == 0,
            "original token carry settled"
        );
        require(splitter.nativeCreatorShareRemainder(address(treasury)) == 7_000, "treasury native carry changed");
        require(
            splitter.tokenCreatorShareRemainder(address(token), address(treasury)) == 7_000,
            "treasury token carry changed"
        );
    }

    function testV6GovernanceControlsTreasuryAndOnlyFutureCreatorFeeRouting() public {
        AcceptingRecipient originalCreator = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        SplitterFeeSource market = new SplitterFeeSource();
        SplitterFeeSource adapter = new SplitterFeeSource();
        RMTV6Governance governance = new RMTV6Governance(address(this), 1 days, 7 days);
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(originalCreator)),
            payable(address(governance)),
            address(token),
            7_000,
            address(governance),
            address(market),
            address(adapter)
        );
        require(splitter.originalCreator() == address(originalCreator), "original creator");
        require(splitter.creatorPayoutAuthority() == address(governance), "payout authority");
        require(splitter.protocolTreasury() == address(governance), "governance treasury");

        vm.deal(address(market), 3 ether);
        require(token.transfer(address(adapter), 300 ether), "fund token fee source");
        market.depositNative(splitter, 1 ether);
        adapter.depositToken(splitter, token, 100 ether);
        require(address(originalCreator).balance == 0.7 ether, "initial creator native share");
        require(token.balanceOf(address(originalCreator)) == 70 ether, "initial creator token share");
        require(address(governance).balance == 0.3 ether, "initial protocol native share");
        require(token.balanceOf(address(governance)) == 30 ether, "initial protocol token share");

        vm.prank(address(originalCreator));
        (bool creatorChange,) = address(splitter)
            .call(
                abi.encodeCall(
                    splitter.setCreatorWallet, (payable(address(governance)), keccak256("documented-rug-evidence"), 0)
                )
            );
        require(!creatorChange, "creator changed payout recipient");

        vm.prank(address(0xBEEF));
        (bool outsiderChange,) = address(splitter)
            .call(
                abi.encodeCall(
                    splitter.setCreatorWallet, (payable(address(governance)), keccak256("documented-rug-evidence"), 0)
                )
            );
        require(!outsiderChange, "outsider changed payout recipient");

        bytes32 evidenceHash = keccak256("documented-rug-evidence");
        bytes memory changeCall =
            abi.encodeCall(splitter.setCreatorWallet, (payable(address(governance)), evidenceHash, 0));
        uint256 proposalId = governance.propose(address(splitter), 0, changeCall);
        (bool earlyExecution,) = address(governance).call(abi.encodeCall(governance.execute, (proposalId)));
        require(!earlyExecution, "governance delay bypassed");
        vm.warp(block.timestamp + governance.executionDelay());
        address executor = address(0xBEEF);
        uint256 executorNativeBefore = executor.balance;
        vm.prank(executor);
        governance.execute(proposalId);
        require(executor.balance == executorNativeBefore, "executor received redirect value");
        require(splitter.creator() == address(governance), "governance redirect not executed");
        require(splitter.originalCreator() == address(originalCreator), "original creator changed");
        require(splitter.creatorPayoutNonce() == 1, "redirect nonce not consumed");

        vm.prank(address(originalCreator));
        (bool creatorRestore,) = address(splitter)
            .call(
                abi.encodeCall(
                    splitter.setCreatorWallet,
                    (payable(address(originalCreator)), keccak256("unauthorized-creator-restoration"), 1)
                )
            );
        require(!creatorRestore, "original creator restored its own payout");

        market.depositNative(splitter, 1 ether);
        adapter.depositToken(splitter, token, 100 ether);
        require(address(originalCreator).balance == 0.7 ether, "old creator received future native fees");
        require(token.balanceOf(address(originalCreator)) == 70 ether, "old creator received future token fees");
        require(address(governance).balance == 1.3 ether, "RMT did not receive redirected native fees");
        require(token.balanceOf(address(governance)) == 130 ether, "RMT did not receive redirected token fees");

        uint256 operatorNativeBefore = address(this).balance;
        uint256 operatorTokenBefore = token.balanceOf(address(this));
        uint256 nativeTransferId = governance.propose(address(this), address(governance).balance, "");
        uint256 tokenTransferId = governance.propose(
            address(token), 0, abi.encodeCall(token.transfer, (address(this), token.balanceOf(address(governance))))
        );
        vm.warp(block.timestamp + governance.executionDelay());
        vm.prank(executor);
        governance.execute(nativeTransferId);
        vm.prank(executor);
        governance.execute(tokenTransferId);
        require(address(this).balance - operatorNativeBefore == 1.3 ether, "governance native treasury transfer");
        require(token.balanceOf(address(this)) - operatorTokenBefore == 130 ether, "governance token treasury transfer");
        require(executor.balance == executorNativeBefore, "executor received treasury funds");
        require(address(governance).balance == 0, "governance native treasury not cleared");
        require(token.balanceOf(address(governance)) == 0, "governance token treasury not cleared");

        bytes memory restoreCall = abi.encodeCall(
            splitter.setCreatorWallet,
            (payable(address(originalCreator)), keccak256("documented-creator-restoration"), 1)
        );
        uint256 restoreProposalId = governance.propose(address(splitter), 0, restoreCall);
        vm.warp(block.timestamp + governance.executionDelay());
        vm.prank(executor);
        governance.execute(restoreProposalId);
        require(splitter.creator() == address(originalCreator), "original creator not restored");
        require(splitter.creatorPayoutNonce() == 2, "restore nonce not consumed");

        market.depositNative(splitter, 1 ether);
        adapter.depositToken(splitter, token, 100 ether);
        require(address(originalCreator).balance == 1.4 ether, "restored creator native fee share");
        require(token.balanceOf(address(originalCreator)) == 140 ether, "restored creator token fee share");
        require(address(governance).balance == 0.3 ether, "treasury native split after restoration");
        require(token.balanceOf(address(governance)) == 30 ether, "treasury token split after restoration");
    }

    function testGovernanceCannotRedirectCreatorShareToUnrelatedWallet() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        (bool unrelatedSuccess,) = address(splitter)
            .call(
                abi.encodeCall(
                    splitter.setCreatorWallet, (payable(address(0xCAFE)), keccak256("not-an-allowed-destination"), 0)
                )
            );
        require(!unrelatedSuccess, "governance redirected to unrelated wallet");

        (bool noEvidenceSuccess,) = address(splitter)
            .call(abi.encodeCall(splitter.setCreatorWallet, (payable(address(treasury)), bytes32(0), 0)));
        require(!noEvidenceSuccess, "governance omitted public evidence hash");
    }

    function testTreasuryCanInvalidateUnexecutedGovernancePayoutChange() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        vm.prank(address(creator));
        (bool creatorInvalidated,) = address(splitter).call(abi.encodeCall(splitter.invalidateCreatorPayoutNonce, (0)));
        require(!creatorInvalidated, "creator invalidated governance nonce");

        vm.prank(address(treasury));
        splitter.invalidateCreatorPayoutNonce(0);
        require(splitter.creatorPayoutNonce() == 1, "treasury invalidation missing");

        (bool staleChangeExecuted,) = address(splitter)
            .call(
                abi.encodeCall(
                    splitter.setCreatorWallet, (payable(address(treasury)), keccak256("cancelled-evidence"), 0)
                )
            );
        require(!staleChangeExecuted, "invalidated payout change executed");
        require(splitter.creator() == address(creator), "invalidation changed creator payout");
    }

    function testAuthorityChangeDoesNotMovePreviouslyDeferredFunds() public {
        RejectingRecipient originalCreator = new RejectingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(originalCreator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();
        require(splitter.pending(address(originalCreator)) == 0.7 ether, "original deferred balance");

        splitter.setCreatorWallet(payable(address(treasury)), keccak256("deferred-funds-test"), 0);
        require(splitter.pending(address(originalCreator)) == 0.7 ether, "deferred balance moved");
        require(splitter.pending(address(treasury)) == 0, "treasury inherited old balance");
    }

    function testAuthorityChangeDoesNotMovePreviouslyDeferredTokenFunds() public {
        RejectingRecipient originalCreator = new RejectingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(originalCreator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(this)
        );
        token.setRejectedRecipient(address(originalCreator));

        require(token.transfer(address(splitter), 100 ether), "fund splitter");
        splitter.depositToken(address(token), 100 ether);
        require(
            splitter.pendingToken(address(token), address(originalCreator)) == 70 ether,
            "original deferred token balance"
        );

        splitter.setCreatorWallet(payable(address(treasury)), keccak256("deferred-token-funds-test"), 0);
        require(
            splitter.pendingToken(address(token), address(originalCreator)) == 70 ether, "deferred token balance moved"
        );
        require(splitter.pendingToken(address(token), address(treasury)) == 0, "treasury inherited old deferred tokens");

        require(token.transfer(address(splitter), 100 ether), "fund post-redirect token fees");
        splitter.depositToken(address(token), 100 ether);
        require(token.balanceOf(address(treasury)) == 130 ether, "future token fees not redirected to RMT");
        require(
            splitter.pendingToken(address(token), address(originalCreator)) == 70 ether,
            "future collection changed old deferred tokens"
        );
    }

    function testCreatorPaymentFailureDoesNotBlockProtocolPayment() public {
        RejectingRecipient creator = new RejectingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();

        require(splitter.pending(address(creator)) == 0.7 ether, "creator pending");
        require(address(treasury).balance == 0.3 ether, "protocol still paid");
        require(address(splitter).balance == 0.7 ether, "only deferred funds retained");

        creator.setAccepts(true);
        creator.claim(splitter);
        require(address(creator).balance == 0.7 ether, "creator recovered");
        require(splitter.pending(address(creator)) == 0, "pending cleared");
        require(address(splitter).balance == 0, "splitter cleared");
    }

    function testOnlyRecipientCanClaimItsDeferredPayment() public {
        RejectingRecipient creator = new RejectingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();

        (bool success,) = address(splitter).call(abi.encodeCall(splitter.claimDeferred, ()));
        require(!success, "outsider claimed creator funds");
        require(splitter.pending(address(creator)) == 0.7 ether, "creator funds changed");
    }

    function testReentrantRecipientIsDeferredWithoutBlockingProtocolPayment() public {
        ReenteringRecipient creator = new ReenteringRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );
        creator.configure(splitter);

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();

        require(splitter.pending(address(creator)) == 0.7 ether, "reentrant creator not deferred");
        require(address(treasury).balance == 0.3 ether, "protocol payment blocked");
        require(splitter.totalReceived() == 1 ether, "reentrant deposit counted");
        require(splitter.totalPaid() == 0.3 ether, "paid accounting changed");
    }

    function testGasBurningCreatorIsDeferredWithoutBlockingProtocolPayment() public {
        GasBurningRecipient creator = new GasBurningRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(new SplitterTestToken(1)),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();

        require(splitter.pending(address(creator)) == 0.7 ether, "gas-burning creator not deferred");
        require(address(treasury).balance == 0.3 ether, "protocol payment blocked");
        require(splitter.totalReceived() == 1 ether, "received accounting changed");
        require(splitter.totalPaid() == 0.3 ether, "paid accounting changed");
        require(
            splitter.totalReceived() == splitter.totalPaid() + splitter.pending(address(creator)),
            "native accounting invariant"
        );
    }

    function testPaysCreatorAndProtocolTokenFeesDirectly() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(this)
        );

        require(token.transfer(address(splitter), 100 ether), "fund splitter");
        splitter.depositToken(address(token), 100 ether);

        require(token.balanceOf(address(creator)) == 70 ether, "creator token split");
        require(token.balanceOf(address(treasury)) == 30 ether, "protocol token split");
        require(token.balanceOf(address(splitter)) == 0, "token residue");
        require(splitter.totalTokenReceived(address(token)) == 100 ether, "token received accounting");
        require(splitter.totalTokenPaid(address(token)) == 100 ether, "token paid accounting");

        SplitterTestToken unrelatedToken = new SplitterTestToken(1 ether);
        require(unrelatedToken.transfer(address(splitter), 1 ether), "fund unrelated token");
        (bool unrelatedSuccess,) =
            address(splitter).call(abi.encodeCall(splitter.depositToken, (address(unrelatedToken), 1 ether)));
        require(!unrelatedSuccess, "unrelated token distributed");
    }

    function testDeferredTokenPaymentIsRecipientClaimableAndCannotBeDoubleAccounted() public {
        RejectingRecipient creator = new RejectingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        splitter.initialize(
            payable(address(creator)),
            payable(address(treasury)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(this)
        );
        token.setRejectedRecipient(address(creator));

        require(token.transfer(address(splitter), 100 ether), "fund splitter");
        splitter.depositToken(address(token), 100 ether);

        require(splitter.pendingToken(address(token), address(creator)) == 70 ether, "creator token pending");
        require(token.balanceOf(address(treasury)) == 30 ether, "protocol token payment");
        (bool duplicateSuccess,) =
            address(splitter).call(abi.encodeCall(splitter.depositToken, (address(token), 70 ether)));
        require(!duplicateSuccess, "pending tokens double accounted");

        token.setRejectedRecipient(address(0));
        creator.claimToken(splitter, address(token));
        require(token.balanceOf(address(creator)) == 70 ether, "creator token recovery");
        require(splitter.pendingToken(address(token), address(creator)) == 0, "token pending not cleared");
        require(splitter.totalTokenPaid(address(token)) == 100 ether, "token accounting not conserved");
        require(
            splitter.totalTokenReceived(address(token))
                == splitter.totalTokenPaid(address(token)) + splitter.pendingToken(address(token), address(creator)),
            "token accounting invariant"
        );
    }
}
