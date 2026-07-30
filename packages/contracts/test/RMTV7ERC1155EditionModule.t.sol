// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IRMTV7ERC1155EditionModule} from "../src/interfaces/IRMTV7ERC1155EditionModule.sol";
import {IRMTV7MediaEvidenceVerifier} from "../src/interfaces/IRMTV7MediaEvidenceVerifier.sol";
import {RMTV7CreatorEditions} from "../src/RMTV7CreatorEditions.sol";
import {RMTV7ERC1155EditionModule} from "../src/RMTV7ERC1155EditionModule.sol";
import {RMTV7MediaEvidenceVerifier} from "../src/RMTV7MediaEvidenceVerifier.sol";
import {RMTV7ModuleRegistry} from "../src/RMTV7ModuleRegistry.sol";
import {RMTV7ReleaseRegistry} from "../src/RMTV7ReleaseRegistry.sol";

interface V7EditionVm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract V7EditionGovernance {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory output) = target.call(data);
        require(success, "governance call failed");
        return output;
    }
}

contract V7RejectingEditionReceiver is IERC1155Receiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return bytes4(0);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
    }
}

contract RMTV7ERC1155EditionModuleTest {
    V7EditionVm private constant vm = V7EditionVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant EVIDENCE_SIGNER_KEY = 0xA11CE;
    address private constant OTHER_CREATOR = address(0xB0B);
    address private constant COLLECTOR = address(0xCAFE);
    string private constant EDITION_ONE_URI = "ipfs://bafy-edition-one/metadata.json";
    string private constant EDITION_TWO_URI = "ipfs://bafy-edition-two/metadata.json";
    bytes32 private constant EDITION_ONE_TERMS = keccak256("AI_ART_PERSONAL_DISPLAY_TERMS_V1");
    bytes32 private constant EDITION_TWO_TERMS = keccak256("MUSIC_COLLECTOR_TERMS_V1");

    V7EditionGovernance private governance;
    RMTV7ModuleRegistry private moduleRegistry;
    RMTV7MediaEvidenceVerifier private mediaEvidenceVerifier;
    RMTV7ReleaseRegistry private releaseRegistry;
    RMTV7ERC1155EditionModule private editionModule;
    bytes32 private moduleKey;

    function setUp() public {
        governance = new V7EditionGovernance();
        moduleRegistry = new RMTV7ModuleRegistry(address(governance));
        mediaEvidenceVerifier = new RMTV7MediaEvidenceVerifier(address(governance), vm.addr(EVIDENCE_SIGNER_KEY));
        releaseRegistry = new RMTV7ReleaseRegistry(address(moduleRegistry), address(mediaEvidenceVerifier));
        editionModule = new RMTV7ERC1155EditionModule(address(moduleRegistry), address(releaseRegistry));
        moduleKey = _registerEditionModule();
    }

    function testCreatorDeploysFrozenEditionsAndMintsOnlyManifestSupply() public {
        IRMTV7ERC1155EditionModule.EditionConfig memory config = _config();
        bytes32 releaseId = _freezeEditionRelease(config);

        address editionsAddress = editionModule.deployEditions(releaseId, config);
        RMTV7CreatorEditions editions = RMTV7CreatorEditions(editionsAddress);
        require(editionModule.editionsForRelease(releaseId) == editionsAddress, "editions not recorded");
        require(editions.releaseId() == releaseId, "release not bound");
        require(editions.originalCreator() == address(this), "creator not bound");
        require(editions.maximumEditionTypes() == 2, "type cap not bound");
        require(editions.maximumTotalSupply() == 5, "total cap not bound");
        require(editions.editionManifestRoot() == config.editionManifestRoot, "manifest not bound");
        require(keccak256(bytes(editions.name())) == keccak256(bytes(config.name)), "wrong name");
        require(keccak256(bytes(editions.symbol())) == keccak256(bytes(config.symbol)), "wrong symbol");
        require(keccak256(bytes(editions.collectionURI())) == keccak256(bytes(config.collectionURI)), "wrong URI");

        bytes32[] memory editionOneProof = new bytes32[](1);
        editionOneProof[0] = _leaf(2, EDITION_TWO_URI, EDITION_TWO_TERMS, 2);
        editions.mintEdition(COLLECTOR, 1, 2, EDITION_ONE_URI, EDITION_ONE_TERMS, 3, editionOneProof);
        editions.mintEdition(COLLECTOR, 1, 1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3, editionOneProof);
        require(editions.balanceOf(COLLECTOR, 1) == 3, "edition one balance wrong");
        require(editions.editionMintedSupply(1) == 3, "edition one supply wrong");
        require(editions.editionMaximumSupply(1) == 3, "edition one cap changed");
        require(editions.editionTermsHash(1) == EDITION_ONE_TERMS, "terms changed");
        require(keccak256(bytes(editions.uri(1))) == keccak256(bytes(EDITION_ONE_URI)), "edition URI changed");

        bytes32[] memory editionTwoProof = new bytes32[](1);
        editionTwoProof[0] = _leaf(1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3);
        editions.mintEdition(COLLECTOR, 2, 2, EDITION_TWO_URI, EDITION_TWO_TERMS, 2, editionTwoProof);
        require(editions.totalMinted() == 5 && editions.editionTypeCount() == 2, "totals wrong");

        (address royaltyReceiver, uint256 royaltyAmount) = editions.royaltyInfo(1, 1 ether);
        require(royaltyReceiver == address(this) && royaltyAmount == 0.05 ether, "royalty signal mismatch");

        (bool exceededSupply,) = address(editions)
            .call(
                abi.encodeCall(
                    editions.mintEdition, (COLLECTOR, 2, 1, EDITION_TWO_URI, EDITION_TWO_TERMS, 2, editionTwoProof)
                )
            );
        require(!exceededSupply && editions.totalMinted() == 5, "supply cap exceeded");
    }

    function testEditionIdCannotSwitchToAlternateManifestConfiguration() public {
        bytes32 firstLeaf = _leaf(1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3);
        bytes32 alternateTerms = keccak256("ALTERNATE_COMMERCIAL_TERMS");
        bytes32 alternateLeaf = _leaf(1, EDITION_TWO_URI, alternateTerms, 5);
        IRMTV7ERC1155EditionModule.EditionConfig memory config = _config();
        config.editionManifestRoot = _hashPair(firstLeaf, alternateLeaf);
        config.maximumEditionTypes = 1;
        config.maximumTotalSupply = 8;
        bytes32 releaseId = _freezeEditionRelease(config);
        RMTV7CreatorEditions editions = RMTV7CreatorEditions(editionModule.deployEditions(releaseId, config));

        bytes32[] memory firstProof = new bytes32[](1);
        firstProof[0] = alternateLeaf;
        editions.mintEdition(COLLECTOR, 1, 1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3, firstProof);

        bytes32[] memory alternateProof = new bytes32[](1);
        alternateProof[0] = firstLeaf;
        (bool configurationSwitched,) = address(editions)
            .call(
                abi.encodeCall(
                    editions.mintEdition, (COLLECTOR, 1, 1, EDITION_TWO_URI, alternateTerms, 5, alternateProof)
                )
            );
        require(!configurationSwitched, "edition configuration switched");
        require(editions.editionMintedSupply(1) == 1, "failed switch changed supply");
        require(editions.editionMaximumSupply(1) == 3, "failed switch changed cap");
        require(editions.editionTermsHash(1) == EDITION_ONE_TERMS, "failed switch changed terms");
    }

    function testEditionTypeAndCollectionWideSupplyCapsAreIndependent() public {
        bytes32 thirdTerms = keccak256("GAME_ASSET_COLLECTOR_TERMS_V1");
        string memory thirdURI = "ipfs://bafy-edition-three/metadata.json";
        bytes32 firstLeaf = _leaf(1, EDITION_ONE_URI, EDITION_ONE_TERMS, 2);
        bytes32 secondLeaf = _leaf(2, EDITION_TWO_URI, EDITION_TWO_TERMS, 2);
        bytes32 thirdLeaf = _leaf(3, thirdURI, thirdTerms, 2);
        bytes32 firstPair = _hashPair(firstLeaf, secondLeaf);
        bytes32 root = _hashPair(firstPair, thirdLeaf);

        IRMTV7ERC1155EditionModule.EditionConfig memory totalCapConfig = _config();
        totalCapConfig.editionManifestRoot = root;
        totalCapConfig.maximumEditionTypes = 3;
        totalCapConfig.maximumTotalSupply = 3;
        bytes32 totalCapReleaseId = _freezeEditionRelease(totalCapConfig);
        RMTV7CreatorEditions totalCapped =
            RMTV7CreatorEditions(editionModule.deployEditions(totalCapReleaseId, totalCapConfig));

        bytes32[] memory firstProof = new bytes32[](2);
        firstProof[0] = secondLeaf;
        firstProof[1] = thirdLeaf;
        totalCapped.mintEdition(COLLECTOR, 1, 2, EDITION_ONE_URI, EDITION_ONE_TERMS, 2, firstProof);
        bytes32[] memory secondProof = new bytes32[](2);
        secondProof[0] = firstLeaf;
        secondProof[1] = thirdLeaf;
        totalCapped.mintEdition(COLLECTOR, 2, 1, EDITION_TWO_URI, EDITION_TWO_TERMS, 2, secondProof);
        (bool totalCapExceeded,) = address(totalCapped)
            .call(
                abi.encodeCall(
                    totalCapped.mintEdition, (COLLECTOR, 2, 1, EDITION_TWO_URI, EDITION_TWO_TERMS, 2, secondProof)
                )
            );
        require(!totalCapExceeded, "collection total cap exceeded");
        require(totalCapped.editionMintedSupply(2) == 1, "failed total-cap mint changed edition supply");

        IRMTV7ERC1155EditionModule.EditionConfig memory typeCapConfig = totalCapConfig;
        typeCapConfig.maximumEditionTypes = 2;
        typeCapConfig.maximumTotalSupply = 6;
        bytes32 typeCapReleaseId = _freezeEditionRelease(typeCapConfig);
        RMTV7CreatorEditions typeCapped =
            RMTV7CreatorEditions(editionModule.deployEditions(typeCapReleaseId, typeCapConfig));
        typeCapped.mintEdition(COLLECTOR, 1, 1, EDITION_ONE_URI, EDITION_ONE_TERMS, 2, firstProof);
        typeCapped.mintEdition(COLLECTOR, 2, 1, EDITION_TWO_URI, EDITION_TWO_TERMS, 2, secondProof);
        bytes32[] memory thirdProof = new bytes32[](1);
        thirdProof[0] = firstPair;
        (bool typeCapExceeded,) = address(typeCapped)
            .call(abi.encodeCall(typeCapped.mintEdition, (COLLECTOR, 3, 1, thirdURI, thirdTerms, 2, thirdProof)));
        require(!typeCapExceeded, "edition type cap exceeded");
        require(!typeCapped.editionRegistered(3), "failed type-cap mint registered edition");
        require(typeCapped.editionTypeCount() == 2, "failed type-cap mint changed type count");
    }

    function testOnlyFrozenCreatorCanDeployExactConfigurationOnce() public {
        IRMTV7ERC1155EditionModule.EditionConfig memory config = _config();
        bytes32 releaseId = _freezeEditionRelease(config);

        vm.prank(OTHER_CREATOR);
        (bool otherCreatorDeployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (releaseId, config)));
        require(!otherCreatorDeployed, "other creator deployed editions");

        IRMTV7ERC1155EditionModule.EditionConfig memory changed = _config();
        changed.maximumTotalSupply = 6;
        (bool changedConfigDeployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (releaseId, changed)));
        require(!changedConfigDeployed, "unfrozen configuration deployed");

        editionModule.deployEditions(releaseId, config);
        (bool duplicateDeployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (releaseId, config)));
        require(!duplicateDeployed, "second edition contract deployed for release");
    }

    function testInactiveModuleBlocksDeploymentWithoutRewritingFrozenRelease() public {
        IRMTV7ERC1155EditionModule.EditionConfig memory config = _config();
        bytes32 releaseId = _freezeEditionRelease(config);
        bytes32 configurationHash = editionModule.hashEditionConfig(config);

        governance.execute(address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey)));
        require(
            releaseRegistry.isFrozenModuleIntent(releaseId, address(this), moduleKey, configurationHash),
            "release history changed"
        );
        (bool deployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (releaseId, config)));
        require(!deployed, "inactive module deployed editions");
    }

    function testMintRejectsWrongProofWrongCreatorAndUnsafeReceiverWithoutChangingSupply() public {
        IRMTV7ERC1155EditionModule.EditionConfig memory config = _config();
        bytes32 releaseId = _freezeEditionRelease(config);
        RMTV7CreatorEditions editions = RMTV7CreatorEditions(editionModule.deployEditions(releaseId, config));

        bytes32[] memory wrongProof = new bytes32[](1);
        wrongProof[0] = keccak256("WRONG");
        (bool wrongProofMinted,) = address(editions)
            .call(
                abi.encodeCall(
                    editions.mintEdition, (COLLECTOR, 1, 1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3, wrongProof)
                )
            );
        require(!wrongProofMinted && editions.totalMinted() == 0, "wrong proof changed supply");

        bytes32[] memory validProof = new bytes32[](1);
        validProof[0] = _leaf(2, EDITION_TWO_URI, EDITION_TWO_TERMS, 2);
        vm.prank(OTHER_CREATOR);
        (bool otherCreatorMinted,) = address(editions)
            .call(
                abi.encodeCall(
                    editions.mintEdition, (COLLECTOR, 1, 1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3, validProof)
                )
            );
        require(!otherCreatorMinted && editions.totalMinted() == 0, "other creator minted");

        V7RejectingEditionReceiver receiver = new V7RejectingEditionReceiver();
        (bool unsafeReceiverMinted,) = address(editions)
            .call(
                abi.encodeCall(
                    editions.mintEdition, (address(receiver), 1, 1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3, validProof)
                )
            );
        require(!unsafeReceiverMinted && editions.totalMinted() == 0, "unsafe mint did not roll back");
        require(editions.editionTypeCount() == 0, "unsafe registration did not roll back");

        editions.mintEdition(COLLECTOR, 1, 1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3, validProof);
        require(editions.totalMinted() == 1, "valid mint failed after rollbacks");
    }

    function testModuleRejectsInvalidEconomicsMetadataAndUnfrozenRelease() public {
        IRMTV7ERC1155EditionModule.EditionConfig memory config = _config();
        bytes32 unfrozenReleaseId = _commitRelease();
        (bool unfrozenDeployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (unfrozenReleaseId, config)));
        require(!unfrozenDeployed, "unfrozen release deployed");

        config.royaltyBps = editionModule.MAXIMUM_ROYALTY_BPS() + 1;
        (bool excessiveRoyaltyDeployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (unfrozenReleaseId, config)));
        require(!excessiveRoyaltyDeployed, "excessive royalty accepted");

        config = _config();
        config.maximumEditionTypes = editionModule.MAXIMUM_EDITION_TYPES() + 1;
        (bool excessiveTypesDeployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (unfrozenReleaseId, config)));
        require(!excessiveTypesDeployed, "excessive edition types accepted");

        config = _config();
        config.maximumTotalSupply = editionModule.MAXIMUM_TOTAL_SUPPLY() + 1;
        (bool excessiveSupplyDeployed,) =
            address(editionModule).call(abi.encodeCall(editionModule.deployEditions, (unfrozenReleaseId, config)));
        require(!excessiveSupplyDeployed, "excessive total supply accepted");
    }

    function testModuleAndEditionsRejectNativeAssetCustody() public {
        IRMTV7ERC1155EditionModule.EditionConfig memory config = _config();
        bytes32 releaseId = _freezeEditionRelease(config);
        address editions = editionModule.deployEditions(releaseId, config);
        vm.deal(address(this), 2 wei);

        (bool moduleReceived,) = address(editionModule).call{value: 1 wei}("");
        (bool editionsReceived,) = editions.call{value: 1 wei}("");
        require(!moduleReceived && !editionsReceived, "native asset accepted");
        require(address(editionModule).balance == 0 && editions.balance == 0, "native asset retained");
    }

    function testModuleAdvertisesReviewedInterfaceAndPinsItself() public view {
        bytes4 moduleInterface = type(IRMTV7ERC1155EditionModule).interfaceId;
        require(editionModule.supportsInterface(0x01ffc9a7), "ERC165 missing");
        require(editionModule.supportsInterface(moduleInterface), "module interface missing");
        require(!editionModule.supportsInterface(0xffffffff), "invalid interface advertised");

        bytes32 versionKey = keccak256(abi.encode(editionModule.MODULE_KIND(), editionModule.MODULE_VERSION()));
        require(moduleRegistry.moduleKeyByKindAndVersion(versionKey) == moduleKey, "wrong canonical module");
        require(moduleRegistry.getModule(moduleKey).implementation == address(editionModule), "module substituted");
    }

    function testEditionManifestAndConfigurationMatchPublicEncodingVector() public {
        bytes32 editionOneTerms = bytes32(uint256(type(uint256).max) / 0xff * 0x11);
        bytes32 editionTwoTerms = bytes32(uint256(type(uint256).max) / 0xff * 0x22);
        bytes32 editionOneLeaf = _leaf(1, EDITION_ONE_URI, editionOneTerms, 3);
        bytes32 editionTwoLeaf = _leaf(2, EDITION_TWO_URI, editionTwoTerms, 2);
        require(
            editionOneLeaf == 0xbb56348a17aeacb5ec7da3652afad1e871801a053e3a6ab351e4f9a953dd4209,
            "edition one leaf changed"
        );
        require(
            editionTwoLeaf == 0xb0e7d1d1ef74f9b3af327ac9182aea3a6887531369a467a5da6737ff5ebd6c4e,
            "edition two leaf changed"
        );

        IRMTV7ERC1155EditionModule.EditionConfig memory config = IRMTV7ERC1155EditionModule.EditionConfig({
            name: "RMT Creator Editions",
            symbol: "RMTED",
            collectionURI: "ipfs://bafy-editions/contract.json",
            editionManifestRoot: _hashPair(editionOneLeaf, editionTwoLeaf),
            maximumEditionTypes: 2,
            maximumTotalSupply: 5,
            royaltyReceiver: address(0x1111111111111111111111111111111111111111),
            royaltyBps: 500
        });
        require(
            config.editionManifestRoot == 0x04a260ca9b2a885161ecf1df5dd28da708b5d2b753081462fc5ccde70690ca00,
            "edition root changed"
        );
        require(
            editionModule.hashEditionConfig(config)
                == 0x67cf2e32f092b4cf0bb1e4c6accab8759c07fbf96e623b9088179e3c917bfea1,
            "edition configuration hash changed"
        );

        bytes32 releaseId = _freezeEditionRelease(config);
        RMTV7CreatorEditions editions = RMTV7CreatorEditions(editionModule.deployEditions(releaseId, config));
        require(
            editions.hashEditionManifestLeaf(1, keccak256(bytes(EDITION_ONE_URI)), editionOneTerms, 3)
                == editionOneLeaf,
            "contract leaf changed"
        );
    }

    function _registerEditionModule() private returns (bytes32 registeredModuleKey) {
        bytes memory output = governance.execute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    editionModule.MODULE_KIND(),
                    editionModule.MODULE_VERSION(),
                    address(editionModule),
                    type(IRMTV7ERC1155EditionModule).interfaceId,
                    keccak256("RMT_ERC1155_EDITION_POLICY_V1"),
                    keccak256("RMT_ERC1155_EDITION_MODULE_METADATA_V1")
                )
            )
        );
        registeredModuleKey = abi.decode(output, (bytes32));
    }

    function _freezeEditionRelease(IRMTV7ERC1155EditionModule.EditionConfig memory config)
        private
        returns (bytes32 releaseId)
    {
        releaseId = _commitRelease();
        bytes32 configurationHash = editionModule.hashEditionConfig(config);
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = new RMTV7ReleaseRegistry.ModuleIntent[](1);
        intents[0] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, configurationHash);
        IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence = IRMTV7MediaEvidenceVerifier.MediaEvidence({
            receiptHash: keccak256("VERIFIED_MEDIA_RECEIPT"),
            availabilityObservationHash: keccak256("HEALTHY_AVAILABILITY_OBSERVATION"),
            observedAt: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 days),
            signerEpoch: mediaEvidenceVerifier.signerEpoch()
        });
        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(releaseId);
        bytes32 digest = mediaEvidenceVerifier.evidenceDigest(
            address(releaseRegistry),
            releaseId,
            release.creator,
            release.metadataHash,
            release.mediaManifestHash,
            evidence
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EVIDENCE_SIGNER_KEY, digest);
        releaseRegistry.freezeRelease(releaseId, intents, evidence, abi.encodePacked(r, s, v));
        require(
            releaseRegistry.isFrozenModuleIntent(releaseId, address(this), moduleKey, configurationHash),
            "frozen intent unavailable"
        );
    }

    function _commitRelease() private returns (bytes32 releaseId) {
        releaseId = releaseRegistry.commitRelease(
            keccak256("PROJECT"),
            keccak256("ASSET"),
            keccak256("RIGHTS_REVISION"),
            keccak256("METADATA"),
            keccak256("MEDIA_MANIFEST"),
            keccak256("FEE_POLICY"),
            keccak256("PAYOUT_MANIFEST")
        );
    }

    function _config() private view returns (IRMTV7ERC1155EditionModule.EditionConfig memory config) {
        bytes32 leafOne = _leaf(1, EDITION_ONE_URI, EDITION_ONE_TERMS, 3);
        bytes32 leafTwo = _leaf(2, EDITION_TWO_URI, EDITION_TWO_TERMS, 2);
        config = IRMTV7ERC1155EditionModule.EditionConfig({
            name: "RMT Creator Editions",
            symbol: "RMTED",
            collectionURI: "ipfs://bafy-editions/contract.json",
            editionManifestRoot: _hashPair(leafOne, leafTwo),
            maximumEditionTypes: 2,
            maximumTotalSupply: 5,
            royaltyReceiver: address(this),
            royaltyBps: 500
        });
    }

    function _leaf(uint256 tokenId, string memory tokenURI_, bytes32 termsHash, uint64 editionSupply)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            bytes.concat(keccak256(abi.encode(tokenId, keccak256(bytes(tokenURI_)), termsHash, editionSupply)))
        );
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(bytes.concat(a, b)) : keccak256(bytes.concat(b, a));
    }
}
