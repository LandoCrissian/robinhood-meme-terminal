// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface CommodityEvidenceDeploymentScriptsVm {
    function readFile(string calldata path) external returns (string memory data);
}

contract RMTCommodityEvidenceRegistryV0DeploymentScriptsTest {
    CommodityEvidenceDeploymentScriptsVm private constant vm =
        CommodityEvidenceDeploymentScriptsVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    string private constant PREPARATION_ENTRYPOINT = "scripts/prepare-rmt-commodity-evidence-registry-v0.py";
    string private constant PREPARATION_IMPLEMENTATION = "scripts/_prepare-rmt-commodity-evidence-registry-v0-impl.py";
    string private constant DEPLOYMENT_VERIFIER = "scripts/verify-rmt-commodity-evidence-registry-v0-deployment.sh";
    string private constant OBSOLETE_DEPLOYMENT_VERIFIER =
        "scripts/verify-commodity-evidence-registry-v0-deployment.sh";
    string private constant POSTFLIGHT_IMPLEMENTATION = "script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol";
    string private constant SOURCE_VERIFIER = "scripts/verify-rmt-commodity-evidence-registry-v0-sources.sh";
    string private constant RELEASE_TEMPLATE = "deployments/rmt-commodity-evidence-registry-v0.template.json";

    function testAuthoritativePreparationIsCreate2OnlyAndRemoteBroadcastFree() public {
        string memory entrypoint = vm.readFile(PREPARATION_ENTRYPOINT);
        string memory implementation = vm.readFile(PREPARATION_IMPLEMENTATION);

        require(_contains(implementation, "CREATE2_DEPLOYER"), "CREATE2 deployer missing");
        require(_contains(implementation, "CREATE2_DEPLOYER_HASH"), "CREATE2 runtime hash missing");
        require(_contains(implementation, "simulate_create2"), "CREATE2 rehearsal missing");
        require(_contains(implementation, "local_rpc"), "loopback RPC binding missing");
        require(_contains(implementation, "predictedAddress"), "predicted address commitment missing");
        require(_contains(implementation, "expectedDomainSeparator"), "domain commitment missing");
        require(!_contains(implementation, "eth_getTransactionCount"), "nonce-sensitive CREATE path present");
        require(!_contains(implementation, "cast compute-address"), "direct CREATE address path present");
        require(!_contains(implementation, "eth_sendRawTransaction"), "raw transaction submission present");
        require(!_contains(implementation, "DEPLOYER_PRIVATE_KEY"), "deployer secret input present");
        require(!_contains(implementation, "MNEMONIC"), "mnemonic input present");
        require(!_contains(implementation, "--broadcast"), "Foundry broadcast present");
        require(!_contains(entrypoint, "DEPLOYER_PRIVATE_KEY"), "deployer secret input present");
        require(!_contains(entrypoint, "--broadcast"), "Foundry broadcast present");
    }

    function testObsoleteDeploymentVerifierIsAbsent() public {
        (bool readable,) = address(vm)
            .call(
                abi.encodeWithSelector(
                    CommodityEvidenceDeploymentScriptsVm.readFile.selector, OBSOLETE_DEPLOYMENT_VERIFIER
                )
            );
        require(!readable, "obsolete deployment verifier present");
    }

    function testDeploymentVerifierIsReadOnlyAndFailClosed() public {
        string memory verifier = vm.readFile(DEPLOYMENT_VERIFIER);
        string memory postflight = vm.readFile(POSTFLIGHT_IMPLEMENTATION);

        _assertNoEvmTransactionSurface(verifier);
        require(_contains(verifier, "EXPECTED_RUNTIME_HASH"), "runtime commitment missing");
        require(_contains(verifier, "EXPECTED_DOMAIN"), "domain commitment missing");
        require(_contains(verifier, "CHAIN_ID"), "chain commitment missing");
        require(_contains(verifier, "CREATE2_DEPLOYER_RUNTIME_HASH"), "deployer provenance missing");
        require(_contains(verifier, "cast create2"), "CREATE2 prediction check missing");
        require(_contains(verifier, "cast call"), "read-only contract checks missing");
        require(_contains(verifier, "cast code"), "runtime code check missing");
        require(
            _contains(verifier, "VerifySyntheticCommodityEvidenceRegistryV0"), "postflight implementation not invoked"
        );
        require(_contains(postflight, "mint(address,uint256)"), "no-mint probe missing");
        require(_contains(postflight, "totalSupply()"), "no-supply probe missing");
        require(!_contains(verifier, "--unlocked"), "unlocked account support present");
    }

    function testSourceVerifierKeepsPublicationBehindExplicitGate() public {
        string memory verifier = vm.readFile(SOURCE_VERIFIER);

        _assertNoEvmTransactionSurface(verifier);
        require(_contains(verifier, "--dry-run"), "source dry-run mode missing");
        require(_contains(verifier, "SOURCE_PUBLICATION_CONFIRMED"), "publication confirmation missing");
        require(_contains(verifier, "sourcePublicationAuthorized"), "record authorization missing");
        require(_contains(verifier, "publishAuthorized"), "publication authorization missing");
    }

    function testReleaseTemplateCannotAccidentallyAuthorizeOrSelectDirectCreate() public {
        string memory manifest = vm.readFile(RELEASE_TEMPLATE);

        require(_contains(manifest, "\"status\": \"UNDEPLOYED_TEMPLATE\""), "template not undeployed");
        require(_contains(manifest, "\"testnetDeploymentAuthorized\": false"), "deployment authorized");
        require(_contains(manifest, "\"broadcastAuthorized\": false"), "broadcast authorized");
        require(_contains(manifest, "\"mergeAuthorized\": false"), "merge authorized");
        require(_contains(manifest, "\"realInventoryAuthorized\": false"), "real inventory authorized");
        require(_contains(manifest, "\"tokenIssuanceAuthorized\": false"), "token issuance authorized");
        require(_contains(manifest, "\"create2\""), "CREATE2 release section missing");
        require(_contains(manifest, "0x4e59b44847b379578588920cA78FbF26c0B4956C"), "canonical deployer missing");
        require(!_contains(manifest, "deployerNonce"), "direct CREATE nonce field present");
    }

    function _assertNoEvmTransactionSurface(string memory source) private pure {
        require(!_contains(source, "--broadcast"), "Foundry broadcast present");
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
