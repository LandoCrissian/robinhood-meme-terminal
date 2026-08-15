// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";
import {
    RehearseSyntheticCommodityEvidenceRegistryV0
} from "../script/RehearseSyntheticCommodityEvidenceRegistryV0.s.sol";

interface CommodityEvidenceRehearsalTestVm {
    function chainId(uint256 newChainId) external;
    function warp(uint256 timestamp) external;
}

contract RMTCommodityEvidenceRegistryV0RehearsalTest {
    CommodityEvidenceRehearsalTestVm private constant vm =
        CommodityEvidenceRehearsalTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TARGET_CHAIN_ID = 46_630;

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        vm.warp(1_800_000_000);
    }

    function testRehearsalDeploysAndVerifiesSyntheticConfigurationWithoutBroadcast() public {
        RehearseSyntheticCommodityEvidenceRegistryV0 rehearsal = new RehearseSyntheticCommodityEvidenceRegistryV0();
        RMTCommodityEvidenceRegistryV0 registry = rehearsal.run();
        (address issuer, address custodian, address attestor) = rehearsal.syntheticParties();

        require(address(registry).code.length > 0, "registry code missing");
        require(registry.administrator() == address(rehearsal), "rehearsal administrator mismatch");
        require(registry.TARGET_CHAIN_ID() == TARGET_CHAIN_ID, "chain binding mismatch");
        require(registry.SYNTHETIC_ONLY(), "synthetic boundary missing");
        require(address(registry).balance == 0, "registry retained value");
        require(
            registry.partyBySigningAccount(issuer) == rehearsal.ISSUER_PARTY_ID(), "issuer account binding mismatch"
        );
        require(
            registry.partyBySigningAccount(custodian) == rehearsal.CUSTODIAN_PARTY_ID(),
            "custodian account binding mismatch"
        );
        require(
            registry.partyBySigningAccount(attestor) == rehearsal.ATTESTOR_PARTY_ID(),
            "attestor account binding mismatch"
        );

        RMTCommodityEvidenceRegistryV0.InstrumentConfig memory instrument =
            registry.getInstrument(rehearsal.INSTRUMENT_ID());
        require(instrument.configured, "instrument not configured");
        require(instrument.schemaHash == rehearsal.SCHEMA_HASH(), "schema mismatch");
        require(instrument.seriesId == rehearsal.SERIES_ID(), "series mismatch");
        require(
            instrument.governingInstrumentHash == rehearsal.GOVERNING_INSTRUMENT_HASH(), "governing instrument mismatch"
        );
        require(instrument.issuerPartyId == rehearsal.ISSUER_PARTY_ID(), "issuer party mismatch");
        require(instrument.custodianPartyId == rehearsal.CUSTODIAN_PARTY_ID(), "custodian party mismatch");
        require(instrument.attestorPartyId == rehearsal.ATTESTOR_PARTY_ID(), "attestor party mismatch");
        require(instrument.maxValidityDuration == rehearsal.MAX_EVIDENCE_VALIDITY(), "validity policy mismatch");
    }

    function testRehearsalRefusesAnyOtherChainDomain() public {
        RehearseSyntheticCommodityEvidenceRegistryV0 rehearsal = new RehearseSyntheticCommodityEvidenceRegistryV0();
        vm.chainId(TARGET_CHAIN_ID + 1);
        (bool success,) =
            address(rehearsal).call(abi.encodeWithSelector(RehearseSyntheticCommodityEvidenceRegistryV0.run.selector));
        require(!success, "wrong-chain rehearsal succeeded");
        vm.chainId(TARGET_CHAIN_ID);
    }
}
