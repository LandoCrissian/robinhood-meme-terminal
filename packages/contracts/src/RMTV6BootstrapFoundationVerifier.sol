// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTLaunchPolicyRegistry} from "./interfaces/IRMTLaunchPolicyRegistry.sol";

interface IRMTV6FoundationRegistry {
    function governance() external view returns (address);
    function bootstrapController() external view returns (address);
    function activationDelay() external view returns (uint256);
    function initialFactory() external view returns (address);
    function initialVersion() external view returns (bytes32);
    function bootstrapConsumed() external view returns (bool);
    function activeFactory() external view returns (address);
    function activeVersion() external view returns (bytes32);
    function pendingFactory() external view returns (address);
    function pendingVersion() external view returns (bytes32);
    function pendingActivationTime() external view returns (uint64);
    function pendingExpirationTime() external view returns (uint64);
    function pendingConfigurationEpoch() external view returns (uint64);
}

interface IRMTV6FoundationGate {
    function governance() external view returns (address);
    function guardian() external view returns (address);
    function bootstrapController() external view returns (address);
    function unpauseDelay() external view returns (uint64);
    function launchesPaused() external view returns (bool);
    function bootstrapConsumed() external view returns (bool);
    function unpauseExecutableAt() external view returns (uint64);
    function unpauseExpiresAt() external view returns (uint64);
    function unpauseConfigurationEpoch() external view returns (uint64);
}

interface IRMTV6FoundationPolicyRegistry is IRMTLaunchPolicyRegistry {
    function guardian() external view returns (address);
    function governanceDelay() external view returns (uint64);
}

interface IRMTV6FoundationFactory {
    function protocolVersion() external view returns (uint32);
    function FACTORY_VERSION() external view returns (bytes32);
    function LEGACY_FACTORY_VERSION() external view returns (bytes32);
    function OFFICIAL_MIGRATION_POLICY_ID() external view returns (bytes32);
    function launchGate() external view returns (address);
    function policyRegistry() external view returns (address);
    function factoryRegistry() external view returns (address);
    function legacyIdentityFactory() external view returns (address);
    function officialLegacyToken() external view returns (address);
    function creatorPayoutAuthority() external view returns (address);
    function officialIdentityMigration() external view returns (address);
    function tokenImplementation() external view returns (address);
    function feeSplitterImplementation() external view returns (address);
    function initialVirtualEthReserve() external view returns (uint256);
    function initialVirtualTokenReserve() external view returns (uint256);
}

interface IRMTV6FoundationAdapter {
    function poolManager() external view returns (address);
    function hook() external view returns (address);
    function deployer() external view returns (address);
    function factory() external view returns (address);
    function poolFee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
}

interface IRMTV6FoundationHook {
    function poolManager() external view returns (address);
    function deployer() external view returns (address);
    function adapter() external view returns (address);
}

interface IRMTV6FoundationOfficialMigration {
    function officialLauncher() external view returns (address);
    function authorizedFactory() external view returns (address);
    function officialLegacyToken() external view returns (address);
    function consumed() external view returns (bool);
}

/// @notice Stateless exact-topology verifier created and permanently bound by one V6 bootstrap controller.
contract RMTV6BootstrapFoundationVerifier {
    address private constant OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    address private constant LEGACY_IDENTITY_FACTORY = 0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD;
    address private constant OFFICIAL_LEGACY_RMT_TOKEN = 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C;
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 private constant LEGACY_FACTORY_VERSION = keccak256("RMT_FACTORY_V5");
    bytes32 private constant FACTORY_VERSION = keccak256("RMT_FACTORY_V6");
    bytes32 private constant FAIR_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    bytes32 private constant OPEN_POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");
    uint64 private constant GOVERNANCE_DELAY = 1 days;
    uint64 private constant REGISTRY_ACTIVATION_DELAY = 2 days;
    uint64 private constant GATE_UNPAUSE_DELAY = 1 days;
    uint256 private constant INITIAL_VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 private constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint24 private constant V4_POOL_FEE = 5_000;
    int24 private constant V4_TICK_SPACING = 200;
    uint160 private constant REQUIRED_HOOK_FLAGS = 0x28a0;

    address public immutable controller;

    error Unauthorized();
    error InvalidConfiguration();

    constructor(address controller_) {
        if (controller_ == address(0) || msg.sender != controller_) revert InvalidConfiguration();
        controller = controller_;
    }

    function validateFoundation(
        address governance,
        address versionRegistry,
        address launchGate,
        address policyRegistry,
        address factory,
        bool activated,
        bool officialConsumed
    ) external view {
        if (msg.sender != controller) revert Unauthorized();
        if (
            governance == address(0) || governance.code.length == 0 || versionRegistry == address(0)
                || versionRegistry.code.length == 0 || launchGate == address(0) || launchGate.code.length == 0
                || policyRegistry == address(0) || policyRegistry.code.length == 0 || factory == address(0)
                || factory.code.length == 0
        ) revert InvalidConfiguration();
        _validateRegistry(governance, versionRegistry, factory, activated);
        _validateGate(governance, launchGate);
        _validatePolicies(governance, policyRegistry, factory);
        _validateFactory(governance, factory, versionRegistry, launchGate, policyRegistry, officialConsumed);
    }

    function _validateRegistry(address governance, address versionRegistry, address factory, bool activated)
        private
        view
    {
        IRMTV6FoundationRegistry registry = IRMTV6FoundationRegistry(versionRegistry);
        address expectedActiveFactory = activated ? factory : LEGACY_IDENTITY_FACTORY;
        bytes32 expectedActiveVersion = activated ? FACTORY_VERSION : LEGACY_FACTORY_VERSION;
        if (
            registry.governance() != governance || registry.bootstrapController() != controller
                || registry.activationDelay() != REGISTRY_ACTIVATION_DELAY
                || registry.initialFactory() != LEGACY_IDENTITY_FACTORY
                || registry.initialVersion() != LEGACY_FACTORY_VERSION || registry.bootstrapConsumed() != activated
                || registry.activeFactory() != expectedActiveFactory
                || registry.activeVersion() != expectedActiveVersion || registry.pendingFactory() != address(0)
                || registry.pendingVersion() != bytes32(0) || registry.pendingActivationTime() != 0
                || registry.pendingExpirationTime() != 0 || registry.pendingConfigurationEpoch() != 0
        ) revert InvalidConfiguration();
    }

    function _validateGate(address governance, address launchGate) private view {
        IRMTV6FoundationGate gate = IRMTV6FoundationGate(launchGate);
        if (
            gate.governance() != governance || gate.guardian() != OPERATOR || gate.bootstrapController() != controller
                || gate.unpauseDelay() != GATE_UNPAUSE_DELAY || !gate.launchesPaused() || gate.bootstrapConsumed()
                || gate.unpauseExecutableAt() != 0 || gate.unpauseExpiresAt() != 0
                || gate.unpauseConfigurationEpoch() != 0
        ) revert InvalidConfiguration();
    }

    function _validatePolicies(address governance, address policyRegistry, address factory) private view {
        IRMTV6FoundationPolicyRegistry policies = IRMTV6FoundationPolicyRegistry(policyRegistry);
        address adapterAddress = policies.canonicalGraduationAdapter();
        if (
            policies.governance() != governance || policies.guardian() != OPERATOR
                || policies.governanceDelay() != GOVERNANCE_DELAY || policies.canonicalProtocolTreasury() != governance
                || policies.canonicalMarketImplementation().code.length == 0 || adapterAddress.code.length == 0
                || policies.defaultPolicyId() != FAIR_POLICY_ID || policies.policyHash(FAIR_POLICY_ID) == bytes32(0)
                || policies.policyHash(OPEN_POLICY_ID) == bytes32(0)
        ) revert InvalidConfiguration();
        _validateGraduationTopology(adapterAddress, factory);
        _validatePolicy(policies.getPolicy(FAIR_POLICY_ID), policies, governance, true);
        _validatePolicy(policies.getPolicy(OPEN_POLICY_ID), policies, governance, false);
    }

    function _validateGraduationTopology(address adapterAddress, address factory) private view {
        IRMTV6FoundationAdapter adapter = IRMTV6FoundationAdapter(adapterAddress);
        address hookAddress = adapter.hook();
        if (
            adapter.poolManager() != POOL_MANAGER || adapter.deployer() != OPERATOR || adapter.factory() != factory
                || adapter.poolFee() != V4_POOL_FEE || adapter.tickSpacing() != V4_TICK_SPACING
                || hookAddress == address(0) || hookAddress.code.length == 0
                || (uint160(hookAddress) & uint160(0x3fff)) != REQUIRED_HOOK_FLAGS
        ) revert InvalidConfiguration();

        IRMTV6FoundationHook hook = IRMTV6FoundationHook(hookAddress);
        if (hook.poolManager() != POOL_MANAGER || hook.deployer() != OPERATOR || hook.adapter() != adapterAddress) {
            revert InvalidConfiguration();
        }
    }

    function _validatePolicy(
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy,
        IRMTV6FoundationPolicyRegistry policies,
        address governance,
        bool fair
    ) private view {
        if (
            policy.policyId != (fair ? FAIR_POLICY_ID : OPEN_POLICY_ID) || policy.policyVersion != 1 || !policy.enabled
                || !policy.publiclySelectable || policy.curveFeeBps != 100 || policy.creatorFeeShareBps != 7_000
                || policy.protocolFeeShareBps != 3_000 || policy.postGraduationFeeBps != 50
                || policy.graduationTarget != 2 ether || policy.fairStartMode != (fair ? 1 : 0)
                || policy.fairStartDelayBlocks != (fair ? 1 : 0) || policy.fairStartDurationBlocks != (fair ? 10 : 0)
                || policy.fairStartMaxTxBps != (fair ? 100 : 0) || policy.fairStartMaxWalletBps != (fair ? 300 : 0)
                || policy.marketImplementation != policies.canonicalMarketImplementation()
                || policy.protocolTreasury != governance
                || policy.graduationAdapter != policies.canonicalGraduationAdapter()
        ) revert InvalidConfiguration();
    }

    function _validateFactory(
        address governance,
        address factory,
        address versionRegistry,
        address launchGate,
        address policyRegistry,
        bool officialConsumed
    ) private view {
        IRMTV6FoundationFactory reviewedFactory = IRMTV6FoundationFactory(factory);
        if (
            reviewedFactory.protocolVersion() != 6 || reviewedFactory.FACTORY_VERSION() != FACTORY_VERSION
                || reviewedFactory.LEGACY_FACTORY_VERSION() != LEGACY_FACTORY_VERSION
                || reviewedFactory.OFFICIAL_MIGRATION_POLICY_ID() != FAIR_POLICY_ID
                || reviewedFactory.launchGate() != launchGate || reviewedFactory.policyRegistry() != policyRegistry
                || reviewedFactory.factoryRegistry() != versionRegistry
                || reviewedFactory.legacyIdentityFactory() != LEGACY_IDENTITY_FACTORY
                || reviewedFactory.officialLegacyToken() != OFFICIAL_LEGACY_RMT_TOKEN
                || reviewedFactory.creatorPayoutAuthority() != governance
                || reviewedFactory.initialVirtualEthReserve() != INITIAL_VIRTUAL_ETH_RESERVE
                || reviewedFactory.initialVirtualTokenReserve() != INITIAL_VIRTUAL_TOKEN_RESERVE
                || reviewedFactory.tokenImplementation().code.length == 0
                || reviewedFactory.feeSplitterImplementation().code.length == 0
        ) revert InvalidConfiguration();

        address migrationAddress = reviewedFactory.officialIdentityMigration();
        if (migrationAddress == address(0) || migrationAddress.code.length == 0) revert InvalidConfiguration();
        IRMTV6FoundationOfficialMigration migration = IRMTV6FoundationOfficialMigration(migrationAddress);
        if (
            migration.officialLauncher() != OPERATOR || migration.authorizedFactory() != factory
                || migration.officialLegacyToken() != OFFICIAL_LEGACY_RMT_TOKEN
                || migration.consumed() != officialConsumed
        ) revert InvalidConfiguration();
    }
}
