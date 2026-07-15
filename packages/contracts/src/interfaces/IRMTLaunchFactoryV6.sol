// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Stable capability interface shared by the RMT website, indexer, and future factory versions.
/// @dev V7+ factories should preserve this interface and add capabilities without changing historical launch policy data.
interface IRMTLaunchFactoryV6 {
    struct LaunchPolicyView {
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
    }

    struct LaunchView {
        address token;
        address market;
        address rewardVault;
        bytes32 graduationPoolId;
        address creator;
        bytes32 policyId;
        uint32 policyVersion;
        uint64 createdAt;
        bool officialMigration;
    }

    function protocolVersion() external pure returns (uint32);
    function launchesPaused() external view returns (bool);
    function defaultPolicyId() external view returns (bytes32);
    function getPolicy(bytes32 policyId) external view returns (LaunchPolicyView memory);
    function isPolicyEnabled(bytes32 policyId) external view returns (bool);

    function launch(
        bytes32 policyId,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) external returns (address token, address market, address rewardVault);

    function launchSimple(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault);

    function launchOfficialWhilePaused(string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault);

    function launchCount() external view returns (uint256);
    function getLaunch(uint256 launchId) external view returns (LaunchView memory);
    function isNameUsed(string calldata name) external view returns (bool);
    function isSymbolUsed(string calldata symbol) external view returns (bool);
    function canMigrateOfficialIdentity(
        address launcher,
        bytes32 policyId,
        string calldata name,
        string calldata symbol
    ) external view returns (bool);
}
