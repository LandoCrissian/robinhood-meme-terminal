// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

interface CommodityEvidencePostflightVm {
    function addr(uint256 privateKey) external returns (address);
}

/// @notice Read-only state verifier for a separately authorized synthetic registry deployment.
/// @dev This script never broadcasts, signs, configures, publishes evidence, or reads a secret.
contract VerifySyntheticCommodityEvidenceRegistryV0 {
    CommodityEvidencePostflightVm private constant vm =
        CommodityEvidencePostflightVm(address(uint160(uint256(keccak256("hevm cheat code")))));

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
    bytes32 public constant BATCH_ID = keccak256("SYNTHETIC-HE-BATCH-0001");

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("RMTCommodityEvidenceRegistryV0");
    bytes32 private constant VERSION_HASH = keccak256("0");

    error WrongChain(uint256 actual, uint256 expected);
    error InvalidInput();
    error VerificationFailed(bytes32 check);

    function run(
        address registryAddress,
        address expectedAdministrator,
        bytes32 expectedRuntimeCodeHash,
        uint64 expectedPartyValidFrom,
        uint64 expectedPartyValidUntil
    ) external returns (bytes32 domainSeparator) {
        if (block.chainid != TARGET_CHAIN_ID) {
            revert WrongChain(block.chainid, TARGET_CHAIN_ID);
        }
        if (
            registryAddress == address(0) || expectedAdministrator == address(0)
                || expectedRuntimeCodeHash == bytes32(0) || expectedPartyValidFrom == 0
                || expectedPartyValidUntil <= expectedPartyValidFrom
        ) revert InvalidInput();
        if (registryAddress.code.length == 0) revert VerificationFailed("NO_RUNTIME_CODE");
        if (registryAddress.codehash != expectedRuntimeCodeHash) {
            revert VerificationFailed("RUNTIME_CODE_HASH");
        }

        RMTCommodityEvidenceRegistryV0 registry = RMTCommodityEvidenceRegistryV0(payable(registryAddress));
        if (registry.administrator() != expectedAdministrator) {
            revert VerificationFailed("ADMINISTRATOR");
        }
        if (registry.TARGET_CHAIN_ID() != TARGET_CHAIN_ID) {
            revert VerificationFailed("TARGET_CHAIN_ID");
        }
        if (!registry.SYNTHETIC_ONLY()) revert VerificationFailed("SYNTHETIC_ONLY");
        if (registryAddress.balance != 0) revert VerificationFailed("NATIVE_BALANCE");
        if (registry.NO_RIGHTS_VERSION_HASH() != keccak256("RMT_SYNTHETIC_NO_RIGHTS_V0")) {
            revert VerificationFailed("NO_RIGHTS_HASH");
        }
        if (registry.NON_TRANSFERABLE_POLICY_HASH() != keccak256("RMT_SYNTHETIC_NON_TRANSFERABLE_V0")) {
            revert VerificationFailed("NON_TRANSFER_POLICY");
        }

        address issuer = vm.addr(SYNTHETIC_ISSUER_KEY);
        address custodian = vm.addr(SYNTHETIC_CUSTODIAN_KEY);
        address attestor = vm.addr(SYNTHETIC_ATTESTOR_KEY);
        _verifyParty(
            registry,
            ISSUER_PARTY_ID,
            issuer,
            registry.ROLE_ISSUER_BITMAP(),
            expectedPartyValidFrom,
            expectedPartyValidUntil,
            "ISSUER_PARTY"
        );
        _verifyParty(
            registry,
            CUSTODIAN_PARTY_ID,
            custodian,
            registry.ROLE_CUSTODIAN_BITMAP(),
            expectedPartyValidFrom,
            expectedPartyValidUntil,
            "CUSTODIAN_PARTY"
        );
        _verifyParty(
            registry,
            ATTESTOR_PARTY_ID,
            attestor,
            registry.ROLE_ATTESTOR_BITMAP(),
            expectedPartyValidFrom,
            expectedPartyValidUntil,
            "ATTESTOR_PARTY"
        );

        RMTCommodityEvidenceRegistryV0.InstrumentConfig memory instrument = registry.getInstrument(INSTRUMENT_ID);
        if (
            !instrument.configured || instrument.schemaHash != SCHEMA_HASH || instrument.seriesId != SERIES_ID
                || instrument.governingInstrumentHash != GOVERNING_INSTRUMENT_HASH
                || instrument.issuerPartyId != ISSUER_PARTY_ID || instrument.custodianPartyId != CUSTODIAN_PARTY_ID
                || instrument.attestorPartyId != ATTESTOR_PARTY_ID || instrument.maxValidityDuration != 7 days
        ) revert VerificationFailed("INSTRUMENT_CONFIG");

        bytes32 batchKey = registry.batchKeyFor(INSTRUMENT_ID, BATCH_ID);
        if (registry.latestVersionByBatchKey(batchKey) != 0) {
            revert VerificationFailed("UNEXPECTED_EVIDENCE");
        }
        if (registry.latestNonceByBatchKey(batchKey) != 0) {
            revert VerificationFailed("UNEXPECTED_NONCE");
        }

        domainSeparator =
            keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, registryAddress));
        if (registry.domainSeparator() != domainSeparator) {
            revert VerificationFailed("DOMAIN_SEPARATOR");
        }

        (bool mintSurface,) =
            registryAddress.staticcall(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        if (mintSurface) revert VerificationFailed("MINT_SURFACE");
        (bool supplySurface,) = registryAddress.staticcall(abi.encodeWithSignature("totalSupply()"));
        if (supplySurface) revert VerificationFailed("SUPPLY_SURFACE");
    }

    function _verifyParty(
        RMTCommodityEvidenceRegistryV0 registry,
        bytes32 partyId,
        address signingAccount,
        uint256 roleBitmap,
        uint64 expectedValidFrom,
        uint64 expectedValidUntil,
        bytes32 check
    ) private view {
        RMTCommodityEvidenceRegistryV0.Party memory party = registry.getParty(partyId);
        if (
            party.signingAccount != signingAccount || party.keyVersion != 1 || party.validFrom != expectedValidFrom
                || party.validUntil != expectedValidUntil || party.roleBitmap != roleBitmap
                || party.status != RMTCommodityEvidenceRegistryV0.PartyStatus.Active
                || registry.partyBySigningAccount(signingAccount) != partyId
                || registry.effectivePartyStatus(partyId) != RMTCommodityEvidenceRegistryV0.PartyStatus.Active
        ) revert VerificationFailed(check);
    }
}
