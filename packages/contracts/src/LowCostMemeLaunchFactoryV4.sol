// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV2} from "./clone/CloneBondingCurveMarketV2.sol";
import {CloneFixedSupplyMemeToken} from "./clone/CloneFixedSupplyMemeToken.sol";
import {CloneLaunchRewardVault} from "./clone/CloneLaunchRewardVault.sol";
import {ClonePurposeRewardVault} from "./clone/ClonePurposeRewardVault.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

/// @notice Mainnet launch factory V4 with preset economics, protected identities, and Fair Start markets.
/// @dev This factory has no owner, proxy, arbitrary fee settings, or raw custom-recipient launch function.
contract LowCostMemeLaunchFactoryV4 {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_NAME_BYTES = 32;
    uint256 public constant MIN_SYMBOL_BYTES = 2;
    uint256 public constant MAX_SYMBOL_BYTES = 10;
    uint256 public constant MAX_METADATA_URI_BYTES = 512;

    bytes32 public constant COMMUNITY_PURPOSE = keccak256("COMMUNITY_TREASURY");
    bytes32 public constant TRADER_PURPOSE = keccak256("TRADER_REWARDS");

    address public immutable graduationAdapter;
    address public immutable tokenImplementation;
    address public immutable rewardVaultImplementation;
    address public immutable marketImplementation;
    address public immutable purposeVaultImplementation;
    address public immutable rewardsController;

    /// @notice Compatibility name for the immutable ProtocolRevenueRouter recipient.
    address public immutable platformTreasury;

    uint16 public immutable marketFeeBps;
    uint256 public immutable initialVirtualEthReserve;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable graduationTarget;

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

    error InvalidConfiguration();
    error InvalidName();
    error InvalidSymbol();
    error MetadataTooLong();
    error DuplicateName();
    error DuplicateSymbol();
    error InventoryTransferFailed();
    error InvalidPoolReservation();

    constructor(
        address graduationAdapter_,
        uint16 marketFeeBps_,
        uint256 initialVirtualEthReserve_,
        uint256 initialVirtualTokenReserve_,
        uint256 graduationTarget_,
        address rewardsController_,
        address protocolRevenueRouter_
    ) {
        if (
            graduationAdapter_ == address(0) || graduationAdapter_.code.length == 0 || marketFeeBps_ >= 10_000
                || initialVirtualEthReserve_ == 0 || initialVirtualTokenReserve_ <= TOKEN_SUPPLY
                || graduationTarget_ == 0 || rewardsController_ == address(0) || rewardsController_.code.length == 0
                || protocolRevenueRouter_ == address(0) || protocolRevenueRouter_.code.length == 0
        ) revert InvalidConfiguration();

        graduationAdapter = graduationAdapter_;
        marketFeeBps = marketFeeBps_;
        initialVirtualEthReserve = initialVirtualEthReserve_;
        initialVirtualTokenReserve = initialVirtualTokenReserve_;
        graduationTarget = graduationTarget_;
        rewardsController = rewardsController_;
        platformTreasury = protocolRevenueRouter_;

        tokenImplementation = address(new CloneFixedSupplyMemeToken());
        rewardVaultImplementation = address(new CloneLaunchRewardVault());
        marketImplementation = address(new CloneBondingCurveMarketV2());
        purposeVaultImplementation = address(new ClonePurposeRewardVault());
    }

    /// @notice One-click launch: 70% of the market fee to creator, 30% to the protocol flywheel.
    function launchSimple(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        (bytes32 nameHash, bytes32 symbolHash) = _reserveIdentity(name, symbol, metadataURI);
        address[5] memory recipients = [msg.sender, msg.sender, msg.sender, msg.sender, platformTreasury];
        uint16[5] memory splits = [uint16(7_000), 0, 0, 0, 3_000];

        (token, market, rewardVault) =
            _launch(msg.sender, name, symbol, metadataURI, recipients, splits, nameHash, symbolHash);
        emit LaunchPresetSelected(token, msg.sender, false);
    }

    /// @notice One-click community launch with automatic purpose-specific vaults.
    /// @dev Fee split: 40% creator, 20% community, 10% trader incentives, 30% protocol flywheel.
    function launchCommunity(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        (bytes32 nameHash, bytes32 symbolHash) = _reserveIdentity(name, symbol, metadataURI);

        address community = MinimalProxy.clone(purposeVaultImplementation);
        address trader = MinimalProxy.clone(purposeVaultImplementation);
        address[5] memory recipients = [msg.sender, community, trader, msg.sender, platformTreasury];
        uint16[5] memory splits = [uint16(4_000), 2_000, 1_000, 0, 3_000];

        (token, market, rewardVault) =
            _launch(msg.sender, name, symbol, metadataURI, recipients, splits, nameHash, symbolHash);

        ClonePurposeRewardVault(payable(community)).initialize(rewardsController, token, COMMUNITY_PURPOSE);
        ClonePurposeRewardVault(payable(trader)).initialize(rewardsController, token, TRADER_PURPOSE);
        communityDestinationsForToken[token] = CommunityDestinations(community, trader);

        emit CommunityDestinationsCreated(token, community, trader, platformTreasury);
        emit LaunchPresetSelected(token, msg.sender, true);
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }

    function isNameUsed(string calldata name) external view returns (bool) {
        return usedNameHashes[_canonicalName(name)];
    }

    function isSymbolUsed(string calldata symbol) external view returns (bool) {
        return usedSymbolHashes[_canonicalSymbol(symbol)];
    }

    function _launch(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address[5] memory recipients,
        uint16[5] memory splits,
        bytes32,
        bytes32
    ) private returns (address token, address market, address rewardVault) {
        token = MinimalProxy.clone(tokenImplementation);
        CloneFixedSupplyMemeToken(token).initialize(name, symbol, TOKEN_SUPPLY, creator, address(this), metadataURI);

        bytes32 poolId = IGraduationAdapter(graduationAdapter).prepare(token);
        if (poolId == bytes32(0)) revert InvalidPoolReservation();

        rewardVault = MinimalProxy.clone(rewardVaultImplementation);
        CloneLaunchRewardVault(payable(rewardVault)).initialize(recipients, splits);

        market = MinimalProxy.clone(marketImplementation);
        CloneBondingCurveMarketV2(payable(market)).initialize(
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
        emit TokenLaunched(
            launchId, token, creator, market, rewardVault, poolId, name, symbol, metadataURI, splits
        );
    }

    function _reserveIdentity(string calldata name, string calldata symbol, string calldata metadataURI)
        private
        returns (bytes32 nameHash, bytes32 symbolHash)
    {
        if (bytes(metadataURI).length > MAX_METADATA_URI_BYTES) revert MetadataTooLong();

        nameHash = _canonicalName(name);
        symbolHash = _canonicalSymbol(symbol);
        if (usedNameHashes[nameHash]) revert DuplicateName();
        if (usedSymbolHashes[symbolHash]) revert DuplicateSymbol();

        usedNameHashes[nameHash] = true;
        usedSymbolHashes[symbolHash] = true;
        emit ProtectedIdentityReserved(nameHash, symbolHash);
    }

    function _canonicalName(string calldata value) private pure returns (bytes32) {
        bytes calldata raw = bytes(value);
        if (
            raw.length == 0 || raw.length > MAX_NAME_BYTES || raw[0] == bytes1(" ")
                || raw[raw.length - 1] == bytes1(" ")
        ) revert InvalidName();

        bytes memory canonical = new bytes(raw.length);
        uint256 length;
        for (uint256 i; i < raw.length; ++i) {
            uint8 character = uint8(raw[i]);
            bool uppercase = character >= 65 && character <= 90;
            bool lowercase = character >= 97 && character <= 122;
            bool digit = character >= 48 && character <= 57;
            bool separator =
                character == 32 || character == 39 || character == 45 || character == 46 || character == 95;

            if (!(uppercase || lowercase || digit || separator)) revert InvalidName();
            if (uppercase) character += 32;
            if (uppercase || lowercase || digit) {
                canonical[length] = bytes1(character);
                ++length;
            }
        }
        if (length == 0) revert InvalidName();
        assembly ("memory-safe") {
            mstore(canonical, length)
        }
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
