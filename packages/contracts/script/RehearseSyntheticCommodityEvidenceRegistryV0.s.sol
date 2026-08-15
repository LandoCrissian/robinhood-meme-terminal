// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

interface CommodityEvidenceRehearsalVm {
    function addr(uint256 privateKey) external returns (address);
}

/// @notice Deterministic, non-broadcast rehearsal for the synthetic commodity registry on chain ID 46630.
/// @dev This script contains public fixture keys and deliberately exposes no broadcast or environment-secret call.
///      `forge script` may simulate it locally or against a fork, but this source cannot submit a transaction.
contract RehearseSyntheticCommodityEvidenceRegistryV0 {
    CommodityEvidenceRehearsalVm private constant vm =
        CommodityEvidenceRehearsalVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant TARGET_CHAIN_ID = 46_630;
    uint256 public constant SYNTHETIC_ISSUER_KEY = 0xA11CE;
    uint256 public constant SYNTHETIC_CUSTODIAN_KEY = 0xB0B;
    uint256 public constant SYNTHETIC_ATTESTOR_KEY = 0xC0DE;

    bytes32 public constant SCHEMA_HASH = keccak256("rmt.physical-commodity-evidence.v0.schema");
    bytes32 public constant INSTRUMENT_ID = keccak256("RMT-HE-DEMO-V0");
    bytes32 public constant SERIES_ID = keccak256("RMT-HE-COLORADO-SYNTHETIC-SERIES-V0");
    bytes32 public constant GOVERNING_INSTRUMENT_HASH = keccak256("RMT_SYNTHETIC_NO_RIGHTS_GOVERNING_TEXT_V0");
    bytes32 public constant ISSUER_PARTY_ID = keccak256("RMT-SYNTHETIC-ISSUER-0001");
    bytes32 public constant CUSTODIAN_PARTY_ID = keccak256("RMT-SYNTHETIC-CUSTODIAN-0001");
    bytes32 public constant ATTESTOR_PARTY_ID = keccak256("RMT-SYNTHETIC-ATTESTOR-0001");
    uint64 public constant PARTY_VALIDITY = 365 days;
    uint64 public constant MAX_EVIDENCE_VALIDITY = 7 days;

    event SyntheticCommodityEvidenceRegistryRehearsed(
        address indexed registry,
        address indexed rehearsalAdministrator,
        bytes32 indexed configurationHash,
        address issuer,
        address custodian,
        address attestor,
        uint64 partyValidFrom,
        uint64 partyValidUntil
    );

    error WrongChain(uint256 actual, uint256 expected);
    error RehearsalVerificationFailed();

    function run() external returns (RMTCommodityEvidenceRegistryV0 registry) {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid, TARGET_CHAIN_ID);

        address issuer = vm.addr(SYNTHETIC_ISSUER_KEY);
        address custodian = vm.addr(SYNTHETIC_CUSTODIAN_KEY);
        address attestor = vm.addr(SYNTHETIC_ATTESTOR_KEY);
        if (
            issuer == address(0) || custodian == address(0) || attestor == address(0) || issuer == custodian
                || issuer == attestor || custodian == attestor
        ) revert RehearsalVerificationFailed();

        uint64 validFrom = uint64(block.timestamp);
        uint64 validUntil = validFrom + PARTY_VALIDITY;

        registry = new RMTCommodityEvidenceRegistryV0(address(this));
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
            MAX_EVIDENCE_VALIDITY
        );

        _verifyRegistry(registry, issuer, custodian, attestor);

        bytes32 configurationHash = keccak256(
            abi.encode(
                TARGET_CHAIN_ID,
                address(registry),
                address(this),
                SCHEMA_HASH,
                INSTRUMENT_ID,
                SERIES_ID,
                GOVERNING_INSTRUMENT_HASH,
                ISSUER_PARTY_ID,
                issuer,
                CUSTODIAN_PARTY_ID,
                custodian,
                ATTESTOR_PARTY_ID,
                attestor,
                validFrom,
                validUntil,
                MAX_EVIDENCE_VALIDITY,
                keccak256(type(RMTCommodityEvidenceRegistryV0).creationCode)
            )
        );

        emit SyntheticCommodityEvidenceRegistryRehearsed(
            address(registry),
            address(this),
            configurationHash,
            issuer,
            custodian,
            attestor,
            validFrom,
            validUntil
        );
    }

    function syntheticParties() external returns (address issuer, address custodian, address attestor) {
        issuer = vm.addr(SYNTHETIC_ISSUER_KEY);
        custodian = vm.addr(SYNTHETIC_CUSTODIAN_KEY);
        attestor = vm.addr(SYNTHETIC_ATTESTOR_KEY);
    }

    function _verifyRegistry(
        RMTCommodityEvidenceRegistryV0 registry,
        address issuer,
        address custodian,
        address attestor
    ) private view {
        RMTCommodityEvidenceRegistryV0.Party memory issuerParty = registry.getParty(ISSUER_PARTY_ID);
        RMTCommodityEvidenceRegistryV0.Party memory custodianParty = registry.getParty(CUSTODIAN_PARTY_ID);
        RMTCommodityEvidenceRegistryV0.Party memory attestorParty = registry.getParty(ATTESTOR_PARTY_ID);
        RMTCommodityEvidenceRegistryV0.InstrumentConfig memory instrument = registry.getInstrument(INSTRUMENT_ID);

        if (
            registry.administrator() != address(this) || registry.TARGET_CHAIN_ID() != TARGET_CHAIN_ID
                || !registry.SYNTHETIC_ONLY() || issuerParty.signingAccount != issuer
                || custodianParty.signingAccount != custodian || attestorParty.signingAccount != attestor
                || issuerParty.status != RMTCommodityEvidenceRegistryV0.PartyStatus.Active
                || custodianParty.status != RMTCommodityEvidenceRegistryV0.PartyStatus.Active
                || attestorParty.status != RMTCommodityEvidenceRegistryV0.PartyStatus.Active || !instrument.configured
                || instrument.schemaHash != SCHEMA_HASH || instrument.seriesId != SERIES_ID
                || instrument.governingInstrumentHash != GOVERNING_INSTRUMENT_HASH
                || instrument.issuerPartyId != ISSUER_PARTY_ID
                || instrument.custodianPartyId != CUSTODIAN_PARTY_ID
                || instrument.attestorPartyId != ATTESTOR_PARTY_ID
                || instrument.maxValidityDuration != MAX_EVIDENCE_VALIDITY || address(registry).balance != 0
        ) revert RehearsalVerificationFailed();
    }
}
