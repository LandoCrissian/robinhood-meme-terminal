// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";
import {PrepareCommodityEvidenceRegistryV0Deployment} from "../script/PrepareCommodityEvidenceRegistryV0Deployment.s.sol";

interface CommodityEvidenceDeploymentReadinessVm {
    function chainId(uint256 newChainId) external;
    function readFile(string calldata path) external returns (string memory data);
}

contract RMTCommodityEvidenceRegistryV0DeploymentReadinessTest {
    CommodityEvidenceDeploymentReadinessVm private constant vm =
        CommodityEvidenceDeploymentReadinessVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TARGET_CHAIN_ID = 46_630;
    address private constant ADMINISTRATOR_ONE = 0x1111111111111111111111111111111111111111;
    address private constant ADMINISTRATOR_TWO = 0x2222222222222222222222222222222222222222;

    PrepareCommodityEvidenceRegistryV0Deployment private preparer;

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        preparer = new PrepareCommodityEvidenceRegistryV0Deployment();
    }

    function testPreparationProducesExactAdministratorSpecificCommitments() public {
        PrepareCommodityEvidenceRegistryV0Deployment.DeploymentPlan memory plan = preparer.run(ADMINISTRATOR_ONE);
        RMTCommodityEvidenceRegistryV0 registry =
            RMTCommodityEvidenceRegistryV0(payable(plan.simulatedRegistry));

        bytes memory creationCode = type(RMTCommodityEvidenceRegistryV0).creationCode;
        bytes memory initCode = abi.encodePacked(creationCode, abi.encode(ADMINISTRATOR_ONE));

        require(plan.chainId == TARGET_CHAIN_ID, "wrong chain");
        require(plan.administrator == ADMINISTRATOR_ONE, "wrong administrator");
        require(plan.creationCodeHash == keccak256(creationCode), "wrong creation hash");
        require(plan.initCodeHash == keccak256(initCode), "wrong init hash");
        require(plan.runtimeCodeHash == keccak256(plan.simulatedRegistry.code), "wrong runtime hash");
        require(plan.domainSeparator == registry.domainSeparator(), "wrong domain separator");
        require(plan.creationCodeSize == creationCode.length, "wrong creation size");
        require(plan.initCodeSize == initCode.length, "wrong init size");
        require(plan.runtimeCodeSize == plan.simulatedRegistry.code.length, "wrong runtime size");
        require(registry.administrator() == ADMINISTRATOR_ONE, "administrator not embedded");
        require(registry.TARGET_CHAIN_ID() == TARGET_CHAIN_ID, "target chain mismatch");
        require(registry.SYNTHETIC_ONLY(), "synthetic guard missing");
    }

    function testAdministratorChangesInitAndRuntimeCommitments() public {
        PrepareCommodityEvidenceRegistryV0Deployment.DeploymentPlan memory firstPlan = preparer.run(ADMINISTRATOR_ONE);
        PrepareCommodityEvidenceRegistryV0Deployment.DeploymentPlan memory secondPlan = preparer.run(ADMINISTRATOR_TWO);

        require(firstPlan.creationCodeHash == secondPlan.creationCodeHash, "creation code changed");
        require(firstPlan.initCodeHash != secondPlan.initCodeHash, "administrator not bound to init code");
        require(firstPlan.runtimeCodeHash != secondPlan.runtimeCodeHash, "administrator not bound to runtime code");
        require(firstPlan.domainSeparator != secondPlan.domainSeparator, "contract domain not instance-bound");
    }

    function testPreparationRejectsZeroAdministratorAndWrongChain() public {
        (bool zeroAccepted,) = address(preparer).call(abi.encodeWithSelector(preparer.run.selector, address(0)));
        require(!zeroAccepted, "zero administrator accepted");

        vm.chainId(TARGET_CHAIN_ID + 1);
        (bool wrongChainAccepted,) =
            address(preparer).call(abi.encodeWithSelector(preparer.run.selector, ADMINISTRATOR_ONE));
        require(!wrongChainAccepted, "wrong chain accepted");
    }

    function testPreparationSourceHasNoBroadcastOrSecretInterface() public {
        string memory source = vm.readFile("script/PrepareCommodityEvidenceRegistryV0Deployment.s.sol");
        require(!_contains(source, "startBroadcast"), "broadcast interface present");
        require(!_contains(source, "vm.broadcast"), "broadcast interface present");
        require(!_contains(source, "envUint"), "secret environment read present");
        require(!_contains(source, "envBytes"), "secret environment read present");
        require(!_contains(source, "publishEvidence"), "evidence publication present");
    }

    function testDeploymentPlanTemplateIsFailClosedAndUnpopulated() public {
        string memory manifest =
            vm.readFile("deployments/rmt-commodity-evidence-registry-v0-readiness.template.json");
        require(_contains(manifest, "\"status\": \"UNDEPLOYED\""), "status not undeployed");
        require(_contains(manifest, "\"deploymentAuthorized\": false"), "deployment enabled");
        require(_contains(manifest, "\"broadcastAuthorized\": false"), "broadcast enabled");
        require(_contains(manifest, "\"mergeAuthorized\": false"), "merge enabled");
        require(_contains(manifest, "\"realInventoryAuthorized\": false"), "inventory enabled");
        require(_contains(manifest, "\"tokenIssuanceAuthorized\": false"), "token issuance enabled");
        require(
            _contains(manifest, "0x0000000000000000000000000000000000000000"),
            "zero-address placeholders missing"
        );
    }

    function _contains(string memory haystack, string memory needle) private pure returns (bool) {
        bytes memory haystackBytes = bytes(haystack);
        bytes memory needleBytes = bytes(needle);
        if (needleBytes.length == 0 || needleBytes.length > haystackBytes.length) return false;

        for (uint256 i = 0; i <= haystackBytes.length - needleBytes.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < needleBytes.length; j++) {
                if (haystackBytes[i + j] != needleBytes[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }
}
