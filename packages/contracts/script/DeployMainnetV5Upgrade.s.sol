// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV5} from "../src/LowCostMemeLaunchFactoryV5.sol";
import {ProtocolRevenueRouterV2} from "../src/ProtocolRevenueRouterV2.sol";
import {PurposeRewardsController} from "../src/PurposeRewardsController.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V5GraduationHook} from "../src/V5GraduationHook.sol";
import {MainnetReleaseConfig as Config} from "./MainnetReleaseConfig.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

interface UpgradeVm {
    function envUint(string calldata name) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the corrected V5 stack without changing registry state or moving funds.
/// @dev Registry proposal and activation remain separate 2-of-3 governance actions.
contract DeployMainnetV5Upgrade {
    UpgradeVm private constant vm = UpgradeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant LEGACY_FACTORY = 0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4;
    address private constant REWARDS_GOVERNANCE = 0xE39CE3259d8E79628aFA537e83631b51F74f7416;

    address[5] private PROTOCOL_DESTINATIONS = [
        0x66f589E759b088A070a557e6c4487D18993E923E,
        0x36D17cD171D54ff4e916aF1aCaFF8A4D54b0b390,
        0x9407983a579C160C16BE2a338280109cFA833394,
        0x5cDaaac5880071b84B47a78bfF3dCE97FBA6Ff87,
        0xd3dadC00884B60bb1Ed945ae5ec5C27e0295B2bE
    ];

    error WrongChain(uint256 actualChainId);
    error MissingContract(address account);
    error BindingVerificationFailed();

    event V5UpgradeDeployed(
        address indexed factory,
        address indexed revenueRouter,
        address indexed rewardsController,
        address adapter,
        address hook
    );

    function run() external {
        if (block.chainid != Config.CHAIN_ID) revert WrongChain(block.chainid);
        if (LEGACY_FACTORY.code.length == 0) revert MissingContract(LEGACY_FACTORY);
        for (uint256 i; i < PROTOCOL_DESTINATIONS.length; ++i) {
            if (PROTOCOL_DESTINATIONS[i].code.length == 0) revert MissingContract(PROTOCOL_DESTINATIONS[i]);
        }

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(IPoolManager(Config.POOL_MANAGER), deployer);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(Config.CREATE2_DEPLOYER, flags, type(V5GraduationHook).creationCode, constructorArgs);

        vm.startBroadcast(privateKey);
        V5GraduationHook hook = new V5GraduationHook{salt: salt}(IPoolManager(Config.POOL_MANAGER), deployer);
        V4GraduationAdapter adapter = new V4GraduationAdapter(
            IPoolManager(Config.POOL_MANAGER), hook, Config.V4_POOL_FEE, Config.V4_TICK_SPACING
        );
        hook.bindAdapter(address(adapter));
        ProtocolRevenueRouterV2 router = new ProtocolRevenueRouterV2(PROTOCOL_DESTINATIONS);
        PurposeRewardsController controller =
            new PurposeRewardsController(deployer, REWARDS_GOVERNANCE, Config.REWARD_RELEASE_DELAY);
        LowCostMemeLaunchFactoryV5 factory = new LowCostMemeLaunchFactoryV5(
            address(adapter),
            Config.MARKET_FEE_BPS,
            Config.INITIAL_VIRTUAL_ETH_RESERVE,
            Config.INITIAL_VIRTUAL_TOKEN_RESERVE,
            Config.GRADUATION_TARGET,
            address(controller),
            address(router),
            LEGACY_FACTORY
        );
        adapter.bindFactory(address(factory));
        controller.bindFactory(address(factory));
        vm.stopBroadcast();

        if (
            address(hook) != expectedHook || hook.adapter() != address(adapter) || adapter.factory() != address(factory)
                || factory.graduationAdapter() != address(adapter) || factory.platformTreasury() != address(router)
                || factory.rewardsController() != address(controller) || controller.factory() != address(factory)
                || controller.governance() != REWARDS_GOVERNANCE || factory.legacyIdentityFactory() != LEGACY_FACTORY
                || factory.SETTLEMENT_VERSION() != 2
        ) revert BindingVerificationFailed();
        for (uint256 i; i < PROTOCOL_DESTINATIONS.length; ++i) {
            if (router.recipients(i) != PROTOCOL_DESTINATIONS[i]) revert BindingVerificationFailed();
        }

        emit V5UpgradeDeployed(address(factory), address(router), address(controller), address(adapter), address(hook));
    }
}
