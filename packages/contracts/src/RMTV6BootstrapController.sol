// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV6BootstrapFoundationVerifier} from "./RMTV6BootstrapFoundationVerifier.sol";
import {RMTV6BootstrapSmokeVerifier} from "./RMTV6BootstrapSmokeVerifier.sol";

interface IRMTV6BootstrapGovernance {
    function isSigner(address signer) external view returns (bool);
    function signerCount() external view returns (uint256);
    function threshold() external view returns (uint256);
    function transactionCount() external view returns (uint256);
    function configurationEpoch() external view returns (uint64);
    function executionDelay() external view returns (uint64);
    function executionWindow() external view returns (uint64);
}

interface IRMTV6BootstrapRegistryActivation {
    function bootstrapActivateFactory(address factory, bytes32 version) external;
}

interface IRMTV6BootstrapGateActivation {
    function launchesPaused() external view returns (bool);
    function bootstrapUnpause() external;
}

/// @notice Expiring one-time controller for the reviewed V6 genesis cutover.
/// @dev This contract has no generic call, asset-custody, upgrade, signer, recovery, or verifier-replacement authority.
///      Its exact child verifiers are created during construction, bind themselves immutably to this controller, and
///      contain only view checks. Every later registry change and every later reopening retains its permanent delay.
contract RMTV6BootstrapController {
    enum BootstrapState {
        Unbound,
        OfficialPending,
        Complete,
        Aborted
    }

    uint256 public constant CHAIN_ID = 4_663;
    address public constant OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    address public constant LEGACY_IDENTITY_FACTORY = 0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD;
    address public constant OFFICIAL_LEGACY_RMT_TOKEN = 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C;
    address public constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 public constant LEGACY_FACTORY_VERSION = keccak256("RMT_FACTORY_V5");
    bytes32 public constant FACTORY_VERSION = keccak256("RMT_FACTORY_V6");
    bytes32 public constant FAIR_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    bytes32 public constant OPEN_POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");
    uint64 public constant BOOTSTRAP_WINDOW = 12 hours;
    uint64 public constant GOVERNANCE_DELAY = 1 days;
    uint64 public constant GOVERNANCE_EXECUTION_WINDOW = 7 days;
    uint64 public constant REGISTRY_ACTIVATION_DELAY = 2 days;
    uint64 public constant GATE_UNPAUSE_DELAY = 1 days;
    uint256 public constant INITIAL_VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 public constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint24 public constant V4_POOL_FEE = 5_000;
    int24 public constant V4_TICK_SPACING = 200;
    uint160 public constant REQUIRED_HOOK_FLAGS = 0x28a0;

    address public immutable governance;
    uint64 public immutable expiresAt;
    RMTV6BootstrapFoundationVerifier public immutable foundationVerifier;
    RMTV6BootstrapSmokeVerifier public immutable smokeVerifier;

    BootstrapState public state;
    address public versionRegistry;
    address public launchGate;
    address public policyRegistry;
    address public factory;
    bytes32 public sourceEvidenceHash;
    bytes32 public smokeEvidenceHash;
    bool private _entered;

    event FoundationActivated(
        address indexed factory,
        address indexed versionRegistry,
        bytes32 indexed sourceEvidenceHash,
        address launchGate,
        address policyRegistry
    );
    event PublicLaunchesOpened(address indexed factory, bytes32 indexed smokeEvidenceHash);
    event BootstrapAborted(address indexed operator, bool expired);

    error Unauthorized();
    error InvalidState();
    error InvalidConfiguration();
    error EvidenceRequired();
    error BootstrapExpired();
    error WrongChain(uint256 actualChainId);
    error ReentrantCall();

    modifier onlyOperator() {
        if (msg.sender != OPERATOR) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address governance_) {
        if (block.chainid != CHAIN_ID) revert WrongChain(block.chainid);
        if (msg.sender != OPERATOR || governance_ == address(0) || governance_.code.length == 0) {
            revert InvalidConfiguration();
        }
        governance = governance_;
        expiresAt = uint64(block.timestamp + BOOTSTRAP_WINDOW);
        _validatePristineGovernance();

        RMTV6BootstrapFoundationVerifier deployedFoundationVerifier =
            new RMTV6BootstrapFoundationVerifier(address(this));
        RMTV6BootstrapSmokeVerifier deployedSmokeVerifier = new RMTV6BootstrapSmokeVerifier(address(this));
        if (
            deployedFoundationVerifier.controller() != address(this)
                || deployedSmokeVerifier.controller() != address(this)
        ) revert InvalidConfiguration();
        foundationVerifier = deployedFoundationVerifier;
        smokeVerifier = deployedSmokeVerifier;
    }

    receive() external payable {
        revert InvalidConfiguration();
    }

    /// @notice Atomically binds the reviewed foundation and activates V6 without weakening later registry delays.
    function activateVerifiedFoundation(
        address versionRegistry_,
        address launchGate_,
        address policyRegistry_,
        address factory_,
        bytes32 sourceEvidenceHash_
    ) external onlyOperator nonReentrant {
        if (state != BootstrapState.Unbound) revert InvalidState();
        _requireLiveWindow();
        if (sourceEvidenceHash_ == bytes32(0)) revert EvidenceRequired();

        _validatePristineGovernance();
        foundationVerifier.validateFoundation(
            governance, versionRegistry_, launchGate_, policyRegistry_, factory_, false, false
        );

        versionRegistry = versionRegistry_;
        launchGate = launchGate_;
        policyRegistry = policyRegistry_;
        factory = factory_;
        sourceEvidenceHash = sourceEvidenceHash_;
        state = BootstrapState.OfficialPending;

        IRMTV6BootstrapRegistryActivation(versionRegistry_).bootstrapActivateFactory(factory_, FACTORY_VERSION);
        foundationVerifier.validateFoundation(
            governance, versionRegistry_, launchGate_, policyRegistry_, factory_, true, false
        );
        emit FoundationActivated(factory_, versionRegistry_, sourceEvidenceHash_, launchGate_, policyRegistry_);
    }

    /// @notice Opens public launches once after the official token and its native-fee split have been proven live.
    function openAfterOfficialSmoke(bytes32 smokeEvidenceHash_) external onlyOperator nonReentrant {
        if (state != BootstrapState.OfficialPending) revert InvalidState();
        _requireLiveWindow();
        if (smokeEvidenceHash_ == bytes32(0)) revert EvidenceRequired();

        _validatePristineGovernance();
        foundationVerifier.validateFoundation(
            governance, versionRegistry, launchGate, policyRegistry, factory, true, true
        );
        smokeVerifier.validateOfficialLaunchAndSmoke(governance, policyRegistry, factory);

        smokeEvidenceHash = smokeEvidenceHash_;
        state = BootstrapState.Complete;
        IRMTV6BootstrapGateActivation(launchGate).bootstrapUnpause();
        if (IRMTV6BootstrapGateActivation(launchGate).launchesPaused()) revert InvalidConfiguration();
        emit PublicLaunchesOpened(factory, smokeEvidenceHash_);
    }

    /// @notice Irreversibly abandons the expedited path. Permanent delayed paths remain available.
    function abortBootstrap() external onlyOperator {
        if (state == BootstrapState.Complete || state == BootstrapState.Aborted) revert InvalidState();
        state = BootstrapState.Aborted;
        emit BootstrapAborted(msg.sender, false);
    }

    /// @notice Materializes the immutable expiry in storage; expiry is effective even if this is never called.
    function expireBootstrap() external {
        if (state == BootstrapState.Complete || state == BootstrapState.Aborted) revert InvalidState();
        if (block.timestamp <= expiresAt) revert InvalidState();
        state = BootstrapState.Aborted;
        emit BootstrapAborted(OPERATOR, true);
    }

    function bootstrapAvailable() external view returns (bool) {
        return block.chainid == CHAIN_ID && (state == BootstrapState.Unbound || state == BootstrapState.OfficialPending)
            && block.timestamp <= expiresAt;
    }

    function _requireLiveWindow() private view {
        if (block.chainid != CHAIN_ID) revert WrongChain(block.chainid);
        if (block.timestamp > expiresAt) revert BootstrapExpired();
    }

    function _validatePristineGovernance() private view {
        IRMTV6BootstrapGovernance governed = IRMTV6BootstrapGovernance(governance);
        if (
            !governed.isSigner(OPERATOR) || governed.signerCount() != 1 || governed.threshold() != 1
                || governed.transactionCount() != 0 || governed.configurationEpoch() != 1
                || governed.executionDelay() != GOVERNANCE_DELAY
                || governed.executionWindow() != GOVERNANCE_EXECUTION_WINDOW
        ) revert InvalidConfiguration();
    }
}
