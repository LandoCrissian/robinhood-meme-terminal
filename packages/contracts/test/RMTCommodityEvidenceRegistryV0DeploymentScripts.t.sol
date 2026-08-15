// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface CommodityEvidenceDeploymentScriptsVm {
    function readFile(string calldata path) external returns (string memory data);
}

contract RMTCommodityEvidenceRegistryV0DeploymentScriptsTest {
    CommodityEvidenceDeploymentScriptsVm private constant vm =
        CommodityEvidenceDeploymentScriptsVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    string private constant PREFLIGHT_SCRIPT = "scripts/preflight-commodity-evidence-registry-v0.sh";
    string private constant FINAL_PLAN_SCRIPT = "scripts/finalize-commodity-evidence-registry-v0-plan.sh";
    string private constant VERIFY_SCRIPT = "scripts/verify-commodity-evidence-registry-v0-deployment.sh";
    string private constant READINESS_TEMPLATE =
        "deployments/rmt-commodity-evidence-registry-v0-readiness.template.json";

    function testEveryDeploymentShellRemainsNonBroadcastAndSecretFree() public {
        _assertReadOnlyShell(vm.readFile(PREFLIGHT_SCRIPT));
        _assertReadOnlyShell(vm.readFile(FINAL_PLAN_SCRIPT));
        _assertReadOnlyShell(vm.readFile(VERIFY_SCRIPT));
    }

    function testPreflightAndFinalPlanRequireOnlyPublicInputs() public {
        string memory preflight = vm.readFile(PREFLIGHT_SCRIPT);
        string memory finalPlan = vm.readFile(FINAL_PLAN_SCRIPT);

        require(_contains(preflight, "RPC_URL"), "preflight missing RPC input");
        require(_contains(preflight, "ADMINISTRATOR_ADDRESS"), "preflight missing administrator input");
        require(_contains(finalPlan, "RPC_URL"), "final plan missing RPC input");
        require(_contains(finalPlan, "ADMINISTRATOR_ADDRESS"), "final plan missing administrator input");
        require(_contains(finalPlan, "DEPLOYER_ADDRESS"), "final plan missing deployer input");
        require(_contains(finalPlan, "eth_getTransactionCount"), "final plan missing pending nonce read");
        require(_contains(finalPlan, "cast code"), "final plan missing predicted-address code check");
        require(_contains(finalPlan, "mode=simulation-only"), "final plan missing simulation label");
    }

    function testPostDeploymentVerifierIsReadOnlyAndFailClosed() public {
        string memory verifier = vm.readFile(VERIFY_SCRIPT);

        require(_contains(verifier, "EXPECTED_RUNTIME_CODE_HASH"), "runtime commitment missing");
        require(_contains(verifier, "EXPECTED_DOMAIN_SEPARATOR"), "domain commitment missing");
        require(_contains(verifier, "TARGET_CHAIN_ID"), "chain commitment missing");
        require(_contains(verifier, "cast call"), "read-only contract checks missing");
        require(_contains(verifier, "cast code"), "runtime code check missing");
        require(_contains(verifier, "mint(address,uint256)"), "no-mint probe missing");
        require(!_contains(verifier, "--unlocked"), "unlocked account support present");
    }

    function testReadinessTemplateCannotAccidentallyAuthorizeRelease() public {
        string memory manifest = vm.readFile(READINESS_TEMPLATE);

        require(_contains(manifest, "\"status\": \"UNDEPLOYED\""), "template not undeployed");
        require(_contains(manifest, "\"deploymentAuthorized\": false"), "deployment authorized");
        require(_contains(manifest, "\"broadcastAuthorized\": false"), "broadcast authorized");
        require(_contains(manifest, "\"mergeAuthorized\": false"), "merge authorized");
        require(_contains(manifest, "\"publicReleaseAuthorized\": false"), "public release authorized");
        require(_contains(manifest, "\"realInventoryAuthorized\": false"), "real inventory authorized");
        require(_contains(manifest, "\"tokenIssuanceAuthorized\": false"), "token issuance authorized");
        require(
            _contains(manifest, "\"rmtTokenRightsChangeAuthorized\": false"),
            "RMT token rights change authorized"
        );
    }

    function _assertReadOnlyShell(string memory source) private pure {
        require(!_contains(source, "--broadcast"), "broadcast flag present");
        require(!_contains(source, "startBroadcast"), "Foundry broadcast present");
        require(!_contains(source, "vm.broadcast"), "Foundry broadcast present");
        require(!_contains(source, "forge create"), "forge create present");
        require(!_contains(source, "cast send"), "cast send present");
        require(!_contains(source, "eth_sendTransaction"), "RPC transaction submission present");
        require(!_contains(source, "eth_sendRawTransaction"), "raw transaction submission present");
        require(!_contains(source, "--private-key"), "private-key flag present");
        require(!_contains(source, "--mnemonic"), "mnemonic flag present");
        require(!_contains(source, "PRIVATE_KEY"), "private-key environment input present");
        require(!_contains(source, "MNEMONIC"), "mnemonic environment input present");
        require(!_contains(source, "SEED_PHRASE"), "seed phrase environment input present");
        require(!_contains(source, "WALLET_PASSWORD"), "wallet password environment input present");
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
