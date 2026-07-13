// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV3} from "../src/LowCostMemeLaunchFactoryV3.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {MainnetReleaseConfig as Config} from "./MainnetReleaseConfig.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

interface MainnetVm {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployMainnetMemeLaunchFactory {
    MainnetVm private constant vm = MainnetVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actualChainId);
    error MissingCanonicalContract(address account);
    error InvalidOperatorAddress();
    error HookAddressMismatch();
    error BindingVerificationFailed();

    function run()
        external
        returns (V4GraduationHook hook, V4GraduationAdapter adapter, LowCostMemeLaunchFactoryV3 factory)
    {
        if (block.chainid != Config.CHAIN_ID) revert WrongChain(block.chainid);
        if (Config.POOL_MANAGER.code.length == 0) revert MissingCanonicalContract(Config.POOL_MANAGER);
        if (Config.CREATE2_DEPLOYER.code.length == 0) revert MissingCanonicalContract(Config.CREATE2_DEPLOYER);

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address platformTreasury = vm.envAddress("PLATFORM_TREASURY");
        address rewardsController = vm.envAddress("REWARDS_CONTROLLER");
        if (
            deployer == address(0) || platformTreasury == address(0) || rewardsController == address(0)
                || platformTreasury == Config.POOL_MANAGER || rewardsController == Config.POOL_MANAGER
        ) revert InvalidOperatorAddress();

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(IPoolManager(Config.POOL_MANAGER), deployer);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(Config.CREATE2_DEPLOYER, flags, type(V4GraduationHook).creationCode, constructorArgs);

        vm.startBroadcast(deployerPrivateKey);
        hook = new V4GraduationHook{salt: salt}(IPoolManager(Config.POOL_MANAGER), deployer);
        if (address(hook) != expectedHook) revert HookAddressMismatch();

        adapter = new V4GraduationAdapter(
            IPoolManager(Config.POOL_MANAGER), hook, Config.V4_POOL_FEE, Config.V4_TICK_SPACING
        );
        hook.bindAdapter(address(adapter));

        factory = new LowCostMemeLaunchFactoryV3(
            address(adapter),
            Config.MARKET_FEE_BPS,
            Config.INITIAL_VIRTUAL_ETH_RESERVE,
            Config.INITIAL_VIRTUAL_TOKEN_RESERVE,
            Config.GRADUATION_TARGET,
            rewardsController,
            platformTreasury
        );
        adapter.bindFactory(address(factory));
        vm.stopBroadcast();

        if (
            hook.adapter() != address(adapter) || adapter.factory() != address(factory)
                || address(adapter.poolManager()) != Config.POOL_MANAGER || address(adapter.hook()) != address(hook)
                || factory.graduationAdapter() != address(adapter) || factory.platformTreasury() != platformTreasury
                || factory.rewardsController() != rewardsController || factory.marketFeeBps() != Config.MARKET_FEE_BPS
                || factory.initialVirtualEthReserve() != Config.INITIAL_VIRTUAL_ETH_RESERVE
                || factory.initialVirtualTokenReserve() != Config.INITIAL_VIRTUAL_TOKEN_RESERVE
                || factory.graduationTarget() != Config.GRADUATION_TARGET
        ) revert BindingVerificationFailed();
    }
}
