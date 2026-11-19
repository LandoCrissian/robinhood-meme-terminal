// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {NftAcquisitionTypes as T} from "../src/NftAcquisitionTypes.sol";
import {RMTNftAcquisitionFactoryV1,NftAcquisitionDeployerV1} from "../src/RMTNftAcquisitionFactoryV1.sol";
import {RMTNftAcquisitionVaultV1} from "../src/RMTNftAcquisitionVaultV1.sol";
import {SyntheticNftListingVenueV1} from "../src/SyntheticNftListingVenueV1.sol";
import {Acquisition721Fixture,Acquisition1155Fixture,AcquisitionCurrencyFixture,AcquisitionMockCore,AcquisitionRejectRecipient} from "./fixtures/NftAcquisitionAssets.sol";
interface AcquisitionVm {function chainId(uint256)external;function warp(uint256)external;function deal(address,uint256)external;function prank(address)external;function startPrank(address)external;function stopPrank()external;function expectRevert()external;function expectRevert(bytes4)external;function addr(uint256)external returns(address);function sign(uint256,bytes32)external returns(uint8,bytes32,bytes32);function getBlockTimestamp()external view returns(uint256);function etch(address,bytes calldata)external;}
abstract contract AcquisitionTestBase {
    AcquisitionVm constant vm=AcquisitionVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant CREATOR=address(0x100001);address constant OTHER=address(0x100002);address constant FEE=address(0x100003);address constant ROYALTY=address(0x100004);
    uint256 constant SELLER_KEY=0xA11CE081;address seller;AcquisitionMockCore core;AcquisitionCurrencyFixture token;AcquisitionCurrencyFixture currency;
    Acquisition721Fixture nft;Acquisition1155Fixture multi;SyntheticNftListingVenueV1 venue;RMTNftAcquisitionFactoryV1 factory;RMTNftAcquisitionVaultV1 vault;
    function setUp()public virtual {
        vm.chainId(31337);vm.warp(1_800_000_000);vm.deal(CREATOR,100 ether);vm.deal(address(this),100 ether);seller=vm.addr(SELLER_KEY);
        core=new AcquisitionMockCore();token=new AcquisitionCurrencyFixture();currency=new AcquisitionCurrencyFixture();core.register(address(token),CREATOR);
        nft=new Acquisition721Fixture(ROYALTY,500);multi=new Acquisition1155Fixture(ROYALTY,500);venue=new SyntheticNftListingVenueV1(FEE,250);
        T.Pins memory pins=T.Pins(address(core),address(core).codehash,address(token).codehash,address(venue),address(venue).codehash,address(currency),address(currency).codehash);
        factory=new RMTNftAcquisitionFactoryV1(pins);vm.prank(CREATOR);vault=RMTNftAcquisitionVaultV1(factory.create(address(token),CREATOR,keccak256("PROJECT_ONE")));
        for(uint256 i=1;i<=4;i++)nft.mint(seller,i);multi.mint(seller,101,20);multi.mint(seller,102,20);
        vm.startPrank(seller);nft.setApprovalForAll(address(venue),true);multi.setApprovalForAll(address(venue),true);vm.stopPrank();
        uint256[] memory empty=new uint256[](0);vm.startPrank(CREATOR);vault.configureCollection(address(nft),1,address(nft).codehash,true,true,empty);vault.configureCollection(address(multi),2,address(multi).codehash,true,true,empty);
        vault.fundNative{value:10 ether}(keccak256("SETTLED_MANUAL_FUNDING"));vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),true);vm.stopPrank();
        currency.transfer(CREATOR,10 ether);
    }
    function _now()internal view returns(uint48){return uint48(vm.getBlockTimestamp());}
    function _order(address asset,uint8 standard,uint256 id,uint256 quantity,address assetCurrency,uint256 price)internal view returns(T.Order memory o){
        o=T.Order(seller,address(vault),asset,standard,id,quantity,assetCurrency,price,FEE,price*250/10000,ROYALTY,price*500/10000,_now()-1,_now()+300,venue.sellerNonces(seller),keccak256(abi.encode(asset,id,quantity,price)));
    }
    function _sign(T.Order memory o)internal returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(SELLER_KEY,venue.orderHash(o));return abi.encodePacked(r,s,v);}
    function _buy(T.Order memory o)internal{bytes memory signature=_sign(o);vault.purchase(o,signature,vault.policyEpoch(),vault.controllerEpoch(),_now()+60);}
    function _reject(T.Order memory o,bytes memory signature)internal{
        uint64 p=vault.policyEpoch();uint64 c=vault.controllerEpoch();uint48 deadline=_now()+60;uint256 held=vault.accountedHeld(o.currency);uint256 spent=vault.totalSpent(o.currency);uint256 oldNft=vault.nftHeld(o.collection,o.tokenId);bytes32 id=venue.orderHash(o);uint8 oldOrder=venue.orderState(id);bool consumed=vault.orderConsumed(id);
        vm.expectRevert();vault.purchase(o,signature,p,c,deadline);
        require(vault.accountedHeld(o.currency)==held&&vault.totalSpent(o.currency)==spent&&vault.nftHeld(o.collection,o.tokenId)==oldNft&&venue.orderState(id)==oldOrder&&vault.orderConsumed(id)==consumed,"ATOMIC_ROLLBACK");
    }
    function _conserved(address asset)internal view{require(vault.funded(asset)==vault.accountedHeld(asset)+vault.totalSpent(asset)+vault.withdrawn(asset));require(vault.reservedAsset(asset)<=vault.accountedHeld(asset));if(asset==address(0))require(address(vault).balance>=vault.accountedHeld(asset));else require(currency.balanceOf(address(vault))>=vault.accountedHeld(asset));}
}
contract NftAcquisitionTest is AcquisitionTestBase {
    function testCreatorAndExactProjectBindingAndUniqueIntent()public{
        require(factory.predict(CREATOR,address(token),CREATOR,keccak256("PROJECT_ONE"))==address(vault)&&vault.creator()==CREATOR&&vault.projectToken()==address(token));
        vm.prank(OTHER);vm.expectRevert();factory.create(address(token),OTHER,keccak256("STOLEN_PROJECT"));
        vm.prank(CREATOR);vm.expectRevert();factory.create(address(token),CREATOR,keccak256("PROJECT_ONE"));
    }
    function testNewVaultIsOffByDefaultAndProductionChainCannotDeployOrExecute()public{
        vm.prank(CREATOR);RMTNftAcquisitionVaultV1 fresh=RMTNftAcquisitionVaultV1(factory.create(address(token),CREATOR,keccak256("FRESH")));require(!fresh.purchasesEnabled()&&!fresh.productionExecutionAvailable());
        vm.chainId(4663);vm.expectRevert();new SyntheticNftListingVenueV1(FEE,250);vm.prank(CREATOR);vm.expectRevert();factory.create(address(token),CREATOR,keccak256("MAINNET"));
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);_reject(o,_sign(o));vm.chainId(31337);
    }
    function testNative721ExactSellerFeeRoyaltyAndRealCustody()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);uint256 beforeSeller=seller.balance;uint256 beforeFee=FEE.balance;uint256 beforeRoyalty=ROYALTY.balance;_buy(o);
        require(nft.ownerOf(1)==address(vault)&&vault.nftHeld(address(nft),1)==1&&seller.balance==beforeSeller+o.sellerAmount&&FEE.balance==beforeFee+o.feeAmount&&ROYALTY.balance==beforeRoyalty+o.royaltyAmount);
        require(vault.totalSpent(address(0))==.1075 ether&&address(venue).balance==0);_conserved(address(0));
    }
    function testToken1155FullQuantityAndBoundedApprovalConsumedExactly()public{
        vm.startPrank(CREATOR);currency.approve(address(vault),5 ether);vault.fundToken(5 ether,keccak256("SETTLED_TOKEN"));vault.configurePolicy(T.Policy(address(currency),1 ether,10 ether,5 ether,1),true);vm.stopPrank();
        T.Order memory o=_order(address(multi),2,101,3,address(currency),.3 ether);_buy(o);
        require(multi.balanceOf(address(vault),101)==3&&multi.balanceOf(seller,101)==17&&vault.nftHeld(address(multi),101)==3&&currency.allowance(address(vault),address(venue))==0);
        require(currency.balanceOf(seller)==o.sellerAmount&&currency.balanceOf(FEE)==o.feeAmount&&currency.balanceOf(ROYALTY)==o.royaltyAmount);_conserved(address(currency));
    }
    function testForgedCrossDomainAndModifiedQuantitySignaturesFail()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);bytes memory signature=_sign(o);signature[0]=bytes1(uint8(signature[0])^1);_reject(o,signature);
        T.Order memory batch=_order(address(multi),2,101,2,address(0),.1 ether);signature=_sign(batch);batch.quantity=3;_reject(batch,signature);
        SyntheticNftListingVenueV1 foreign=new SyntheticNftListingVenueV1(FEE,250);(uint8 v,bytes32 r,bytes32 s)=vm.sign(SELLER_KEY,foreign.orderHash(o));_reject(o,abi.encodePacked(r,s,v));
    }
    function testVenueCannotUseAnotherApprovedPayersCurrencyEvenWithValidSellerOrder()public{
        T.Order memory o=_order(address(nft),1,1,1,address(currency),.1 ether);o.vault=CREATOR;bytes memory signature=_sign(o);
        uint256 total=o.sellerAmount+o.feeAmount+o.royaltyAmount;vm.prank(CREATOR);currency.approve(address(venue),total);uint256 before=currency.balanceOf(CREATOR);
        vm.prank(OTHER);vm.expectRevert(SyntheticNftListingVenueV1.InvalidOrder.selector);venue.fill(o,signature);
        require(currency.balanceOf(CREATOR)==before&&currency.allowance(CREATOR,address(venue))==total&&nft.ownerOf(1)==seller&&venue.orderState(venue.orderHash(o))==0);
    }
    function testExpiredFutureCancelledAndNonceInvalidatedOrdersFail()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);o.endTime=_now()-1;o.startTime=_now()-100;_reject(o,_sign(o));
        o=_order(address(nft),1,1,1,address(0),.1 ether);o.startTime=_now()+1;_reject(o,_sign(o));
        o=_order(address(nft),1,1,1,address(0),.1 ether);bytes memory signature=_sign(o);vm.prank(seller);venue.cancel(o);_reject(o,signature);
        o=_order(address(nft),1,2,1,address(0),.1 ether);signature=_sign(o);vm.prank(seller);venue.bumpNonce();_reject(o,signature);
    }
    function testRoyaltyOrFeeChangeCannotOverrideSignedConsideration()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);bytes memory signature=_sign(o);nft.configureRoyalty(OTHER,1000);_reject(o,signature);
        nft.configureRoyalty(ROYALTY,500);o.feeAmount++;_reject(o,_sign(o));require(nft.ownerOf(1)==seller);_conserved(address(0));
    }
    function testLostOwnershipAndRevokedSellerApprovalFailAtomically()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);bytes memory signature=_sign(o);vm.prank(seller);nft.transferFrom(seller,OTHER,1);_reject(o,signature);
        o=_order(address(nft),1,2,1,address(0),.1 ether);vm.prank(seller);nft.setApprovalForAll(address(venue),false);_reject(o,_sign(o));_conserved(address(0));
    }
    function testPerUnitTotalPeriodBudgetAndCooldownAreNotResetByReconfiguration()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),1 ether);_reject(o,_sign(o));
        vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(0),.11 ether,.215 ether,.215 ether,60),true);
        o=_order(address(nft),1,1,1,address(0),.1 ether);_buy(o);T.Order memory second=_order(address(nft),1,2,1,address(0),.1 ether);_reject(second,_sign(second));
        vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(0),.11 ether,.215 ether,.215 ether,60),true);_reject(second,_sign(second));
        vm.warp(_now()+61);second=_order(address(nft),1,2,1,address(0),.1 ether);_buy(second);vm.warp(_now()+61);o=_order(address(nft),1,3,1,address(0),.1 ether);_reject(o,_sign(o));_conserved(address(0));
    }
    function testExplicitIdsUnknownCollectionCurrencyAndWrongVaultFail()public{
        vm.startPrank(CREATOR);vault.disablePurchases();uint256[] memory selected=new uint256[](1);selected[0]=2;vault.configureCollection(address(nft),1,address(nft).codehash,true,false,selected);vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),true);vm.stopPrank();
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);_reject(o,_sign(o));
        o=_order(address(nft),1,2,1,address(currency),.1 ether);_reject(o,_sign(o));o=_order(address(nft),1,2,1,address(0),.1 ether);o.vault=OTHER;_reject(o,_sign(o));
        Acquisition721Fixture unknown=new Acquisition721Fixture(ROYALTY,500);unknown.mint(seller,1);o=_order(address(unknown),1,1,1,address(0),.1 ether);_reject(o,_sign(o));
    }
    function testImmediateDisableAndStalePolicyOrControllerEpochStopPurchase()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);bytes memory signature=_sign(o);uint64 old=vault.policyEpoch();vm.prank(CREATOR);vault.disablePurchases();_reject(o,signature);
        vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),true);uint64 ce=vault.controllerEpoch();uint48 deadline=_now()+60;vm.expectRevert();vault.purchase(o,signature,old,ce,deadline);
    }
    function testOnlyCurrentControllerCanConfigureOrQueueCustodyTransfers()public{
        vm.prank(OTHER);vm.expectRevert();vault.disablePurchases();vm.prank(OTHER);vm.expectRevert();vault.configurePolicy(T.Policy(address(0),1 ether,10 ether,5 ether,1),true);
        vm.prank(OTHER);vm.expectRevert();vault.scheduleAssetWithdrawal(address(0),1 ether,OTHER,_now()+3 days);require(vault.pendingWithdrawals()==0);
    }
    function testReplayCannotDoubleSpendOrPartiallyFill()public{
        T.Order memory o=_order(address(multi),2,101,3,address(0),.3 ether);_buy(o);vm.warp(_now()+2);_reject(o,_sign(o));require(multi.balanceOf(address(vault),101)==3&&vault.nftHeld(address(multi),101)==3);_conserved(address(0));
    }
    function testWrongCustodyReceiverAndInterruptedTransferRollBackPaymentsAndOrder()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);uint256 before=seller.balance;
        nft.configureFault(1,OTHER);_reject(o,_sign(o));require(nft.ownerOf(1)==seller&&seller.balance==before);
        nft.configureFault(3,address(0));_reject(o,_sign(o));require(nft.ownerOf(1)==seller&&seller.balance==before);_conserved(address(0));
    }
    function testSuccessfulNftCallbackDoesNotSubstituteForExactSellerAndVaultBalances()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);uint256 before=seller.balance;
        for(uint8 mode=5;mode<=6;mode++){nft.configureFault(mode,address(0));_reject(o,_sign(o));require(nft.ownerOf(1)==seller&&nft.balanceOf(seller)==4&&nft.balanceOf(address(vault))==0&&seller.balance==before);}_conserved(address(0));
    }
    function testMaliciousNftCallbackCannotDisableControllerPolicyOrRedirectFunds()public{
        nft.configureFault(2,address(vault));_buy(_order(address(nft),1,1,1,address(0),.1 ether));
        require(!nft.callbackSucceeded()&&nft.callbackError()==RMTNftAcquisitionVaultV1.Unauthorized.selector&&vault.purchasesEnabled()&&nft.ownerOf(1)==address(vault));_conserved(address(0));
    }
    function testMaliciousNftCallbackIsStoppedByExactReentrancyGuard()public{
        nft.configureFault(4,address(vault));_buy(_order(address(nft),1,1,1,address(0),.1 ether));
        require(!nft.callbackSucceeded()&&nft.callbackError()==RMTNftAcquisitionVaultV1.ReentrantCall.selector&&vault.pendingWithdrawals()==0&&nft.ownerOf(1)==address(vault));_conserved(address(0));
    }
    function testReservedOrInsufficientFundsAreNeverSpent()public{
        vm.prank(CREATOR);vault.scheduleAssetWithdrawal(address(0),10 ether,CREATOR,_now()+3 days);
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);_reject(o,_sign(o));require(vault.available(address(0))==0&&nft.ownerOf(1)==seller);_conserved(address(0));
    }
    function testUnsolicitedNFTAndSpoofedReceiverCallbackCannotInventCustody()public{
        vm.prank(seller);vm.expectRevert();nft.safeTransferFrom(seller,address(vault),1);
        vm.expectRevert();vault.onERC721Received(address(venue),seller,1,"");require(vault.nftHeld(address(nft),1)==0&&nft.ownerOf(1)==seller);
    }
    function testRejectingRoyaltyRecipientRollsBackEveryPayoutAndNft()public{
        AcquisitionRejectRecipient rejected=new AcquisitionRejectRecipient();nft.configureRoyalty(address(rejected),500);T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);o.royaltyRecipient=address(rejected);uint256 before=seller.balance;_reject(o,_sign(o));require(seller.balance==before&&nft.ownerOf(1)==seller);_conserved(address(0));
    }
    function testHostileCurrencyFundingAndPurchasePreserveExactBalancesAndAllowance()public{
        for(uint8 mode=1;mode<=3;mode++){currency.configureFault(mode);vm.startPrank(CREATOR);currency.approve(address(vault),1 ether);vm.expectRevert();vault.fundToken(1 ether,keccak256("EXACT"));vm.stopPrank();require(vault.accountedHeld(address(currency))==0);}
        currency.configureFault(0);vm.startPrank(CREATOR);currency.approve(address(vault),1 ether);vault.fundToken(1 ether,keccak256("EXACT"));vault.configurePolicy(T.Policy(address(currency),1 ether,10 ether,5 ether,1),true);vm.stopPrank();
        currency.configureFault(2);T.Order memory o=_order(address(nft),1,1,1,address(currency),.1 ether);_reject(o,_sign(o));require(currency.allowance(address(vault),address(venue))==0&&nft.ownerOf(1)==seller);_conserved(address(currency));
    }
    function testNoticedAssetWithdrawalReservationExpiryAndRejectedPayout()public{
        vm.prank(CREATOR);uint64 id=vault.scheduleAssetWithdrawal(address(0),1 ether,OTHER,_now()+3 days);require(vault.available(address(0))==9 ether);vm.expectRevert();vault.executeWithdrawal(id);vm.warp(_now()+2 days);vault.executeWithdrawal(id);require(OTHER.balance==1 ether&&vault.pendingWithdrawals()==0);_conserved(address(0));
        AcquisitionRejectRecipient rejected=new AcquisitionRejectRecipient();vm.prank(CREATOR);id=vault.scheduleAssetWithdrawal(address(0),1 ether,address(rejected),_now()+3 days);vm.warp(_now()+2 days);vm.expectRevert();vault.executeWithdrawal(id);require(vault.reservedAsset(address(0))==1 ether);vm.warp(_now()+2 days);vault.cancelWithdrawal(id);require(vault.reservedAsset(address(0))==0);_conserved(address(0));
    }
    function testTokenWithdrawalExactDeltasAndNoticeSurviveHostileReturnBehavior()public{
        vm.startPrank(CREATOR);currency.approve(address(vault),1 ether);vault.fundToken(1 ether,keccak256("SETTLED_TOKEN"));uint64 id=vault.scheduleAssetWithdrawal(address(currency),.5 ether,OTHER,_now()+3 days);vm.stopPrank();vm.warp(_now()+2 days);
        for(uint8 mode=1;mode<=3;mode++){currency.configureFault(mode);vm.expectRevert();vault.executeWithdrawal(id);require(vault.accountedHeld(address(currency))==1 ether&&vault.reservedAsset(address(currency))==.5 ether&&currency.balanceOf(OTHER)==0);}
        currency.configureFault(0);vault.executeWithdrawal(id);require(currency.balanceOf(OTHER)==.5 ether&&vault.reservedAsset(address(currency))==0);_conserved(address(currency));
    }
    function testAcquiredNftNeedsSeparateTwoDayWithdrawalAndCannotBeSwept()public{
        _buy(_order(address(nft),1,1,1,address(0),.1 ether));vm.prank(CREATOR);uint64 id=vault.scheduleNftWithdrawal(address(nft),1,1,OTHER,_now()+3 days);vm.expectRevert();vault.executeWithdrawal(id);vm.warp(_now()+2 days);vault.executeWithdrawal(id);require(nft.ownerOf(1)==OTHER&&vault.nftHeld(address(nft),1)==0);
        (bool ok,)=address(vault).call(abi.encodeWithSignature("execute(address,bytes)",address(nft),hex"12345678"));require(!ok);
    }
    function testControllerRotationNoticeInvalidatesOldEpochAndKeepsBudgets()public{
        _buy(_order(address(nft),1,1,1,address(0),.1 ether));uint256 spent=vault.totalSpent(address(0));vm.prank(CREATOR);uint64 id=vault.scheduleAssetWithdrawal(address(0),1 ether,CREATOR,_now()+3 days);
        vm.prank(CREATOR);vault.proposeController(OTHER,_now()+3 days);vm.prank(OTHER);vm.expectRevert();vault.acceptController();vm.warp(_now()+2 days);vm.prank(OTHER);vault.acceptController();require(!vault.purchasesEnabled()&&vault.controllerEpoch()==2&&vault.totalSpent(address(0))==spent);
        vm.expectRevert();vault.executeWithdrawal(id);vault.cancelWithdrawal(id);require(vault.reservedAsset(address(0))==0);vm.prank(CREATOR);vm.expectRevert();vault.disablePurchases();_conserved(address(0));
    }
    function testChangedRouteCodeAndCreationPartsFailClosed()public{
        T.Order memory o=_order(address(nft),1,1,1,address(0),.1 ether);bytes memory signature=_sign(o);vm.etch(address(venue),hex"00");uint64 p=vault.policyEpoch();uint64 c=vault.controllerEpoch();uint48 d=_now()+60;vm.expectRevert();vault.purchase(o,signature,p,c,d);
        vm.etch(factory.creationPart1(),hex"00");vm.prank(CREATOR);vm.expectRevert();factory.create(address(token),CREATOR,keccak256("MUTATED"));
    }
    function testFuzzNativeAllInConservation(uint64 raw)public{
        uint256 price=uint256(raw)%(.5 ether)+1;T.Order memory o=_order(address(nft),1,1,1,address(0),price);_buy(o);require(vault.totalSpent(address(0))==o.sellerAmount+o.feeAmount+o.royaltyAmount&&nft.ownerOf(1)==address(vault));_conserved(address(0));
    }
    function testFuzz1155QuantityAndAllInPerUnitCap(uint8 raw)public{
        uint256 q=uint256(raw)%20+1;T.Order memory o=_order(address(multi),2,101,q,address(0),q*.01 ether);_buy(o);require(vault.nftHeld(address(multi),101)==q&&multi.balanceOf(seller,101)==20-q);_conserved(address(0));
    }
}
