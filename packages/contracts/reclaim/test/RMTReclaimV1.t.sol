// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {RMTReclaimCampaignV1} from "../src/RMTReclaimCampaignV1.sol";
import {RMTReclaimFactoryV1} from "../src/RMTReclaimFactoryV1.sol";
import {Reclaim721Fixture,Reclaim1155Fixture,ReclaimRewardFixture,ReclaimHostileReward,ReclaimHostile721,ReclaimHostile1155,ReclaimRejectNFTReceiver} from "./ReclaimAssets.sol";

interface ReclaimVm {
    function chainId(uint256)external;function prank(address)external;function startPrank(address)external;function stopPrank()external;
    function warp(uint256)external;function expectRevert()external;function etch(address,bytes calldata)external;
    function getBlockTimestamp()external view returns(uint256);
}
abstract contract ReclaimTestBase {
    ReclaimVm constant vm=ReclaimVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant ALICE=address(0x100001);address constant BOB=address(0x100002);address constant OUTSIDE=address(0x100003);
    ReclaimRewardFixture token;Reclaim721Fixture nft;Reclaim1155Fixture multi;
    RMTReclaimFactoryV1 factory;RMTReclaimCampaignV1 campaign;
    bytes32 leaf1;bytes32 leaf2;bytes32 leaf10;bytes32 leaf11;
    function setUp()public virtual{
        vm.chainId(31337);vm.warp(1_800_000_000);token=new ReclaimRewardFixture();nft=new Reclaim721Fixture();multi=new Reclaim1155Fixture();
        factory=new RMTReclaimFactoryV1(address(token),address(token).codehash);
        vm.prank(ALICE);campaign=RMTReclaimCampaignV1(factory.create(keccak256("campaign-one"),ALICE,5 ether,20));
        token.transfer(ALICE,3000 ether);vm.startPrank(ALICE);token.approve(address(campaign),2000 ether);campaign.fund(2000 ether);vm.stopPrank();
        nft.mint(ALICE,1);nft.mint(ALICE,2);multi.mint(ALICE,10,5);multi.mint(BOB,10,5);multi.mint(ALICE,11,5);
        leaf1=_leaf(address(nft),1,1,1);leaf2=_leaf(address(nft),1,2,1);
        leaf10=_leaf(address(multi),2,10,5);leaf11=_leaf(address(multi),2,11,5);
        _admit(address(nft),1,_pair(leaf1,leaf2),10,5);_admit(address(multi),2,_pair(leaf10,leaf11),20,20);
        vm.startPrank(ALICE);nft.setApprovalForAll(address(campaign),true);multi.setApprovalForAll(address(campaign),true);campaign.resume();vm.stopPrank();
        vm.prank(BOB);multi.setApprovalForAll(address(campaign),true);
    }
    function _now()internal view returns(uint48){return uint48(vm.getBlockTimestamp());}
    function _leaf(address asset,uint8 standard,uint256 id,uint256 maximum)internal view returns(bytes32){return keccak256(abi.encode(block.chainid,address(campaign),asset,asset.codehash,standard,id,maximum));}
    function _pair(bytes32 a,bytes32 b)internal pure returns(bytes32){return a<b?keccak256(abi.encode(a,b)):keccak256(abi.encode(b,a));}
    function _admit(address asset,uint8 standard,bytes32 root,uint32 cap,uint32 userCap)internal{
        vm.prank(ALICE);campaign.proposeCollection(asset,standard,asset.codehash,root,cap,userCap,_now()+3 days);vm.warp(_now()+2 days);campaign.executeCollection();
    }
    function _arrays(uint256 id,uint256 quantity,uint256 maximum,bytes32 sibling)internal pure returns(uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs){
        ids=new uint256[](1);qty=new uint256[](1);max=new uint256[](1);proofs=new bytes32[][](1);ids[0]=id;qty[0]=quantity;max[0]=maximum;
        proofs[0]=new bytes32[](sibling==bytes32(0)?0:1);if(sibling!=bytes32(0))proofs[0][0]=sibling;
    }
    function _redeem(address who,address asset,uint256 id,uint256 quantity,uint256 maximum,bytes32 sibling)internal returns(uint64){
        (uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs)=_arrays(id,quantity,maximum,sibling);
        uint64 epoch=campaign.policyEpoch();uint256 reward=uint256(campaign.rewardPerUnit())*quantity;uint64 nonce=campaign.claimantNonces(who);uint48 deadline=_now()+60;
        vm.prank(who);return campaign.redeem(asset,ids,qty,max,proofs,epoch,reward,nonce,deadline);
    }
    function _rejectRedeem(address who,address asset,uint256 id,uint256 quantity,uint256 maximum,bytes32 sibling)internal{
        (uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs)=_arrays(id,quantity,maximum,sibling);
        _rejectRaw(who,asset,ids,qty,max,proofs,campaign.policyEpoch(),uint256(campaign.rewardPerUnit())*quantity,campaign.claimantNonces(who),_now()+60);
    }
    function _rejectRaw(address who,address asset,uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs,uint64 epoch,uint256 reward,uint64 nonce,uint48 deadline)internal{
        vm.prank(who);vm.expectRevert();campaign.redeem(asset,ids,qty,max,proofs,epoch,reward,nonce,deadline);
    }
    function _conserved()internal view{
        require(campaign.funded()+campaign.repaid()+campaign.unsolicited()==campaign.reserve()+campaign.paid()+campaign.recovered());
        require(token.balanceOf(address(campaign))==campaign.reserve()&&campaign.outstandingLiability()==0);
    }
}

contract RMTReclaimV1Test is ReclaimTestBase {
    function testCreate2IdentityDuplicateAndCreatorIsolation()public{
        bytes32 intent=keccak256("campaign-one");require(factory.predict(ALICE,intent,ALICE,5 ether,20)==address(campaign));
        vm.prank(ALICE);vm.expectRevert();factory.create(intent,ALICE,5 ether,20);
        vm.prank(BOB);address other=factory.create(intent,BOB,5 ether,20);require(other!=address(campaign));
        require(campaign.creator()==ALICE&&campaign.controller()==ALICE&&campaign.deploymentFactory()==address(factory));
    }
    function testUnsupportedChainAndInvalidRewardPinsCannotDeploy()public{
        vm.chainId(1);vm.expectRevert();new RMTReclaimFactoryV1(address(token),address(token).codehash);vm.chainId(31337);
        vm.expectRevert();new RMTReclaimFactoryV1(address(token),bytes32(uint256(1)));
        vm.prank(ALICE);vm.expectRevert();factory.create(keccak256("zero-rate"),ALICE,0,5);
        vm.prank(ALICE);vm.expectRevert();factory.create(keccak256("zero-controller"),address(0),5 ether,5);
    }
    function testManualFundingHasExactAllowanceAndNoUnsecuredUsdReward()public{
        require(campaign.funded()==2000 ether&&campaign.reserve()==2000 ether);
        require(token.allowance(ALICE,address(campaign))==0);
        vm.prank(BOB);vm.expectRevert();campaign.fund(1);
        vm.expectRevert();campaign.quoteUsd(5,100,_now());vm.expectRevert();campaign.quoteUsd(5,100,_now()-1000);
        _conserved();
    }
    function testNoReserveNoCollectionAndPausedCampaignAreHardNoGo()public{
        vm.prank(ALICE);RMTReclaimCampaignV1 empty=RMTReclaimCampaignV1(factory.create(keccak256("empty"),ALICE,5 ether,5));
        require(empty.paused());vm.prank(ALICE);vm.expectRevert();empty.resume();
        vm.prank(ALICE);campaign.pause();_rejectRedeem(ALICE,address(nft),1,1,1,leaf2);require(nft.ownerOf(1)==ALICE);
    }
    function testErc721AtomicEscrowRewardAndImmutableReceipt()public{
        uint256 before=token.balanceOf(ALICE);uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);require(id==1);
        require(nft.ownerOf(1)==address(campaign)&&token.balanceOf(ALICE)==before+5 ether);
        (address claimant,address collection,uint8 standard,uint64 epoch,uint256 reward,uint32 units,uint8 state)=campaign.tradeIns(id);
        require(claimant==ALICE&&collection==address(nft)&&standard==1&&epoch==campaign.policyEpoch()&&reward==5 ether&&units==1&&state==1);
        require(campaign.receiptCollectionHash(id)==address(nft).codehash&&campaign.claimantNonces(ALICE)==1&&campaign.claimedUnits(address(nft),1)==1);
        _conserved();
    }
    function testErc1155BatchUsesExactCallbackAndQuantityAccounting()public{
        uint256[]memory ids=new uint256[](2);ids[0]=10;ids[1]=11;uint256[]memory qty=new uint256[](2);qty[0]=2;qty[1]=3;
        uint256[]memory max=new uint256[](2);max[0]=5;max[1]=5;bytes32[][]memory proofs=new bytes32[][](2);proofs[0]=new bytes32[](1);proofs[0][0]=leaf11;proofs[1]=new bytes32[](1);proofs[1][0]=leaf10;
        uint64 epoch=campaign.policyEpoch();uint48 deadline=_now()+60;vm.prank(ALICE);uint64 id=campaign.redeem(address(multi),ids,qty,max,proofs,epoch,25 ether,0,deadline);
        require(multi.balanceOf(address(campaign),10)==2&&multi.balanceOf(address(campaign),11)==3&&campaign.collectionClaimed(address(multi))==5);
        (uint256[]memory storedIds,uint256[]memory storedQty)=campaign.receiptItems(id);require(storedIds[1]==11&&storedQty[1]==3);_conserved();
    }
    function testBatchDuplicateUnsafelyLargeAndZeroQuantitiesRejectAtomically()public{
        (uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs)=_arrays(10,0,5,leaf11);
        _rejectRaw(ALICE,address(multi),ids,qty,max,proofs,campaign.policyEpoch(),0,0,_now()+60);
        qty[0]=21;_rejectRaw(ALICE,address(multi),ids,qty,max,proofs,campaign.policyEpoch(),105 ether,0,_now()+60);
        ids=new uint256[](9);qty=new uint256[](9);max=new uint256[](9);proofs=new bytes32[][](9);
        _rejectRaw(ALICE,address(multi),ids,qty,max,proofs,campaign.policyEpoch(),0,0,_now()+60);
        require(campaign.tradeInNonce()==0&&multi.balanceOf(ALICE,10)==5);_conserved();
    }
    function testEligibleTokenCannotBeReplayedOrSpentByUnrelatedWallet()public{
        _rejectRedeem(BOB,address(nft),1,1,1,leaf2);require(nft.ownerOf(1)==ALICE);
        _redeem(ALICE,address(nft),1,1,1,leaf2);_rejectRedeem(ALICE,address(nft),1,1,1,leaf2);
        require(campaign.tradeInNonce()==1&&campaign.paid()==5 ether);_conserved();
    }
    function testFiniteEligibilityRejectsSelfMintedAndCrossCampaignProofs()public{
        nft.mint(ALICE,99);_rejectRedeem(ALICE,address(nft),99,1,1,leaf2);
        require(nft.ownerOf(99)==ALICE&&campaign.tradeInNonce()==0);_conserved();
    }
    function testGlobalErc1155QuantityCapCoversConcurrentClaimants()public{
        _redeem(ALICE,address(multi),10,3,5,leaf11);_redeem(BOB,address(multi),10,2,5,leaf11);
        _rejectRedeem(BOB,address(multi),10,1,5,leaf11);
        require(campaign.claimedUnits(address(multi),10)==5&&campaign.paid()==25 ether);_conserved();
    }
    function testWalletAndCollectionCapsRemainConsumedAfterReturn()public{
        uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);vm.startPrank(ALICE);token.approve(address(campaign),5 ether);campaign.returnTradeIn(id,_now()+60);vm.stopPrank();
        require(nft.ownerOf(1)==ALICE&&campaign.claimedUnits(address(nft),1)==1&&campaign.walletClaimed(ALICE)==1);
        _rejectRedeem(ALICE,address(nft),1,1,1,leaf2);vm.prank(ALICE);vm.expectRevert();campaign.returnTradeIn(id,_now()+60);_conserved();
    }
    function testReturnRightsSurvivePauseDisableRootChangesAndCampaignClose()public{
        uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);vm.startPrank(ALICE);campaign.pause();campaign.disableCollection(address(nft));
        campaign.proposeClose(_now()+3 days);vm.stopPrank();vm.warp(_now()+2 days);campaign.executeClose();
        vm.startPrank(ALICE);token.approve(address(campaign),5 ether);campaign.returnTradeIn(id,_now()+60);vm.stopPrank();
        require(nft.ownerOf(1)==ALICE&&campaign.closed()&&campaign.repaid()==5 ether);_conserved();
    }
    function testReturnRequiresOriginalClaimantExactRewardAndApproval()public{
        uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);vm.prank(BOB);vm.expectRevert();campaign.returnTradeIn(id,_now()+60);
        vm.prank(ALICE);vm.expectRevert();campaign.returnTradeIn(id,_now()+60);
        require(nft.ownerOf(1)==address(campaign)&&campaign.repaid()==0);_conserved();
    }
    function testUnsolicitedSafeTransfersAndForgedReceiverCallbacksReject()public{
        vm.prank(ALICE);vm.expectRevert();nft.safeTransferFrom(ALICE,address(campaign),1,"");
        vm.prank(ALICE);vm.expectRevert();multi.safeTransferFrom(ALICE,address(campaign),10,1,"");
        vm.expectRevert();campaign.onERC721Received(address(campaign),ALICE,1,abi.encode(uint64(1)));
        require(nft.ownerOf(1)==ALICE&&multi.balanceOf(address(campaign),10)==0);_conserved();
    }
    function testUnsafeForcedNftTransferHasNoInventedClaimOrOwnerDrain()public{
        vm.prank(ALICE);nft.transferFrom(ALICE,address(campaign),1);require(nft.ownerOf(1)==address(campaign));
        require(campaign.tradeInNonce()==0&&campaign.paid()==0);
        vm.prank(ALICE);(bool ok,)=address(campaign).call(abi.encodeWithSignature("withdrawNFT(address,uint256,address)",address(nft),1,ALICE));require(!ok);
    }
    function testRateNoticeAndQuoteEpochRejectRetroactiveOrExpiredSubmission()public{
        uint64 epoch=campaign.policyEpoch();vm.prank(ALICE);campaign.proposeRate(50 ether,_now()+3 days);vm.expectRevert();campaign.executeRate();
        vm.warp(_now()+2 days);campaign.executeRate();
        (uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs)=_arrays(1,1,1,leaf2);
        _rejectRaw(ALICE,address(nft),ids,qty,max,proofs,epoch,5 ether,0,_now()+60);
        _rejectRaw(ALICE,address(nft),ids,qty,max,proofs,campaign.policyEpoch(),50 ether,0,_now()-1);
        require(nft.ownerOf(1)==ALICE&&campaign.claimantNonces(ALICE)==0);_conserved();
    }
    function testInsufficientBudgetCannotCreateNftReceiptOrDebt()public{
        vm.prank(ALICE);campaign.proposeRate(2001 ether,_now()+3 days);vm.warp(_now()+2 days);campaign.executeRate();
        _rejectRedeem(ALICE,address(nft),1,1,1,leaf2);require(nft.ownerOf(1)==ALICE&&campaign.tradeInNonce()==0&&campaign.outstandingLiability()==0);_conserved();
    }
    function testNoticedCloseAndRecoveryOnlyUncommittedRewardTokens()public{
        _redeem(ALICE,address(nft),1,1,1,leaf2);vm.prank(ALICE);vm.expectRevert();campaign.proposeRecovery(1,_now()+3 days);
        vm.prank(ALICE);campaign.proposeClose(_now()+3 days);vm.expectRevert();campaign.executeClose();vm.warp(_now()+2 days);campaign.executeClose();
        uint256 availableReserve=campaign.reserve();vm.prank(ALICE);campaign.proposeRecovery(availableReserve,_now()+3 days);vm.expectRevert();campaign.executeRecovery();
        vm.warp(_now()+2 days);campaign.executeRecovery();require(campaign.reserve()==0&&campaign.recovered()==1995 ether&&nft.ownerOf(1)==address(campaign));_conserved();
    }
    function testControllerAcceptanceInvalidatesNoticesAndCannotResumeSilently()public{
        vm.startPrank(ALICE);campaign.proposeRate(10 ether,_now()+3 days);campaign.proposeController(BOB,_now()+3 days);vm.stopPrank();
        vm.prank(BOB);vm.expectRevert();campaign.acceptController();vm.warp(_now()+2 days);vm.prank(BOB);campaign.acceptController();
        require(campaign.controller()==BOB&&campaign.controllerEpoch()==2&&campaign.paused());vm.expectRevert();campaign.executeRate();
        vm.prank(OUTSIDE);campaign.cancelRate();vm.prank(ALICE);vm.expectRevert();campaign.resume();
        vm.prank(BOB);campaign.proposeRate(10 ether,_now()+3 days);vm.warp(_now()+2 days);campaign.executeRate();_conserved();
    }
    function testExpiredNoticeCanBeCancelledWithoutRedirectingAssets()public{
        vm.prank(ALICE);campaign.proposeRate(10 ether,_now()+3 days);vm.prank(OUTSIDE);vm.expectRevert();campaign.cancelRate();
        vm.warp(_now()+3 days+1);vm.expectRevert();campaign.executeRate();vm.prank(OUTSIDE);campaign.cancelRate();require(campaign.rewardPerUnit()==5 ether);_conserved();
    }
    function testCollectionRuntimeMutationFailsClosedAndPreservesOriginalCustodyEvidence()public{
        uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);bytes32 original=campaign.receiptCollectionHash(id);vm.etch(address(nft),hex"00");
        _rejectRedeem(ALICE,address(nft),2,1,1,leaf1);vm.startPrank(ALICE);token.approve(address(campaign),5 ether);vm.expectRevert();campaign.returnTradeIn(id,_now()+60);vm.stopPrank();
        require(campaign.receiptCollectionHash(id)==original&&campaign.repaid()==0);_conserved();
    }
    function testUnsolicitedRewardTokensAreSeparateAndNoNativeRewardFallbackExists()public{
        token.transfer(address(campaign),7);require(campaign.reserve()==2000 ether);campaign.reconcileSurplus();require(campaign.unsolicited()==7&&campaign.reserve()==2000 ether+7);
        (bool ok,)=address(campaign).call("");require(!ok);_conserved();
    }
    function testFuzzExactFundingAndSurrenderReturnConserveReserves(uint96 raw)public{
        uint256 amount=uint256(raw)%100 ether+1;vm.startPrank(ALICE);token.approve(address(campaign),amount);campaign.fund(amount);vm.stopPrank();
        uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);vm.startPrank(ALICE);token.approve(address(campaign),5 ether);campaign.returnTradeIn(id,_now()+60);vm.stopPrank();_conserved();
    }
    function testFuzzQuantityNeverExceedsFiniteTokenIdAllowance(uint8 raw)public{
        uint256 amount=uint256(raw)%5+1;_redeem(ALICE,address(multi),10,amount,5,leaf11);require(campaign.claimedUnits(address(multi),10)==amount);
        if(amount<5)_redeem(BOB,address(multi),10,5-amount,5,leaf11);
        _rejectRedeem(BOB,address(multi),10,1,5,leaf11);_conserved();
    }
    function testPerWalletAndCollectionCapsStopSeparateEligibleIds()public{
        _admit(address(nft),1,_pair(leaf1,leaf2),10,1);_redeem(ALICE,address(nft),1,1,1,leaf2);
        _rejectRedeem(ALICE,address(nft),2,1,1,leaf1);require(nft.ownerOf(2)==ALICE);
        _admit(address(nft),1,_pair(leaf1,leaf2),1,1);vm.prank(ALICE);nft.transferFrom(ALICE,BOB,2);
        vm.prank(BOB);nft.approve(address(campaign),2);_rejectRedeem(BOB,address(nft),2,1,1,leaf1);_conserved();
    }
    function testNonceReplayDoesNotConsumeAnotherEligibleNft()public{
        _redeem(ALICE,address(nft),1,1,1,leaf2);
        (uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs)=_arrays(2,1,1,leaf1);
        _rejectRaw(ALICE,address(nft),ids,qty,max,proofs,campaign.policyEpoch(),5 ether,0,_now()+60);
        require(nft.ownerOf(2)==ALICE&&campaign.claimantNonces(ALICE)==1);_conserved();
    }
    function testMaximumPerTransactionQuantityAndInsufficientBalanceAreAtomic()public{
        multi.mint(ALICE,99,20);_admit(address(multi),2,_leaf(address(multi),2,99,20),20,20);
        _redeem(ALICE,address(multi),99,20,20,bytes32(0));require(campaign.paid()==100 ether&&multi.balanceOf(address(campaign),99)==20);_conserved();
    }
    function testMerkleProofCannotCrossCampaignOrChain()public{
        RMTReclaimCampaignV1 original=campaign;token.transfer(ALICE,2000 ether);
        vm.prank(ALICE);campaign=RMTReclaimCampaignV1(factory.create(keccak256("other-campaign"),ALICE,5 ether,20));
        vm.startPrank(ALICE);token.approve(address(campaign),2000 ether);campaign.fund(2000 ether);vm.stopPrank();
        _admit(address(nft),1,_pair(leaf1,leaf2),10,10);vm.prank(ALICE);campaign.resume();
        _rejectRedeem(ALICE,address(nft),1,1,1,leaf2);require(nft.ownerOf(1)==ALICE&&campaign.tradeInNonce()==0&&original.tradeInNonce()==0);
        vm.chainId(4663);vm.expectRevert();campaign.reconcileSurplus();vm.chainId(31337);_conserved();
    }
    function testIllustrativeFixedUnitsBudgetExhaustionIsFundedNotUsdOracle()public{
        // Explicit synthetic assumption only: 1 fixture RMT = $0.01, therefore
        // 2,000 tokens model $20 and 5 tokens model $0.05. No live USD quote.
        require(campaign.reserve()/campaign.rewardPerUnit()==400);
        _admit(address(multi),2,_leaf(address(multi),2,99,420),420,20);
        for(uint160 i;i<21;i++){
            address claimant=address(uint160(0x600000)+i);multi.mint(claimant,99,20);vm.prank(claimant);multi.setApprovalForAll(address(campaign),true);
            if(i<20)_redeem(claimant,address(multi),99,20,420,bytes32(0));
            else _rejectRedeem(claimant,address(multi),99,20,420,bytes32(0));
        }
        require(campaign.reserve()==0&&campaign.paid()==2000 ether&&campaign.claimedUnits(address(multi),99)==400&&campaign.tradeInNonce()==20);_conserved();
    }
}
