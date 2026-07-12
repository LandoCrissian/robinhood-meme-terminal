// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {CloneLaunchRewardVault} from "../src/clone/CloneLaunchRewardVault.sol";
import {MinimalProxy} from "../src/libraries/MinimalProxy.sol";

contract CloneHarness {
    function clone(address implementation) external returns (address) {
        return MinimalProxy.clone(implementation);
    }
}

contract CloneLaunchComponentsTest {
    CloneHarness private harness;
    CloneFixedSupplyMemeToken private tokenImplementation;
    CloneLaunchRewardVault private vaultImplementation;

    receive() external payable {}

    function setUp() public {
        harness = new CloneHarness();
        tokenImplementation = new CloneFixedSupplyMemeToken();
        vaultImplementation = new CloneLaunchRewardVault();
    }

    function testTokenCloneInitializesExactlyOnceAndMintsFixedSupply() public {
        CloneFixedSupplyMemeToken token = CloneFixedSupplyMemeToken(harness.clone(address(tokenImplementation)));
        token.initialize("Clone Token", "CLONE", 1_000_000_000 ether, address(this), address(this), "ipfs://token");

        require(token.totalSupply() == 1_000_000_000 ether, "wrong supply");
        require(token.balanceOf(address(this)) == token.totalSupply(), "inventory missing");
        require(token.creator() == address(this), "wrong creator");

        (bool initializedTwice,) = address(token).call(
            abi.encodeCall(
                token.initialize,
                ("Second", "SECOND", 1 ether, address(this), address(this), "ipfs://second")
            )
        );
        require(!initializedTwice, "token reinitialized");
    }

    function testVaultCloneInitializesExactlyOnceAndAccountsForEveryWei() public {
        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(harness.clone(address(vaultImplementation))));
        address[5] memory recipients = [address(this), address(0x2), address(0x3), address(0x4), address(0x5)];
        uint16[5] memory split = [uint16(2500), 2000, 1000, 2500, 2000];
        vault.initialize(recipients, split);

        vault.deposit{value: 101 wei}();
        uint256 accounted;
        for (uint256 i; i < recipients.length; ++i) accounted += vault.claimable(recipients[i]);
        require(accounted == 101 wei, "vault lost rounding dust");
        require(vault.totalReceived() == 101 wei, "receipt accounting wrong");

        (bool initializedTwice,) =
            address(vault).call(abi.encodeCall(vault.initialize, (recipients, split)));
        require(!initializedTwice, "vault reinitialized");
    }

    function testUninitializedVaultRejectsDeposits() public {
        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(harness.clone(address(vaultImplementation))));
        (bool success,) = address(vault).call{value: 1 wei}("");
        require(!success, "uninitialized vault accepted funds");
    }
}
