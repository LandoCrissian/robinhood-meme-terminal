// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV7ReleaseRegistry} from "../src/RMTV7ReleaseRegistry.sol";
import {IRMTV7MediaEvidenceVerifier} from "../src/interfaces/IRMTV7MediaEvidenceVerifier.sol";
import {IRMTV7ERC721CollectionModule} from "../src/interfaces/IRMTV7ERC721CollectionModule.sol";
import {IRMTV7ERC1155EditionModule} from "../src/interfaces/IRMTV7ERC1155EditionModule.sol";
import {IRMTV7ConsentBoundSplitModule} from "../src/interfaces/IRMTV7ConsentBoundSplitModule.sol";

/// @notice Pins the exact Solidity calldata used by the non-executable TypeScript simulations.
contract RMTV7TransactionSimulationVectorsTest {
    bytes32 private constant RELEASE_ID = 0x5555555555555555555555555555555555555555555555555555555555555555;
    address private constant CREATOR = 0x4444444444444444444444444444444444444444;

    function testConsentBoundSplitInterfaceMatchesWebVerifier() public pure {
        require(type(IRMTV7ConsentBoundSplitModule).interfaceId == bytes4(0xe161dd4b), "split interface drifted");
    }

    function testERC721InterfaceMatchesWebVerifier() public pure {
        require(type(IRMTV7ERC721CollectionModule).interfaceId == bytes4(0x6c2ba9ae), "721 interface drifted");
    }

    function testERC1155InterfaceMatchesWebVerifier() public pure {
        require(type(IRMTV7ERC1155EditionModule).interfaceId == bytes4(0xb96f46b7), "1155 interface drifted");
    }

    function testReleaseFreezeCalldataMatchesWebSimulation() public pure {
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = new RMTV7ReleaseRegistry.ModuleIntent[](2);
        intents[0] = RMTV7ReleaseRegistry.ModuleIntent({
            moduleKey: 0x6666666666666666666666666666666666666666666666666666666666666666,
            configurationHash: 0x8888888888888888888888888888888888888888888888888888888888888888
        });
        intents[1] = RMTV7ReleaseRegistry.ModuleIntent({
            moduleKey: 0x7777777777777777777777777777777777777777777777777777777777777777,
            configurationHash: 0x9999999999999999999999999999999999999999999999999999999999999999
        });
        IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence = IRMTV7MediaEvidenceVerifier.MediaEvidence({
            receiptHash: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,
            availabilityObservationHash: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,
            observedAt: 1_785_283_140,
            validUntil: 1_785_286_800,
            signerEpoch: 2
        });
        bytes memory signature =
            hex"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc1b";
        bytes memory transactionData =
            abi.encodeCall(RMTV7ReleaseRegistry.freezeRelease, (RELEASE_ID, intents, evidence, signature));

        require(RMTV7ReleaseRegistry.freezeRelease.selector == bytes4(0x43fc941c), "freeze selector drifted");
        require(
            keccak256(transactionData) == 0xd83e4a37c9f4337560269f537f8deff3af833a2e5d7ea9e7caa8b574d364c431,
            "freeze calldata drifted"
        );
    }

    function testERC721DeploymentCalldataMatchesWebSimulation() public pure {
        IRMTV7ERC721CollectionModule.CollectionConfig memory config = IRMTV7ERC721CollectionModule.CollectionConfig({
            name: "RMT Creator Collection",
            symbol: "RMTCC",
            collectionURI: "ipfs://bafy-collection/contract.json",
            tokenManifestRoot: 0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd,
            maximumSupply: 100,
            royaltyReceiver: CREATOR,
            royaltyBps: 500
        });
        bytes memory transactionData =
            abi.encodeCall(IRMTV7ERC721CollectionModule.deployCollection, (RELEASE_ID, config));
        bytes32 configurationHash = keccak256(
            abi.encode(
                keccak256(bytes(config.name)),
                keccak256(bytes(config.symbol)),
                keccak256(bytes(config.collectionURI)),
                config.tokenManifestRoot,
                config.maximumSupply,
                config.royaltyReceiver,
                config.royaltyBps
            )
        );

        require(IRMTV7ERC721CollectionModule.deployCollection.selector == bytes4(0x8223704e), "721 selector drifted");
        require(
            configurationHash == 0x2e96e966a36d2c08aedfd016461fac9b1fd7bf75a3b498686987b49d341609ec,
            "721 configuration drifted"
        );
        require(
            keccak256(transactionData) == 0x71f93bb20ff1b95bf5e59e71ff8a5fa28b311f051f2f49866fdbdd849c160519,
            "721 calldata drifted"
        );
    }

    function testERC1155DeploymentCalldataMatchesWebSimulation() public pure {
        IRMTV7ERC1155EditionModule.EditionConfig memory config = IRMTV7ERC1155EditionModule.EditionConfig({
            name: "RMT Creator Editions",
            symbol: "RMTED",
            collectionURI: "ipfs://bafy-editions/contract.json",
            editionManifestRoot: 0x9ed6534b3fb703a008fa207f24b7fcf083682d60b1e2e251b3e6934a434b4a5a,
            maximumEditionTypes: 2,
            maximumTotalSupply: 5,
            royaltyReceiver: CREATOR,
            royaltyBps: 500
        });
        bytes memory transactionData = abi.encodeCall(IRMTV7ERC1155EditionModule.deployEditions, (RELEASE_ID, config));
        bytes32 configurationHash = keccak256(
            abi.encode(
                keccak256(bytes(config.name)),
                keccak256(bytes(config.symbol)),
                keccak256(bytes(config.collectionURI)),
                config.editionManifestRoot,
                config.maximumEditionTypes,
                config.maximumTotalSupply,
                config.royaltyReceiver,
                config.royaltyBps
            )
        );

        require(IRMTV7ERC1155EditionModule.deployEditions.selector == bytes4(0x59c29a1b), "1155 selector drifted");
        require(
            configurationHash == 0x6bd37c154feb8cc8e37c75867da1fdefd4332accfda4ee03ff7f730fda017816,
            "1155 configuration drifted"
        );
        require(
            keccak256(transactionData) == 0x04c43376d20f7a49bfbdd56990b2b3f64bd12a0dccb0558702268427830441ac,
            "1155 calldata drifted"
        );
    }

    function testConsentBoundSplitDeploymentCalldataMatchesWebSimulation() public pure {
        address[] memory recipients = new address[](2);
        recipients[0] = 0x6666666666666666666666666666666666666666;
        recipients[1] = 0x7777777777777777777777777777777777777777;
        uint16[] memory sharesBps = new uint16[](2);
        sharesBps[0] = 7_000;
        sharesBps[1] = 3_000;
        address[] memory recoveryAddresses = new address[](2);
        recoveryAddresses[0] = 0x8888888888888888888888888888888888888888;
        recoveryAddresses[1] = address(0);
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = IRMTV7ConsentBoundSplitModule.SplitConfig({
            recipients: recipients,
            sharesBps: sharesBps,
            recoveryAddresses: recoveryAddresses,
            consentDeadline: 1_785_456_000
        });
        bytes[] memory consentSignatures = new bytes[](2);
        consentSignatures[0] =
            hex"111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111b";
        consentSignatures[1] =
            hex"222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222221c";
        bytes memory transactionData =
            abi.encodeCall(IRMTV7ConsentBoundSplitModule.deploySplit, (RELEASE_ID, config, consentSignatures));
        bytes32 payoutManifestHash = keccak256(abi.encode(recipients, sharesBps));
        bytes32 consentManifestHash =
            keccak256(abi.encode(recipients, sharesBps, recoveryAddresses, config.consentDeadline));
        bytes32 configurationHash =
            keccak256(abi.encode(payoutManifestHash, consentManifestHash, config.consentDeadline, recipients.length));

        require(IRMTV7ConsentBoundSplitModule.deploySplit.selector == bytes4(0xeff78744), "split selector drifted");
        require(
            payoutManifestHash == 0x1d00b23ba62c530839eb0c21e93f17471fb87015592429f53be547e2898ad499,
            "split payout manifest drifted"
        );
        require(
            consentManifestHash == 0x210741b1724054dbbf276101b5d6395d3ae1a7968cc64f220ef1462ffaebe346,
            "split consent manifest drifted"
        );
        require(
            configurationHash == 0xb45defca079ac16eb7dba2b7faf652df938ed08159603efe048aed76a42c08bf,
            "split configuration drifted"
        );
        require(
            keccak256(transactionData) == 0x4df7f598d44f775d5480cae628bc1964aa2e99cc4503b0ebe6583f85eb033514,
            "split calldata drifted"
        );
    }
}
