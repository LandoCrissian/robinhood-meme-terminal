// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {RMTReclaimCampaignV2} from "../src/RMTReclaimCampaignV2.sol";
import {RMTReclaimFactoryV2} from "../src/RMTReclaimFactoryV2.sol";
import {RMTReclaimCampaignDeployerV2} from "../src/RMTReclaimCampaignDeployerV2.sol";
import {ReclaimBurn721Fixture,ReclaimBurn1155Fixture,ReclaimSink721Fixture,ReclaimSink1155Fixture,
    ReclaimFakeBurn721,ReclaimFakeBurn1155,ReclaimIssuerRecovery721,ReclaimV2Callback721,ReclaimV2RewardFixture,ReclaimV2HostileReward} from "./ReclaimV2Assets.sol";
interface ReclaimV2Vm {
    function chainId(uint256)external;function prank(address)external;function startPrank(address)external;function stopPrank()external;
    function warp(uint256)external;function expectRevert()external;function etch(address,bytes calldata)external;
    function getBlockTimestamp()external view returns(uint256);function targetContract(address)external;
}
abstract contract ReclaimV2TestBase {
    ReclaimV2Vm constant vm=ReclaimV2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant ALICE=address(0x100001);address constant BOB=address(0x100002);address constant OTHER=address(0x100003);
    ReclaimV2RewardFixture token;ReclaimBurn721Fixture burn721;ReclaimSink721Fixture sink721;ReclaimBurn1155Fixture burn1155;ReclaimSink1155Fixture sink1155;
    RMTReclaimFactoryV2 factory;RMTReclaimCampaignV2 campaign;
    function _policy(address asset,uint8 standard,uint8 mode) internal view returns(bytes32){return keccak256(abi.encode("SYNTHETIC_IMMUTABLE_MINT_ONCE_PROFILE_V2",asset.codehash,standard,mode));}
    function _profiles() internal view returns(RMTReclaimFactoryV2.RetirementProfile[] memory p){
        p=new RMTReclaimFactoryV2.RetirementProfile[](4);
        p[0]=RMTReclaimFactoryV2.RetirementProfile(address(burn721).codehash,1,1,_policy(address(burn721),1,1));
        p[1]=RMTReclaimFactoryV2.RetirementProfile(address(burn1155).codehash,2,1,_policy(address(burn1155),2,1));
        p[2]=RMTReclaimFactoryV2.RetirementProfile(address(sink721).codehash,1,2,_policy(address(sink721),1,2));
        p[3]=RMTReclaimFactoryV2.RetirementProfile(address(sink1155).codehash,2,2,_policy(address(sink1155),2,2));
    }
    function setUp() public virtual {
        vm.chainId(31337);vm.warp(1_800_000_000);token=new ReclaimV2RewardFixture();
        burn721=new ReclaimBurn721Fixture();sink721=new ReclaimSink721Fixture();burn1155=new ReclaimBurn1155Fixture();sink1155=new ReclaimSink1155Fixture();
        burn721.mint(ALICE,1);burn721.mint(ALICE,2);sink721.mint(ALICE,1);sink721.mint(ALICE,2);
        burn1155.mint(ALICE,101,10);burn1155.mint(ALICE,102,10);sink1155.mint(ALICE,201,10);
        vm.prank(ALICE);burn1155.safeTransferFrom(ALICE,BOB,101,5,"");
        factory=new RMTReclaimFactoryV2(address(token),address(token).codehash,_profiles());
        vm.prank(ALICE);campaign=RMTReclaimCampaignV2(factory.create(keccak256("ONE"),ALICE,5 ether,20));
        token.transfer(ALICE,3000 ether);vm.startPrank(ALICE);token.approve(address(campaign),2000 ether);campaign.fund(2000 ether);vm.stopPrank();
        _admit(address(burn721),1,1,_pair(_leaf(address(burn721),1,1,1,1),_leaf(address(burn721),1,1,2,1)),100,20);
        _admit(address(sink721),1,2,_pair(_leaf(address(sink721),1,2,1,1),_leaf(address(sink721),1,2,2,1)),100,20);
        _admit(address(burn1155),2,1,_pair(_leaf(address(burn1155),2,1,101,10),_leaf(address(burn1155),2,1,102,10)),100,20);
        _admit(address(sink1155),2,2,_leaf(address(sink1155),2,2,201,10),100,20);
        vm.startPrank(ALICE);burn721.setApprovalForAll(address(campaign),true);sink721.setApprovalForAll(address(campaign),true);burn1155.setApprovalForAll(address(campaign),true);sink1155.setApprovalForAll(address(campaign),true);campaign.resume();vm.stopPrank();
        vm.prank(BOB);burn1155.setApprovalForAll(address(campaign),true);
    }
    function _now() internal view returns(uint48){return uint48(vm.getBlockTimestamp());}
    function _pair(bytes32 a,bytes32 b) internal pure returns(bytes32){return a<b?keccak256(abi.encode(a,b)):keccak256(abi.encode(b,a));}
    function _leaf(address asset,uint8 standard,uint8 mode,uint256 id,uint256 maximum) internal view returns(bytes32){return keccak256(abi.encode(block.chainid,address(campaign),asset,asset.codehash,standard,mode,_policy(asset,standard,mode),id,maximum));}
    function _admit(address asset,uint8 standard,uint8 mode,bytes32 root,uint32 cap,uint32 userCap)internal{
        vm.prank(ALICE);campaign.proposeCollection(asset,standard,asset.codehash,root,cap,userCap,mode,_policy(asset,standard,mode),_now()+3 days);vm.warp(_now()+2 days);campaign.executeCollection();
    }
    function _arrays(uint256 id,uint256 qty,uint256 max,bytes32 sibling) internal pure returns(uint256[] memory ids,uint256[] memory quantities,uint256[] memory maximum,bytes32[][] memory proofs){
        ids=new uint256[](1);quantities=new uint256[](1);maximum=new uint256[](1);proofs=new bytes32[][](1);ids[0]=id;quantities[0]=qty;maximum[0]=max;
        proofs[0]=new bytes32[](sibling==bytes32(0)?0:1);if(sibling!=bytes32(0))proofs[0][0]=sibling;
    }
    function _redeem(address who,address asset,uint256 id,uint256 qty,uint256 max,bytes32 sibling)internal returns(uint64){
        (uint256[]memory ids,uint256[]memory quantities,uint256[]memory maximum,bytes32[][]memory proofs)=_arrays(id,qty,max,sibling);
        uint64 epoch=campaign.policyEpoch();uint256 reward=uint256(campaign.rewardPerUnit())*qty;uint64 nonce=campaign.claimantNonces(who);uint48 deadline=_now()+60;
        vm.prank(who);return campaign.redeem(asset,ids,quantities,maximum,proofs,epoch,reward,nonce,deadline);
    }
    function _reject(address who,address asset,uint256 id,uint256 qty,uint256 max,bytes32 sibling)internal{
        (uint256[]memory ids,uint256[]memory quantities,uint256[]memory maximum,bytes32[][]memory proofs)=_arrays(id,qty,max,sibling);
        uint64 epoch=campaign.policyEpoch();uint256 reward=uint256(campaign.rewardPerUnit())*qty;uint64 nonce=campaign.claimantNonces(who);uint48 deadline=_now()+60;
        vm.prank(who);vm.expectRevert();campaign.redeem(asset,ids,quantities,maximum,proofs,epoch,reward,nonce,deadline);
    }
    function _conserved()internal view{require(campaign.funded()+campaign.unsolicited()==campaign.reserve()+campaign.paid()+campaign.recovered());require(token.balanceOf(address(campaign))==campaign.reserve()&&campaign.outstandingLiability()==0);}
}

contract RMTReclaimV2Test is ReclaimV2TestBase {
    function _badRaw(uint64 epoch,uint256 reward,uint64 nonce,uint48 deadline) private {
        (uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs)=_arrays(1,1,1,_leaf(address(burn721),1,1,2,1));
        vm.prank(ALICE);vm.expectRevert();campaign.redeem(address(burn721),ids,qty,max,proofs,epoch,reward,nonce,deadline);
    }
    function testNative721BurnActuallyDestroysIDAndSupplyForever() public {
        uint256 beforeBalance=token.balanceOf(ALICE);_redeem(ALICE,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));
        require(!burn721.exists(1)&&burn721.totalSupply()==1&&burn721.balanceOf(ALICE)==1&&token.balanceOf(ALICE)==beforeBalance+5 ether);
        vm.expectRevert();burn721.ownerOf(1);vm.expectRevert();burn721.mint(ALICE,1);
        _reject(ALICE,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));require(campaign.claimedUnits(address(burn721),1)==1);_conserved();
    }
    function testSink721IsPermanentContractCustodyNotBurn() public {
        _redeem(ALICE,address(sink721),1,1,1,_leaf(address(sink721),1,2,2,1));address sink=factory.permanentSink();
        require(sink721.ownerOf(1)==sink&&sink721.totalSupply()==2&&sink721.balanceOf(sink)==1);
        (bool ok,)=sink.call(abi.encodeWithSignature("transferFrom(address,address,uint256)",sink,ALICE,1));require(!ok);
        (ok,)=sink.call(abi.encodeWithSignature("approve(address,uint256)",ALICE,1));require(!ok);require(sink721.ownerOf(1)==sink);_conserved();
    }
    function testNative1155BurnChecksExactQuantityAndSupply() public {
        _redeem(ALICE,address(burn1155),101,3,10,_leaf(address(burn1155),2,1,102,10));
        require(burn1155.balanceOf(ALICE,101)==2&&burn1155.balanceOf(BOB,101)==5&&burn1155.totalSupply(101)==7);
        vm.expectRevert();burn1155.mint(ALICE,101,3);_conserved();
    }
    function testSink1155ExactQuantityWithoutDestruction() public {
        _redeem(ALICE,address(sink1155),201,4,10,bytes32(0));require(sink1155.balanceOf(ALICE,201)==6&&sink1155.balanceOf(factory.permanentSink(),201)==4&&sink1155.totalSupply(201)==10);_conserved();
    }
    function testNoReturnOrRepaymentOrNFTWithdrawalSelectorExists() public {
        _redeem(ALICE,address(sink721),1,1,1,_leaf(address(sink721),1,2,2,1));uint256 before=token.balanceOf(ALICE);
        vm.prank(ALICE);(bool ok,)=address(campaign).call(abi.encodeWithSignature("returnTradeIn(uint64,uint48)",1,_now()+60));require(!ok);
        vm.prank(ALICE);(ok,)=address(campaign).call(abi.encodeWithSignature("withdrawNFT(address,uint256,address)",address(sink721),1,ALICE));require(!ok);
        require(token.balanceOf(ALICE)==before&&sink721.ownerOf(1)==factory.permanentSink());_conserved();
    }
    function testImmutableReceiptCapturesModeDestinationOriginalReward() public {
        uint64 id=_redeem(ALICE,address(sink721),1,1,1,_leaf(address(sink721),1,2,2,1));
        (address claimant,address asset,uint8 standard,uint64 epoch,uint256 reward,uint32 units,uint8 state,uint8 mode,address destination)=campaign.tradeIns(id);
        require(claimant==ALICE&&asset==address(sink721)&&standard==1&&epoch>0&&reward==5 ether&&units==1&&state==1&&mode==2&&destination==factory.permanentSink());
        vm.prank(ALICE);campaign.proposeRate(7 ether,_now()+3 days);vm.warp(_now()+2 days);campaign.executeRate();
        (,,,,uint256 afterReward,,,,)=campaign.tradeIns(id);require(afterReward==5 ether&&campaign.claimedUnits(address(sink721),1)==1);_conserved();
    }
    function testUnknownFakeBurnAndIssuerRecoveryCollectionsCannotBeAdmitted() public {
        ReclaimFakeBurn721 fake=new ReclaimFakeBurn721();ReclaimIssuerRecovery721 issuer=new ReclaimIssuerRecovery721();
        vm.prank(ALICE);vm.expectRevert();campaign.proposeCollection(address(fake),1,address(fake).codehash,bytes32(uint256(1)),2,2,1,keccak256("fake"),_now()+3 days);
        vm.prank(ALICE);vm.expectRevert();campaign.proposeCollection(address(issuer),1,address(issuer).codehash,bytes32(uint256(1)),2,2,2,keccak256("issuer"),_now()+3 days);
        require(campaign.paid()==0);
    }
    function testWrongModeOrPolicyCannotUseOtherwiseApprovedRuntime() public {
        vm.prank(ALICE);vm.expectRevert();campaign.proposeCollection(address(burn721),1,address(burn721).codehash,bytes32(uint256(1)),2,2,2,_policy(address(burn721),1,1),_now()+3 days);
        vm.prank(ALICE);vm.expectRevert();campaign.proposeCollection(address(burn721),1,address(burn721).codehash,bytes32(uint256(1)),2,2,1,keccak256("changed"),_now()+3 days);
    }
    function testCreationPredictionIsolationAndDuplicateIntent() public {
        require(factory.predict(ALICE,keccak256("ONE"),ALICE,5 ether,20)==address(campaign));
        vm.prank(ALICE);vm.expectRevert();factory.create(keccak256("ONE"),ALICE,5 ether,20);
        vm.prank(BOB);address b=factory.create(keccak256("ONE"),BOB,5 ether,20);require(b!=address(campaign));
        require(campaign.deploymentFactory()==address(factory)&&campaign.permanentSink()==factory.permanentSink());
    }
    function testFactoryProfilesCannotBeChangedAfterConstruction() public {
        bytes32 old=factory.retirementPolicy(address(burn721).codehash,1,1);
        (bool ok,)=address(factory).call(abi.encodeWithSignature("setRetirementPolicy(bytes32,uint8,uint8,bytes32)",address(burn721).codehash,1,1,keccak256("evil")));require(!ok);
        require(factory.retirementPolicy(address(burn721).codehash,1,1)==old);
    }
    function testCodePartsAreExactStopPrefixedNonExecutingStorage() public {
        bytes memory first=factory.creationPart1().code;bytes memory second=factory.creationPart2().code;require(first[0]==0&&second[0]==0);
        bytes memory combined=new bytes(first.length+second.length-2);for(uint256 i=1;i<first.length;i++)combined[i-1]=first[i];for(uint256 i=1;i<second.length;i++)combined[first.length+i-2]=second[i];
        require(keccak256(combined)==keccak256(type(RMTReclaimCampaignV2).creationCode));
        (bool ok,bytes memory result)=factory.creationPart1().call(hex"ffffffff");require(ok&&result.length==0);
        RMTReclaimCampaignDeployerV2 deployer=RMTReclaimCampaignDeployerV2(factory.campaignDeployer());
        vm.expectRevert();deployer.deploy(ALICE,keccak256("BAD"),ALICE,5 ether,20);
    }
    function testChangingCodePartOrSinkRuntimeStopsCreationAndTrade() public {
        vm.etch(factory.creationPart1(),hex"00");vm.prank(ALICE);vm.expectRevert();factory.create(keccak256("BROKEN"),ALICE,5 ether,20);
        vm.etch(factory.permanentSink(),hex"00");_reject(ALICE,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));require(burn721.exists(1));
    }
    function testUnsupportedChainAndInvalidRewardOrEmptyProfilesReject() public {
        vm.chainId(1);vm.expectRevert();new RMTReclaimFactoryV2(address(token),address(token).codehash,_profiles());vm.chainId(31337);
        vm.expectRevert();new RMTReclaimFactoryV2(address(token),bytes32(uint256(1)),_profiles());
        RMTReclaimFactoryV2.RetirementProfile[] memory empty=new RMTReclaimFactoryV2.RetirementProfile[](0);vm.expectRevert();new RMTReclaimFactoryV2(address(token),address(token).codehash,empty);
    }
    function testNativeBurnRequiresOwnerAuthorizationAndCannotTakeAnotherWalletNFT() public {
        _reject(BOB,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));require(burn721.ownerOf(1)==ALICE);
        vm.prank(ALICE);burn721.setApprovalForAll(address(campaign),false);_reject(ALICE,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));require(burn721.ownerOf(1)==ALICE);
    }
    function testFiniteIdsAndCrossCampaignProofCannotFarmReserve() public {
        burn721.mint(ALICE,99);_reject(ALICE,address(burn721),99,1,1,_leaf(address(burn721),1,1,2,1));
        _reject(ALICE,address(burn721),1,1,1,_leaf(address(sink721),1,2,2,1));require(campaign.paid()==0);_conserved();
    }
    function testConcurrent1155ClaimantsShareGlobalLifetimeLimit() public {
        bytes32 sibling=_leaf(address(burn1155),2,1,102,10);_redeem(ALICE,address(burn1155),101,5,10,sibling);_redeem(BOB,address(burn1155),101,5,10,sibling);
        require(burn1155.totalSupply(101)==0&&campaign.claimedUnits(address(burn1155),101)==10);_reject(ALICE,address(burn1155),101,1,10,sibling);_conserved();
    }
    function testPauseAndStalePolicyLeaveNFTAndRewardUntouched() public {
        vm.prank(ALICE);campaign.pause();_reject(ALICE,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));require(burn721.ownerOf(1)==ALICE);_conserved();
    }
    function testDeadlineNonceRewardAndPolicyCannotBeRepricedOrReplayed() public {
        uint64 epoch=campaign.policyEpoch();uint48 now_=_now();_badRaw(epoch,5 ether,0,now_-1);_badRaw(epoch,5 ether,0,now_+301);
        _badRaw(epoch,5 ether,1,now_+60);_badRaw(epoch,5 ether+1,0,now_+60);_badRaw(epoch+1,5 ether,0,now_+60);
        require(burn721.ownerOf(1)==ALICE&&campaign.claimantNonces(ALICE)==0&&campaign.paid()==0);_conserved();
    }
    function testWalletLifetimeCapCoversDifferentCollections() public {
        _redeem(ALICE,address(sink1155),201,10,10,bytes32(0));_redeem(ALICE,address(burn1155),102,10,10,_leaf(address(burn1155),2,1,101,10));
        _reject(ALICE,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));require(campaign.walletClaimed(ALICE)==20&&burn721.ownerOf(1)==ALICE);_conserved();
    }
    function testCollectionLifetimeCapCoversDifferentWallets() public {
        bytes32 root=_pair(_leaf(address(burn1155),2,1,101,10),_leaf(address(burn1155),2,1,102,10));_admit(address(burn1155),2,1,root,6,6);
        bytes32 sibling=_leaf(address(burn1155),2,1,102,10);_redeem(ALICE,address(burn1155),101,3,10,sibling);_redeem(BOB,address(burn1155),101,3,10,sibling);
        _reject(ALICE,address(burn1155),101,1,10,sibling);require(campaign.collectionClaimed(address(burn1155))==6&&burn1155.totalSupply(101)==4);_conserved();
    }
    function testExhaustedFundedReserveRejectsNextEligibleNFTAtomically() public {
        vm.prank(ALICE);campaign=RMTReclaimCampaignV2(factory.create(keccak256("FIVE_ONLY"),ALICE,5 ether,20));
        vm.startPrank(ALICE);token.approve(address(campaign),5 ether);campaign.fund(5 ether);burn721.setApprovalForAll(address(campaign),true);vm.stopPrank();
        bytes32 a=_leaf(address(burn721),1,1,1,1);bytes32 b=_leaf(address(burn721),1,1,2,1);_admit(address(burn721),1,1,_pair(a,b),2,2);vm.prank(ALICE);campaign.resume();
        _redeem(ALICE,address(burn721),1,1,1,b);_reject(ALICE,address(burn721),2,1,1,a);require(campaign.reserve()==0&&campaign.paid()==5 ether&&burn721.ownerOf(2)==ALICE);_conserved();
    }
    function testExpiredCancelledAndWrongControllerNoticesCannotExecute() public {
        vm.prank(BOB);vm.expectRevert();campaign.proposeRate(7 ether,_now()+3 days);
        vm.prank(ALICE);campaign.proposeRate(7 ether,_now()+3 days);vm.prank(ALICE);campaign.cancelRate();vm.expectRevert();campaign.executeRate();
        vm.prank(ALICE);campaign.proposeRate(7 ether,_now()+3 days);vm.warp(_now()+4 days);vm.expectRevert();campaign.executeRate();vm.prank(BOB);campaign.cancelRate();require(campaign.rewardPerUnit()==5 ether);
    }
    function testControllerNoticeAcceptanceAndEpochPreservePermanentReceipt() public {
        _redeem(ALICE,address(sink721),1,1,1,_leaf(address(sink721),1,2,2,1));
        vm.prank(ALICE);campaign.proposeController(BOB,_now()+3 days);vm.prank(BOB);vm.expectRevert();campaign.acceptController();vm.warp(_now()+2 days);vm.prank(BOB);campaign.acceptController();
        require(campaign.controller()==BOB&&campaign.controllerEpoch()==2&&campaign.paused());require(sink721.ownerOf(1)==factory.permanentSink());
        vm.prank(ALICE);vm.expectRevert();campaign.resume();_conserved();
    }
    function testCloseAndNoticedRecoveryOnlyUncommittedRewardNeverNFT() public {
        _redeem(ALICE,address(sink721),1,1,1,_leaf(address(sink721),1,2,2,1));vm.prank(ALICE);campaign.proposeClose(_now()+3 days);vm.warp(_now()+2 days);campaign.executeClose();
        uint256 held=campaign.reserve();vm.prank(ALICE);campaign.proposeRecovery(held,_now()+3 days);vm.expectRevert();campaign.executeRecovery();vm.warp(_now()+2 days);campaign.executeRecovery();
        require(campaign.reserve()==0&&campaign.recovered()==held&&sink721.ownerOf(1)==factory.permanentSink());_conserved();
    }
    function testUsdAlwaysFailsWithoutInventedReferenceOrBalance() public {vm.expectRevert();campaign.quoteUsd(1,100,_now());vm.expectRevert();campaign.quoteUsd(0,0,0);}
    function testUnsolicitedRewardGiftIsSeparatelyReconciled() public {token.transfer(address(campaign),11);require(campaign.unsolicited()==0);campaign.reconcileSurplus();require(campaign.unsolicited()==11);_conserved();}
    function testUnsolicitedNFTReceiptRejectedAndNeverRewarded() public {vm.prank(ALICE);vm.expectRevert();sink721.safeTransferFrom(ALICE,address(campaign),1);require(campaign.paid()==0&&sink721.ownerOf(1)==ALICE);}
    function testFuzzIntegerRewardConservation(uint8 raw) public {uint256 q=uint256(raw)%5+1;_redeem(ALICE,address(burn1155),101,q,10,_leaf(address(burn1155),2,1,102,10));require(campaign.paid()==q*5 ether&&burn1155.totalSupply(101)==10-q);_conserved();}
    function testFuzzPermanentSinkQuantityConservation(uint8 raw) public {uint256 q=uint256(raw)%10+1;_redeem(ALICE,address(sink1155),201,q,10,bytes32(0));require(campaign.paid()==q*5 ether&&sink1155.balanceOf(factory.permanentSink(),201)==q&&sink1155.totalSupply(201)==10);_conserved();}
}

contract RMTReclaimV2HostileTest is ReclaimV2TestBase {
    function _special(address reward,address asset,uint8 standard,uint8 mode) private {
        RMTReclaimFactoryV2.RetirementProfile[] memory ps=new RMTReclaimFactoryV2.RetirementProfile[](1);ps[0]=RMTReclaimFactoryV2.RetirementProfile(asset.codehash,standard,mode,_policy(asset,standard,mode));
        factory=new RMTReclaimFactoryV2(reward,reward.codehash,ps);vm.prank(ALICE);campaign=RMTReclaimCampaignV2(factory.create(keccak256("COUNTERFACTUAL_TEST"),ALICE,5 ether,20));
        ReclaimV2RewardFixture(reward).transfer(ALICE,1000 ether);vm.startPrank(ALICE);ReclaimV2RewardFixture(reward).approve(address(campaign),1000 ether);campaign.fund(1000 ether);vm.stopPrank();
        _admit(asset,standard,mode,_leaf(asset,standard,mode,1,standard==1?1:10),20,20);vm.prank(ALICE);campaign.resume();
    }
    function testRewardFalseMalformedTaxAndExtraDebitRollbackNativeBurn() public {
        ReclaimV2HostileReward bad=new ReclaimV2HostileReward();_special(address(bad),address(burn721),1,1);vm.prank(ALICE);burn721.approve(address(campaign),1);
        uint256 held=bad.balanceOf(address(campaign));uint256 user=bad.balanceOf(ALICE);uint256 supply=burn721.totalSupply();
        for(uint8 mode=1;mode<=4;mode++){bad.configure(mode,address(0),"");_reject(ALICE,address(burn721),1,1,1,bytes32(0));require(burn721.ownerOf(1)==ALICE&&burn721.totalSupply()==supply&&bad.balanceOf(ALICE)==user&&bad.balanceOf(address(campaign))==held&&campaign.claimedUnits(address(burn721),1)==0&&campaign.tradeInNonce()==0);}
    }
    function testRewardFailureRollsBackSinkTransferAndReservation() public {
        ReclaimV2HostileReward bad=new ReclaimV2HostileReward();_special(address(bad),address(sink721),1,2);vm.prank(ALICE);sink721.approve(address(campaign),1);
        bad.configure(1,address(0),"");_reject(ALICE,address(sink721),1,1,1,bytes32(0));require(sink721.ownerOf(1)==ALICE&&sink721.balanceOf(factory.permanentSink())==0&&campaign.paid()==0&&campaign.reserve()==1000 ether);
    }
    function testHostileFundingCannotInventReserveAndCallbackCannotReenter() public {
        ReclaimV2HostileReward bad=new ReclaimV2HostileReward();_special(address(bad),address(burn721),1,1);bad.transfer(ALICE,100 ether);
        for(uint8 mode=1;mode<=4;mode++){
            bad.configure(mode,address(0),"");vm.startPrank(ALICE);bad.approve(address(campaign),5 ether);vm.expectRevert();campaign.fund(5 ether);vm.stopPrank();
            require(campaign.reserve()==1000 ether&&campaign.funded()==1000 ether&&bad.balanceOf(ALICE)==100 ether&&bad.balanceOf(address(campaign))==1000 ether);
        }
        bad.configure(5,address(campaign),abi.encodeWithSignature("reconcileSurplus()"));vm.startPrank(ALICE);bad.approve(address(campaign),5 ether);campaign.fund(5 ether);vm.stopPrank();
        require(!bad.reentered()&&campaign.reserve()==1005 ether&&campaign.funded()==1005 ether&&bad.balanceOf(ALICE)==95 ether);
    }
    function testRewardCallbackCannotReenterEitherAccountingBoundary() public {
        ReclaimV2HostileReward bad=new ReclaimV2HostileReward();_special(address(bad),address(burn721),1,1);vm.prank(ALICE);burn721.approve(address(campaign),1);
        bad.configure(5,address(campaign),abi.encodeWithSignature("reconcileSurplus()"));_redeem(ALICE,address(burn721),1,1,1,bytes32(0));require(!bad.reentered()&&!burn721.exists(1)&&campaign.paid()==5 ether&&campaign.reserve()==995 ether);
    }
    function testMalformedNativeBurnCannotCollectRewardEvenInCounterfactualProfile() public {
        ReclaimFakeBurn721 bad=new ReclaimFakeBurn721();bad.mint(ALICE,1);_special(address(token),address(bad),1,1);vm.prank(ALICE);bad.approve(address(campaign),1);
        _reject(ALICE,address(bad),1,1,1,bytes32(0));require(bad.ownerOf(1)==ALICE&&bad.totalSupply()==1&&campaign.paid()==0);_conserved();
    }
    function testMalformed1155BurnCannotCollectRewardEvenInCounterfactualProfile() public {
        ReclaimFakeBurn1155 bad=new ReclaimFakeBurn1155();bad.mint(ALICE,1,10);_special(address(token),address(bad),2,1);vm.prank(ALICE);bad.setApprovalForAll(address(campaign),true);
        _reject(ALICE,address(bad),1,3,10,bytes32(0));require(bad.balanceOf(ALICE,1)==10&&bad.totalSupply(1)==10&&campaign.paid()==0);_conserved();
    }
    function testCollectionBurnCallbackCannotReenterAndInterruptedBurnRollsBack() public {
        ReclaimV2Callback721 bad=new ReclaimV2Callback721();bad.mint(ALICE,1);_special(address(token),address(bad),1,1);vm.prank(ALICE);bad.approve(address(campaign),1);
        bad.configure(address(campaign),true);_reject(ALICE,address(bad),1,1,1,bytes32(0));require(bad.ownerOf(1)==ALICE&&campaign.paid()==0);
        bad.configure(address(campaign),false);_redeem(ALICE,address(bad),1,1,1,bytes32(0));require(!bad.reentered()&&!bad.exists(1)&&campaign.paid()==5 ether);_conserved();
    }
}
