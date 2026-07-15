// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV5} from "../src/LowCostMemeLaunchFactoryV5.sol";
import {ProtocolRevenueRouterV2} from "../src/ProtocolRevenueRouterV2.sol";
import {PurposeRewardsController} from "../src/PurposeRewardsController.sol";
import {ExpandableGovernance} from "../src/ExpandableGovernance.sol";
import {ProtocolPurposeVault} from "../src/ProtocolPurposeVault.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
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

/// @notice Deploys the corrected V5 stack under expandable single-wallet governance.
contract DeployMainnetV5Upgrade {
    UpgradeVm private constant vm = UpgradeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant LEGACY_FACTORY = 0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4;
    address private constant INITIAL_GOVERNANCE_SIGNER = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    bytes32 private constant VERSION = keccak256("RMT_FACTORY_V5");

    error WrongChain(uint256 actualChainId);
    error MissingContract(address account);
    error BindingVerificationFailed();

    event V5UpgradeDeployed(
        address indexed factory,
        address indexed revenueRouter,
        address indexed registry,
        address governance,
        address adapter,
        address hook
    );

    function run() external {
        if (block.chainid != Config.CHAIN_ID) revert WrongChain(block.chainid);
        if (LEGACY_FACTORY.code.length == 0) revert MissingContract(LEGACY_FACTORY);

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_DONATE_FLAG
        );
        bytes memory constructorArgs = abi.encode(IPoolManager(Config.POOL_MANAGER), deployer);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(Config.CREATE2_DEPLOYER, flags, type(V5GraduationHook).creationCode, constructorArgs);

        vm.startBroadcast(privateKey);
        ExpandableGovernance governance = new ExpandableGovernance(INITIAL_GOVERNANCE_SIGNER, 1 days);
        bytes32[5] memory purposes = [keccak256("PROTOCOL_TREASURY"), keccak256("BUYBACK_RESERVE"), keccak256("GRADUATION_ASSISTANCE"), keccak256("REFERRAL_RESERVE"), keccak256("ECOSYSTEM_GROWTH")];
        address[5] memory destinations;
        for (uint256 i; i < destinations.length; ++i) {
            destinations[i] = address(new ProtocolPurposeVault(address(governance), purposes[i]));
        }
        V5GraduationHook hook = new V5GraduationHook{salt: salt}(IPoolManager(Config.POOL_MANAGER), deployer);
        V4GraduationAdapter adapter = new V4GraduationAdapter(
            IPoolManager(Config.POOL_MANAGER), hook, Config.V4_POOL_FEE, Config.V4_TICK_SPACING
        );
        hook.bindAdapter(address(adapter));
        ProtocolRevenueRouterV2 router = new ProtocolRevenueRouterV2(destinations);
        PurposeRewardsController controller =
            new PurposeRewardsController(deployer, address(governance), Config.REWARD_RELEASE_DELAY);
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
        VersionedFactoryRegistry registry =
            new VersionedFactoryRegistry(address(governance), Config.FACTORY_ACTIVATION_DELAY, address(factory), VERSION);
        vm.stopBroadcast();

        if (
            address(hook) != expectedHook || hook.adapter() != address(adapter) || adapter.factory() != address(factory)
                || factory.graduationAdapter() != address(adapter) || factory.platformTreasury() != address(router)
                || factory.rewardsController() != address(controller) || controller.factory() != address(factory)
                || controller.governance() != address(governance) || factory.legacyIdentityFactory() != LEGACY_FACTORY
                || factory.SETTLEMENT_VERSION() != 2
                || registry.activeFactory() != address(factory) || registry.governance() != address(governance)
                || !governance.isSigner(INITIAL_GOVERNANCE_SIGNER) || governance.threshold() != 1
        ) revert BindingVerificationFailed();
        for (uint256 i; i < destinations.length; ++i) {
            if (router.recipients(i) != destinations[i]) revert BindingVerificationFailed();
        }

        emit V5UpgradeDeployed(address(factory), address(router), address(registry), address(governance), address(adapter), address(hook));
    }
}
