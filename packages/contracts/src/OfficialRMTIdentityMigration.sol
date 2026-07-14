// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice One-time authorization for the official RMT token identity to migrate from V5 to V6.
/// @dev This contract does not weaken general legacy identity protection. It authorizes exactly one
///      canonical name/ticker pair, for exactly one launcher, and permanently consumes authorization.
contract OfficialRMTIdentityMigration {
    bytes32 public constant OFFICIAL_NAME_HASH = keccak256("robinhoodmemeterminal");
    bytes32 public constant OFFICIAL_SYMBOL_HASH = keccak256("rmt");

    address public immutable officialLauncher;
    address public immutable authorizedFactory;
    bool public consumed;

    event OfficialIdentityMigrationConsumed(address indexed launcher, address indexed factory);

    error OnlyAuthorizedFactory();
    error InvalidConfiguration();
    error UnauthorizedLauncher();
    error InvalidOfficialIdentity();
    error MigrationAlreadyConsumed();

    constructor(address officialLauncher_, address authorizedFactory_) {
        if (officialLauncher_ == address(0) || authorizedFactory_ == address(0)) revert InvalidConfiguration();
        officialLauncher = officialLauncher_;
        authorizedFactory = authorizedFactory_;
    }

    function consume(address launcher, bytes32 canonicalNameHash, bytes32 canonicalSymbolHash) external {
        if (msg.sender != authorizedFactory) revert OnlyAuthorizedFactory();
        if (consumed) revert MigrationAlreadyConsumed();
        if (launcher != officialLauncher) revert UnauthorizedLauncher();
        if (canonicalNameHash != OFFICIAL_NAME_HASH || canonicalSymbolHash != OFFICIAL_SYMBOL_HASH) {
            revert InvalidOfficialIdentity();
        }

        consumed = true;
        emit OfficialIdentityMigrationConsumed(launcher, msg.sender);
    }

    function canMigrate(address launcher, bytes32 canonicalNameHash, bytes32 canonicalSymbolHash)
        external
        view
        returns (bool)
    {
        return !consumed && launcher == officialLauncher && canonicalNameHash == OFFICIAL_NAME_HASH
            && canonicalSymbolHash == OFFICIAL_SYMBOL_HASH;
    }
}
