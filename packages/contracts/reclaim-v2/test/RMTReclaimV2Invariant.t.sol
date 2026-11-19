// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ReclaimV2TestBase,ReclaimV2Vm} from "./RMTReclaimV2.t.sol";
import {RMTReclaimCampaignV2} from "../src/RMTReclaimCampaignV2.sol";
import {ReclaimV2RewardFixture,ReclaimBurn721Fixture,ReclaimSink721Fixture,ReclaimBurn1155Fixture,ReclaimSink1155Fixture} from "./ReclaimV2Assets.sol";

contract ReclaimV2InvariantHandler {
    ReclaimV2Vm constant vm=ReclaimV2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant OWNER=address(0x100001);
    ReclaimV2RewardFixture public immutable token;RMTReclaimCampaignV2 public immutable campaign;
    ReclaimBurn721Fixture public immutable burned;ReclaimSink721Fixture public immutable sunk;
    ReclaimBurn1155Fixture public immutable burned1155;ReclaimSink1155Fixture public immutable sunk1155;
    bytes32 public immutable burnFirst;bytes32 public immutable burnSecond;bytes32 public immutable sinkFirst;bytes32 public immutable sinkSecond;
    bytes32 public immutable multiFirst;bytes32 public immutable multiSecond;
    constructor(ReclaimV2RewardFixture t,RMTReclaimCampaignV2 c,ReclaimBurn721Fixture a,ReclaimSink721Fixture b,ReclaimBurn1155Fixture d,ReclaimSink1155Fixture e,bytes32[6]memory leaves){
        token=t;campaign=c;burned=a;sunk=b;burned1155=d;sunk1155=e;burnFirst=leaves[0];burnSecond=leaves[1];sinkFirst=leaves[2];sinkSecond=leaves[3];multiFirst=leaves[4];multiSecond=leaves[5];
    }
    function fund(uint96 raw)external{uint256 amount=uint256(raw)%1 ether+1;if(token.balanceOf(OWNER)<amount)return;vm.startPrank(OWNER);token.approve(address(campaign),amount);campaign.fund(amount);vm.stopPrank();}
    function gift(uint96 raw)external{uint256 amount=uint256(raw)%1e12+1;if(token.balanceOf(OWNER)<amount)return;vm.prank(OWNER);token.transfer(address(campaign),amount);campaign.reconcileSurplus();}
    function pause()external{vm.prank(OWNER);campaign.pause();}
    function resume()external{vm.prank(OWNER);try campaign.resume(){}catch{}}
    function _claim(address asset,uint256 id,uint256 qty,uint256 maximum,bytes32 sibling)private{
        uint256[]memory ids=new uint256[](1);ids[0]=id;uint256[]memory amounts=new uint256[](1);amounts[0]=qty;uint256[]memory maxima=new uint256[](1);maxima[0]=maximum;
        bytes32[][]memory proofs=new bytes32[][](1);proofs[0]=new bytes32[](sibling==bytes32(0)?0:1);if(sibling!=bytes32(0))proofs[0][0]=sibling;
        uint64 epoch=campaign.policyEpoch();uint256 reward=uint256(campaign.rewardPerUnit())*qty;uint64 nonce=campaign.claimantNonces(OWNER);uint48 deadline=uint48(vm.getBlockTimestamp()+60);
        vm.prank(OWNER);try campaign.redeem(asset,ids,amounts,maxima,proofs,epoch,reward,nonce,deadline){}catch{}
    }
    function native721(uint256 raw)external{uint256 id=raw%2+1;if(!burned.exists(id)||campaign.claimedUnits(address(burned),id)!=0)return;_claim(address(burned),id,1,1,id==1?burnSecond:burnFirst);}
    function sink721(uint256 raw)external{uint256 id=raw%2+1;if(campaign.claimedUnits(address(sunk),id)!=0||sunk.ownerOf(id)!=OWNER)return;_claim(address(sunk),id,1,1,id==1?sinkSecond:sinkFirst);}
    function native1155(uint256 raw)external{uint256 id=raw%2+101;uint256 balance=burned1155.balanceOf(OWNER,id);if(balance==0)return;uint256 amount=raw%balance+1;_claim(address(burned1155),id,amount,10,id==101?multiSecond:multiFirst);}
    function sink1155(uint256 raw)external{uint256 balance=sunk1155.balanceOf(OWNER,201);if(balance==0)return;_claim(address(sunk1155),201,raw%balance+1,10,bytes32(0));}
}
contract RMTReclaimV2InvariantTest is ReclaimV2TestBase {
    ReclaimV2InvariantHandler handler;
    function setUp()public override{super.setUp();bytes32[6]memory leaves=[_leaf(address(burn721),1,1,1,1),_leaf(address(burn721),1,1,2,1),_leaf(address(sink721),1,2,1,1),_leaf(address(sink721),1,2,2,1),_leaf(address(burn1155),2,1,101,10),_leaf(address(burn1155),2,1,102,10)];handler=new ReclaimV2InvariantHandler(token,campaign,burn721,sink721,burn1155,sink1155,leaves);}
    function targetContracts()external view returns(address[]memory result){result=new address[](1);result[0]=address(handler);}
    function invariantEveryPaidRewardHasPermanentRetirementAndConservedBacking()external view{
        _conserved();require(campaign.creator()==ALICE&&campaign.controller()==ALICE&&token.totalSupply()==1_000_000_000 ether);
        uint256 burnedCount;
        for(uint256 id=1;id<=2;id++){
            uint256 n=campaign.claimedUnits(address(burn721),id);require(n<=1&&burn721.exists(id)==(n==0));burnedCount+=n;
            require(sink721.ownerOf(id)==(campaign.claimedUnits(address(sink721),id)==0?ALICE:factory.permanentSink()));
        }
        require(burn721.totalSupply()==2-burnedCount);
        for(uint256 id=101;id<=102;id++)require(burn1155.totalSupply(id)+campaign.claimedUnits(address(burn1155),id)==10);
        require(sink1155.totalSupply(201)==10&&sink1155.balanceOf(factory.permanentSink(),201)==campaign.claimedUnits(address(sink1155),201));
        uint256 rewards;for(uint64 id=1;id<=campaign.tradeInNonce();id++){(address claimant,,, ,uint256 reward,,uint8 state,uint8 mode,address destination)=campaign.tradeIns(id);require(claimant==ALICE&&state==1&&(mode==1?destination==address(0):destination==factory.permanentSink()));rewards+=reward;}
        require(rewards==campaign.paid());
    }
}
