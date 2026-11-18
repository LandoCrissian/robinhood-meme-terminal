// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {PurchaseEvidenceV2} from "../src/PurchaseEvidenceV2.sol";
import {RMTTreasuryPurchaseV2Prototype} from "../src/RMTTreasuryPurchaseV2Prototype.sol";
import {RMTTreasuryPurchaseV2PrototypeFactory} from "../src/RMTTreasuryPurchaseV2PrototypeFactory.sol";

interface PurchaseVm {
    function chainId(uint256) external; function warp(uint256) external; function roll(uint256) external;
    function prank(address) external; function expectRevert() external; function etch(address,bytes calldata) external;
    function setBlockhash(uint256,bytes32) external; function deal(address,uint256) external;
}
// Shape-test stubs only. They are NOT admitted production identities or proof
// of independent market data. Real V1/curve/v4 regression is separate evidence.
contract PurchaseTreasuryStub {
    address public creator = address(0x100001); address public controller = address(0x100001);
    uint64 public controllerEpoch = 1; address public projectToken;
    bytes32 public constant intentId = keccak256("synthetic-intent"); uint256 public constant deploymentChainId = 31337;
    uint256 public nativeAvailable = 2 ether;
    constructor(address token) { projectToken = token; }
    function available(address asset) external view returns(uint256) { return asset == address(0) ? nativeAvailable : 1_000_000 ether; }
    function rotate(address next) external { controller=next; controllerEpoch++; }
    function setAvailable(uint256 value) external { nativeAvailable=value; }
}
contract PurchaseTokenStub { uint256 public constant totalSupply = 1_000_000_000 ether; }
contract PurchaseFactoryStub {
    mapping(address => address) public curveForToken;
    function route(address t,address c) external { curveForToken[t]=c; }
}
contract PurchaseCurveStub {
    address public token; address public factory; bool public active=true; bool public graduated;
    uint256 public backingReserve=1 ether; uint256 public sold=400_000_000 ether; uint256 public multiplier=1_000;
    constructor(address t,address f) { token=t;factory=f; }
    function quoteBuy(uint256 amount) external view returns(uint256,uint256,uint256,uint256) { return (amount*multiplier,amount,amount/100,0); }
    function change(uint256 m,bool a,bool g) external { multiplier=m;active=a;graduated=g; }
}
contract EvidenceHarness {
    function deviation(uint128 a,uint128 b) external pure returns(uint256) { return PurchaseEvidenceV2.priceDeviationBps(a,b); }
}
abstract contract PurchaseBoundaryV2Fixture {
    PurchaseVm constant vm=PurchaseVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant CREATOR=address(0x100001); address constant OTHER=address(0x100002);
    bytes32 constant ANCHOR=keccak256("canonical-previous-block");
    PurchaseTreasuryStub t; PurchaseFactoryStub f; PurchaseTokenStub token; PurchaseCurveStub curve;
    RMTTreasuryPurchaseV2PrototypeFactory factory; RMTTreasuryPurchaseV2Prototype p;
    RMTTreasuryPurchaseV2Prototype.Binding b;
    function setUp() public virtual {
        vm.chainId(31337); vm.warp(1_800_000_000); vm.roll(200); vm.setBlockhash(199,ANCHOR);
        token=new PurchaseTokenStub(); t=new PurchaseTreasuryStub(address(token)); f=new PurchaseFactoryStub();
        curve=new PurchaseCurveStub(address(token),address(f)); f.route(address(token),address(curve));
        b=RMTTreasuryPurchaseV2Prototype.Binding(address(t),address(t).codehash,address(f),address(f).codehash,address(token),address(token).codehash,
            address(curve),address(curve).codehash,address(0x200001),keccak256("canonical-full-pool-key"));
        factory=new RMTTreasuryPurchaseV2PrototypeFactory();
        vm.prank(CREATOR); p=RMTTreasuryPurchaseV2Prototype(factory.create(b));
    }
    function policy() internal pure returns(RMTTreasuryPurchaseV2Prototype.Policy memory) {
        return RMTTreasuryPurchaseV2Prototype.Policy(0.001 ether,0.01 ether,0.02 ether,3600,1 days,100,100);
    }
    function enable() internal { vm.prank(CREATOR); p.setPurchaseIntent(policy(),true); }
    function request() internal view returns(RMTTreasuryPurchaseV2Prototype.Request memory) {
        return RMTTreasuryPurchaseV2Prototype.Request(0.005 ether,1,uint48(block.timestamp+60),t.controllerEpoch(),p.policyEpoch(),p.curveRouteHash(),50,50);
    }
    function observation() internal view returns(PurchaseEvidenceV2.Observation memory) {
        return PurchaseEvidenceV2.Observation(31337,address(token),address(0),address(0x300001),address(0x300002),keccak256("claimed-other-pool"),
            199,ANCHOR,uint48(block.timestamp),1 days,2 ether,1_000_000 ether);
    }
    function blocked(RMTTreasuryPurchaseV2Prototype.Request memory r,PurchaseEvidenceV2.Observation memory o,bytes4 selector) internal {
        (bool ok,bytes memory reason)=address(p).call(abi.encodeCall(p.executePurchase,(r,o)));
        require(!ok && bytes4(reason)==selector,"expected exact rejection");
    }
}
contract PurchaseBoundaryV2Test is PurchaseBoundaryV2Fixture {
    function testDefaultOffAndNoSpendingAuthorityEvenWhenIntentEnabled() public {
        require(!p.purchasesEnabled() && !p.purchaseExecutionAvailable() && !p.spendingAuthority()); enable();
        require(p.purchasesEnabled() && !p.purchaseExecutionAvailable());
        require(p.inspectReference(observation())==PurchaseEvidenceV2.Status.Unadmitted);
        blocked(request(),observation(),RMTTreasuryPurchaseV2Prototype.NoIndependentReference.selector);
        require(address(p).balance==0 && address(t).balance==0);
    }
    function testImmediateRevocationInvalidatesAlreadyPreparedRequest() public {
        enable(); RMTTreasuryPurchaseV2Prototype.Request memory r=request();
        vm.prank(CREATOR); p.disablePurchases(); require(!p.purchasesEnabled());
        blocked(r,observation(),RMTTreasuryPurchaseV2Prototype.IntentDisabled.selector);
        enable(); blocked(r,observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
    }
    function testCurrentTreasuryControllerAndEpochAreRequired() public {
        vm.prank(OTHER); vm.expectRevert(); p.setPurchaseIntent(policy(),true);
        enable(); RMTTreasuryPurchaseV2Prototype.Request memory old=request(); t.rotate(OTHER);
        require(!p.purchasesEnabled()); vm.prank(CREATOR); vm.expectRevert(); p.disablePurchases();
        vm.prank(OTHER); p.setPurchaseIntent(policy(),true);
        blocked(old,observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
    }
    function testInvalidPolicyBoundsRejected() public {
        RMTTreasuryPurchaseV2Prototype.Policy memory x=policy(); x.minimumWei=0;
        vm.prank(CREATOR); vm.expectRevert(); p.setPurchaseIntent(x,true);
        x=policy(); x.perPeriodWei=x.perTransactionWei-1; vm.prank(CREATOR); vm.expectRevert(); p.setPurchaseIntent(x,true);
        x=policy(); x.cooldownSeconds=59; vm.prank(CREATOR); vm.expectRevert(); p.setPurchaseIntent(x,true);
        x=policy(); x.maxSlippageBps=501; vm.prank(CREATOR); vm.expectRevert(); p.setPurchaseIntent(x,true);
    }
    function testRequestIdentityLimitsDeadlineAndSlippage() public {
        enable(); RMTTreasuryPurchaseV2Prototype.Request memory r=request(); p.reviewRequest(r);
        r.amountWei=1 ether; blocked(r,observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
        r=request(); r.routeHash=keccak256("wrong-router"); blocked(r,observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
        r=request(); r.deadline=uint48(block.timestamp-1); blocked(r,observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
        r=request(); r.quotedImpactBps=101; blocked(r,observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
        r=request(); r.minimumTokenOut=type(uint256).max; blocked(r,observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
    }
    function testTokenOnlyIncomeDoesNotBecomeEthPurchaseCapital() public {
        enable(); t.setAvailable(0); blocked(request(),observation(),RMTTreasuryPurchaseV2Prototype.InvalidRequest.selector);
        require(t.available(address(token))>0);
    }
    function testSameMarketTwapOrSecondRpcIsNotIndependent() public {
        PurchaseEvidenceV2.Observation memory o=observation(); o.source=address(curve);
        require(p.inspectReference(o)==PurchaseEvidenceV2.Status.SameMarket);
        o=observation(); o.originPoolId=b.poolId; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.SameMarket);
        o=observation(); o.originMarket=address(curve); require(p.inspectReference(o)==PurchaseEvidenceV2.Status.SameMarket);
    }
    function testStaleFutureReorgAndWrongIdentityEvidence() public {
        PurchaseEvidenceV2.Observation memory o=observation(); o.chainId=4663; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.WrongIdentity);
        o=observation(); o.token=OTHER; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.WrongIdentity);
        o=observation(); o.blockNumber=200; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.Future);
        o=observation(); o.observedAt-=61; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.Stale);
        o=observation(); vm.setBlockhash(199,keccak256("orphan-replacement")); require(p.inspectReference(o)==PurchaseEvidenceV2.Status.Reorged);
    }
    function testZeroPriceThinLiquidityAndInsufficientHistory() public {
        PurchaseEvidenceV2.Observation memory o=observation(); o.tokensPerEth=0; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.Missing);
        o=observation(); o.historySeconds=1; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.ThinHistory);
        o=observation(); o.nativeLiquidity=1; require(p.inspectReference(o)==PurchaseEvidenceV2.Status.ThinLiquidity);
    }
    function testManipulatedSpotPushPullCannotAdmitReference() public {
        enable(); uint256 original=p.readCurveQuote(0.005 ether).tokensOut;
        curve.change(100_000,true,false); require(p.readCurveQuote(0.005 ether).tokensOut>original);
        blocked(request(),observation(),RMTTreasuryPurchaseV2Prototype.NoIndependentReference.selector);
        curve.change(1000,true,false); blocked(request(),observation(),RMTTreasuryPurchaseV2Prototype.NoIndependentReference.selector);
    }
    function testMigrationAndGraduationInvalidatePinnedCurveRoute() public {
        f.route(address(token),OTHER); vm.expectRevert(); p.readCurveQuote(1);
        f.route(address(token),address(curve)); curve.change(1000,false,true); vm.expectRevert(); p.readCurveQuote(1);
    }
    function testRuntimeChangeAndWrongChainFailClosed() public {
        vm.etch(address(token),hex"00"); vm.expectRevert(); p.readCurveQuote(1);
        vm.chainId(4663); vm.expectRevert(); new RMTTreasuryPurchaseV2PrototypeFactory();
        vm.expectRevert(); new RMTTreasuryPurchaseV2Prototype(b);
        vm.expectRevert(); p.disablePurchases();
    }
    function testUniqueCreate2DuplicateAndFailedCreationRollback() public {
        require(factory.predict(b)==address(p));
        vm.prank(CREATOR); vm.expectRevert(); factory.create(b);
        vm.prank(OTHER); vm.expectRevert(); factory.create(b);
        RMTTreasuryPurchaseV2PrototypeFactory fresh=new RMTTreasuryPurchaseV2PrototypeFactory();
        RMTTreasuryPurchaseV2Prototype.Binding memory bad=b; bad.curveHash=bytes32(uint256(1));
        address predicted=fresh.predict(bad); vm.prank(CREATOR); vm.expectRevert(); fresh.create(bad);
        require(predicted.code.length==0 && fresh.prototypeForTreasury(address(t))==address(0));
        vm.prank(CREATOR); require(fresh.create(b)!=address(p));
    }
    function testNoPayableArbitraryCallsOrApprovalAuthority() public {
        vm.deal(address(this),1 ether); (bool funded,)=address(p).call{value:1}(""); require(!funded);
        (bool arbitrary,)=address(p).call(abi.encodeWithSignature("approve(address,uint256)",OTHER,1)); require(!arbitrary);
        require(address(p).balance==0);
    }
    function testFuzzNoClaimedIndependentObservationEnablesSpending(address source,uint128 price,uint128 liquidity,uint32 history) public {
        enable(); PurchaseEvidenceV2.Observation memory o=observation(); o.source=source;o.tokensPerEth=price;o.nativeLiquidity=liquidity;o.historySeconds=history;
        blocked(request(),o,RMTTreasuryPurchaseV2Prototype.NoIndependentReference.selector);
        require(!p.purchaseExecutionAvailable() && !p.spendingAuthority());
    }
    function testFuzzActualPriceDeviationUsesPriceNotSqrt(uint128 price,uint128 referencePrice) public {
        if(referencePrice==0) referencePrice=1; EvidenceHarness h=new EvidenceHarness();
        uint256 difference=price>referencePrice?uint256(price)-referencePrice:uint256(referencePrice)-price;
        require(h.deviation(price,referencePrice)==difference*10_000/referencePrice);
        // A 1% sqrt-price rise is a 2.01% actual price rise.
        require(h.deviation(10201,10000)==201);
    }
}

contract PurchaseV2InvariantHandler {
    PurchaseVm constant vm=PurchaseVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    RMTTreasuryPurchaseV2Prototype public p;
    PurchaseTreasuryStub public treasury;
    uint256 public attempts;
    uint256 public successfulPurchases;
    constructor(RMTTreasuryPurchaseV2Prototype prototype,PurchaseTreasuryStub t) { p=prototype;treasury=t; }
    function toggle(bool enabled) external {
        vm.prank(treasury.controller()); p.setPurchaseIntent(RMTTreasuryPurchaseV2Prototype.Policy(1,0.01 ether,0.02 ether,60,1 days,100,100),enabled);
    }
    function disable() external { vm.prank(treasury.controller());p.disablePurchases(); }
    function rotate(bool next) external { treasury.rotate(next?address(0x100001):address(0x100002)); }
    function attempt(uint128 amount,uint128 price) external {
        RMTTreasuryPurchaseV2Prototype.Request memory r=RMTTreasuryPurchaseV2Prototype.Request(uint256(amount),1,uint48(block.timestamp+60),
            treasury.controllerEpoch(),p.policyEpoch(),p.curveRouteHash(),50,50);
        (,,address factory,,address token,,address curve,,address poolManager,bytes32 poolId)=p.binding();
        factory;poolManager;poolId;
        PurchaseEvidenceV2.Observation memory o=PurchaseEvidenceV2.Observation(block.chainid,token,address(0),address(0x300001),
            address(0x300002),keccak256("claimed-independent"),uint64(block.number-1),blockhash(block.number-1),uint48(block.timestamp),1 days,2 ether,price);
        curve;
        (bool ok,)=address(p).call(abi.encodeCall(p.executePurchase,(r,o)));attempts++;if(ok)successfulPurchases++;
    }
}
contract PurchaseV2InvariantTest is PurchaseBoundaryV2Fixture {
    PurchaseV2InvariantHandler handler;
    function setUp() public override {
        super.setUp();handler=new PurchaseV2InvariantHandler(p,t);
    }
    function targetContracts() external view returns(address[] memory result) { result=new address[](1);result[0]=address(handler); }
    function invariantNoPolicyOrEpochSequenceCreatesSpendingAuthority() public view {
        require(!p.purchaseExecutionAvailable() && !p.spendingAuthority() && handler.successfulPurchases()==0);
        require(address(p).balance==0 && token.totalSupply()==1_000_000_000 ether);
        if(p.purchasesEnabled()) require(p.policyControllerEpoch()==t.controllerEpoch());
    }
}
