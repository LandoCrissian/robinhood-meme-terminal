// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Append-only catalog of reviewed V7 implementation modules.
/// @dev Registration is not an audit or safety guarantee. Consumers must also verify the
///      module's active status, code hash, policy binding, and their own execution context.
interface IRMTV7ModuleRegistry {
    struct Module {
        uint8 kind;
        uint32 version;
        address implementation;
        bytes4 interfaceId;
        bytes32 implementationCodeHash;
        bytes32 policyHash;
        bytes32 metadataHash;
        uint64 registeredAt;
        uint64 deactivatedAt;
        bool active;
    }

    event ModuleRegistered(
        bytes32 indexed moduleKey,
        uint8 indexed kind,
        uint32 indexed version,
        address implementation,
        bytes4 interfaceId,
        bytes32 implementationCodeHash,
        bytes32 policyHash,
        bytes32 metadataHash
    );
    event ModuleDeactivated(bytes32 indexed moduleKey, uint64 deactivatedAt);

    function governance() external view returns (address);
    function getModule(bytes32 moduleKey) external view returns (Module memory);
    function isModuleActive(bytes32 moduleKey) external view returns (bool);
    function moduleKeyByKindAndVersion(bytes32 versionKey) external view returns (bytes32 moduleKey);
}
