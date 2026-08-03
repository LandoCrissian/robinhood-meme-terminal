// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IRMTV7MediaEvidenceVerifier {
    struct MediaEvidence {
        bytes32 receiptHash;
        bytes32 availabilityObservationHash;
        uint64 observedAt;
        uint64 validUntil;
        uint64 signerEpoch;
    }

    function governance() external view returns (address);
    function evidenceSigner() external view returns (address);
    function signerEpoch() external view returns (uint64);
    function verifyEvidence(
        address releaseRegistry,
        bytes32 releaseId,
        address creator,
        bytes32 metadataHash,
        bytes32 mediaManifestHash,
        MediaEvidence calldata evidence,
        bytes calldata signature
    ) external view returns (bytes32 evidenceHash);
}
