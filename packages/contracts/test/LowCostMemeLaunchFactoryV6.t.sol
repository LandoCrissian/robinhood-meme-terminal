// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV4} from "../src/LowCostMemeLaunchFactoryV4.sol";
import {LowCostMemeLaunchFactoryV5} from "../src/LowCostMemeLaunchFactoryV5.sol";
import {LowCostMemeLaunchFactoryV6} from "../src/LowCostMemeLaunchFactoryV6.sol";
import {ProtocolRevenueRouterV2} from "../src/ProtocolRevenueRouterV2.sol";
import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";
import {RewardsControllerMock} from "./LowCostMemeLaunchFactoryV4.t.sol";

interface V6FactoryVm {
    function prank(address account) external;
}

contract LowCostMemeLaunchFactoryV6Test {
    V6FactoryVm private constant vm = V6FactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ATTACKER = address(0xBAD);
    address[5] private destinations =
        [address(0x1001), address(0x1002), address(0x1003), address(0x1004), address(0x1005)];

    LowCostMemeLaunchFactoryV4 private v4;
    LowCostMemeLaunchFactoryV5 private v5;
    LowCostMemeLaunchFactoryV6 private v6;
    address private officialLegacyToken;

    function setUp() public {
        MockGraduationAdapter adapter = new MockGraduationAdapter();
        RewardsControllerMock controller = new RewardsControllerMock();
        ProtocolRevenueRouterV2 router = new ProtocolRevenueRouterV2(destinations);
        v4 = new LowCostMemeLaunchFactoryV4(
            address(adapter), 100, 0.3 ether, 1_017_500_000 ether, 2 ether, address(controller), address(router)
        );
        (officialLegacyToken,,) = v4.launchCommunity("Robinhood Meme Terminal", "RMT", "ipfs://legacy");
        v4.launchSimple("Other Protected Token", "OTHER", "");
        v5 = new LowCostMemeLaunchFactoryV5(
            address(adapter),
            100,
            0.3 ether,
            1_017_500_000 ether,
            2 ether,
            address(controller),
            address(router),
            address(v4)
        );
        v6 = new LowCostMemeLaunchFactoryV6(
            address(adapter),
            100,
            0.3 ether,
            1_017_500_000 ether,
            2 ether,
            address(controller),
            address(router),
            address(v5),
            officialLegacyToken,
            address(this)
        );
    }

    function testOnlyVerifiedAuthorityCanConsumeOfficialMigration() public {
        vm.prank(ATTACKER);
        (bool unauthorized,) = address(v6).call(abi.encodeCall(v6.launchOfficialCommunity, ("ipfs://attack")));
        require(!unauthorized, "unauthorized migration accepted");
        require(!v6.officialMigrationComplete(), "failed attempt consumed migration");

        (address token,,) = v6.launchOfficialCommunity("ipfs://replacement");
        CloneFixedSupplyMemeToken replacement = CloneFixedSupplyMemeToken(token);
        require(v6.officialMigrationComplete(), "migration not consumed");
        require(replacement.creator() == address(this), "wrong creator");
        require(keccak256(bytes(replacement.name())) == keccak256("Robinhood Meme Terminal"), "wrong name");
        require(keccak256(bytes(replacement.symbol())) == keccak256("RMT"), "wrong ticker");
        require(v6.isNameUsed("robinhood-meme_terminal"), "canonical name not protected");
        require(v6.isSymbolUsed("rmt"), "canonical ticker not protected");
    }

    function testOfficialMigrationIsExactlyOnceAndCannotUseOrdinaryPath() public {
        (bool ordinary,) = address(v6).call(
            abi.encodeCall(v6.launchSimple, ("Robinhood Meme Terminal", "RMT", "ipfs://ordinary"))
        );
        require(!ordinary, "ordinary duplicate bypassed");

        v6.launchOfficialSimple("ipfs://official");
        (bool repeated,) = address(v6).call(abi.encodeCall(v6.launchOfficialSimple, ("ipfs://repeat")));
        require(!repeated, "official migration repeated");
        require(v6.launchCount() == 1, "unexpected launch count");
    }

    function testAllOtherLegacyReservationsRemainBlocked() public {
        (bool duplicateName,) =
            address(v6).call(abi.encodeCall(v6.launchSimple, ("other-protected_token", "FRESH", "")));
        (bool duplicateTicker,) =
            address(v6).call(abi.encodeCall(v6.launchSimple, ("Fresh Token", "other", "")));
        require(!duplicateName, "legacy name vamp accepted");
        require(!duplicateTicker, "legacy ticker vamp accepted");

        (address fresh,,) = v6.launchSimple("Actually Fresh", "NEW", "");
        require(fresh != address(0), "fresh launch blocked");
    }
}
