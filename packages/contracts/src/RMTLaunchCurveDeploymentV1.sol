// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {RMTLaunchCurveFactoryV1} from "./RMTLaunchCurveFactoryV1.sol";
import {ICurveGraduationFactoryV1, RMTV4CurveGraduationV1} from "./RMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1} from "./RMTV4CurveInitializationGuardV1.sol";

/// @notice One-shot deployment of the immutable V1 implementation set.
/// @dev The guard, engine, and factory bind to one another within the same transaction.
contract RMTLaunchCurveDeploymentV1 {
    RMTLaunchCurveFactoryV1 public immutable factory;
    RMTV4CurveGraduationV1 public immutable graduationEngine;
    RMTV4CurveInitializationGuardV1 public immutable initializationGuard;

    error DeploymentAddressMismatch();

    constructor(
        RMTV4CurveGraduationV1.Dependencies memory dependencies,
        bytes32 guardSalt,
        address operatingRecipient,
        address futureReserveRecipient,
        address projectRegistry,
        address successorDeployer,
        bytes32 successorDeployerRuntimeHash
    ) {
        // Creation starts at nonce 1. CREATE2 of the guard consumes nonce 1.
        address expectedEngine = _createdAtNonce(2);
        address expectedFactory = _createdAtNonce(3);
        initializationGuard =
            new RMTV4CurveInitializationGuardV1{salt: guardSalt}(dependencies.poolManager, expectedEngine);
        graduationEngine =
            new RMTV4CurveGraduationV1(dependencies, ICurveGraduationFactoryV1(expectedFactory), initializationGuard);
        factory = new RMTLaunchCurveFactoryV1(
            address(graduationEngine), operatingRecipient, futureReserveRecipient, projectRegistry,
            successorDeployer, successorDeployerRuntimeHash
        );
        if (address(graduationEngine) != expectedEngine || address(factory) != expectedFactory) {
            revert DeploymentAddressMismatch();
        }
    }

    function _createdAtNonce(uint8 nonce) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), nonce)))));
    }
}
