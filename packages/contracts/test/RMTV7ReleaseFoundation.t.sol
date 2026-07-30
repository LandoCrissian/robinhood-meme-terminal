// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTV7ModuleRegistry} from "../src/interfaces/IRMTV7ModuleRegistry.sol";
import {IRMTV7MediaEvidenceVerifier} from "../src/interfaces/IRMTV7MediaEvidenceVerifier.sol";
import {RMTV7MediaEvidenceVerifier} from "../src/RMTV7MediaEvidenceVerifier.sol";
import {RMTV7ModuleRegistry} from "../src/RMTV7ModuleRegistry.sol";
import {RMTV7ReleaseRegistry} from "../src/RMTV7ReleaseRegistry.sol";

interface V7ReleaseFoundationVm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract V7GovernanceCaller {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory output) = target.call(data);
        require(success, "governance call failed");
        return output;
    }

    function tryExecute(address target, bytes calldata data) external returns (bool success) {
        (success,) = target.call(data);
    }
}

contract V7ReviewedModuleMock {
    bytes4 public immutable reviewedInterfaceId;
    bool public touched;

    constructor(bytes4 reviewedInterfaceId_) {
        reviewedInterfaceId = reviewedInterfaceId_;
    }

    function supportsInterface(bytes4 interfaceId) external view returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == reviewedInterfaceId;
    }

    function touch() external {
        touched = true;
    }
}

contract V7FakeModuleRegistry {
    function governance() external pure returns (address) {
        return address(0xBEEF);
    }
}

contract RMTV7ReleaseFoundationTest {
    V7ReleaseFoundationVm private constant vm =
        V7ReleaseFoundationVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes4 private constant COLLECTION_INTERFACE_ID = 0x80ac58cd;
    bytes4 private constant EDITION_INTERFACE_ID = 0xd9b67a26;
    uint256 private constant EVIDENCE_SIGNER_KEY = 0xA11CE;
    uint256 private constant NEXT_EVIDENCE_SIGNER_KEY = 0xB0B;
    address private constant OTHER_CREATOR = address(0xB0B);

    V7GovernanceCaller private governance;
    RMTV7ModuleRegistry private moduleRegistry;
    RMTV7MediaEvidenceVerifier private mediaEvidenceVerifier;
    RMTV7ReleaseRegistry private releaseRegistry;

    function setUp() public {
        governance = new V7GovernanceCaller();
        moduleRegistry = new RMTV7ModuleRegistry(address(governance));
        mediaEvidenceVerifier = new RMTV7MediaEvidenceVerifier(address(governance), vm.addr(EVIDENCE_SIGNER_KEY));
        releaseRegistry = new RMTV7ReleaseRegistry(address(moduleRegistry), address(mediaEvidenceVerifier));
    }

    function testModuleRegistrationIsGovernedVersionedAndCodePinned() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);

        (bool unauthorized,) = address(moduleRegistry)
            .call(
                abi.encodeCall(
                    moduleRegistry.registerModule,
                    (
                        moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                        1,
                        address(implementation),
                        COLLECTION_INTERFACE_ID,
                        keccak256("COLLECTION_POLICY_V1"),
                        keccak256("COLLECTION_METADATA_V1")
                    )
                )
            );
        require(!unauthorized, "non-governance registered module");

        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("COLLECTION_POLICY_V1"),
            keccak256("COLLECTION_METADATA_V1")
        );
        IRMTV7ModuleRegistry.Module memory module = moduleRegistry.getModule(moduleKey);
        require(module.implementation == address(implementation), "wrong implementation");
        require(module.implementationCodeHash == address(implementation).codehash, "code hash not pinned");
        require(module.active && module.registeredAt != 0, "module not active");
        require(
            moduleRegistry.moduleKeyByKindAndVersion(
                keccak256(abi.encode(moduleRegistry.MODULE_KIND_ERC721_COLLECTION(), uint32(1)))
            ) == moduleKey,
            "kind and version not canonical"
        );

        V7ReviewedModuleMock substitute = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bool duplicateAccepted = governance.tryExecute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                    1,
                    address(substitute),
                    COLLECTION_INTERFACE_ID,
                    keccak256("SUBSTITUTE_POLICY"),
                    keccak256("SUBSTITUTE_METADATA")
                )
            )
        );
        require(!duplicateAccepted, "module version overwritten");
    }

    function testModuleRegistrationRejectsNoCodeAndFalseInterfaceClaims() public {
        bool noCodeAccepted = governance.tryExecute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                    1,
                    address(0xCAFE),
                    COLLECTION_INTERFACE_ID,
                    keccak256("POLICY"),
                    keccak256("METADATA")
                )
            )
        );
        require(!noCodeAccepted, "implementation without code accepted");

        V7ReviewedModuleMock editionOnly = new V7ReviewedModuleMock(EDITION_INTERFACE_ID);
        bool falseInterfaceAccepted = governance.tryExecute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                    1,
                    address(editionOnly),
                    COLLECTION_INTERFACE_ID,
                    keccak256("POLICY"),
                    keccak256("METADATA")
                )
            )
        );
        require(!falseInterfaceAccepted, "unsupported interface accepted");
    }

    function testModuleDeactivationIsPermanentAndPreservesFingerprint() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );
        IRMTV7ModuleRegistry.Module memory beforeDeactivation = moduleRegistry.getModule(moduleKey);

        governance.execute(address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey)));
        IRMTV7ModuleRegistry.Module memory afterDeactivation = moduleRegistry.getModule(moduleKey);
        require(!afterDeactivation.active && afterDeactivation.deactivatedAt != 0, "module still active");
        require(
            afterDeactivation.implementationCodeHash == beforeDeactivation.implementationCodeHash, "history changed"
        );

        bool reDeactivated = governance.tryExecute(
            address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey))
        );
        require(!reDeactivated, "inactive module changed twice");
    }

    function testReleaseCommitmentIsCreatorOwnedImmutableAndNonceScoped() public {
        bytes32 firstReleaseId = _commitRelease();
        bytes32 secondReleaseId = _commitRelease();
        require(firstReleaseId != secondReleaseId, "creator nonce did not separate releases");
        require(releaseRegistry.creatorNonces(address(this)) == 2, "wrong next nonce");

        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(firstReleaseId);
        require(release.creator == address(this), "wrong creator");
        require(release.projectIdHash == keccak256("PROJECT"), "wrong project hash");
        require(release.rightsRevisionHash == keccak256("RIGHTS_REVISION"), "wrong rights hash");
        require(release.state == releaseRegistry.RELEASE_STATE_COMMITTED(), "wrong initial state");

        vm.prank(OTHER_CREATOR);
        (bool cancelledByOther,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.cancelRelease, (firstReleaseId)));
        require(!cancelledByOther, "noncreator cancelled release");
    }

    function testFreezeAtomicallyBindsCompleteActiveModulePlanWithoutCallingModule() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );
        bytes32 releaseId = _commitRelease();
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = _singleIntent(moduleKey);
        bytes32 expectedManifestHash = keccak256(abi.encode(intents));

        (IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence, bytes memory evidenceSignature) =
            _signedEvidence(releaseId, EVIDENCE_SIGNER_KEY);
        bytes32 manifestHash = releaseRegistry.freezeRelease(releaseId, intents, evidence, evidenceSignature);
        require(manifestHash == expectedManifestHash, "wrong module manifest hash");
        require(!implementation.touched(), "registered implementation was called");

        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(releaseId);
        require(release.state == releaseRegistry.RELEASE_STATE_FROZEN(), "release not frozen");
        require(release.moduleManifestHash == expectedManifestHash, "manifest not stored");
        require(release.mediaReceiptHash == evidence.receiptHash, "receipt evidence not stored");
        require(
            release.availabilityObservationHash == evidence.availabilityObservationHash,
            "availability evidence not stored"
        );
        require(
            release.mediaEvidenceHash == mediaEvidenceVerifier.hashEvidence(evidence), "evidence fingerprint not stored"
        );
        require(release.evidenceObservedAt == evidence.observedAt, "observation time not stored");
        require(release.evidenceValidUntil == evidence.validUntil, "evidence expiry not stored");
        require(release.evidenceSignerEpoch == evidence.signerEpoch, "evidence epoch not stored");
        require(release.frozenAt != 0, "freeze time missing");

        RMTV7ReleaseRegistry.ModuleIntent[] memory stored = releaseRegistry.getModuleIntents(releaseId);
        require(stored.length == 1, "wrong intent count");
        require(stored[0].moduleKey == moduleKey, "wrong stored module");
        require(stored[0].configurationHash == keccak256("CONFIGURATION"), "wrong configuration hash");

        (bool cancelledAfterFreeze,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.cancelRelease, (releaseId)));
        require(!cancelledAfterFreeze, "frozen release cancelled");
        require(!_tryFreeze(releaseId, intents), "release frozen twice");
    }

    function testFreezeRejectsInactiveDuplicateEmptyAndOversizedPlans() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );

        RMTV7ReleaseRegistry.ModuleIntent[] memory empty = new RMTV7ReleaseRegistry.ModuleIntent[](0);
        require(!_tryFreeze(_commitRelease(), empty), "empty module plan accepted");

        RMTV7ReleaseRegistry.ModuleIntent[] memory duplicate = new RMTV7ReleaseRegistry.ModuleIntent[](2);
        duplicate[0] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, keccak256("ONE"));
        duplicate[1] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, keccak256("TWO"));
        require(!_tryFreeze(_commitRelease(), duplicate), "duplicate module plan accepted");

        governance.execute(address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey)));
        require(!_tryFreeze(_commitRelease(), _singleIntent(moduleKey)), "inactive module accepted");

        RMTV7ReleaseRegistry.ModuleIntent[] memory oversized =
            new RMTV7ReleaseRegistry.ModuleIntent[](releaseRegistry.MAXIMUM_MODULES_PER_RELEASE() + 1);
        for (uint256 i; i < oversized.length; ++i) {
            oversized[i] = RMTV7ReleaseRegistry.ModuleIntent(bytes32(i + 1), bytes32(i + 100));
        }
        require(!_tryFreeze(_commitRelease(), oversized), "oversized module plan accepted");
    }

    function testCancelledReleasePreservesHistoryAndCannotFreeze() public {
        bytes32 releaseId = _commitRelease();
        releaseRegistry.cancelRelease(releaseId);
        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(releaseId);
        require(release.state == releaseRegistry.RELEASE_STATE_CANCELLED(), "release not cancelled");
        require(release.cancelledAt != 0, "cancel time missing");

        RMTV7ReleaseRegistry.ModuleIntent[] memory plan = new RMTV7ReleaseRegistry.ModuleIntent[](1);
        plan[0] = RMTV7ReleaseRegistry.ModuleIntent(keccak256("UNKNOWN"), keccak256("CONFIGURATION"));
        require(!_tryFreeze(releaseId, plan), "cancelled release frozen");
    }

    function testFreezeRejectsInvalidStaleExpiredAndFutureEvidence() public {
        vm.warp(10 days);
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = _singleIntent(moduleKey);

        bytes32 releaseId = _commitRelease();
        (IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence, bytes memory wrongSignature) =
            _signedEvidence(releaseId, NEXT_EVIDENCE_SIGNER_KEY);
        (bool wrongSignerAccepted,) = address(releaseRegistry)
            .call(abi.encodeCall(releaseRegistry.freezeRelease, (releaseId, intents, evidence, wrongSignature)));
        require(!wrongSignerAccepted, "wrong evidence signer accepted");

        bytes32 staleReleaseId = _commitRelease();
        evidence = _evidence();
        evidence.observedAt = uint64(block.timestamp - mediaEvidenceVerifier.MAXIMUM_OBSERVATION_AGE() - 1);
        evidence.validUntil = evidence.observedAt + mediaEvidenceVerifier.MAXIMUM_EVIDENCE_LIFETIME();
        bytes memory staleSignature = _signEvidence(staleReleaseId, evidence, EVIDENCE_SIGNER_KEY);
        (bool staleAccepted,) = address(releaseRegistry)
            .call(abi.encodeCall(releaseRegistry.freezeRelease, (staleReleaseId, intents, evidence, staleSignature)));
        require(!staleAccepted, "stale observation accepted");

        bytes32 expiredReleaseId = _commitRelease();
        evidence = _evidence();
        evidence.observedAt = uint64(block.timestamp - 2 hours);
        evidence.validUntil = uint64(block.timestamp - 1);
        bytes memory expiredSignature = _signEvidence(expiredReleaseId, evidence, EVIDENCE_SIGNER_KEY);
        (bool expiredAccepted,) = address(releaseRegistry)
            .call(
                abi.encodeCall(releaseRegistry.freezeRelease, (expiredReleaseId, intents, evidence, expiredSignature))
            );
        require(!expiredAccepted, "expired evidence accepted");

        bytes32 futureReleaseId = _commitRelease();
        evidence = _evidence();
        evidence.observedAt = uint64(block.timestamp + 1);
        bytes memory futureSignature = _signEvidence(futureReleaseId, evidence, EVIDENCE_SIGNER_KEY);
        (bool futureAccepted,) = address(releaseRegistry)
            .call(abi.encodeCall(releaseRegistry.freezeRelease, (futureReleaseId, intents, evidence, futureSignature)));
        require(!futureAccepted, "future observation accepted");
    }

    function testGovernedEvidenceSignerRotationInvalidatesOldEpoch() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );
        bytes32 releaseId = _commitRelease();
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = _singleIntent(moduleKey);
        (IRMTV7MediaEvidenceVerifier.MediaEvidence memory oldEvidence, bytes memory oldSignature) =
            _signedEvidence(releaseId, EVIDENCE_SIGNER_KEY);

        (bool outsiderRotated,) = address(mediaEvidenceVerifier)
            .call(abi.encodeCall(mediaEvidenceVerifier.rotateEvidenceSigner, (vm.addr(NEXT_EVIDENCE_SIGNER_KEY))));
        require(!outsiderRotated, "outsider rotated signer");
        governance.execute(
            address(mediaEvidenceVerifier),
            abi.encodeCall(mediaEvidenceVerifier.rotateEvidenceSigner, (vm.addr(NEXT_EVIDENCE_SIGNER_KEY)))
        );

        (bool oldAccepted,) = address(releaseRegistry)
            .call(abi.encodeCall(releaseRegistry.freezeRelease, (releaseId, intents, oldEvidence, oldSignature)));
        require(!oldAccepted, "old evidence epoch survived rotation");

        IRMTV7MediaEvidenceVerifier.MediaEvidence memory currentEvidence = _evidence();
        currentEvidence.signerEpoch = mediaEvidenceVerifier.signerEpoch();
        bytes memory currentSignature = _signEvidence(releaseId, currentEvidence, NEXT_EVIDENCE_SIGNER_KEY);
        releaseRegistry.freezeRelease(releaseId, intents, currentEvidence, currentSignature);
        require(
            releaseRegistry.getRelease(releaseId).evidenceSignerEpoch == currentEvidence.signerEpoch,
            "current evidence epoch not bound"
        );
    }

    function testMediaEvidenceHashMatchesPublicEncodingVector() public view {
        IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence = IRMTV7MediaEvidenceVerifier.MediaEvidence({
            receiptHash: bytes32(uint256(type(uint256).max) / 0xff * 0x11),
            availabilityObservationHash: bytes32(uint256(type(uint256).max) / 0xff * 0x22),
            observedAt: 1_785_283_200,
            validUntil: 1_785_286_800,
            signerEpoch: 1
        });
        require(
            mediaEvidenceVerifier.hashEvidence(evidence)
                == 0x8c97155382c77e182384b824fd6bace122b48e6f9b25178dba90612249bc18ef,
            "cross-layer evidence hash changed"
        );
    }

    function testContractsRejectNativeAssetCustody() public {
        vm.deal(address(this), 2 wei);
        (bool moduleReceived,) = address(moduleRegistry).call{value: 1 wei}("");
        (bool verifierReceived,) = address(mediaEvidenceVerifier).call{value: 1 wei}("");
        (bool releaseReceived,) = address(releaseRegistry).call{value: 1 wei}("");
        require(!moduleReceived && !verifierReceived && !releaseReceived, "registry accepted native assets");
        require(
            address(moduleRegistry).balance == 0 && address(mediaEvidenceVerifier).balance == 0
                && address(releaseRegistry).balance == 0,
            "registry retained funds"
        );
    }

    function testConstructorsRejectUntrustedShape() public {
        bytes memory moduleCreationCode =
            abi.encodePacked(type(RMTV7ModuleRegistry).creationCode, abi.encode(address(1)));
        address deployed;
        assembly ("memory-safe") {
            deployed := create(0, add(moduleCreationCode, 0x20), mload(moduleCreationCode))
        }
        require(deployed == address(0), "EOA governance accepted");

        bytes memory releaseCreationCode =
            abi.encodePacked(type(RMTV7ReleaseRegistry).creationCode, abi.encode(address(2), address(3)));
        assembly ("memory-safe") {
            deployed := create(0, add(releaseCreationCode, 0x20), mload(releaseCreationCode))
        }
        require(deployed == address(0), "module registry without code accepted");

        V7FakeModuleRegistry fakeRegistry = new V7FakeModuleRegistry();
        releaseCreationCode = abi.encodePacked(
            type(RMTV7ReleaseRegistry).creationCode, abi.encode(address(fakeRegistry), address(fakeRegistry))
        );
        assembly ("memory-safe") {
            deployed := create(0, add(releaseCreationCode, 0x20), mload(releaseCreationCode))
        }
        require(deployed == address(0), "registry with EOA governance accepted");
    }

    function _registerModule(
        uint8 kind,
        uint32 version,
        address implementation,
        bytes4 interfaceId,
        bytes32 policyHash,
        bytes32 metadataHash
    ) private returns (bytes32 moduleKey) {
        bytes memory output = governance.execute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule, (kind, version, implementation, interfaceId, policyHash, metadataHash)
            )
        );
        moduleKey = abi.decode(output, (bytes32));
    }

    function _commitRelease() private returns (bytes32 releaseId) {
        releaseId = releaseRegistry.commitRelease(
            keccak256("PROJECT"),
            keccak256("ASSET"),
            keccak256("RIGHTS_REVISION"),
            keccak256("METADATA"),
            keccak256("MEDIA_MANIFEST"),
            keccak256("FEE_POLICY"),
            keccak256("PAYOUT_MANIFEST")
        );
    }

    function _tryFreeze(bytes32 releaseId, RMTV7ReleaseRegistry.ModuleIntent[] memory intents)
        private
        returns (bool success)
    {
        (IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence, bytes memory evidenceSignature) =
            _signedEvidence(releaseId, EVIDENCE_SIGNER_KEY);
        (success,) = address(releaseRegistry)
            .call(abi.encodeCall(releaseRegistry.freezeRelease, (releaseId, intents, evidence, evidenceSignature)));
    }

    function _signedEvidence(bytes32 releaseId, uint256 privateKey)
        private
        returns (IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence, bytes memory signature)
    {
        evidence = _evidence();
        signature = _signEvidence(releaseId, evidence, privateKey);
    }

    function _evidence() private view returns (IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence) {
        evidence = IRMTV7MediaEvidenceVerifier.MediaEvidence({
            receiptHash: keccak256("VERIFIED_MEDIA_RECEIPT"),
            availabilityObservationHash: keccak256("HEALTHY_AVAILABILITY_OBSERVATION"),
            observedAt: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 days),
            signerEpoch: mediaEvidenceVerifier.signerEpoch()
        });
    }

    function _signEvidence(
        bytes32 releaseId,
        IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence,
        uint256 privateKey
    ) private returns (bytes memory signature) {
        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(releaseId);
        bytes32 digest = mediaEvidenceVerifier.evidenceDigest(
            address(releaseRegistry),
            releaseId,
            release.creator,
            release.metadataHash,
            release.mediaManifestHash,
            evidence
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _singleIntent(bytes32 moduleKey)
        private
        pure
        returns (RMTV7ReleaseRegistry.ModuleIntent[] memory intents)
    {
        intents = new RMTV7ReleaseRegistry.ModuleIntent[](1);
        intents[0] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, keccak256("CONFIGURATION"));
    }
}
