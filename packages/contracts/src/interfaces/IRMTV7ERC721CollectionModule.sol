// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Deployment interface for the first creator-controlled V7 ERC-721 collection module.
interface IRMTV7ERC721CollectionModule {
    struct CollectionConfig {
        string name;
        string symbol;
        string collectionURI;
        bytes32 tokenManifestRoot;
        uint32 maximumSupply;
        address royaltyReceiver;
        uint16 royaltyBps;
    }

    event CreatorCollectionDeployed(
        bytes32 indexed releaseId,
        bytes32 indexed moduleKey,
        address indexed creator,
        address collection,
        bytes32 configurationHash
    );

    function hashCollectionConfig(CollectionConfig calldata config) external pure returns (bytes32);
    function deployCollection(bytes32 releaseId, CollectionConfig calldata config) external returns (address collection);
    function collectionForRelease(bytes32 releaseId) external view returns (address collection);
}
