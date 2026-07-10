// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";

contract MemeLaunchFactory {
    struct Launch {
        address token;
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

    function launch(
        string calldata name,
        string calldata symbol,
        uint256 supply,
        string calldata metadataURI,
        uint16[5] calldata rewardBps
    ) external returns (address token) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();

        uint256 total;
        for (uint256 i; i < rewardBps.length; ++i) {
            total += rewardBps[i];
        }
        if (total != 10_000) revert InvalidRewardSplit();

        token = address(new FixedSupplyMemeToken(name, symbol, supply, msg.sender, metadataURI));
        uint256 launchId = _launches.length;
        _launches.push(
            Launch(
                token,
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
