// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV4} from "../src/LowCostMemeLaunchFactoryV4.sol";
import {LowCostMemeLaunchFactoryV5} from "../src/LowCostMemeLaunchFactoryV5.sol";
import {ProtocolRevenueRouterV2} from "../src/ProtocolRevenueRouterV2.sol";
import {CloneLaunchRewardVaultV2} from "../src/clone/CloneLaunchRewardVaultV2.sol";
import {ClonePurposeRewardVault} from "../src/clone/ClonePurposeRewardVault.sol";
import {CloneBondingCurveMarketV3} from "../src/clone/CloneBondingCurveMarketV3.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";
import {RewardsControllerMock} from "./LowCostMemeLaunchFactoryV4.t.sol";

interface V5FactoryVm {
    function deal(address account, uint256 balance) external;
}

contract LowCostMemeLaunchFactoryV5Test {
    V5FactoryVm private constant vm = V5FactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address[5] private destinations =
        [address(0x1001), address(0x1002), address(0x1003), address(0x1004), address(0x1005)];

    LowCostMemeLaunchFactoryV4 private legacy;
    LowCostMemeLaunchFactoryV5 private factory;
    ProtocolRevenueRouterV2 private router;

    function setUp() public {
        vm.deal(address(this), 10 ether);
        MockGraduationAdapter adapter = new MockGraduationAdapter();
        RewardsControllerMock controller = new RewardsControllerMock();
        router = new ProtocolRevenueRouterV2(destinations);
        legacy = new LowCostMemeLaunchFactoryV4(
            address(adapter), 100, 0.3 ether, 1_073_000_000 ether, 1 ether, address(controller), address(router)
        );
        factory = new LowCostMemeLaunchFactoryV5(
            address(adapter),
            100,
            0.3 ether,
            1_073_000_000 ether,
            1 ether,
            address(controller),
            address(router),
            address(legacy)
        );
    }

    function testPreservesLegacyNameAndTickerReservations() public {
        legacy.launchSimple("Original Token", "ORIG", "");

        (bool duplicateName,) =
            address(factory).call(abi.encodeCall(factory.launchSimple, ("original-token", "FRESH", "")));
        (bool duplicateTicker,) =
            address(factory).call(abi.encodeCall(factory.launchSimple, ("Fresh Token", "orig", "")));

        require(!duplicateName, "legacy name vamp accepted");
        require(!duplicateTicker, "legacy ticker vamp accepted");
    }

    function testUsesLighterFairStartMarket() public view {
        CloneBondingCurveMarketV3 market = CloneBondingCurveMarketV3(payable(factory.marketImplementation()));
        require(market.FAIR_START_DELAY_BLOCKS() == 1, "delay");
        require(market.FAIR_START_DURATION_BLOCKS() == 10, "duration");
        require(market.FAIR_START_MAX_TX_BPS() == 100, "transaction cap");
        require(market.FAIR_START_MAX_WALLET_BPS() == 300, "wallet cap");
    }

    function testCommunityAndProtocolVaultsCanBePermissionlesslySettled() public {
        (address token,, address rewardVaultAddress) = factory.launchCommunity("Settled Token", "SETTLE", "");
        (address community, address trader) = factory.communityDestinationsForToken(token);
        CloneLaunchRewardVaultV2 rewardVault = CloneLaunchRewardVaultV2(payable(rewardVaultAddress));
        rewardVault.deposit{value: 1 ether}();

        rewardVault.claimFor(community);
        rewardVault.claimFor(trader);
        router.collect(rewardVaultAddress);
        router.claimFor(destinations[0]);

        require(ClonePurposeRewardVault(payable(community)).totalReceived() == 0.2 ether, "community settlement");
        require(ClonePurposeRewardVault(payable(trader)).totalReceived() == 0.1 ether, "trader settlement");
        require(destinations[0].balance == 0.12 ether, "protocol settlement");
    }
}
