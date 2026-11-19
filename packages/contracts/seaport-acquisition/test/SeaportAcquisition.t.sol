// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {RMTSeaportAcquisitionVaultV2 as Vault} from "../src/RMTSeaportAcquisitionVaultV2.sol";
import {SeaportAcquisitionTypes as T,IAcquisitionSeaport} from "../src/SeaportAcquisitionTypes.sol";
import {Acquisition721Fixture,Acquisition1155Fixture,AcquisitionCurrencyFixture,AcquisitionMockCore} from "../../nft-acquisition/test/fixtures/NftAcquisitionAssets.sol";

interface VmAcquisitionV2 {
    function projectRoot() external view returns(string memory); function readFile(string calldata) external view returns(string memory);
    function parseJsonBytes(string calldata,string calldata) external pure returns(bytes memory);
    function chainId(uint256) external; function deal(address,uint256) external; function addr(uint256) external returns(address);
    function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32); function prank(address) external;
    function startPrank(address) external; function stopPrank() external; function expectRevert() external;
    function expectRevert(bytes4) external; function warp(uint256) external; function etch(address,bytes calldata) external;
    function getBlockTimestamp() external view returns(uint256);
}
interface ISeaportOrderControl {
    function cancel(T.OrderComponents[] calldata) external returns(bool); function incrementCounter() external returns(uint256);
}

abstract contract SeaportAcquisitionBase {
    VmAcquisitionV2 internal constant vm = VmAcquisitionV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant SELLER_KEY = 0xA11CE;
    address internal constant CREATOR = address(0x100001);
    address internal constant OTHER = address(0x100002);
    address payable internal constant FEE = payable(address(0x100003));
    address payable internal constant ROYALTY = payable(address(0x100004));
    IAcquisitionSeaport internal seaport; AcquisitionMockCore internal core;
    AcquisitionCurrencyFixture internal cash; Acquisition721Fixture internal nft; Acquisition1155Fixture internal multi;
    Vault internal vault; T.Pins internal pins; address internal seller;
    function _now() internal view returns(uint256) { return vm.getBlockTimestamp(); }
    function _deploy(bytes memory code) internal returns(address result) { assembly("memory-safe") { result := create(0,add(code,32),mload(code)) } require(result.code.length > 0,"GENUINE_DEPLOYMENT"); }
    function setUp() public virtual {
        vm.chainId(31337); vm.warp(2_000_000_000); vm.deal(address(this),100 ether); vm.deal(CREATOR,100 ether); seller = vm.addr(SELLER_KEY);
        string memory json = vm.readFile(string.concat(vm.projectRoot(),"/official-artifacts.json"));
        address cc = _deploy(vm.parseJsonBytes(json,".artifacts.ConduitController.creationCode"));
        seaport = IAcquisitionSeaport(_deploy(abi.encodePacked(vm.parseJsonBytes(json,".artifacts.Seaport.creationCode"),abi.encode(cc))));
        cash = new AcquisitionCurrencyFixture(); core = new AcquisitionMockCore(); core.register(address(cash),CREATOR);
        nft = new Acquisition721Fixture(ROYALTY,500); multi = new Acquisition1155Fixture(ROYALTY,500);
        pins = T.Pins(address(core),address(core).codehash,address(cash).codehash,address(seaport),address(seaport).codehash,address(cash),address(cash).codehash);
        vm.prank(CREATOR); vault = new Vault(CREATOR,address(cash),CREATOR,keccak256("seaport-v2-local"),pins);
        for(uint256 id = 1; id <= 12; id++) { nft.mint(seller,id); multi.mint(seller,id,10); }
        vm.prank(seller); nft.setApprovalForAll(address(seaport),true); vm.prank(seller); multi.setApprovalForAll(address(seaport),true);
        vm.startPrank(CREATOR);
        vault.configureCollection(address(nft),1,address(nft).codehash,true,true,new uint256[](0));
        vault.configureCollection(address(multi),2,address(multi).codehash,true,true,new uint256[](0));
        vault.configureFeeRecipient(FEE,250); vault.fundNative{value:10 ether}(keccak256("separate settled native funds"));
        vm.stopPrank(); cash.transfer(CREATOR,20 ether); vm.startPrank(CREATOR); cash.approve(address(vault),10 ether); vault.fundToken(10 ether,keccak256("separate settled token funds")); vm.stopPrank();
    }
    function _policy(bool token) internal { vm.prank(CREATOR); vault.configurePolicy(T.Policy(token ? address(cash) : address(0),1 ether,10 ether,5 ether,1),true); }
    function _components(T.AdvancedOrder memory a,uint256 counter) internal pure returns(T.OrderComponents memory) { T.OrderParameters memory p=a.parameters; return T.OrderComponents(p.offerer,p.zone,p.offer,p.consideration,p.orderType,p.startTime,p.endTime,p.zoneHash,p.salt,p.conduitKey,counter); }
    function _hash(T.AdvancedOrder memory a,uint256 counter) internal view returns(bytes32) { return seaport.getOrderHash(_components(a,counter)); }
    function _sign(T.AdvancedOrder memory a) internal returns(T.AdvancedOrder memory) {
        bytes32 digest=keccak256(abi.encodePacked(hex"1901",vault.domainSeparator(),_hash(a,seaport.getCounter(a.parameters.offerer))));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(SELLER_KEY,digest); a.signature=abi.encodePacked(r,s,v); return a;
    }
    function _order(bool isMulti,bool token,uint256 id) internal returns(T.AdvancedOrder memory a) {
        a.parameters.offerer=seller; a.parameters.offer=new T.OfferItem[](1); a.parameters.offer[0]=T.OfferItem(isMulti?3:2,isMulti?address(multi):address(nft),id,isMulti?2:1,isMulti?2:1);
        a.parameters.consideration=new T.ConsiderationItem[](3); address currency=token?address(cash):address(0); uint8 itemType=token?1:0;
        a.parameters.consideration[0]=T.ConsiderationItem(itemType,currency,0,925e14,925e14,payable(seller));
        a.parameters.consideration[1]=T.ConsiderationItem(itemType,currency,0,25e14,25e14,FEE);
        a.parameters.consideration[2]=T.ConsiderationItem(itemType,currency,0,50e14,50e14,ROYALTY);
        a.parameters.startTime=_now()-1; a.parameters.endTime=_now()+1 hours; a.parameters.salt=id; a.parameters.totalOriginalConsiderationItems=3;
        a.numerator=1; a.denominator=1; return _sign(a);
    }
    function _request(T.AdvancedOrder memory a) internal view returns(T.Request memory) { uint256 counter=seaport.getCounter(a.parameters.offerer); return T.Request(_hash(a,counter),counter,vault.policyEpoch(),vault.controllerEpoch(),uint48(_now()+60)); }
    function _buy(T.AdvancedOrder memory a) internal { vault.purchase(a,_request(a)); }
    function _reject(T.AdvancedOrder memory a) internal { T.Request memory r=_request(a); vm.expectRevert(); vault.purchase(a,r); }
    function _conserved(address currency) internal view { require(vault.funded(currency)==vault.accountedHeld(currency)+vault.withdrawn(currency)+vault.totalSpent(currency),"FUNDED_CONSERVATION"); require(vault.reservedAsset(currency)<=vault.accountedHeld(currency),"RESERVE_BOUND"); }
}

contract SeaportAcquisitionTest is SeaportAcquisitionBase {
    function testConstructorRequiresActualCreatorAndEveryCandidateRespectsCodeLimits() public {
        vm.expectRevert();new Vault(CREATOR,address(cash),CREATOR,keccak256("unauthorized direct project identity"),pins);
        bytes memory encodedInit=abi.encodePacked(type(Vault).creationCode,abi.encode(CREATOR,address(cash),CREATOR,keccak256("size boundary"),pins));
        require(encodedInit.length<=49152&&address(vault).code.length<=24576&&address(vault.checks()).code.length<=24576);
        require(vault.creator()==CREATOR&&vault.deploymentChainId()==31337);
    }
    function testOffByDefaultAndPermissionlessTriggerOnlyAfterExplicitEnable() public { T.AdvancedOrder memory a=_order(false,false,1); _reject(a); _policy(false); T.Request memory r=_request(a); vm.prank(OTHER); vault.purchase(a,r); require(nft.ownerOf(1)==address(vault)&&vault.nftHeld(address(nft),1)==1); _conserved(address(0)); }
    function testGenuineNative721CustodyWithoutSafeReceiverCallback() public { _policy(false); uint256 before_=seller.balance; _buy(_order(false,false,1)); require(seller.balance==before_+925e14&&FEE.balance==25e14&&ROYALTY.balance==50e14); require(vault.accountedHeld(address(0))==9.9 ether&&nft.balanceOf(address(vault))==1); }
    function testGenuineNative1155CustodyWithExpectedCallback() public { _policy(false); _buy(_order(true,false,1)); require(multi.balanceOf(address(vault),1)==2&&multi.balanceOf(seller,1)==8&&vault.nftHeld(address(multi),1)==2); _conserved(address(0)); }
    function testGenuineToken721ExactAllRecipientDeltasAndAllowanceRevoked() public { _policy(true); _buy(_order(false,true,1)); require(cash.balanceOf(seller)==925e14&&cash.balanceOf(FEE)==25e14&&cash.balanceOf(ROYALTY)==50e14); require(cash.allowance(address(vault),address(seaport))==0); _conserved(address(cash)); }
    function testGenuineToken1155AtomicCustody() public { _policy(true); _buy(_order(true,true,1)); require(multi.balanceOf(address(vault),1)==2&&cash.allowance(address(vault),address(seaport))==0); }
    function testReplayAndSameBlockSecondOrderBlockedByCooldown() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); _buy(a); _reject(a); _reject(_order(false,false,2)); require(nft.ownerOf(2)==seller); }
    function testCooldownAllowsNextExactOrderAndUsesLifetimeSpend() public { _policy(false); _buy(_order(false,false,1)); vm.warp(_now()+1); _buy(_order(false,false,2)); require(vault.totalSpent(address(0))==.2 ether); _conserved(address(0)); }
    function testMinedDisableInvalidatesOldEpochAndLeavesFundsAndNft() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); T.Request memory r=_request(a); vm.prank(CREATOR); vault.disablePurchases(); vm.expectRevert(); vault.purchase(a,r); require(nft.ownerOf(1)==seller&&vault.totalSpent(address(0))==0); }
    function testReenableCannotReviveOldPolicyRequest() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); T.Request memory r=_request(a); vm.prank(CREATOR); vault.disablePurchases(); _policy(false); vm.expectRevert(); vault.purchase(a,r); }
    function testWrongRequestHashCounterDeadlineAndControllerEpoch() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); T.Request memory r=_request(a); r.signedOrderHash=bytes32(uint256(1)); vm.expectRevert(); vault.purchase(a,r); r=_request(a); r.counter=1; vm.expectRevert(); vault.purchase(a,r); r=_request(a); r.controllerEpoch++; vm.expectRevert(); vault.purchase(a,r); r=_request(a); r.deadline=uint48(_now()+301); vm.expectRevert(); vault.purchase(a,r); }
    function testExpiredFutureAndDynamicPricesReject() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); a.parameters.endTime=_now(); _reject(_sign(a)); a=_order(false,false,1); a.parameters.startTime=_now()+1; _reject(_sign(a)); a=_order(false,false,1); a.parameters.offer[0].endAmount=2; _reject(_sign(a)); a=_order(false,false,1); a.parameters.consideration[0].endAmount++; _reject(_sign(a)); }
    function testWrongZoneConduitRestrictedCriteriaAndPartialReject() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); a.parameters.zone=OTHER; _reject(_sign(a)); a=_order(false,false,1); a.parameters.zoneHash=bytes32(uint256(1)); _reject(_sign(a)); a=_order(false,false,1); a.parameters.conduitKey=bytes32(uint256(1)); _reject(_sign(a)); a=_order(false,false,1); a.parameters.orderType=2; _reject(_sign(a)); a=_order(false,false,1); a.parameters.offer[0].itemType=4; _reject(_sign(a)); a=_order(true,false,1); a.denominator=2; _reject(a); }
    function testExtraDataTipsAndDuplicateRecipientsReject() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); a.extraData=hex"00"; _reject(a); a=_order(false,false,1); a.parameters.totalOriginalConsiderationItems=2; _reject(_sign(a)); a=_order(false,false,1); a.parameters.consideration[1].recipient=payable(seller); _reject(_sign(a)); }
    function testFeeRecipientAndRoyaltySubstitutionCannotBypassPolicyOrSignature() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); a.parameters.consideration[1].recipient=payable(OTHER); _reject(_sign(a)); a=_order(false,false,1); a.parameters.consideration[2].recipient=payable(OTHER); _reject(_sign(a)); a=_order(false,false,1); a.parameters.consideration[1].startAmount++; a.parameters.consideration[1].endAmount++; _reject(_sign(a)); }
    function testRoyaltyChangesAfterSigningFailClosed() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); nft.configureRoyalty(ROYALTY,600); _reject(a); require(nft.ownerOf(1)==seller&&seller.balance==0); }
    function testWrongCurrencySellerTransferAndApprovalRevocationReject() public { _policy(false); _reject(_order(false,true,1)); T.AdvancedOrder memory a=_order(false,false,1); vm.prank(seller); nft.setApprovalForAll(address(seaport),false); _reject(a); vm.prank(seller); nft.transferFrom(seller,OTHER,1); _reject(a); }
    function testSellerCancelAndCounterInvalidationReject() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); T.OrderComponents[] memory os=new T.OrderComponents[](1); os[0]=_components(a,0); vm.prank(seller); require(ISeaportOrderControl(address(seaport)).cancel(os)); _reject(a); a=_order(false,false,2); vm.prank(seller); ISeaportOrderControl(address(seaport)).incrementCounter(); _reject(a); }
    function testActualPriorPartialFillIsOutsideSubsetAndCannotCreditVault() public { _policy(false); T.AdvancedOrder memory a=_order(true,false,1); a.parameters.orderType=1; a.parameters.offer[0].startAmount=4; a.parameters.offer[0].endAmount=4; a.denominator=2; a=_sign(a); require(seaport.fulfillAdvancedOrder{value:.05 ether}(a,new T.CriteriaResolver[](0),bytes32(0),OTHER)); _reject(a); require(multi.balanceOf(OTHER,1)==2&&vault.nftHeld(address(multi),1)==0&&vault.totalSpent(address(0))==0); }
    function testMalformed1155RecipientAndMissing721BalanceRollBackAll() public { _policy(false); multi.configureFault(1,OTHER); _reject(_order(true,false,1)); require(multi.balanceOf(seller,1)==10&&multi.balanceOf(OTHER,1)==0&&FEE.balance==0); nft.configureFault(5,OTHER); _reject(_order(false,false,1)); require(nft.ownerOf(1)==seller&&seller.balance==0); }
    function testInterruptedNftAndFeeOnTransferOrOverpullRollback() public { _policy(true); multi.configureFault(3,OTHER); _reject(_order(true,true,1)); cash.configureFault(2); _reject(_order(false,true,1)); cash.configureFault(3); _reject(_order(false,true,1)); require(cash.allowance(address(vault),address(seaport))==0&&vault.totalSpent(address(cash))==0&&cash.balanceOf(FEE)==0); }
    function testExactIdsAndCollectionRuntimeRemainBinding() public { vm.prank(CREATOR); vault.disablePurchases(); uint256[] memory ids_=new uint256[](1); ids_[0]=1; vm.prank(CREATOR); vault.configureCollection(address(nft),1,address(nft).codehash,true,false,ids_); _policy(false); _reject(_order(false,false,2)); T.AdvancedOrder memory a=_order(false,false,1); vm.etch(address(nft),hex"00"); _reject(a); }
    function testChangedSeaportPaymentOrChainCannotRun() public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); T.Request memory r=_request(a); vm.chainId(4663); vm.expectRevert(); vault.purchase(a,r); vm.chainId(31337); vm.etch(address(seaport),hex"00"); vm.expectRevert(); vault.purchase(a,r); }
    function testFundingAndConfigurationOnlyCurrentController() public { vm.prank(OTHER); vm.expectRevert(); vault.fundNative{value:1}(keccak256("foreign")); vm.prank(OTHER); vm.expectRevert(); vault.configureFeeRecipient(OTHER,100); vm.prank(OTHER); vm.expectRevert(); vault.configurePolicy(T.Policy(address(0),1,1,1,1),true); }
    function testUnsolicited721And1155CallbacksCannotCreditCustody() public { vm.prank(seller); vm.expectRevert(); nft.safeTransferFrom(seller,address(vault),1); vm.prank(seller); vm.expectRevert(); multi.safeTransferFrom(seller,address(vault),1,1,""); require(vault.nftHeld(address(nft),1)==0&&vault.nftHeld(address(multi),1)==0); }
    function testForcedNativeIsNotSpendableOrWithdrawable() public { vm.deal(address(vault),20 ether); require(vault.available(address(0))==10 ether); vm.prank(CREATOR); vm.expectRevert(); vault.scheduleAssetWithdrawal(address(0),11 ether,OTHER,uint48(_now()+3 days)); _conserved(address(0)); }
    function testReservedFundsCannotBeSpentAndNoticeCannotExecuteEarly() public { vm.prank(CREATOR); uint64 id=vault.scheduleAssetWithdrawal(address(0),10 ether,OTHER,uint48(_now()+3 days)); _policy(false); _reject(_order(false,false,1)); vm.expectRevert(); vault.executeWithdrawal(id); vm.warp(_now()+2 days); vault.executeWithdrawal(id); require(OTHER.balance==10 ether&&vault.accountedHeld(address(0))==0); _conserved(address(0)); }
    function testPurchased721And1155OnlyLeaveAfterBoundedNotice() public { _policy(false); _buy(_order(false,false,1)); vm.warp(_now()+1); _buy(_order(true,false,2)); vm.startPrank(CREATOR); uint64 a=vault.scheduleNftWithdrawal(address(nft),1,1,OTHER,uint48(_now()+3 days)); uint64 b=vault.scheduleNftWithdrawal(address(multi),2,1,OTHER,uint48(_now()+3 days)); vm.stopPrank(); vm.expectRevert(); vault.executeWithdrawal(a); vm.warp(_now()+2 days); vault.executeWithdrawal(a); vault.executeWithdrawal(b); require(nft.ownerOf(1)==OTHER&&vault.nftHeld(address(nft),1)==0&&multi.balanceOf(OTHER,2)==1&&vault.nftHeld(address(multi),2)==1); }
    function testExpiredNoticeCancellationReleasesExactReserve() public { vm.prank(CREATOR); uint64 id=vault.scheduleAssetWithdrawal(address(cash),1 ether,OTHER,uint48(_now()+3 days)); vm.warp(_now()+3 days+1); vm.expectRevert(); vault.executeWithdrawal(id); vm.prank(OTHER); vault.cancelWithdrawal(id); require(vault.reservedAsset(address(cash))==0&&vault.available(address(cash))==10 ether); }
    function testControllerRotationDisablesPolicyAndInvalidatesOldNotices() public { _policy(false); vm.startPrank(CREATOR); uint64 id=vault.scheduleAssetWithdrawal(address(0),1 ether,CREATOR,uint48(_now()+3 days)); vault.proposeController(OTHER,uint48(_now()+3 days)); vm.stopPrank(); vm.prank(OTHER); vm.expectRevert(); vault.acceptController(); vm.warp(_now()+2 days); vm.prank(OTHER); vault.acceptController(); require(vault.controllerEpoch()==2&&!vault.purchasesEnabled()); vm.expectRevert(); vault.executeWithdrawal(id); vault.cancelWithdrawal(id); require(vault.reservedAsset(address(0))==0); }
    function testFuzzBelowAllInPriceAlwaysRollsBack(uint96 cap) public { uint128 bounded=uint128(uint256(cap)%.1 ether+1); if(bounded==.1 ether)return; vm.prank(CREATOR); vault.configurePolicy(T.Policy(address(0),bounded,10 ether,5 ether,1),true); _reject(_order(false,false,1)); require(nft.ownerOf(1)==seller&&FEE.balance==0); _conserved(address(0)); }
    function testFuzzWrongQuantityOrHashCannotSpend(uint256 quantity,bytes32 wrong) public { _policy(false); T.AdvancedOrder memory a=_order(false,false,1); if(quantity!=1) { a.parameters.offer[0].startAmount=quantity; a.parameters.offer[0].endAmount=quantity; _reject(_sign(a)); } a=_order(false,false,2); T.Request memory r=_request(a); if(wrong!=r.signedOrderHash) { r.signedOrderHash=wrong; vm.expectRevert(); vault.purchase(a,r); } _conserved(address(0)); }
}
