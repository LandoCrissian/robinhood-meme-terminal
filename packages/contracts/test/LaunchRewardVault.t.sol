// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchRewardVault} from "../src/LaunchRewardVault.sol";

contract RewardRecipient {
    receive() external payable {}

    function claim(LaunchRewardVault vault) external {
        vault.claim();
    }
}

contract LaunchRewardVaultTest {
    function testDepositAllocatesEveryWei() public {
        RewardRecipient creator = new RewardRecipient();
        RewardRecipient community = new RewardRecipient();
        RewardRecipient trader = new RewardRecipient();
        RewardRecipient liquidity = new RewardRecipient();
        RewardRecipient platform = new RewardRecipient();

        address[5] memory recipients =
            [address(creator), address(community), address(trader), address(liquidity), address(platform)];
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        LaunchRewardVault vault = new LaunchRewardVault(recipients, split);

        vault.deposit{value: 10_001 wei}();

        uint256 allocated = vault.claimable(address(creator)) + vault.claimable(address(community))
            + vault.claimable(address(trader)) + vault.claimable(address(liquidity))
            + vault.claimable(address(platform));
        require(allocated == 10_001 wei, "rewards lost");
        require(vault.totalReceived() == 10_001 wei, "deposit not recorded");
    }

    function testRecipientCanClaim() public {
        RewardRecipient recipient = new RewardRecipient();
        address[5] memory recipients =
            [address(recipient), address(0xBEEF), address(0xCAFE), address(0xD00D), address(0xF00D)];
        uint16[5] memory split = [uint16(10_000), 0, 0, 0, 0];
        LaunchRewardVault vault = new LaunchRewardVault(recipients, split);

        vault.deposit{value: 1 ether}();
        uint256 beforeBalance = address(recipient).balance;
        recipient.claim(vault);

        require(address(recipient).balance == beforeBalance + 1 ether, "claim not paid");
        require(vault.claimable(address(recipient)) == 0, "claim not cleared");
        require(vault.totalClaimed() == 1 ether, "claim not recorded");
    }

    function testRejectsInvalidSplit() public {
        address[5] memory recipients = [address(1), address(2), address(3), address(4), address(5)];
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1499];
        try new LaunchRewardVault(recipients, split) {
            revert("invalid split accepted");
        } catch {}
    }
}
