// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ReclaimTestBase,ReclaimVm} from "./RMTReclaimV1.t.sol";
import {RMTReclaimCampaignV1} from "../src/RMTReclaimCampaignV1.sol";
import {RMTReclaimFactoryV1} from "../src/RMTReclaimFactoryV1.sol";
import {Reclaim721Fixture,ReclaimRewardFixture,ReclaimHostileReward,ReclaimHostile721,ReclaimHostile1155,ReclaimRejectNFTReceiver} from "./ReclaimAssets.sol";

/// @notice Counterfactual admitted malicious dependencies test observable
/// rollback and guard boundaries. These are NOT the actual core Token V2.
contract RMTReclaimHostileTest is ReclaimTestBase {
    function _hostileReward()internal returns(ReclaimHostileReward reward){
        reward=new ReclaimHostileReward();token=ReclaimRewardFixture(address(reward));factory=new RMTReclaimFactoryV1(address(reward),address(reward).codehash);
        vm.prank(ALICE);campaign=RMTReclaimCampaignV1(factory.create(keccak256("hostile"),ALICE,5 ether,20));
        reward.transfer(ALICE,3000 ether);vm.startPrank(ALICE);reward.approve(address(campaign),2000 ether);campaign.fund(2000 ether);nft.setApprovalForAll(address(campaign),true);vm.stopPrank();
        leaf1=_leaf(address(nft),1,1,1);leaf2=_leaf(address(nft),1,2,1);_admit(address(nft),1,_pair(leaf1,leaf2),10,10);vm.prank(ALICE);campaign.resume();
    }
    function testHostileRewardFalseMalformedFeeAndExtraDebitRollbackNftAndEveryCredit()public{
        ReclaimHostileReward reward=_hostileReward();uint256 balance=reward.balanceOf(ALICE);
        for(uint8 mode=1;mode<=4;mode++){
            reward.configure(mode,address(0),"");_rejectRedeem(ALICE,address(nft),1,1,1,leaf2);
            require(nft.ownerOf(1)==ALICE&&campaign.tradeInNonce()==0&&campaign.claimantNonces(ALICE)==0&&reward.balanceOf(ALICE)==balance);
            require(campaign.paid()==0&&campaign.reserve()==2000 ether&&campaign.claimedUnits(address(nft),1)==0);_conserved();
        }
        reward.configure(0,address(0),"");_redeem(ALICE,address(nft),1,1,1,leaf2);_conserved();
    }
    function testHostileRewardCannotReenterFundPayoutOrReturn()public{
        ReclaimHostileReward reward=_hostileReward();reward.configure(5,address(campaign),abi.encodeCall(campaign.reconcileSurplus,()));
        uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);require(!reward.callbackSucceeded());
        vm.startPrank(ALICE);reward.approve(address(campaign),5 ether);campaign.returnTradeIn(id,_now()+60);vm.stopPrank();require(!reward.callbackSucceeded());_conserved();
    }
    function testHostileFundingDeltaCannotIncreaseAdvertisedReserve()public{
        ReclaimHostileReward reward=_hostileReward();reward.configure(3,address(0),"");vm.startPrank(ALICE);reward.approve(address(campaign),5 ether);vm.expectRevert();campaign.fund(5 ether);vm.stopPrank();
        require(campaign.funded()==2000 ether&&campaign.reserve()==2000 ether);_conserved();
    }
    function testRevertingWrongAndMissing721CallbacksOrWrongCustodyCannotPayRewards()public{
        ReclaimHostile721 hostile=new ReclaimHostile721();hostile.mint(ALICE,100);_admit(address(hostile),1,_leaf(address(hostile),1,100,1),10,10);
        vm.prank(ALICE);hostile.setApprovalForAll(address(campaign),true);uint256 balance=token.balanceOf(ALICE);
        for(uint8 mode=1;mode<=4;mode++){
            hostile.configure(mode,address(campaign));_rejectRedeem(ALICE,address(hostile),100,1,1,bytes32(0));
            require(hostile.ownerOf(100)==ALICE&&campaign.paid()==0&&campaign.tradeInNonce()==0&&token.balanceOf(ALICE)==balance);_conserved();
        }
        hostile.configure(5,address(campaign));_redeem(ALICE,address(hostile),100,1,1,bytes32(0));require(!hostile.callbackSucceeded());_conserved();
    }
    function testWrong1155CallbackAndShortRecipientOrExtraSenderDebitRollbackAllUnits()public{
        ReclaimHostile1155 hostile=new ReclaimHostile1155();hostile.mint(ALICE,100,10);_admit(address(hostile),2,_leaf(address(hostile),2,100,5),10,10);
        vm.prank(ALICE);hostile.setApprovalForAll(address(campaign),true);
        for(uint8 mode=1;mode<=4;mode++){
            hostile.configure(mode,address(campaign));_rejectRedeem(ALICE,address(hostile),100,2,5,bytes32(0));
            require(hostile.balanceOf(ALICE,100)==10&&hostile.balanceOf(address(campaign),100)==0&&campaign.paid()==0&&campaign.claimedUnits(address(hostile),100)==0);_conserved();
        }
        hostile.configure(5,address(campaign));_redeem(ALICE,address(hostile),100,2,5,bytes32(0));require(!hostile.callbackSucceeded());_conserved();
    }
    function testRejectedNftReturnRollsBackRepaymentAndKeepsReceiptClaimable()public{
        ReclaimRejectNFTReceiver receiver=new ReclaimRejectNFTReceiver();nft.mint(address(receiver),99);
        _admit(address(nft),1,_leaf(address(nft),1,99,1),10,10);
        receiver.run(address(nft),abi.encodeCall(nft.approve,(address(campaign),99)));
        (uint256[]memory ids,uint256[]memory qty,uint256[]memory max,bytes32[][]memory proofs)=_arrays(99,1,1,bytes32(0));
        receiver.run(address(campaign),abi.encodeCall(campaign.redeem,(address(nft),ids,qty,max,proofs,campaign.policyEpoch(),5 ether,uint64(0),_now()+60)));
        receiver.run(address(token),abi.encodeCall(token.approve,(address(campaign),5 ether)));
        uint256 reserve=campaign.reserve();vm.expectRevert();receiver.run(address(campaign),abi.encodeCall(campaign.returnTradeIn,(uint64(1),_now()+60)));
        require(nft.ownerOf(99)==address(campaign)&&token.balanceOf(address(receiver))==5 ether&&campaign.reserve()==reserve&&campaign.repaid()==0);
        (,,,,,,uint8 state)=campaign.tradeIns(1);require(state==1);_conserved();
    }
    function testInterruptedRewardRepaymentCannotReleaseNftOrConsumeReceipt()public{
        ReclaimHostileReward reward=_hostileReward();uint64 id=_redeem(ALICE,address(nft),1,1,1,leaf2);
        reward.configure(1,address(0),"");vm.startPrank(ALICE);reward.approve(address(campaign),5 ether);vm.expectRevert();campaign.returnTradeIn(id,_now()+60);vm.stopPrank();
        require(nft.ownerOf(1)==address(campaign)&&campaign.repaid()==0);(,,,,,,uint8 state)=campaign.tradeIns(id);require(state==1);_conserved();
    }
}

contract ReclaimInvariantHandler {
    ReclaimVm constant vm=ReclaimVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ReclaimRewardFixture public immutable token;RMTReclaimCampaignV1 public immutable campaign;
    Reclaim721Fixture public immutable nft;bytes32 public immutable first;bytes32 public immutable second;
    address constant OWNER=address(0x100001);
    constructor(ReclaimRewardFixture t,RMTReclaimCampaignV1 c,Reclaim721Fixture n,bytes32 a,bytes32 b){token=t;campaign=c;nft=n;first=a;second=b;}
    function fund(uint96 raw)external{uint256 amount=uint256(raw)%1 ether+1;if(token.balanceOf(OWNER)<amount)return;vm.startPrank(OWNER);token.approve(address(campaign),amount);campaign.fund(amount);vm.stopPrank();}
    function gift(uint96 raw)external{uint256 amount=uint256(raw)%1e12+1;if(token.balanceOf(OWNER)<amount)return;vm.prank(OWNER);token.transfer(address(campaign),amount);campaign.reconcileSurplus();}
    function pause()external{vm.prank(OWNER);campaign.pause();}
    function resume()external{vm.prank(OWNER);try campaign.resume(){}catch{}}
    function redeem721(uint256 raw)external{
        uint256 id=raw%2+1;if(campaign.claimedUnits(address(nft),id)!=0||nft.ownerOf(id)!=OWNER)return;
        uint256[]memory ids=new uint256[](1);ids[0]=id;uint256[]memory qty=new uint256[](1);qty[0]=1;uint256[]memory max=new uint256[](1);max[0]=1;
        bytes32[][]memory proofs=new bytes32[][](1);proofs[0]=new bytes32[](1);proofs[0][0]=id==1?second:first;
        uint64 epoch=campaign.policyEpoch();uint256 reward=campaign.rewardPerUnit();uint64 nonce=campaign.claimantNonces(OWNER);uint48 deadline=uint48(vm.getBlockTimestamp()+60);
        vm.prank(OWNER);try campaign.redeem(address(nft),ids,qty,max,proofs,epoch,reward,nonce,deadline){}catch{}
    }
    function returnReceipt(uint256 raw)external{
        uint64 count=campaign.tradeInNonce();if(count==0)return;uint64 id=uint64(raw%count)+1;(,,,,uint256 reward,,uint8 state)=campaign.tradeIns(id);if(state!=1)return;
        vm.startPrank(OWNER);token.approve(address(campaign),reward);try campaign.returnTradeIn(id,uint48(vm.getBlockTimestamp()+60)){}catch{}vm.stopPrank();
    }
}
contract RMTReclaimInvariantTest is ReclaimTestBase {
    ReclaimInvariantHandler handler;
    function setUp()public override{super.setUp();handler=new ReclaimInvariantHandler(token,campaign,nft,leaf1,leaf2);}
    function targetContracts()external view returns(address[]memory result){result=new address[](1);result[0]=address(handler);}
    function invariantSegregatedReservesAndNoUnpaidRewardLiability()external view{
        _conserved();require(campaign.creator()==ALICE&&campaign.controller()==ALICE&&token.totalSupply()==1_000_000_000 ether);
        for(uint64 id=1;id<=campaign.tradeInNonce();id++){(address claimant,,,,,,uint8 state)=campaign.tradeIns(id);(uint256[]memory ids,)=campaign.receiptItems(id);require(nft.ownerOf(ids[0])==(state==1?address(campaign):claimant));}
    }
}
