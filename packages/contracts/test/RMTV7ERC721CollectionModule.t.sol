// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IRMTV7ERC721CollectionModule} from "../src/interfaces/IRMTV7ERC721CollectionModule.sol";
import {RMTV7CreatorCollection} from "../src/RMTV7CreatorCollection.sol";
import {RMTV7ERC721CollectionModule} from "../src/RMTV7ERC721CollectionModule.sol";
import {RMTV7ModuleRegistry} from "../src/RMTV7ModuleRegistry.sol";
import {RMTV7ReleaseRegistry} from "../src/RMTV7ReleaseRegistry.sol";

interface V7CollectionVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
}

contract V7CollectionGovernance {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory output) = target.call(data);
        require(success, "governance call failed");
        return output;
    }
}

contract V7RejectingCollectionReceiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }
}

contract RMTV7ERC721CollectionModuleTest {
    V7CollectionVm private constant vm = V7CollectionVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OTHER_CREATOR = address(0xB0B);
    address private constant COLLECTOR = address(0xCAFE);
    string private constant TOKEN_ONE_URI = "ipfs://bafy-token-one/metadata.json";
    string private constant TOKEN_TWO_URI = "ipfs://bafy-token-two/metadata.json";

    V7CollectionGovernance private governance;
    RMTV7ModuleRegistry private moduleRegistry;
    RMTV7ReleaseRegistry private releaseRegistry;
    RMTV7ERC721CollectionModule private collectionModule;
    bytes32 private moduleKey;

    function setUp() public {
        governance = new V7CollectionGovernance();
        moduleRegistry = new RMTV7ModuleRegistry(address(governance));
        releaseRegistry = new RMTV7ReleaseRegistry(address(moduleRegistry));
        collectionModule = new RMTV7ERC721CollectionModule(address(moduleRegistry), address(releaseRegistry));
        moduleKey = _registerCollectionModule();
    }

    function testCreatorDeploysFrozenCollectionAndMintsOnlyManifestTokens() public {
        IRMTV7ERC721CollectionModule.CollectionConfig memory config = _config();
        bytes32 releaseId = _freezeCollectionRelease(config);

        address collectionAddress = collectionModule.deployCollection(releaseId, config);
        RMTV7CreatorCollection collection = RMTV7CreatorCollection(collectionAddress);
        require(collectionModule.collectionForRelease(releaseId) == collectionAddress, "collection not recorded");
        require(collection.releaseId() == releaseId, "release not bound");
        require(collection.originalCreator() == address(this), "creator not bound");
        require(collection.maximumSupply() == 2, "supply not bound");
        require(collection.tokenManifestRoot() == config.tokenManifestRoot, "manifest not bound");
        require(keccak256(bytes(collection.name())) == keccak256(bytes(config.name)), "wrong name");
        require(keccak256(bytes(collection.symbol())) == keccak256(bytes(config.symbol)), "wrong symbol");
        require(keccak256(bytes(collection.collectionURI())) == keccak256(bytes(config.collectionURI)), "wrong URI");

        bytes32[] memory tokenOneProof = new bytes32[](1);
        tokenOneProof[0] = _leaf(2, TOKEN_TWO_URI);
        uint256 tokenId = collection.mint(COLLECTOR, TOKEN_ONE_URI, tokenOneProof);
        require(tokenId == 1 && collection.ownerOf(1) == COLLECTOR, "token one not minted");
        require(keccak256(bytes(collection.tokenURI(1))) == keccak256(bytes(TOKEN_ONE_URI)), "token URI changed");

        bytes32[] memory tokenTwoProof = new bytes32[](1);
        tokenTwoProof[0] = _leaf(1, TOKEN_ONE_URI);
        collection.mint(COLLECTOR, TOKEN_TWO_URI, tokenTwoProof);
        require(collection.totalMinted() == 2 && collection.ownerOf(2) == COLLECTOR, "token two not minted");

        (address royaltyReceiver, uint256 royaltyAmount) = collection.royaltyInfo(1, 1 ether);
        require(royaltyReceiver == address(this) && royaltyAmount == 0.05 ether, "royalty signal mismatch");

        (bool exceededSupply,) =
            address(collection).call(abi.encodeCall(collection.mint, (COLLECTOR, TOKEN_TWO_URI, tokenTwoProof)));
        require(!exceededSupply, "supply cap exceeded");
    }

    function testOnlyFrozenCreatorCanDeployExactConfiguration() public {
        IRMTV7ERC721CollectionModule.CollectionConfig memory config = _config();
        bytes32 releaseId = _freezeCollectionRelease(config);

        vm.prank(OTHER_CREATOR);
        (bool otherCreatorDeployed,) =
            address(collectionModule).call(abi.encodeCall(collectionModule.deployCollection, (releaseId, config)));
        require(!otherCreatorDeployed, "other creator deployed collection");

        IRMTV7ERC721CollectionModule.CollectionConfig memory changed = _config();
        changed.maximumSupply = 3;
        (bool changedConfigDeployed,) =
            address(collectionModule).call(abi.encodeCall(collectionModule.deployCollection, (releaseId, changed)));
        require(!changedConfigDeployed, "unfrozen configuration deployed");

        collectionModule.deployCollection(releaseId, config);
        (bool duplicateDeployed,) =
            address(collectionModule).call(abi.encodeCall(collectionModule.deployCollection, (releaseId, config)));
        require(!duplicateDeployed, "second collection deployed for release");
    }

    function testInactiveModuleBlocksNewDeploymentButDoesNotRewriteFrozenRelease() public {
        IRMTV7ERC721CollectionModule.CollectionConfig memory config = _config();
        bytes32 releaseId = _freezeCollectionRelease(config);
        bytes32 configurationHash = collectionModule.hashCollectionConfig(config);

        governance.execute(address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey)));
        require(
            releaseRegistry.isFrozenModuleIntent(releaseId, address(this), moduleKey, configurationHash),
            "release history changed"
        );
        (bool deployed,) =
            address(collectionModule).call(abi.encodeCall(collectionModule.deployCollection, (releaseId, config)));
        require(!deployed, "inactive module deployed collection");
    }

    function testMintRejectsWrongProofWrongCreatorAndUnsafeReceiver() public {
        IRMTV7ERC721CollectionModule.CollectionConfig memory config = _config();
        bytes32 releaseId = _freezeCollectionRelease(config);
        RMTV7CreatorCollection collection = RMTV7CreatorCollection(collectionModule.deployCollection(releaseId, config));

        bytes32[] memory wrongProof = new bytes32[](1);
        wrongProof[0] = keccak256("WRONG");
        (bool wrongProofMinted,) =
            address(collection).call(abi.encodeCall(collection.mint, (COLLECTOR, TOKEN_ONE_URI, wrongProof)));
        require(!wrongProofMinted && collection.totalMinted() == 0, "wrong proof changed supply");

        bytes32[] memory validProof = new bytes32[](1);
        validProof[0] = _leaf(2, TOKEN_TWO_URI);
        vm.prank(OTHER_CREATOR);
        (bool otherCreatorMinted,) =
            address(collection).call(abi.encodeCall(collection.mint, (COLLECTOR, TOKEN_ONE_URI, validProof)));
        require(!otherCreatorMinted && collection.totalMinted() == 0, "other creator minted");

        V7RejectingCollectionReceiver receiver = new V7RejectingCollectionReceiver();
        (bool unsafeReceiverMinted,) =
            address(collection).call(abi.encodeCall(collection.mint, (address(receiver), TOKEN_ONE_URI, validProof)));
        require(!unsafeReceiverMinted && collection.totalMinted() == 0, "unsafe mint did not roll back");

        collection.mint(COLLECTOR, TOKEN_ONE_URI, validProof);
        require(collection.totalMinted() == 1, "valid mint failed after rollbacks");
    }

    function testModuleRejectsInvalidEconomicsMetadataAndUnfrozenRelease() public {
        IRMTV7ERC721CollectionModule.CollectionConfig memory config = _config();
        bytes32 unfrozenReleaseId = _commitRelease();
        (bool unfrozenDeployed,) = address(collectionModule)
            .call(abi.encodeCall(collectionModule.deployCollection, (unfrozenReleaseId, config)));
        require(!unfrozenDeployed, "unfrozen release deployed");

        config.royaltyBps = collectionModule.MAXIMUM_ROYALTY_BPS() + 1;
        (bool excessiveRoyaltyDeployed,) = address(collectionModule)
            .call(abi.encodeCall(collectionModule.deployCollection, (unfrozenReleaseId, config)));
        require(!excessiveRoyaltyDeployed, "excessive royalty accepted");

        config = _config();
        config.maximumSupply = collectionModule.MAXIMUM_COLLECTION_SUPPLY() + 1;
        (bool excessiveSupplyDeployed,) = address(collectionModule)
            .call(abi.encodeCall(collectionModule.deployCollection, (unfrozenReleaseId, config)));
        require(!excessiveSupplyDeployed, "excessive supply accepted");
    }

    function testModuleAndCollectionRejectNativeAssetCustody() public {
        IRMTV7ERC721CollectionModule.CollectionConfig memory config = _config();
        bytes32 releaseId = _freezeCollectionRelease(config);
        address collection = collectionModule.deployCollection(releaseId, config);
        vm.deal(address(this), 2 wei);

        (bool moduleReceived,) = address(collectionModule).call{value: 1 wei}("");
        (bool collectionReceived,) = collection.call{value: 1 wei}("");
        require(!moduleReceived && !collectionReceived, "native asset accepted");
        require(address(collectionModule).balance == 0 && collection.balance == 0, "native asset retained");
    }

    function testModuleAdvertisesReviewedInterfaceAndPinsItself() public view {
        bytes4 moduleInterface = type(IRMTV7ERC721CollectionModule).interfaceId;
        require(collectionModule.supportsInterface(0x01ffc9a7), "ERC165 missing");
        require(collectionModule.supportsInterface(moduleInterface), "module interface missing");
        require(!collectionModule.supportsInterface(0xffffffff), "invalid interface advertised");

        bytes32 versionKey = keccak256(abi.encode(collectionModule.MODULE_KIND(), collectionModule.MODULE_VERSION()));
        require(moduleRegistry.moduleKeyByKindAndVersion(versionKey) == moduleKey, "wrong canonical module");
        require(moduleRegistry.getModule(moduleKey).implementation == address(collectionModule), "module substituted");
    }

    function _registerCollectionModule() private returns (bytes32 registeredModuleKey) {
        bytes memory output = governance.execute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    collectionModule.MODULE_KIND(),
                    collectionModule.MODULE_VERSION(),
                    address(collectionModule),
                    type(IRMTV7ERC721CollectionModule).interfaceId,
                    keccak256("RMT_ERC721_COLLECTION_POLICY_V1"),
                    keccak256("RMT_ERC721_COLLECTION_MODULE_METADATA_V1")
                )
            )
        );
        registeredModuleKey = abi.decode(output, (bytes32));
    }

    function _freezeCollectionRelease(IRMTV7ERC721CollectionModule.CollectionConfig memory config)
        private
        returns (bytes32 releaseId)
    {
        releaseId = _commitRelease();
        bytes32 configurationHash = collectionModule.hashCollectionConfig(config);
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = new RMTV7ReleaseRegistry.ModuleIntent[](1);
        intents[0] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, configurationHash);
        releaseRegistry.freezeRelease(releaseId, intents);
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

    function _config() private view returns (IRMTV7ERC721CollectionModule.CollectionConfig memory config) {
        bytes32 leafOne = _leaf(1, TOKEN_ONE_URI);
        bytes32 leafTwo = _leaf(2, TOKEN_TWO_URI);
        config = IRMTV7ERC721CollectionModule.CollectionConfig({
            name: "RMT Creator Collection",
            symbol: "RMTCC",
            collectionURI: "ipfs://bafy-collection/contract.json",
            tokenManifestRoot: _hashPair(leafOne, leafTwo),
            maximumSupply: 2,
            royaltyReceiver: address(this),
            royaltyBps: 500
        });
    }

    function _leaf(uint256 tokenId, string memory tokenURI_) private pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(tokenId, keccak256(bytes(tokenURI_))))));
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(bytes.concat(a, b)) : keccak256(bytes.concat(b, a));
    }
}
