// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";
import {LaunchRewardVault} from "./LaunchRewardVault.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

contract MemeLaunchFactory {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;

    uint16 public immutable MARKET_FEE_BPS;
    uint256 public immutable INITIAL_VIRTUAL_ETH_RESERVE;
    uint256 public immutable INITIAL_VIRTUAL_TOKEN_RESERVE;
    uint256 public immutable GRADUATION_TARGET;

    struct Launch {
        address token;
        address market;
        address rewardVault;
        bytes32 graduationPoolId;
        address creator;
        uint64 createdAt;
        uint16 creatorBps;
        uint16 communityBps;
        uint16 traderBps;
        uint16 liquidityBps;
        uint16 platformBps;
    }

    Launch[] private _launches;
    mapping(bytes32 => bool) private _usedNameHashes;
    mapping(bytes32 => bool) private _usedSymbolHashes;
    address public immutable graduationAdapter;

    event TokenLaunched(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address market,
        address rewardVault,
        bytes32 graduationPoolId,
        string name,
        string symbol,
        uint256 supply,
        string metadataURI,
        uint16 creatorBps,
        uint16 communityBps,
        uint16 traderBps,
        uint16 liquidityBps,
        uint16 platformBps
    );

    error EmptyName();
    error EmptySymbol();
    error DuplicateName();
    error DuplicateSymbol();
    error InvalidRewardSplit();
    error InvalidSupply();
    error InventoryTransferFailed();
    error ZeroAddress();
    error InvalidPoolReservation();
    error InvalidMarketConfiguration();

    constructor(
        address graduationAdapter_,
        uint16 marketFeeBps_,
        uint256 initialVirtualEthReserve_,
        uint256 initialVirtualTokenReserve_,
        uint256 graduationTarget_
    ) {
        if (graduationAdapter_ == address(0)) revert ZeroAddress();
        if (
            marketFeeBps_ >= 10_000 || initialVirtualEthReserve_ == 0 || initialVirtualTokenReserve_ <= TOKEN_SUPPLY
                || graduationTarget_ == 0
        ) revert InvalidMarketConfiguration();
        graduationAdapter = graduationAdapter_;
        MARKET_FEE_BPS = marketFeeBps_;
        INITIAL_VIRTUAL_ETH_RESERVE = initialVirtualEthReserve_;
        INITIAL_VIRTUAL_TOKEN_RESERVE = initialVirtualTokenReserve_;
        GRADUATION_TARGET = graduationTarget_;
    }

    function launch(
        string calldata name,
        string calldata symbol,
        uint256 supply,
        string calldata metadataURI,
        address[4] calldata communityRecipients,
        uint16[5] calldata rewardBps
    ) external returns (address token, address market, address rewardVault) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (supply != TOKEN_SUPPLY) revert InvalidSupply();

        bytes32 nameHash = _canonicalHash(name);
        bytes32 symbolHash = _canonicalHash(symbol);
        if (_usedNameHashes[nameHash]) revert DuplicateName();
        if (_usedSymbolHashes[symbolHash]) revert DuplicateSymbol();
        _usedNameHashes[nameHash] = true;
        _usedSymbolHashes[symbolHash] = true;

        uint256 total;
        for (uint256 i; i < rewardBps.length; ++i) {
            total += rewardBps[i];
        }
        if (total != 10_000) revert InvalidRewardSplit();

        address[5] memory recipients = [
            msg.sender, communityRecipients[0], communityRecipients[1], communityRecipients[2], communityRecipients[3]
        ];

        token = address(new FixedSupplyMemeToken(name, symbol, supply, msg.sender, address(this), metadataURI));
        bytes32 graduationPoolId = IGraduationAdapter(graduationAdapter).prepare(token);
        if (graduationPoolId == bytes32(0)) revert InvalidPoolReservation();
        rewardVault = address(new LaunchRewardVault(recipients, rewardBps));
        market = address(
            new BondingCurveMarket(
                token,
                payable(rewardVault),
                graduationAdapter,
                graduationPoolId,
                MARKET_FEE_BPS,
                INITIAL_VIRTUAL_ETH_RESERVE,
                INITIAL_VIRTUAL_TOKEN_RESERVE,
                GRADUATION_TARGET
            )
        );

        IGraduationAdapter(graduationAdapter).bindMarket(token, market);

        if (!FixedSupplyMemeToken(token).transfer(market, supply)) revert InventoryTransferFailed();

        uint256 launchId = _launches.length;
        _launches.push(
            Launch(
                token,
                market,
                rewardVault,
                graduationPoolId,
                msg.sender,
                uint64(block.timestamp),
                rewardBps[0],
                rewardBps[1],
                rewardBps[2],
                rewardBps[3],
                rewardBps[4]
            )
        );
        emit TokenLaunched(
            launchId,
            token,
            msg.sender,
            market,
            rewardVault,
            graduationPoolId,
            name,
            symbol,
            supply,
            metadataURI,
            rewardBps[0],
            rewardBps[1],
            rewardBps[2],
            rewardBps[3],
            rewardBps[4]
        );
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }

    function _canonicalHash(string calldata value) private pure returns (bytes32) {
        bytes memory normalized = bytes(value);
        for (uint256 i; i < normalized.length; ++i) {
            uint8 character = uint8(normalized[i]);
            if (character >= 65 && character <= 90) normalized[i] = bytes1(character + 32);
        }
        return keccak256(normalized);
    }
}
