// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";

interface GateVm {
    function warp(uint256 timestamp) external;
}

contract GateCaller {
    function pause(RMTLaunchGate gate) external { gate.pauseLaunches(); }
    function schedule(RMTLaunchGate gate) external returns (uint64) { return gate.scheduleUnpause(); }
    function cancel(RMTLaunchGate gate) external { gate.cancelUnpause(); }
    function execute(RMTLaunchGate gate) external { gate.executeUnpause(); }
}

contract RMTLaunchGateTest {
    GateVm private constant vm = GateVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 private constant DELAY = 1 days;

    GateCaller private governance;
    GateCaller private guardian;
    GateCaller private outsider;
    RMTLaunchGate private gate;

    function setUp() public {
        governance = new GateCaller();
        guardian = new GateCaller();
        outsider = new GateCaller();
        gate = new RMTLaunchGate(address(governance), address(guardian), DELAY);
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
        (bool earlySuccess,) = address(outsider).call(abi.encodeCall(outsider.execute, (gate)));
        require(!earlySuccess, "unpaused early");
        vm.warp(executableAt);
        outsider.execute(gate);
        require(!gate.launchesPaused(), "did not unpause after delay");
        gate.requireLaunchesOpen();
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
        outsider.execute(gate);
        guardian.pause(gate);
        require(gate.launchesPaused(), "guardian did not pause");
    }

    function testOutsiderCannotPause() public {
        uint64 executableAt = governance.schedule(gate);
        vm.warp(executableAt);
        outsider.execute(gate);
        (bool success,) = address(outsider).call(abi.encodeCall(outsider.pause, (gate)));
        require(!success, "outsider paused launches");
        require(!gate.launchesPaused(), "gate unexpectedly paused");
    }
}
