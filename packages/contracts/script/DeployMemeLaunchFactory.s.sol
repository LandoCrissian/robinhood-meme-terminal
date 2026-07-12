// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployMemeLaunchFactory {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    uint16 private constant TESTNET_MARKET_FEE_BPS = 100;
    uint256 private constant TESTNET_VIRTUAL_ETH_RESERVE = 0.01 ether;
    uint256 private constant TESTNET_VIRTUAL_TOKEN_RESERVE = 1_073_000_000 ether;
    uint256 private constant TESTNET_GRADUATION_TARGET = 0.001 ether;

    error WrongChain(uint256 actualChainId);

    function run() external returns (MemeLaunchFactory factory) {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address graduationAdapter = vm.envAddress("GRADUATION_ADAPTER");
        vm.startBroadcast(deployerPrivateKey);
        factory = new MemeLaunchFactory(
            graduationAdapter,
            TESTNET_MARKET_FEE_BPS,
            TESTNET_VIRTUAL_ETH_RESERVE,
            TESTNET_VIRTUAL_TOKEN_RESERVE,
            TESTNET_GRADUATION_TARGET
        );
        vm.stopBroadcast();
    }
}
