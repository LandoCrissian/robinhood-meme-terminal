// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTV7ERC721CollectionModule} from "./interfaces/IRMTV7ERC721CollectionModule.sol";
import {IRMTV7ModuleRegistry} from "./interfaces/IRMTV7ModuleRegistry.sol";
import {IRMTV7ReleaseRegistry} from "./interfaces/IRMTV7ReleaseRegistry.sol";
import {RMTV7CreatorCollection} from "./RMTV7CreatorCollection.sol";

/// @notice Permissionless deployer for creator-controlled collections authorized by frozen V7 releases.
/// @dev This module accepts no payment and has no RMT administrator or collection-level authority.
contract RMTV7ERC721CollectionModule is IRMTV7ERC721CollectionModule {
    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;

    uint8 public constant MODULE_KIND = 1;
    uint32 public constant MODULE_VERSION = 1;
    uint16 public constant MAXIMUM_ROYALTY_BPS = 1_000;
    uint32 public constant MAXIMUM_COLLECTION_SUPPLY = 100_000;
    uint256 public constant MAXIMUM_NAME_BYTES = 100;
    uint256 public constant MAXIMUM_SYMBOL_BYTES = 20;
    uint256 public constant MAXIMUM_COLLECTION_URI_BYTES = 2_048;

    IRMTV7ModuleRegistry public immutable moduleRegistry;
    IRMTV7ReleaseRegistry public immutable releaseRegistry;
    mapping(bytes32 releaseId => address collection) public override collectionForRelease;

    error InvalidConfiguration();
    error ModuleNotActive();
    error ReleaseIntentMismatch();
    error CollectionAlreadyDeployed();

    constructor(address moduleRegistry_, address releaseRegistry_) {
        if (
            moduleRegistry_ == address(0) || moduleRegistry_.code.length == 0 || releaseRegistry_ == address(0)
                || releaseRegistry_.code.length == 0
        ) revert InvalidConfiguration();
        moduleRegistry = IRMTV7ModuleRegistry(moduleRegistry_);
        releaseRegistry = IRMTV7ReleaseRegistry(releaseRegistry_);
    }

    function hashCollectionConfig(CollectionConfig calldata config) external pure override returns (bytes32) {
        return _hashCollectionConfig(config);
    }

    function deployCollection(bytes32 releaseId, CollectionConfig calldata config)
        external
        override
        returns (address collection)
    {
        if (releaseId == bytes32(0)) revert InvalidConfiguration();
        _validateConfig(config);
        if (collectionForRelease[releaseId] != address(0)) revert CollectionAlreadyDeployed();

        bytes32 moduleKey = _activeModuleKey();
        bytes32 configurationHash = _hashCollectionConfig(config);
        if (!releaseRegistry.isFrozenModuleIntent(releaseId, msg.sender, moduleKey, configurationHash)) {
            revert ReleaseIntentMismatch();
        }

        collection = address(
            new RMTV7CreatorCollection{salt: releaseId}(
                releaseId,
                configurationHash,
                msg.sender,
                config.name,
                config.symbol,
                config.collectionURI,
                config.tokenManifestRoot,
                config.maximumSupply,
                config.royaltyReceiver,
                config.royaltyBps
            )
        );
        collectionForRelease[releaseId] = collection;
        emit CreatorCollectionDeployed(releaseId, moduleKey, msg.sender, collection, configurationHash);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == type(IRMTV7ERC721CollectionModule).interfaceId;
    }

    function _activeModuleKey() private view returns (bytes32 moduleKey) {
        bytes32 versionKey = keccak256(abi.encode(MODULE_KIND, MODULE_VERSION));
        moduleKey = moduleRegistry.moduleKeyByKindAndVersion(versionKey);
        if (moduleKey == bytes32(0) || !moduleRegistry.isModuleActive(moduleKey)) revert ModuleNotActive();

        IRMTV7ModuleRegistry.Module memory module = moduleRegistry.getModule(moduleKey);
        if (
            module.implementation != address(this)
                || module.interfaceId != type(IRMTV7ERC721CollectionModule).interfaceId
                || module.implementationCodeHash != address(this).codehash
        ) revert ModuleNotActive();
    }

    function _validateConfig(CollectionConfig calldata config) private pure {
        uint256 nameLength = bytes(config.name).length;
        uint256 symbolLength = bytes(config.symbol).length;
        uint256 collectionURILength = bytes(config.collectionURI).length;
        if (
            nameLength == 0 || nameLength > MAXIMUM_NAME_BYTES || symbolLength == 0
                || symbolLength > MAXIMUM_SYMBOL_BYTES || collectionURILength == 0
                || collectionURILength > MAXIMUM_COLLECTION_URI_BYTES || config.tokenManifestRoot == bytes32(0)
                || config.maximumSupply == 0 || config.maximumSupply > MAXIMUM_COLLECTION_SUPPLY
                || config.royaltyBps > MAXIMUM_ROYALTY_BPS
                || (config.royaltyBps == 0 && config.royaltyReceiver != address(0))
                || (config.royaltyBps != 0 && config.royaltyReceiver == address(0))
        ) revert InvalidConfiguration();
    }

    function _hashCollectionConfig(CollectionConfig calldata config) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(config.name)),
                keccak256(bytes(config.symbol)),
                keccak256(bytes(config.collectionURI)),
                config.tokenManifestRoot,
                config.maximumSupply,
                config.royaltyReceiver,
                config.royaltyBps
            )
        );
    }
}
