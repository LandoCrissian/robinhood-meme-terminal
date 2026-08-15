// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

/// @notice Computes a deployer-and-nonce-specific deployment plan without broadcasting a transaction.
/// @dev The simulated registry is ephemeral. The predicted registry is the address of a future CREATE deployment.
contract FinalizeCommodityEvidenceRegistryV0DeploymentPlan {
    uint256 public constant TARGET_CHAIN_ID = 46_630;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant EIP712_NAME_HASH = keccak256("RMTCommodityEvidenceRegistryV0");
    bytes32 public constant EIP712_VERSION_HASH = keccak256("0");

    struct FinalDeploymentPlan {
        uint256 chainId;
        address administrator;
        address deployer;
        uint256 deployerNonce;
        address predictedRegistry;
        address simulatedRegistry;
        bytes32 creationCodeHash;
        bytes32 initCodeHash;
        bytes32 runtimeCodeHash;
        bytes32 predictedDomainSeparator;
        uint256 creationCodeSize;
        uint256 initCodeSize;
        uint256 runtimeCodeSize;
    }

    event FinalDeploymentPlanPrepared(
        uint256 indexed chainId,
        address indexed deployer,
        uint256 indexed deployerNonce,
        address administrator,
        address predictedRegistry,
        bytes32 creationCodeHash,
        bytes32 initCodeHash,
        bytes32 runtimeCodeHash,
        bytes32 predictedDomainSeparator,
        uint256 creationCodeSize,
        uint256 initCodeSize,
        uint256 runtimeCodeSize
    );

    error WrongChain(uint256 actual, uint256 expected);
    error InvalidAdministrator();
    error InvalidDeployer();
    error RehearsalInvariantFailed();

    function run(address administrator, address deployer, uint256 deployerNonce)
        external
        returns (FinalDeploymentPlan memory plan)
    {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid, TARGET_CHAIN_ID);
        if (administrator == address(0)) revert InvalidAdministrator();
        if (deployer == address(0)) revert InvalidDeployer();

        bytes memory creationCode = type(RMTCommodityEvidenceRegistryV0).creationCode;
        bytes memory initCode = abi.encodePacked(creationCode, abi.encode(administrator));
        address predictedRegistry = computeCreateAddress(deployer, deployerNonce);
        RMTCommodityEvidenceRegistryV0 registry = new RMTCommodityEvidenceRegistryV0(administrator);
        bytes memory runtimeCode = address(registry).code;

        if (
            registry.TARGET_CHAIN_ID() != TARGET_CHAIN_ID || !registry.SYNTHETIC_ONLY()
                || registry.administrator() != administrator || predictedRegistry == address(0)
                || runtimeCode.length == 0
        ) revert RehearsalInvariantFailed();

        plan = FinalDeploymentPlan({
            chainId: block.chainid,
            administrator: administrator,
            deployer: deployer,
            deployerNonce: deployerNonce,
            predictedRegistry: predictedRegistry,
            simulatedRegistry: address(registry),
            creationCodeHash: keccak256(creationCode),
            initCodeHash: keccak256(initCode),
            runtimeCodeHash: keccak256(runtimeCode),
            predictedDomainSeparator: computeDomainSeparator(predictedRegistry),
            creationCodeSize: creationCode.length,
            initCodeSize: initCode.length,
            runtimeCodeSize: runtimeCode.length
        });

        emit FinalDeploymentPlanPrepared(
            plan.chainId,
            plan.deployer,
            plan.deployerNonce,
            plan.administrator,
            plan.predictedRegistry,
            plan.creationCodeHash,
            plan.initCodeHash,
            plan.runtimeCodeHash,
            plan.predictedDomainSeparator,
            plan.creationCodeSize,
            plan.initCodeSize,
            plan.runtimeCodeSize
        );
    }

    function computeCreateAddress(address deployer, uint256 nonce) public pure returns (address predicted) {
        if (deployer == address(0)) revert InvalidDeployer();

        bytes memory encoded;
        if (nonce == 0) {
            encoded = abi.encodePacked(hex"d694", deployer, hex"80");
        } else if (nonce <= 0x7f) {
            encoded = abi.encodePacked(hex"d694", deployer, bytes1(uint8(nonce)));
        } else {
            bytes memory nonceBytes = _minimalBigEndian(nonce);
            encoded = abi.encodePacked(
                bytes1(uint8(0xd6 + nonceBytes.length)),
                hex"94",
                deployer,
                bytes1(uint8(0x80 + nonceBytes.length)),
                nonceBytes
            );
        }

        predicted = address(uint160(uint256(keccak256(encoded))));
    }

    function computeDomainSeparator(address verifyingContract) public pure returns (bytes32) {
        if (verifyingContract == address(0)) revert RehearsalInvariantFailed();
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                EIP712_NAME_HASH,
                EIP712_VERSION_HASH,
                TARGET_CHAIN_ID,
                verifyingContract
            )
        );
    }

    function initCode(address administrator) external pure returns (bytes memory) {
        if (administrator == address(0)) revert InvalidAdministrator();
        return abi.encodePacked(type(RMTCommodityEvidenceRegistryV0).creationCode, abi.encode(administrator));
    }

    function _minimalBigEndian(uint256 value) private pure returns (bytes memory encoded) {
        uint256 length;
        uint256 cursor = value;
        while (cursor != 0) {
            length++;
            cursor >>= 8;
        }

        encoded = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            encoded[length - 1 - i] = bytes1(uint8(value >> (i * 8)));
        }
    }
}
