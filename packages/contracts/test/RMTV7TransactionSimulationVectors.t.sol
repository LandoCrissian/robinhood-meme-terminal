// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV7ReleaseRegistry} from "../src/RMTV7ReleaseRegistry.sol";
import {IRMTV7MediaEvidenceVerifier} from "../src/interfaces/IRMTV7MediaEvidenceVerifier.sol";
import {IRMTV7ERC721CollectionModule} from "../src/interfaces/IRMTV7ERC721CollectionModule.sol";
import {IRMTV7ERC1155EditionModule} from "../src/interfaces/IRMTV7ERC1155EditionModule.sol";

/// @notice Pins the exact Solidity calldata used by the non-executable TypeScript simulations.
contract RMTV7TransactionSimulationVectorsTest {
    bytes32 private constant RELEASE_ID = 0x5555555555555555555555555555555555555555555555555555555555555555;
    address private constant CREATOR = 0x4444444444444444444444444444444444444444;

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
}
