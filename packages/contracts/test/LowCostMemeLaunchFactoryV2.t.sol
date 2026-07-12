// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV2} from "../src/LowCostMemeLaunchFactoryV2.sol";
import {CloneBondingCurveMarket} from "../src/clone/CloneBondingCurveMarket.sol";
import {CloneLaunchRewardVault} from "../src/clone/CloneLaunchRewardVault.sol";
import {ClonePurposeRewardVault} from "../src/clone/ClonePurposeRewardVault.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";

interface V2Vm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
}

contract LowCostMemeLaunchFactoryV2Test {
    V2Vm private constant vm = V2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    LowCostMemeLaunchFactoryV2 private factory;
    address private controller = address(0xC011);
    address private platform = address(0xFEE);

    function setUp() public {
        vm.deal(address(this), 10 ether);
        factory = new LowCostMemeLaunchFactoryV2(
            address(new MockGraduationAdapter()), 100, 30 ether, 1_073_000_000 ether, 1 ether, controller, platform
        );
    }

    function testSimpleLaunchCreatesSeparatedAutomaticDestinations() public {
        (address token, address market, address rewardVault) = factory.launchSimple("Simple", "SIMPLE", "ipfs://simple");
        (address community, address trader, address liquidity) = factory.automaticDestinationsForToken(token);
        require(community != address(0) && trader != address(0) && liquidity != address(0), "missing vault");
        require(community != trader && trader != liquidity && community != liquidity, "destinations reused");
        require(ClonePurposeRewardVault(payable(community)).controller() == controller, "wrong controller");
        require(ClonePurposeRewardVault(payable(community)).token() == token, "wrong token binding");
        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(rewardVault));
        require(vault.recipients(0) == address(this), "creator not automatic");
        require(
            vault.recipients(1) == community && vault.recipients(2) == trader && vault.recipients(3) == liquidity,
            "purpose routing"
        );
        require(vault.recipients(4) == platform, "platform routing");
        require(
            CloneBondingCurveMarket(payable(market)).token().balanceOf(market) == factory.TOKEN_SUPPLY(), "inventory"
        );
    }

    function testPurposeVaultOnlyControllerCanRelease() public {
        (address token,,) = factory.launchSimple("Release", "REL", "");
        (address community,,) = factory.automaticDestinationsForToken(token);
        (bool sent,) = community.call{value: 1 ether}("");
        require(sent, "funding failed");
        (bool unauthorized,) =
            community.call(abi.encodeCall(ClonePurposeRewardVault.release, (payable(address(this)), 1 ether)));
        require(!unauthorized, "unauthorized release");
        vm.prank(controller);
        ClonePurposeRewardVault(payable(community)).release(payable(address(this)), 1 ether);
        require(ClonePurposeRewardVault(payable(community)).totalReleased() == 1 ether, "release accounting");
    }

    receive() external payable {}
}
