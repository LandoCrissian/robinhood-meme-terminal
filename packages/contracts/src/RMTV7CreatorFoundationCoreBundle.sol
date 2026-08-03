// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV7MediaEvidenceVerifier} from "./RMTV7MediaEvidenceVerifier.sol";
import {RMTV7ModuleRegistry} from "./RMTV7ModuleRegistry.sol";
import {RMTV7ReleaseRegistry} from "./RMTV7ReleaseRegistry.sol";

/// @notice Deploys and verifies the registry, evidence verifier and release registry in one transaction.
/// @dev Creator modules remain a separate, size-bounded deployment stage and require later governance admission.
contract RMTV7CreatorFoundationCoreBundle {
    RMTV7ModuleRegistry public immutable moduleRegistry;
    RMTV7MediaEvidenceVerifier public immutable mediaEvidenceVerifier;
    RMTV7ReleaseRegistry public immutable releaseRegistry;

    error BindingVerificationFailed();

    event CreatorFoundationCoreDeployed(
        address indexed governance,
        address indexed evidenceSigner,
        address indexed moduleRegistry,
        address mediaEvidenceVerifier,
        address releaseRegistry
    );

    constructor(address governance, address evidenceSigner) {
        if (governance == address(0) || governance.code.length == 0 || evidenceSigner == address(0)) {
            revert BindingVerificationFailed();
        }

        RMTV7ModuleRegistry deployedModuleRegistry = new RMTV7ModuleRegistry(governance);
        RMTV7MediaEvidenceVerifier deployedMediaEvidenceVerifier =
            new RMTV7MediaEvidenceVerifier(governance, evidenceSigner);
        RMTV7ReleaseRegistry deployedReleaseRegistry =
            new RMTV7ReleaseRegistry(address(deployedModuleRegistry), address(deployedMediaEvidenceVerifier));

        if (
            deployedModuleRegistry.governance() != governance
                || deployedMediaEvidenceVerifier.governance() != governance
                || deployedMediaEvidenceVerifier.evidenceSigner() != evidenceSigner
                || deployedMediaEvidenceVerifier.signerEpoch() != 1
                || address(deployedReleaseRegistry.moduleRegistry()) != address(deployedModuleRegistry)
                || address(deployedReleaseRegistry.mediaEvidenceVerifier()) != address(deployedMediaEvidenceVerifier)
        ) revert BindingVerificationFailed();

        moduleRegistry = deployedModuleRegistry;
        mediaEvidenceVerifier = deployedMediaEvidenceVerifier;
        releaseRegistry = deployedReleaseRegistry;

        emit CreatorFoundationCoreDeployed(
            governance,
            evidenceSigner,
            address(deployedModuleRegistry),
            address(deployedMediaEvidenceVerifier),
            address(deployedReleaseRegistry)
        );
    }
}
