// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";

interface RegistryVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract RegistryMockFactory {}

contract RegistryGovernanceMock {
    uint64 public configurationEpoch = 1;
    uint64 public executionWindow = 7 days;

    function setConfigurationEpoch(uint64 nextEpoch) external {
        configurationEpoch = nextEpoch;
    }

    function setExecutionWindow(uint64 nextWindow) external {
        executionWindow = nextWindow;
    }
}

contract RegistryBootstrapCaller {
    function activate(VersionedFactoryRegistry registry, address factory, bytes32 version) external {
        registry.bootstrapActivateFactory(factory, version);
    }
}

contract VersionedFactoryRegistryTest {
    RegistryVm private constant vm = RegistryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    RegistryGovernanceMock private governance;
    RegistryMockFactory private first;
    RegistryMockFactory private second;
    RegistryMockFactory private third;
    RegistryBootstrapCaller private bootstrap;
    VersionedFactoryRegistry private registry;

    function setUp() public {
        governance = new RegistryGovernanceMock();
        first = new RegistryMockFactory();
        second = new RegistryMockFactory();
        third = new RegistryMockFactory();
        bootstrap = new RegistryBootstrapCaller();
        registry = new VersionedFactoryRegistry(
            address(governance), 2 days, address(first), keccak256("V1"), address(bootstrap)
        );
    }

    function testFactoryChangeRequiresGovernanceAndDelay() public {
        (bool unauthorized,) =
            address(registry).call(abi.encodeCall(registry.proposeFactory, (address(second), keccak256("V2"))));
        require(!unauthorized, "unauthorized proposal accepted");

        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));

        (bool early,) = address(registry).call(abi.encodeCall(registry.activateFactory, ()));
        require(!early, "early activation accepted");

        vm.warp(block.timestamp + 2 days);
        registry.activateFactory();

        require(registry.activeFactory() == address(second), "factory not activated");
        require(registry.activeVersion() == keccak256("V2"), "version not activated");
        require(registry.bootstrapConsumed(), "delayed activation left bootstrap authority live");

        (bool bootstrapAfterFallback,) =
            address(bootstrap).call(abi.encodeCall(bootstrap.activate, (registry, address(third), keccak256("V3"))));
        require(!bootstrapAfterFallback, "bootstrap survived delayed activation");
    }

    function testRegistryCannotMutateFactories() public {
        require(address(first).code.length != 0, "initial factory missing");
        require(address(second).code.length != 0, "future factory missing");

        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));
        vm.prank(address(governance));
        registry.cancelProposal();

        require(registry.activeFactory() == address(first), "active factory changed");
        require(address(first).code.length != 0, "initial factory altered");
        require(address(second).code.length != 0, "future factory altered");
    }

    function testBootstrapIsOneShotAndLaterChangesStillUsePermanentDelay() public {
        bootstrap.activate(registry, address(second), keccak256("V2"));
        require(registry.bootstrapConsumed(), "bootstrap latch not consumed");
        require(registry.activeFactory() == address(second), "bootstrap factory not active");

        (bool replay,) =
            address(bootstrap).call(abi.encodeCall(bootstrap.activate, (registry, address(third), keccak256("V3"))));
        require(!replay, "bootstrap replayed");

        vm.prank(address(governance));
        registry.proposeFactory(address(third), keccak256("V3"));
        (bool early,) = address(registry).call(abi.encodeCall(registry.activateFactory, ()));
        require(!early, "post-bootstrap registry delay bypassed");
        vm.warp(block.timestamp + 2 days);
        registry.activateFactory();
        require(registry.activeFactory() == address(third), "delayed post-bootstrap upgrade failed");
    }

    function testOnlyImmutableControllerCanUseBootstrap() public {
        (bool outsider,) = address(registry)
            .call(abi.encodeCall(registry.bootstrapActivateFactory, (address(second), keccak256("V2"))));
        require(!outsider, "outsider used bootstrap");
        require(!registry.bootstrapConsumed(), "failed bootstrap consumed latch");
    }

    function testProposalSnapshotsGovernanceEpochAndFullExecutionWindow() public {
        uint64 scheduledAt = uint64(block.timestamp);
        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));

        uint64 executableAt = scheduledAt + 2 days;
        require(registry.pendingActivationTime() == executableAt, "wrong executable time");
        require(registry.pendingExpirationTime() == executableAt + 7 days, "wrong expiration time");
        require(registry.pendingConfigurationEpoch() == 1, "wrong governance epoch");
    }

    function testActivationIsValidAtExpiryAndClearsAllScheduleMetadata() public {
        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));
        vm.warp(registry.pendingExpirationTime());
        registry.activateFactory();

        require(registry.activeFactory() == address(second), "factory not activated at expiry");
        _requireNoPendingSchedule();
    }

    function testActivationExpiresAfterGovernanceWindow() public {
        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));
        vm.warp(uint256(registry.pendingExpirationTime()) + 1);
        (bool success,) = address(registry).call(abi.encodeCall(registry.activateFactory, ()));

        require(!success, "expired activation accepted");
        require(registry.activeFactory() == address(first), "expired activation changed factory");
    }

    function testGovernanceEpochChangeInvalidatesProposalAndFreshScheduleUsesNewEpoch() public {
        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));
        uint64 firstExecutableAt = registry.pendingActivationTime();
        governance.setConfigurationEpoch(2);
        vm.warp(firstExecutableAt);

        (bool staleSuccess,) = address(registry).call(abi.encodeCall(registry.activateFactory, ()));
        require(!staleSuccess, "stale governance proposal activated");

        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));
        require(registry.pendingConfigurationEpoch() == 2, "fresh proposal kept stale epoch");
    }

    function testCancellationClearsAllScheduleMetadata() public {
        vm.prank(address(governance));
        registry.proposeFactory(address(second), keccak256("V2"));
        vm.prank(address(governance));
        registry.cancelProposal();
        _requireNoPendingSchedule();
    }

    function testScheduleRejectsMissingOrInvalidGovernanceWindow() public {
        VersionedFactoryRegistry missingGetters =
            new VersionedFactoryRegistry(address(0xBEEF), 2 days, address(first), keccak256("V1"), address(bootstrap));
        vm.prank(address(0xBEEF));
        (bool missingSuccess,) = address(missingGetters)
            .call(abi.encodeCall(missingGetters.proposeFactory, (address(second), keccak256("V2"))));
        require(!missingSuccess, "governance without schedule getters accepted");

        governance.setExecutionWindow(0);
        vm.prank(address(governance));
        (bool zeroSuccess,) =
            address(registry).call(abi.encodeCall(registry.proposeFactory, (address(second), keccak256("V2"))));
        require(!zeroSuccess, "zero governance window accepted");

        governance.setExecutionWindow(31 days);
        vm.prank(address(governance));
        (bool oversizedSuccess,) =
            address(registry).call(abi.encodeCall(registry.proposeFactory, (address(second), keccak256("V2"))));
        require(!oversizedSuccess, "oversized governance window accepted");
    }

    function _requireNoPendingSchedule() private view {
        require(registry.pendingFactory() == address(0), "pending factory not cleared");
        require(registry.pendingVersion() == bytes32(0), "pending version not cleared");
        require(registry.pendingActivationTime() == 0, "pending time not cleared");
        require(registry.pendingExpirationTime() == 0, "pending expiry not cleared");
        require(registry.pendingConfigurationEpoch() == 0, "pending epoch not cleared");
    }
}
