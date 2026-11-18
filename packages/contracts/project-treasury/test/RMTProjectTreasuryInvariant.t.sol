// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolPins} from "../src/TreasuryInterfaces.sol";
import {RMTProjectTreasuryV1} from "../src/RMTProjectTreasuryV1.sol";
import {RMTProjectTreasuryFactoryV1} from "../src/RMTProjectTreasuryFactoryV1.sol";
import {TreasuryCoreMock,TreasuryEngineMock,TreasuryCurveMock,TreasuryTokenMock} from "./TreasuryMocks.sol";
import {TreasuryVm} from "./RMTProjectTreasuryV1.t.sol";

contract TreasuryAccountingHandler {
    TreasuryVm private constant vm=TreasuryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    RMTProjectTreasuryV1 public immutable treasury;
    constructor(RMTProjectTreasuryV1 t) { treasury=t; }
    function deposit(uint96 raw) external { uint256 amount=uint256(raw)%1e15+1; vm.deal(address(this),amount); treasury.depositNative{value:amount}(); }
    function royalty(uint96 raw) external { uint256 amount=uint256(raw)%1e15+1; vm.deal(address(this),amount); treasury.depositRoyaltyNative{value:amount}(keccak256("self-declared-not-marketplace-proof")); }
    function queue(uint96 raw) external {
        uint256 balance=treasury.available(address(0)); if(balance==0) return;
        vm.prank(treasury.controller());
        try treasury.queueWithdrawal(address(0),address(0x400001),uint256(raw)%balance+1,uint48(vm.getBlockTimestamp()+3 days)) {} catch {}
    }
    function cancel(uint256 raw) external {
        uint64[] memory ids=treasury.withdrawalIds(); if(ids.length==0) return;
        vm.prank(treasury.controller()); treasury.cancelWithdrawal(ids[raw%ids.length]);
    }
    function execute(uint256 raw) external {
        uint64[] memory ids=treasury.withdrawalIds(); if(ids.length==0) return;
        vm.warp(vm.getBlockTimestamp()+2 days);
        try treasury.executeWithdrawal(ids[raw%ids.length]) {} catch {}
    }
    function disable() external { vm.prank(treasury.controller()); treasury.disablePurchases(); }
}

contract RMTProjectTreasuryInvariantTest {
    TreasuryVm private constant vm=TreasuryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    RMTProjectTreasuryV1 private treasury; TreasuryAccountingHandler private handler;
    function setUp() public {
        vm.chainId(31337); vm.warp(1_800_000_000);
        TreasuryCoreMock core=new TreasuryCoreMock(); TreasuryEngineMock engine=new TreasuryEngineMock(address(core)); core.setEngine(address(engine));
        TreasuryTokenMock token=new TreasuryTokenMock();
        RMTProjectTreasuryFactoryV1 factory=new RMTProjectTreasuryFactoryV1(ProtocolPins(address(core),address(core).codehash,address(engine),address(engine).codehash,address(token).codehash));
        vm.prank(address(0x100001)); treasury=RMTProjectTreasuryV1(payable(factory.create(keccak256("invariant"),address(0x100001),0,type(RMTProjectTreasuryV1).creationCode)));
        handler=new TreasuryAccountingHandler(treasury);
    }
    function targetContracts() external view returns(address[] memory result) { result=new address[](1); result[0]=address(handler); }
    function invariant_AssetConservationAndReservationBounds() external view {
        uint256 held=treasury.accountedHeld(address(0));
        (uint256 manual,uint256 royalty,uint256 unsolicited,uint256 curveFees,uint256 lpFees,uint256 withdrawn,)=treasury.totals(address(0));
        require(held==address(treasury).balance && treasury.reserved(address(0))<=held);
        require(treasury.available(address(0))+treasury.reserved(address(0))==held);
        require(manual+royalty+unsolicited+curveFees+lpFees==held+withdrawn);
        require(treasury.pendingWithdrawals()<=16 && treasury.withdrawalIds().length==treasury.pendingWithdrawals());
        require(!treasury.purchasesEnabled() && !treasury.purchaseExecutionAvailable());
    }
}
