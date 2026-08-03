// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Deployment interface for creator-controlled V7 ERC-1155 edition collections.
interface IRMTV7ERC1155EditionModule {
    struct EditionConfig {
        string name;
        string symbol;
        string collectionURI;
        bytes32 editionManifestRoot;
        uint32 maximumEditionTypes;
        uint64 maximumTotalSupply;
        address royaltyReceiver;
        uint16 royaltyBps;
    }

    event CreatorEditionsDeployed(
        bytes32 indexed releaseId,
        bytes32 indexed moduleKey,
        address indexed creator,
        address editions,
        bytes32 configurationHash
    );

    function hashEditionConfig(EditionConfig calldata config) external pure returns (bytes32);
    function deployEditions(bytes32 releaseId, EditionConfig calldata config) external returns (address editions);
    function editionsForRelease(bytes32 releaseId) external view returns (address editions);
}
