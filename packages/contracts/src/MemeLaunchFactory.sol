// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";
import {LaunchRewardVault} from "./LaunchRewardVault.sol";

contract MemeLaunchFactory {
    uint16 public constant MARKET_FEE_BPS = 100;
    uint256 public constant INITIAL_VIRTUAL_ETH_RESERVE = 30 ether;
    uint256 public constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_073_000_000 ether;
    uint256 public constant GRADUATION_TARGET = 85 ether;

    struct Launch {
        address token;
        address market;
        address rewardVault;
        address creator;
        uint64 createdAt;
        uint16 creatorBps;
        uint16 communityBps;
        uint16 traderBps;
        uint16 liquidityBps;
        uint16 platformBps;
    }

    Launch[] private _launches;

    event TokenLaunched(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address market,
        address rewardVault,
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
    error InvalidRewardSplit();
    error InvalidSupply();
    error InventoryTransferFailed();

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
        if (supply == 0) revert InvalidSupply();

        uint256 total;
        for (uint256 i; i < rewardBps.length; ++i) {
            total += rewardBps[i];
        }
        if (total != 10_000) revert InvalidRewardSplit();

        address[5] memory recipients = [
            msg.sender, communityRecipients[0], communityRecipients[1], communityRecipients[2], communityRecipients[3]
        ];

        token = address(new FixedSupplyMemeToken(name, symbol, supply, msg.sender, address(this), metadataURI));
        rewardVault = address(new LaunchRewardVault(recipients, rewardBps));
        market = address(
            new BondingCurveMarket(
                token,
                payable(rewardVault),
                MARKET_FEE_BPS,
                INITIAL_VIRTUAL_ETH_RESERVE,
                INITIAL_VIRTUAL_TOKEN_RESERVE,
                GRADUATION_TARGET
            )
        );

        if (!FixedSupplyMemeToken(token).transfer(market, supply)) revert InventoryTransferFailed();

        uint256 launchId = _launches.length;
        _launches.push(
            Launch(
                token,
                market,
                rewardVault,
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
}
