// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library MinimalProxy {
    error CloneDeploymentFailed();

    function clone(address implementation) internal returns (address instance) {
        assembly ("memory-safe") {
            mstore(0x00, or(shr(0xe8, shl(0x60, implementation)), 0x3d602d80600a3d3981f3))
            mstore(0x20, or(shl(0x78, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(0, 0x09, 0x37)
        }
        if (instance == address(0)) revert CloneDeploymentFailed();
    }
}
