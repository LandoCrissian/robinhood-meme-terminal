// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared V6 launch gate. The guardian can stop launches immediately; governance authorizes reopening,
///         then only the guardian or governance can finalize it after the delay.
contract RMTLaunchGate {
    uint64 private constant MAXIMUM_GOVERNANCE_WINDOW = 30 days;
    bytes4 private constant CONFIGURATION_EPOCH_SELECTOR = bytes4(keccak256("configurationEpoch()"));
    bytes4 private constant EXECUTION_WINDOW_SELECTOR = bytes4(keccak256("executionWindow()"));

    address public immutable governance;
    address public guardian;
    address public immutable bootstrapController;
    uint64 public immutable unpauseDelay;

    bool public launchesPaused = true;
    bool public bootstrapConsumed;
    uint64 public unpauseExecutableAt;
    uint64 public unpauseExpiresAt;
    uint64 public unpauseConfigurationEpoch;

    event LaunchesPaused(address indexed caller);
    event UnpauseScheduled(uint64 executableAt);
    event UnpauseScheduleBound(uint64 executableAt, uint64 expiresAt, uint64 configurationEpoch);
    event UnpauseCancelled();
    event LaunchesUnpaused();
    event BootstrapLaunchesUnpaused(address indexed controller);
    event GuardianChanged(address indexed previousGuardian, address indexed nextGuardian);

    error OnlyGovernance();
    error OnlyBootstrapController();
    error OnlyGuardianOrGovernance();
    error AlreadyPaused();
    error AlreadyUnpaused();
    error UnpauseNotScheduled();
    error UnpauseNotReady(uint64 executableAt);
    error UnpauseExpired(uint64 expiresAt);
    error GovernanceScheduleUnavailable();
    error StaleGovernanceEpoch(uint64 scheduledEpoch, uint64 currentEpoch);
    error InvalidGuardian();
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

    constructor(address governance_, address guardian_, uint64 unpauseDelay_, address bootstrapController_) {
        if (governance_ == address(0) || guardian_ == address(0) || unpauseDelay_ == 0) {
            revert InvalidConfiguration();
        }
        if (bootstrapController_ != address(0) && bootstrapController_.code.length == 0) {
            revert InvalidConfiguration();
        }
        governance = governance_;
        guardian = guardian_;
        bootstrapController = bootstrapController_;
        unpauseDelay = unpauseDelay_;
    }

    function requireLaunchesOpen() external view {
        if (launchesPaused) revert LaunchesArePaused();
    }

    function pauseLaunches() external onlyGuardianOrGovernance {
        if (launchesPaused) revert AlreadyPaused();
        launchesPaused = true;
        _clearUnpauseSchedule();
        emit LaunchesPaused(msg.sender);
    }

    function scheduleUnpause() external onlyGovernance returns (uint64 executableAt) {
        if (!launchesPaused) revert AlreadyUnpaused();
        (uint64 configurationEpoch, uint64 executionWindow) = _governanceScheduleContext();
        (executableAt, unpauseExpiresAt) = _scheduleTimes(unpauseDelay, executionWindow);
        unpauseExecutableAt = executableAt;
        unpauseConfigurationEpoch = configurationEpoch;
        emit UnpauseScheduled(executableAt);
        emit UnpauseScheduleBound(executableAt, unpauseExpiresAt, configurationEpoch);
    }

    function cancelUnpause() external onlyGuardianOrGovernance {
        if (unpauseExecutableAt == 0) revert UnpauseNotScheduled();
        _clearUnpauseSchedule();
        emit UnpauseCancelled();
    }

    /// @notice Rotates the immediate launch-safety guardian through delayed V6 governance.
    function setGuardian(address nextGuardian) external onlyGovernance {
        address previousGuardian = guardian;
        if (nextGuardian == address(0) || nextGuardian == previousGuardian) revert InvalidGuardian();
        guardian = nextGuardian;
        emit GuardianChanged(previousGuardian, nextGuardian);
    }

    /// @notice One-time genesis reopening after the controller verifies the official launch and fee smoke test.
    /// @dev Every reopening after a later guardian pause still requires scheduleUnpause and the permanent delay.
    function bootstrapUnpause() external {
        if (msg.sender != bootstrapController || bootstrapController == address(0)) {
            revert OnlyBootstrapController();
        }
        if (
            bootstrapConsumed || !launchesPaused || unpauseExecutableAt != 0 || unpauseExpiresAt != 0
                || unpauseConfigurationEpoch != 0
        ) revert InvalidConfiguration();

        bootstrapConsumed = true;
        launchesPaused = false;
        emit LaunchesUnpaused();
        emit BootstrapLaunchesUnpaused(msg.sender);
    }

    /// @notice Completes a delayed reopening only after the operator's final production checks.
    /// @dev Execution is intentionally not permissionless: otherwise any observer could race the reviewed
    ///      release console as soon as the delay expired and bypass its final live safety boundary.
    function executeUnpause() external onlyGuardianOrGovernance {
        if (!launchesPaused) revert AlreadyUnpaused();
        uint64 executableAt = unpauseExecutableAt;
        if (executableAt == 0) revert UnpauseNotScheduled();
        uint64 scheduledEpoch = unpauseConfigurationEpoch;
        uint64 currentEpoch = _governanceConfigurationEpoch();
        if (scheduledEpoch != currentEpoch) revert StaleGovernanceEpoch(scheduledEpoch, currentEpoch);
        if (block.timestamp < executableAt) revert UnpauseNotReady(executableAt);
        uint64 expiresAt = unpauseExpiresAt;
        if (block.timestamp > expiresAt) revert UnpauseExpired(expiresAt);
        _clearUnpauseSchedule();
        launchesPaused = false;
        if (bootstrapController != address(0)) bootstrapConsumed = true;
        emit LaunchesUnpaused();
    }

    function _governanceScheduleContext() private view returns (uint64 configurationEpoch, uint64 executionWindow) {
        configurationEpoch = _governanceUint64(CONFIGURATION_EPOCH_SELECTOR);
        executionWindow = _governanceUint64(EXECUTION_WINDOW_SELECTOR);
        if (configurationEpoch == 0 || executionWindow == 0 || executionWindow > MAXIMUM_GOVERNANCE_WINDOW) {
            revert GovernanceScheduleUnavailable();
        }
    }

    function _governanceConfigurationEpoch() private view returns (uint64 configurationEpoch) {
        configurationEpoch = _governanceUint64(CONFIGURATION_EPOCH_SELECTOR);
        if (configurationEpoch == 0) revert GovernanceScheduleUnavailable();
    }

    function _governanceUint64(bytes4 selector) private view returns (uint64 value) {
        (bool success, bytes memory result) = governance.staticcall(abi.encodeWithSelector(selector));
        if (!success || result.length != 32) revert GovernanceScheduleUnavailable();
        uint256 rawValue = abi.decode(result, (uint256));
        if (rawValue > type(uint64).max) revert GovernanceScheduleUnavailable();
        value = uint64(rawValue);
    }

    function _scheduleTimes(uint64 delay, uint64 executionWindow)
        private
        view
        returns (uint64 executableAt, uint64 expiresAt)
    {
        uint256 executableTimestamp = block.timestamp + delay;
        uint256 expirationTimestamp = executableTimestamp + executionWindow;
        if (expirationTimestamp > type(uint64).max) revert GovernanceScheduleUnavailable();
        executableAt = uint64(executableTimestamp);
        expiresAt = uint64(expirationTimestamp);
    }

    function _clearUnpauseSchedule() private {
        delete unpauseExecutableAt;
        delete unpauseExpiresAt;
        delete unpauseConfigurationEpoch;
    }
}
