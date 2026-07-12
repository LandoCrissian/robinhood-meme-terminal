// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactory} from "./LowCostMemeLaunchFactory.sol";
import {ClonePurposeRewardVault} from "./clone/ClonePurposeRewardVault.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";

contract LowCostMemeLaunchFactoryV2 is LowCostMemeLaunchFactory {
    bytes32 public constant COMMUNITY_PURPOSE = keccak256("COMMUNITY_TREASURY");
    bytes32 public constant TRADER_PURPOSE = keccak256("TRADER_REWARDS");
    bytes32 public constant LIQUIDITY_PURPOSE = keccak256("GRADUATION_LIQUIDITY");

    address public immutable purposeVaultImplementation;
    address public immutable rewardsController;
    address public immutable platformTreasury;

    struct AutomaticDestinations {
        address community;
        address traderRewards;
        address graduationLiquidity;
    }
    mapping(address => AutomaticDestinations) public automaticDestinationsForToken;

    event AutomaticDestinationsCreated(
        address indexed token,
        address community,
        address traderRewards,
        address graduationLiquidity,
        address platformTreasury
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

    function launchSimple(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        returns (address token, address market, address rewardVault)
    {
        address community = MinimalProxy.clone(purposeVaultImplementation);
        address trader = MinimalProxy.clone(purposeVaultImplementation);
        address liquidity = MinimalProxy.clone(purposeVaultImplementation);
        address[4] memory recipients = [community, trader, liquidity, platformTreasury];
        uint16[5] memory splits = [uint16(3000), 2500, 1500, 1500, 1500];

        (token, market, rewardVault) = _launch(msg.sender, name, symbol, metadataURI, recipients, splits);
        ClonePurposeRewardVault(payable(community)).initialize(rewardsController, token, COMMUNITY_PURPOSE);
        ClonePurposeRewardVault(payable(trader)).initialize(rewardsController, token, TRADER_PURPOSE);
        ClonePurposeRewardVault(payable(liquidity)).initialize(rewardsController, token, LIQUIDITY_PURPOSE);
        automaticDestinationsForToken[token] = AutomaticDestinations(community, trader, liquidity);
        emit AutomaticDestinationsCreated(token, community, trader, liquidity, platformTreasury);
    }
}
