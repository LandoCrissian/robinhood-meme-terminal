// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";

contract MemeLaunchFactoryTest {
    MemeLaunchFactory private factory;

    function setUp() public {
        factory = new MemeLaunchFactory();
    }

    function testLaunchCreatesFixedSupplyToken() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        address tokenAddress = factory.launch("Genesis", "GEN", 1_000_000 ether, "ipfs://genesis", split);
        FixedSupplyMemeToken token = FixedSupplyMemeToken(tokenAddress);

        require(factory.launchCount() == 1, "launch count");
        require(token.totalSupply() == 1_000_000 ether, "supply");
        require(token.balanceOf(address(this)) == 1_000_000 ether, "creator balance");
        require(token.creator() == address(this), "creator");
    }

    function testRejectsInvalidRewardSplit() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1499];
        (bool success,) = address(factory).call(
            abi.encodeCall(factory.launch, ("Bad Split", "BAD", 1 ether, "", split))
        );
        require(!success, "invalid split accepted");
    }

    function testTokenTransferPreservesSupply() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        FixedSupplyMemeToken token = FixedSupplyMemeToken(factory.launch("Transfer", "MOVE", 100 ether, "", split));
        token.transfer(address(0xBEEF), 40 ether);
        require(token.balanceOf(address(this)) == 60 ether, "sender balance");
        require(token.balanceOf(address(0xBEEF)) == 40 ether, "receiver balance");
        require(token.totalSupply() == 100 ether, "supply changed");
    }
}
