// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTLaunchPolicyRegistry} from "../src/interfaces/IRMTLaunchPolicyRegistry.sol";
import {IRMTLaunchFactoryV6} from "../src/interfaces/IRMTLaunchFactoryV6.sol";

/// @notice Compile-time coverage for the stable V6 policy shape shared by registry, factory, website, and indexer.
contract V6PolicyShapeTest {
    function testPolicyShapeCarriesFairStartAndDirectTreasury() public pure {
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = IRMTLaunchPolicyRegistry.LaunchPolicy({
            policyId: keccak256("RMT_SIMPLE_FAIR_V1"),
            policyVersion: 1,
            enabled: true,
            publiclySelectable: true,
            curveFeeBps: 100,
            creatorFeeShareBps: 7_000,
            protocolFeeShareBps: 3_000,
            postGraduationFeeBps: 50,
            graduationTarget: 2 ether,
            fairStartMode: 1,
            fairStartDelayBlocks: 1,
            fairStartDurationBlocks: 10,
            fairStartMaxTxBps: 100,
            fairStartMaxWalletBps: 300,
            marketImplementation: address(1),
            protocolTreasury: address(2),
            graduationAdapter: address(3)
        });

        require(policy.fairStartMode == 1, "fair start mode");
        require(policy.protocolTreasury == address(2), "direct treasury");
    }

    function testFactoryPolicyViewMatchesPublicCapabilities() public pure {
        IRMTLaunchFactoryV6.LaunchPolicyView memory policy = IRMTLaunchFactoryV6.LaunchPolicyView({
            policyId: keccak256("RMT_SIMPLE_OPEN_V1"),
            policyVersion: 1,
            enabled: true,
            publiclySelectable: true,
            curveFeeBps: 100,
            creatorFeeShareBps: 7_000,
            protocolFeeShareBps: 3_000,
            postGraduationFeeBps: 50,
            graduationTarget: 2 ether,
            fairStartMode: 0,
            fairStartDelayBlocks: 0,
            fairStartDurationBlocks: 0,
            fairStartMaxTxBps: 0,
            fairStartMaxWalletBps: 0
        });

        require(policy.fairStartMode == 0, "open launch mode");
    }
}
