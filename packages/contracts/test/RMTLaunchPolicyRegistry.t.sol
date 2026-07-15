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
    address private constant PROTOCOL_TREASURY = address(0x7E8E);

    function testConstructorPinsExactCanonicalComponents() public {
        PolicyMarketImplementation market = new PolicyMarketImplementation();
        PolicyGraduationAdapter adapter = new PolicyGraduationAdapter(5_000);
        RMTLaunchPolicyRegistry registry = new RMTLaunchPolicyRegistry(
            address(this), address(0xBEEF), DELAY, PROTOCOL_TREASURY, address(market), address(adapter)
        );

        require(registry.canonicalMarketImplementation() == address(market), "canonical market getter");
        require(registry.canonicalGraduationAdapter() == address(adapter), "canonical adapter getter");
    }

    function testRegistrationRequiresDelayAndEconomicsHashSurvivesAvailabilityChanges() public {
        RMTLaunchPolicyRegistry registry = _registry();
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(registry);
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

    function testRejectsSubstitutedAdapterEvenIfItsDisclosedFeeMatches() public {
        RMTLaunchPolicyRegistry registry = _registry();
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(registry);
        policy.graduationAdapter = address(new PolicyGraduationAdapter(5_000));

        (bool success,) = address(registry).call(abi.encodeCall(registry.schedulePolicyRegistration, (policy)));
        require(!success, "substituted graduation adapter accepted");
    }

    function testRejectsSubstitutedMarketImplementation() public {
        RMTLaunchPolicyRegistry registry = _registry();
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(registry);
        policy.marketImplementation = address(new PolicyMarketImplementation());

        (bool success,) = address(registry).call(abi.encodeCall(registry.schedulePolicyRegistration, (policy)));
        require(!success, "substituted market implementation accepted");
    }

    function testRejectsCanonicalAdapterWhosePoolFeeDoesNotMatchPolicy() public {
        PolicyMarketImplementation market = new PolicyMarketImplementation();
        PolicyGraduationAdapter adapter = new PolicyGraduationAdapter(10_000);
        RMTLaunchPolicyRegistry registry = new RMTLaunchPolicyRegistry(
            address(this), address(0xBEEF), DELAY, PROTOCOL_TREASURY, address(market), address(adapter)
        );
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(registry);

        (bool success,) = address(registry).call(abi.encodeCall(registry.schedulePolicyRegistration, (policy)));
        require(!success, "canonical adapter with mismatched pool fee accepted");
    }

    function testEmergencyDisableInvalidatesMaturedReenableAndDefaultOperations() public {
        RMTLaunchPolicyRegistry registry = _registry();
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(registry);
        registry.schedulePolicyRegistration(policy);
        vm.warp(block.timestamp + DELAY);
        registry.executePolicyRegistration(policy);

        registry.schedulePolicyAvailability(policy.policyId, true, true);
        registry.scheduleDefaultPolicy(policy.policyId);
        vm.warp(block.timestamp + DELAY);
        registry.disablePolicy(policy.policyId);

        (bool staleAvailability,) = address(registry).call(
            abi.encodeCall(registry.executePolicyAvailability, (policy.policyId, true, true))
        );
        require(!staleAvailability, "stale re-enable survived emergency disable");
        (bool staleDefault,) = address(registry).call(
            abi.encodeCall(registry.executeDefaultPolicy, (policy.policyId))
        );
        require(!staleDefault, "stale default change survived emergency disable");

        registry.schedulePolicyAvailability(policy.policyId, true, true);
        (bool earlyReenable,) = address(registry).call(
            abi.encodeCall(registry.executePolicyAvailability, (policy.policyId, true, true))
        );
        require(!earlyReenable, "fresh re-enable bypassed delay");
        vm.warp(block.timestamp + DELAY);
        registry.executePolicyAvailability(policy.policyId, true, true);

        registry.scheduleDefaultPolicy(policy.policyId);
        (bool earlyDefault,) = address(registry).call(
            abi.encodeCall(registry.executeDefaultPolicy, (policy.policyId))
        );
        require(!earlyDefault, "fresh default change bypassed delay");
        vm.warp(block.timestamp + DELAY);
        registry.executeDefaultPolicy(policy.policyId);
        require(registry.defaultPolicyId() == policy.policyId, "fresh delayed default not applied");
    }

    function testEveryPolicyMustUseCanonicalV6EconomicsAndTreasury() public {
        RMTLaunchPolicyRegistry registry = _registry();

        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = _policy(registry);
        policy.curveFeeBps = 99;
        _expectRegistrationRejected(registry, policy, "noncanonical curve fee accepted");

        policy = _policy(registry);
        policy.creatorFeeShareBps = 6_900;
        policy.protocolFeeShareBps = 3_100;
        _expectRegistrationRejected(registry, policy, "noncanonical 69/31 split accepted");

        policy = _policy(registry);
        policy.creatorFeeShareBps = 7_100;
        policy.protocolFeeShareBps = 2_900;
        _expectRegistrationRejected(registry, policy, "noncanonical 71/29 split accepted");

        policy = _policy(registry);
        policy.postGraduationFeeBps = 51;
        _expectRegistrationRejected(registry, policy, "noncanonical pool fee accepted");

        policy = _policy(registry);
        policy.graduationTarget = 3 ether;
        _expectRegistrationRejected(registry, policy, "noncanonical graduation target accepted");

        policy = _policy(registry);
        policy.protocolTreasury = address(0xCAFE);
        _expectRegistrationRejected(registry, policy, "noncanonical treasury accepted");
    }

    function testCanonicalV6ConfigurationIsReadableAndConstructorRejectsInvalidDependencies() public {
        RMTLaunchPolicyRegistry registry = _registry();
        require(registry.CANONICAL_CURVE_FEE_BPS() == 100, "curve fee constant");
        require(registry.CANONICAL_CREATOR_FEE_SHARE_BPS() == 7_000, "creator share constant");
        require(registry.CANONICAL_PROTOCOL_FEE_SHARE_BPS() == 3_000, "protocol share constant");
        require(registry.CANONICAL_POST_GRADUATION_FEE_BPS() == 50, "pool fee constant");
        require(registry.CANONICAL_GRADUATION_TARGET() == 2 ether, "graduation target constant");
        require(registry.canonicalProtocolTreasury() == PROTOCOL_TREASURY, "canonical treasury");
        require(registry.canonicalMarketImplementation().code.length > 0, "canonical market implementation");
        require(registry.canonicalGraduationAdapter().code.length > 0, "canonical graduation adapter");

        bytes memory invalidCreationCode = abi.encodePacked(
            type(RMTLaunchPolicyRegistry).creationCode,
            abi.encode(
                address(this),
                address(0xBEEF),
                DELAY,
                address(0),
                registry.canonicalMarketImplementation(),
                registry.canonicalGraduationAdapter()
            )
        );
        address deployed;
        assembly ("memory-safe") {
            deployed := create(0, add(invalidCreationCode, 0x20), mload(invalidCreationCode))
        }
        require(deployed == address(0), "zero canonical treasury accepted");

        invalidCreationCode = abi.encodePacked(
            type(RMTLaunchPolicyRegistry).creationCode,
            abi.encode(
                address(this),
                address(0xBEEF),
                DELAY,
                PROTOCOL_TREASURY,
                address(0xCAFE),
                registry.canonicalGraduationAdapter()
            )
        );
        assembly ("memory-safe") {
            deployed := create(0, add(invalidCreationCode, 0x20), mload(invalidCreationCode))
        }
        require(deployed == address(0), "canonical market without code accepted");

        invalidCreationCode = abi.encodePacked(
            type(RMTLaunchPolicyRegistry).creationCode,
            abi.encode(
                address(this),
                address(0xBEEF),
                DELAY,
                PROTOCOL_TREASURY,
                registry.canonicalMarketImplementation(),
                address(0xCAFE)
            )
        );
        assembly ("memory-safe") {
            deployed := create(0, add(invalidCreationCode, 0x20), mload(invalidCreationCode))
        }
        require(deployed == address(0), "canonical adapter without code accepted");
    }

    function testReviewedPolicyMayChangeFairStartBehaviorButNotCanonicalComponents() public {
        RMTLaunchPolicyRegistry registry = _registry();
        IRMTLaunchPolicyRegistry.LaunchPolicy memory fairPolicy = _policy(registry);
        IRMTLaunchPolicyRegistry.LaunchPolicy memory futurePolicy = _policy(registry);
        futurePolicy.policyId = keccak256("RMT_REVIEWED_FUTURE_POLICY");
        futurePolicy.policyVersion = 2;
        futurePolicy.fairStartMode = 0;
        futurePolicy.fairStartDelayBlocks = 0;
        futurePolicy.fairStartDurationBlocks = 0;
        futurePolicy.fairStartMaxTxBps = 0;
        futurePolicy.fairStartMaxWalletBps = 0;

        registry.schedulePolicyRegistration(fairPolicy);
        registry.schedulePolicyRegistration(futurePolicy);
        vm.warp(block.timestamp + DELAY);
        registry.executePolicyRegistration(fairPolicy);
        registry.executePolicyRegistration(futurePolicy);

        IRMTLaunchPolicyRegistry.LaunchPolicy memory registered = registry.getPolicy(futurePolicy.policyId);
        require(registered.marketImplementation == registry.canonicalMarketImplementation(), "canonical market not retained");
        require(registered.graduationAdapter == registry.canonicalGraduationAdapter(), "canonical adapter not retained");
        require(registered.curveFeeBps == 100, "future curve economics changed");
        require(registered.creatorFeeShareBps == 7_000, "future creator economics changed");
        require(registered.protocolFeeShareBps == 3_000, "future protocol economics changed");
        require(registered.postGraduationFeeBps == 50, "future pool economics changed");
        require(registered.graduationTarget == 2 ether, "future graduation economics changed");
    }

    function _registry() private returns (RMTLaunchPolicyRegistry) {
        PolicyMarketImplementation market = new PolicyMarketImplementation();
        PolicyGraduationAdapter adapter = new PolicyGraduationAdapter(5_000);
        return new RMTLaunchPolicyRegistry(
            address(this), address(0xBEEF), DELAY, PROTOCOL_TREASURY, address(market), address(adapter)
        );
    }

    function _expectRegistrationRejected(
        RMTLaunchPolicyRegistry registry,
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy,
        string memory reason
    ) private {
        (bool success,) = address(registry).call(abi.encodeCall(registry.schedulePolicyRegistration, (policy)));
        require(!success, reason);
    }

    function _policy(RMTLaunchPolicyRegistry registry)
        private view returns (IRMTLaunchPolicyRegistry.LaunchPolicy memory)
    {
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
            marketImplementation: registry.canonicalMarketImplementation(),
            protocolTreasury: PROTOCOL_TREASURY,
            graduationAdapter: registry.canonicalGraduationAdapter()
        });
    }
}
