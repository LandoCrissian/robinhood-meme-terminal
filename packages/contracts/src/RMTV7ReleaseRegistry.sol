// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTV7ModuleRegistry} from "./interfaces/IRMTV7ModuleRegistry.sol";
import {IRMTV7MediaEvidenceVerifier} from "./interfaces/IRMTV7MediaEvidenceVerifier.sol";

/// @notice Creator-owned, immutable commitments for future V7 releases.
/// @dev This registry does not approve creators, mint assets, call modules, accept payments, or
///      imply RMT review. Curated visibility and legal/provider review remain separate controls.
contract RMTV7ReleaseRegistry {
    uint8 public constant RELEASE_STATE_COMMITTED = 1;
    uint8 public constant RELEASE_STATE_FROZEN = 2;
    uint8 public constant RELEASE_STATE_CANCELLED = 3;
    uint256 public constant MAXIMUM_MODULES_PER_RELEASE = 8;

    struct ReleaseCommitment {
        address creator;
        bytes32 projectIdHash;
        bytes32 assetIdHash;
        bytes32 rightsRevisionHash;
        bytes32 metadataHash;
        bytes32 mediaManifestHash;
        bytes32 feePolicyHash;
        bytes32 payoutManifestHash;
        bytes32 moduleManifestHash;
        bytes32 mediaEvidenceHash;
        bytes32 mediaReceiptHash;
        bytes32 availabilityObservationHash;
        uint64 createdAt;
        uint64 frozenAt;
        uint64 cancelledAt;
        uint64 evidenceObservedAt;
        uint64 evidenceValidUntil;
        uint64 evidenceSignerEpoch;
        uint8 state;
    }

    struct ModuleIntent {
        bytes32 moduleKey;
        bytes32 configurationHash;
    }

    IRMTV7ModuleRegistry public immutable moduleRegistry;
    IRMTV7MediaEvidenceVerifier public immutable mediaEvidenceVerifier;
    mapping(address creator => uint256 nextNonce) public creatorNonces;
    mapping(bytes32 releaseId => ReleaseCommitment release) private _releases;
    mapping(bytes32 releaseId => ModuleIntent[] intents) private _moduleIntents;
    mapping(bytes32 releaseId => mapping(bytes32 moduleKey => bytes32 configurationHash)) private
        _moduleConfigurationHashes;

    error InvalidConfiguration();
    error UnknownRelease();
    error OnlyReleaseCreator();
    error InvalidReleaseState(uint8 currentState);
    error InvalidModulePlan();
    error InactiveModule(bytes32 moduleKey);

    event ReleaseCommitted(
        bytes32 indexed releaseId,
        address indexed creator,
        uint256 indexed creatorNonce,
        bytes32 projectIdHash,
        bytes32 assetIdHash,
        bytes32 rightsRevisionHash,
        bytes32 metadataHash,
        bytes32 mediaManifestHash,
        bytes32 feePolicyHash,
        bytes32 payoutManifestHash
    );
    event ReleaseFrozen(
        bytes32 indexed releaseId,
        bytes32 indexed moduleManifestHash,
        bytes32 indexed mediaEvidenceHash,
        bytes32 mediaReceiptHash,
        bytes32 availabilityObservationHash,
        uint64 evidenceObservedAt,
        uint64 evidenceValidUntil,
        uint64 evidenceSignerEpoch,
        uint256 moduleCount
    );
    event ReleaseCancelled(bytes32 indexed releaseId);

    constructor(address moduleRegistry_, address mediaEvidenceVerifier_) {
        if (
            moduleRegistry_ == address(0) || moduleRegistry_.code.length == 0 || mediaEvidenceVerifier_ == address(0)
                || mediaEvidenceVerifier_.code.length == 0
        ) revert InvalidConfiguration();
        IRMTV7ModuleRegistry candidate = IRMTV7ModuleRegistry(moduleRegistry_);
        address registryGovernance = candidate.governance();
        if (registryGovernance == address(0) || registryGovernance.code.length == 0) revert InvalidConfiguration();
        IRMTV7MediaEvidenceVerifier verifier = IRMTV7MediaEvidenceVerifier(mediaEvidenceVerifier_);
        if (verifier.governance() != registryGovernance || verifier.evidenceSigner() == address(0)) {
            revert InvalidConfiguration();
        }
        moduleRegistry = candidate;
        mediaEvidenceVerifier = verifier;
    }

    /// @notice Records a creator's exact reviewed release fingerprints.
    /// @dev A changed field requires a new commitment and nonce; no existing record can be edited.
    function commitRelease(
        bytes32 projectIdHash,
        bytes32 assetIdHash,
        bytes32 rightsRevisionHash,
        bytes32 metadataHash,
        bytes32 mediaManifestHash,
        bytes32 feePolicyHash,
        bytes32 payoutManifestHash
    ) external returns (bytes32 releaseId) {
        if (
            projectIdHash == bytes32(0) || assetIdHash == bytes32(0) || rightsRevisionHash == bytes32(0)
                || metadataHash == bytes32(0) || mediaManifestHash == bytes32(0) || feePolicyHash == bytes32(0)
                || payoutManifestHash == bytes32(0)
        ) revert InvalidConfiguration();

        uint256 creatorNonce = creatorNonces[msg.sender]++;
        releaseId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                msg.sender,
                creatorNonce,
                projectIdHash,
                assetIdHash,
                rightsRevisionHash,
                metadataHash,
                mediaManifestHash,
                feePolicyHash,
                payoutManifestHash
            )
        );

        _releases[releaseId] = ReleaseCommitment({
            creator: msg.sender,
            projectIdHash: projectIdHash,
            assetIdHash: assetIdHash,
            rightsRevisionHash: rightsRevisionHash,
            metadataHash: metadataHash,
            mediaManifestHash: mediaManifestHash,
            feePolicyHash: feePolicyHash,
            payoutManifestHash: payoutManifestHash,
            moduleManifestHash: bytes32(0),
            mediaEvidenceHash: bytes32(0),
            mediaReceiptHash: bytes32(0),
            availabilityObservationHash: bytes32(0),
            createdAt: uint64(block.timestamp),
            frozenAt: 0,
            cancelledAt: 0,
            evidenceObservedAt: 0,
            evidenceValidUntil: 0,
            evidenceSignerEpoch: 0,
            state: RELEASE_STATE_COMMITTED
        });

        emit ReleaseCommitted(
            releaseId,
            msg.sender,
            creatorNonce,
            projectIdHash,
            assetIdHash,
            rightsRevisionHash,
            metadataHash,
            mediaManifestHash,
            feePolicyHash,
            payoutManifestHash
        );
    }

    /// @notice Atomically binds the complete future execution plan to a committed release.
    /// @dev No registered implementation is called. This is a fingerprint-only state transition.
    function freezeRelease(
        bytes32 releaseId,
        ModuleIntent[] calldata moduleIntents,
        IRMTV7MediaEvidenceVerifier.MediaEvidence calldata mediaEvidence,
        bytes calldata mediaEvidenceSignature
    ) external returns (bytes32 moduleManifestHash) {
        ReleaseCommitment storage release = _requireCreatorRelease(releaseId);
        if (release.state != RELEASE_STATE_COMMITTED) revert InvalidReleaseState(release.state);
        bytes32 mediaEvidenceHash = mediaEvidenceVerifier.verifyEvidence(
            address(this),
            releaseId,
            release.creator,
            release.metadataHash,
            release.mediaManifestHash,
            mediaEvidence,
            mediaEvidenceSignature
        );
        uint256 moduleCount = moduleIntents.length;
        if (moduleCount == 0 || moduleCount > MAXIMUM_MODULES_PER_RELEASE) revert InvalidModulePlan();

        for (uint256 i; i < moduleCount; ++i) {
            ModuleIntent calldata intent = moduleIntents[i];
            if (intent.moduleKey == bytes32(0) || intent.configurationHash == bytes32(0)) {
                revert InvalidModulePlan();
            }
            if (!moduleRegistry.isModuleActive(intent.moduleKey)) revert InactiveModule(intent.moduleKey);
            for (uint256 j; j < i; ++j) {
                if (moduleIntents[j].moduleKey == intent.moduleKey) revert InvalidModulePlan();
            }
            _moduleIntents[releaseId].push(intent);
            _moduleConfigurationHashes[releaseId][intent.moduleKey] = intent.configurationHash;
        }

        moduleManifestHash = keccak256(abi.encode(moduleIntents));
        release.moduleManifestHash = moduleManifestHash;
        release.mediaEvidenceHash = mediaEvidenceHash;
        release.mediaReceiptHash = mediaEvidence.receiptHash;
        release.availabilityObservationHash = mediaEvidence.availabilityObservationHash;
        release.frozenAt = uint64(block.timestamp);
        release.evidenceObservedAt = mediaEvidence.observedAt;
        release.evidenceValidUntil = mediaEvidence.validUntil;
        release.evidenceSignerEpoch = mediaEvidence.signerEpoch;
        release.state = RELEASE_STATE_FROZEN;
        emit ReleaseFrozen(
            releaseId,
            moduleManifestHash,
            mediaEvidenceHash,
            mediaEvidence.receiptHash,
            mediaEvidence.availabilityObservationHash,
            mediaEvidence.observedAt,
            mediaEvidence.validUntil,
            mediaEvidence.signerEpoch,
            moduleCount
        );
    }

    /// @notice Cancels an unfrozen commitment while preserving its public history.
    function cancelRelease(bytes32 releaseId) external {
        ReleaseCommitment storage release = _requireCreatorRelease(releaseId);
        if (release.state != RELEASE_STATE_COMMITTED) revert InvalidReleaseState(release.state);
        release.cancelledAt = uint64(block.timestamp);
        release.state = RELEASE_STATE_CANCELLED;
        emit ReleaseCancelled(releaseId);
    }

    function getRelease(bytes32 releaseId) external view returns (ReleaseCommitment memory) {
        ReleaseCommitment memory release = _releases[releaseId];
        if (release.creator == address(0)) revert UnknownRelease();
        return release;
    }

    function getModuleIntents(bytes32 releaseId) external view returns (ModuleIntent[] memory) {
        if (_releases[releaseId].creator == address(0)) revert UnknownRelease();
        return _moduleIntents[releaseId];
    }

    /// @notice Verifies one exact creator, module, and configuration against a terminal frozen release.
    function isFrozenModuleIntent(bytes32 releaseId, address creator, bytes32 moduleKey, bytes32 configurationHash)
        external
        view
        returns (bool)
    {
        ReleaseCommitment storage release = _releases[releaseId];
        return release.state == RELEASE_STATE_FROZEN && release.creator == creator && moduleKey != bytes32(0)
            && configurationHash != bytes32(0) && _moduleConfigurationHashes[releaseId][moduleKey] == configurationHash;
    }

    function isFrozenPayoutManifest(bytes32 releaseId, address creator, bytes32 payoutManifestHash)
        external
        view
        returns (bool)
    {
        ReleaseCommitment storage release = _releases[releaseId];
        return release.state == RELEASE_STATE_FROZEN && release.creator == creator && payoutManifestHash != bytes32(0)
            && release.payoutManifestHash == payoutManifestHash;
    }

    function _requireCreatorRelease(bytes32 releaseId) private view returns (ReleaseCommitment storage release) {
        release = _releases[releaseId];
        if (release.creator == address(0)) revert UnknownRelease();
        if (msg.sender != release.creator) revert OnlyReleaseCreator();
    }
}
