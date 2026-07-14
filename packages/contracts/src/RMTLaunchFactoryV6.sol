// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneFixedSupplyMemeToken} from "./clone/CloneFixedSupplyMemeToken.sol";
import {CloneBondingCurveMarketV6} from "./clone/CloneBondingCurveMarketV6.sol";
import {DirectLaunchFeeSplitter} from "./DirectLaunchFeeSplitter.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";
import {IV6GraduationAdapter} from "./interfaces/IV6GraduationAdapter.sol";
import {IRMTLaunchFactoryV6} from "./interfaces/IRMTLaunchFactoryV6.sol";
import {IRMTLaunchPolicyRegistry} from "./interfaces/IRMTLaunchPolicyRegistry.sol";
import {OfficialRMTIdentityMigration} from "./OfficialRMTIdentityMigration.sol";

interface IRMTLaunchGateView {
    function launchesPaused() external view returns (bool);
    function requireLaunchesOpen() external view;
}

interface ILegacyIdentityFactoryV6 {
    function isNameUsed(string calldata name) external view returns (bool);
    function isSymbolUsed(string calldata symbol) external view returns (bool);
}

/// @notice Policy-driven V6 factory with one gated launch pipeline shared by all present and future styles.
contract RMTLaunchFactoryV6 is IRMTLaunchFactoryV6 {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_NAME_BYTES = 32;
    uint256 public constant MIN_SYMBOL_BYTES = 2;
    uint256 public constant MAX_SYMBOL_BYTES = 10;
    uint256 public constant MAX_METADATA_URI_BYTES = 512;

    IRMTLaunchGateView public immutable launchGate;
    IRMTLaunchPolicyRegistry public immutable policyRegistry;
    address public immutable tokenImplementation;
    address public immutable feeSplitterImplementation;
    address public immutable legacyIdentityFactory;
    OfficialRMTIdentityMigration public immutable officialIdentityMigration;
    uint256 public immutable initialVirtualEthReserve;
    uint256 public immutable initialVirtualTokenReserve;

    LaunchView[] private _launches;
    mapping(bytes32 hash => bool used) public usedNameHashes;
    mapping(bytes32 hash => bool used) public usedSymbolHashes;

    event TokenLaunchedV6(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address market,
        address feeSplitter,
        bytes32 graduationPoolId,
        bytes32 policyId,
        uint32 policyVersion,
        uint16 curveFeeBps,
        uint16 creatorFeeShareBps,
        uint16 protocolFeeShareBps,
        uint16 postGraduationFeeBps,
        bool fairStartEnabled,
        uint64 fairStartDelayBlocks,
        uint64 fairStartDurationBlocks,
        uint16 fairStartMaxTxBps,
        uint16 fairStartMaxWalletBps,
        uint256 graduationTarget,
        string name,
        string symbol,
        string metadataURI
    );
    event ProtectedIdentityReserved(bytes32 indexed nameHash, bytes32 indexed symbolHash);
    event OfficialRMTMigrationLaunched(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address migrationAuthority
    );

    error InvalidConfiguration();
    error InvalidName();
    error InvalidSymbol();
    error MetadataTooLong();
    error DuplicateName();
    error DuplicateSymbol();
    error UnknownOrDisabledPolicy();
    error InventoryTransferFailed();
    error InvalidPoolReservation();
    error InvalidMarketImplementation();
    error UnsupportedFairStartMode();

    constructor(
        address launchGate_,
        address policyRegistry_,
        uint256 initialVirtualEthReserve_,
        uint256 initialVirtualTokenReserve_,
        address legacyIdentityFactory_,
        address officialLauncher_
    ) {
        if (
            launchGate_ == address(0) || launchGate_.code.length == 0 || policyRegistry_ == address(0)
                || policyRegistry_.code.length == 0 || initialVirtualEthReserve_ == 0
                || initialVirtualTokenReserve_ <= TOKEN_SUPPLY || legacyIdentityFactory_ == address(0)
                || legacyIdentityFactory_.code.length == 0 || officialLauncher_ == address(0)
        ) revert InvalidConfiguration();

        launchGate = IRMTLaunchGateView(launchGate_);
        policyRegistry = IRMTLaunchPolicyRegistry(policyRegistry_);
        initialVirtualEthReserve = initialVirtualEthReserve_;
        initialVirtualTokenReserve = initialVirtualTokenReserve_;
        legacyIdentityFactory = legacyIdentityFactory_;
        officialIdentityMigration = new OfficialRMTIdentityMigration(officialLauncher_, address(this));
        tokenImplementation = address(new CloneFixedSupplyMemeToken());
        feeSplitterImplementation = address(new DirectLaunchFeeSplitter());
    }

    function protocolVersion() external pure returns (uint32) { return 6; }
    function launchesPaused() external view returns (bool) { return launchGate.launchesPaused(); }
    function defaultPolicyId() public view returns (bytes32) { return policyRegistry.defaultPolicyId(); }

    function getPolicy(bytes32 policyId) external view returns (LaunchPolicyView memory viewPolicy) {
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = policyRegistry.getPolicy(policyId);
        viewPolicy = LaunchPolicyView({
            policyId: policy.policyId,
            policyVersion: policy.policyVersion,
            enabled: policy.enabled,
            publiclySelectable: policy.publiclySelectable,
            curveFeeBps: policy.curveFeeBps,
            creatorFeeShareBps: policy.creatorFeeShareBps,
            protocolFeeShareBps: policy.protocolFeeShareBps,
            postGraduationFeeBps: policy.postGraduationFeeBps,
            graduationTarget: policy.graduationTarget,
            fairStartMode: policy.fairStartMode,
            fairStartDelayBlocks: policy.fairStartDelayBlocks,
            fairStartDurationBlocks: policy.fairStartDurationBlocks,
            fairStartMaxTxBps: policy.fairStartMaxTxBps,
            fairStartMaxWalletBps: policy.fairStartMaxWalletBps
        });
    }

    function isPolicyEnabled(bytes32 policyId) external view returns (bool) {
        return policyRegistry.isPolicyEnabled(policyId);
    }

    function launch(bytes32 policyId, string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        return _launch(policyId, msg.sender, name, symbol, metadataURI);
    }

    function launchSimple(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        return _launch(defaultPolicyId(), msg.sender, name, symbol, metadataURI);
    }

    function launchCount() external view returns (uint256) { return _launches.length; }
    function getLaunch(uint256 launchId) external view returns (LaunchView memory) { return _launches[launchId]; }

    function isNameUsed(string calldata name) external view returns (bool) {
        return usedNameHashes[_canonicalName(name)] || ILegacyIdentityFactoryV6(legacyIdentityFactory).isNameUsed(name);
    }

    function isSymbolUsed(string calldata symbol) external view returns (bool) {
        return usedSymbolHashes[_canonicalSymbol(symbol)] || ILegacyIdentityFactoryV6(legacyIdentityFactory).isSymbolUsed(symbol);
    }

    function canMigrateOfficialIdentity(address launcher, string calldata name, string calldata symbol)
        external view returns (bool)
    {
        return officialIdentityMigration.canMigrate(launcher, _canonicalName(name), _canonicalSymbol(symbol));
    }

    function _launch(
        bytes32 policyId,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) private returns (address token, address market, address rewardVault) {
        launchGate.requireLaunchesOpen();
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = policyRegistry.getPolicy(policyId);
        if (!policy.enabled || !policy.publiclySelectable) revert UnknownOrDisabledPolicy();
        if (policy.marketImplementation.code.length == 0) revert InvalidMarketImplementation();
        bool fairStartEnabled = _fairStartEnabled(policy.fairStartMode);

        bool officialMigration = _reserveIdentity(creator, name, symbol, metadataURI);
        token = MinimalProxy.clone(tokenImplementation);
        CloneFixedSupplyMemeToken(token).initialize(name, symbol, TOKEN_SUPPLY, creator, address(this), metadataURI);

        bytes32 poolId = IGraduationAdapter(policy.graduationAdapter).prepare(token);
        if (poolId == bytes32(0)) revert InvalidPoolReservation();

        rewardVault = MinimalProxy.clone(feeSplitterImplementation);
        DirectLaunchFeeSplitter(payable(rewardVault)).initialize(
            payable(creator), payable(policy.protocolTreasury), policy.creatorFeeShareBps
        );

        market = MinimalProxy.clone(policy.marketImplementation);
        CloneBondingCurveMarketV6(payable(market)).initialize(
            token,
            payable(rewardVault),
            policy.graduationAdapter,
            poolId,
            policy.policyId,
            policy.policyVersion,
            policy.curveFeeBps,
            initialVirtualEthReserve,
            initialVirtualTokenReserve,
            policy.graduationTarget,
            fairStartEnabled,
            policy.fairStartDelayBlocks,
            policy.fairStartDurationBlocks,
            policy.fairStartMaxTxBps,
            policy.fairStartMaxWalletBps
        );
        IV6GraduationAdapter(policy.graduationAdapter).configureFeeRouting(
            token, rewardVault, policy.postGraduationFeeBps
        );
        IGraduationAdapter(policy.graduationAdapter).bindMarket(token, market);
        if (!CloneFixedSupplyMemeToken(token).transfer(market, TOKEN_SUPPLY)) revert InventoryTransferFailed();

        uint256 launchId = _launches.length;
        _launches.push(LaunchView({
            token: token,
            market: market,
            rewardVault: rewardVault,
            graduationPoolId: poolId,
            creator: creator,
            policyId: policy.policyId,
            policyVersion: policy.policyVersion,
            createdAt: uint64(block.timestamp),
            officialMigration: officialMigration
        }));

        emit TokenLaunchedV6(
            launchId,
            token,
            creator,
            market,
            rewardVault,
            poolId,
            policy.policyId,
            policy.policyVersion,
            policy.curveFeeBps,
            policy.creatorFeeShareBps,
            policy.protocolFeeShareBps,
            policy.postGraduationFeeBps,
            fairStartEnabled,
            policy.fairStartDelayBlocks,
            policy.fairStartDurationBlocks,
            policy.fairStartMaxTxBps,
            policy.fairStartMaxWalletBps,
            policy.graduationTarget,
            name,
            symbol,
            metadataURI
        );
        if (officialMigration) {
            emit OfficialRMTMigrationLaunched(launchId, token, creator, address(officialIdentityMigration));
        }
    }

    function _fairStartEnabled(uint8 mode) private pure returns (bool) {
        if (mode > 1) revert UnsupportedFairStartMode();
        return mode == 1;
    }

    function _reserveIdentity(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) private returns (bool officialMigration) {
        if (bytes(metadataURI).length > MAX_METADATA_URI_BYTES) revert MetadataTooLong();
        ILegacyIdentityFactoryV6 legacy = ILegacyIdentityFactoryV6(legacyIdentityFactory);
        bytes32 nameHash = _canonicalName(name);
        bytes32 symbolHash = _canonicalSymbol(symbol);
        bool legacyNameUsed = legacy.isNameUsed(name);
        bool legacySymbolUsed = legacy.isSymbolUsed(symbol);
        if (legacyNameUsed || legacySymbolUsed) {
            if (!officialIdentityMigration.canMigrate(creator, nameHash, symbolHash)) {
                if (legacyNameUsed) revert DuplicateName();
                revert DuplicateSymbol();
            }
            officialIdentityMigration.consume(creator, nameHash, symbolHash);
            officialMigration = true;
        }
        if (usedNameHashes[nameHash]) revert DuplicateName();
        if (usedSymbolHashes[symbolHash]) revert DuplicateSymbol();
        usedNameHashes[nameHash] = true;
        usedSymbolHashes[symbolHash] = true;
        emit ProtectedIdentityReserved(nameHash, symbolHash);
    }

    function _canonicalName(string calldata value) private pure returns (bytes32) {
        bytes calldata raw = bytes(value);
        if (raw.length == 0 || raw.length > MAX_NAME_BYTES || raw[0] == bytes1(" ") || raw[raw.length - 1] == bytes1(" ")) {
            revert InvalidName();
        }
        bytes memory canonical = new bytes(raw.length);
        uint256 length;
        for (uint256 i; i < raw.length; ++i) {
            uint8 character = uint8(raw[i]);
            bool uppercase = character >= 65 && character <= 90;
            bool lowercase = character >= 97 && character <= 122;
            bool digit = character >= 48 && character <= 57;
            bool separator = character == 32 || character == 39 || character == 45 || character == 46 || character == 95;
            if (!(uppercase || lowercase || digit || separator)) revert InvalidName();
            if (uppercase) character += 32;
            if (uppercase || lowercase || digit) canonical[length++] = bytes1(character);
        }
        if (length == 0) revert InvalidName();
        assembly ("memory-safe") { mstore(canonical, length) }
        return keccak256(canonical);
    }

    function _canonicalSymbol(string calldata value) private pure returns (bytes32) {
        bytes calldata raw = bytes(value);
        if (raw.length < MIN_SYMBOL_BYTES || raw.length > MAX_SYMBOL_BYTES) revert InvalidSymbol();
        bytes memory canonical = new bytes(raw.length);
        for (uint256 i; i < raw.length; ++i) {
            uint8 character = uint8(raw[i]);
            bool uppercase = character >= 65 && character <= 90;
            bool lowercase = character >= 97 && character <= 122;
            bool digit = character >= 48 && character <= 57;
            if (!(uppercase || lowercase || digit)) revert InvalidSymbol();
            if (uppercase) character += 32;
            canonical[i] = bytes1(character);
        }
        return keccak256(canonical);
    }
}
