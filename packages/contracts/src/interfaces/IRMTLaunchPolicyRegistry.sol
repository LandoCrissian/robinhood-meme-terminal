// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Versioned launch-policy registry for RMT V6 and later factories.
/// @dev Policies are append-only. A registry instance locks its canonical market and graduation
///      adapter; changing execution components requires a separately reviewed protocol deployment.
interface IRMTLaunchPolicyRegistry {
    struct LaunchPolicy {
        bytes32 policyId;
        uint32 policyVersion;
        bool enabled;
        bool publiclySelectable;
        uint16 curveFeeBps;
        uint16 creatorFeeShareBps;
        uint16 protocolFeeShareBps;
        uint16 postGraduationFeeBps;
        uint256 graduationTarget;
        uint8 fairStartMode;
        uint64 fairStartDelayBlocks;
        uint64 fairStartDurationBlocks;
        uint16 fairStartMaxTxBps;
        uint16 fairStartMaxWalletBps;
        address marketImplementation;
        address protocolTreasury;
        address graduationAdapter;
    }

    event PolicyRegistered(bytes32 indexed policyId, uint32 indexed policyVersion, bytes32 policyHash);
    event PolicyAvailabilityChanged(bytes32 indexed policyId, bool enabled, bool publiclySelectable);
    event DefaultPolicyChanged(bytes32 indexed previousPolicyId, bytes32 indexed newPolicyId);

    function governance() external view returns (address);
    function canonicalProtocolTreasury() external view returns (address);
    function canonicalMarketImplementation() external view returns (address);
    function canonicalGraduationAdapter() external view returns (address);
    function defaultPolicyId() external view returns (bytes32);
    function getPolicy(bytes32 policyId) external view returns (LaunchPolicy memory);
    function policyHash(bytes32 policyId) external view returns (bytes32);
    function isPolicyEnabled(bytes32 policyId) external view returns (bool);
}
