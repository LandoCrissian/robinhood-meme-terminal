// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTLaunchPolicyRegistry} from "./interfaces/IRMTLaunchPolicyRegistry.sol";

/// @notice Append-only launch policy registry for RMT V6 and later factories.
/// @dev New policies and enabling actions are delayed. Emergency disabling is immediate.
contract RMTLaunchPolicyRegistry is IRMTLaunchPolicyRegistry {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint64 private constant MAXIMUM_GOVERNANCE_WINDOW = 30 days;
    bytes4 private constant CONFIGURATION_EPOCH_SELECTOR = bytes4(keccak256("configurationEpoch()"));
    bytes4 private constant EXECUTION_WINDOW_SELECTOR = bytes4(keccak256("executionWindow()"));

    bytes32 public constant SIMPLE_FAIR_V1_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    bytes32 public constant SIMPLE_OPEN_V1_POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");

    /// @notice Canonical V6 economics shared by every registered launch policy.
    /// @dev Future policy IDs may change reviewed launch behavior, but not these economics or components.
    uint16 public constant CANONICAL_CURVE_FEE_BPS = 100;
    uint16 public constant CANONICAL_CREATOR_FEE_SHARE_BPS = 7_000;
    uint16 public constant CANONICAL_PROTOCOL_FEE_SHARE_BPS = 3_000;
    uint16 public constant CANONICAL_POST_GRADUATION_FEE_BPS = 50;
    uint256 public constant CANONICAL_GRADUATION_TARGET = 2 ether;

    address public immutable override governance;
    address public guardian;
    uint64 public immutable governanceDelay;
    address public immutable override canonicalProtocolTreasury;
    address public immutable override canonicalMarketImplementation;
    address public immutable override canonicalGraduationAdapter;

    bytes32 public override defaultPolicyId;
    mapping(bytes32 policyId => LaunchPolicy policy) private _policies;
    mapping(bytes32 policyId => bytes32 hash) public override policyHash;
    mapping(bytes32 policyId => uint256 epoch) public policyOperationEpoch;
    mapping(bytes32 operationId => uint64 executableAt) public scheduledOperations;
    mapping(bytes32 operationId => uint64 expiresAt) public scheduledOperationExpirations;
    mapping(bytes32 operationId => uint64 configurationEpoch) public scheduledOperationConfigurationEpochs;

    event OperationScheduled(bytes32 indexed operationId, uint64 executableAt);
    event OperationScheduleBound(
        bytes32 indexed operationId, uint64 executableAt, uint64 expiresAt, uint64 configurationEpoch
    );
    event OperationCancelled(bytes32 indexed operationId);
    event PolicyOperationEpochAdvanced(bytes32 indexed policyId, uint256 epoch);
    event GuardianChanged(address indexed previousGuardian, address indexed nextGuardian);

    error OnlyGovernance();
    error OnlyGuardianOrGovernance();
    error InvalidConfiguration();
    error UnknownPolicy();
    error PolicyAlreadyRegistered();
    error OperationNotScheduled();
    error OperationNotReady(uint64 executableAt);
    error OperationExpired(uint64 expiresAt);
    error GovernanceScheduleUnavailable();
    error StaleGovernanceEpoch(uint64 scheduledEpoch, uint64 currentEpoch);
    error InvalidGuardian();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    modifier onlyGuardianOrGovernance() {
        if (msg.sender != guardian && msg.sender != governance) revert OnlyGuardianOrGovernance();
        _;
    }

    constructor(
        address governance_,
        address guardian_,
        uint64 governanceDelay_,
        address canonicalProtocolTreasury_,
        address canonicalMarketImplementation_,
        address canonicalGraduationAdapter_
    ) {
        if (
            governance_ == address(0) || guardian_ == address(0) || governanceDelay_ == 0
                || canonicalProtocolTreasury_ == address(0) || canonicalMarketImplementation_ == address(0)
                || canonicalMarketImplementation_.code.length == 0 || canonicalGraduationAdapter_ == address(0)
                || canonicalGraduationAdapter_.code.length == 0
        ) revert InvalidConfiguration();
        governance = governance_;
        guardian = guardian_;
        governanceDelay = governanceDelay_;
        canonicalProtocolTreasury = canonicalProtocolTreasury_;
        canonicalMarketImplementation = canonicalMarketImplementation_;
        canonicalGraduationAdapter = canonicalGraduationAdapter_;

        LaunchPolicy memory fairPolicy = _genesisPolicy(true);
        LaunchPolicy memory openPolicy = _genesisPolicy(false);
        _registerPolicy(fairPolicy);
        _registerPolicy(openPolicy);
        defaultPolicyId = SIMPLE_FAIR_V1_POLICY_ID;
        emit DefaultPolicyChanged(bytes32(0), SIMPLE_FAIR_V1_POLICY_ID);
    }

    function schedulePolicyRegistration(LaunchPolicy calldata policy)
        external
        onlyGovernance
        returns (bytes32 operationId)
    {
        _validatePolicy(policy);
        if (policyHash[policy.policyId] != bytes32(0)) revert PolicyAlreadyRegistered();
        operationId = keccak256(abi.encode("REGISTER_POLICY", policy));
        _schedule(operationId);
    }

    function executePolicyRegistration(LaunchPolicy calldata policy) external {
        _validatePolicy(policy);
        if (policyHash[policy.policyId] != bytes32(0)) revert PolicyAlreadyRegistered();
        bytes32 operationId = keccak256(abi.encode("REGISTER_POLICY", policy));
        _consume(operationId);
        _registerPolicy(policy);
    }

    function disablePolicy(bytes32 policyId) external onlyGuardianOrGovernance {
        LaunchPolicy storage policy = _requirePolicy(policyId);
        policy.enabled = false;
        policy.publiclySelectable = false;
        _advancePolicyEpoch(policyId);
        emit PolicyAvailabilityChanged(policyId, false, false);
    }

    function schedulePolicyAvailability(bytes32 policyId, bool enabled, bool publiclySelectable)
        external
        onlyGovernance
        returns (bytes32 operationId)
    {
        _requirePolicy(policyId);
        if (!enabled && publiclySelectable) revert InvalidConfiguration();
        operationId = keccak256(
            abi.encode("POLICY_AVAILABILITY", policyId, policyOperationEpoch[policyId], enabled, publiclySelectable)
        );
        _schedule(operationId);
    }

    function executePolicyAvailability(bytes32 policyId, bool enabled, bool publiclySelectable) external {
        if (!enabled && publiclySelectable) revert InvalidConfiguration();
        LaunchPolicy storage policy = _requirePolicy(policyId);
        bytes32 operationId = keccak256(
            abi.encode("POLICY_AVAILABILITY", policyId, policyOperationEpoch[policyId], enabled, publiclySelectable)
        );
        _consume(operationId);
        bool availabilityChanged = policy.enabled != enabled || policy.publiclySelectable != publiclySelectable;
        policy.enabled = enabled;
        policy.publiclySelectable = publiclySelectable;
        if (availabilityChanged) _advancePolicyEpoch(policyId);
        emit PolicyAvailabilityChanged(policyId, enabled, publiclySelectable);
    }

    function scheduleDefaultPolicy(bytes32 policyId) external onlyGovernance returns (bytes32 operationId) {
        _requirePolicy(policyId);
        operationId = keccak256(abi.encode("DEFAULT_POLICY", policyId, policyOperationEpoch[policyId]));
        _schedule(operationId);
    }

    function executeDefaultPolicy(bytes32 policyId) external {
        LaunchPolicy storage policy = _requirePolicy(policyId);
        if (!policy.enabled || !policy.publiclySelectable) revert InvalidConfiguration();
        bytes32 operationId = keccak256(abi.encode("DEFAULT_POLICY", policyId, policyOperationEpoch[policyId]));
        _consume(operationId);
        bytes32 previous = defaultPolicyId;
        defaultPolicyId = policyId;
        emit DefaultPolicyChanged(previous, policyId);
    }

    function cancelOperation(bytes32 operationId) external onlyGovernance {
        if (scheduledOperations[operationId] == 0) revert OperationNotScheduled();
        _clearScheduledOperation(operationId);
        emit OperationCancelled(operationId);
    }

    /// @notice Rotates the immediate policy-safety guardian through delayed V6 governance.
    function setGuardian(address nextGuardian) external onlyGovernance {
        address previousGuardian = guardian;
        if (nextGuardian == address(0) || nextGuardian == previousGuardian) revert InvalidGuardian();
        guardian = nextGuardian;
        emit GuardianChanged(previousGuardian, nextGuardian);
    }

    function getPolicy(bytes32 policyId) external view override returns (LaunchPolicy memory) {
        LaunchPolicy memory policy = _policies[policyId];
        if (policyHash[policyId] == bytes32(0)) revert UnknownPolicy();
        return policy;
    }

    function isPolicyEnabled(bytes32 policyId) external view override returns (bool) {
        return policyHash[policyId] != bytes32(0) && _policies[policyId].enabled;
    }

    function _genesisPolicy(bool fairStartEnabled) private view returns (LaunchPolicy memory policy) {
        policy = LaunchPolicy({
            policyId: fairStartEnabled ? SIMPLE_FAIR_V1_POLICY_ID : SIMPLE_OPEN_V1_POLICY_ID,
            policyVersion: 1,
            enabled: true,
            publiclySelectable: true,
            curveFeeBps: CANONICAL_CURVE_FEE_BPS,
            creatorFeeShareBps: CANONICAL_CREATOR_FEE_SHARE_BPS,
            protocolFeeShareBps: CANONICAL_PROTOCOL_FEE_SHARE_BPS,
            postGraduationFeeBps: CANONICAL_POST_GRADUATION_FEE_BPS,
            graduationTarget: CANONICAL_GRADUATION_TARGET,
            fairStartMode: fairStartEnabled ? 1 : 0,
            fairStartDelayBlocks: fairStartEnabled ? 1 : 0,
            fairStartDurationBlocks: fairStartEnabled ? 10 : 0,
            fairStartMaxTxBps: fairStartEnabled ? 100 : 0,
            fairStartMaxWalletBps: fairStartEnabled ? 300 : 0,
            marketImplementation: canonicalMarketImplementation,
            protocolTreasury: canonicalProtocolTreasury,
            graduationAdapter: canonicalGraduationAdapter
        });
    }

    function _registerPolicy(LaunchPolicy memory policy) private {
        _validatePolicy(policy);
        if (policyHash[policy.policyId] != bytes32(0)) revert PolicyAlreadyRegistered();
        bytes32 immutableHash = _immutablePolicyHash(policy);
        _policies[policy.policyId] = policy;
        policyHash[policy.policyId] = immutableHash;
        emit PolicyRegistered(policy.policyId, policy.policyVersion, immutableHash);
    }

    function _validatePolicy(LaunchPolicy memory policy) private view {
        bool fairStartDisabled = policy.fairStartMode == 0 && policy.fairStartDelayBlocks == 0
            && policy.fairStartDurationBlocks == 0 && policy.fairStartMaxTxBps == 0 && policy.fairStartMaxWalletBps == 0;
        bool fairStartEnabled = policy.fairStartMode == 1 && policy.fairStartDelayBlocks > 0
            && policy.fairStartDurationBlocks > 0 && policy.fairStartMaxTxBps > 0
            && policy.fairStartMaxWalletBps >= policy.fairStartMaxTxBps
            && policy.fairStartMaxWalletBps <= BPS_DENOMINATOR;

        if (
            policy.policyId == bytes32(0) || policy.policyVersion == 0 || policy.curveFeeBps != CANONICAL_CURVE_FEE_BPS
                || policy.creatorFeeShareBps != CANONICAL_CREATOR_FEE_SHARE_BPS
                || policy.protocolFeeShareBps != CANONICAL_PROTOCOL_FEE_SHARE_BPS
                || policy.postGraduationFeeBps != CANONICAL_POST_GRADUATION_FEE_BPS
                || policy.graduationTarget != CANONICAL_GRADUATION_TARGET || !(fairStartDisabled || fairStartEnabled)
                || policy.marketImplementation != canonicalMarketImplementation
                || policy.protocolTreasury != canonicalProtocolTreasury
                || policy.graduationAdapter != canonicalGraduationAdapter
                || (!policy.enabled && policy.publiclySelectable)
        ) revert InvalidConfiguration();

        (bool feeReadSuccess, bytes memory feeData) =
            policy.graduationAdapter.staticcall(abi.encodeWithSignature("poolFee()"));
        if (
            !feeReadSuccess || feeData.length < 32
                || abi.decode(feeData, (uint24)) != uint24(uint256(policy.postGraduationFeeBps) * 100)
        ) revert InvalidConfiguration();
    }

    /// @dev Availability is mutable by design and is therefore excluded from the permanent economics hash.
    function _immutablePolicyHash(LaunchPolicy memory policy) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                policy.policyId,
                policy.policyVersion,
                policy.curveFeeBps,
                policy.creatorFeeShareBps,
                policy.protocolFeeShareBps,
                policy.postGraduationFeeBps,
                policy.graduationTarget,
                policy.fairStartMode,
                policy.fairStartDelayBlocks,
                policy.fairStartDurationBlocks,
                policy.fairStartMaxTxBps,
                policy.fairStartMaxWalletBps,
                policy.marketImplementation,
                policy.protocolTreasury,
                policy.graduationAdapter
            )
        );
    }

    function _requirePolicy(bytes32 policyId) private view returns (LaunchPolicy storage policy) {
        if (policyHash[policyId] == bytes32(0)) revert UnknownPolicy();
        policy = _policies[policyId];
    }

    function _schedule(bytes32 operationId) private {
        (uint64 configurationEpoch, uint64 executionWindow) = _governanceScheduleContext();
        (uint64 executableAt, uint64 expiresAt) = _scheduleTimes(governanceDelay, executionWindow);
        scheduledOperations[operationId] = executableAt;
        scheduledOperationExpirations[operationId] = expiresAt;
        scheduledOperationConfigurationEpochs[operationId] = configurationEpoch;
        emit OperationScheduled(operationId, executableAt);
        emit OperationScheduleBound(operationId, executableAt, expiresAt, configurationEpoch);
    }

    function _advancePolicyEpoch(bytes32 policyId) private {
        uint256 nextEpoch = policyOperationEpoch[policyId] + 1;
        policyOperationEpoch[policyId] = nextEpoch;
        emit PolicyOperationEpochAdvanced(policyId, nextEpoch);
    }

    function _consume(bytes32 operationId) private {
        uint64 executableAt = scheduledOperations[operationId];
        if (executableAt == 0) revert OperationNotScheduled();
        uint64 scheduledEpoch = scheduledOperationConfigurationEpochs[operationId];
        uint64 currentEpoch = _governanceConfigurationEpoch();
        if (scheduledEpoch != currentEpoch) revert StaleGovernanceEpoch(scheduledEpoch, currentEpoch);
        if (block.timestamp < executableAt) revert OperationNotReady(executableAt);
        uint64 expiresAt = scheduledOperationExpirations[operationId];
        if (block.timestamp > expiresAt) revert OperationExpired(expiresAt);
        _clearScheduledOperation(operationId);
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

    function _clearScheduledOperation(bytes32 operationId) private {
        delete scheduledOperations[operationId];
        delete scheduledOperationExpirations[operationId];
        delete scheduledOperationConfigurationEpochs[operationId];
    }
}
