// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {ExpandableGovernance} from "../src/ExpandableGovernance.sol";
import {RMTV6Governance} from "../src/RMTV6Governance.sol";
import {RMTLaunchFactoryV6} from "../src/RMTLaunchFactoryV6.sol";
import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";
import {RMTLaunchPolicyRegistry} from "../src/RMTLaunchPolicyRegistry.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V5GraduationHook} from "../src/V5GraduationHook.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
import {MainnetReleaseConfigV6 as Config} from "./MainnetReleaseConfigV6.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

interface V6ReleaseVm {
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function startPrank(address sender) external;
    function stopPrank() external;
}

interface ILiveLegacyIdentityFactoryV6 {
    function isNameUsed(string calldata name) external view returns (bool);
    function isSymbolUsed(string calldata symbol) external view returns (bool);
}

interface ILiveOfficialRMTTokenV6 {
    function creator() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @notice Rehearses the exact paused policy-driven V6 foundation deployment on a mainnet fork.
/// @dev Production deployment is intentionally restricted to the recovery-aware operator console. This script
///      cannot broadcast to mainnet, propose, register policies, activate V6, set the default, or reopen launches.
contract DeployMainnetV6OfficialMigration {
    V6ReleaseVm private constant vm = V6ReleaseVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actualChainId);
    error OperatorConsoleRequired();
    error MissingContract(address account);
    error WrongActiveFactory(address activeFactory);
    error LiveDependencyVerificationFailed();
    error ConflictingPendingFactory(address pendingFactory);
    error OfficialIdentityNotReserved();
    error HookDeploymentFailed(address expectedHook);
    error BindingVerificationFailed();

    event V6FoundationDeployed(
        address indexed governance,
        address indexed factory,
        address indexed policyRegistry,
        address launchGate,
        address adapter,
        address hook,
        address marketImplementation
    );

    function run() external {
        if (block.chainid != Config.CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envOr("RMT_FORK_REHEARSAL", false)) revert OperatorConsoleRequired();
        address[6] memory requiredContracts = [
            Config.REGISTRY_GOVERNANCE,
            Config.LEGACY_IDENTITY_FACTORY,
            Config.OFFICIAL_LEGACY_RMT_TOKEN,
            Config.VERSION_REGISTRY,
            Config.POOL_MANAGER,
            Config.CREATE2_DEPLOYER
        ];
        for (uint256 i; i < requiredContracts.length; ++i) {
            address required = requiredContracts[i];
            if (required.code.length == 0) revert MissingContract(required);
        }
        ExpandableGovernance registryGovernance = ExpandableGovernance(payable(Config.REGISTRY_GOVERNANCE));
        VersionedFactoryRegistry versionRegistry = VersionedFactoryRegistry(Config.VERSION_REGISTRY);
        address activeFactory = versionRegistry.activeFactory();
        if (activeFactory != Config.LEGACY_IDENTITY_FACTORY) revert WrongActiveFactory(activeFactory);
        address pendingFactory = versionRegistry.pendingFactory();
        if (pendingFactory != address(0)) revert ConflictingPendingFactory(pendingFactory);
        if (
            !registryGovernance.isSigner(Config.DEVELOPER_OPERATOR) || registryGovernance.signerCount() != 1
                || registryGovernance.threshold() != 1
                || registryGovernance.executionDelay() != Config.GOVERNANCE_DELAY
                || registryGovernance.transactionCount() != 0
                || versionRegistry.governance() != Config.REGISTRY_GOVERNANCE
                || versionRegistry.activationDelay() != Config.REGISTRY_ACTIVATION_DELAY
                || versionRegistry.activeVersion() != Config.LEGACY_FACTORY_VERSION
                || versionRegistry.pendingVersion() != bytes32(0) || versionRegistry.pendingActivationTime() != 0
        ) revert LiveDependencyVerificationFailed();
        ILiveLegacyIdentityFactoryV6 legacy = ILiveLegacyIdentityFactoryV6(Config.LEGACY_IDENTITY_FACTORY);
        if (!legacy.isNameUsed("Robinhood Meme Terminal") || !legacy.isSymbolUsed("RMT")) {
            revert OfficialIdentityNotReserved();
        }
        ILiveOfficialRMTTokenV6 officialLegacyToken =
            ILiveOfficialRMTTokenV6(Config.OFFICIAL_LEGACY_RMT_TOKEN);
        if (
            officialLegacyToken.creator() != Config.DEVELOPER_OPERATOR
                || keccak256(bytes(officialLegacyToken.name())) != keccak256(bytes("Robinhood Meme Terminal"))
                || keccak256(bytes(officialLegacyToken.symbol())) != keccak256(bytes("RMT"))
        ) revert LiveDependencyVerificationFailed();

        address deployer = Config.DEVELOPER_OPERATOR;

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_DONATE_FLAG
        );
        bytes memory hookConstructorArgs = abi.encode(IPoolManager(Config.POOL_MANAGER), Config.DEVELOPER_OPERATOR);
        bytes memory hookInitCode = abi.encodePacked(type(V5GraduationHook).creationCode, hookConstructorArgs);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(Config.CREATE2_DEPLOYER, flags, type(V5GraduationHook).creationCode, hookConstructorArgs);

        vm.startPrank(deployer);
        RMTV6Governance governance = new RMTV6Governance(
            Config.DEVELOPER_OPERATOR, Config.GOVERNANCE_DELAY, Config.GOVERNANCE_EXECUTION_WINDOW
        );
        (bool hookDeploymentSuccess,) = Config.CREATE2_DEPLOYER.call(abi.encodePacked(salt, hookInitCode));
        if (!hookDeploymentSuccess || expectedHook.code.length == 0) revert HookDeploymentFailed(expectedHook);
        V5GraduationHook hook = V5GraduationHook(expectedHook);

        V4GraduationAdapter adapter = new V4GraduationAdapter(
            IPoolManager(Config.POOL_MANAGER), hook, Config.V4_POOL_FEE, Config.V4_TICK_SPACING
        );
        hook.bindAdapter(address(adapter));

        RMTLaunchGate launchGate = new RMTLaunchGate(
            address(governance), Config.INITIAL_GUARDIAN, Config.LAUNCH_UNPAUSE_DELAY
        );
        CloneBondingCurveMarketV6 marketImplementation = new CloneBondingCurveMarketV6();
        RMTLaunchPolicyRegistry policyRegistry = new RMTLaunchPolicyRegistry(
            address(governance),
            Config.INITIAL_GUARDIAN,
            Config.GOVERNANCE_DELAY,
            Config.PROTOCOL_TREASURY,
            address(marketImplementation),
            address(adapter)
        );
        RMTLaunchFactoryV6 factory = new RMTLaunchFactoryV6(
            address(launchGate),
            address(policyRegistry),
            Config.VERSION_REGISTRY,
            Config.INITIAL_VIRTUAL_ETH_RESERVE,
            Config.INITIAL_VIRTUAL_TOKEN_RESERVE,
            Config.LEGACY_IDENTITY_FACTORY,
            Config.OFFICIAL_LEGACY_RMT_TOKEN,
            Config.DEVELOPER_OPERATOR
        );
        adapter.bindFactory(address(factory));
        vm.stopPrank();

        if (
            address(hook) != expectedHook || (uint160(address(hook)) & uint160(0x3fff)) != flags
                || address(hook.poolManager()) != Config.POOL_MANAGER || hook.deployer() != Config.DEVELOPER_OPERATOR
                || hook.adapter() != address(adapter) || address(adapter.poolManager()) != Config.POOL_MANAGER
                || address(adapter.hook()) != address(hook) || adapter.deployer() != Config.DEVELOPER_OPERATOR
                || adapter.factory() != address(factory) || adapter.poolFee() != Config.V4_POOL_FEE
                || adapter.tickSpacing() != Config.V4_TICK_SPACING
                || !governance.isSigner(Config.DEVELOPER_OPERATOR) || governance.signerCount() != 1
                || governance.threshold() != 1 || governance.executionDelay() != Config.GOVERNANCE_DELAY
                || governance.executionWindow() != Config.GOVERNANCE_EXECUTION_WINDOW
                || governance.configurationEpoch() != 1 || governance.transactionCount() != 0
                || launchGate.governance() != address(governance)
                || launchGate.guardian() != Config.INITIAL_GUARDIAN || !launchGate.launchesPaused()
                || launchGate.unpauseDelay() != Config.LAUNCH_UNPAUSE_DELAY
                || policyRegistry.governance() != address(governance)
                || policyRegistry.guardian() != Config.INITIAL_GUARDIAN
                || policyRegistry.governanceDelay() != Config.GOVERNANCE_DELAY
                || policyRegistry.canonicalProtocolTreasury() != Config.PROTOCOL_TREASURY
                || address(marketImplementation).code.length == 0 || address(adapter).code.length == 0
                || policyRegistry.canonicalMarketImplementation() != address(marketImplementation)
                || policyRegistry.canonicalGraduationAdapter() != address(adapter)
                || policyRegistry.CANONICAL_CURVE_FEE_BPS() != Config.CURVE_FEE_BPS
                || policyRegistry.CANONICAL_CREATOR_FEE_SHARE_BPS() != Config.CREATOR_FEE_SHARE_BPS
                || policyRegistry.CANONICAL_PROTOCOL_FEE_SHARE_BPS() != Config.PROTOCOL_FEE_SHARE_BPS
                || policyRegistry.CANONICAL_POST_GRADUATION_FEE_BPS() != Config.POST_GRADUATION_FEE_BPS
                || policyRegistry.CANONICAL_GRADUATION_TARGET() != Config.GRADUATION_TARGET
                || policyRegistry.defaultPolicyId() != bytes32(0) || factory.protocolVersion() != 6
                || address(factory.launchGate()) != address(launchGate)
                || address(factory.policyRegistry()) != address(policyRegistry)
                || address(factory.factoryRegistry()) != Config.VERSION_REGISTRY
                || factory.legacyIdentityFactory() != Config.LEGACY_IDENTITY_FACTORY
                || factory.officialLegacyToken() != Config.OFFICIAL_LEGACY_RMT_TOKEN
                || factory.creatorPayoutAuthority() != address(governance)
                || factory.OFFICIAL_MIGRATION_POLICY_ID() != Config.SIMPLE_FAIR_V1_POLICY_ID
                || factory.initialVirtualEthReserve() != Config.INITIAL_VIRTUAL_ETH_RESERVE
                || factory.initialVirtualTokenReserve() != Config.INITIAL_VIRTUAL_TOKEN_RESERVE
                || factory.tokenImplementation().code.length == 0 || factory.feeSplitterImplementation().code.length == 0
                || factory.officialIdentityMigration().officialLauncher() != Config.DEVELOPER_OPERATOR
                || factory.officialIdentityMigration().authorizedFactory() != address(factory)
                || factory.officialIdentityMigration().officialLegacyToken() != Config.OFFICIAL_LEGACY_RMT_TOKEN
                || factory.officialIdentityMigration().consumed()
                || versionRegistry.activeFactory() != Config.LEGACY_IDENTITY_FACTORY
                || versionRegistry.activeVersion() != Config.LEGACY_FACTORY_VERSION
                || versionRegistry.pendingFactory() != address(0)
        ) revert BindingVerificationFailed();

        emit V6FoundationDeployed(
            address(governance),
            address(factory),
            address(policyRegistry),
            address(launchGate),
            address(adapter),
            address(hook),
            address(marketImplementation)
        );
    }
}
