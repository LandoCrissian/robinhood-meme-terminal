// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Canonical, reviewable constants for the RMT V6 mainnet release.
/// @dev The developer/operator wallet controls deployment and initial governance actions,
///      but protocol revenue remains routed through fixed purpose vaults rather than directly
///      to this externally owned account.
library MainnetReleaseConfigV6 {
    uint256 internal constant CHAIN_ID = 4663;

    // Verified RMTMain developer/operator wallet used by the production deployment console.
    address internal constant DEVELOPER_OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;

    // V6 starts with the same wallet in both roles for mobile-operated deployment.
    // The contracts deliberately restrict the guardian to pause/cancel powers only.
    // Governance may later be transferred to reviewed multisig/timelock infrastructure.
    address internal constant INITIAL_GOVERNANCE = DEVELOPER_OPERATOR;
    address internal constant INITIAL_GUARDIAN = DEVELOPER_OPERATOR;

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
