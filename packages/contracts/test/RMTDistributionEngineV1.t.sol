// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IRMTDistributionEngineV1} from "../src/interfaces/IRMTDistributionEngineV1.sol";
import {RMTDistributionEngineV1} from "../src/RMTDistributionEngineV1.sol";
import {RMTRetirementSinkV1} from "../src/RMTRetirementSinkV1.sol";
import {
    DistributionAcceptingReceiver,
    DistributionERC20Mock,
    DistributionERC721Mock,
    DistributionERC1155Mock,
    DistributionNoReturnERC20Mock,
    DistributionRejectingReceiver
} from "./mocks/RMTDistributionEngineV1Mocks.sol";

contract RMTDistributionEngineV1Test is Test {
    uint256 private constant CHAIN_ID = 4_663;
    uint256 private constant ERC20_COST = 1 ether;
    uint256 private constant ERC721_COST = 2 ether;
    uint256 private constant ERC1155_COST = 3 ether;
    address private constant TRADER = address(0xA11CE);
    address private constant SECOND_TRADER = address(0xB0B);
    address private constant RECIPIENT_1 = address(0x1111);
    address private constant RECIPIENT_2 = address(0x2222);
    bytes32 private constant DISTRIBUTION_ID = keccak256("distribution-1");

    DistributionERC20Mock private rmt;
    DistributionERC20Mock private token;
    DistributionERC721Mock private nft;
    DistributionERC1155Mock private edition;
    RMTRetirementSinkV1 private sink;
    RMTDistributionEngineV1 private engine;

    event DistributionExecuted(
        bytes32 indexed executionKey,
        address indexed sender,
        address indexed asset,
        bytes32 distributionId,
        IRMTDistributionEngineV1.ActionKind actionKind,
        uint256 recipientCount,
        uint256 totalAssetAmount,
        uint256 rmtRetired,
        address retirementSink,
        bytes32 batchHash
    );

    function setUp() external {
        vm.chainId(CHAIN_ID);
        rmt = new DistributionERC20Mock();
        token = new DistributionERC20Mock();
        nft = new DistributionERC721Mock();
        edition = new DistributionERC1155Mock();
        sink = new RMTRetirementSinkV1();
        engine = new RMTDistributionEngineV1(address(rmt), address(sink), ERC20_COST, ERC721_COST, ERC1155_COST);
        rmt.mint(TRADER, 1_000 ether);
        rmt.mint(SECOND_TRADER, 1_000 ether);
        token.mint(TRADER, 1_000 ether);
        token.mint(SECOND_TRADER, 1_000 ether);
    }

    function testConstructionBindsExactImmutableConfiguration() external view {
        assertEq(engine.CHAIN_ID(), CHAIN_ID);
        assertEq(engine.rmtToken(), address(rmt));
        assertEq(engine.retirementSink(), address(sink));
        assertEq(engine.rmtTokenRuntimeHash(), address(rmt).codehash);
        assertEq(engine.retirementSinkRuntimeHash(), address(sink).codehash);
        assertEq(engine.erc20CostPerRecipient(), ERC20_COST);
        assertEq(engine.erc721CostPerRecipient(), ERC721_COST);
        assertEq(engine.erc1155CostPerRecipient(), ERC1155_COST);
        assertEq(engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, 2), 2 * ERC20_COST);
        assertEq(engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_CUSTOM, 2), 2 * ERC20_COST);
        assertEq(engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC721, 2), 2 * ERC721_COST);
        assertEq(engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC1155, 2), 2 * ERC1155_COST);
    }

    function testConstructionRejectsWrongChainAndInvalidConfiguration() external {
        vm.chainId(1);
        vm.expectRevert(RMTDistributionEngineV1.InvalidConfiguration.selector);
        new RMTDistributionEngineV1(address(rmt), address(sink), ERC20_COST, ERC721_COST, ERC1155_COST);

        vm.chainId(CHAIN_ID);
        vm.expectRevert(RMTDistributionEngineV1.InvalidConfiguration.selector);
        new RMTDistributionEngineV1(address(0), address(sink), ERC20_COST, ERC721_COST, ERC1155_COST);
        vm.expectRevert(RMTDistributionEngineV1.InvalidConfiguration.selector);
        new RMTDistributionEngineV1(address(rmt), address(0x1234), ERC20_COST, ERC721_COST, ERC1155_COST);
        DistributionAcceptingReceiver wrongSink = new DistributionAcceptingReceiver();
        vm.expectRevert(RMTDistributionEngineV1.InvalidConfiguration.selector);
        new RMTDistributionEngineV1(address(rmt), address(wrongSink), ERC20_COST, ERC721_COST, ERC1155_COST);
        vm.expectRevert(RMTDistributionEngineV1.InvalidConfiguration.selector);
        new RMTDistributionEngineV1(address(rmt), address(sink), 0, ERC721_COST, ERC1155_COST);
    }

    function testQuoteRejectsZeroRecipients() external {
        vm.expectRevert(RMTDistributionEngineV1.EmptyDistribution.selector);
        engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, 0);
    }

    function testERC20EqualRetiresExactRmtAndEmitsCanonicalReceipt() external {
        address[] memory recipients = _twoRecipients();
        uint256 amount = 5 ether;
        uint256 utilityCost = 2 * ERC20_COST;
        _approveERC20(TRADER, token, 2 * amount);
        _approveERC20(TRADER, rmt, utilityCost);

        bytes32 executionKey = engine.getExecutionKey(TRADER, DISTRIBUTION_ID);
        bytes32 batchHash = engine.hashERC20EqualBatch(address(token), recipients, amount);
        vm.expectEmit(true, true, true, true, address(engine));
        emit DistributionExecuted(
            executionKey,
            TRADER,
            address(token),
            DISTRIBUTION_ID,
            IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL,
            2,
            2 * amount,
            utilityCost,
            address(sink),
            batchHash
        );

        vm.prank(TRADER);
        (bytes32 returnedKey, bytes32 returnedHash, uint256 total, uint256 retired) =
            engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), recipients, amount);

        assertEq(returnedKey, executionKey);
        assertEq(returnedHash, batchHash);
        assertEq(total, 2 * amount);
        assertEq(retired, utilityCost);
        assertEq(token.balanceOf(RECIPIENT_1), amount);
        assertEq(token.balanceOf(RECIPIENT_2), amount);
        assertEq(rmt.balanceOf(address(sink)), utilityCost);
        assertEq(token.balanceOf(address(engine)), 0);
        assertEq(rmt.balanceOf(address(engine)), 0);
        assertTrue(engine.executionConsumed(executionKey));
    }

    function testERC20CustomSupportsDuplicateRecipientWithExactDeltas() external {
        address[] memory recipients = new address[](2);
        recipients[0] = RECIPIENT_1;
        recipients[1] = RECIPIENT_1;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 3 ether;
        amounts[1] = 7 ether;
        _approveERC20(TRADER, token, 10 ether);
        _approveERC20(TRADER, rmt, 2 * ERC20_COST);

        vm.prank(TRADER);
        (,, uint256 total,) = engine.airdropERC20(DISTRIBUTION_ID, address(token), recipients, amounts);

        assertEq(total, 10 ether);
        assertEq(token.balanceOf(RECIPIENT_1), 10 ether);
        assertEq(rmt.balanceOf(address(sink)), 2 * ERC20_COST);
    }

    function testERC20DistributionCanUseRmtAsAssetWithoutFeeExemption() external {
        address[] memory recipients = _twoRecipients();
        uint256 amount = 5 ether;
        uint256 utilityCost = 2 * ERC20_COST;
        _approveERC20(TRADER, rmt, 2 * amount + utilityCost);
        uint256 senderBefore = rmt.balanceOf(TRADER);

        vm.prank(TRADER);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(rmt), recipients, amount);

        assertEq(rmt.balanceOf(TRADER), senderBefore - 2 * amount - utilityCost);
        assertEq(rmt.balanceOf(RECIPIENT_1), amount);
        assertEq(rmt.balanceOf(RECIPIENT_2), amount);
        assertEq(rmt.balanceOf(address(sink)), utilityCost);
        assertEq(rmt.balanceOf(address(engine)), 0);
    }

    function testERC20SupportsStandardNoReturnToken() external {
        DistributionNoReturnERC20Mock noReturn = new DistributionNoReturnERC20Mock();
        noReturn.mint(TRADER, 20 ether);
        vm.prank(TRADER);
        noReturn.approve(address(engine), 20 ether);
        _approveERC20(TRADER, rmt, 2 * ERC20_COST);

        vm.prank(TRADER);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(noReturn), _twoRecipients(), 10 ether);

        assertEq(noReturn.balanceOf(RECIPIENT_1), 10 ether);
        assertEq(noReturn.balanceOf(RECIPIENT_2), 10 ether);
    }

    function testERC20RejectsFalseReturnFeeOnTransferAndOverDebit() external {
        address[] memory recipients = _oneRecipient();
        _approveERC20(TRADER, token, 100 ether);
        _approveERC20(TRADER, rmt, 3 * ERC20_COST);

        token.setBehavior(DistributionERC20Mock.Behavior.FALSE_RETURN);
        vm.prank(TRADER);
        vm.expectRevert();
        engine.airdropERC20Equal(keccak256("false"), address(token), recipients, 10 ether);

        token.setBehavior(DistributionERC20Mock.Behavior.FEE_ON_TRANSFER);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.UnsupportedTransferBehavior.selector);
        engine.airdropERC20Equal(keccak256("fee"), address(token), recipients, 10 ether);

        token.setBehavior(DistributionERC20Mock.Behavior.OVER_DEBIT);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.UnsupportedTransferBehavior.selector);
        engine.airdropERC20Equal(keccak256("debit"), address(token), recipients, 10 ether);

        assertEq(token.balanceOf(RECIPIENT_1), 0);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testDistributionFailureRollsBackTransfersRetirementAndReplayConsumption() external {
        address[] memory recipients = _twoRecipients();
        token.setFailingRecipient(RECIPIENT_2);
        _approveERC20(TRADER, token, 20 ether);
        _approveERC20(TRADER, rmt, 2 * ERC20_COST);
        bytes32 executionKey = engine.getExecutionKey(TRADER, DISTRIBUTION_ID);

        vm.prank(TRADER);
        vm.expectRevert("token revert");
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), recipients, 10 ether);

        assertEq(token.balanceOf(RECIPIENT_1), 0);
        assertEq(token.balanceOf(RECIPIENT_2), 0);
        assertEq(rmt.balanceOf(address(sink)), 0);
        assertFalse(engine.executionConsumed(executionKey));
    }

    function testRetirementFailurePreventsAnyAssetTransfer() external {
        _approveERC20(TRADER, token, 10 ether);

        vm.prank(TRADER);
        vm.expectRevert();
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), _oneRecipient(), 10 ether);

        assertEq(token.balanceOf(RECIPIENT_1), 0);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testAbnormalRmtRetirementFailsClosedBeforeAssetTransfer() external {
        _approveERC20(TRADER, token, 20 ether);
        _approveERC20(TRADER, rmt, 2 * ERC20_COST);

        rmt.setBehavior(DistributionERC20Mock.Behavior.FEE_ON_TRANSFER);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.UnsupportedTransferBehavior.selector);
        engine.airdropERC20Equal(keccak256("rmt fee"), address(token), _oneRecipient(), 10 ether);

        rmt.setBehavior(DistributionERC20Mock.Behavior.FALSE_RETURN);
        vm.prank(TRADER);
        vm.expectRevert();
        engine.airdropERC20Equal(keccak256("rmt false"), address(token), _oneRecipient(), 10 ether);

        assertEq(token.balanceOf(RECIPIENT_1), 0);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testReplayIsSenderBoundAndCrossActionSafe() external {
        address[] memory recipients = _oneRecipient();
        _approveERC20(TRADER, token, 20 ether);
        _approveERC20(TRADER, rmt, 2 * ERC20_COST);
        vm.prank(TRADER);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), recipients, 5 ether);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5 ether;
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.ExecutionAlreadyConsumed.selector);
        engine.airdropERC20(DISTRIBUTION_ID, address(token), recipients, amounts);

        _approveERC20(SECOND_TRADER, token, 5 ether);
        _approveERC20(SECOND_TRADER, rmt, ERC20_COST);
        vm.prank(SECOND_TRADER);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), recipients, 5 ether);

        assertTrue(engine.executionConsumed(engine.getExecutionKey(TRADER, DISTRIBUTION_ID)));
        assertTrue(engine.executionConsumed(engine.getExecutionKey(SECOND_TRADER, DISTRIBUTION_ID)));
        assertTrue(
            engine.getExecutionKey(TRADER, DISTRIBUTION_ID) != engine.getExecutionKey(SECOND_TRADER, DISTRIBUTION_ID)
        );
    }

    function testERC20InputValidationFailsBeforeRetirement() external {
        _approveERC20(TRADER, rmt, 100 ether);
        _approveERC20(TRADER, token, 100 ether);

        address[] memory none = new address[](0);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.EmptyDistribution.selector);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), none, 1 ether);

        address[] memory invalid = _oneRecipient();
        invalid[0] = TRADER;
        vm.prank(TRADER);
        vm.expectRevert(abi.encodeWithSelector(RMTDistributionEngineV1.InvalidRecipient.selector, 0));
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), invalid, 1 ether);

        invalid[0] = address(sink);
        vm.prank(TRADER);
        vm.expectRevert(abi.encodeWithSelector(RMTDistributionEngineV1.InvalidRecipient.selector, 0));
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), invalid, 1 ether);

        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.InvalidDistributionId.selector);
        engine.airdropERC20Equal(bytes32(0), address(token), _oneRecipient(), 1 ether);

        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.InvalidAsset.selector);
        engine.airdropERC20Equal(keccak256("eoa asset"), address(0x9999), _oneRecipient(), 1 ether);

        uint256[] memory noAmounts = new uint256[](0);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.LengthMismatch.selector);
        engine.airdropERC20(keccak256("length"), address(token), _oneRecipient(), noAmounts);

        vm.prank(TRADER);
        vm.expectRevert(abi.encodeWithSelector(RMTDistributionEngineV1.InvalidAmount.selector, 0));
        engine.airdropERC20Equal(keccak256("zero"), address(token), _oneRecipient(), 0);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testUtilityCostOverflowFailsClosed() external {
        vm.expectRevert();
        engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC1155, type(uint256).max);
    }

    function testERC721DistributionVerifiesFinalOwnership() external {
        nft.mint(TRADER, 1);
        nft.mint(TRADER, 2);
        vm.prank(TRADER);
        nft.setApprovalForAll(address(engine), true);
        _approveERC20(TRADER, rmt, 2 * ERC721_COST);

        vm.prank(TRADER);
        (,, uint256 total, uint256 retired) =
            engine.airdropERC721(DISTRIBUTION_ID, address(nft), _twoRecipients(), _ids(1, 2));

        assertEq(total, 2);
        assertEq(retired, 2 * ERC721_COST);
        assertEq(nft.ownerOf(1), RECIPIENT_1);
        assertEq(nft.ownerOf(2), RECIPIENT_2);
        assertEq(rmt.balanceOf(address(sink)), 2 * ERC721_COST);
    }

    function testERC721SupportsSafeContractReceiver() external {
        DistributionAcceptingReceiver receiver = new DistributionAcceptingReceiver();
        nft.mint(TRADER, 1);
        vm.prank(TRADER);
        nft.approve(address(engine), 1);
        _approveERC20(TRADER, rmt, ERC721_COST);
        address[] memory recipients = new address[](1);
        recipients[0] = address(receiver);

        vm.prank(TRADER);
        engine.airdropERC721(DISTRIBUTION_ID, address(nft), recipients, _ids(1));
        assertEq(nft.ownerOf(1), address(receiver));
    }

    function testERC721AllowsMultipleTokensToOneRecipient() external {
        nft.mint(TRADER, 1);
        nft.mint(TRADER, 2);
        vm.prank(TRADER);
        nft.setApprovalForAll(address(engine), true);
        _approveERC20(TRADER, rmt, 2 * ERC721_COST);
        address[] memory recipients = new address[](2);
        recipients[0] = RECIPIENT_1;
        recipients[1] = RECIPIENT_1;

        vm.prank(TRADER);
        engine.airdropERC721(DISTRIBUTION_ID, address(nft), recipients, _ids(1, 2));
        assertEq(nft.ownerOf(1), RECIPIENT_1);
        assertEq(nft.ownerOf(2), RECIPIENT_1);
    }

    function testERC721ReceiverRevertRollsBackRetirementAndOwnership() external {
        DistributionRejectingReceiver receiver = new DistributionRejectingReceiver();
        nft.mint(TRADER, 1);
        vm.prank(TRADER);
        nft.approve(address(engine), 1);
        _approveERC20(TRADER, rmt, ERC721_COST);
        address[] memory recipients = new address[](1);
        recipients[0] = address(receiver);

        vm.prank(TRADER);
        vm.expectRevert("reject ERC721");
        engine.airdropERC721(DISTRIBUTION_ID, address(nft), recipients, _ids(1));
        assertEq(nft.ownerOf(1), TRADER);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testERC721RejectsUnapprovedUnownedAndPostOwnerMismatch() external {
        nft.mint(TRADER, 1);
        _approveERC20(TRADER, rmt, 3 * ERC721_COST);

        vm.prank(TRADER);
        vm.expectRevert("approval");
        engine.airdropERC721(keccak256("unapproved"), address(nft), _oneRecipient(), _ids(1));

        vm.prank(SECOND_TRADER);
        nft.setApprovalForAll(address(engine), true);
        _approveERC20(SECOND_TRADER, rmt, ERC721_COST);
        vm.prank(SECOND_TRADER);
        vm.expectRevert(abi.encodeWithSelector(RMTDistributionEngineV1.InvalidAssetOwnership.selector, 0));
        engine.airdropERC721(keccak256("unowned"), address(nft), _oneRecipient(), _ids(1));

        vm.prank(TRADER);
        nft.setApprovalForAll(address(engine), true);
        nft.setSkipTransfer(true);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.UnsupportedTransferBehavior.selector);
        engine.airdropERC721(keccak256("liar"), address(nft), _oneRecipient(), _ids(1));

        assertEq(nft.ownerOf(1), TRADER);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testERC1155DistributionVerifiesExactBalances() external {
        edition.mint(TRADER, 7, 20);
        edition.mint(TRADER, 8, 30);
        vm.prank(TRADER);
        edition.setApprovalForAll(address(engine), true);
        _approveERC20(TRADER, rmt, 2 * ERC1155_COST);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 4;
        amounts[1] = 9;

        vm.prank(TRADER);
        (,, uint256 total, uint256 retired) =
            engine.airdropERC1155(DISTRIBUTION_ID, address(edition), _twoRecipients(), _ids(7, 8), amounts);

        assertEq(total, 13);
        assertEq(retired, 2 * ERC1155_COST);
        assertEq(edition.balanceOf(RECIPIENT_1, 7), 4);
        assertEq(edition.balanceOf(RECIPIENT_2, 8), 9);
        assertEq(edition.balanceOf(address(engine), 7), 0);
        assertEq(edition.balanceOf(address(engine), 8), 0);
    }

    function testERC1155RejectsAbnormalTransferAndReceiverRevertAtomically() external {
        edition.mint(TRADER, 7, 100);
        vm.prank(TRADER);
        edition.setApprovalForAll(address(engine), true);
        _approveERC20(TRADER, rmt, 3 * ERC1155_COST);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10;
        edition.setAbnormalBehavior(true, false);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.UnsupportedTransferBehavior.selector);
        engine.airdropERC1155(keccak256("under"), address(edition), _oneRecipient(), _ids(7), amounts);

        edition.setAbnormalBehavior(false, true);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.UnsupportedTransferBehavior.selector);
        engine.airdropERC1155(keccak256("over"), address(edition), _oneRecipient(), _ids(7), amounts);

        edition.setAbnormalBehavior(false, false);
        DistributionRejectingReceiver receiver = new DistributionRejectingReceiver();
        address[] memory recipients = new address[](1);
        recipients[0] = address(receiver);
        vm.prank(TRADER);
        vm.expectRevert("reject ERC1155");
        engine.airdropERC1155(keccak256("receiver"), address(edition), recipients, _ids(7), amounts);

        assertEq(edition.balanceOf(TRADER, 7), 100);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testERC1155RejectsMissingApprovalInsufficientBalanceAndInvalidRows() external {
        edition.mint(TRADER, 7, 5);
        _approveERC20(TRADER, rmt, 4 * ERC1155_COST);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5;

        vm.prank(TRADER);
        vm.expectRevert("approval");
        engine.airdropERC1155(keccak256("approval"), address(edition), _oneRecipient(), _ids(7), amounts);

        vm.prank(TRADER);
        edition.setApprovalForAll(address(engine), true);
        amounts[0] = 6;
        vm.prank(TRADER);
        vm.expectRevert("balance");
        engine.airdropERC1155(keccak256("balance"), address(edition), _oneRecipient(), _ids(7), amounts);

        amounts[0] = 0;
        vm.prank(TRADER);
        vm.expectRevert(abi.encodeWithSelector(RMTDistributionEngineV1.InvalidAmount.selector, 0));
        engine.airdropERC1155(keccak256("zero 1155"), address(edition), _oneRecipient(), _ids(7), amounts);

        uint256[] memory noIds = new uint256[](0);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.LengthMismatch.selector);
        engine.airdropERC1155(keccak256("length 1155"), address(edition), _oneRecipient(), noIds, amounts);
        assertEq(edition.balanceOf(TRADER, 7), 5);
        assertEq(rmt.balanceOf(address(sink)), 0);
    }

    function testReentrancyAttemptCannotDuplicateDistribution() external {
        address[] memory recipients = _oneRecipient();
        _approveERC20(TRADER, token, 20 ether);
        _approveERC20(TRADER, rmt, ERC20_COST);
        bytes memory reentry =
            abi.encodeCall(engine.airdropERC20Equal, (DISTRIBUTION_ID, address(token), recipients, 10 ether));
        token.setReentry(address(engine), reentry);

        vm.prank(TRADER);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), recipients, 10 ether);

        assertEq(token.balanceOf(RECIPIENT_1), 10 ether);
        assertEq(rmt.balanceOf(address(sink)), ERC20_COST);
    }

    function testRmtRetirementReentrancyAttemptCannotDuplicateDistribution() external {
        address[] memory recipients = _oneRecipient();
        _approveERC20(TRADER, token, 10 ether);
        _approveERC20(TRADER, rmt, ERC20_COST);
        bytes memory reentry =
            abi.encodeCall(engine.airdropERC20Equal, (DISTRIBUTION_ID, address(token), recipients, 10 ether));
        rmt.setReentry(address(engine), reentry);

        vm.prank(TRADER);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), recipients, 10 ether);
        assertEq(token.balanceOf(RECIPIENT_1), 10 ether);
        assertEq(rmt.balanceOf(address(sink)), ERC20_COST);
    }

    function testRuntimeAndChainIdentityChangesFailClosed() external {
        _approveERC20(TRADER, token, 30 ether);
        _approveERC20(TRADER, rmt, 3 * ERC20_COST);

        vm.etch(address(sink), hex"6000");
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.RuntimeIdentityChanged.selector);
        engine.airdropERC20Equal(keccak256("sink"), address(token), _oneRecipient(), 10 ether);

        vm.etch(address(sink), type(RMTRetirementSinkV1).runtimeCode);
        vm.chainId(1);
        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.RuntimeIdentityChanged.selector);
        engine.airdropERC20Equal(keccak256("chain"), address(token), _oneRecipient(), 10 ether);
    }

    function testRmtRuntimeIdentityChangeFailsClosed() external {
        _approveERC20(TRADER, token, 10 ether);
        _approveERC20(TRADER, rmt, ERC20_COST);
        vm.etch(address(rmt), hex"6000");

        vm.prank(TRADER);
        vm.expectRevert(RMTDistributionEngineV1.RuntimeIdentityChanged.selector);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), _oneRecipient(), 10 ether);
    }

    function testDonatedEngineBalanceCannotBeSweptOrConsumed() external {
        token.mint(address(engine), 13 ether);
        rmt.mint(address(engine), 17 ether);
        _approveERC20(TRADER, token, 10 ether);
        _approveERC20(TRADER, rmt, ERC20_COST);

        vm.prank(TRADER);
        engine.airdropERC20Equal(DISTRIBUTION_ID, address(token), _oneRecipient(), 10 ether);

        assertEq(token.balanceOf(address(engine)), 13 ether);
        assertEq(rmt.balanceOf(address(engine)), 17 ether);
        (bool sweepSuccess,) =
            address(engine).call(abi.encodeWithSignature("sweep(address,address)", address(token), TRADER));
        assertFalse(sweepSuccess);
        assertEq(token.balanceOf(address(engine)), 13 ether);
    }

    function testBatchHashesBindEverySecurityRelevantBatchField() external view {
        address[] memory recipients = _twoRecipients();
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 2;
        bytes32 base = engine.hashERC20Batch(address(token), recipients, amounts);

        recipients[1] = address(0x3333);
        assertTrue(base != engine.hashERC20Batch(address(token), recipients, amounts));
        recipients[1] = RECIPIENT_2;
        amounts[1] = 3;
        assertTrue(base != engine.hashERC20Batch(address(token), recipients, amounts));
        amounts[1] = 2;
        assertTrue(base != engine.hashERC20Batch(address(rmt), recipients, amounts));

        address first = recipients[0];
        recipients[0] = recipients[1];
        recipients[1] = first;
        assertTrue(base != engine.hashERC20Batch(address(token), recipients, amounts));
    }

    function testSplittingBatchesDoesNotChangeAggregateUtilityCost() external view {
        uint256 oneBatch = engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, 482);
        uint256 splitBatches = engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, 200)
            + engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, 200)
            + engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, 82);
        assertEq(oneBatch, splitBatches);
    }

    function _approveERC20(address owner, DistributionERC20Mock asset, uint256 amount) private {
        vm.prank(owner);
        asset.approve(address(engine), amount);
    }

    function _oneRecipient() private pure returns (address[] memory recipients) {
        recipients = new address[](1);
        recipients[0] = RECIPIENT_1;
    }

    function _twoRecipients() private pure returns (address[] memory recipients) {
        recipients = new address[](2);
        recipients[0] = RECIPIENT_1;
        recipients[1] = RECIPIENT_2;
    }

    function _ids(uint256 id) private pure returns (uint256[] memory values) {
        values = new uint256[](1);
        values[0] = id;
    }

    function _ids(uint256 id1, uint256 id2) private pure returns (uint256[] memory values) {
        values = new uint256[](2);
        values[0] = id1;
        values[1] = id2;
    }
}
