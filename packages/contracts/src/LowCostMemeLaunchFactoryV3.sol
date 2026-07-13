// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactory} from "./LowCostMemeLaunchFactory.sol";
import {ClonePurposeRewardVault} from "./clone/ClonePurposeRewardVault.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";

/// @notice Preset-based launch factory that keeps graduation funding inside the bonding-curve market.
/// @dev Graduation reserves are never routed through a discretionary reward vault.
contract LowCostMemeLaunchFactoryV3 is LowCostMemeLaunchFactory {
    bytes32 public constant COMMUNITY_PURPOSE = keccak256("COMMUNITY_TREASURY");
    bytes32 public constant TRADER_PURPOSE = keccak256("TRADER_REWARDS");

    address public immutable purposeVaultImplementation;
    address public immutable rewardsController;
    address public immutable platformTreasury;

    struct CommunityDestinations {
        address community;
        address traderRewards;
    }

    mapping(address => CommunityDestinations) public communityDestinationsForToken;

    event LaunchPresetSelected(address indexed token, address indexed creator, bool communityRewardsEnabled);
    event CommunityDestinationsCreated(
        address indexed token, address community, address traderRewards, address platformTreasury
    );

    error InvalidAutomaticConfiguration();

    constructor(
        address graduationAdapter_,
        uint16 marketFeeBps_,
        uint256 initialVirtualEthReserve_,
        uint256 initialVirtualTokenReserve_,
        uint256 graduationTarget_,
        address rewardsController_,
        address platformTreasury_
    )
        LowCostMemeLaunchFactory(
            graduationAdapter_, marketFeeBps_, initialVirtualEthReserve_, initialVirtualTokenReserve_, graduationTarget_
        )
    {
        if (rewardsController_ == address(0) || platformTreasury_ == address(0)) {
            revert InvalidAutomaticConfiguration();
        }
        rewardsController = rewardsController_;
        platformTreasury = platformTreasury_;
        purposeVaultImplementation = address(new ClonePurposeRewardVault());
    }

    /// @notice One-click launch with no community or trader-reward vaults.
    /// @dev The creator receives 85% and the platform 15% of the configured market fee.
    ///      Graduation funding remains the market's real ETH reserve and is unaffected by this split.
    function launchSimple(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        address[4] memory recipients = [msg.sender, msg.sender, msg.sender, platformTreasury];
        uint16[5] memory splits = [uint16(8500), 0, 0, 0, 1500];
        (token, market, rewardVault) = _launch(msg.sender, name, symbol, metadataURI, recipients, splits);
        emit LaunchPresetSelected(token, msg.sender, false);
    }

    /// @notice One-click community launch with automatic community and trader-reward vaults.
    /// @dev The graduation reserve remains inside the market; no graduation vault is deployed.
    function launchCommunity(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        address community = MinimalProxy.clone(purposeVaultImplementation);
        address trader = MinimalProxy.clone(purposeVaultImplementation);
        address[4] memory recipients = [community, trader, msg.sender, platformTreasury];
        uint16[5] memory splits = [uint16(4500), 2500, 1500, 0, 1500];

        (token, market, rewardVault) = _launch(msg.sender, name, symbol, metadataURI, recipients, splits);
        ClonePurposeRewardVault(payable(community)).initialize(rewardsController, token, COMMUNITY_PURPOSE);
        ClonePurposeRewardVault(payable(trader)).initialize(rewardsController, token, TRADER_PURPOSE);
        communityDestinationsForToken[token] = CommunityDestinations(community, trader);

        emit CommunityDestinationsCreated(token, community, trader, platformTreasury);
        emit LaunchPresetSelected(token, msg.sender, true);
    }
}
