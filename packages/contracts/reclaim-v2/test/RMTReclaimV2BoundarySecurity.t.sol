// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReclaimV2TestBase} from "./RMTReclaimV2.t.sol";
import {ReclaimV2RewardFixture, ReclaimBurn721Fixture, ReclaimFakeBurn721, ReclaimIssuerRecovery721} from "./ReclaimV2Assets.sol";
import {RMTReclaimFactoryV2} from "../src/RMTReclaimFactoryV2.sol";
import {RMTReclaimCampaignV2} from "../src/RMTReclaimCampaignV2.sol";

interface BoundaryVm { function expectRevert(bytes4) external; function deal(address,uint256) external; }
interface BoundaryReceiver721 { function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4); }

/// @dev Counterfactual dependency only. The canonical RMT token is not mutable.
/// Modes deliberately violate one exact transfer delta, or observe a guarded
/// callback. Admitting this source as a real reward policy is NOT proposed.
contract BoundaryRewardToken is ReclaimV2RewardFixture {
    uint8 public fault;
    address public callbackTarget;
    address public observedActor;
    bool public callbackSucceeded;
    bytes4 public callbackError;
    uint256 public seenReserve;
    uint256 public seenPaid;
    uint256 public seenFunded;
    uint64 public seenClaimantNonce;
    function configure(uint8 next,address target,address actor) external {fault=next;callbackTarget=target;observedActor=actor;}
    function _move(address from,address to,uint256 amount) internal override {
        balanceOf[from]-=amount+(fault==1?1:0);
        uint256 credit=amount-(fault==2?1:0);balanceOf[to]+=credit;emit Transfer(from,to,credit);
        if(fault==3){
            RMTReclaimCampaignV2 c=RMTReclaimCampaignV2(callbackTarget);
            seenReserve=c.reserve();seenPaid=c.paid();seenFunded=c.funded();seenClaimantNonce=c.claimantNonces(observedActor);
            bytes memory result;(callbackSucceeded,result)=callbackTarget.call(abi.encodeCall(c.reconcileSurplus,()));
            if(result.length>=4){bytes4 selector;assembly("memory-safe"){selector:=mload(add(result,32))}callbackError=selector;}
        }
    }
}

/// @dev Another deliberately unapproved source. Modes keep other observations
/// correct while breaking only the selected balance/supply assertion. Its
/// configuration and issuer-like authority are why it is never a live profile.
contract BoundaryNFT721 {
    mapping(uint256=>address) private owners;
    mapping(address=>uint256) private balances;
    mapping(uint256=>address) public getApproved;
    uint256 public totalSupply;
    uint8 public fault;
    address public callbackTarget;
    bool public callbackSucceeded;
    bytes4 public callbackError;
    uint256 public seenPaid;
    uint256 public seenReserve;
    uint64 public seenClaimantNonce;
    event Transfer(address indexed from,address indexed to,uint256 indexed tokenId);
    event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId);
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0x80ac58cd;}
    function ownerOf(uint256 id) public view returns(address){require(owners[id]!=address(0),"NONEXISTENT");return owners[id];}
    function exists(uint256 id) external view returns(bool){return owners[id]!=address(0);}
    function balanceOf(address owner) external view returns(uint256){require(owner!=address(0));return balances[owner];}
    function mint(address to,uint256 id) external {require(owners[id]==address(0));owners[id]=to;balances[to]++;totalSupply++;emit Transfer(address(0),to,id);}
    function approve(address to,uint256 id) external {require(ownerOf(id)==msg.sender);getApproved[id]=to;emit Approval(msg.sender,to,id);}
    function configure(uint8 next,address target) external {fault=next;callbackTarget=target;}
    function _callback(address actor) private {
        if(fault!=6)return;RMTReclaimCampaignV2 c=RMTReclaimCampaignV2(callbackTarget);
        seenPaid=c.paid();seenReserve=c.reserve();seenClaimantNonce=c.claimantNonces(actor);
        bytes memory result;(callbackSucceeded,result)=callbackTarget.call(abi.encodeCall(c.reconcileSurplus,()));
        if(result.length>=4){bytes4 selector;assembly("memory-safe"){selector:=mload(add(result,32))}callbackError=selector;}
    }
    function burn(uint256 id) external {
        address actor=ownerOf(id);require(getApproved[id]==msg.sender);delete owners[id];delete getApproved[id];
        if(fault!=1)balances[actor]--;if(fault!=5)totalSupply--;emit Transfer(actor,address(0),id);_callback(actor);
        if(fault==7)revert("INTERRUPTED_AFTER_RETIREMENT");
    }
    function safeTransferFrom(address from,address to,uint256 id,bytes calldata data) external {
        require(ownerOf(id)==from&&getApproved[id]==msg.sender);owners[id]=to;delete getApproved[id];
        if(fault!=2)balances[from]--;if(fault!=3)balances[to]++;if(fault==4)totalSupply--;
        emit Transfer(from,to,id);require(BoundaryReceiver721(to).onERC721Received(msg.sender,from,id,data)==0x150b7a02);_callback(from);
        if(fault==7)revert("INTERRUPTED_AFTER_RETIREMENT");
    }
}

contract BoundaryForceEther { constructor(address payable target) payable {selfdestruct(target);} }

contract RMTReclaimV2BoundarySecurityTest is ReclaimV2TestBase {
    BoundaryVm private constant boundaryVm=BoundaryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function _special(ReclaimV2RewardFixture reward,address asset,uint8 retirementMode) private {
        token=reward;RMTReclaimFactoryV2.RetirementProfile[] memory ps=new RMTReclaimFactoryV2.RetirementProfile[](1);
        ps[0]=RMTReclaimFactoryV2.RetirementProfile(asset.codehash,1,retirementMode,_policy(asset,1,retirementMode));
        factory=new RMTReclaimFactoryV2(address(reward),address(reward).codehash,ps);
        vm.prank(ALICE);campaign=RMTReclaimCampaignV2(factory.create(keccak256("TASK080_COUNTERFACTUAL_BOUNDARY_ONLY"),ALICE,5 ether,20));
        reward.transfer(ALICE,1000 ether);vm.startPrank(ALICE);reward.approve(address(campaign),1000 ether);campaign.fund(1000 ether);vm.stopPrank();
        _admit(asset,1,retirementMode,_leaf(asset,1,retirementMode,1,1),20,20);vm.prank(ALICE);campaign.resume();
    }
    function _state(address asset) private view returns(bytes32){
        return keccak256(abi.encode(token.balanceOf(ALICE),token.balanceOf(address(campaign)),token.allowance(ALICE,address(campaign)),
            campaign.reserve(),campaign.funded(),campaign.paid(),campaign.recovered(),campaign.unsolicited(),campaign.tradeInNonce(),
            campaign.claimantNonces(ALICE),campaign.walletClaimed(ALICE),campaign.collectionClaimed(asset),campaign.collectionWalletClaimed(asset,ALICE),
            campaign.claimedUnits(asset,1),campaign.policyEpoch(),campaign.controllerEpoch()));
    }
    function _rejectDelta(address asset) private {
        bytes32 before_=_state(asset);
        (uint256[] memory ids,uint256[] memory quantities,uint256[] memory maximum,bytes32[][] memory proofs)=_arrays(1,1,1,bytes32(0));
        uint64 epoch=campaign.policyEpoch();uint48 deadline=_now()+60;
        vm.prank(ALICE);boundaryVm.expectRevert(RMTReclaimCampaignV2.UnsupportedAssetBehavior.selector);
        campaign.redeem(asset,ids,quantities,maximum,proofs,epoch,5 ether,0,deadline);
        require(_state(asset)==before_,"ATOMIC_LEDGER_ROLLBACK");
        (address claimant,,,,,,, ,)=campaign.tradeIns(1);require(claimant==address(0),"NO_PARTIAL_RECEIPT");
    }
    function _badToken(uint8 fault) private returns(BoundaryRewardToken bad){
        bad=new BoundaryRewardToken();_special(bad,address(burn721),1);vm.prank(ALICE);burn721.approve(address(campaign),1);bad.configure(fault,address(0),ALICE);
    }
    function _badNFT(uint8 mode,uint8 fault) private returns(BoundaryNFT721 bad){
        bad=new BoundaryNFT721();bad.mint(ALICE,1);_special(token,address(bad),mode);vm.prank(ALICE);bad.approve(address(campaign),1);bad.configure(fault,address(0));
    }
    // All seven IDs are still retained by the unchanged all-detector analysis.
    function testHigh038203PayCampaignDebitBaselineRejectsExtraDebitAndRestoresBurn() public {
        _badToken(1);_rejectDelta(address(burn721));require(burn721.ownerOf(1)==ALICE&&burn721.totalSupply()==2);_conserved();
    }
    function testHigh42aa40PayBeneficiaryCreditBaselineRejectsUndercreditAndRestoresBurn() public {
        _badToken(2);_rejectDelta(address(burn721));require(burn721.ownerOf(1)==ALICE&&burn721.totalSupply()==2);_conserved();
    }
    function _fundDelta(uint8 fault) private {
        BoundaryRewardToken bad=new BoundaryRewardToken();_special(bad,address(burn721),1);bad.transfer(ALICE,10 ether);
        vm.prank(ALICE);bad.approve(address(campaign),5 ether);bytes32 before_=_state(address(burn721));bad.configure(fault,address(0),ALICE);
        vm.prank(ALICE);boundaryVm.expectRevert(RMTReclaimCampaignV2.UnsupportedAssetBehavior.selector);campaign.fund(5 ether);
        require(_state(address(burn721))==before_,"FUNDING_AND_ALLOWANCE_ROLLBACK");_conserved();
    }
    function testHigha96183PullControllerDebitBaselineRejectsExtraDebit() public {_fundDelta(1);}
    function testHighc2a152PullCampaignCreditBaselineRejectsUndercredit() public {_fundDelta(2);}
    function testHighbea68aNativeBurnOwnerBalanceMustActuallyDecrease() public {
        BoundaryNFT721 bad=_badNFT(1,1);_rejectDelta(address(bad));require(bad.ownerOf(1)==ALICE&&bad.balanceOf(ALICE)==1&&bad.totalSupply()==1);_conserved();
    }
    function testHigh52cf77SinkTransferOwnerBalanceMustActuallyDecrease() public {
        BoundaryNFT721 bad=_badNFT(2,2);_rejectDelta(address(bad));require(bad.ownerOf(1)==ALICE&&bad.balanceOf(ALICE)==1&&bad.balanceOf(factory.permanentSink())==0);_conserved();
    }
    function testHigh8bcc09SinkBalanceMustActuallyIncrease() public {
        BoundaryNFT721 bad=_badNFT(2,3);_rejectDelta(address(bad));require(bad.ownerOf(1)==ALICE&&bad.balanceOf(ALICE)==1&&bad.balanceOf(factory.permanentSink())==0);_conserved();
    }
    function testCorrectBalancesDoNotSubstituteForBurnSupplyDestruction() public {
        BoundaryNFT721 bad=_badNFT(1,5);_rejectDelta(address(bad));require(bad.exists(1)&&bad.totalSupply()==1);_conserved();
    }
    function testSinkRetirementMustNotMasqueradeAsSupplyDestruction() public {
        BoundaryNFT721 bad=_badNFT(2,4);_rejectDelta(address(bad));require(bad.exists(1)&&bad.totalSupply()==1);_conserved();
    }
    function testFundingCallbackObservesCommittedReserveButGuardRejectsNestedAccounting() public {
        BoundaryRewardToken bad=new BoundaryRewardToken();_special(bad,address(burn721),1);bad.transfer(ALICE,10 ether);
        bad.configure(3,address(campaign),ALICE);vm.startPrank(ALICE);bad.approve(address(campaign),5 ether);campaign.fund(5 ether);vm.stopPrank();
        require(!bad.callbackSucceeded()&&bad.callbackError()==RMTReclaimCampaignV2.ReentrantCall.selector);
        require(bad.seenFunded()==1005 ether&&bad.seenReserve()==1005 ether&&bad.seenPaid()==0);_conserved();
    }
    function testRewardCallbackObservesConsumedNonceAndGuardRejectsNestedAccounting() public {
        BoundaryRewardToken bad=_badToken(0);bad.configure(3,address(campaign),ALICE);_redeem(ALICE,address(burn721),1,1,1,bytes32(0));
        require(!bad.callbackSucceeded()&&bad.callbackError()==RMTReclaimCampaignV2.ReentrantCall.selector);
        require(bad.seenPaid()==5 ether&&bad.seenReserve()==995 ether&&bad.seenClaimantNonce()==1&&!burn721.exists(1));_conserved();
    }
    function testNativeBurnCallbackObservesReservedRewardButCannotEnterBeforePayment() public {
        BoundaryNFT721 bad=_badNFT(1,0);bad.configure(6,address(campaign));_redeem(ALICE,address(bad),1,1,1,bytes32(0));
        require(!bad.callbackSucceeded()&&bad.callbackError()==RMTReclaimCampaignV2.ReentrantCall.selector);
        require(bad.seenPaid()==5 ether&&bad.seenReserve()==995 ether&&bad.seenClaimantNonce()==1&&!bad.exists(1));_conserved();
    }
    function testSinkTransferCallbackObservesReservedRewardButCannotEnterBeforePayment() public {
        BoundaryNFT721 bad=_badNFT(2,0);bad.configure(6,address(campaign));_redeem(ALICE,address(bad),1,1,1,bytes32(0));
        require(!bad.callbackSucceeded()&&bad.callbackError()==RMTReclaimCampaignV2.ReentrantCall.selector);
        require(bad.seenPaid()==5 ether&&bad.seenReserve()==995 ether&&bad.seenClaimantNonce()==1&&bad.ownerOf(1)==factory.permanentSink());_conserved();
    }
    function testInterruptedBurnAndSinkInteractionRestoreAllLifetimeState() public {
        for(uint8 mode=1;mode<=2;mode++){
            BoundaryNFT721 bad=_badNFT(mode,7);bytes32 before_=_state(address(bad));_reject(ALICE,address(bad),1,1,1,bytes32(0));
            require(_state(address(bad))==before_&&bad.ownerOf(1)==ALICE&&bad.balanceOf(ALICE)==1&&bad.totalSupply()==1);_conserved();
        }
    }
    function testMalformedAndIssuerControlledRuntimeCannotEnterKnownFactoryPolicy() public {
        address[3] memory bad=[address(new ReclaimFakeBurn721()),address(new ReclaimIssuerRecovery721()),address(new BoundaryNFT721())];
        for(uint256 i;i<bad.length;i++){
            address asset=bad[i];vm.prank(ALICE);boundaryVm.expectRevert(RMTReclaimCampaignV2.InvalidAsset.selector);
            campaign.proposeCollection(asset,1,asset.codehash,bytes32(uint256(1)),2,2,1,_policy(asset,1,1),_now()+3 days);
        }
        require(campaign.paid()==0&&campaign.tradeInNonce()==0);_conserved();
    }
    function testStaleClaimantNonceCannotRedeemAnotherOtherwiseEligibleID() public {
        _redeem(ALICE,address(burn721),1,1,1,_leaf(address(burn721),1,1,2,1));
        (uint256[] memory ids,uint256[] memory quantities,uint256[] memory maximum,bytes32[][] memory proofs)=_arrays(2,1,1,_leaf(address(burn721),1,1,1,1));
        uint64 epoch=campaign.policyEpoch();uint48 deadline=_now()+60;bytes32 before_=_state(address(burn721));
        vm.prank(ALICE);boundaryVm.expectRevert(RMTReclaimCampaignV2.InvalidQuote.selector);campaign.redeem(address(burn721),ids,quantities,maximum,proofs,epoch,5 ether,0,deadline);
        require(_state(address(burn721))==before_&&burn721.ownerOf(2)==ALICE);_conserved();
    }
    function testForcedUnsafeNFTAndEtherCreateNoRewardOrWithdrawalAuthority() public {
        uint256 beforeReserve=campaign.reserve();vm.prank(ALICE);sink721.transferFrom(ALICE,address(campaign),1);
        boundaryVm.deal(address(this),1);new BoundaryForceEther{value:1}(payable(address(campaign)));
        require(address(campaign).balance==1&&sink721.ownerOf(1)==address(campaign)&&campaign.reserve()==beforeReserve&&campaign.paid()==0);
        vm.prank(ALICE);(bool ok,)=address(campaign).call(abi.encodeWithSignature("withdrawNFT(address,uint256,address)",address(sink721),1,ALICE));require(!ok);
        require(campaign.claimedUnits(address(sink721),1)==0&&campaign.tradeInNonce()==0);_conserved();
    }
    function testUnsolicitedERC20GiftCannotBeClaimedAsAnUnretiredNFTReward() public {
        uint256 before=campaign.reserve();token.transfer(address(campaign),17);campaign.reconcileSurplus();
        require(campaign.reserve()==before+17&&campaign.unsolicited()==17&&campaign.paid()==0&&campaign.tradeInNonce()==0);_conserved();
    }
}
