// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {RMTLaunchBondingCurveV1} from "./RMTLaunchBondingCurveV1.sol";
import {RMTLaunchBondingCurveV2} from "./RMTLaunchBondingCurveV2.sol";
import {IRMTCurveMigrationTemplate} from "./RMTLaunchCurveDirectoryV1.sol";

/// @notice Independently versioned asset-bearing curve with the original economic terms.
contract RMTLaunchBondingCurveV3 is RMTLaunchBondingCurveV2 {
    constructor(RMTLaunchBondingCurveV1 source) RMTLaunchBondingCurveV2(source) {}

    function executionVersion() public pure override returns (uint32) {
        return 3;
    }
}

/// @notice Deterministic reviewed deployer for the V2-to-V3 transition.
contract RMTLaunchCurveSuccessorDeployerV2 is IRMTCurveMigrationTemplate {
    uint32 public constant fromVersion = 2;
    uint32 public constant toVersion = 3;

    error UnauthorizedFactory();

    function prepare(address source, bytes32 salt) external returns (address) {
        RMTLaunchBondingCurveV1 curve = RMTLaunchBondingCurveV1(payable(source));
        if (curve.factory() != msg.sender || curve.executionVersion() != fromVersion) revert UnauthorizedFactory();
        return address(new RMTLaunchBondingCurveV3{salt: keccak256(abi.encode(msg.sender, salt))}(curve));
    }
}
