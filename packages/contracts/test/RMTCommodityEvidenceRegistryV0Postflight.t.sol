// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";
import {VerifySyntheticCommodityEvidenceRegistryV0} from
    "../script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol";

interface CommodityEvidencePostflightTestVm {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function warp(uint256 timestamp) external;
}

contract RMTCommodityEvidenceRegistryV0PostflightTest {
    CommodityEvidencePostflightTestVm private constant vm =
        CommodityEvidencePostflightTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TARGET_CHAIN_ID = 46_630;
    uint256 private constant ISSUER_KEY = 0xA11CE;
    uint256 private constant CUSTODIAN_KEY = 0xB0B;
    uint256 private constant ATTESTOR_KEY = 0xC0DE;

    bytes32 private constant SCHEMA_HASH = keccak256("rmt.physical-commodity-evidence.v0.schema");
    bytes32 private constant INSTRUMENT_ID = keccak256("RMT-HE-DEMO-V0");
    bytes32 private constant SERIES_ID = keccak256("RMT-HE-COLORADO-SYNTHETIC-SERIES-V0");
    bytes32 private constant GOVERNING_INSTRUMENT_HASH =
        keccak256("RMT_SYNTHETIC_NO_RIGHTS_GOVERNING_TEXT_V0");
    bytes32 private constant ISSUER_PARTY_ID = keccak256("RMT-SYNTHETIC-ISSUER-0001");
    bytes32 private constant CUSTODIAN_PARTY_ID = keccak256("RMT-SYNTHETIC-CUSTODIAN-0001");
    bytes32 private constant ATTESTOR_PARTY_ID = keccak256("RMT-SYNTHETIC-ATTESTOR-0001");

    VerifySyntheticCommodityEvidenceRegistryV0 private verifier;
    RMTCommodityEvidenceRegistryV0 private registry;
    uint64 private validFrom;
    uint64 private validUntil;

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        vm.warp(1_800_000_000);
        verifier = new VerifySyntheticCommodityEvidenceRegistryV0();
        registry = new RMTCommodityEvidenceRegistryV0(address(this));
        validFrom = uint64(block.timestamp);
        validUntil = uint64(block.timestamp + 365 days);
        registry.registerParty(
            ISSUER_PARTY_ID,
            vm.addr(ISSUER_KEY),
            registry.ROLE_ISSUER_BITMAP(),
            validFrom,
            validUntil
        );
        registry.registerParty(
            CUSTODIAN_PARTY_ID,
            vm.addr(CUSTODIAN_KEY),
            registry.ROLE_CUSTODIAN_BITMAP(),
            validFrom,
            validUntil
        );
        registry.registerParty(
            ATTESTOR_PARTY_ID,
            vm.addr(ATTESTOR_KEY),
            registry.ROLE_ATTESTOR_BITMAP(),
            validFrom,
            validUntil
        );
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

    function testPostflightVerifiesExactSyntheticConfiguration() public {
        bytes32 domain = verifier.run(
            address(registry), address(this), address(registry).codehash, validFrom, validUntil
        );
        require(domain == registry.domainSeparator(), "domain mismatch");
    }

    function testPostflightRejectsWrongRuntimeHash() public {
        (bool success,) = address(verifier).call(
            abi.encodeWithSelector(
                verifier.run.selector,
                address(registry),
                address(this),
                bytes32(uint256(1)),
                validFrom,
                validUntil
            )
        );
        require(!success, "wrong runtime hash accepted");
    }

    function testPostflightRejectsWrongAdministrator() public {
        (bool success,) = address(verifier).call(
            abi.encodeWithSelector(
                verifier.run.selector,
                address(registry),
                address(0xBEEF),
                address(registry).codehash,
                validFrom,
                validUntil
            )
        );
        require(!success, "wrong administrator accepted");
    }

    function testPostflightRejectsUnconfiguredRegistry() public {
        RMTCommodityEvidenceRegistryV0 unconfigured =
            new RMTCommodityEvidenceRegistryV0(address(this));
        (bool success,) = address(verifier).call(
            abi.encodeWithSelector(
                verifier.run.selector,
                address(unconfigured),
                address(this),
                address(unconfigured).codehash,
                validFrom,
                validUntil
            )
        );
        require(!success, "unconfigured registry accepted");
    }

    function testPostflightRejectsWrongChain() public {
        vm.chainId(TARGET_CHAIN_ID + 1);
        (bool success,) = address(verifier).call(
            abi.encodeWithSelector(
                verifier.run.selector,
                address(registry),
                address(this),
                address(registry).codehash,
                validFrom,
                validUntil
            )
        );
        require(!success, "wrong chain accepted");
        vm.chainId(TARGET_CHAIN_ID);
    }
}
