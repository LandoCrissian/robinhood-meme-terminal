// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

interface CommodityEvidenceVm {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function readFile(string calldata path) external returns (string memory data);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract MockCommodityEvidenceERC1271Signer is IERC1271 {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(digest, signature) == owner ? MAGIC_VALUE : bytes4(0xffffffff);
    }
}

contract RMTCommodityEvidenceRegistryV0Test {
    CommodityEvidenceVm private constant vm =
        CommodityEvidenceVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TARGET_CHAIN_ID = 46_630;
    uint256 private constant ISSUER_KEY = 0xA11CE;
    uint256 private constant CUSTODIAN_KEY = 0xB0B;
    uint256 private constant ATTESTOR_KEY = 0xC0DE;
    uint256 private constant OUTSIDER_KEY = 0xD00D;

    bytes32 private constant SCHEMA_HASH = keccak256("rmt.physical-commodity-evidence.v0.schema");
    bytes32 private constant INSTRUMENT_ID = keccak256("RMT-HE-DEMO-V0");
    bytes32 private constant INSTRUMENT_TWO_ID = keccak256("RMT-HE-DEMO-TWO-V0");
    bytes32 private constant SERIES_ID = keccak256("RMT-HE-COLORADO-SYNTHETIC-SERIES-V0");
    bytes32 private constant SERIES_TWO_ID = keccak256("RMT-HE-COLORADO-SYNTHETIC-SERIES-TWO-V0");
    bytes32 private constant GOVERNING_INSTRUMENT_HASH = keccak256("RMT_SYNTHETIC_NO_RIGHTS_GOVERNING_TEXT_V0");
    bytes32 private constant ISSUER_PARTY_ID = keccak256("RMT-SYNTHETIC-ISSUER-0001");
    bytes32 private constant CUSTODIAN_PARTY_ID = keccak256("RMT-SYNTHETIC-CUSTODIAN-0001");
    bytes32 private constant ATTESTOR_PARTY_ID = keccak256("RMT-SYNTHETIC-ATTESTOR-0001");
    bytes32 private constant BATCH_ID = keccak256("SYNTHETIC-HE-BATCH-0001");
    bytes32 private constant BATCH_TWO_ID = keccak256("SYNTHETIC-HE-BATCH-0002");
    bytes32 private constant PHYSICAL_LOT_KEY = keccak256("SYNTHETIC-HE-LOT-0001");
    bytes32 private constant REASON_CODE = keccak256("SYNTHETIC_TEST_REASON");
    bytes32 private constant SUPPORTING_MANIFEST_HASH = keccak256("SYNTHETIC_SUPPORTING_MANIFEST");
    bytes32 private constant SUPPORTING_URI_HASH = keccak256("urn:rmt:synthetic:supporting-manifest-v0");

    string private constant PUBLIC_MANIFEST_URI = "urn:rmt:synthetic:helium-public-manifest-v0";
    string private constant PUBLIC_MANIFEST_PATH =
        "test/fixtures/commodity-evidence/synthetic-helium-public-manifest-v0.json";
    string private constant FULL_MANIFEST_PATH =
        "test/fixtures/commodity-evidence/synthetic-helium-full-manifest-v0.json";

    RMTCommodityEvidenceRegistryV0 private registry;
    address private issuer;
    address private custodian;
    address private attestor;
    address private outsider;
    bytes32 private publicManifestHash;
    bytes32 private fullManifestHash;

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        vm.warp(1_800_000_000);
        issuer = vm.addr(ISSUER_KEY);
        custodian = vm.addr(CUSTODIAN_KEY);
        attestor = vm.addr(ATTESTOR_KEY);
        outsider = vm.addr(OUTSIDER_KEY);
        publicManifestHash = keccak256(bytes(vm.readFile(PUBLIC_MANIFEST_PATH)));
        fullManifestHash = keccak256(bytes(vm.readFile(FULL_MANIFEST_PATH)));
        registry = _newConfiguredRegistry(attestor);
    }

    function testConstructorIsBoundToRobinhoodTestnet() public {
        vm.chainId(1);
        bytes memory creationCode = abi.encodePacked(
            type(RMTCommodityEvidenceRegistryV0).creationCode, abi.encode(address(this))
        );
        address deployed;
        assembly ("memory-safe") {
            deployed := create(0, add(creationCode, 0x20), mload(creationCode))
        }
        require(deployed == address(0), "registry deployed on wrong chain");
        vm.chainId(TARGET_CHAIN_ID);
    }

    function testValidPublicationCreatesVerifiedAppendOnlyRecord() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        bytes32 evidenceId = _publish(registry, envelope);
        RMTCommodityEvidenceRegistryV0.EvidenceRecord memory record = registry.getEvidence(evidenceId);

        require(record.digest == registry.evidenceDigest(envelope), "digest mismatch");
        require(record.envelope.evidenceVersion == 1, "version mismatch");
        require(record.storedStatus == RMTCommodityEvidenceRegistryV0.EvidenceStatus.Verified, "not verified");
        require(
            registry.getEffectiveStatus(evidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Verified,
            "effective status mismatch"
        );
        require(registry.evidenceIdAt(INSTRUMENT_ID, BATCH_ID, 1) == evidenceId, "lookup mismatch");
        require(
            registry.lotOwnerBatchKey(PHYSICAL_LOT_KEY) == registry.batchKeyFor(INSTRUMENT_ID, BATCH_ID),
            "lot not reserved"
        );
        require(address(registry).balance == 0, "value retained");
    }

    function testWrongIssuerSignerIsRejected() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        bytes32 digest = registry.evidenceDigest(envelope);
        RMTCommodityEvidenceRegistryV0.RoleSignature memory badIssuer =
            _roleSignature(OUTSIDER_KEY, registry.ROLE_ISSUER(), ISSUER_PARTY_ID, digest);
        RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature =
            _roleSignature(CUSTODIAN_KEY, registry.ROLE_CUSTODIAN(), CUSTODIAN_PARTY_ID, digest);
        RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature =
            _roleSignature(ATTESTOR_KEY, registry.ROLE_ATTESTOR(), ATTESTOR_PARTY_ID, digest);

        require(
            !_tryPublish(registry, envelope, badIssuer, custodianSignature, attestorSignature, PUBLIC_MANIFEST_URI),
            "wrong signer accepted"
        );
    }

    function testWrongRoleBindingIsRejected() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        bytes32 digest = registry.evidenceDigest(envelope);
        RMTCommodityEvidenceRegistryV0.RoleSignature memory wrongRole =
            _roleSignature(ISSUER_KEY, registry.ROLE_CUSTODIAN(), ISSUER_PARTY_ID, digest);
        RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature =
            _roleSignature(CUSTODIAN_KEY, registry.ROLE_CUSTODIAN(), CUSTODIAN_PARTY_ID, digest);
        RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature =
            _roleSignature(ATTESTOR_KEY, registry.ROLE_ATTESTOR(), ATTESTOR_PARTY_ID, digest);

        require(
            !_tryPublish(registry, envelope, wrongRole, custodianSignature, attestorSignature, PUBLIC_MANIFEST_URI),
            "wrong role accepted"
        );
    }

    function testSignaturesAreBoundToExactVerifyingContract() public {
        RMTCommodityEvidenceRegistryV0 secondRegistry = _newConfiguredRegistry(attestor);
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        ) = _signAll(registry, envelope);

        require(
            !_tryPublish(
                secondRegistry,
                envelope,
                issuerSignature,
                custodianSignature,
                attestorSignature,
                PUBLIC_MANIFEST_URI
            ),
            "cross-contract signature accepted"
        );
    }

    function testWriteOperationsFailWhenChainDomainChanges() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        ) = _signAll(registry, envelope);

        vm.chainId(TARGET_CHAIN_ID + 1);
        require(
            !_tryPublish(
                registry, envelope, issuerSignature, custodianSignature, attestorSignature, PUBLIC_MANIFEST_URI
            ),
            "wrong-chain write accepted"
        );
        vm.chainId(TARGET_CHAIN_ID);
    }

    function testReplayAndVersionReuseAreRejected() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        _publish(registry, envelope);
        require(!_trySignedPublish(registry, envelope), "replay accepted");
    }

    function testDuplicatePhysicalLotUnderAnotherInstrumentIsRejected() public {
        _publish(registry, _envelope(1, 1));
        registry.configureInstrument(
            INSTRUMENT_TWO_ID,
            SCHEMA_HASH,
            SERIES_TWO_ID,
            GOVERNING_INSTRUMENT_HASH,
            ISSUER_PARTY_ID,
            CUSTODIAN_PARTY_ID,
            ATTESTOR_PARTY_ID,
            7 days
        );

        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory duplicate = _envelope(1, 1);
        duplicate.instrumentId = INSTRUMENT_TWO_ID;
        duplicate.seriesId = SERIES_TWO_ID;
        duplicate.batchId = BATCH_TWO_ID;
        require(!_trySignedPublish(registry, duplicate), "duplicate lot accepted");
    }

    function testUnknownEncumbranceCannotBecomeVerified() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        envelope.encumbranceStatus = RMTCommodityEvidenceRegistryV0.EncumbranceStatus.Unknown;
        bytes32 evidenceId = _publish(registry, envelope);
        RMTCommodityEvidenceRegistryV0.EvidenceRecord memory record = registry.getEvidence(evidenceId);

        require(record.storedStatus == RMTCommodityEvidenceRegistryV0.EvidenceStatus.Proposed, "stored verified");
        require(
            registry.getEffectiveStatus(evidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Proposed,
            "displayed verified"
        );
    }

    function testFutureAndExpiredValidityAreRejected() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory futureEnvelope = _envelope(1, 1);
        futureEnvelope.validFrom = uint64(block.timestamp + 1);
        futureEnvelope.validUntil = uint64(block.timestamp + 1 days);
        require(!_trySignedPublish(registry, futureEnvelope), "future evidence accepted");

        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory expiredEnvelope = _envelope(1, 1);
        expiredEnvelope.validFrom = uint64(block.timestamp - 20);
        expiredEnvelope.validUntil = uint64(block.timestamp - 1);
        require(!_trySignedPublish(registry, expiredEnvelope), "expired evidence accepted");
    }

    function testVerifiedEvidenceAutomaticallyBecomesStale() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope = _envelope(1, 1);
        envelope.validUntil = uint64(block.timestamp + 10);
        bytes32 evidenceId = _publish(registry, envelope);
        vm.warp(block.timestamp + 11);
        require(
            registry.getEffectiveStatus(evidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Stale,
            "expired evidence remained verified"
        );
    }

    function testEvidencePartyCanDisputeAndAdministratorCanSuspend() public {
        bytes32 evidenceId = _publish(registry, _envelope(1, 1));
        vm.prank(issuer);
        registry.disputeEvidence(evidenceId, REASON_CODE, SUPPORTING_MANIFEST_HASH, SUPPORTING_URI_HASH);
        require(
            registry.getEffectiveStatus(evidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Disputed,
            "dispute missing"
        );

        registry.suspendEvidence(evidenceId, REASON_CODE, SUPPORTING_MANIFEST_HASH, SUPPORTING_URI_HASH);
        require(
            registry.getEffectiveStatus(evidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Suspended,
            "suspension missing"
        );
    }

    function testNewVersionSupersedesButDoesNotDeletePriorEvidence() public {
        bytes32 firstEvidenceId = _publish(registry, _envelope(1, 1001));
        bytes32 secondEvidenceId = _publish(registry, _envelope(2, 1002));
        RMTCommodityEvidenceRegistryV0.EvidenceRecord memory firstRecord = registry.getEvidence(firstEvidenceId);
        RMTCommodityEvidenceRegistryV0.EvidenceRecord memory secondRecord = registry.getEvidence(secondEvidenceId);

        require(
            firstRecord.storedStatus == RMTCommodityEvidenceRegistryV0.EvidenceStatus.Superseded,
            "prior record not superseded"
        );
        require(firstRecord.digest != bytes32(0), "prior record deleted");
        require(secondRecord.storedStatus == RMTCommodityEvidenceRegistryV0.EvidenceStatus.Verified, "head not verified");
        require(registry.evidenceIdAt(INSTRUMENT_ID, BATCH_ID, 1) == firstEvidenceId, "v1 lost");
        require(registry.evidenceIdAt(INSTRUMENT_ID, BATCH_ID, 2) == secondEvidenceId, "v2 lost");
    }

    function testClosedHeadCannotBeReactivatedByNewVersion() public {
        bytes32 evidenceId = _publish(registry, _envelope(1, 1));
        registry.closeEvidence(evidenceId, REASON_CODE, SUPPORTING_MANIFEST_HASH, SUPPORTING_URI_HASH);
        require(!_trySignedPublish(registry, _envelope(2, 2)), "closed chain reactivated");
    }

    function testERC1271AttestorIsSupported() public {
        MockCommodityEvidenceERC1271Signer contractSigner = new MockCommodityEvidenceERC1271Signer(attestor);
        RMTCommodityEvidenceRegistryV0 contractSignerRegistry = _newConfiguredRegistry(address(contractSigner));
        bytes32 evidenceId = _publish(contractSignerRegistry, _envelope(1, 1));
        require(
            contractSignerRegistry.getEffectiveStatus(evidenceId)
                == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Verified,
            "ERC-1271 rejected"
        );
    }

    function testDirectEthAndUnknownMintInterfaceAreRejected() public {
        vm.deal(address(this), 1 ether);
        (bool valueAccepted,) = address(registry).call{value: 1}("");
        require(!valueAccepted, "ETH accepted");

        (bool mintAccepted,) = address(registry).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        require(!mintAccepted, "mint interface accepted");
        require(address(registry).balance == 0, "ETH retained");
    }

    function testOnlyAdministratorCanSuspendEvidence() public {
        bytes32 evidenceId = _publish(registry, _envelope(1, 1));
        vm.prank(outsider);
        (bool success,) = address(registry).call(
            abi.encodeWithSelector(
                registry.suspendEvidence.selector,
                evidenceId,
                REASON_CODE,
                SUPPORTING_MANIFEST_HASH,
                SUPPORTING_URI_HASH
            )
        );
        require(!success, "outsider suspended evidence");
    }

    function testSuspendedQuorumCannotDisplayAsVerified() public {
        bytes32 evidenceId = _publish(registry, _envelope(1, 1));
        registry.setPartyStatus(
            ATTESTOR_PARTY_ID, RMTCommodityEvidenceRegistryV0.PartyStatus.Suspended, REASON_CODE
        );
        require(
            registry.getEffectiveStatus(evidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Suspended,
            "inactive quorum remained verified"
        );
    }

    function testInvalidCommitmentAndMismatchedUriAreRejected() public {
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory invalidEnvelope = _envelope(1, 1);
        invalidEnvelope.titleEvidenceHash = bytes32(0);
        require(!_trySignedPublish(registry, invalidEnvelope), "zero commitment accepted");

        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory validEnvelope = _envelope(1, 1);
        (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        ) = _signAll(registry, validEnvelope);
        require(
            !_tryPublish(
                registry,
                validEnvelope,
                issuerSignature,
                custodianSignature,
                attestorSignature,
                "urn:rmt:synthetic:wrong-manifest"
            ),
            "mismatched URI accepted"
        );
    }

    function testOneSigningAccountCannotMasqueradeAsMultipleParties() public {
        bytes32 duplicatePartyId = keccak256("RMT-SYNTHETIC-DUPLICATE-PARTY");
        (bool success,) = address(registry).call(
            abi.encodeWithSelector(
                registry.registerParty.selector,
                duplicatePartyId,
                issuer,
                registry.ROLE_ATTESTOR_BITMAP(),
                uint64(block.timestamp),
                uint64(block.timestamp + 365 days)
            )
        );
        require(!success, "signing account reused");
    }

    function _newConfiguredRegistry(address attestorSigningAccount)
        private
        returns (RMTCommodityEvidenceRegistryV0 configuredRegistry)
    {
        configuredRegistry = new RMTCommodityEvidenceRegistryV0(address(this));
        uint64 validFrom = uint64(block.timestamp);
        uint64 validUntil = uint64(block.timestamp + 365 days);
        configuredRegistry.registerParty(
            ISSUER_PARTY_ID, issuer, configuredRegistry.ROLE_ISSUER_BITMAP(), validFrom, validUntil
        );
        configuredRegistry.registerParty(
            CUSTODIAN_PARTY_ID, custodian, configuredRegistry.ROLE_CUSTODIAN_BITMAP(), validFrom, validUntil
        );
        configuredRegistry.registerParty(
            ATTESTOR_PARTY_ID,
            attestorSigningAccount,
            configuredRegistry.ROLE_ATTESTOR_BITMAP(),
            validFrom,
            validUntil
        );
        configuredRegistry.configureInstrument(
            INSTRUMENT_ID,
            SCHEMA_HASH,
            SERIES_ID,
            GOVERNING_INSTRUMENT_HASH,
            ISSUER_PARTY_ID,
            CUSTODIAN_PARTY_ID,
            ATTESTOR_PARTY_ID,
            7 days
        );
    }

    function _envelope(uint64 version, uint256 nonce)
        private
        view
        returns (RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope)
    {
        envelope.schemaHash = SCHEMA_HASH;
        envelope.instrumentId = INSTRUMENT_ID;
        envelope.seriesId = SERIES_ID;
        envelope.batchId = BATCH_ID;
        envelope.physicalLotKey = PHYSICAL_LOT_KEY;
        envelope.evidenceVersion = version;
        envelope.quantity = RMTCommodityEvidenceRegistryV0.QuantityClaim({
            value: 170_000,
            decimals: 0,
            unitCode: keccak256("SCF_SYNTHETIC"),
            quantityStandardHash: keccak256("SYNTHETIC_STANDARD_TEMPERATURE_PRESSURE_V0"),
            uncertaintyPpm: 2_500
        });
        envelope.commoditySpecHash = keccak256("SYNTHETIC_HELIUM_99_999_V0");
        envelope.publicRegionHash = keccak256("US-CO-SYNTHETIC");
        envelope.titleEvidenceHash = keccak256("SYNTHETIC-TITLE-COMMITMENT-0001");
        envelope.custodyEvidenceHash = keccak256("SYNTHETIC-CUSTODY-COMMITMENT-0001");
        envelope.qualityEvidenceHash = keccak256("SYNTHETIC-QUALITY-COMMITMENT-0001");
        envelope.calibrationEvidenceHash = keccak256("SYNTHETIC-CALIBRATION-COMMITMENT-0001");
        envelope.encumbranceStatementHash = keccak256("NOT_APPLICABLE_SYNTHETIC");
        envelope.encumbranceStatus = RMTCommodityEvidenceRegistryV0.EncumbranceStatus.NotApplicableSynthetic;
        envelope.publicManifestHash = publicManifestHash;
        envelope.fullManifestHash = fullManifestHash;
        envelope.publicManifestUriHash = keccak256(bytes(PUBLIC_MANIFEST_URI));
        envelope.rightsVersionHash = registry.NO_RIGHTS_VERSION_HASH();
        envelope.transferPolicyHash = registry.NON_TRANSFERABLE_POLICY_HASH();
        envelope.measuredAt = uint64(block.timestamp);
        envelope.validFrom = uint64(block.timestamp);
        envelope.validUntil = uint64(block.timestamp + 1 days);
        envelope.nonce = nonce;
    }

    function _publish(
        RMTCommodityEvidenceRegistryV0 target,
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope
    ) private returns (bytes32 evidenceId) {
        (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        ) = _signAll(target, envelope);
        evidenceId = target.publishEvidence(
            envelope, issuerSignature, custodianSignature, attestorSignature, PUBLIC_MANIFEST_URI
        );
    }

    function _trySignedPublish(
        RMTCommodityEvidenceRegistryV0 target,
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope
    ) private returns (bool) {
        (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        ) = _signAll(target, envelope);
        return _tryPublish(
            target, envelope, issuerSignature, custodianSignature, attestorSignature, PUBLIC_MANIFEST_URI
        );
    }

    function _tryPublish(
        RMTCommodityEvidenceRegistryV0 target,
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope,
        RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
        RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
        RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature,
        string memory publicManifestURI
    ) private returns (bool success) {
        (success,) = address(target).call(
            abi.encodeWithSelector(
                target.publishEvidence.selector,
                envelope,
                issuerSignature,
                custodianSignature,
                attestorSignature,
                publicManifestURI
            )
        );
    }

    function _signAll(
        RMTCommodityEvidenceRegistryV0 target,
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope
    )
        private
        returns (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        )
    {
        bytes32 digest = target.evidenceDigest(envelope);
        issuerSignature = _roleSignature(ISSUER_KEY, target.ROLE_ISSUER(), ISSUER_PARTY_ID, digest);
        custodianSignature =
            _roleSignature(CUSTODIAN_KEY, target.ROLE_CUSTODIAN(), CUSTODIAN_PARTY_ID, digest);
        attestorSignature = _roleSignature(ATTESTOR_KEY, target.ROLE_ATTESTOR(), ATTESTOR_PARTY_ID, digest);
    }

    function _roleSignature(uint256 privateKey, bytes32 role, bytes32 partyId, bytes32 digest)
        private
        returns (RMTCommodityEvidenceRegistryV0.RoleSignature memory roleSignature)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        roleSignature = RMTCommodityEvidenceRegistryV0.RoleSignature({
            role: role,
            partyId: partyId,
            signature: abi.encodePacked(r, s, v)
        });
    }
}
