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
    function governance() external view returns (address);
    function requireLaunchesOpen() external view;
}

interface IFactoryVersionRegistryV6 {
    function governance() external view returns (address);
    function activeFactory() external view returns (address);
    function activeVersion() external view returns (bytes32);
}

interface ILegacyIdentityFactoryV6 {
    function isNameUsed(string calldata name) external view returns (bool);
    function isSymbolUsed(string calldata symbol) external view returns (bool);
}

interface IOfficialLegacyRMTTokenV6 {
    function creator() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @notice Policy-driven V6 factory with one gated launch pipeline shared by all present and future styles.
contract RMTLaunchFactoryV6 is IRMTLaunchFactoryV6 {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_NAME_BYTES = 32;
    uint256 public constant MIN_SYMBOL_BYTES = 2;
    uint256 public constant MAX_SYMBOL_BYTES = 10;
    uint256 public constant MAX_METADATA_URI_BYTES = 512;
    bytes32 public constant OFFICIAL_MIGRATION_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    bytes32 public constant FACTORY_VERSION = keccak256("RMT_FACTORY_V6");
    bytes32 public constant LEGACY_FACTORY_VERSION = keccak256("RMT_FACTORY_V5");
    bytes32 public constant OFFICIAL_NAME_HASH = keccak256("robinhoodmemeterminal");
    bytes32 public constant OFFICIAL_SYMBOL_HASH = keccak256("rmt");

    IRMTLaunchGateView public immutable launchGate;
    IRMTLaunchPolicyRegistry public immutable policyRegistry;
    IFactoryVersionRegistryV6 public immutable factoryRegistry;
    address public immutable tokenImplementation;
    address public immutable feeSplitterImplementation;
    address public immutable legacyIdentityFactory;
    address public immutable officialLegacyToken;
    address public immutable creatorPayoutAuthority;
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
        bool officialMigration,
        string name,
        string symbol,
        string metadataURI
    );
    event ProtectedIdentityReserved(bytes32 indexed nameHash, bytes32 indexed symbolHash);
    event OfficialRMTMigrationLaunched(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address migrationAuthority,
        address officialLegacyToken
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
    error OfficialMigrationPolicyRequired();
    error InactiveFactory();
    error OfficialPausedMigrationUnavailable();
    error OfficialMigrationPending();
    error InvalidOfficialLegacyToken();

    constructor(
        address launchGate_,
        address policyRegistry_,
        address factoryRegistry_,
        uint256 initialVirtualEthReserve_,
        uint256 initialVirtualTokenReserve_,
        address legacyIdentityFactory_,
        address officialLegacyToken_,
        address officialLauncher_
    ) {
        if (
            launchGate_ == address(0) || launchGate_.code.length == 0 || policyRegistry_ == address(0)
                || policyRegistry_.code.length == 0 || factoryRegistry_ == address(0)
                || factoryRegistry_.code.length == 0 || initialVirtualEthReserve_ == 0
                || initialVirtualTokenReserve_ <= TOKEN_SUPPLY || legacyIdentityFactory_ == address(0)
                || legacyIdentityFactory_.code.length == 0 || officialLegacyToken_ == address(0)
                || officialLegacyToken_.code.length == 0 || officialLauncher_ == address(0)
        ) revert InvalidConfiguration();
        address gateGovernance = IRMTLaunchGateView(launchGate_).governance();
        address policyGovernance = IRMTLaunchPolicyRegistry(policyRegistry_).governance();
        address registryGovernance = IFactoryVersionRegistryV6(factoryRegistry_).governance();
        address protocolTreasury = IRMTLaunchPolicyRegistry(policyRegistry_).canonicalProtocolTreasury();
        if (
            gateGovernance == address(0) || gateGovernance.code.length == 0 || policyGovernance != gateGovernance
                || registryGovernance != gateGovernance || protocolTreasury != gateGovernance
                || IFactoryVersionRegistryV6(factoryRegistry_).activeFactory() != legacyIdentityFactory_
                || IFactoryVersionRegistryV6(factoryRegistry_).activeVersion() != LEGACY_FACTORY_VERSION
        ) {
            revert InvalidConfiguration();
        }
        IOfficialLegacyRMTTokenV6 legacyToken = IOfficialLegacyRMTTokenV6(officialLegacyToken_);
        if (
            legacyToken.creator() != officialLauncher_ || _canonicalName(legacyToken.name()) != OFFICIAL_NAME_HASH
                || _canonicalSymbol(legacyToken.symbol()) != OFFICIAL_SYMBOL_HASH
        ) revert InvalidOfficialLegacyToken();
        ILegacyIdentityFactoryV6 legacy = ILegacyIdentityFactoryV6(legacyIdentityFactory_);
        if (!legacy.isNameUsed("Robinhood Meme Terminal") || !legacy.isSymbolUsed("RMT")) {
            revert InvalidOfficialLegacyToken();
        }

        launchGate = IRMTLaunchGateView(launchGate_);
        policyRegistry = IRMTLaunchPolicyRegistry(policyRegistry_);
        factoryRegistry = IFactoryVersionRegistryV6(factoryRegistry_);
        initialVirtualEthReserve = initialVirtualEthReserve_;
        initialVirtualTokenReserve = initialVirtualTokenReserve_;
        legacyIdentityFactory = legacyIdentityFactory_;
        officialLegacyToken = officialLegacyToken_;
        creatorPayoutAuthority = gateGovernance;
        officialIdentityMigration =
            new OfficialRMTIdentityMigration(officialLauncher_, address(this), officialLegacyToken_);
        tokenImplementation = address(new CloneFixedSupplyMemeToken());
        feeSplitterImplementation = address(new DirectLaunchFeeSplitter());
    }

    function protocolVersion() external pure returns (uint32) {
        return 6;
    }

    function launchesPaused() external view returns (bool) {
        return launchGate.launchesPaused();
    }

    function defaultPolicyId() public view returns (bytes32) {
        return policyRegistry.defaultPolicyId();
    }

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

    /// @notice Launches the exact official RMT migration while ordinary public launches remain paused.
    /// @dev This exception is available only after this factory is active in the version registry, only to the
    ///      immutable official launcher, only for the Fair Start policy, and only once. It does not unpause the gate.
    function launchOfficialWhilePaused(string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        _requireActiveFactory();
        if (
            !launchGate.launchesPaused() || policyRegistry.defaultPolicyId() != OFFICIAL_MIGRATION_POLICY_ID
                || !_officialLegacyIdentityReserved()
        ) revert OfficialPausedMigrationUnavailable();
        if (!officialIdentityMigration.canMigrate(
                msg.sender, _canonicalName("Robinhood Meme Terminal"), _canonicalSymbol("RMT")
            )) revert OfficialPausedMigrationUnavailable();
        return _launch(OFFICIAL_MIGRATION_POLICY_ID, msg.sender, "Robinhood Meme Terminal", "RMT", metadataURI, true);
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 launchId) external view returns (LaunchView memory) {
        return _launches[launchId];
    }

    function isNameUsed(string calldata name) external view returns (bool) {
        return usedNameHashes[_canonicalName(name)] || ILegacyIdentityFactoryV6(legacyIdentityFactory).isNameUsed(name);
    }

    function isSymbolUsed(string calldata symbol) external view returns (bool) {
        return usedSymbolHashes[_canonicalSymbol(symbol)]
            || ILegacyIdentityFactoryV6(legacyIdentityFactory).isSymbolUsed(symbol);
    }

    function canMigrateOfficialIdentity(
        address launcher,
        bytes32 policyId,
        string calldata name,
        string calldata symbol
    ) external view returns (bool) {
        return policyId == OFFICIAL_MIGRATION_POLICY_ID && factoryRegistry.activeFactory() == address(this)
            && factoryRegistry.activeVersion() == FACTORY_VERSION
            && launchGate.launchesPaused() && policyRegistry.defaultPolicyId() == OFFICIAL_MIGRATION_POLICY_ID
            && _officialLegacyIdentityReserved()
            && officialIdentityMigration.canMigrate(launcher, _canonicalName(name), _canonicalSymbol(symbol));
    }

    function _launch(
        bytes32 policyId,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) private returns (address token, address market, address rewardVault) {
        return _launch(policyId, creator, name, symbol, metadataURI, false);
    }

    function _launch(
        bytes32 policyId,
        address creator,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        bool officialPausedMigration
    ) private returns (address token, address market, address rewardVault) {
        _requireActiveFactory();
        if (officialPausedMigration) {
            if (policyId != OFFICIAL_MIGRATION_POLICY_ID || !launchGate.launchesPaused()) {
                revert OfficialPausedMigrationUnavailable();
            }
        } else {
            if (!officialIdentityMigration.consumed()) revert OfficialMigrationPending();
            launchGate.requireLaunchesOpen();
        }
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = policyRegistry.getPolicy(policyId);
        if (!policy.enabled || !policy.publiclySelectable) revert UnknownOrDisabledPolicy();
        if (policy.marketImplementation.code.length == 0) revert InvalidMarketImplementation();
        bool fairStartEnabled = _fairStartEnabled(policy.fairStartMode);

        bool officialMigration = _reserveIdentity(policyId, creator, name, symbol, metadataURI);
        if (officialPausedMigration && !officialMigration) revert OfficialPausedMigrationUnavailable();
        token = MinimalProxy.clone(tokenImplementation);
        rewardVault = MinimalProxy.clone(feeSplitterImplementation);
        market = MinimalProxy.clone(policy.marketImplementation);

        CloneFixedSupplyMemeToken(token).initialize(name, symbol, TOKEN_SUPPLY, creator, address(this), metadataURI);
        DirectLaunchFeeSplitter(payable(rewardVault))
            .initialize(
                payable(creator),
                payable(policy.protocolTreasury),
                token,
                policy.creatorFeeShareBps,
                creatorPayoutAuthority,
                market,
                policy.graduationAdapter
            );

        bytes32 poolId = IGraduationAdapter(policy.graduationAdapter).prepare(token);
        if (poolId == bytes32(0)) revert InvalidPoolReservation();

        CloneBondingCurveMarketV6(payable(market))
            .initialize(
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
        IV6GraduationAdapter(policy.graduationAdapter)
            .configureFeeRouting(token, rewardVault, policy.postGraduationFeeBps);
        IGraduationAdapter(policy.graduationAdapter).bindMarket(token, market);
        if (!CloneFixedSupplyMemeToken(token).transfer(market, TOKEN_SUPPLY)) revert InventoryTransferFailed();

        uint256 launchId = _launches.length;
        _launches.push(
            LaunchView({
                token: token,
                market: market,
                rewardVault: rewardVault,
                graduationPoolId: poolId,
                creator: creator,
                policyId: policy.policyId,
                policyVersion: policy.policyVersion,
                createdAt: uint64(block.timestamp),
                officialMigration: officialMigration
            })
        );

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
            officialMigration,
            name,
            symbol,
            metadataURI
        );
        if (officialMigration) {
            emit OfficialRMTMigrationLaunched(
                launchId, token, creator, address(officialIdentityMigration), officialLegacyToken
            );
        }
    }

    function _fairStartEnabled(uint8 mode) private pure returns (bool) {
        if (mode > 1) revert UnsupportedFairStartMode();
        return mode == 1;
    }

    function _officialLegacyIdentityReserved() private view returns (bool) {
        ILegacyIdentityFactoryV6 legacy = ILegacyIdentityFactoryV6(legacyIdentityFactory);
        return legacy.isNameUsed("Robinhood Meme Terminal") && legacy.isSymbolUsed("RMT");
    }

    function _reserveIdentity(
        bytes32 policyId,
        address creator,
        string memory name,
        string memory symbol,
        string memory metadataURI
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
            if (policyId != OFFICIAL_MIGRATION_POLICY_ID) revert OfficialMigrationPolicyRequired();
            officialIdentityMigration.consume(creator, nameHash, symbolHash);
            officialMigration = true;
        }
        if (usedNameHashes[nameHash]) revert DuplicateName();
        if (usedSymbolHashes[symbolHash]) revert DuplicateSymbol();
        usedNameHashes[nameHash] = true;
        usedSymbolHashes[symbolHash] = true;
        emit ProtectedIdentityReserved(nameHash, symbolHash);
    }

    function _canonicalName(string memory value) private pure returns (bytes32) {
        bytes memory raw = bytes(value);
        if (
            raw.length == 0 || raw.length > MAX_NAME_BYTES || raw[0] == bytes1(" ")
                || raw[raw.length - 1] == bytes1(" ")
        ) {
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

    function _canonicalSymbol(string memory value) private pure returns (bytes32) {
        bytes memory raw = bytes(value);
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

    function _requireActiveFactory() private view {
        if (factoryRegistry.activeFactory() != address(this) || factoryRegistry.activeVersion() != FACTORY_VERSION) {
            revert InactiveFactory();
        }
    }
}
