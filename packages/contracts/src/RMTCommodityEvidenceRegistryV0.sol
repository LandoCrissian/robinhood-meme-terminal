// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Synthetic-only, append-only evidence registry for a physical-commodity testnet demonstration.
/// @dev Creates no token, commodity entitlement, price, custody right, transfer right, mint authority,
/// fee, treasury relationship, or RMT-token right. Permanently bound to Robinhood Chain testnet.
contract RMTCommodityEvidenceRegistryV0 is EIP712, ReentrancyGuard {
    uint256 public constant TARGET_CHAIN_ID = 46_630;
    bool public constant SYNTHETIC_ONLY = true;
    uint64 public constant MAX_ALLOWED_VALIDITY = 30 days;
    uint64 public constant MAX_PUBLICATION_BACKDATE = 1 days;

    bytes32 public constant SYNTHETIC_NAMESPACE = keccak256("RMT_SYNTHETIC_COMMODITY_EVIDENCE_V0");
    bytes32 public constant ROLE_ISSUER = keccak256("ISSUER");
    bytes32 public constant ROLE_CUSTODIAN = keccak256("CUSTODIAN");
    bytes32 public constant ROLE_ATTESTOR = keccak256("ATTESTOR");
    bytes32 public constant NO_RIGHTS_VERSION_HASH = keccak256("RMT_SYNTHETIC_NO_RIGHTS_V0");
    bytes32 public constant NON_TRANSFERABLE_POLICY_HASH = keccak256("RMT_SYNTHETIC_NON_TRANSFERABLE_V0");
    bytes32 public constant REASON_EVIDENCE_SUPERSEDED = keccak256("EVIDENCE_SUPERSEDED");

    uint256 public constant ROLE_ISSUER_BITMAP = 1 << 0;
    uint256 public constant ROLE_CUSTODIAN_BITMAP = 1 << 1;
    uint256 public constant ROLE_ATTESTOR_BITMAP = 1 << 2;
    uint256 private constant ALL_ROLE_BITMAPS = ROLE_ISSUER_BITMAP | ROLE_CUSTODIAN_BITMAP | ROLE_ATTESTOR_BITMAP;

    bytes32 public constant QUANTITY_CLAIM_TYPEHASH = keccak256(
        "QuantityClaim(uint256 value,uint8 decimals,bytes32 unitCode,bytes32 quantityStandardHash,uint32 uncertaintyPpm)"
    );
    bytes32 public constant EVIDENCE_ENVELOPE_TYPEHASH = keccak256(
        "EvidenceEnvelope(bytes32 schemaHash,bytes32 instrumentId,bytes32 seriesId,bytes32 batchId,bytes32 physicalLotKey,uint64 evidenceVersion,QuantityClaim quantity,bytes32 commoditySpecHash,bytes32 publicRegionHash,bytes32 titleEvidenceHash,bytes32 custodyEvidenceHash,bytes32 qualityEvidenceHash,bytes32 calibrationEvidenceHash,bytes32 encumbranceStatementHash,uint8 encumbranceStatus,bytes32 publicManifestHash,bytes32 fullManifestHash,bytes32 publicManifestUriHash,bytes32 rightsVersionHash,bytes32 transferPolicyHash,uint64 measuredAt,uint64 validFrom,uint64 validUntil,uint256 nonce)QuantityClaim(uint256 value,uint8 decimals,bytes32 unitCode,bytes32 quantityStandardHash,uint32 uncertaintyPpm)"
    );
    bytes32 private constant EVIDENCE_ID_DOMAIN = keccak256("RMT_COMMODITY_EVIDENCE_ID_V0");

    enum PartyStatus {
        Unregistered,
        Active,
        Suspended,
        Revoked,
        Expired
    }

    enum EvidenceStatus {
        None,
        Proposed,
        Verified,
        Disputed,
        Suspended,
        Closed,
        Superseded
    }

    enum EffectiveStatus {
        None,
        Proposed,
        Verified,
        Stale,
        Disputed,
        Suspended,
        Closed,
        Superseded
    }

    enum EncumbranceStatus {
        Unknown,
        ClearWithinStatedScope,
        OfftakeCommitted,
        PledgedOrLiened,
        PriorSaleOrAssignment,
        PriorTokenization,
        Disputed,
        NotApplicableSynthetic
    }

    struct Party {
        address signingAccount;
        uint64 keyVersion;
        uint64 validFrom;
        uint64 validUntil;
        uint256 roleBitmap;
        PartyStatus status;
    }

    struct InstrumentConfig {
        bytes32 schemaHash;
        bytes32 seriesId;
        bytes32 governingInstrumentHash;
        bytes32 issuerPartyId;
        bytes32 custodianPartyId;
        bytes32 attestorPartyId;
        uint64 maxValidityDuration;
        bool configured;
    }

    struct QuantityClaim {
        uint256 value;
        uint8 decimals;
        bytes32 unitCode;
        bytes32 quantityStandardHash;
        uint32 uncertaintyPpm;
    }

    struct EvidenceEnvelope {
        bytes32 schemaHash;
        bytes32 instrumentId;
        bytes32 seriesId;
        bytes32 batchId;
        bytes32 physicalLotKey;
        uint64 evidenceVersion;
        QuantityClaim quantity;
        bytes32 commoditySpecHash;
        bytes32 publicRegionHash;
        bytes32 titleEvidenceHash;
        bytes32 custodyEvidenceHash;
        bytes32 qualityEvidenceHash;
        bytes32 calibrationEvidenceHash;
        bytes32 encumbranceStatementHash;
        EncumbranceStatus encumbranceStatus;
        bytes32 publicManifestHash;
        bytes32 fullManifestHash;
        bytes32 publicManifestUriHash;
        bytes32 rightsVersionHash;
        bytes32 transferPolicyHash;
        uint64 measuredAt;
        uint64 validFrom;
        uint64 validUntil;
        uint256 nonce;
    }

    struct RoleSignature {
        bytes32 role;
        bytes32 partyId;
        bytes signature;
    }

    struct EvidenceRecord {
        EvidenceEnvelope envelope;
        bytes32 digest;
        EvidenceStatus storedStatus;
        bytes32 statusReasonCode;
        bytes32 statusSupportingManifestHash;
        bytes32 statusSupportingUriHash;
        uint64 publishedAt;
        address publisher;
        string publicManifestURI;
    }

    address public immutable administrator;

    mapping(bytes32 partyId => Party party) private _parties;
    mapping(address signingAccount => bytes32 partyId) public partyBySigningAccount;
    mapping(bytes32 instrumentId => InstrumentConfig config) private _instruments;
    mapping(bytes32 evidenceId => EvidenceRecord record) private _evidence;
    mapping(bytes32 batchKey => mapping(uint64 evidenceVersion => bytes32 evidenceId)) private _evidenceIdByVersion;

    mapping(bytes32 batchKey => uint64 evidenceVersion) public latestVersionByBatchKey;
    mapping(bytes32 batchKey => uint256 nonce) public latestNonceByBatchKey;
    mapping(bytes32 physicalLotKey => bytes32 batchKey) public lotOwnerBatchKey;
    mapping(bytes32 digest => bool consumed) public consumedDigest;

    event PartyRegistered(
        bytes32 indexed partyId,
        address indexed signingAccount,
        uint64 keyVersion,
        uint256 roleBitmap,
        uint64 validFrom,
        uint64 validUntil
    );
    event PartyStatusChanged(
        bytes32 indexed partyId,
        PartyStatus previousStatus,
        PartyStatus newStatus,
        bytes32 reasonCode
    );
    event InstrumentConfigured(
        bytes32 indexed instrumentId,
        bytes32 indexed schemaHash,
        bytes32 indexed seriesId,
        bytes32 governingInstrumentHash,
        bytes32 issuerPartyId,
        bytes32 custodianPartyId,
        bytes32 attestorPartyId,
        uint64 maxValidityDuration
    );
    event EvidencePublished(
        bytes32 indexed evidenceId,
        bytes32 indexed instrumentId,
        bytes32 indexed batchId,
        bytes32 physicalLotKey,
        uint64 evidenceVersion,
        bytes32 digest,
        bytes32 publicManifestHash,
        bytes32 fullManifestHash,
        EvidenceStatus storedStatus,
        uint64 validFrom,
        uint64 validUntil,
        address publisher
    );
    event EvidenceStatusChanged(
        bytes32 indexed evidenceId,
        EvidenceStatus previousStatus,
        EvidenceStatus newStatus,
        bytes32 reasonCode,
        bytes32 supportingManifestHash,
        bytes32 supportingUriHash,
        address reporter
    );
    event EvidenceSuperseded(
        bytes32 indexed previousEvidenceId,
        bytes32 indexed newEvidenceId,
        bytes32 indexed batchKey,
        uint64 previousVersion,
        uint64 newVersion
    );

    error WrongChain(uint256 actual, uint256 expected);
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidParty();
    error InvalidPartyStatus();
    error InvalidInstrument();
    error InvalidEnvelope();
    error InvalidValidityWindow();
    error InvalidVersion(uint64 actual, uint64 expected);
    error InvalidNonce();
    error InvalidRoleSignature();
    error InvalidSigner(bytes32 partyId);
    error DigestAlreadyConsumed();
    error DuplicatePhysicalLot(bytes32 physicalLotKey, bytes32 existingBatchKey);
    error EvidenceNotFound();
    error InvalidStatusTransition();
    error DirectValueRejected();

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier onlyTargetChain() {
        _requireTargetChain();
        _;
    }

    constructor(address administrator_) EIP712("RMTCommodityEvidenceRegistryV0", "0") {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid, TARGET_CHAIN_ID);
        if (administrator_ == address(0)) revert InvalidConfiguration();
        administrator = administrator_;
    }

    function registerParty(
        bytes32 partyId,
        address signingAccount,
        uint256 roleBitmap,
        uint64 validFrom,
        uint64 validUntil
    ) external onlyAdministrator onlyTargetChain {
        if (
            partyId == bytes32(0) || signingAccount == address(0) || roleBitmap == 0
                || (roleBitmap & ~ALL_ROLE_BITMAPS) != 0 || validFrom > block.timestamp
                || validUntil <= block.timestamp || validUntil <= validFrom
                || _parties[partyId].status != PartyStatus.Unregistered
                || partyBySigningAccount[signingAccount] != bytes32(0)
        ) revert InvalidParty();

        _parties[partyId] = Party({
            signingAccount: signingAccount,
            keyVersion: 1,
            validFrom: validFrom,
            validUntil: validUntil,
            roleBitmap: roleBitmap,
            status: PartyStatus.Active
        });
        partyBySigningAccount[signingAccount] = partyId;
        emit PartyRegistered(partyId, signingAccount, 1, roleBitmap, validFrom, validUntil);
    }

    function setPartyStatus(bytes32 partyId, PartyStatus newStatus, bytes32 reasonCode)
        external
        onlyAdministrator
        onlyTargetChain
    {
        Party storage party = _parties[partyId];
        PartyStatus previousStatus = party.status;
        if (reasonCode == bytes32(0)) revert InvalidPartyStatus();
        if (newStatus != PartyStatus.Suspended && newStatus != PartyStatus.Revoked) revert InvalidPartyStatus();
        if (
            previousStatus != PartyStatus.Active
                && !(previousStatus == PartyStatus.Suspended && newStatus == PartyStatus.Revoked)
        ) revert InvalidPartyStatus();

        party.status = newStatus;
        emit PartyStatusChanged(partyId, previousStatus, newStatus, reasonCode);
    }

    function configureInstrument(
        bytes32 instrumentId,
        bytes32 schemaHash,
        bytes32 seriesId,
        bytes32 governingInstrumentHash,
        bytes32 issuerPartyId,
        bytes32 custodianPartyId,
        bytes32 attestorPartyId,
        uint64 maxValidityDuration
    ) external onlyAdministrator onlyTargetChain {
        if (
            instrumentId == bytes32(0) || schemaHash == bytes32(0) || seriesId == bytes32(0)
                || governingInstrumentHash == bytes32(0) || issuerPartyId == bytes32(0)
                || custodianPartyId == bytes32(0) || attestorPartyId == bytes32(0)
                || issuerPartyId == custodianPartyId || issuerPartyId == attestorPartyId
                || custodianPartyId == attestorPartyId || maxValidityDuration == 0
                || maxValidityDuration > MAX_ALLOWED_VALIDITY || _instruments[instrumentId].configured
        ) revert InvalidInstrument();

        _requireActivePartyWithRole(issuerPartyId, ROLE_ISSUER_BITMAP);
        _requireActivePartyWithRole(custodianPartyId, ROLE_CUSTODIAN_BITMAP);
        _requireActivePartyWithRole(attestorPartyId, ROLE_ATTESTOR_BITMAP);

        _instruments[instrumentId] = InstrumentConfig({
            schemaHash: schemaHash,
            seriesId: seriesId,
            governingInstrumentHash: governingInstrumentHash,
            issuerPartyId: issuerPartyId,
            custodianPartyId: custodianPartyId,
            attestorPartyId: attestorPartyId,
            maxValidityDuration: maxValidityDuration,
            configured: true
        });
        emit InstrumentConfigured(
            instrumentId,
            schemaHash,
            seriesId,
            governingInstrumentHash,
            issuerPartyId,
            custodianPartyId,
            attestorPartyId,
            maxValidityDuration
        );
    }

    function publishEvidence(
        EvidenceEnvelope calldata envelope,
        RoleSignature calldata issuerSignature,
        RoleSignature calldata custodianSignature,
        RoleSignature calldata attestorSignature,
        string calldata contentAddressedPublicManifestURI
    ) external nonReentrant onlyTargetChain returns (bytes32 evidenceId) {
        InstrumentConfig storage instrument = _instruments[envelope.instrumentId];
        _validateEnvelope(envelope, instrument, contentAddressedPublicManifestURI);

        bytes32 batchKey = batchKeyFor(envelope.instrumentId, envelope.batchId);
        uint64 expectedVersion = latestVersionByBatchKey[batchKey] + 1;
        if (envelope.evidenceVersion != expectedVersion) {
            revert InvalidVersion(envelope.evidenceVersion, expectedVersion);
        }
        if (envelope.nonce <= latestNonceByBatchKey[batchKey]) revert InvalidNonce();

        bytes32 existingBatchKey = lotOwnerBatchKey[envelope.physicalLotKey];
        if (existingBatchKey != bytes32(0) && existingBatchKey != batchKey) {
            revert DuplicatePhysicalLot(envelope.physicalLotKey, existingBatchKey);
        }

        bytes32 previousEvidenceId;
        if (envelope.evidenceVersion > 1) {
            previousEvidenceId = _evidenceIdByVersion[batchKey][envelope.evidenceVersion - 1];
            EvidenceStatus previousStoredStatus = _evidence[previousEvidenceId].storedStatus;
            if (
                previousEvidenceId == bytes32(0) || previousStoredStatus == EvidenceStatus.Closed
                    || previousStoredStatus == EvidenceStatus.Superseded
            ) revert InvalidStatusTransition();
        }

        bytes32 digest = evidenceDigest(envelope);
        if (consumedDigest[digest]) revert DigestAlreadyConsumed();
        _validateRoleSignature(
            issuerSignature, ROLE_ISSUER, instrument.issuerPartyId, ROLE_ISSUER_BITMAP, digest
        );
        _validateRoleSignature(
            custodianSignature, ROLE_CUSTODIAN, instrument.custodianPartyId, ROLE_CUSTODIAN_BITMAP, digest
        );
        _validateRoleSignature(
            attestorSignature, ROLE_ATTESTOR, instrument.attestorPartyId, ROLE_ATTESTOR_BITMAP, digest
        );

        evidenceId = keccak256(abi.encode(EVIDENCE_ID_DOMAIN, digest));
        if (_evidence[evidenceId].digest != bytes32(0)) revert DigestAlreadyConsumed();

        EvidenceStatus initialStatus = envelope.encumbranceStatus == EncumbranceStatus.NotApplicableSynthetic
            ? EvidenceStatus.Verified
            : EvidenceStatus.Proposed;

        EvidenceRecord storage record = _evidence[evidenceId];
        record.envelope = envelope;
        record.digest = digest;
        record.storedStatus = initialStatus;
        record.publishedAt = uint64(block.timestamp);
        record.publisher = msg.sender;
        record.publicManifestURI = contentAddressedPublicManifestURI;

        consumedDigest[digest] = true;
        latestVersionByBatchKey[batchKey] = envelope.evidenceVersion;
        latestNonceByBatchKey[batchKey] = envelope.nonce;
        _evidenceIdByVersion[batchKey][envelope.evidenceVersion] = evidenceId;
        if (existingBatchKey == bytes32(0)) lotOwnerBatchKey[envelope.physicalLotKey] = batchKey;

        if (previousEvidenceId != bytes32(0)) {
            EvidenceRecord storage previousRecord = _evidence[previousEvidenceId];
            EvidenceStatus previousStatus = previousRecord.storedStatus;
            previousRecord.storedStatus = EvidenceStatus.Superseded;
            previousRecord.statusReasonCode = REASON_EVIDENCE_SUPERSEDED;
            emit EvidenceStatusChanged(
                previousEvidenceId,
                previousStatus,
                EvidenceStatus.Superseded,
                REASON_EVIDENCE_SUPERSEDED,
                envelope.publicManifestHash,
                envelope.publicManifestUriHash,
                msg.sender
            );
            emit EvidenceSuperseded(
                previousEvidenceId,
                evidenceId,
                batchKey,
                envelope.evidenceVersion - 1,
                envelope.evidenceVersion
            );
        }

        emit EvidencePublished(
            evidenceId,
            envelope.instrumentId,
            envelope.batchId,
            envelope.physicalLotKey,
            envelope.evidenceVersion,
            digest,
            envelope.publicManifestHash,
            envelope.fullManifestHash,
            initialStatus,
            envelope.validFrom,
            envelope.validUntil,
            msg.sender
        );
    }

    function disputeEvidence(
        bytes32 evidenceId,
        bytes32 reasonCode,
        bytes32 supportingManifestHash,
        bytes32 supportingUriHash
    ) external onlyTargetChain {
        EvidenceRecord storage record = _evidence[evidenceId];
        if (record.digest == bytes32(0)) revert EvidenceNotFound();
        if (!_isAdministratorOrEvidenceParty(record.envelope.instrumentId, msg.sender)) revert Unauthorized();
        if (
            record.storedStatus != EvidenceStatus.Verified || reasonCode == bytes32(0)
                || supportingManifestHash == bytes32(0) || supportingUriHash == bytes32(0)
        ) revert InvalidStatusTransition();
        _changeEvidenceStatus(
            evidenceId,
            record,
            EvidenceStatus.Disputed,
            reasonCode,
            supportingManifestHash,
            supportingUriHash
        );
    }

    function suspendEvidence(
        bytes32 evidenceId,
        bytes32 reasonCode,
        bytes32 supportingManifestHash,
        bytes32 supportingUriHash
    ) external onlyAdministrator onlyTargetChain {
        EvidenceRecord storage record = _evidence[evidenceId];
        if (record.digest == bytes32(0)) revert EvidenceNotFound();
        if (
            record.storedStatus != EvidenceStatus.Proposed && record.storedStatus != EvidenceStatus.Verified
                && record.storedStatus != EvidenceStatus.Disputed
        ) revert InvalidStatusTransition();
        if (reasonCode == bytes32(0)) revert InvalidStatusTransition();
        _changeEvidenceStatus(
            evidenceId,
            record,
            EvidenceStatus.Suspended,
            reasonCode,
            supportingManifestHash,
            supportingUriHash
        );
    }

    function closeEvidence(
        bytes32 evidenceId,
        bytes32 reasonCode,
        bytes32 supportingManifestHash,
        bytes32 supportingUriHash
    ) external onlyAdministrator onlyTargetChain {
        EvidenceRecord storage record = _evidence[evidenceId];
        if (record.digest == bytes32(0)) revert EvidenceNotFound();
        if (record.storedStatus == EvidenceStatus.Closed || reasonCode == bytes32(0)) {
            revert InvalidStatusTransition();
        }
        _changeEvidenceStatus(
            evidenceId,
            record,
            EvidenceStatus.Closed,
            reasonCode,
            supportingManifestHash,
            supportingUriHash
        );
    }

    function evidenceDigest(EvidenceEnvelope memory envelope) public view returns (bytes32) {
        bytes32 quantityHash = keccak256(
            abi.encode(
                QUANTITY_CLAIM_TYPEHASH,
                envelope.quantity.value,
                envelope.quantity.decimals,
                envelope.quantity.unitCode,
                envelope.quantity.quantityStandardHash,
                envelope.quantity.uncertaintyPpm
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                EVIDENCE_ENVELOPE_TYPEHASH,
                envelope.schemaHash,
                envelope.instrumentId,
                envelope.seriesId,
                envelope.batchId,
                envelope.physicalLotKey,
                envelope.evidenceVersion,
                quantityHash,
                envelope.commoditySpecHash,
                envelope.publicRegionHash,
                envelope.titleEvidenceHash,
                envelope.custodyEvidenceHash,
                envelope.qualityEvidenceHash,
                envelope.calibrationEvidenceHash,
                envelope.encumbranceStatementHash,
                uint8(envelope.encumbranceStatus),
                envelope.publicManifestHash,
                envelope.fullManifestHash,
                envelope.publicManifestUriHash,
                envelope.rightsVersionHash,
                envelope.transferPolicyHash,
                envelope.measuredAt,
                envelope.validFrom,
                envelope.validUntil,
                envelope.nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function batchKeyFor(bytes32 instrumentId, bytes32 batchId) public pure returns (bytes32) {
        return keccak256(abi.encode(SYNTHETIC_NAMESPACE, instrumentId, batchId));
    }

    function evidenceIdAt(bytes32 instrumentId, bytes32 batchId, uint64 evidenceVersion)
        external
        view
        returns (bytes32)
    {
        return _evidenceIdByVersion[batchKeyFor(instrumentId, batchId)][evidenceVersion];
    }

    function getParty(bytes32 partyId) external view returns (Party memory) {
        return _parties[partyId];
    }

    function getInstrument(bytes32 instrumentId) external view returns (InstrumentConfig memory) {
        return _instruments[instrumentId];
    }

    function getEvidence(bytes32 evidenceId) external view returns (EvidenceRecord memory) {
        EvidenceRecord memory record = _evidence[evidenceId];
        if (record.digest == bytes32(0)) revert EvidenceNotFound();
        return record;
    }

    function effectivePartyStatus(bytes32 partyId) public view returns (PartyStatus) {
        Party memory party = _parties[partyId];
        if (party.status != PartyStatus.Active) return party.status;
        if (block.timestamp < party.validFrom || block.timestamp > party.validUntil) return PartyStatus.Expired;
        return PartyStatus.Active;
    }

    function getEffectiveStatus(bytes32 evidenceId) public view returns (EffectiveStatus) {
        EvidenceRecord storage record = _evidence[evidenceId];
        if (record.digest == bytes32(0)) return EffectiveStatus.None;
        if (record.storedStatus == EvidenceStatus.Closed) return EffectiveStatus.Closed;
        if (record.storedStatus == EvidenceStatus.Suspended) return EffectiveStatus.Suspended;
        if (record.storedStatus == EvidenceStatus.Disputed) return EffectiveStatus.Disputed;
        if (record.storedStatus == EvidenceStatus.Superseded) return EffectiveStatus.Superseded;
        if (!_currentQuorumActive(record.envelope.instrumentId)) return EffectiveStatus.Suspended;
        if (block.timestamp > record.envelope.validUntil) return EffectiveStatus.Stale;
        if (block.timestamp < record.envelope.validFrom) return EffectiveStatus.Proposed;
        if (record.storedStatus == EvidenceStatus.Verified) return EffectiveStatus.Verified;
        return EffectiveStatus.Proposed;
    }

    function getStatusDetails(bytes32 evidenceId)
        external
        view
        returns (EvidenceStatus storedStatus, EffectiveStatus effectiveStatus, bool stale, bool currentQuorumActive)
    {
        EvidenceRecord storage record = _evidence[evidenceId];
        if (record.digest == bytes32(0)) revert EvidenceNotFound();
        storedStatus = record.storedStatus;
        effectiveStatus = getEffectiveStatus(evidenceId);
        stale = block.timestamp > record.envelope.validUntil;
        currentQuorumActive = _currentQuorumActive(record.envelope.instrumentId);
    }

    function _validateEnvelope(
        EvidenceEnvelope calldata envelope,
        InstrumentConfig storage instrument,
        string calldata publicManifestURI
    ) private view {
        if (!instrument.configured) revert InvalidInstrument();
        if (
            envelope.schemaHash != instrument.schemaHash || envelope.seriesId != instrument.seriesId
                || envelope.batchId == bytes32(0) || envelope.physicalLotKey == bytes32(0)
                || envelope.evidenceVersion == 0 || envelope.commoditySpecHash == bytes32(0)
                || envelope.publicRegionHash == bytes32(0) || envelope.titleEvidenceHash == bytes32(0)
                || envelope.custodyEvidenceHash == bytes32(0) || envelope.qualityEvidenceHash == bytes32(0)
                || envelope.calibrationEvidenceHash == bytes32(0)
                || envelope.encumbranceStatementHash == bytes32(0) || envelope.publicManifestHash == bytes32(0)
                || envelope.fullManifestHash == bytes32(0) || envelope.publicManifestUriHash == bytes32(0)
                || envelope.publicManifestHash == envelope.fullManifestHash
                || envelope.rightsVersionHash != NO_RIGHTS_VERSION_HASH
                || envelope.transferPolicyHash != NON_TRANSFERABLE_POLICY_HASH || envelope.nonce == 0
        ) revert InvalidEnvelope();
        if (
            envelope.quantity.value == 0 || envelope.quantity.decimals > 18
                || envelope.quantity.unitCode == bytes32(0) || envelope.quantity.quantityStandardHash == bytes32(0)
                || envelope.quantity.uncertaintyPpm > 1_000_000
        ) revert InvalidEnvelope();
        if (
            envelope.validUntil <= envelope.validFrom || envelope.validFrom > block.timestamp
                || envelope.validUntil < block.timestamp
                || envelope.validUntil - envelope.validFrom > instrument.maxValidityDuration
                || block.timestamp - envelope.validFrom > MAX_PUBLICATION_BACKDATE || envelope.measuredAt == 0
                || envelope.measuredAt > block.timestamp
                || block.timestamp - envelope.measuredAt > instrument.maxValidityDuration
        ) revert InvalidValidityWindow();

        bytes memory uriBytes = bytes(publicManifestURI);
        if (uriBytes.length == 0 || uriBytes.length > 512 || keccak256(uriBytes) != envelope.publicManifestUriHash) {
            revert InvalidEnvelope();
        }
    }

    function _validateRoleSignature(
        RoleSignature calldata roleSignature,
        bytes32 expectedRole,
        bytes32 expectedPartyId,
        uint256 expectedRoleBitmap,
        bytes32 digest
    ) private view {
        if (roleSignature.role != expectedRole || roleSignature.partyId != expectedPartyId) {
            revert InvalidRoleSignature();
        }
        _requireActivePartyWithRole(expectedPartyId, expectedRoleBitmap);
        Party storage party = _parties[expectedPartyId];
        if (!SignatureChecker.isValidSignatureNow(party.signingAccount, digest, roleSignature.signature)) {
            revert InvalidSigner(expectedPartyId);
        }
    }

    function _requireActivePartyWithRole(bytes32 partyId, uint256 expectedRoleBitmap) private view {
        Party storage party = _parties[partyId];
        if (
            effectivePartyStatus(partyId) != PartyStatus.Active || party.signingAccount == address(0)
                || (party.roleBitmap & expectedRoleBitmap) == 0
        ) revert InvalidParty();
    }

    function _currentQuorumActive(bytes32 instrumentId) private view returns (bool) {
        InstrumentConfig storage instrument = _instruments[instrumentId];
        return instrument.configured && effectivePartyStatus(instrument.issuerPartyId) == PartyStatus.Active
            && effectivePartyStatus(instrument.custodianPartyId) == PartyStatus.Active
            && effectivePartyStatus(instrument.attestorPartyId) == PartyStatus.Active;
    }

    function _isAdministratorOrEvidenceParty(bytes32 instrumentId, address caller) private view returns (bool) {
        if (caller == administrator) return true;
        InstrumentConfig storage instrument = _instruments[instrumentId];
        return caller == _parties[instrument.issuerPartyId].signingAccount
            || caller == _parties[instrument.custodianPartyId].signingAccount
            || caller == _parties[instrument.attestorPartyId].signingAccount;
    }

    function _changeEvidenceStatus(
        bytes32 evidenceId,
        EvidenceRecord storage record,
        EvidenceStatus newStatus,
        bytes32 reasonCode,
        bytes32 supportingManifestHash,
        bytes32 supportingUriHash
    ) private {
        EvidenceStatus previousStatus = record.storedStatus;
        record.storedStatus = newStatus;
        record.statusReasonCode = reasonCode;
        record.statusSupportingManifestHash = supportingManifestHash;
        record.statusSupportingUriHash = supportingUriHash;
        emit EvidenceStatusChanged(
            evidenceId,
            previousStatus,
            newStatus,
            reasonCode,
            supportingManifestHash,
            supportingUriHash,
            msg.sender
        );
    }

    function _requireTargetChain() private view {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid, TARGET_CHAIN_ID);
    }

    receive() external payable {
        revert DirectValueRejected();
    }

    fallback() external payable {
        revert DirectValueRejected();
    }
}
