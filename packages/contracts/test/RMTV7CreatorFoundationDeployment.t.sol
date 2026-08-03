// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTV7ConsentBoundSplitModule} from "../src/interfaces/IRMTV7ConsentBoundSplitModule.sol";
import {IRMTV7ERC1155EditionModule} from "../src/interfaces/IRMTV7ERC1155EditionModule.sol";
import {IRMTV7ERC721CollectionModule} from "../src/interfaces/IRMTV7ERC721CollectionModule.sol";
import {RMTV7CreatorFoundationCoreBundle} from "../src/RMTV7CreatorFoundationCoreBundle.sol";
import {RMTV7CreatorFoundationModulesBundle} from "../src/RMTV7CreatorFoundationModulesBundle.sol";
import {RMTV7ModuleRegistry} from "../src/RMTV7ModuleRegistry.sol";

interface V7FoundationVm {
    function deal(address account, uint256 balance) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
}

contract V7FoundationGovernance {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory output) = target.call(data);
        require(success, "governance call failed");
        return output;
    }
}

contract RMTV7CreatorFoundationDeploymentTest {
    V7FoundationVm private constant vm = V7FoundationVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    V7FoundationGovernance private governance;
    address private constant EVIDENCE_SIGNER = address(0xA11CE);

    function setUp() public {
        governance = new V7FoundationGovernance();
    }

    function testTwoStageDeploymentCreatesOneVerifiedInactiveTopology() public {
        (RMTV7CreatorFoundationCoreBundle core, RMTV7CreatorFoundationModulesBundle modules) = _deploy();

        require(core.moduleRegistry().governance() == address(governance), "registry governance mismatch");
        require(core.mediaEvidenceVerifier().governance() == address(governance), "verifier governance mismatch");
        require(core.mediaEvidenceVerifier().evidenceSigner() == EVIDENCE_SIGNER, "evidence signer mismatch");
        require(
            address(core.releaseRegistry().moduleRegistry()) == address(core.moduleRegistry()),
            "release registry mismatch"
        );
        require(
            address(core.releaseRegistry().mediaEvidenceVerifier()) == address(core.mediaEvidenceVerifier()),
            "release verifier mismatch"
        );
        require(
            address(modules.collectionModule().releaseRegistry()) == address(core.releaseRegistry()),
            "collection release mismatch"
        );
        require(
            address(modules.editionModule().releaseRegistry()) == address(core.releaseRegistry()),
            "edition release mismatch"
        );
        require(
            address(modules.splitModule().releaseRegistry()) == address(core.releaseRegistry()),
            "split release mismatch"
        );
        require(
            address(core.moduleRegistry()) == vm.computeCreateAddress(address(core), 1), "core registry address drifted"
        );
        require(
            address(core.mediaEvidenceVerifier()) == vm.computeCreateAddress(address(core), 2),
            "core verifier address drifted"
        );
        require(
            address(core.releaseRegistry()) == vm.computeCreateAddress(address(core), 3), "core release address drifted"
        );
        require(
            address(modules.collectionModule()) == vm.computeCreateAddress(address(modules), 1),
            "collection module address drifted"
        );
        require(
            address(modules.editionModule()) == vm.computeCreateAddress(address(modules), 2),
            "edition module address drifted"
        );
        require(
            address(modules.splitModule()) == vm.computeCreateAddress(address(modules), 3),
            "split module address drifted"
        );
    }

    function testModulesRemainInactiveUntilDelayedGovernanceAdmission() public {
        (RMTV7CreatorFoundationCoreBundle core, RMTV7CreatorFoundationModulesBundle modules) = _deploy();
        RMTV7ModuleRegistry registry = core.moduleRegistry();

        require(_moduleKey(registry, 1) == bytes32(0), "collection activated during deployment");
        require(_moduleKey(registry, 2) == bytes32(0), "editions activated during deployment");
        require(_moduleKey(registry, 3) == bytes32(0), "split activated during deployment");

        _register(
            registry,
            1,
            address(modules.collectionModule()),
            type(IRMTV7ERC721CollectionModule).interfaceId,
            keccak256("ERC721_POLICY_V1"),
            keccak256("ERC721_METADATA_V1")
        );
        _register(
            registry,
            2,
            address(modules.editionModule()),
            type(IRMTV7ERC1155EditionModule).interfaceId,
            keccak256("ERC1155_POLICY_V1"),
            keccak256("ERC1155_METADATA_V1")
        );
        _register(
            registry,
            3,
            address(modules.splitModule()),
            type(IRMTV7ConsentBoundSplitModule).interfaceId,
            keccak256("SPLIT_POLICY_V1"),
            keccak256("SPLIT_METADATA_V1")
        );

        require(registry.isModuleActive(_moduleKey(registry, 1)), "collection was not admitted");
        require(registry.isModuleActive(_moduleKey(registry, 2)), "editions were not admitted");
        require(registry.isModuleActive(_moduleKey(registry, 3)), "split was not admitted");
    }

    function testStagesRejectInvalidBindingsAndCannotReceiveFunds() public {
        require(!_coreDeploymentSucceeds(address(0), EVIDENCE_SIGNER), "zero governance accepted");
        require(!_coreDeploymentSucceeds(address(0xBEEF), EVIDENCE_SIGNER), "no-code governance accepted");
        require(!_coreDeploymentSucceeds(address(governance), address(0)), "zero evidence signer accepted");

        RMTV7CreatorFoundationCoreBundle core =
            new RMTV7CreatorFoundationCoreBundle(address(governance), EVIDENCE_SIGNER);
        require(
            !_modulesDeploymentSucceeds(address(core.moduleRegistry()), address(0xBEEF)),
            "no-code release registry accepted"
        );
        RMTV7CreatorFoundationCoreBundle unrelated =
            new RMTV7CreatorFoundationCoreBundle(address(governance), EVIDENCE_SIGNER);
        require(
            !_modulesDeploymentSucceeds(address(core.moduleRegistry()), address(unrelated.releaseRegistry())),
            "mismatched core accepted"
        );

        RMTV7CreatorFoundationModulesBundle modules =
            new RMTV7CreatorFoundationModulesBundle(address(core.moduleRegistry()), address(core.releaseRegistry()));
        vm.deal(address(this), 2 wei);
        (bool fundedCore,) = address(core).call{value: 1 wei}("");
        (bool fundedModules,) = address(modules).call{value: 1 wei}("");
        require(!fundedCore && !fundedModules, "deployment stage accepted funds");
    }

    function _deploy()
        private
        returns (RMTV7CreatorFoundationCoreBundle core, RMTV7CreatorFoundationModulesBundle modules)
    {
        core = new RMTV7CreatorFoundationCoreBundle(address(governance), EVIDENCE_SIGNER);
        modules =
            new RMTV7CreatorFoundationModulesBundle(address(core.moduleRegistry()), address(core.releaseRegistry()));
    }

    function _coreDeploymentSucceeds(address governance_, address evidenceSigner_) private returns (bool) {
        try new RMTV7CreatorFoundationCoreBundle(governance_, evidenceSigner_) returns (
            RMTV7CreatorFoundationCoreBundle deployed
        ) {
            return address(deployed) != address(0);
        } catch {
            return false;
        }
    }

    function _modulesDeploymentSucceeds(address registry, address releases) private returns (bool) {
        try new RMTV7CreatorFoundationModulesBundle(registry, releases) returns (
            RMTV7CreatorFoundationModulesBundle deployed
        ) {
            return address(deployed) != address(0);
        } catch {
            return false;
        }
    }

    function _moduleKey(RMTV7ModuleRegistry registry, uint8 kind) private view returns (bytes32) {
        return registry.moduleKeyByKindAndVersion(keccak256(abi.encode(kind, uint32(1))));
    }

    function _register(
        RMTV7ModuleRegistry registry,
        uint8 kind,
        address implementation,
        bytes4 interfaceId,
        bytes32 policyHash,
        bytes32 metadataHash
    ) private {
        governance.execute(
            address(registry),
            abi.encodeCall(
                registry.registerModule, (kind, uint32(1), implementation, interfaceId, policyHash, metadataHash)
            )
        );
    }
}
