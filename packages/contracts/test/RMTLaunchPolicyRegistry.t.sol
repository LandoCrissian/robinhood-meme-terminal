// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTLaunchPolicyRegistry} from "../src/RMTLaunchPolicyRegistry.sol";
import {IRMTLaunchPolicyRegistry} from "../src/interfaces/IRMTLaunchPolicyRegistry.sol";

interface PolicyRegistryVm {
    function warp(uint256 timestamp) external;
}

contract PolicyMarketImplementation {}

contract PolicyGraduationAdapter {
    uint24 public immutable poolFee;

    constructor(uint24 poolFee_) {
        poolFee = poolFee_;
    }
}

contract RMTLaunchPolicyRegistryTest {
    PolicyRegistryVm private constant vm =
        PolicyRegistryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 private constant DELAY = 1 days;

    function testRegistrationRequiresDelayAndEconomicsHashSurvivesAvailabilityChanges() public {
        RMTLaunchPolicyRegistry registry = new RMTLaunchPolicyRegistry(address(this), address(0xBEEF), DELAY);
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(address(new PolicyGraduationAdapter(5_000)));
        registry.schedulePolicyRegistration(policy);

        (bool earlySuccess,) = address(registry).call(abi.encodeCall(registry.executePolicyRegistration, (policy)));
        require(!earlySuccess, "policy registered before delay");
        vm.warp(block.timestamp + DELAY);
        registry.executePolicyRegistration(policy);
        bytes32 permanentHash = registry.policyHash(policy.policyId);

        registry.disablePolicy(policy.policyId);
        IRMTLaunchPolicyRegistry.LaunchPolicy memory disabledPolicy = registry.getPolicy(policy.policyId);
        require(!disabledPolicy.enabled && !disabledPolicy.publiclySelectable, "policy not disabled");
        require(registry.policyHash(policy.policyId) == permanentHash, "economics hash changed with availability");

        registry.schedulePolicyAvailability(policy.policyId, true, true);
        vm.warp(block.timestamp + DELAY);
        registry.executePolicyAvailability(policy.policyId, true, true);
        require(registry.policyHash(policy.policyId) == permanentHash, "economics hash changed on re-enable");
    }

    function testRejectsPolicyWhoseDisclosedFeeDoesNotMatchAdapterPoolFee() public {
        RMTLaunchPolicyRegistry registry = new RMTLaunchPolicyRegistry(address(this), address(0xBEEF), DELAY);
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(address(new PolicyGraduationAdapter(10_000)));

        (bool success,) = address(registry).call(abi.encodeCall(registry.schedulePolicyRegistration, (policy)));
        require(!success, "mismatched post-graduation fee accepted");
    }

    function testRejectsAdapterWithoutReadablePoolFee() public {
        RMTLaunchPolicyRegistry registry = new RMTLaunchPolicyRegistry(address(this), address(0xBEEF), DELAY);
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(address(new PolicyMarketImplementation()));

        (bool success,) = address(registry).call(abi.encodeCall(registry.schedulePolicyRegistration, (policy)));
        require(!success, "adapter without pool fee accepted");
    }

    function _policy(address adapter) private returns (IRMTLaunchPolicyRegistry.LaunchPolicy memory) {
        return IRMTLaunchPolicyRegistry.LaunchPolicy({
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
            marketImplementation: address(new PolicyMarketImplementation()),
            protocolTreasury: address(0x7E8E),
            graduationAdapter: adapter
        });
    }
}
