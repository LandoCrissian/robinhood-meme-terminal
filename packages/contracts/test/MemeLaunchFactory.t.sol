// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {LaunchRewardVault} from "../src/LaunchRewardVault.sol";
import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";

contract MemeLaunchFactoryTest {
    MemeLaunchFactory private factory;
    address[4] private recipients = [address(0xBEEF), address(0xCAFE), address(0xD00D), address(0xF00D)];

    function setUp() public {
        factory = new MemeLaunchFactory();
    }

    function testLaunchCreatesTokenAndRewardVault() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (address tokenAddress, address vaultAddress) =
            factory.launch("Genesis", "GEN", 1_000_000 ether, "ipfs://genesis", recipients, split);
        FixedSupplyMemeToken token = FixedSupplyMemeToken(tokenAddress);
        LaunchRewardVault vault = LaunchRewardVault(payable(vaultAddress));
        MemeLaunchFactory.Launch memory created = factory.getLaunch(0);

        require(factory.launchCount() == 1, "launch count");
        require(token.totalSupply() == 1_000_000 ether, "supply");
        require(token.balanceOf(address(this)) == 1_000_000 ether, "creator balance");
        require(token.creator() == address(this), "creator");
        require(created.rewardVault == vaultAddress, "vault not stored");
        require(vault.recipients(0) == address(this), "creator recipient");
        require(vault.recipients(1) == recipients[0], "community recipient");
    }

    function testRejectsInvalidRewardSplit() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1499];
        (bool success,) = address(factory).call(
            abi.encodeCall(factory.launch, ("Bad Split", "BAD", 1 ether, "", recipients, split))
        );
        require(!success, "invalid split accepted");
    }

    function testTokenTransferPreservesSupply() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (address tokenAddress,) = factory.launch("Transfer", "MOVE", 100 ether, "", recipients, split);
        FixedSupplyMemeToken token = FixedSupplyMemeToken(tokenAddress);
        token.transfer(address(0xBEEF), 40 ether);
        require(token.balanceOf(address(this)) == 60 ether, "sender balance");
        require(token.balanceOf(address(0xBEEF)) == 40 ether, "receiver balance");
        require(token.totalSupply() == 100 ether, "supply changed");
    }
}
