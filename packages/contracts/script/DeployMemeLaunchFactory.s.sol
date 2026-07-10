// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployMemeLaunchFactory {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;

    error WrongChain(uint256 actualChainId);

    function run() external returns (MemeLaunchFactory factory) {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        factory = new MemeLaunchFactory();
        vm.stopBroadcast();
    }
}
