// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IRMTV7ConsentBoundSplitModule {
    struct SplitConfig {
        address[] recipients;
        uint16[] sharesBps;
        address[] recoveryAddresses;
        uint64 consentDeadline;
    }

    event ConsentBoundSplitDeployed(
        bytes32 indexed releaseId,
        bytes32 indexed moduleKey,
        address indexed creator,
        address split,
        bytes32 configurationHash,
        bytes32 payoutManifestHash
    );

    function hashSplitConfig(SplitConfig calldata config)
        external
        pure
        returns (bytes32 configurationHash, bytes32 payoutManifestHash, bytes32 consentManifestHash);
    function consentDigest(
        bytes32 releaseId,
        address creator,
        bytes32 configurationHash,
        bytes32 payoutManifestHash,
        address recipient,
        uint16 shareBps,
        address recoveryAddress,
        uint64 consentDeadline
    ) external view returns (bytes32);
    function deploySplit(bytes32 releaseId, SplitConfig calldata config, bytes[] calldata consentSignatures)
        external
        returns (address split);
    function splitForRelease(bytes32 releaseId) external view returns (address split);
}
