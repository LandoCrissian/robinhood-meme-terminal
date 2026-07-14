// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV3} from "./clone/CloneBondingCurveMarketV3.sol";
import {CloneFixedSupplyMemeToken} from "./clone/CloneFixedSupplyMemeToken.sol";
import {CloneLaunchRewardVaultV2} from "./clone/CloneLaunchRewardVaultV2.sol";
import {ClonePurposeRewardVault} from "./clone/ClonePurposeRewardVault.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

interface IPurposeRewardsControllerV6 {
    function registerVault(address vault, address token, bytes32 purpose) external;
}

interface IProtectedIdentityFactoryV6 {
    function isNameUsed(string calldata name) external view returns (bool);
    function isSymbolUsed(string calldata symbol) external view returns (bool);
}

interface IOfficialLegacyTokenV6 {
    function creator() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @notice V5 settlement with a single, authority-bound migration for the original RMT identity.
/// @dev Every ordinary launch inherits all earlier reservations. The exception can be consumed once,
///      only by the immutable creator of the verified legacy RMT token, and only for that exact identity.
contract LowCostMemeLaunchFactoryV6 {
    uint256 public constant SETTLEMENT_VERSION = 3;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_NAME_BYTES = 32;
    uint256 public constant MIN_SYMBOL_BYTES = 2;
    uint256 public constant MAX_SYMBOL_BYTES = 10;
    uint256 public constant MAX_METADATA_URI_BYTES = 512;
    bytes32 public constant COMMUNITY_PURPOSE = keccak256("COMMUNITY_TREASURY");
    bytes32 public constant TRADER_PURPOSE = keccak256("TRADER_REWARDS");
    bytes32 public constant OFFICIAL_NAME_HASH = keccak256("robinhoodmemeterminal");
    bytes32 public constant OFFICIAL_SYMBOL_HASH = keccak256("rmt");

    address public immutable graduationAdapter;
    address public immutable tokenImplementation;
    address public immutable rewardVaultImplementation;
    address public immutable marketImplementation;
    address public immutable purposeVaultImplementation;
    address public immutable rewardsController;
    address public immutable platformTreasury;
    address public immutable legacyIdentityFactory;
    address public immutable officialLegacyToken;
    address public immutable officialMigrationAuthority;
    uint16 public immutable marketFeeBps;
    uint256 public immutable initialVirtualEthReserve;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable graduationTarget;
    bool public officialMigrationComplete;

    struct Launch {
        address token;
        address market;
        address rewardVault;
        bytes32 graduationPoolId;
        address creator;
        uint64 createdAt;
    }

    struct CommunityDestinations {
        address community;
        address traderRewards;
    }

    Launch[] private _launches;
    mapping(bytes32 hash => bool used) public usedNameHashes;
    mapping(bytes32 hash => bool used) public usedSymbolHashes;
    mapping(address token => CommunityDestinations destinations) public communityDestinationsForToken;

    event TokenLaunched(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address market,
        address rewardVault,
        bytes32 graduationPoolId,
        string name,
        string symbol,
        string metadataURI,
        uint16[5] rewardBps
    );
    event LaunchPresetSelected(address indexed token, address indexed creator, bool communityRewardsEnabled);
    event CommunityDestinationsCreated(
        address indexed token, address community, address traderRewards, address protocolRevenueRouter
    );
    event ProtectedIdentityReserved(bytes32 indexed nameHash, bytes32 indexed symbolHash);
    event OfficialIdentityMigrated(address indexed legacyToken, address indexed replacementToken, address indexed authority);

    error InvalidConfiguration();
    error InvalidName();
    error InvalidSymbol();
    error MetadataTooLong();
    error DuplicateName();
    error DuplicateSymbol();
    error InventoryTransferFailed();
    error InvalidPoolReservation();
    error OnlyOfficialMigrationAuthority();
    error OfficialMigrationAlreadyComplete();
    error InvalidOfficialMigration();

    constructor(
        address graduationAdapter_,
        uint16 marketFeeBps_,
        uint256 initialVirtualEthReserve_,
        uint256 initialVirtualTokenReserve_,
        uint256 graduationTarget_,
        address rewardsController_,
        address protocolRevenueRouter_,
        address legacyIdentityFactory_,
        address officialLegacyToken_,
        address officialMigrationAuthority_
    ) {
        if (
            graduationAdapter_ == address(0) || graduationAdapter_.code.length == 0 || marketFeeBps_ >= 10_000
                || initialVirtualEthReserve_ == 0 || initialVirtualTokenReserve_ <= TOKEN_SUPPLY
                || graduationTarget_ == 0 || rewardsController_ == address(0) || rewardsController_.code.length == 0
                || protocolRevenueRouter_ == address(0) || protocolRevenueRouter_.code.length == 0
                || legacyIdentityFactory_ == address(0) || legacyIdentityFactory_.code.length == 0
                || officialLegacyToken_ == address(0) || officialLegacyToken_.code.length == 0
                || officialMigrationAuthority_ == address(0)
        ) revert InvalidConfiguration();

        IOfficialLegacyTokenV6 legacyToken = IOfficialLegacyTokenV6(officialLegacyToken_);
        if (
            legacyToken.creator() != officialMigrationAuthority_
                || _canonicalName(legacyToken.name()) != OFFICIAL_NAME_HASH
                || _canonicalSymbol(legacyToken.symbol()) != OFFICIAL_SYMBOL_HASH
        ) revert InvalidOfficialMigration();
        IProtectedIdentityFactoryV6 legacy = IProtectedIdentityFactoryV6(legacyIdentityFactory_);
        if (!legacy.isNameUsed("Robinhood Meme Terminal") || !legacy.isSymbolUsed("RMT")) {
            revert InvalidOfficialMigration();
        }

        graduationAdapter = graduationAdapter_;
        marketFeeBps = marketFeeBps_;
        initialVirtualEthReserve = initialVirtualEthReserve_;
        initialVirtualTokenReserve = initialVirtualTokenReserve_;
        graduationTarget = graduationTarget_;
        rewardsController = rewardsController_;
        platformTreasury = protocolRevenueRouter_;
        legacyIdentityFactory = legacyIdentityFactory_;
        officialLegacyToken = officialLegacyToken_;
        officialMigrationAuthority = officialMigrationAuthority_;
        tokenImplementation = address(new CloneFixedSupplyMemeToken());
        rewardVaultImplementation = address(new CloneLaunchRewardVaultV2());
        marketImplementation = address(new CloneBondingCurveMarketV3());
        purposeVaultImplementation = address(new ClonePurposeRewardVault());
    }

    function launchSimple(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        _reserveIdentity(name, symbol, metadataURI);
        return _launchSimple(msg.sender, name, symbol, metadataURI, false);
    }

    function launchCommunity(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        _reserveIdentity(name, symbol, metadataURI);
        return _launchCommunity(msg.sender, name, symbol, metadataURI, false);
    }

    function launchOfficialSimple(string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        _reserveOfficialIdentity(metadataURI);
        return _launchSimple(msg.sender, "Robinhood Meme Terminal", "RMT", metadataURI, true);
    }

    function launchOfficialCommunity(string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        _reserveOfficialIdentity(metadataURI);
        return _launchCommunity(msg.sender, "Robinhood Meme Terminal", "RMT", metadataURI, true);
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }

    function isNameUsed(string calldata name) external view returns (bool) {
        return usedNameHashes[_canonicalName(name)]
            || IProtectedIdentityFactoryV6(legacyIdentityFactory).isNameUsed(name);
    }

    function isSymbolUsed(string calldata symbol) external view returns (bool) {
        return usedSymbolHashes[_canonicalSymbol(symbol)]
            || IProtectedIdentityFactoryV6(legacyIdentityFactory).isSymbolUsed(symbol);
    }

    function _launchSimple(
        address creator,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        bool officialMigration
    ) private returns (address token, address market, address rewardVault) {
        address[5] memory recipients = [creator, creator, creator, creator, platformTreasury];
        uint16[5] memory splits = [uint16(7_000), 0, 0, 0, 3_000];
        (token, market, rewardVault) = _launch(creator, name, symbol, metadataURI, recipients, splits);
        if (officialMigration) emit OfficialIdentityMigrated(officialLegacyToken, token, creator);
        emit LaunchPresetSelected(token, creator, false);
    }

    function _launchCommunity(
        address creator,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        bool officialMigration
    ) private returns (address token, address market, address rewardVault) {
        address community = MinimalProxy.clone(purposeVaultImplementation);
        address trader = MinimalProxy.clone(purposeVaultImplementation);
        address[5] memory recipients = [creator, community, trader, creator, platformTreasury];
        uint16[5] memory splits = [uint16(4_000), 2_000, 1_000, 0, 3_000];
        (token, market, rewardVault) = _launch(creator, name, symbol, metadataURI, recipients, splits);
        ClonePurposeRewardVault(payable(community)).initialize(rewardsController, token, COMMUNITY_PURPOSE);
        ClonePurposeRewardVault(payable(trader)).initialize(rewardsController, token, TRADER_PURPOSE);
        IPurposeRewardsControllerV6(rewardsController).registerVault(community, token, COMMUNITY_PURPOSE);
        IPurposeRewardsControllerV6(rewardsController).registerVault(trader, token, TRADER_PURPOSE);
        communityDestinationsForToken[token] = CommunityDestinations(community, trader);
        if (officialMigration) emit OfficialIdentityMigrated(officialLegacyToken, token, creator);
        emit CommunityDestinationsCreated(token, community, trader, platformTreasury);
        emit LaunchPresetSelected(token, creator, true);
    }

    function _launch(
        address creator,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        address[5] memory recipients,
        uint16[5] memory splits
    ) private returns (address token, address market, address rewardVault) {
        token = MinimalProxy.clone(tokenImplementation);
        CloneFixedSupplyMemeToken(token).initialize(name, symbol, TOKEN_SUPPLY, creator, address(this), metadataURI);
        bytes32 poolId = IGraduationAdapter(graduationAdapter).prepare(token);
        if (poolId == bytes32(0)) revert InvalidPoolReservation();
        rewardVault = MinimalProxy.clone(rewardVaultImplementation);
        CloneLaunchRewardVaultV2(payable(rewardVault)).initialize(recipients, splits);
        market = MinimalProxy.clone(marketImplementation);
        CloneBondingCurveMarketV3(payable(market)).initialize(
            token,
            payable(rewardVault),
            graduationAdapter,
            poolId,
            marketFeeBps,
            initialVirtualEthReserve,
            initialVirtualTokenReserve,
            graduationTarget
        );
        IGraduationAdapter(graduationAdapter).bindMarket(token, market);
        if (!CloneFixedSupplyMemeToken(token).transfer(market, TOKEN_SUPPLY)) revert InventoryTransferFailed();
        uint256 launchId = _launches.length;
        _launches.push(Launch(token, market, rewardVault, poolId, creator, uint64(block.timestamp)));
        emit TokenLaunched(launchId, token, creator, market, rewardVault, poolId, name, symbol, metadataURI, splits);
    }

    function _reserveIdentity(string memory name, string memory symbol, string memory metadataURI) private {
        if (bytes(metadataURI).length > MAX_METADATA_URI_BYTES) revert MetadataTooLong();
        IProtectedIdentityFactoryV6 legacy = IProtectedIdentityFactoryV6(legacyIdentityFactory);
        if (legacy.isNameUsed(name)) revert DuplicateName();
        if (legacy.isSymbolUsed(symbol)) revert DuplicateSymbol();
        bytes32 nameHash = _canonicalName(name);
        bytes32 symbolHash = _canonicalSymbol(symbol);
        if (usedNameHashes[nameHash]) revert DuplicateName();
        if (usedSymbolHashes[symbolHash]) revert DuplicateSymbol();
        usedNameHashes[nameHash] = true;
        usedSymbolHashes[symbolHash] = true;
        emit ProtectedIdentityReserved(nameHash, symbolHash);
    }

    function _reserveOfficialIdentity(string memory metadataURI) private {
        if (msg.sender != officialMigrationAuthority) revert OnlyOfficialMigrationAuthority();
        if (officialMigrationComplete) revert OfficialMigrationAlreadyComplete();
        if (bytes(metadataURI).length > MAX_METADATA_URI_BYTES) revert MetadataTooLong();
        if (usedNameHashes[OFFICIAL_NAME_HASH] || usedSymbolHashes[OFFICIAL_SYMBOL_HASH]) {
            revert InvalidOfficialMigration();
        }
        IProtectedIdentityFactoryV6 legacy = IProtectedIdentityFactoryV6(legacyIdentityFactory);
        if (!legacy.isNameUsed("Robinhood Meme Terminal") || !legacy.isSymbolUsed("RMT")) {
            revert InvalidOfficialMigration();
        }
        officialMigrationComplete = true;
        usedNameHashes[OFFICIAL_NAME_HASH] = true;
        usedSymbolHashes[OFFICIAL_SYMBOL_HASH] = true;
        emit ProtectedIdentityReserved(OFFICIAL_NAME_HASH, OFFICIAL_SYMBOL_HASH);
    }

    function _canonicalName(string memory value) private pure returns (bytes32) {
        bytes memory raw = bytes(value);
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
}
