// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared V6 launch gate. The guardian can stop launches immediately; only governance can reopen after delay.
contract RMTLaunchGate {
    address public immutable governance;
    address public immutable guardian;
    uint64 public immutable unpauseDelay;

    bool public launchesPaused = true;
    uint64 public unpauseExecutableAt;

    event LaunchesPaused(address indexed caller);
    event UnpauseScheduled(uint64 executableAt);
    event UnpauseCancelled();
    event LaunchesUnpaused();

    error OnlyGovernance();
    error OnlyGuardianOrGovernance();
    error AlreadyPaused();
    error AlreadyUnpaused();
    error UnpauseNotScheduled();
    error UnpauseNotReady(uint64 executableAt);
    error InvalidConfiguration();
    error LaunchesArePaused();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    modifier onlyGuardianOrGovernance() {
        if (msg.sender != guardian && msg.sender != governance) revert OnlyGuardianOrGovernance();
        _;
    }

    constructor(address governance_, address guardian_, uint64 unpauseDelay_) {
        if (governance_ == address(0) || guardian_ == address(0) || unpauseDelay_ == 0) {
            revert InvalidConfiguration();
        }
        governance = governance_;
        guardian = guardian_;
        unpauseDelay = unpauseDelay_;
    }

    function requireLaunchesOpen() external view {
        if (launchesPaused) revert LaunchesArePaused();
    }

    function pauseLaunches() external onlyGuardianOrGovernance {
        if (launchesPaused) revert AlreadyPaused();
        launchesPaused = true;
        unpauseExecutableAt = 0;
        emit LaunchesPaused(msg.sender);
    }

    function scheduleUnpause() external onlyGovernance returns (uint64 executableAt) {
        if (!launchesPaused) revert AlreadyUnpaused();
        executableAt = uint64(block.timestamp + unpauseDelay);
        unpauseExecutableAt = executableAt;
        emit UnpauseScheduled(executableAt);
    }

    function cancelUnpause() external onlyGuardianOrGovernance {
        if (unpauseExecutableAt == 0) revert UnpauseNotScheduled();
        unpauseExecutableAt = 0;
        emit UnpauseCancelled();
    }

    function executeUnpause() external {
        if (!launchesPaused) revert AlreadyUnpaused();
        uint64 executableAt = unpauseExecutableAt;
        if (executableAt == 0) revert UnpauseNotScheduled();
        if (block.timestamp < executableAt) revert UnpauseNotReady(executableAt);
        unpauseExecutableAt = 0;
        launchesPaused = false;
        emit LaunchesUnpaused();
    }
}
