// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV3} from "../src/LowCostMemeLaunchFactoryV3.sol";
import {CloneBondingCurveMarket} from "../src/clone/CloneBondingCurveMarket.sol";
import {CloneLaunchRewardVault} from "../src/clone/CloneLaunchRewardVault.sol";
import {ClonePurposeRewardVault} from "../src/clone/ClonePurposeRewardVault.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";

interface V3Vm {
    function deal(address account, uint256 balance) external;
}

contract LowCostMemeLaunchFactoryV3Test {
    V3Vm private constant vm = V3Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    LowCostMemeLaunchFactoryV3 private factory;
    address private controller = address(0xC011);
    address private platform = address(0xFEE);

    function setUp() public {
        vm.deal(address(this), 10 ether);
        factory = new LowCostMemeLaunchFactoryV3(
            address(new MockGraduationAdapter()), 100, 30 ether, 1_073_000_000 ether, 1 ether, controller, platform
        );
    }

    function testSimpleLaunchCreatesNoOptionalPurposeVaults() public {
        (address token, address market, address rewardVault) = factory.launchSimple("Simple", "SIMPLE", "ipfs://simple");
        (address community, address trader) = factory.communityDestinationsForToken(token);
        require(community == address(0) && trader == address(0), "unexpected optional vault");

        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(rewardVault));
        require(vault.recipients(0) == address(this), "creator recipient");
        require(vault.rewardBps(0) == 8500, "creator share");
        require(vault.recipients(4) == platform && vault.rewardBps(4) == 1500, "platform share");
        require(
            CloneBondingCurveMarket(payable(market)).token().balanceOf(market) == factory.TOKEN_SUPPLY(), "inventory"
        );
    }

    function testCommunityLaunchCreatesOnlyOptionalCommunityVaults() public {
        (address token,, address rewardVault) =
            factory.launchCommunity("Community", "COM", "ipfs://community");
        (address community, address trader) = factory.communityDestinationsForToken(token);
        require(community != address(0) && trader != address(0) && community != trader, "missing vaults");
        require(ClonePurposeRewardVault(payable(community)).controller() == controller, "community controller");
        require(ClonePurposeRewardVault(payable(trader)).controller() == controller, "trader controller");

        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(rewardVault));
        require(vault.rewardBps(0) == 4500, "creator share");
        require(vault.recipients(1) == community && vault.rewardBps(1) == 2500, "community share");
        require(vault.recipients(2) == trader && vault.rewardBps(2) == 1500, "trader share");
        require(vault.rewardBps(3) == 0, "graduation must not be a reward share");
        require(vault.recipients(4) == platform && vault.rewardBps(4) == 1500, "platform share");
    }

    function testGraduationReserveIsMarketAccountingNotRewardRouting() public {
        (, address market, address rewardVault) = factory.launchSimple("Reserve", "RSV", "");
        CloneBondingCurveMarket curve = CloneBondingCurveMarket(payable(market));
        (uint256 tokenOut,) = curve.quoteBuy(1 ether);
        curve.buy{value: 1 ether}(address(this), tokenOut, block.timestamp);

        require(curve.realEthReserve() == 0.99 ether, "graduation reserve not retained by market");
        require(address(market).balance == 0.99 ether, "market reserve balance");
        require(CloneLaunchRewardVault(payable(rewardVault)).totalReceived() == 0.01 ether, "fee accounting");
    }

    receive() external payable {}
}
