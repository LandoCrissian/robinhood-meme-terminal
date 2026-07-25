// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IPoHPolicy } from "./interfaces/IPoHPolicy.sol";

/// @title PoHPolicyV1
/// @notice Reference V1 loyalty policy: continuous square-root multiplier capped at 1.75x.
/// @dev This contract is stateless and can be shared by any number of deployments.
contract PoHPolicyV1 is IPoHPolicy {
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_BONUS_WAD = 750_000_000_000_000_000;
    uint256 public constant MAX_AGE = 365 days;

    bytes32 public constant POLICY_HASH = keccak256(
        "POH_POLICY_V1|curve=sqrt|base=1e18|maxBonus=0.75e18|maxAge=365days|tiers=7,30,90,180,365"
    );

    function policyHash() external pure override returns (bytes32) {
        return POLICY_HASH;
    }

    /// @inheritdoc IPoHPolicy
    function multiplierWad(uint256 ageSeconds) public pure override returns (uint256) {
        uint256 cappedAge = Math.min(ageSeconds, MAX_AGE);

        // sqrt(cappedAge / MAX_AGE), represented without introducing an intermediate WAD.
        // sqrt(cappedAge * MAX_AGE) / MAX_AGE == sqrt(cappedAge / MAX_AGE).
        uint256 scaledRoot = Math.sqrt(cappedAge * MAX_AGE);
        uint256 bonus = Math.mulDiv(MAX_BONUS_WAD, scaledRoot, MAX_AGE);

        return WAD + bonus;
    }

    /// @inheritdoc IPoHPolicy
    function loyaltyTier(uint256 ageSeconds) external pure override returns (uint8) {
        if (ageSeconds < 7 days) return 0; // Base
        if (ageSeconds < 30 days) return 1; // Bronze
        if (ageSeconds < 90 days) return 2; // Silver
        if (ageSeconds < 180 days) return 3; // Gold
        if (ageSeconds < 365 days) return 4; // Platinum
        return 5; // Diamond
    }

    /// @inheritdoc IPoHPolicy
    function rewardWeight(uint256 averageEligibleBalance, uint256 ageSeconds)
        external
        pure
        override
        returns (uint256)
    {
        return Math.mulDiv(averageEligibleBalance, multiplierWad(ageSeconds), WAD);
    }
}
