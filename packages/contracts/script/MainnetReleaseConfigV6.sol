// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Canonical, reviewable constants for the RMT V6 mainnet release.
/// @dev V6 intentionally uses direct creator and protocol treasury destinations.
library MainnetReleaseConfigV6 {
    uint256 internal constant CHAIN_ID = 4663;

    address internal constant DEVELOPER_OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    address internal constant INITIAL_GOVERNANCE = DEVELOPER_OPERATOR;
    address internal constant INITIAL_GUARDIAN = DEVELOPER_OPERATOR;
    address internal constant PROTOCOL_TREASURY = DEVELOPER_OPERATOR;

    uint64 internal constant GOVERNANCE_DELAY = 1 days;
    uint64 internal constant REGISTRY_ACTIVATION_DELAY = 2 days;

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

    // Provisional economics. These remain release-blocked until model tests and review pass.
    uint16 internal constant CURVE_FEE_BPS = 100;
    uint16 internal constant CREATOR_FEE_SHARE_BPS = 7_000;
    uint16 internal constant PROTOCOL_FEE_SHARE_BPS = 3_000;
    uint16 internal constant POST_GRADUATION_FEE_BPS = 50;

    uint256 internal constant INITIAL_VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 internal constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint256 internal constant GRADUATION_TARGET = 2 ether;
}
