// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SeaportAcquisitionBase,VmAcquisitionV2} from "./SeaportAcquisition.t.sol";
import {RMTSeaportAcquisitionVaultV2 as Vault} from "../src/RMTSeaportAcquisitionVaultV2.sol";
import {SeaportAcquisitionTypes as T,IAcquisitionSeaport} from "../src/SeaportAcquisitionTypes.sol";
import {Acquisition1155Fixture} from "../../nft-acquisition/test/fixtures/NftAcquisitionAssets.sol";

contract SeaportV2InvariantHandler {
    VmAcquisitionV2 private constant vm=VmAcquisitionV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    Vault public immutable vault; IAcquisitionSeaport public immutable seaport; Acquisition1155Fixture public immutable nft; address public immutable seller;
    address private constant CREATOR=address(0x100001);address payable private constant FEE=payable(address(0x100003));address payable private constant ROYALTY=payable(address(0x100004));
    uint256 private next=1000;uint256[] private acquired;
    constructor(Vault v,IAcquisitionSeaport s,Acquisition1155Fixture n,address owner){vault=v;seaport=s;nft=n;seller=owner;}
    function buy(uint96 raw) external {
        uint256 id=next++;nft.mint(seller,id,2);vm.warp(vm.getBlockTimestamp()+2);
        uint256 total=(uint256(raw)%.01 ether+1)*10000;
        if(total>1 ether)total=.1 ether;
        T.AdvancedOrder memory a;a.parameters.offerer=seller;a.parameters.offer=new T.OfferItem[](1);a.parameters.offer[0]=T.OfferItem(3,address(nft),id,2,2);
        a.parameters.consideration=new T.ConsiderationItem[](3);
        a.parameters.consideration[0]=T.ConsiderationItem(0,address(0),0,total*925/1000,total*925/1000,payable(seller));
        a.parameters.consideration[1]=T.ConsiderationItem(0,address(0),0,total*25/1000,total*25/1000,FEE);
        a.parameters.consideration[2]=T.ConsiderationItem(0,address(0),0,total*50/1000,total*50/1000,ROYALTY);
        a.parameters.startTime=vm.getBlockTimestamp()-1;a.parameters.endTime=vm.getBlockTimestamp()+60;a.parameters.salt=id;a.parameters.totalOriginalConsiderationItems=3;a.numerator=1;a.denominator=1;
        bytes32 hash=seaport.getOrderHash(T.OrderComponents(seller,address(0),a.parameters.offer,a.parameters.consideration,0,a.parameters.startTime,a.parameters.endTime,bytes32(0),id,bytes32(0),0));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(0xA11CE,keccak256(abi.encodePacked(hex"1901",vault.domainSeparator(),hash)));a.signature=abi.encodePacked(r,s,v);
        T.Request memory request=T.Request(hash,0,vault.policyEpoch(),vault.controllerEpoch(),uint48(vm.getBlockTimestamp()+60));
        try vault.purchase(a,request){acquired.push(id);}catch{}
    }
    function enabled(bool value) external {vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),value);}
    function fund(uint32 raw) external {vm.prank(CREATOR);vault.fundNative{value:uint256(raw)+1}(keccak256("settled invariant funding"));}
    function reserve(uint96 raw) external {if(vault.pendingWithdrawals()>=16||vault.available(address(0))==0)return;uint256 amount=uint256(raw)%vault.available(address(0))+1;vm.prank(CREATOR);vault.scheduleAssetWithdrawal(address(0),amount,CREATOR,uint48(vm.getBlockTimestamp()+3 days));}
    function cancel(uint64 raw) external {uint64 n=vault.withdrawalNonce();if(n==0)return;uint64 id=raw%n+1;vm.prank(CREATOR);try vault.cancelWithdrawal(id){}catch{}}
    function advance(uint32 raw) external {vm.warp(vm.getBlockTimestamp()+uint256(raw)%4 days);}
    function count() external view returns(uint256){return acquired.length;}
    function idAt(uint256 i) external view returns(uint256){return acquired[i];}
}
contract SeaportAcquisitionInvariantTest is SeaportAcquisitionBase {
    SeaportV2InvariantHandler private handler;
    function setUp() public override {super.setUp();handler=new SeaportV2InvariantHandler(vault,seaport,multi,seller);vm.deal(address(handler),1 ether);}
    function targetContracts() external view returns(address[] memory a){a=new address[](1);a[0]=address(handler);}
    function invariantFundedConservationBudgetAllowanceAndExactAcquiredCustody() external view {
        _conserved(address(0));_conserved(address(cash));require(vault.accountedHeld(address(0))==address(vault).balance&&vault.totalSpent(address(0))<=10 ether);
        require(vault.controller()==CREATOR&&vault.creator()==CREATOR&&vault.projectToken()==address(cash)&&!vault.productionExecutionAvailable());
        require(cash.allowance(address(vault),address(seaport))==0&&vault.pendingWithdrawals()<=16);
        for(uint256 i;i<handler.count();i++){uint256 id=handler.idAt(i);require(multi.balanceOf(address(vault),id)==2&&vault.nftHeld(address(multi),id)==2&&multi.balanceOf(seller,id)==0);}
    }
}
