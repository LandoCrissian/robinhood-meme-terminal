// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Reviewed constants for the first Robinhood Chain mainnet release.
/// @dev Changing any value requires a new source commit, CI run, and deployment review.
library MainnetReleaseConfig {
    uint256 internal constant CHAIN_ID = 4_663;

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint24 internal constant V4_POOL_FEE = 10_000;
    int24 internal constant V4_TICK_SPACING = 200;

    uint16 internal constant MARKET_FEE_BPS = 100;
    uint256 internal constant INITIAL_VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 internal constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint256 internal constant GRADUATION_TARGET = 2 ether;

    uint256 internal constant FACTORY_ACTIVATION_DELAY = 2 days;
    uint256 internal constant REWARD_RELEASE_DELAY = 1 days;
    uint256 internal constant PROTOCOL_GOVERNANCE_DELAY = 1 days;
    bytes32 internal constant FACTORY_VERSION = keccak256("RMT_FACTORY_V4");
}
