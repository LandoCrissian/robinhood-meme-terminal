// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

interface CommodityEvidenceScriptVm {
    function addr(uint256 privateKey) external returns (address);
    function readFile(string calldata path) external returns (string memory data);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

/// @notice Read-only Foundry utility for building and signing the checked-in synthetic helium fixture.
/// @dev Contains public, test-only keys. It never broadcasts, deploys, publishes evidence, or reads production secrets.
contract BuildSyntheticCommodityEvidenceV0 {
    CommodityEvidenceScriptVm private constant vm =
        CommodityEvidenceScriptVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant SYNTHETIC_ISSUER_KEY = 0xA11CE;
    uint256 public constant SYNTHETIC_CUSTODIAN_KEY = 0xB0B;
    uint256 public constant SYNTHETIC_ATTESTOR_KEY = 0xC0DE;

    bytes32 public constant SCHEMA_HASH = keccak256("rmt.physical-commodity-evidence.v0.schema");
    bytes32 public constant INSTRUMENT_ID = keccak256("RMT-HE-DEMO-V0");
    bytes32 public constant SERIES_ID = keccak256("RMT-HE-COLORADO-SYNTHETIC-SERIES-V0");
    bytes32 public constant BATCH_ID = keccak256("SYNTHETIC-HE-BATCH-0001");
    bytes32 public constant PHYSICAL_LOT_KEY = keccak256("SYNTHETIC-HE-LOT-0001");
    bytes32 public constant ISSUER_PARTY_ID = keccak256("RMT-SYNTHETIC-ISSUER-0001");
    bytes32 public constant CUSTODIAN_PARTY_ID = keccak256("RMT-SYNTHETIC-CUSTODIAN-0001");
    bytes32 public constant ATTESTOR_PARTY_ID = keccak256("RMT-SYNTHETIC-ATTESTOR-0001");

    string public constant PUBLIC_MANIFEST_URI = "urn:rmt:synthetic:helium-public-manifest-v0";
    string private constant PUBLIC_MANIFEST_PATH =
        "test/fixtures/commodity-evidence/synthetic-helium-public-manifest-v0.json";
    string private constant FULL_MANIFEST_PATH =
        "test/fixtures/commodity-evidence/synthetic-helium-full-manifest-v0.json";

    event SyntheticEvidencePackageBuilt(
        address indexed registry,
        bytes32 indexed digest,
        bytes32 indexed instrumentId,
        bytes32 batchId,
        uint64 evidenceVersion,
        uint256 nonce,
        address issuer,
        address custodian,
        address attestor,
        bytes issuerSignature,
        bytes custodianSignature,
        bytes attestorSignature
    );

    error InvalidRegistry();
    error WrongChain(uint256 actual, uint256 expected);

    function run(address registryAddress)
        external
        returns (
            bytes32 digest,
            RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory issuerSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory custodianSignature,
            RMTCommodityEvidenceRegistryV0.RoleSignature memory attestorSignature
        )
    {
        if (registryAddress.code.length == 0) revert InvalidRegistry();
        RMTCommodityEvidenceRegistryV0 registry = RMTCommodityEvidenceRegistryV0(payable(registryAddress));
        uint256 targetChainId = registry.TARGET_CHAIN_ID();
        if (block.chainid != targetChainId) revert WrongChain(block.chainid, targetChainId);

        envelope = buildEnvelope(registry, uint64(block.timestamp), 1, 1);
        digest = registry.evidenceDigest(envelope);
        issuerSignature = _sign(SYNTHETIC_ISSUER_KEY, registry.ROLE_ISSUER(), ISSUER_PARTY_ID, digest);
        custodianSignature = _sign(SYNTHETIC_CUSTODIAN_KEY, registry.ROLE_CUSTODIAN(), CUSTODIAN_PARTY_ID, digest);
        attestorSignature = _sign(SYNTHETIC_ATTESTOR_KEY, registry.ROLE_ATTESTOR(), ATTESTOR_PARTY_ID, digest);

        emit SyntheticEvidencePackageBuilt(
            registryAddress,
            digest,
            envelope.instrumentId,
            envelope.batchId,
            envelope.evidenceVersion,
            envelope.nonce,
            vm.addr(SYNTHETIC_ISSUER_KEY),
            vm.addr(SYNTHETIC_CUSTODIAN_KEY),
            vm.addr(SYNTHETIC_ATTESTOR_KEY),
            issuerSignature.signature,
            custodianSignature.signature,
            attestorSignature.signature
        );
    }

    function buildEnvelope(
        RMTCommodityEvidenceRegistryV0 registry,
        uint64 measuredAt,
        uint64 evidenceVersion,
        uint256 nonce
    ) public returns (RMTCommodityEvidenceRegistryV0.EvidenceEnvelope memory envelope) {
        if (address(registry).code.length == 0 || measuredAt == 0 || evidenceVersion == 0 || nonce == 0) {
            revert InvalidRegistry();
        }

        envelope.schemaHash = SCHEMA_HASH;
        envelope.instrumentId = INSTRUMENT_ID;
        envelope.seriesId = SERIES_ID;
        envelope.batchId = BATCH_ID;
        envelope.physicalLotKey = PHYSICAL_LOT_KEY;
        envelope.evidenceVersion = evidenceVersion;
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
        envelope.publicManifestHash = keccak256(bytes(vm.readFile(PUBLIC_MANIFEST_PATH)));
        envelope.fullManifestHash = keccak256(bytes(vm.readFile(FULL_MANIFEST_PATH)));
        envelope.publicManifestUriHash = keccak256(bytes(PUBLIC_MANIFEST_URI));
        envelope.rightsVersionHash = registry.NO_RIGHTS_VERSION_HASH();
        envelope.transferPolicyHash = registry.NON_TRANSFERABLE_POLICY_HASH();
        envelope.measuredAt = measuredAt;
        envelope.validFrom = measuredAt;
        envelope.validUntil = measuredAt + 1 days;
        envelope.nonce = nonce;
    }

    function syntheticParties() external returns (address issuer, address custodian, address attestor) {
        issuer = vm.addr(SYNTHETIC_ISSUER_KEY);
        custodian = vm.addr(SYNTHETIC_CUSTODIAN_KEY);
        attestor = vm.addr(SYNTHETIC_ATTESTOR_KEY);
    }

    function _sign(uint256 privateKey, bytes32 role, bytes32 partyId, bytes32 digest)
        private
        returns (RMTCommodityEvidenceRegistryV0.RoleSignature memory roleSignature)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        roleSignature = RMTCommodityEvidenceRegistryV0.RoleSignature({
            role: role, partyId: partyId, signature: abi.encodePacked(r, s, v)
        });
    }
}
