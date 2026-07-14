// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV6} from "../src/LowCostMemeLaunchFactoryV6.sol";
import {PurposeRewardsController} from "../src/PurposeRewardsController.sol";
import {ExpandableGovernance} from "../src/ExpandableGovernance.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V5GraduationHook} from "../src/V5GraduationHook.sol";
import {MainnetReleaseConfig as Config} from "./MainnetReleaseConfig.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

interface V6UpgradeVm {
    function envUint(string calldata name) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys V6 and submits its delayed activation through the existing V5 governance and registry.
contract DeployMainnetV6OfficialMigration {
    V6UpgradeVm private constant vm = V6UpgradeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    address private constant GOVERNANCE = 0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953;
    address private constant REVENUE_ROUTER = 0x066Fd10caF090F274d1861e4F838558f98cE1ee9;
    address private constant V5_FACTORY = 0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD;
    address private constant VERSION_REGISTRY = 0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1;
    address private constant OFFICIAL_LEGACY_TOKEN = 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C;
    bytes32 private constant VERSION = keccak256("RMT_FACTORY_V6");

    error WrongChain(uint256 actualChainId);
    error WrongOperator(address actualOperator);
    error MissingContract(address account);
    error BindingVerificationFailed();

    event V6OfficialMigrationUpgradeDeployed(
        address indexed factory,
        address indexed adapter,
        address indexed hook,
        address rewardsController,
        uint256 governanceProposalId
    );

    function run() external {
        if (block.chainid != Config.CHAIN_ID) revert WrongChain(block.chainid);
        address[5] memory requiredContracts =
            [GOVERNANCE, REVENUE_ROUTER, V5_FACTORY, VERSION_REGISTRY, OFFICIAL_LEGACY_TOKEN];
        for (uint256 i; i < requiredContracts.length; ++i) {
            address required = requiredContracts[i];
            if (required.code.length == 0) revert MissingContract(required);
        }

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        if (deployer != OPERATOR) revert WrongOperator(deployer);
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
        PurposeRewardsController controller =
            new PurposeRewardsController(deployer, GOVERNANCE, Config.REWARD_RELEASE_DELAY);
        LowCostMemeLaunchFactoryV6 factory = new LowCostMemeLaunchFactoryV6(
            address(adapter),
            Config.MARKET_FEE_BPS,
            Config.INITIAL_VIRTUAL_ETH_RESERVE,
            Config.INITIAL_VIRTUAL_TOKEN_RESERVE,
            Config.GRADUATION_TARGET,
            address(controller),
            REVENUE_ROUTER,
            V5_FACTORY,
            OFFICIAL_LEGACY_TOKEN,
            OPERATOR
        );
        adapter.bindFactory(address(factory));
        controller.bindFactory(address(factory));
        bytes memory registryProposal = abi.encodeCall(VersionedFactoryRegistry.proposeFactory, (address(factory), VERSION));
        uint256 proposalId = ExpandableGovernance(payable(GOVERNANCE)).propose(VERSION_REGISTRY, 0, registryProposal);
        vm.stopBroadcast();

        if (
            address(hook) != expectedHook || hook.adapter() != address(adapter) || adapter.factory() != address(factory)
                || factory.graduationAdapter() != address(adapter) || factory.platformTreasury() != REVENUE_ROUTER
                || factory.rewardsController() != address(controller) || controller.factory() != address(factory)
                || controller.governance() != GOVERNANCE || factory.legacyIdentityFactory() != V5_FACTORY
                || factory.officialLegacyToken() != OFFICIAL_LEGACY_TOKEN
                || factory.officialMigrationAuthority() != OPERATOR || factory.SETTLEMENT_VERSION() != 3
                || VersionedFactoryRegistry(VERSION_REGISTRY).activeFactory() != V5_FACTORY
        ) revert BindingVerificationFailed();

        emit V6OfficialMigrationUpgradeDeployed(
            address(factory), address(adapter), address(hook), address(controller), proposalId
        );
    }
}
