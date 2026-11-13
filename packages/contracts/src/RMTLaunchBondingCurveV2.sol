// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {RMTLaunchBondingCurveV1} from "./RMTLaunchBondingCurveV1.sol";

/// @notice Asset-bearing successor with independent execution and unchanged launch economics.
contract RMTLaunchBondingCurveV2 is RMTLaunchBondingCurveV1 {
    constructor(RMTLaunchBondingCurveV1 source)
        RMTLaunchBondingCurveV1(
            source.token(),
            source.creator(),
            source.treasury(),
            source.treasuryShareBps(),
            source.operatingRecipient(),
            source.futureReserveRecipient(),
            source.graduationEngine(),
            source.projectRegistry(),
            source.factory(),
            address(source),
            source.revenueLedger()
        )
    {}

    function executionVersion() public pure override returns (uint32) {
        return 2;
    }
}

/// @dev Fixed successor template lives outside the factory runtime and has no asset authority.
contract RMTLaunchCurveSuccessorDeployerV1 {
    error UnauthorizedFactory();

    function prepare(RMTLaunchBondingCurveV1 source, bytes32 salt) external returns (address) {
        if (source.factory() != msg.sender) revert UnauthorizedFactory();
        bytes32 scopedSalt = keccak256(abi.encode(msg.sender, salt));
        return address(new RMTLaunchBondingCurveV2{salt: scopedSalt}(source));
    }
}
