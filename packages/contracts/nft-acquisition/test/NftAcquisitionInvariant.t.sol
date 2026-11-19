// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {AcquisitionTestBase,AcquisitionVm} from "./NftAcquisition.t.sol";
import {RMTNftAcquisitionVaultV1} from "../src/RMTNftAcquisitionVaultV1.sol";
import {SyntheticNftListingVenueV1} from "../src/SyntheticNftListingVenueV1.sol";
import {NftAcquisitionTypes as T} from "../src/NftAcquisitionTypes.sol";
import {Acquisition721Fixture} from "./fixtures/NftAcquisitionAssets.sol";
contract AcquisitionInvariantHandler {
    AcquisitionVm constant vm=AcquisitionVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant KEY=0xA11CE081;address constant CREATOR=address(0x100001);address constant FEE=address(0x100003);address constant ROYALTY=address(0x100004);
    RMTNftAcquisitionVaultV1 public immutable vault;SyntheticNftListingVenueV1 public immutable venue;Acquisition721Fixture public immutable nft;address public immutable seller;
    uint256 private nextId=1000;uint256[] private acquired;
    constructor(RMTNftAcquisitionVaultV1 v,SyntheticNftListingVenueV1 e,Acquisition721Fixture n,address s){vault=v;venue=e;nft=n;seller=s;}
    function purchase(uint32 raw)external{
        uint256 id=nextId++;nft.mint(seller,id);vm.warp(vm.getBlockTimestamp()+2);uint256 price=uint256(raw)%(.01 ether)+1;
        T.Order memory o=T.Order(seller,address(vault),address(nft),1,id,1,address(0),price,FEE,price*250/10000,ROYALTY,price*500/10000,uint48(vm.getBlockTimestamp()-1),uint48(vm.getBlockTimestamp()+60),venue.sellerNonces(seller),keccak256(abi.encode(id)));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(KEY,venue.orderHash(o));uint64 p=vault.policyEpoch();uint64 c=vault.controllerEpoch();
        try vault.purchase(o,abi.encodePacked(r,s,v),p,c,uint48(vm.getBlockTimestamp()+60)){acquired.push(id);}catch{}
    }
    function setEnabled(bool enabled)external{vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),enabled);}
    function fund(uint32 raw)external{uint256 amount=uint256(raw)+1;vm.prank(CREATOR);vault.fundNative{value:amount}(keccak256("SETTLED_SYNTHETIC"));}
    function count()external view returns(uint256){return acquired.length;}
    function idAt(uint256 i)external view returns(uint256){return acquired[i];}
    receive()external payable{}
}
contract NftAcquisitionInvariantTest is AcquisitionTestBase {
    AcquisitionInvariantHandler handler;
    function setUp()public override{super.setUp();handler=new AcquisitionInvariantHandler(vault,venue,nft,seller);vm.deal(address(handler),1 ether);}
    function targetContracts()external view returns(address[] memory a){a=new address[](1);a[0]=address(handler);}
    function invariantFundsAndCustodyNeverExceedActualSettlement()external view{
        _conserved(address(0));require(vault.creator()==CREATOR&&vault.projectToken()==address(token)&&vault.controller()==CREATOR&&vault.totalSpent(address(0))<=10 ether);
        uint256 n=handler.count();require(nft.balanceOf(address(vault))==n);
        for(uint256 i;i<n;i++){uint256 id=handler.idAt(i);require(nft.ownerOf(id)==address(vault)&&vault.nftHeld(address(nft),id)==1);}
        require(currency.allowance(address(vault),address(venue))==0&&!vault.productionExecutionAvailable());
    }
}
