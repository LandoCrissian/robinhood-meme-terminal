// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTV7ModuleRegistry} from "./interfaces/IRMTV7ModuleRegistry.sol";

/// @notice Append-only V7 module catalog controlled by RMT's delayed governance.
/// @dev This contract cannot call, upgrade, proxy, or custody assets for registered modules.
///      A registration proves only that governance admitted an exact code and policy fingerprint.
contract RMTV7ModuleRegistry is IRMTV7ModuleRegistry {
    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant INVALID_INTERFACE_ID = 0xffffffff;

    uint8 public constant MODULE_KIND_ERC721_COLLECTION = 1;
    uint8 public constant MODULE_KIND_ERC1155_EDITION = 2;
    uint8 public constant MODULE_KIND_SPLIT_ESCROW = 3;
    uint8 public constant MODULE_KIND_FIXED_PRICE_MARKET = 4;

    address public immutable override governance;

    mapping(bytes32 moduleKey => Module module) private _modules;
    mapping(bytes32 versionKey => bytes32 moduleKey) public moduleKeyByKindAndVersion;

    error OnlyGovernance();
    error InvalidConfiguration();
    error ModuleVersionAlreadyRegistered(bytes32 existingModuleKey);
    error UnknownModule();
    error ModuleAlreadyInactive();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    constructor(address governance_) {
        if (governance_ == address(0) || governance_.code.length == 0) revert InvalidConfiguration();
        governance = governance_;
    }

    /// @notice Admits one exact implementation and immutable policy fingerprint.
    /// @dev The implementation must advertise the declared interface through ERC-165.
    function registerModule(
        uint8 kind,
        uint32 version,
        address implementation,
        bytes4 interfaceId,
        bytes32 policyHash,
        bytes32 metadataHash
    ) external onlyGovernance returns (bytes32 moduleKey) {
        bytes32 implementationCodeHash = implementation.codehash;
        if (
            kind == 0 || version == 0 || implementation == address(0) || implementationCodeHash == bytes32(0)
                || interfaceId == bytes4(0) || interfaceId == INVALID_INTERFACE_ID || policyHash == bytes32(0)
                || metadataHash == bytes32(0) || !_supportsInterface(implementation, interfaceId)
        ) revert InvalidConfiguration();

        bytes32 versionKey = keccak256(abi.encode(kind, version));
        bytes32 existingModuleKey = moduleKeyByKindAndVersion[versionKey];
        if (existingModuleKey != bytes32(0)) revert ModuleVersionAlreadyRegistered(existingModuleKey);

        moduleKey = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                kind,
                version,
                implementation,
                interfaceId,
                implementationCodeHash,
                policyHash,
                metadataHash
            )
        );

        _modules[moduleKey] = Module({
            kind: kind,
            version: version,
            implementation: implementation,
            interfaceId: interfaceId,
            implementationCodeHash: implementationCodeHash,
            policyHash: policyHash,
            metadataHash: metadataHash,
            registeredAt: uint64(block.timestamp),
            deactivatedAt: 0,
            active: true
        });
        moduleKeyByKindAndVersion[versionKey] = moduleKey;

        emit ModuleRegistered(
            moduleKey, kind, version, implementation, interfaceId, implementationCodeHash, policyHash, metadataHash
        );
    }

    /// @notice Permanently stops new releases from selecting a module.
    /// @dev History is retained. A corrected implementation must use a new version.
    function deactivateModule(bytes32 moduleKey) external onlyGovernance {
        Module storage module = _requireModule(moduleKey);
        if (!module.active) revert ModuleAlreadyInactive();
        module.active = false;
        module.deactivatedAt = uint64(block.timestamp);
        emit ModuleDeactivated(moduleKey, module.deactivatedAt);
    }

    function getModule(bytes32 moduleKey) external view override returns (Module memory) {
        return _requireModule(moduleKey);
    }

    function isModuleActive(bytes32 moduleKey) external view override returns (bool) {
        return _modules[moduleKey].registeredAt != 0 && _modules[moduleKey].active;
    }

    function _requireModule(bytes32 moduleKey) private view returns (Module storage module) {
        module = _modules[moduleKey];
        if (module.registeredAt == 0) revert UnknownModule();
    }

    function _supportsInterface(address implementation, bytes4 interfaceId) private view returns (bool) {
        (bool erc165Success, bytes memory erc165Data) =
            implementation.staticcall(abi.encodeWithSelector(ERC165_INTERFACE_ID, ERC165_INTERFACE_ID));
        (bool interfaceSuccess, bytes memory interfaceData) =
            implementation.staticcall(abi.encodeWithSelector(ERC165_INTERFACE_ID, interfaceId));
        return erc165Success && erc165Data.length >= 32 && abi.decode(erc165Data, (bool)) && interfaceSuccess
            && interfaceData.length >= 32 && abi.decode(interfaceData, (bool));
    }
}
