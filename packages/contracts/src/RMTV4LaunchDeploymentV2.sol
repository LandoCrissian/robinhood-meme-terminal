// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ILaunchPermit2V1, ILaunchPositionManagerV1} from "./RMTV4LaunchFactoryV1.sol";
import {RMTV4InitializationGuard} from "./RMTV4InitializationGuard.sol";
import {RMTV4LaunchFactoryV2} from "./RMTV4LaunchFactoryV2.sol";

/// @notice Atomically creates the V2 guard and its only authorized factory.
/// @dev Mine the guard salt using the anticipated address of this deployment, then verify both runtime pins.
contract RMTV4LaunchDeploymentV2 {
    RMTV4InitializationGuard public immutable initializationGuard;
    RMTV4LaunchFactoryV2 public immutable factory;

    error WrongChain();
    error UnexpectedFactoryAddress();

    constructor(
        IPoolManager poolManager,
        ILaunchPositionManagerV1 positionManager,
        ILaunchPermit2V1 permit2,
        bytes32 poolManagerRuntimeHash,
        bytes32 positionManagerRuntimeHash,
        bytes32 permit2RuntimeHash,
        bytes32 guardSalt
    ) {
        if (block.chainid != 31_337) revert WrongChain();
        // EIP-161 starts this contract at nonce 1. CREATE2 of the guard consumes nonce 1.
        address expectedFactory =
            address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), hex"02")))));
        initializationGuard = new RMTV4InitializationGuard{salt: guardSalt}(poolManager, expectedFactory);
        factory = new RMTV4LaunchFactoryV2(
            poolManager,
            positionManager,
            permit2,
            poolManagerRuntimeHash,
            positionManagerRuntimeHash,
            permit2RuntimeHash,
            initializationGuard
        );
        if (address(factory) != expectedFactory) revert UnexpectedFactoryAddress();
    }
}
