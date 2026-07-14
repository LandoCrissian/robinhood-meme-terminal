// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Canonical, reviewable constants for the RMT V6 mainnet release.
/// @dev V6 intentionally uses direct creator and protocol treasury destinations.
///      Optional community, referral, and purpose-vault programs may be introduced
///      later as new immutable policy versions without changing the base factory interface.
library MainnetReleaseConfigV6 {
    uint256 internal constant CHAIN_ID = 4663;

    // Verified RMTMain developer/operator wallet used by the production deployment console.
    address internal constant DEVELOPER_OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;

    // Initial mobile-operated governance and emergency guardian.
    // Guardian powers remain limited to pausing and cancelling scheduled reopening.
    address internal constant INITIAL_GOVERNANCE = DEVELOPER_OPERATOR;
    address internal constant INITIAL_GUARDIAN = DEVELOPER_OPERATOR;

    // V6 protocol revenue is paid directly here. No separate purpose vaults are deployed.
    address internal constant PROTOCOL_TREASURY = DEVELOPER_OPERATOR;

    uint64 internal constant GOVERNANCE_DELAY = 1 days;
    uint64 internal constant REGISTRY_ACTIVATION_DELAY = 2 days;

    bytes32 internal constant SIMPLE_V1_POLICY_ID = keccak256("RMT_SIMPLE_V1");

    // Provisional economics. These remain release-blocked until model tests and review pass.
    uint16 internal constant CURVE_FEE_BPS = 100;
    uint16 internal constant CREATOR_FEE_SHARE_BPS = 7_000;
    uint16 internal constant PROTOCOL_FEE_SHARE_BPS = 3_000;
    uint16 internal constant POST_GRADUATION_FEE_BPS = 50;

    uint256 internal constant INITIAL_VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 internal constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint256 internal constant GRADUATION_TARGET = 2 ether;
}
