// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Canonical, reviewable constants for the RMT V6 mainnet release.
/// @dev V6 intentionally uses direct creator and protocol treasury destinations.
library MainnetReleaseConfigV6 {
    uint256 internal constant CHAIN_ID = 4663;

    address internal constant DEVELOPER_OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    // The already-deployed V5 governance remains the immutable authority of the existing
    // VersionedFactoryRegistry. V6 deploys a separate RMTV6Governance and uses it for every
    // new V6 protocol role; its address is therefore deployment output, not a source constant.
    address internal constant REGISTRY_GOVERNANCE = 0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953;
    address internal constant INITIAL_GUARDIAN = DEVELOPER_OPERATOR;
    address internal constant PROTOCOL_TREASURY = DEVELOPER_OPERATOR;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant LEGACY_IDENTITY_FACTORY = 0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD;
    address internal constant OFFICIAL_LEGACY_RMT_TOKEN = 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C;
    address internal constant VERSION_REGISTRY = 0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1;
    bytes32 internal constant LEGACY_FACTORY_VERSION = keccak256("RMT_FACTORY_V5");
    bytes32 internal constant FACTORY_VERSION = keccak256("RMT_FACTORY_V6");

    uint64 internal constant GOVERNANCE_DELAY = 1 days;
    uint64 internal constant GOVERNANCE_EXECUTION_WINDOW = 7 days;
    uint64 internal constant REGISTRY_ACTIVATION_DELAY = 2 days;
    uint64 internal constant LAUNCH_UNPAUSE_DELAY = 1 days;

    // The website presents one Fair Start toggle. Each choice maps to an immutable policy.
    bytes32 internal constant SIMPLE_FAIR_V1_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    bytes32 internal constant SIMPLE_OPEN_V1_POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");
    bytes32 internal constant DEFAULT_POLICY_ID = SIMPLE_FAIR_V1_POLICY_ID;

    uint8 internal constant FAIR_START_DISABLED = 0;
    uint8 internal constant FAIR_START_ENABLED = 1;
    uint64 internal constant FAIR_START_DELAY_BLOCKS = 1;
    uint64 internal constant FAIR_START_DURATION_BLOCKS = 10;
    uint16 internal constant FAIR_START_MAX_TX_BPS = 100;
    uint16 internal constant FAIR_START_MAX_WALLET_BPS = 300;

    // The V6 market implementation and graduation adapter are deployed by the foundation script,
    // then supplied to the policy registry as immutable constructor arguments. They are intentionally
    // not mutable address constants in this configuration library.

    // Provisional economics. These remain release-blocked until model tests and review pass.
    uint16 internal constant CURVE_FEE_BPS = 100;
    uint16 internal constant CREATOR_FEE_SHARE_BPS = 7_000;
    uint16 internal constant PROTOCOL_FEE_SHARE_BPS = 3_000;
    uint16 internal constant POST_GRADUATION_FEE_BPS = 50;
    uint24 internal constant V4_POOL_FEE = 5_000;
    int24 internal constant V4_TICK_SPACING = 200;

    uint256 internal constant INITIAL_VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 internal constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint256 internal constant GRADUATION_TARGET = 2 ether;
}
