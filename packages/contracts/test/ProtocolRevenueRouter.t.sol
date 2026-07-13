// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ProtocolRevenueRouter} from "../src/ProtocolRevenueRouter.sol";
import {CloneLaunchRewardVault} from "../src/clone/CloneLaunchRewardVault.sol";

interface RouterVm {
    function deal(address account, uint256 balance) external;
}

contract ProtocolRevenueRouterTest {
    RouterVm private constant vm = RouterVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address[5] private destinations =
        [address(0x1001), address(0x1002), address(0x1003), address(0x1004), address(0x1005)];

    ProtocolRevenueRouter private router;

    function setUp() public {
        vm.deal(address(this), 10 ether);
        router = new ProtocolRevenueRouter(destinations);
    }

    function testAccountsForEveryWeiWithoutAdmin() public {
        router.deposit{value: 101 wei}();

        uint256 accounted;
        for (uint256 i; i < destinations.length; ++i) {
            accounted += router.claimable(destinations[i]);
        }

        require(accounted == 101 wei, "lost routing dust");
        require(router.totalReceived() == 101 wei, "wrong receipts");
        require(router.claimable(destinations[0]) == 40 wei, "treasury");
        require(router.claimable(destinations[1]) == 20 wei, "buyback");
        require(router.claimable(destinations[2]) == 20 wei, "graduation");
        require(router.claimable(destinations[3]) == 10 wei, "referral");
        require(router.claimable(destinations[4]) == 11 wei, "ecosystem dust");
    }

    function testAnyoneCanCollectRouterShareFromLaunchVault() public {
        CloneLaunchRewardVault launchVault = new CloneLaunchRewardVault();
        address[5] memory recipients =
            [address(router), address(0x2002), address(0x2003), address(0x2004), address(0x2005)];
        uint16[5] memory splits = [uint16(10_000), 0, 0, 0, 0];
        launchVault.initialize(recipients, splits);
        launchVault.deposit{value: 1 ether}();

        router.collect(address(launchVault));

        require(launchVault.claimable(address(router)) == 0, "launch share not collected");
        require(router.totalReceived() == 1 ether, "router did not receive launch revenue");
        require(address(router).balance == 1 ether, "router balance mismatch");
    }

    function testRejectsDuplicatePurposeRecipients() public {
        address[5] memory duplicate = destinations;
        duplicate[4] = duplicate[0];
        (bool success,) =
            address(this).call(abi.encodeWithSelector(this.deployRouter.selector, duplicate));
        require(!success, "duplicate purpose recipient accepted");
    }

    function deployRouter(address[5] memory recipients) external returns (ProtocolRevenueRouter) {
        return new ProtocolRevenueRouter(recipients);
    }

    receive() external payable {}
}
