// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

interface CommodityEvidenceHardeningVm {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract RMTCommodityEvidenceRegistryV0HardeningTest {
    CommodityEvidenceHardeningVm private constant vm =
        CommodityEvidenceHardeningVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TARGET_CHAIN_ID = 46_630;
    uint256 private constant ISSUER_KEY = 0xA11CE;
    uint256 private constant CUSTODIAN_KEY = 0xB0B;
    uint256 private constant ATTESTOR_KEY = 0xC0DE;

    bytes32 private constant SCHEMA_HASH = keccak256("rmt.physical-commodity-evidence.v0.schema");
    bytes32 private constant INSTRUMENT_ID = keccak256("RMT-HE-DEMO-V0");
    bytes32 private constant SERIES_ID = keccak256("RMT-HE-COLORADO-SYNTHETIC-SERIES-V0");
    bytes32 private constant GOVERNING_INSTRUMENT_HASH = keccak256("RMT_SYNTHETIC_NO_RIGHTS_GOVERNING_TEXT_V0");
    bytes32 private constant ISSUER_PARTY_ID = keccak256("RMT-SYNTHETIC-ISSUER-0001");
    bytes32 private constant CUSTODIAN_PARTY_ID = keccak256("RMT-SYNTHETIC-CUSTODIAN-0001");
    bytes32 private constant ATTESTOR_PARTY_ID = keccak256("RMT-SYNTHETIC-ATTESTOR-0001");
    bytes32 private constant BATCH_ID = keccak256("SYNTHETIC-HE-BATCH-0001");
    bytes32 private constant PHYSICAL_LOT_KEY = keccak256("SYNTHETIC-HE-LOT-0001");
    bytes32 private constant REASON_CODE = keccak256("SYNTHETIC_TEST_REASON");
    bytes32 private constant SUPPORTING_MANIFEST_HASH = keccak256("SYNTHETIC_SUPPORTING_MANIFEST");
    bytes32 private constant SUPPORTING_URI_HASH = keccak256("urn:rmt:synthetic:supporting-manifest-v0");

    string private constant PUBLIC_MANIFEST_URI = "urn:rmt:synthetic:helium-public-manifest-v0";

    RMTCommodityEvidenceRegistryV0 private registry;
    address private issuer;
    address private custodian;
    address private attestor;

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        vm.warp(1_800_000_000);
        issuer = vm.addr(ISSUER_KEY);
        custodian = vm.addr(CUSTODIAN_KEY);
        attestor = vm.addr(ATTESTOR_KEY);

        registry = new RMTCommodityEvidenceRegistryV0(address(this));
        uint64 validFrom = uint64(block.timestamp);
        uint64 validUntil = uint64(block.timestamp + 365 days);
        registry.registerParty(ISSUER_PARTY_ID, issuer, registry.ROLE_ISSUER_BITMAP(), validFrom, validUntil);
        registry.registerParty(
            CUSTODIAN_PARTY_ID, custodian, registry.ROLE_CUSTODIAN_BITMAP(), validFrom, validUntil
        );
        registry.registerParty(ATTESTOR_PARTY_ID, attestor, registry.ROLE_ATTESTOR_BITMAP(), validFrom, validUntil);
        registry.configureInstrument(
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

    function testSuspendedHeadCannotBeReactivatedByPublishingNewVersion() public {
        bytes32 firstEvidenceId = _publish(_envelope(1, 1));
        registry.suspendEvidence(firstEvidenceId, REASON_CODE, SUPPORTING_MANIFEST_HASH, SUPPORTING_URI_HASH);

        require(!_trySignedPublish(_envelope(2, 2)), "suspended head was superseded");
        require(
            registry.latestVersionByBatchKey(registry.batchKeyFor(INSTRUMENT_ID, BATCH_ID)) == 1,
            "suspended batch head advanced"
        );
        require(
            registry.getEffectiveStatus(firstEvidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Suspended,
            "suspension lost"
        );
    }

    function testSupersededRecordCannotBeRelabeledClosed() public {
        bytes32 firstEvidenceId = _publish(_envelope(1, 1));
        _publish(_envelope(2, 2));

        (bool success,) = address(registry).call(
            abi.encodeWithSelector(
                registry.closeEvidence.selector,
                firstEvidenceId,
                REASON_CODE,
                SUPPORTING_MANIFEST_HASH,
                SUPPORTING_URI_HASH
            )
        );
        require(!success, "superseded record was relabeled closed");

        RMTCommodityEvidenceRegistryV0.EvidenceRecord memory firstRecord = registry.getEvidence(firstEvidenceId);
        require(
            firstRecord.storedStatus == RMTCommodityEvidenceRegistryV0.EvidenceStatus.Superseded,
            "supersession history changed"
        );
    }

    function testSupersessionPersistsReplacementSupportCommitments() public {
        bytes32 firstEvidenceId = _publish(_envelope(1, 1));
        RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory replacement = _envelope(2, 2);
        _publish(replacement);

        RMTCommodityEvidenceRegistryV0.EvidenceRecord memory firstRecord = registry.getEvidence(firstEvidenceId);
        require(
            firstRecord.statusReasonCode == registry.REASON_EVIDENCE_SUPERSEDED(),
            "supersession reason missing"
        );
        require(
            firstRecord.statusSupportingManifestHash == replacement.publicManifestHash,
            "replacement manifest commitment missing"
        );
        require(
            firstRecord.statusSupportingUriHash == replacement.publicManifestUriHash,
            "replacement URI commitment missing"
        );
    }

    function testDisputedHeadCanBeCorrectedByNewSignedEvidence() public {
        bytes32 firstEvidenceId = _publish(_envelope(1, 1));
        vm.prank(issuer);
        registry.disputeEvidence(firstEvidenceId, REASON_CODE, SUPPORTING_MANIFEST_HASH, SUPPORTING_URI_HASH);

        bytes32 secondEvidenceId = _publish(_envelope(2, 2));
        require(
            registry.getEffectiveStatus(firstEvidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Superseded,
            "disputed evidence was not superseded"
        );
        require(
            registry.getEffectiveStatus(secondEvidenceId) == RMTCommodityEvidenceRegistryV0.EffectiveStatus.Verified,
            "corrected evidence was not verified"
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
        envelope.publicManifestHash = keccak256(abi.encode("SYNTHETIC_PUBLIC_MANIFEST_BYTES", version));
        envelope.fullManifestHash = keccak256(abi.encode("SYNTHETIC_FULL_MANIFEST_BYTES", version));
        envelope.publicManifestUriHash = keccak256(bytes(PUBLIC_MANIFEST_URI));
        envelope.rightsVersionHash = registry.NO_RIGHTS_VERSION_HASH();
        envelope.transferPolicyHash = registry.NON_TRANSFERABLE_POLICY_HASH();
        envelope.measuredAt = uint64(block.timestamp);
        envelope.validFrom = uint64(block.timestamp);
        envelope.validUntil = uint64(block.timestamp + 1 days);
        envelope.nonce = nonce;
    }

    function _publish(RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope)
        private
        returns (bytes32 evidenceId)
    {
        (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        ) = _signAll(envelope);
        evidenceId = registry.publishEvidence(
            envelope, issuerSignature, custodianSignature, attestorSignature, PUBLIC_MANIFEST_URI
        );
    }

    function _trySignedPublish(RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope)
        private
        returns (bool success)
    {
        (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        ) = _signAll(envelope);
        (success,) = address(registry).call(
            abi.encodeWithSelector(
                registry.publishEvidence.selector,
                envelope,
                issuerSignature,
                custodianSignature,
                attestorSignature,
                PUBLIC_MANIFEST_URI
            )
        );
    }

    function _signAll(RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope)
        private
        returns (
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        )
    {
        bytes32 digest = registry.evidenceDigest(envelope);
        issuerSignature = _sign(ISSUER_KEY, registry.ROLE_ISSUER(), ISSUER_PARTY_ID, digest);
        custodianSignature = _sign(CUSTODIAN_KEY, registry.ROLE_CUSTODIAN(), CUSTODIAN_PARTY_ID, digest);
        attestorSignature = _sign(ATTESTOR_KEY, registry.ROLE_ATTESTOR(), ATTESTOR_PARTY_ID, digest);
    }

    function _sign(uint256 privateKey, bytes32 role, bytes32 partyId, bytes32 digest)
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
