// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Narrow verification surface used by reviewed V7 deployment modules.
interface IRMTV7ReleaseRegistry {
    function isFrozenModuleIntent(bytes32 releaseId, address creator, bytes32 moduleKey, bytes32 configurationHash)
        external
        view
        returns (bool);
}
