// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";

interface SplitterVm {
    function deal(address account, uint256 balance) external;
    function prank(address caller) external;
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

contract ReenteringRecipient {
    DirectLaunchFeeSplitter public splitter;

    function configure(DirectLaunchFeeSplitter splitter_) external {
        splitter = splitter_;
    }

    receive() external payable {
        splitter.deposit{value: 1 wei}();
    }
}

contract DirectLaunchFeeSplitterTest {
    SplitterVm private constant vm = SplitterVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    receive() external payable {}

    function testPaysCreatorAndProtocolDirectly() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)), payable(address(treasury)), address(new SplitterTestToken(1)), 7_000
        );

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();

        require(address(creator).balance == 0.7 ether, "creator split");
        require(address(treasury).balance == 0.3 ether, "protocol split");
        require(address(splitter).balance == 0, "no retained balance");
        require(splitter.totalReceived() == 1 ether, "received accounting");
        require(splitter.totalPaid() == 1 ether, "paid accounting");
    }

    function testCreatorPaymentFailureDoesNotBlockProtocolPayment() public {
        RejectingRecipient creator = new RejectingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)), payable(address(treasury)), address(new SplitterTestToken(1)), 7_000
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
            payable(address(creator)), payable(address(treasury)), address(new SplitterTestToken(1)), 7_000
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
            payable(address(creator)), payable(address(treasury)), address(new SplitterTestToken(1)), 7_000
        );
        creator.configure(splitter);

        vm.deal(address(this), 1 ether);
        splitter.deposit{value: 1 ether}();

        require(splitter.pending(address(creator)) == 0.7 ether, "reentrant creator not deferred");
        require(address(treasury).balance == 0.3 ether, "protocol payment blocked");
        require(splitter.totalReceived() == 1 ether, "reentrant deposit counted");
        require(splitter.totalPaid() == 0.3 ether, "paid accounting changed");
    }

    function testPaysCreatorAndProtocolTokenFeesDirectly() public {
        AcceptingRecipient creator = new AcceptingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        splitter.initialize(payable(address(creator)), payable(address(treasury)), address(token), 7_000);

        require(token.transfer(address(splitter), 100 ether), "fund splitter");
        splitter.depositToken(address(token), 100 ether);

        require(token.balanceOf(address(creator)) == 70 ether, "creator token split");
        require(token.balanceOf(address(treasury)) == 30 ether, "protocol token split");
        require(token.balanceOf(address(splitter)) == 0, "token residue");
        require(splitter.totalTokenReceived(address(token)) == 100 ether, "token received accounting");
        require(splitter.totalTokenPaid(address(token)) == 100 ether, "token paid accounting");

        SplitterTestToken unrelatedToken = new SplitterTestToken(1 ether);
        require(unrelatedToken.transfer(address(splitter), 1 ether), "fund unrelated token");
        (bool unrelatedSuccess,) = address(splitter).call(
            abi.encodeCall(splitter.depositToken, (address(unrelatedToken), 1 ether))
        );
        require(!unrelatedSuccess, "unrelated token distributed");
    }

    function testDeferredTokenPaymentIsRecipientClaimableAndCannotBeDoubleAccounted() public {
        RejectingRecipient creator = new RejectingRecipient();
        AcceptingRecipient treasury = new AcceptingRecipient();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        SplitterTestToken token = new SplitterTestToken(1_000 ether);
        splitter.initialize(payable(address(creator)), payable(address(treasury)), address(token), 7_000);
        token.setRejectedRecipient(address(creator));

        require(token.transfer(address(splitter), 100 ether), "fund splitter");
        splitter.depositToken(address(token), 100 ether);

        require(splitter.pendingToken(address(token), address(creator)) == 70 ether, "creator token pending");
        require(token.balanceOf(address(treasury)) == 30 ether, "protocol token payment");
        (bool duplicateSuccess,) = address(splitter).call(
            abi.encodeCall(splitter.depositToken, (address(token), 70 ether))
        );
        require(!duplicateSuccess, "pending tokens double accounted");

        token.setRejectedRecipient(address(0));
        creator.claimToken(splitter, address(token));
        require(token.balanceOf(address(creator)) == 70 ether, "creator token recovery");
        require(splitter.pendingToken(address(token), address(creator)) == 0, "token pending not cleared");
        require(splitter.totalTokenPaid(address(token)) == 100 ether, "token accounting not conserved");
    }
}
