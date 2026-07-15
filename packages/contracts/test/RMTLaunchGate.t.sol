// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";

interface GateVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract GateCaller {
    uint64 public configurationEpoch = 1;
    uint64 public executionWindow = 7 days;

    function pause(RMTLaunchGate gate) external {
        gate.pauseLaunches();
    }

    function schedule(RMTLaunchGate gate) external returns (uint64) {
        return gate.scheduleUnpause();
    }

    function cancel(RMTLaunchGate gate) external {
        gate.cancelUnpause();
    }

    function execute(RMTLaunchGate gate) external {
        gate.executeUnpause();
    }

    function bootstrap(RMTLaunchGate gate) external {
        gate.bootstrapUnpause();
    }

    function rotateGuardian(RMTLaunchGate gate, address nextGuardian) external {
        gate.setGuardian(nextGuardian);
    }

    function setConfigurationEpoch(uint64 nextEpoch) external {
        configurationEpoch = nextEpoch;
    }

    function setExecutionWindow(uint64 nextWindow) external {
        executionWindow = nextWindow;
    }
}

contract RMTLaunchGateTest {
    GateVm private constant vm = GateVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 private constant DELAY = 1 days;

    GateCaller private governance;
    GateCaller private guardian;
    GateCaller private outsider;
    GateCaller private bootstrap;
    RMTLaunchGate private gate;

    function setUp() public {
        governance = new GateCaller();
        guardian = new GateCaller();
        outsider = new GateCaller();
        bootstrap = new GateCaller();
        gate = new RMTLaunchGate(address(governance), address(guardian), DELAY, address(bootstrap));
    }

    function testDeploysPaused() public view {
        require(gate.launchesPaused(), "must deploy paused");
        (bool success,) = address(gate).staticcall(abi.encodeCall(gate.requireLaunchesOpen, ()));
        require(!success, "paused launch check must revert");
    }

    function testOnlyGovernanceCanScheduleUnpause() public {
        (bool guardianSuccess,) = address(guardian).call(abi.encodeCall(guardian.schedule, (gate)));
        require(!guardianSuccess, "guardian scheduled unpause");
        (bool outsiderSuccess,) = address(outsider).call(abi.encodeCall(outsider.schedule, (gate)));
        require(!outsiderSuccess, "outsider scheduled unpause");
        uint64 executableAt = governance.schedule(gate);
        require(executableAt == block.timestamp + DELAY, "wrong delay");
    }

    function testCannotExecuteUnpauseBeforeDelay() public {
        uint64 executableAt = governance.schedule(gate);
        (bool earlySuccess,) = address(guardian).call(abi.encodeCall(guardian.execute, (gate)));
        require(!earlySuccess, "unpaused early");
        vm.warp(executableAt);
        guardian.execute(gate);
        require(!gate.launchesPaused(), "did not unpause after delay");
        require(gate.bootstrapConsumed(), "delayed unpause left bootstrap authority live");
        gate.requireLaunchesOpen();

        guardian.pause(gate);
        (bool bootstrapAfterFallback,) = address(bootstrap).call(abi.encodeCall(bootstrap.bootstrap, (gate)));
        require(!bootstrapAfterFallback, "bootstrap survived delayed unpause");
    }

    function testOutsiderCannotExecuteUnpauseAfterDelay() public {
        uint64 executableAt = governance.schedule(gate);
        vm.warp(executableAt);
        (bool success,) = address(outsider).call(abi.encodeCall(outsider.execute, (gate)));
        require(!success, "outsider executed delayed unpause");
        require(gate.launchesPaused(), "outsider reopened gate");
    }

    function testGuardianCanCancelScheduledUnpause() public {
        uint64 executableAt = governance.schedule(gate);
        guardian.cancel(gate);
        vm.warp(executableAt);
        (bool success,) = address(outsider).call(abi.encodeCall(outsider.execute, (gate)));
        require(!success, "cancelled unpause executed");
        require(gate.launchesPaused(), "gate reopened");
    }

    function testGuardianCanPauseImmediatelyAfterUnpause() public {
        uint64 executableAt = governance.schedule(gate);
        vm.warp(executableAt);
        guardian.execute(gate);
        guardian.pause(gate);
        require(gate.launchesPaused(), "guardian did not pause");
    }

    function testOutsiderCannotPause() public {
        uint64 executableAt = governance.schedule(gate);
        vm.warp(executableAt);
        governance.execute(gate);
        (bool success,) = address(outsider).call(abi.encodeCall(outsider.pause, (gate)));
        require(!success, "outsider paused launches");
        require(!gate.launchesPaused(), "gate unexpectedly paused");
    }

    function testBootstrapUnpauseIsOneShotAndLaterReopeningKeepsDelay() public {
        bootstrap.bootstrap(gate);
        require(gate.bootstrapConsumed(), "bootstrap latch not consumed");
        require(!gate.launchesPaused(), "bootstrap did not open gate");

        guardian.pause(gate);
        (bool replay,) = address(bootstrap).call(abi.encodeCall(bootstrap.bootstrap, (gate)));
        require(!replay, "bootstrap replayed after pause");
        require(gate.launchesPaused(), "bootstrap replay reopened gate");

        uint64 executableAt = governance.schedule(gate);
        (bool early,) = address(guardian).call(abi.encodeCall(guardian.execute, (gate)));
        require(!early, "post-bootstrap gate delay bypassed");
        vm.warp(executableAt);
        guardian.execute(gate);
        require(!gate.launchesPaused(), "delayed post-bootstrap reopen failed");
    }

    function testOnlyImmutableControllerCanBootstrapUnpause() public {
        (bool outsiderSuccess,) = address(outsider).call(abi.encodeCall(outsider.bootstrap, (gate)));
        require(!outsiderSuccess, "outsider used bootstrap");
        require(gate.launchesPaused(), "outsider opened gate");
        require(!gate.bootstrapConsumed(), "failed bootstrap consumed latch");
    }

    function testScheduleSnapshotsGovernanceEpochAndFullExecutionWindow() public {
        uint64 executableAt = governance.schedule(gate);
        require(gate.unpauseExecutableAt() == executableAt, "wrong executable time");
        require(gate.unpauseExpiresAt() == executableAt + 7 days, "wrong expiration time");
        require(gate.unpauseConfigurationEpoch() == 1, "wrong governance epoch");
    }

    function testUnpauseIsValidAtExpiryAndClearsAllScheduleMetadata() public {
        governance.schedule(gate);
        vm.warp(gate.unpauseExpiresAt());
        guardian.execute(gate);

        require(!gate.launchesPaused(), "did not unpause at expiry");
        _requireNoUnpauseSchedule();
    }

    function testUnpauseExpiresAfterGovernanceWindow() public {
        governance.schedule(gate);
        vm.warp(uint256(gate.unpauseExpiresAt()) + 1);
        (bool success,) = address(guardian).call(abi.encodeCall(guardian.execute, (gate)));

        require(!success, "expired unpause accepted");
        require(gate.launchesPaused(), "expired unpause opened gate");
    }

    function testGovernanceEpochChangeInvalidatesUnpauseAndFreshScheduleUsesNewEpoch() public {
        uint64 executableAt = governance.schedule(gate);
        governance.setConfigurationEpoch(2);
        vm.warp(executableAt);

        (bool staleSuccess,) = address(guardian).call(abi.encodeCall(guardian.execute, (gate)));
        require(!staleSuccess, "stale governance unpause executed");

        governance.schedule(gate);
        require(gate.unpauseConfigurationEpoch() == 2, "fresh unpause kept stale epoch");
    }

    function testCancellationClearsAllScheduleMetadata() public {
        governance.schedule(gate);
        guardian.cancel(gate);
        _requireNoUnpauseSchedule();
    }

    function testGovernanceOnlyGuardianRotationRemovesOldGuardianAuthority() public {
        (bool unauthorized,) =
            address(guardian).call(abi.encodeCall(guardian.rotateGuardian, (gate, address(outsider))));
        require(!unauthorized, "guardian rotated itself");

        governance.rotateGuardian(gate, address(outsider));
        require(gate.guardian() == address(outsider), "guardian not rotated");

        bootstrap.bootstrap(gate);
        (bool stalePause,) = address(guardian).call(abi.encodeCall(guardian.pause, (gate)));
        require(!stalePause, "old guardian retained pause authority");
        outsider.pause(gate);
        require(gate.launchesPaused(), "new guardian could not pause");

        (bool sameGuardian,) =
            address(governance).call(abi.encodeCall(governance.rotateGuardian, (gate, address(outsider))));
        require(!sameGuardian, "same guardian accepted");
        (bool zeroGuardian,) = address(governance).call(abi.encodeCall(governance.rotateGuardian, (gate, address(0))));
        require(!zeroGuardian, "zero guardian accepted");
    }

    function testApprovedUnpauseSurvivesGuardianRotationForNewGuardian() public {
        uint64 executableAt = governance.schedule(gate);
        uint64 expiresAt = gate.unpauseExpiresAt();
        governance.rotateGuardian(gate, address(outsider));

        require(gate.unpauseExecutableAt() == executableAt, "rotation cleared executable time");
        require(gate.unpauseExpiresAt() == expiresAt, "rotation cleared expiration time");
        (bool staleCancel,) = address(guardian).call(abi.encodeCall(guardian.cancel, (gate)));
        require(!staleCancel, "old guardian cancelled approved unpause");
        vm.warp(executableAt);
        outsider.execute(gate);
        require(!gate.launchesPaused(), "new guardian could not execute approved unpause");
    }

    function testScheduleRejectsMissingOrInvalidGovernanceWindow() public {
        RMTLaunchGate missingGetters = new RMTLaunchGate(address(0xBEEF), address(guardian), DELAY, address(bootstrap));
        vm.prank(address(0xBEEF));
        (bool missingSuccess,) = address(missingGetters).call(abi.encodeCall(missingGetters.scheduleUnpause, ()));
        require(!missingSuccess, "governance without schedule getters accepted");

        governance.setExecutionWindow(0);
        (bool zeroSuccess,) = address(governance).call(abi.encodeCall(governance.schedule, (gate)));
        require(!zeroSuccess, "zero governance window accepted");

        governance.setExecutionWindow(31 days);
        (bool oversizedSuccess,) = address(governance).call(abi.encodeCall(governance.schedule, (gate)));
        require(!oversizedSuccess, "oversized governance window accepted");
    }

    function _requireNoUnpauseSchedule() private view {
        require(gate.unpauseExecutableAt() == 0, "unpause time not cleared");
        require(gate.unpauseExpiresAt() == 0, "unpause expiry not cleared");
        require(gate.unpauseConfigurationEpoch() == 0, "unpause epoch not cleared");
    }
}
