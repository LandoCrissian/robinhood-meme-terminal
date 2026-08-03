// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV7CreatorFoundationCoreBundle} from "../src/RMTV7CreatorFoundationCoreBundle.sol";
import {RMTV7CreatorFoundationModulesBundle} from "../src/RMTV7CreatorFoundationModulesBundle.sol";

interface RMTV7DeploymentVm {
    function envAddress(string calldata name) external returns (address value);
    function envUint(string calldata name) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function getNonce(address account) external view returns (uint64 nonce);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Source-locked production deployment for the V7 creator foundation on Robinhood Chain.
/// @dev Two size-bounded stages are deployed and verified. Neither stage activates a creator module.
contract DeployRMTV7CreatorFoundation {
    RMTV7DeploymentVm private constant vm = RMTV7DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant ROBINHOOD_MAINNET_CHAIN_ID = 4_663;
    address public constant RMT_V6_GOVERNANCE = 0x52C43239Df8965EB27f26E115cC5EAd11B35d5C3;
    bytes32 public constant APPROVED_DEPLOYMENT_MANIFEST_HASH = bytes32(0);
    bytes32 public constant DEPLOYMENT_MANIFEST_TYPEHASH = keccak256(
        "RMTV7CreatorFoundationDeployment(uint256 chainId,address deployer,uint256 deployerNonce,address expectedCoreBundle,address expectedModulesBundle,address governance,address evidenceSigner,bytes32 coreInitCodeHash,bytes32 coreCreationCodeHash,bytes32 modulesInitCodeHash,bytes32 modulesCreationCodeHash)"
    );

    error DeploymentDisabled();
    error WrongChain(uint256 actualChainId);
    error InvalidEnvironment();
    error UnapprovedDeploymentManifest(bytes32 actualManifestHash);
    error BindingVerificationFailed();

    event RMTV7CreatorFoundationDeployed(
        address indexed coreBundle,
        address indexed modulesBundle,
        address indexed governance,
        address evidenceSigner,
        address moduleRegistry,
        address mediaEvidenceVerifier,
        address releaseRegistry,
        address collectionModule,
        address editionModule,
        address splitModule,
        bytes32 deploymentManifestHash
    );

    function run()
        external
        returns (RMTV7CreatorFoundationCoreBundle core, RMTV7CreatorFoundationModulesBundle modules)
    {
        if (APPROVED_DEPLOYMENT_MANIFEST_HASH == bytes32(0)) {
            revert DeploymentDisabled();
        }
        if (block.chainid != ROBINHOOD_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 privateKey = vm.envUint("RMT_V7_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address evidenceSigner = vm.envAddress("RMT_V7_EVIDENCE_SIGNER");
        if (
            privateKey == 0 || deployer == address(0) || evidenceSigner == address(0)
                || RMT_V6_GOVERNANCE.code.length == 0
        ) revert InvalidEnvironment();

        uint256 deployerNonce = vm.getNonce(deployer);
        address expectedCoreBundle = vm.computeCreateAddress(deployer, deployerNonce);
        address expectedModulesBundle = vm.computeCreateAddress(deployer, deployerNonce + 1);

        bytes32 coreCreationCodeHash = keccak256(type(RMTV7CreatorFoundationCoreBundle).creationCode);
        bytes32 coreInitCodeHash = keccak256(
            abi.encodePacked(
                type(RMTV7CreatorFoundationCoreBundle).creationCode, abi.encode(RMT_V6_GOVERNANCE, evidenceSigner)
            )
        );
        bytes32 modulesCreationCodeHash = keccak256(type(RMTV7CreatorFoundationModulesBundle).creationCode);
        bytes32 modulesInitCodeHash = keccak256(
            abi.encodePacked(
                type(RMTV7CreatorFoundationModulesBundle).creationCode,
                abi.encode(
                    vm.computeCreateAddress(expectedCoreBundle, 1), vm.computeCreateAddress(expectedCoreBundle, 3)
                )
            )
        );
        bytes32 manifestHash = keccak256(
            abi.encode(
                DEPLOYMENT_MANIFEST_TYPEHASH,
                ROBINHOOD_MAINNET_CHAIN_ID,
                deployer,
                deployerNonce,
                expectedCoreBundle,
                expectedModulesBundle,
                RMT_V6_GOVERNANCE,
                evidenceSigner,
                coreInitCodeHash,
                coreCreationCodeHash,
                modulesInitCodeHash,
                modulesCreationCodeHash
            )
        );
        if (manifestHash != APPROVED_DEPLOYMENT_MANIFEST_HASH) {
            revert UnapprovedDeploymentManifest(manifestHash);
        }

        vm.startBroadcast(privateKey);
        core = new RMTV7CreatorFoundationCoreBundle(RMT_V6_GOVERNANCE, evidenceSigner);
        modules =
            new RMTV7CreatorFoundationModulesBundle(address(core.moduleRegistry()), address(core.releaseRegistry()));
        vm.stopBroadcast();

        if (
            address(core) != expectedCoreBundle || address(modules) != expectedModulesBundle
                || address(core.moduleRegistry()).code.length == 0
                || address(core.mediaEvidenceVerifier()).code.length == 0
                || address(core.releaseRegistry()).code.length == 0
                || address(modules.collectionModule()).code.length == 0
                || address(modules.editionModule()).code.length == 0 || address(modules.splitModule()).code.length == 0
        ) revert BindingVerificationFailed();

        emit RMTV7CreatorFoundationDeployed(
            address(core),
            address(modules),
            RMT_V6_GOVERNANCE,
            evidenceSigner,
            address(core.moduleRegistry()),
            address(core.mediaEvidenceVerifier()),
            address(core.releaseRegistry()),
            address(modules.collectionModule()),
            address(modules.editionModule()),
            address(modules.splitModule()),
            manifestHash
        );
    }
}
