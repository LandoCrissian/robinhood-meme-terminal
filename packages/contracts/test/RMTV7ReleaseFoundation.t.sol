// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTV7ModuleRegistry} from "../src/interfaces/IRMTV7ModuleRegistry.sol";
import {RMTV7ModuleRegistry} from "../src/RMTV7ModuleRegistry.sol";
import {RMTV7ReleaseRegistry} from "../src/RMTV7ReleaseRegistry.sol";

interface V7ReleaseFoundationVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
}

contract V7GovernanceCaller {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory output) = target.call(data);
        require(success, "governance call failed");
        return output;
    }

    function tryExecute(address target, bytes calldata data) external returns (bool success) {
        (success,) = target.call(data);
    }
}

contract V7ReviewedModuleMock {
    bytes4 public immutable reviewedInterfaceId;
    bool public touched;

    constructor(bytes4 reviewedInterfaceId_) {
        reviewedInterfaceId = reviewedInterfaceId_;
    }

    function supportsInterface(bytes4 interfaceId) external view returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == reviewedInterfaceId;
    }

    function touch() external {
        touched = true;
    }
}

contract V7FakeModuleRegistry {
    function governance() external pure returns (address) {
        return address(0xBEEF);
    }
}

contract RMTV7ReleaseFoundationTest {
    V7ReleaseFoundationVm private constant vm =
        V7ReleaseFoundationVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes4 private constant COLLECTION_INTERFACE_ID = 0x80ac58cd;
    bytes4 private constant EDITION_INTERFACE_ID = 0xd9b67a26;
    address private constant OTHER_CREATOR = address(0xB0B);

    V7GovernanceCaller private governance;
    RMTV7ModuleRegistry private moduleRegistry;
    RMTV7ReleaseRegistry private releaseRegistry;

    function setUp() public {
        governance = new V7GovernanceCaller();
        moduleRegistry = new RMTV7ModuleRegistry(address(governance));
        releaseRegistry = new RMTV7ReleaseRegistry(address(moduleRegistry));
    }

    function testModuleRegistrationIsGovernedVersionedAndCodePinned() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);

        (bool unauthorized,) = address(moduleRegistry)
            .call(
                abi.encodeCall(
                    moduleRegistry.registerModule,
                    (
                        moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                        1,
                        address(implementation),
                        COLLECTION_INTERFACE_ID,
                        keccak256("COLLECTION_POLICY_V1"),
                        keccak256("COLLECTION_METADATA_V1")
                    )
                )
            );
        require(!unauthorized, "non-governance registered module");

        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("COLLECTION_POLICY_V1"),
            keccak256("COLLECTION_METADATA_V1")
        );
        IRMTV7ModuleRegistry.Module memory module = moduleRegistry.getModule(moduleKey);
        require(module.implementation == address(implementation), "wrong implementation");
        require(module.implementationCodeHash == address(implementation).codehash, "code hash not pinned");
        require(module.active && module.registeredAt != 0, "module not active");
        require(
            moduleRegistry.moduleKeyByKindAndVersion(
                keccak256(abi.encode(moduleRegistry.MODULE_KIND_ERC721_COLLECTION(), uint32(1)))
            ) == moduleKey,
            "kind and version not canonical"
        );

        V7ReviewedModuleMock substitute = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bool duplicateAccepted = governance.tryExecute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                    1,
                    address(substitute),
                    COLLECTION_INTERFACE_ID,
                    keccak256("SUBSTITUTE_POLICY"),
                    keccak256("SUBSTITUTE_METADATA")
                )
            )
        );
        require(!duplicateAccepted, "module version overwritten");
    }

    function testModuleRegistrationRejectsNoCodeAndFalseInterfaceClaims() public {
        bool noCodeAccepted = governance.tryExecute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                    1,
                    address(0xCAFE),
                    COLLECTION_INTERFACE_ID,
                    keccak256("POLICY"),
                    keccak256("METADATA")
                )
            )
        );
        require(!noCodeAccepted, "implementation without code accepted");

        V7ReviewedModuleMock editionOnly = new V7ReviewedModuleMock(EDITION_INTERFACE_ID);
        bool falseInterfaceAccepted = governance.tryExecute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
                    1,
                    address(editionOnly),
                    COLLECTION_INTERFACE_ID,
                    keccak256("POLICY"),
                    keccak256("METADATA")
                )
            )
        );
        require(!falseInterfaceAccepted, "unsupported interface accepted");
    }

    function testModuleDeactivationIsPermanentAndPreservesFingerprint() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );
        IRMTV7ModuleRegistry.Module memory beforeDeactivation = moduleRegistry.getModule(moduleKey);

        governance.execute(address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey)));
        IRMTV7ModuleRegistry.Module memory afterDeactivation = moduleRegistry.getModule(moduleKey);
        require(!afterDeactivation.active && afterDeactivation.deactivatedAt != 0, "module still active");
        require(
            afterDeactivation.implementationCodeHash == beforeDeactivation.implementationCodeHash, "history changed"
        );

        bool reDeactivated = governance.tryExecute(
            address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey))
        );
        require(!reDeactivated, "inactive module changed twice");
    }

    function testReleaseCommitmentIsCreatorOwnedImmutableAndNonceScoped() public {
        bytes32 firstReleaseId = _commitRelease();
        bytes32 secondReleaseId = _commitRelease();
        require(firstReleaseId != secondReleaseId, "creator nonce did not separate releases");
        require(releaseRegistry.creatorNonces(address(this)) == 2, "wrong next nonce");

        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(firstReleaseId);
        require(release.creator == address(this), "wrong creator");
        require(release.projectIdHash == keccak256("PROJECT"), "wrong project hash");
        require(release.rightsRevisionHash == keccak256("RIGHTS_REVISION"), "wrong rights hash");
        require(release.state == releaseRegistry.RELEASE_STATE_COMMITTED(), "wrong initial state");

        vm.prank(OTHER_CREATOR);
        (bool cancelledByOther,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.cancelRelease, (firstReleaseId)));
        require(!cancelledByOther, "noncreator cancelled release");
    }

    function testFreezeAtomicallyBindsCompleteActiveModulePlanWithoutCallingModule() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );
        bytes32 releaseId = _commitRelease();
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = _singleIntent(moduleKey);
        bytes32 expectedManifestHash = keccak256(abi.encode(intents));

        bytes32 manifestHash = releaseRegistry.freezeRelease(releaseId, intents);
        require(manifestHash == expectedManifestHash, "wrong module manifest hash");
        require(!implementation.touched(), "registered implementation was called");

        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(releaseId);
        require(release.state == releaseRegistry.RELEASE_STATE_FROZEN(), "release not frozen");
        require(release.moduleManifestHash == expectedManifestHash, "manifest not stored");
        require(release.frozenAt != 0, "freeze time missing");

        RMTV7ReleaseRegistry.ModuleIntent[] memory stored = releaseRegistry.getModuleIntents(releaseId);
        require(stored.length == 1, "wrong intent count");
        require(stored[0].moduleKey == moduleKey, "wrong stored module");
        require(stored[0].configurationHash == keccak256("CONFIGURATION"), "wrong configuration hash");

        (bool cancelledAfterFreeze,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.cancelRelease, (releaseId)));
        require(!cancelledAfterFreeze, "frozen release cancelled");
        (bool frozenTwice,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.freezeRelease, (releaseId, intents)));
        require(!frozenTwice, "release frozen twice");
    }

    function testFreezeRejectsInactiveDuplicateEmptyAndOversizedPlans() public {
        V7ReviewedModuleMock implementation = new V7ReviewedModuleMock(COLLECTION_INTERFACE_ID);
        bytes32 moduleKey = _registerModule(
            moduleRegistry.MODULE_KIND_ERC721_COLLECTION(),
            1,
            address(implementation),
            COLLECTION_INTERFACE_ID,
            keccak256("POLICY"),
            keccak256("METADATA")
        );

        RMTV7ReleaseRegistry.ModuleIntent[] memory empty = new RMTV7ReleaseRegistry.ModuleIntent[](0);
        (bool emptyAccepted,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.freezeRelease, (_commitRelease(), empty)));
        require(!emptyAccepted, "empty module plan accepted");

        RMTV7ReleaseRegistry.ModuleIntent[] memory duplicate = new RMTV7ReleaseRegistry.ModuleIntent[](2);
        duplicate[0] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, keccak256("ONE"));
        duplicate[1] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, keccak256("TWO"));
        (bool duplicateAccepted,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.freezeRelease, (_commitRelease(), duplicate)));
        require(!duplicateAccepted, "duplicate module plan accepted");

        governance.execute(address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey)));
        (bool inactiveAccepted,) = address(releaseRegistry)
            .call(abi.encodeCall(releaseRegistry.freezeRelease, (_commitRelease(), _singleIntent(moduleKey))));
        require(!inactiveAccepted, "inactive module accepted");

        RMTV7ReleaseRegistry.ModuleIntent[] memory oversized =
            new RMTV7ReleaseRegistry.ModuleIntent[](releaseRegistry.MAXIMUM_MODULES_PER_RELEASE() + 1);
        for (uint256 i; i < oversized.length; ++i) {
            oversized[i] = RMTV7ReleaseRegistry.ModuleIntent(bytes32(i + 1), bytes32(i + 100));
        }
        (bool oversizedAccepted,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.freezeRelease, (_commitRelease(), oversized)));
        require(!oversizedAccepted, "oversized module plan accepted");
    }

    function testCancelledReleasePreservesHistoryAndCannotFreeze() public {
        bytes32 releaseId = _commitRelease();
        releaseRegistry.cancelRelease(releaseId);
        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(releaseId);
        require(release.state == releaseRegistry.RELEASE_STATE_CANCELLED(), "release not cancelled");
        require(release.cancelledAt != 0, "cancel time missing");

        RMTV7ReleaseRegistry.ModuleIntent[] memory plan = new RMTV7ReleaseRegistry.ModuleIntent[](1);
        plan[0] = RMTV7ReleaseRegistry.ModuleIntent(keccak256("UNKNOWN"), keccak256("CONFIGURATION"));
        (bool frozenAfterCancel,) =
            address(releaseRegistry).call(abi.encodeCall(releaseRegistry.freezeRelease, (releaseId, plan)));
        require(!frozenAfterCancel, "cancelled release frozen");
    }

    function testContractsRejectNativeAssetCustody() public {
        vm.deal(address(this), 2 wei);
        (bool moduleReceived,) = address(moduleRegistry).call{value: 1 wei}("");
        (bool releaseReceived,) = address(releaseRegistry).call{value: 1 wei}("");
        require(!moduleReceived && !releaseReceived, "registry accepted native assets");
        require(
            address(moduleRegistry).balance == 0 && address(releaseRegistry).balance == 0, "registry retained funds"
        );
    }

    function testConstructorsRejectUntrustedShape() public {
        bytes memory moduleCreationCode =
            abi.encodePacked(type(RMTV7ModuleRegistry).creationCode, abi.encode(address(1)));
        address deployed;
        assembly ("memory-safe") {
            deployed := create(0, add(moduleCreationCode, 0x20), mload(moduleCreationCode))
        }
        require(deployed == address(0), "EOA governance accepted");

        bytes memory releaseCreationCode =
            abi.encodePacked(type(RMTV7ReleaseRegistry).creationCode, abi.encode(address(2)));
        assembly ("memory-safe") {
            deployed := create(0, add(releaseCreationCode, 0x20), mload(releaseCreationCode))
        }
        require(deployed == address(0), "module registry without code accepted");

        V7FakeModuleRegistry fakeRegistry = new V7FakeModuleRegistry();
        releaseCreationCode =
            abi.encodePacked(type(RMTV7ReleaseRegistry).creationCode, abi.encode(address(fakeRegistry)));
        assembly ("memory-safe") {
            deployed := create(0, add(releaseCreationCode, 0x20), mload(releaseCreationCode))
        }
        require(deployed == address(0), "registry with EOA governance accepted");
    }

    function _registerModule(
        uint8 kind,
        uint32 version,
        address implementation,
        bytes4 interfaceId,
        bytes32 policyHash,
        bytes32 metadataHash
    ) private returns (bytes32 moduleKey) {
        bytes memory output = governance.execute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule, (kind, version, implementation, interfaceId, policyHash, metadataHash)
            )
        );
        moduleKey = abi.decode(output, (bytes32));
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

    function _singleIntent(bytes32 moduleKey)
        private
        pure
        returns (RMTV7ReleaseRegistry.ModuleIntent[] memory intents)
    {
        intents = new RMTV7ReleaseRegistry.ModuleIntent[](1);
        intents[0] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, keccak256("CONFIGURATION"));
    }
}
