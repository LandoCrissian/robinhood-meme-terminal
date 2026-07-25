// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { PoHPolicyV1 } from "../src/PoHPolicyV1.sol";
import { TestBase } from "./TestBase.sol";

contract PoHPolicyV1Test is TestBase {
    PoHPolicyV1 internal policy;

    function setUp() public {
        policy = new PoHPolicyV1();
    }

    function testBaseMultiplierIsOne() public view {
        assertEq(policy.multiplierWad(0), 1e18);
    }

    function testMultiplierCapsAtOnePointSevenFive() public view {
        assertEq(policy.multiplierWad(365 days), 1_750_000_000_000_000_000);
        assertEq(policy.multiplierWad(10_000 days), 1_750_000_000_000_000_000);
    }

    function testMultiplierIsMonotonic(uint32 first, uint32 second) public view {
        uint256 a = uint256(first) % (3650 days);
        uint256 b = uint256(second) % (3650 days);
        if (a > b) (a, b) = (b, a);

        assertLe(policy.multiplierWad(a), policy.multiplierWad(b));
    }

    function testRewardWeightNeverBelowBalance(uint128 balance, uint32 age) public view {
        uint256 weight = policy.rewardWeight(balance, uint256(age));
        assertGe(weight, balance);
        assertLe(weight, uint256(balance) * 175 / 100);
    }
}
