// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AcquisitionTestBase} from "./NftAcquisition.t.sol";
import {NftAcquisitionTypes as T} from "../src/NftAcquisitionTypes.sol";
import {RMTNftAcquisitionVaultV1} from "../src/RMTNftAcquisitionVaultV1.sol";
import {RMTNftAcquisitionFactoryV1} from "../src/RMTNftAcquisitionFactoryV1.sol";
import {SyntheticNftListingVenueV1} from "../src/SyntheticNftListingVenueV1.sol";
import {AcquisitionCurrencyFixture,Acquisition721Fixture,Acquisition1155Fixture} from "./fixtures/NftAcquisitionAssets.sol";

/// Local-only callback fixtures. None is a production collection or token pin.
contract AcquisitionCallRecipient {
    address public target;
    bytes private payload;
    bool public attempted;
    bool public succeeded;
    bytes4 public errorSelector;
    function configure(address next,bytes calldata data)external{target=next;payload=data;}
    receive()external payable{
        attempted=true;bytes memory reason;(succeeded,reason)=target.call(payload);
        if(reason.length>=4){bytes4 e;assembly("memory-safe"){e:=mload(add(reason,32))}errorSelector=e;}
    }
}

contract AcquisitionForwardingNativeRecipient {
    address payable private immutable destination;
    constructor(address payable to){destination=to;}
    receive()external payable{(bool ok,)=destination.call{value:msg.value}("");require(ok);}
}

contract AcquisitionForwardingNftRecipient {
    address private immutable destination;
    constructor(address to){destination=to;}
    function onERC721Received(address,address,uint256 id,bytes calldata)external returns(bytes4){
        Acquisition721Fixture(msg.sender).safeTransferFrom(address(this),destination,id);return 0x150b7a02;
    }
    function onERC1155Received(address,address,uint256 id,uint256 amount,bytes calldata)external returns(bytes4){
        Acquisition1155Fixture(msg.sender).safeTransferFrom(address(this),destination,id,amount,"");return 0xf23a6e61;
    }
}

contract AcquisitionCallbackCurrency {
    mapping(address=>uint256)public balanceOf;
    mapping(address=>mapping(address=>uint256))public allowance;
    address private target;bytes private payload;uint8 private phase;
    uint256 public attempts;uint256 public successes;bytes4 public errorSelector;
    event Transfer(address indexed from,address indexed to,uint256 amount);
    event Approval(address indexed owner,address indexed spender,uint256 amount);
    constructor(){balanceOf[msg.sender]=1_000_000 ether;}
    function configure(uint8 when,address next,bytes calldata data)external{phase=when;target=next;payload=data;attempts=0;successes=0;errorSelector=bytes4(0);}
    function _callback(uint8 when)private{
        if(phase!=when)return;attempts++;(bool ok,bytes memory reason)=target.call(payload);if(ok)successes++;
        if(reason.length>=4){bytes4 e;assembly("memory-safe"){e:=mload(add(reason,32))}errorSelector=e;}
    }
    function approve(address to,uint256 amount)external returns(bool){_callback(1);allowance[msg.sender][to]=amount;emit Approval(msg.sender,to,amount);return true;}
    function transferFrom(address from,address to,uint256 amount)external returns(bool){_callback(2);allowance[from][msg.sender]-=amount;_move(from,to,amount);return true;}
    function transfer(address to,uint256 amount)external returns(bool){_callback(3);_move(msg.sender,to,amount);return true;}
    function _move(address from,address to,uint256 amount)private{require(to!=address(0));balanceOf[from]-=amount;balanceOf[to]+=amount;emit Transfer(from,to,amount);}
}

interface AcquisitionHashOracle {function orderHash(T.Order calldata)external view returns(bytes32);}
interface AcquisitionPullToken {function transferFrom(address,address,uint256)external returns(bool);}
contract AcquisitionInterruptedVenue {
    address private immutable hashOracle;uint8 private fault;
    mapping(bytes32=>uint8)public orderState;mapping(address=>uint64)public sellerNonces;
    constructor(address oracle){hashOracle=oracle;}
    function configure(uint8 next)external{fault=next;}
    function orderHash(T.Order calldata o)public view returns(bytes32){return AcquisitionHashOracle(hashOracle).orderHash(o);}
    function fill(T.Order calldata o,bytes calldata)external payable{
        require(msg.sender==o.vault);orderState[orderHash(o)]=1;
        if(fault==1)require(AcquisitionPullToken(o.currency).transferFrom(o.vault,address(this),o.sellerAmount+o.feeAmount+o.royaltyAmount+1));
        if(fault==2)revert("INTERRUPTED_AFTER_ORDER_MUTATION");
        // Deliberately no NFT delivery. Returning a fill flag is insufficient.
    }
}

contract NftAcquisitionSecurityReviewTest is AcquisitionTestBase {
    function testPermissionlessFillRequiresStandingPolicyAndDisableBeforeInclusionStopsIt()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);bytes memory signature=_sign(o);
        uint64 p=vault.policyEpoch();uint64 c=vault.controllerEpoch();uint48 deadline=_now()+60;
        vm.prank(CREATOR);vault.disablePurchases();
        vm.prank(OTHER);vm.expectRevert(RMTNftAcquisitionVaultV1.InvalidOrder.selector);vault.purchase(o,signature,p,c,deadline);
        require(!vault.orderConsumed(venue.orderHash(o))&&nft.ownerOf(1)==seller&&vault.totalSpent(address(0))==0);
        vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),true);
        p=vault.policyEpoch();c=vault.controllerEpoch();vm.prank(OTHER);vault.purchase(o,signature,p,c,deadline);
        require(nft.ownerOf(1)==address(vault)&&vault.controller()==CREATOR&&OTHER.balance==0);_conserved(address(0));
    }

    function testRoyaltyCallbackCannotExecuteAnotherAlreadyMatureAssetNotice()public{
        vm.prank(CREATOR);uint64 id=vault.scheduleAssetWithdrawal(address(0),2 ether,OTHER,_now()+3 days);vm.warp(_now()+2 days);
        AcquisitionCallRecipient receiver=new AcquisitionCallRecipient();receiver.configure(address(vault),abi.encodeWithSelector(vault.executeWithdrawal.selector,id));
        nft.configureRoyalty(address(receiver),500);T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);o.royaltyRecipient=address(receiver);_buy(o);
        require(receiver.attempted()&&!receiver.succeeded()&&receiver.errorSelector()==RMTNftAcquisitionVaultV1.ReentrantCall.selector);
        require(address(receiver).balance==o.royaltyAmount&&OTHER.balance==0&&vault.reservedAsset(address(0))==2 ether&&vault.pendingWithdrawals()==1);
        vault.executeWithdrawal(id);require(OTHER.balance==2 ether&&vault.pendingWithdrawals()==0);_conserved(address(0));
    }

    function testRoyaltyCallbackCannotReenterVenueAndInvalidateAnUnrelatedSellerNonce()public{
        AcquisitionCallRecipient receiver=new AcquisitionCallRecipient();receiver.configure(address(venue),abi.encodeWithSelector(venue.bumpNonce.selector));
        nft.configureRoyalty(address(receiver),500);T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);o.royaltyRecipient=address(receiver);_buy(o);
        require(receiver.attempted()&&!receiver.succeeded()&&receiver.errorSelector()==SyntheticNftListingVenueV1.ReentrantCall.selector);
        require(venue.sellerNonces(address(receiver))==0&&venue.sellerNonces(seller)==0&&nft.ownerOf(1)==address(vault));_conserved(address(0));
    }

    function testRecipientForwardingNativePayoutCannotDefeatExactBalanceBaseline()public{
        AcquisitionForwardingNativeRecipient receiver=new AcquisitionForwardingNativeRecipient(payable(OTHER));nft.configureRoyalty(address(receiver),500);
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);o.royaltyRecipient=address(receiver);
        uint256 sellerBefore=seller.balance;uint256 feeBefore=FEE.balance;uint256 otherBefore=OTHER.balance;_reject(o,_sign(o));
        require(seller.balance==sellerBefore&&FEE.balance==feeBefore&&OTHER.balance==otherBefore&&address(receiver).balance==0&&nft.ownerOf(1)==seller);_conserved(address(0));
    }

    function testAssetWithdrawalCallbackCannotConsumeAnotherMatureNotice()public{
        AcquisitionCallRecipient receiver=new AcquisitionCallRecipient();
        vm.startPrank(CREATOR);uint64 first=vault.scheduleAssetWithdrawal(address(0),1 ether,address(receiver),_now()+3 days);uint64 second=vault.scheduleAssetWithdrawal(address(0),2 ether,OTHER,_now()+3 days);vm.stopPrank();
        receiver.configure(address(vault),abi.encodeWithSelector(vault.executeWithdrawal.selector,second));vm.warp(_now()+2 days);vault.executeWithdrawal(first);
        require(receiver.attempted()&&!receiver.succeeded()&&receiver.errorSelector()==RMTNftAcquisitionVaultV1.ReentrantCall.selector);
        require(address(receiver).balance==1 ether&&OTHER.balance==0&&vault.accountedHeld(address(0))==9 ether&&vault.reservedAsset(address(0))==2 ether);
        vault.executeWithdrawal(second);require(OTHER.balance==2 ether&&vault.reservedAsset(address(0))==0);_conserved(address(0));
    }

    function test721ForwardingReceiverCannotTurnNoticedCustodyIntoDifferentFinalOwnership()public{
        _buy(_order(address(nft),1,1,1,address(0),.1 ether));AcquisitionForwardingNftRecipient receiver=new AcquisitionForwardingNftRecipient(OTHER);
        vm.prank(CREATOR);uint64 id=vault.scheduleNftWithdrawal(address(nft),1,1,address(receiver),_now()+3 days);vm.warp(_now()+2 days);
        vm.expectRevert(RMTNftAcquisitionVaultV1.TransferFailed.selector);vault.executeWithdrawal(id);
        require(nft.ownerOf(1)==address(vault)&&vault.nftHeld(address(nft),1)==1&&vault.nftReserved(address(nft),1)==1&&vault.pendingWithdrawals()==1);
    }

    function test1155ForwardingReceiverCannotTurnNoticedCustodyIntoDifferentFinalOwnership()public{
        _buy(_order(address(multi),2,101,3,address(0),.3 ether));AcquisitionForwardingNftRecipient receiver=new AcquisitionForwardingNftRecipient(OTHER);
        vm.prank(CREATOR);uint64 id=vault.scheduleNftWithdrawal(address(multi),101,3,address(receiver),_now()+3 days);vm.warp(_now()+2 days);
        vm.expectRevert(RMTNftAcquisitionVaultV1.TransferFailed.selector);vault.executeWithdrawal(id);
        require(multi.balanceOf(address(vault),101)==3&&multi.balanceOf(OTHER,101)==0&&vault.nftHeld(address(multi),101)==3&&vault.nftReserved(address(multi),101)==3&&vault.pendingWithdrawals()==1);
    }

    function _useCallbackCurrency()private returns(AcquisitionCallbackCurrency hostile){
        hostile=new AcquisitionCallbackCurrency();currency=AcquisitionCurrencyFixture(address(hostile));
        T.Pins memory pins=T.Pins(address(core),address(core).codehash,address(token).codehash,address(venue),address(venue).codehash,address(hostile),address(hostile).codehash);
        factory=new RMTNftAcquisitionFactoryV1(pins);vm.prank(CREATOR);vault=RMTNftAcquisitionVaultV1(factory.create(address(token),CREATOR,keccak256("CALLBACK_CURRENCY")));
        uint256[] memory ids=new uint256[](0);vm.prank(CREATOR);vault.configureCollection(address(nft),1,address(nft).codehash,true,true,ids);
        hostile.transfer(CREATOR,10 ether);vm.startPrank(CREATOR);hostile.approve(address(vault),5 ether);vault.configurePolicy(T.Policy(address(hostile),1 ether,10 ether,5 ether,1),true);vm.stopPrank();
    }

    function testTokenFundingAndPurchaseApprovalCallbacksCannotMutateVaultState()public{
        AcquisitionCallbackCurrency hostile=_useCallbackCurrency();bytes memory reentry=abi.encodeWithSelector(vault.executeWithdrawal.selector,uint64(0));
        hostile.configure(2,address(vault),reentry);vm.prank(CREATOR);vault.fundToken(5 ether,keccak256("SETTLED_CALLBACK_TOKEN"));
        require(hostile.attempts()==1&&hostile.successes()==0&&hostile.errorSelector()==RMTNftAcquisitionVaultV1.ReentrantCall.selector&&vault.accountedHeld(address(hostile))==5 ether);
        hostile.configure(1,address(vault),reentry);_buy(_order(address(nft),1,1,1,address(hostile),.1 ether));
        require(hostile.attempts()==1&&hostile.successes()==0&&hostile.errorSelector()==RMTNftAcquisitionVaultV1.ReentrantCall.selector&&hostile.allowance(address(vault),address(venue))==0);
        require(nft.ownerOf(1)==address(vault));_conserved(address(hostile));
    }

    function testTokenWithdrawalCallbackCannotMutateOtherNoticeOrReservation()public{
        AcquisitionCallbackCurrency hostile=_useCallbackCurrency();vm.startPrank(CREATOR);vault.fundToken(5 ether,keccak256("SETTLED_CALLBACK_TOKEN"));
        uint64 first=vault.scheduleAssetWithdrawal(address(hostile),1 ether,OTHER,_now()+3 days);uint64 second=vault.scheduleAssetWithdrawal(address(hostile),1 ether,CREATOR,_now()+3 days);vm.stopPrank();
        hostile.configure(3,address(vault),abi.encodeWithSelector(vault.executeWithdrawal.selector,second));vm.warp(_now()+2 days);vault.executeWithdrawal(first);
        require(hostile.attempts()==1&&hostile.successes()==0&&hostile.errorSelector()==RMTNftAcquisitionVaultV1.ReentrantCall.selector&&hostile.balanceOf(OTHER)==1 ether);
        require(vault.reservedAsset(address(hostile))==1 ether&&vault.accountedHeld(address(hostile))==4 ether&&vault.pendingWithdrawals()==1);_conserved(address(hostile));
    }

    function _useInterruptedVenue()private returns(AcquisitionInterruptedVenue hostile){
        hostile=new AcquisitionInterruptedVenue(address(venue));venue=SyntheticNftListingVenueV1(address(hostile));
        T.Pins memory pins=T.Pins(address(core),address(core).codehash,address(token).codehash,address(hostile),address(hostile).codehash,address(currency),address(currency).codehash);
        factory=new RMTNftAcquisitionFactoryV1(pins);vm.prank(CREATOR);vault=RMTNftAcquisitionVaultV1(factory.create(address(token),CREATOR,keccak256("HOSTILE_ROUTE_TEST_ONLY")));
        uint256[] memory ids=new uint256[](0);vm.startPrank(CREATOR);vault.configureCollection(address(nft),1,address(nft).codehash,true,true,ids);
        vault.fundNative{value:5 ether}(keccak256("SETTLED_TEST_RESERVE"));vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),true);vm.stopPrank();
    }

    function testHostilePinnedVenueFalseCompletionAndInterruptedFillCannotInventCustody()public{
        AcquisitionInterruptedVenue hostile=_useInterruptedVenue();T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);
        _reject(o,_sign(o));require(address(hostile).balance==0&&nft.ownerOf(1)==seller&&vault.accountedHeld(address(0))==5 ether);
        hostile.configure(2);_reject(o,_sign(o));require(address(hostile).balance==0&&nft.ownerOf(1)==seller);_conserved(address(0));
    }

    function testHostileVenueCannotPullMoreThanExactERC20Approval()public{
        AcquisitionInterruptedVenue hostile=_useInterruptedVenue();vm.startPrank(CREATOR);currency.approve(address(vault),5 ether);vault.fundToken(5 ether,keccak256("SETTLED_TEST_TOKEN"));vault.configurePolicy(T.Policy(address(currency),1 ether,10 ether,5 ether,1),true);vm.stopPrank();
        hostile.configure(1);T.Order memory o=_order(address(nft),1,1,1,address(currency),.1 ether);_reject(o,_sign(o));
        require(currency.balanceOf(address(hostile))==0&&currency.allowance(address(vault),address(hostile))==0&&vault.accountedHeld(address(currency))==5 ether&&nft.ownerOf(1)==seller);_conserved(address(currency));
    }
}
