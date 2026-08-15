// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

/// @notice Produces deterministic bytecode commitments through an ephemeral Foundry simulation.
/// @dev This contract has no broadcast, wallet, environment-secret, or transaction-submission interface.
contract PrepareCommodityEvidenceRegistryV0Deployment {
    uint256 public constant TARGET_CHAIN_ID = 46_630;

    struct DeploymentPlan {
        uint256 chainId;
        address administrator;
        address simulatedRegistry;
        bytes32 creationCodeHash;
        bytes32 initCodeHash;
        bytes32 runtimeCodeHash;
        bytes32 domainSeparator;
        uint256 creationCodeSize;
        uint256 initCodeSize;
        uint256 runtimeCodeSize;
    }

    event DeploymentPlanPrepared(
        uint256 indexed chainId,
        address indexed administrator,
        address indexed simulatedRegistry,
        bytes32 creationCodeHash,
        bytes32 initCodeHash,
        bytes32 runtimeCodeHash,
        bytes32 domainSeparator,
        uint256 creationCodeSize,
        uint256 initCodeSize,
        uint256 runtimeCodeSize
    );

    error WrongChain(uint256 actual, uint256 expected);
    error InvalidAdministrator();
    error RehearsalInvariantFailed();

    function run(address administrator) external returns (DeploymentPlan memory plan) {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid, TARGET_CHAIN_ID);
        if (administrator == address(0)) revert InvalidAdministrator();

        bytes memory creationCode = type(RMTCommodityEvidenceRegistryV0).creationCode;
        bytes memory initCode = abi.encodePacked(creationCode, abi.encode(administrator));
        RMTCommodityEvidenceRegistryV0 registry = new RMTCommodityEvidenceRegistryV0(administrator);
        bytes memory runtimeCode = address(registry).code;

        if (
            registry.TARGET_CHAIN_ID() != TARGET_CHAIN_ID || !registry.SYNTHETIC_ONLY()
                || registry.administrator() != administrator || runtimeCode.length == 0
        ) revert RehearsalInvariantFailed();

        plan = DeploymentPlan({
            chainId: block.chainid,
            administrator: administrator,
            simulatedRegistry: address(registry),
            creationCodeHash: keccak256(creationCode),
            initCodeHash: keccak256(initCode),
            runtimeCodeHash: keccak256(runtimeCode),
            domainSeparator: registry.domainSeparator(),
            creationCodeSize: creationCode.length,
            initCodeSize: initCode.length,
            runtimeCodeSize: runtimeCode.length
        });

        emit DeploymentPlanPrepared(
            plan.chainId,
            plan.administrator,
            plan.simulatedRegistry,
            plan.creationCodeHash,
            plan.initCodeHash,
            plan.runtimeCodeHash,
            plan.domainSeparator,
            plan.creationCodeSize,
            plan.initCodeSize,
            plan.runtimeCodeSize
        );
    }

    function creationCodeHash() external pure returns (bytes32) {
        return keccak256(type(RMTCommodityEvidenceRegistryV0).creationCode);
    }

    function initCodeHash(address administrator) external pure returns (bytes32) {
        if (administrator == address(0)) revert InvalidAdministrator();
        return keccak256(abi.encodePacked(type(RMTCommodityEvidenceRegistryV0).creationCode, abi.encode(administrator)));
    }
}
