// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTLaunchPolicyRegistry} from "./interfaces/IRMTLaunchPolicyRegistry.sol";

/// @notice Append-only launch policy registry for RMT V6 and later factories.
/// @dev New policies and enabling actions are delayed. Emergency disabling is immediate.
contract RMTLaunchPolicyRegistry is IRMTLaunchPolicyRegistry {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @notice Canonical V6 economics shared by every registered launch policy.
    /// @dev Future policy IDs may change reviewed launch behavior, but not these economics or components.
    uint16 public constant CANONICAL_CURVE_FEE_BPS = 100;
    uint16 public constant CANONICAL_CREATOR_FEE_SHARE_BPS = 7_000;
    uint16 public constant CANONICAL_PROTOCOL_FEE_SHARE_BPS = 3_000;
    uint16 public constant CANONICAL_POST_GRADUATION_FEE_BPS = 50;
    uint256 public constant CANONICAL_GRADUATION_TARGET = 2 ether;

    address public immutable override governance;
    address public immutable guardian;
    uint64 public immutable governanceDelay;
    address public immutable canonicalProtocolTreasury;
    address public immutable override canonicalMarketImplementation;
    address public immutable override canonicalGraduationAdapter;

    bytes32 public override defaultPolicyId;
    mapping(bytes32 policyId => LaunchPolicy policy) private _policies;
    mapping(bytes32 policyId => bytes32 hash) public override policyHash;
    mapping(bytes32 policyId => uint256 epoch) public policyOperationEpoch;
    mapping(bytes32 operationId => uint64 executableAt) public scheduledOperations;

    event OperationScheduled(bytes32 indexed operationId, uint64 executableAt);
    event OperationCancelled(bytes32 indexed operationId);
    event PolicyOperationEpochAdvanced(bytes32 indexed policyId, uint256 epoch);

    error OnlyGovernance();
    error OnlyGuardianOrGovernance();
    error InvalidConfiguration();
    error UnknownPolicy();
    error PolicyAlreadyRegistered();
    error OperationNotScheduled();
    error OperationNotReady(uint64 executableAt);

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
        bytes32 immutableHash = _immutablePolicyHash(policy);
        _policies[policy.policyId] = policy;
        policyHash[policy.policyId] = immutableHash;
        emit PolicyRegistered(policy.policyId, policy.policyVersion, immutableHash);
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
        delete scheduledOperations[operationId];
        emit OperationCancelled(operationId);
    }

    function getPolicy(bytes32 policyId) external view override returns (LaunchPolicy memory) {
        LaunchPolicy memory policy = _policies[policyId];
        if (policyHash[policyId] == bytes32(0)) revert UnknownPolicy();
        return policy;
    }

    function isPolicyEnabled(bytes32 policyId) external view override returns (bool) {
        return policyHash[policyId] != bytes32(0) && _policies[policyId].enabled;
    }

    function _validatePolicy(LaunchPolicy calldata policy) private view {
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
    function _immutablePolicyHash(LaunchPolicy calldata policy) private pure returns (bytes32) {
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
        uint64 executableAt = uint64(block.timestamp + governanceDelay);
        scheduledOperations[operationId] = executableAt;
        emit OperationScheduled(operationId, executableAt);
    }

    function _advancePolicyEpoch(bytes32 policyId) private {
        uint256 nextEpoch = policyOperationEpoch[policyId] + 1;
        policyOperationEpoch[policyId] = nextEpoch;
        emit PolicyOperationEpochAdvanced(policyId, nextEpoch);
    }

    function _consume(bytes32 operationId) private {
        uint64 executableAt = scheduledOperations[operationId];
        if (executableAt == 0) revert OperationNotScheduled();
        if (block.timestamp < executableAt) revert OperationNotReady(executableAt);
        delete scheduledOperations[operationId];
    }
}
