// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IRMTV7MediaEvidenceVerifier} from "./interfaces/IRMTV7MediaEvidenceVerifier.sol";

/// @notice Verifies short-lived attestations that bind one reviewed media receipt and availability observation.
/// @dev The signer can attest only to evidence. It cannot freeze releases, mint, transfer, settle, or hold assets.
contract RMTV7MediaEvidenceVerifier is EIP712, IRMTV7MediaEvidenceVerifier {
    bytes32 public constant MEDIA_EVIDENCE_TYPEHASH = keccak256(
        "RMTV7MediaEvidence(address releaseRegistry,bytes32 releaseId,address creator,bytes32 metadataHash,bytes32 mediaManifestHash,bytes32 receiptHash,bytes32 availabilityObservationHash,uint64 observedAt,uint64 validUntil,uint64 signerEpoch)"
    );
    uint64 public constant MAXIMUM_OBSERVATION_AGE = 1 days;
    uint64 public constant MAXIMUM_EVIDENCE_LIFETIME = 2 days;

    address public immutable override governance;
    address public override evidenceSigner;
    uint64 public override signerEpoch;

    error OnlyGovernance();
    error InvalidConfiguration();
    error InvalidEvidenceWindow();
    error InvalidEvidenceSignature();

    event EvidenceSignerRotated(
        address indexed previousSigner, address indexed nextSigner, uint64 indexed nextSignerEpoch
    );

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    constructor(address governance_, address evidenceSigner_) EIP712("RMT V7 Media Evidence", "1") {
        if (governance_ == address(0) || governance_.code.length == 0 || evidenceSigner_ == address(0)) {
            revert InvalidConfiguration();
        }
        governance = governance_;
        evidenceSigner = evidenceSigner_;
        signerEpoch = 1;
        emit EvidenceSignerRotated(address(0), evidenceSigner_, 1);
    }

    /// @notice Rotates only the bounded evidence signer through delayed governance.
    /// @dev Old attestations fail immediately because every signature binds the current epoch.
    function rotateEvidenceSigner(address nextSigner) external onlyGovernance {
        address previousSigner = evidenceSigner;
        if (nextSigner == address(0) || nextSigner == previousSigner) revert InvalidConfiguration();
        evidenceSigner = nextSigner;
        ++signerEpoch;
        emit EvidenceSignerRotated(previousSigner, nextSigner, signerEpoch);
    }

    function verifyEvidence(
        address releaseRegistry,
        bytes32 releaseId,
        address creator,
        bytes32 metadataHash,
        bytes32 mediaManifestHash,
        MediaEvidence calldata evidence,
        bytes calldata signature
    ) external view override returns (bytes32 evidenceHash) {
        if (
            releaseRegistry == address(0) || releaseId == bytes32(0) || creator == address(0)
                || metadataHash == bytes32(0) || mediaManifestHash == bytes32(0) || evidence.receiptHash == bytes32(0)
                || evidence.availabilityObservationHash == bytes32(0) || evidence.signerEpoch != signerEpoch
        ) revert InvalidConfiguration();

        uint256 currentTimestamp = block.timestamp;
        if (
            evidence.observedAt > currentTimestamp || currentTimestamp - evidence.observedAt > MAXIMUM_OBSERVATION_AGE
                || evidence.validUntil < currentTimestamp || evidence.validUntil <= evidence.observedAt
                || evidence.validUntil - evidence.observedAt > MAXIMUM_EVIDENCE_LIFETIME
        ) revert InvalidEvidenceWindow();

        evidenceHash = hashEvidence(evidence);
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MEDIA_EVIDENCE_TYPEHASH,
                    releaseRegistry,
                    releaseId,
                    creator,
                    metadataHash,
                    mediaManifestHash,
                    evidence.receiptHash,
                    evidence.availabilityObservationHash,
                    evidence.observedAt,
                    evidence.validUntil,
                    evidence.signerEpoch
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(evidenceSigner, digest, signature)) {
            revert InvalidEvidenceSignature();
        }
    }

    function evidenceDigest(
        address releaseRegistry,
        bytes32 releaseId,
        address creator,
        bytes32 metadataHash,
        bytes32 mediaManifestHash,
        MediaEvidence calldata evidence
    ) external view returns (bytes32 digest) {
        digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MEDIA_EVIDENCE_TYPEHASH,
                    releaseRegistry,
                    releaseId,
                    creator,
                    metadataHash,
                    mediaManifestHash,
                    evidence.receiptHash,
                    evidence.availabilityObservationHash,
                    evidence.observedAt,
                    evidence.validUntil,
                    evidence.signerEpoch
                )
            )
        );
    }

    function hashEvidence(MediaEvidence calldata evidence) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                evidence.receiptHash,
                evidence.availabilityObservationHash,
                evidence.observedAt,
                evidence.validUntil,
                evidence.signerEpoch
            )
        );
    }
}
