// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Delayed discovery registry for future launch-factory versions.
/// @dev Updating this registry never changes existing tokens, markets, vaults, or liquidity.
contract VersionedFactoryRegistry {
    uint256 public constant MINIMUM_DELAY = 1 days;
    uint256 public constant MAXIMUM_DELAY = 30 days;

    bytes4 private constant CONFIGURATION_EPOCH_SELECTOR = bytes4(keccak256("configurationEpoch()"));
    bytes4 private constant EXECUTION_WINDOW_SELECTOR = bytes4(keccak256("executionWindow()"));

    address public immutable governance;
    address public immutable bootstrapController;
    uint256 public immutable activationDelay;
    address public immutable initialFactory;
    bytes32 public immutable initialVersion;

    bool public bootstrapConsumed;

    address public activeFactory;
    bytes32 public activeVersion;

    address public pendingFactory;
    bytes32 public pendingVersion;
    uint64 public pendingActivationTime;
    uint64 public pendingExpirationTime;
    uint64 public pendingConfigurationEpoch;

    event FactoryProposed(address indexed factory, bytes32 indexed version, uint256 activationTime);
    event FactoryProposalBound(
        address indexed factory,
        bytes32 indexed version,
        uint64 executableAt,
        uint64 expiresAt,
        uint64 configurationEpoch
    );
    event FactoryProposalCancelled(address indexed factory, bytes32 indexed version);
    event FactoryActivated(address indexed previousFactory, address indexed factory, bytes32 indexed version);
    event BootstrapFactoryActivated(address indexed factory, bytes32 indexed version, address indexed controller);

    error OnlyGovernance();
    error OnlyBootstrapController();
    error InvalidConfiguration();
    error NoPendingFactory();
    error ActivationNotReady();
    error ActivationExpired(uint64 expiresAt);
    error GovernanceScheduleUnavailable();
    error StaleGovernanceEpoch(uint64 scheduledEpoch, uint64 currentEpoch);
    error FactoryCodeMissing();

    constructor(
        address governance_,
        uint256 activationDelay_,
        address initialFactory_,
        bytes32 initialVersion_,
        address bootstrapController_
    ) {
        if (
            governance_ == address(0) || activationDelay_ < MINIMUM_DELAY || activationDelay_ > MAXIMUM_DELAY
                || initialFactory_ == address(0) || initialVersion_ == bytes32(0)
        ) revert InvalidConfiguration();
        if (initialFactory_.code.length == 0) revert FactoryCodeMissing();
        if (bootstrapController_ != address(0) && bootstrapController_.code.length == 0) {
            revert InvalidConfiguration();
        }

        governance = governance_;
        bootstrapController = bootstrapController_;
        activationDelay = activationDelay_;
        initialFactory = initialFactory_;
        initialVersion = initialVersion_;
        activeFactory = initialFactory_;
        activeVersion = initialVersion_;
        emit FactoryActivated(address(0), initialFactory_, initialVersion_);
    }

    /// @notice One-time genesis activation for the source-verified V6 factory.
    /// @dev The immutable controller is a narrow, expiring release helper. Every later upgrade uses proposeFactory
    ///      and the permanent activation delay below.
    function bootstrapActivateFactory(address factory, bytes32 version) external {
        if (msg.sender != bootstrapController || bootstrapController == address(0)) {
            revert OnlyBootstrapController();
        }
        if (
            bootstrapConsumed || factory == address(0) || version == bytes32(0) || factory == activeFactory
                || activeFactory != initialFactory || activeVersion != initialVersion || pendingFactory != address(0)
                || pendingVersion != bytes32(0) || pendingActivationTime != 0 || pendingExpirationTime != 0
                || pendingConfigurationEpoch != 0
        ) revert InvalidConfiguration();
        if (factory.code.length == 0) revert FactoryCodeMissing();

        bootstrapConsumed = true;
        address previous = activeFactory;
        activeFactory = factory;
        activeVersion = version;
        emit FactoryActivated(previous, factory, version);
        emit BootstrapFactoryActivated(factory, version, msg.sender);
    }

    function proposeFactory(address factory, bytes32 version) external {
        if (msg.sender != governance) revert OnlyGovernance();
        if (factory == address(0) || version == bytes32(0) || factory == activeFactory) {
            revert InvalidConfiguration();
        }
        if (factory.code.length == 0) revert FactoryCodeMissing();

        (uint64 configurationEpoch, uint64 executionWindow) = _governanceScheduleContext();
        (uint64 executableAt, uint64 expiresAt) = _scheduleTimes(activationDelay, executionWindow);
        pendingFactory = factory;
        pendingVersion = version;
        pendingActivationTime = executableAt;
        pendingExpirationTime = expiresAt;
        pendingConfigurationEpoch = configurationEpoch;
        emit FactoryProposed(factory, version, executableAt);
        emit FactoryProposalBound(factory, version, executableAt, expiresAt, configurationEpoch);
    }

    function cancelProposal() external {
        if (msg.sender != governance) revert OnlyGovernance();
        address factory = pendingFactory;
        bytes32 version = pendingVersion;
        if (factory == address(0)) revert NoPendingFactory();

        _clearPendingProposal();
        emit FactoryProposalCancelled(factory, version);
    }

    /// @notice Anyone may finalize a fully disclosed proposal after the delay.
    function activateFactory() external {
        address factory = pendingFactory;
        bytes32 version = pendingVersion;
        uint64 activationTime = pendingActivationTime;
        if (factory == address(0)) revert NoPendingFactory();
        uint64 scheduledEpoch = pendingConfigurationEpoch;
        uint64 currentEpoch = _governanceConfigurationEpoch();
        if (scheduledEpoch != currentEpoch) revert StaleGovernanceEpoch(scheduledEpoch, currentEpoch);
        if (block.timestamp < activationTime) revert ActivationNotReady();
        uint64 expiresAt = pendingExpirationTime;
        if (block.timestamp > expiresAt) revert ActivationExpired(expiresAt);
        if (factory.code.length == 0) revert FactoryCodeMissing();

        address previous = activeFactory;
        activeFactory = factory;
        activeVersion = version;
        if (bootstrapController != address(0)) bootstrapConsumed = true;
        _clearPendingProposal();
        emit FactoryActivated(previous, factory, version);
    }

    function _governanceScheduleContext() private view returns (uint64 configurationEpoch, uint64 executionWindow) {
        configurationEpoch = _governanceUint64(CONFIGURATION_EPOCH_SELECTOR);
        executionWindow = _governanceUint64(EXECUTION_WINDOW_SELECTOR);
        if (configurationEpoch == 0 || executionWindow == 0 || executionWindow > MAXIMUM_DELAY) {
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

    function _scheduleTimes(uint256 delay, uint64 executionWindow)
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

    function _clearPendingProposal() private {
        delete pendingFactory;
        delete pendingVersion;
        delete pendingActivationTime;
        delete pendingExpirationTime;
        delete pendingConfigurationEpoch;
    }
}
