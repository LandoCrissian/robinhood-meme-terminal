// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV7ConsentBoundSplitModule} from "./RMTV7ConsentBoundSplitModule.sol";
import {RMTV7ERC1155EditionModule} from "./RMTV7ERC1155EditionModule.sol";
import {RMTV7ERC721CollectionModule} from "./RMTV7ERC721CollectionModule.sol";
import {RMTV7ModuleRegistry} from "./RMTV7ModuleRegistry.sol";
import {RMTV7ReleaseRegistry} from "./RMTV7ReleaseRegistry.sol";

/// @notice Deploys and verifies the three inactive V7 creator modules in one transaction.
/// @dev This stage cannot register or activate a module. Admission remains delayed-governance controlled.
contract RMTV7CreatorFoundationModulesBundle {
    RMTV7ERC721CollectionModule public immutable collectionModule;
    RMTV7ERC1155EditionModule public immutable editionModule;
    RMTV7ConsentBoundSplitModule public immutable splitModule;

    error BindingVerificationFailed();

    event CreatorFoundationModulesDeployed(
        address indexed moduleRegistry,
        address indexed releaseRegistry,
        address collectionModule,
        address editionModule,
        address splitModule
    );

    constructor(address moduleRegistry, address releaseRegistry) {
        if (
            moduleRegistry == address(0) || moduleRegistry.code.length == 0 || releaseRegistry == address(0)
                || releaseRegistry.code.length == 0
        ) revert BindingVerificationFailed();

        RMTV7ModuleRegistry registry = RMTV7ModuleRegistry(moduleRegistry);
        RMTV7ReleaseRegistry releases = RMTV7ReleaseRegistry(releaseRegistry);
        if (registry.governance() == address(0) || address(releases.moduleRegistry()) != moduleRegistry) {
            revert BindingVerificationFailed();
        }

        RMTV7ERC721CollectionModule deployedCollectionModule =
            new RMTV7ERC721CollectionModule(moduleRegistry, releaseRegistry);
        RMTV7ERC1155EditionModule deployedEditionModule = new RMTV7ERC1155EditionModule(moduleRegistry, releaseRegistry);
        RMTV7ConsentBoundSplitModule deployedSplitModule =
            new RMTV7ConsentBoundSplitModule(moduleRegistry, releaseRegistry);

        if (
            address(deployedCollectionModule.moduleRegistry()) != moduleRegistry
                || address(deployedCollectionModule.releaseRegistry()) != releaseRegistry
                || address(deployedEditionModule.moduleRegistry()) != moduleRegistry
                || address(deployedEditionModule.releaseRegistry()) != releaseRegistry
                || address(deployedSplitModule.moduleRegistry()) != moduleRegistry
                || address(deployedSplitModule.releaseRegistry()) != releaseRegistry
        ) revert BindingVerificationFailed();

        collectionModule = deployedCollectionModule;
        editionModule = deployedEditionModule;
        splitModule = deployedSplitModule;

        emit CreatorFoundationModulesDeployed(
            moduleRegistry,
            releaseRegistry,
            address(deployedCollectionModule),
            address(deployedEditionModule),
            address(deployedSplitModule)
        );
    }
}
