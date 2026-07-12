// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployMemeLaunchFactory {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint24 private constant V4_POOL_FEE = 10_000;
    int24 private constant V4_TICK_SPACING = 200;
    uint16 private constant TESTNET_MARKET_FEE_BPS = 100;
    uint256 private constant TESTNET_VIRTUAL_ETH_RESERVE = 0.01 ether;
    uint256 private constant TESTNET_VIRTUAL_TOKEN_RESERVE = 1_073_000_000 ether;
    uint256 private constant TESTNET_GRADUATION_TARGET = 0.001 ether;

    error WrongChain(uint256 actualChainId);
    error MissingCreate2Deployer();
    error HookAddressMismatch();
    error BindingVerificationFailed();

    function run()
        external
        returns (PoolManager manager, V4GraduationHook hook, V4GraduationAdapter adapter, MemeLaunchFactory factory)
    {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (CREATE2_DEPLOYER.code.length == 0) revert MissingCreate2Deployer();

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        manager = new PoolManager(deployer);
        vm.stopBroadcast();

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(IPoolManager(address(manager)), deployer);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(V4GraduationHook).creationCode, constructorArgs);

        vm.startBroadcast(deployerPrivateKey);
        hook = new V4GraduationHook{salt: salt}(IPoolManager(address(manager)), deployer);
        if (address(hook) != expectedHook) revert HookAddressMismatch();

        adapter = new V4GraduationAdapter(IPoolManager(address(manager)), hook, V4_POOL_FEE, V4_TICK_SPACING);
        hook.bindAdapter(address(adapter));

        factory = new MemeLaunchFactory(
            address(adapter),
            TESTNET_MARKET_FEE_BPS,
            TESTNET_VIRTUAL_ETH_RESERVE,
            TESTNET_VIRTUAL_TOKEN_RESERVE,
            TESTNET_GRADUATION_TARGET
        );
        adapter.bindFactory(address(factory));
        vm.stopBroadcast();

        if (
            hook.adapter() != address(adapter) || adapter.factory() != address(factory)
                || address(adapter.poolManager()) != address(manager) || address(adapter.hook()) != address(hook)
                || factory.graduationAdapter() != address(adapter)
        ) revert BindingVerificationFailed();
    }
}
