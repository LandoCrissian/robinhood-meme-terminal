// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolPins} from "../src/TreasuryInterfaces.sol";
import {RMTProjectTreasuryV1} from "../src/RMTProjectTreasuryV1.sol";
import {RMTProjectTreasuryFactoryV1} from "../src/RMTProjectTreasuryFactoryV1.sol";
import {TreasuryCoreMock,TreasuryEngineMock,TreasuryCurveMock,TreasuryTokenMock,TreasuryLedgerMock,TreasuryPositionsMock,
    TreasuryHostileTokenMock,TreasuryRejectReceiverMock,TreasuryCallbackReceiverMock} from "./TreasuryMocks.sol";

interface TreasuryVm {
    function chainId(uint256) external; function deal(address,uint256) external; function prank(address) external;
    function startPrank(address) external; function stopPrank() external; function warp(uint256) external;
    function roll(uint256) external; function expectRevert() external; function expectRevert(bytes4) external;
    function etch(address,bytes calldata) external;
    function getBlockTimestamp() external view returns(uint256);
}

contract RMTProjectTreasuryV1Test {
    TreasuryVm private constant vm=TreasuryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATOR=address(0x100001); address private constant NEXT=address(0x100002); address private constant OTHER=address(0x100003);
    bytes32 private constant INTENT=keccak256("project-one");
    TreasuryCoreMock internal core; TreasuryEngineMock internal engine; TreasuryTokenMock internal token;
    RMTProjectTreasuryFactoryV1 internal factory; RMTProjectTreasuryV1 internal treasury;
    TreasuryCurveMock internal curve; TreasuryLedgerMock internal curveFees; TreasuryLedgerMock internal lpFees;
    ProtocolPins internal pins;
    function setUp() public {
        vm.chainId(31337); vm.warp(1_800_000_000); vm.roll(100); vm.deal(address(this),100 ether); vm.deal(CREATOR,100 ether);
        core=new TreasuryCoreMock(); engine=new TreasuryEngineMock(address(core)); core.setEngine(address(engine)); token=new TreasuryTokenMock();
        pins=ProtocolPins(address(core),address(core).codehash,address(engine),address(engine).codehash,address(token).codehash);
        factory=new RMTProjectTreasuryFactoryV1(pins);
        vm.prank(CREATOR); treasury=RMTProjectTreasuryV1(payable(factory.create(INTENT,CREATOR,2250,type(RMTProjectTreasuryV1).creationCode)));
        curve=new TreasuryCurveMock(CREATOR,address(treasury),2250,address(token),address(core),address(engine));
        core.register(CREATOR,INTENT,address(token),address(curve)); treasury.bindProject(); curveFees=TreasuryLedgerMock(payable(curve.revenueLedger()));
        lpFees=new TreasuryLedgerMock(CREATOR,address(treasury),2250,address(engine),address(token)); engine.setLedger(address(token),address(lpFees));
    }
    function _expiry() internal view returns(uint48) { return uint48(vm.getBlockTimestamp()+3 days); }
    function _queue(address asset,address recipient,uint256 amount) internal returns(uint64 id) { vm.prank(CREATOR); return treasury.queueWithdrawal(asset,recipient,amount,_expiry()); }
    function _policy(bool enabled) internal {
        vm.prank(CREATOR); treasury.setPurchasePolicy(RMTProjectTreasuryV1.PurchasePolicy(1 ether,2 ether,0.01 ether,60,1 days,100,100),enabled);
    }
    function _request() internal view returns(RMTProjectTreasuryV1.PurchaseRequest memory) {
        return RMTProjectTreasuryV1.PurchaseRequest(0.1 ether,1 ether,uint48(vm.getBlockTimestamp()+60),uint48(vm.getBlockTimestamp()),uint64(block.number-1),treasury.purchasePolicyEpoch(),keccak256("route"),keccak256("reference"),10,10);
    }
    function testPredictAndCreatorIntentIsolationAndNoRepeatedInitialization() public {
        require(factory.predict(CREATOR,INTENT,CREATOR,2250,type(RMTProjectTreasuryV1).creationCode)==address(treasury)); require(treasury.controllerInitialized());
        require(treasury.deploymentFactory()==address(factory));
        vm.prank(OTHER); vm.expectRevert(); treasury.initializeController();
        vm.prank(CREATOR); vm.expectRevert(); factory.create(INTENT,CREATOR,2250,type(RMTProjectTreasuryV1).creationCode);
        vm.prank(OTHER); address distinct=factory.create(INTENT,OTHER,2250,type(RMTProjectTreasuryV1).creationCode); require(distinct!=address(treasury));
        require(treasury.creator()==CREATOR && treasury.controller()==CREATOR && treasury.treasuryShareBps()==2250);
    }
    function testUnsupportedInitialControllerRollsBackCreateAndCanRetry() public {
        TreasuryRejectReceiverMock unsupported=new TreasuryRejectReceiverMock(); bytes32 intent=keccak256("failed-create");
        address predicted=factory.predict(CREATOR,intent,address(unsupported),2250,type(RMTProjectTreasuryV1).creationCode);
        vm.prank(CREATOR); vm.expectRevert(); factory.create(intent,address(unsupported),2250,type(RMTProjectTreasuryV1).creationCode);
        require(predicted.code.length==0 && factory.treasuryForIntent(CREATOR,intent)==address(0));
        vm.prank(CREATOR); address valid=factory.create(intent,CREATOR,2250,type(RMTProjectTreasuryV1).creationCode); require(valid.code.length>0);
    }
    function testUninitializedDirectDeploymentCannotUseControllerActionsOrBeHijacked() public {
        RMTProjectTreasuryV1 direct=new RMTProjectTreasuryV1(CREATOR,keccak256("direct"),CREATOR,0,pins);
        vm.prank(CREATOR); vm.expectRevert(); direct.disablePurchases();
        vm.prank(OTHER); vm.expectRevert(); direct.initializeController();
        direct.initializeController(); vm.prank(CREATOR); direct.disablePurchases();
        vm.expectRevert(); direct.initializeController();
    }
    function testBindingRejectsWrongCreatorIntentShareAndUnregisteredClone() public {
        vm.prank(CREATOR); RMTProjectTreasuryV1 side=RMTProjectTreasuryV1(payable(factory.create(keccak256("unbound"),CREATOR,9000,type(RMTProjectTreasuryV1).creationCode)));
        vm.expectRevert(); side.bindProject();
        core.register(CREATOR,keccak256("unbound"),address(token),address(curve)); vm.expectRevert(); side.bindProject();
        vm.prank(CREATOR); vm.expectRevert(); factory.create(keccak256("invalid"),CREATOR,9001,type(RMTProjectTreasuryV1).creationCode);
    }
    function testZeroShareSidecarUsesCoreZeroTreasury() public {
        bytes32 intent=keccak256("zero"); TreasuryTokenMock otherToken=new TreasuryTokenMock();
        vm.prank(CREATOR); RMTProjectTreasuryV1 side=RMTProjectTreasuryV1(payable(factory.create(intent,CREATOR,0,type(RMTProjectTreasuryV1).creationCode)));
        TreasuryCurveMock zero=new TreasuryCurveMock(CREATOR,address(0),0,address(otherToken),address(core),address(engine));
        core.register(CREATOR,intent,address(otherToken),address(zero)); require(side.bindProject()==address(otherToken));
        side.depositNative{value:1 ether}(); require(side.accountedHeld(address(0))==1 ether && !side.purchasesEnabled());
    }
    function testNativeFundingKindsAndUnsolicitedAreNotGuaranteedRoyalties() public {
        treasury.depositNative{value:1 ether}(); treasury.depositRoyaltyNative{value:2 ether}(keccak256("declared-only"));
        (bool ok,)=payable(address(treasury)).call{value:3 ether}(""); require(ok);
        (uint256 manual,uint256 royalty,uint256 unsolicited,,,,)=treasury.totals(address(0));
        require(manual==1 ether && royalty==2 ether && unsolicited==3 ether && treasury.accountedHeld(address(0))==6 ether);
        vm.expectRevert(); treasury.depositRoyaltyNative{value:1}(bytes32(0));
    }
    function testCurveAndLpClaimsCallAsTreasuryAndPreserveOriginalPrincipal() public {
        curveFees.credit{value:0.25 ether}(); vm.prank(OTHER); vm.expectRevert(); treasury.claimCurve();
        vm.prank(CREATOR); require(treasury.claimCurve()==0.25 ether);
        lpFees.credit{value:0.5 ether}(); token.transfer(address(lpFees),100 ether); lpFees.creditToken(100 ether);
        vm.prank(CREATOR); (uint256 n,uint256 t)=treasury.claimLp(1); require(n==0.5 ether && t==0 && lpFees.tokenCredit()==100 ether);
        vm.prank(CREATOR); (n,t)=treasury.claimLp(2); require(n==0 && t==100 ether);
        (,uint128 liquidity)=engine.positions(address(token)); require(liquidity==10000 && token.balanceOf(address(treasury))==100 ether);
        (,,,uint256 curveAmount,uint256 lpAmount,,)=treasury.totals(address(0)); require(curveAmount==0.25 ether && lpAmount==0.5 ether);
    }
    function testInterruptedClaimsAndCustodyMismatchNeverCreditSuccess() public {
        curveFees.credit{value:1 ether}(); curveFees.setReject(true);
        vm.prank(CREATOR); vm.expectRevert(); treasury.claimCurve(); require(treasury.accountedHeld(address(0))==0 && curveFees.nativeCredit()==1 ether);
        TreasuryPositionsMock(engine.positionManager()).configure(OTHER,10000,address(0));
        vm.prank(CREATOR); vm.expectRevert(); treasury.claimLp(0);
        vm.prank(CREATOR); vm.expectRevert(); treasury.collectLpFees(vm.getBlockTimestamp()+60);
    }
    function testTokenManualRoyaltyAndUnsolicitedDeltaAndDisableNeverFreezeAssets() public {
        token.approve(address(treasury),30 ether); treasury.depositToken(address(token),10 ether); treasury.depositRoyaltyToken(address(token),10 ether,keccak256("token-royalty"));
        token.transfer(address(treasury),10 ether); treasury.reconcile(address(token));
        (uint256 manual,uint256 royalty,uint256 unsolicited,,,,)=treasury.totals(address(token)); require(manual==10 ether && royalty==10 ether && unsolicited==10 ether);
        vm.prank(CREATOR); treasury.disableAsset(address(token)); vm.expectRevert(); treasury.depositToken(address(token),1);
        uint64 id=_queue(address(token),OTHER,30 ether); vm.warp(vm.getBlockTimestamp()+2 days); treasury.executeWithdrawal(id);
        require(token.balanceOf(OTHER)==30 ether && treasury.accountedHeld(address(token))==0 && treasury.pendingWithdrawals()==0);
    }
    function testUnknownHostileAndUnregisteredTokenAdmissionFailsEvenWithSuppliedHash() public {
        TreasuryHostileTokenMock hostile=new TreasuryHostileTokenMock();
        vm.prank(CREATOR); vm.expectRevert(); treasury.proposeAsset(address(hostile),address(hostile).codehash,_expiry());
        TreasuryTokenMock unregistered=new TreasuryTokenMock(); vm.prank(CREATOR); treasury.proposeAsset(address(unregistered),address(unregistered).codehash,_expiry());
        vm.warp(vm.getBlockTimestamp()+2 days); vm.expectRevert(); treasury.executeAssetAdmission();
        vm.prank(CREATOR); treasury.cancelAssetAdmission();
    }
    function testStandardRegisteredTokenAdmissionRequiresNoticeAndExactImmutableRuntime() public {
        TreasuryTokenMock otherToken=new TreasuryTokenMock(); TreasuryCurveMock otherCurve=new TreasuryCurveMock(OTHER,address(0),0,address(otherToken),address(core),address(engine));
        core.register(OTHER,keccak256("another"),address(otherToken),address(otherCurve));
        vm.prank(CREATOR); treasury.proposeAsset(address(otherToken),address(otherToken).codehash,_expiry());
        vm.expectRevert(); treasury.executeAssetAdmission(); vm.warp(vm.getBlockTimestamp()+2 days); treasury.executeAssetAdmission();
        otherToken.approve(address(treasury),7 ether); treasury.depositToken(address(otherToken),7 ether); require(treasury.accountedHeld(address(otherToken))==7 ether);
    }
    function testUnboundAssetLimitReservesProjectTokenSlot() public {
        bytes32 intent=keccak256("slot-reservation");
        vm.prank(CREATOR); RMTProjectTreasuryV1 side=RMTProjectTreasuryV1(payable(factory.create(intent,CREATOR,2250,type(RMTProjectTreasuryV1).creationCode)));
        for(uint256 i;i<7;i++) {
            TreasuryTokenMock extra=new TreasuryTokenMock(); TreasuryCurveMock extraCurve=new TreasuryCurveMock(OTHER,address(0),0,address(extra),address(core),address(engine));
            core.register(OTHER,bytes32(i+100),address(extra),address(extraCurve));
            vm.prank(CREATOR); side.proposeAsset(address(extra),address(extra).codehash,_expiry()); vm.warp(vm.getBlockTimestamp()+2 days); side.executeAssetAdmission();
        }
        TreasuryTokenMock eighth=new TreasuryTokenMock(); TreasuryCurveMock eighthCurve=new TreasuryCurveMock(OTHER,address(0),0,address(eighth),address(core),address(engine));
        core.register(OTHER,keccak256("eighth"),address(eighth),address(eighthCurve));
        vm.prank(CREATOR); side.proposeAsset(address(eighth),address(eighth).codehash,_expiry()); vm.warp(vm.getBlockTimestamp()+2 days);
        vm.expectRevert(RMTProjectTreasuryV1.InvalidAsset.selector); side.executeAssetAdmission();
        TreasuryTokenMock project=new TreasuryTokenMock(); TreasuryCurveMock projectCurve=new TreasuryCurveMock(CREATOR,address(side),2250,address(project),address(core),address(engine));
        core.register(CREATOR,intent,address(project),address(projectCurve)); side.bindProject(); require(side.assets().length==8);
    }
    function testFactoryRejectsChangedOrOversizedCreationTemplateWithoutConsumingIntent() public {
        bytes32 intent=keccak256("template"); require(factory.treasuryCreationCodeHash()==keccak256(type(RMTProjectTreasuryV1).creationCode));
        vm.prank(CREATOR); vm.expectRevert(); factory.create(intent,CREATOR,0,hex"6000");
        vm.prank(CREATOR); vm.expectRevert(); factory.create(intent,CREATOR,0,new bytes(32769));
        require(factory.treasuryForIntent(CREATOR,intent)==address(0));
        vm.prank(CREATOR); address valid=factory.create(intent,CREATOR,0,type(RMTProjectTreasuryV1).creationCode); require(valid.code.length>0);
    }
    function testControllerNoticeIncomingAcceptanceExpiryAndStaleReservations() public {
        treasury.depositNative{value:2 ether}(); uint64 id=_queue(address(0),OTHER,1 ether);
        vm.prank(CREATOR); treasury.proposeController(NEXT,_expiry()); vm.prank(NEXT); vm.expectRevert(); treasury.acceptController();
        vm.warp(vm.getBlockTimestamp()+2 days); vm.prank(OTHER); vm.expectRevert(); treasury.acceptController();
        vm.prank(NEXT); treasury.acceptController(); require(treasury.controller()==NEXT && treasury.controllerEpoch()==2 && !treasury.purchasesEnabled());
        vm.expectRevert(); treasury.executeWithdrawal(id); treasury.cancelWithdrawal(id); require(treasury.reserved(address(0))==0);
        vm.prank(CREATOR); vm.expectRevert(); treasury.disablePurchases(); vm.prank(NEXT); treasury.proposeController(CREATOR,_expiry());
        vm.warp(vm.getBlockTimestamp()+4 days); vm.prank(CREATOR); vm.expectRevert(); treasury.acceptController(); treasury.cancelControllerChange();
    }
    function testRejectedWithdrawalAndCallbackReentrancyPreserveReservationsAndConservation() public {
        treasury.depositNative{value:2 ether}(); TreasuryRejectReceiverMock reject=new TreasuryRejectReceiverMock(); uint64 failed=_queue(address(0),address(reject),1 ether);
        vm.warp(vm.getBlockTimestamp()+2 days); vm.expectRevert(); treasury.executeWithdrawal(failed); require(treasury.reserved(address(0))==1 ether && treasury.accountedHeld(address(0))==2 ether);
        vm.prank(CREATOR); treasury.cancelWithdrawal(failed);
        TreasuryCallbackReceiverMock receiver=new TreasuryCallbackReceiverMock(); uint64 id=_queue(address(0),address(receiver),1 ether); receiver.configure(address(treasury),id);
        vm.warp(vm.getBlockTimestamp()+2 days); treasury.executeWithdrawal(id); require(!receiver.attacked() && treasury.accountedHeld(address(0))==1 ether);
        vm.expectRevert(); treasury.executeWithdrawal(id);
    }
    function testBoundedPendingWithdrawalsExpiredCancellationAndNoBalanceFreezeWhenOff() public {
        treasury.depositNative{value:100}(); for(uint256 i;i<16;i++) _queue(address(0),OTHER,1);
        vm.prank(CREATOR); vm.expectRevert(); treasury.queueWithdrawal(address(0),OTHER,1,_expiry());
        require(treasury.withdrawalIds().length==16 && treasury.available(address(0))==84); vm.warp(vm.getBlockTimestamp()+4 days);
        for(uint64 i=1;i<=16;i++) treasury.cancelWithdrawal(i);
        require(treasury.available(address(0))==100 && treasury.withdrawalIds().length==0 && !treasury.purchasesEnabled());
    }
    function testPurchaseDefaultsOffThenValidatesBoundsButNeverSpendsWithoutIndependentReference() public {
        treasury.depositNative{value:1 ether}(); RMTProjectTreasuryV1.PurchaseRequest memory request=_request();
        vm.expectRevert(RMTProjectTreasuryV1.PurchaseDisabled.selector); treasury.executePurchase(request);
        _policy(true); request=_request(); vm.expectRevert(RMTProjectTreasuryV1.UnsupportedIndependentReference.selector); treasury.executePurchase(request);
        require(treasury.accountedHeld(address(0))==1 ether && address(treasury).balance==1 ether && !treasury.purchaseExecutionAvailable());
        request.amountWei=2 ether; vm.expectRevert(RMTProjectTreasuryV1.InvalidPurchase.selector); treasury.executePurchase(request);
        request=_request(); request.quoteObservedAt=uint48(vm.getBlockTimestamp()-61); vm.expectRevert(); treasury.executePurchase(request);
        request=_request(); uint64 id=_queue(address(0),OTHER,1 ether); vm.expectRevert(); treasury.executePurchase(request);
        vm.prank(CREATOR); treasury.cancelWithdrawal(id); vm.prank(CREATOR); treasury.disablePurchases(); vm.expectRevert(RMTProjectTreasuryV1.PurchaseDisabled.selector); treasury.executePurchase(request);
    }
    function testFuzz_NativeConservationWithReservationAndCancellation(uint96 amountRaw,uint96 payoutRaw) public {
        uint256 amount=uint256(amountRaw)%10 ether+1; uint256 payout=uint256(payoutRaw)%amount+1;
        treasury.depositNative{value:amount}(); uint64 id=_queue(address(0),OTHER,payout);
        require(treasury.available(address(0))+treasury.reserved(address(0))==amount);
        vm.warp(vm.getBlockTimestamp()+2 days); treasury.executeWithdrawal(id);
        (uint256 manual,,,,,uint256 withdrawn,)=treasury.totals(address(0)); require(manual==amount && withdrawn==payout);
        require(treasury.accountedHeld(address(0))==amount-payout && address(treasury).balance==amount-payout);
    }
    function testFuzz_CreatorIntentAndControllerCannotCollide(uint256 value) public {
        bytes32 intent=keccak256(abi.encode(value)); if(intent==INTENT || intent==bytes32(0)) return;
        address expected=factory.predict(CREATOR,intent,CREATOR,0,type(RMTProjectTreasuryV1).creationCode); vm.prank(CREATOR); address deployed=factory.create(intent,CREATOR,0,type(RMTProjectTreasuryV1).creationCode);
        require(expected==deployed && deployed!=address(treasury) && factory.treasuryForIntent(OTHER,intent)==address(0));
    }
}

