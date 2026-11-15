// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IRMTLaunchCurveVersionV2 {
    function engineVersion() external view returns (uint32);
}

interface IRMTCurveMigrationTemplateV2 {
    function fromVersion() external view returns (uint32);
    function toVersion() external view returns (uint32);
    function prepare(address source, bytes32 salt) external returns (address);
}

/// @notice Non-custodial discovery authority for new curve versions.
/// @dev The directory never owns a launch and has no call path into a launch.
contract RMTLaunchCurveDirectoryV2 is EIP712 {
    uint48 public constant publicationDelay = 2 days;
    uint48 public constant executionWindow = 7 days;
    uint32 public constant MAX_CURVE_VERSION = 32;
    bytes32 public constant ACTION_TYPEHASH = keccak256(
        "Action(uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)"
    );
    bytes32 public constant ROTATION_TYPEHASH = keccak256(
        "SignerRotation(address departingSigner,address incomingSigner,uint64 signerSetEpoch,uint64 nonce,uint48 deadline)"
    );
    bytes32 public constant ROTATION_ACCEPTANCE_TYPEHASH = keccak256("RotationAcceptance(bytes32 rotationDigest)");
    bytes32 public constant ROTATION_CANCELLATION_TYPEHASH =
        keccak256("RotationCancellation(bytes32 rotationDigest,uint64 signerSetEpoch,uint64 nonce,uint48 deadline)");

    enum ActionKind {
        Publish,
        Resume,
        Suspend,
        Cancel,
        PublishMigrationTemplate
    }

    struct Action {
        ActionKind kind;
        uint64 nonce;
        uint32 version;
        address factory;
        bytes32 runtimeHash;
        uint64 signerSetEpoch;
        uint48 deadline;
    }

    struct SignerRotation {
        address departingSigner;
        address incomingSigner;
        uint64 signerSetEpoch;
        uint64 nonce;
        uint48 deadline;
    }

    struct RotationCancellation {
        bytes32 rotationDigest;
        uint64 signerSetEpoch;
        uint64 nonce;
        uint48 deadline;
    }

    struct FactoryPin {
        address factory;
        bytes32 runtimeHash;
    }

    struct Pending {
        bytes32 digest;
        uint48 executableAt;
        uint48 expiresAt;
    }

    address public signerA;
    address public signerB;
    address public signerC;
    uint64 public signerSetEpoch = 1;
    uint64 public rotationNonce;

    uint64 public nonce;
    uint32 public latestVersion;
    bool public suspended;
    Pending public pending;
    Pending public pendingRotation;
    mapping(uint32 => FactoryPin) public factories;
    mapping(uint32 => FactoryPin) public migrationTemplates;

    error InvalidSigners();
    error InvalidAction();
    error InvalidFactory();
    error PendingAction();
    error NotExecutable();
    error InvalidRotation();

    event ActionScheduled(bytes32 indexed digest, uint64 indexed nonce, uint48 executableAt, uint48 expiresAt);
    event ActionCleared(bytes32 indexed digest, uint64 indexed nonce);
    event FactoryPublished(uint32 indexed version, address indexed factory, bytes32 runtimeHash);
    event MigrationTemplatePublished(uint32 indexed toVersion, address indexed deployer, bytes32 runtimeHash);
    event DiscoverySuspended(bool suspended);
    event SignerRotationScheduled(
        bytes32 indexed digest,
        uint64 indexed signerSetEpoch,
        uint64 indexed rotationNonce,
        address departingSigner,
        address incomingSigner,
        uint48 executableAt,
        uint48 expiresAt
    );
    event SignerRotationCancelled(bytes32 indexed digest, uint64 indexed signerSetEpoch, uint64 indexed rotationNonce);
    event SignerRotationExpired(bytes32 indexed digest, uint64 indexed signerSetEpoch, uint64 indexed rotationNonce);
    event SignerRotationExecuted(
        bytes32 indexed digest,
        uint64 indexed newSignerSetEpoch,
        uint64 indexed rotationNonce,
        address departingSigner,
        address incomingSigner
    );

    constructor(address signerA_, address signerB_, address signerC_) EIP712("RMT Launch Curve Directory", "2") {
        if (
            !_eligible(signerA_) || !_eligible(signerB_) || !_eligible(signerC_) || signerA_ == signerB_
                || signerA_ == signerC_ || signerB_ == signerC_
        ) revert InvalidSigners();
        signerA = signerA_;
        signerB = signerB_;
        signerC = signerC_;
    }

    function actionDigest(Action calldata action) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ACTION_TYPEHASH,
                    uint8(action.kind),
                    action.nonce,
                    action.version,
                    action.factory,
                    action.runtimeHash,
                    action.signerSetEpoch,
                    action.deadline
                )
            )
        );
    }

    function schedule(Action calldata action, bytes calldata first, bytes calldata second) external {
        if (pending.digest != bytes32(0)) revert PendingAction();
        if (action.kind == ActionKind.Publish) _validateFactory(action);
        else if (action.kind == ActionKind.PublishMigrationTemplate) _validateMigrationTemplate(action);
        else if (action.kind != ActionKind.Resume || !suspended || !_empty(action)) revert InvalidAction();

        bytes32 digest = _authorize(action, first, second);
        (uint48 executableAt, uint48 expiresAt) = _noticeWindow(action.deadline);
        pending = Pending(digest, executableAt, expiresAt);
        emit ActionScheduled(digest, action.nonce, executableAt, expiresAt);
    }

    function execute(Action calldata action) external {
        Pending memory next = pending;
        if (
            next.digest == bytes32(0) || next.digest != actionDigest(action) || action.nonce != nonce
                || action.signerSetEpoch != signerSetEpoch || block.timestamp < next.executableAt
                || block.timestamp > next.expiresAt
        ) revert NotExecutable();
        if (action.kind == ActionKind.Publish) {
            _validateFactory(action);
            latestVersion = action.version;
            factories[action.version] = FactoryPin(action.factory, action.runtimeHash);
            emit FactoryPublished(action.version, action.factory, action.runtimeHash);
        } else if (action.kind == ActionKind.PublishMigrationTemplate) {
            _validateMigrationTemplate(action);
            migrationTemplates[action.version] = FactoryPin(action.factory, action.runtimeHash);
            emit MigrationTemplatePublished(action.version, action.factory, action.runtimeHash);
        } else {
            if (action.kind != ActionKind.Resume || !suspended) revert InvalidAction();
            suspended = false;
            emit DiscoverySuspended(false);
        }
        _clear();
    }

    /// @notice Halt new discovery immediately. Existing curves and custody remain reachable.
    function suspend(Action calldata action, bytes calldata first, bytes calldata second) external {
        if (action.kind != ActionKind.Suspend || !_empty(action)) revert InvalidAction();
        _authorize(action, first, second);
        suspended = true;
        _clear();
        emit DiscoverySuspended(true);
    }

    function cancel(Action calldata action, bytes calldata first, bytes calldata second) external {
        Pending memory next = pending;
        if (
            action.kind != ActionKind.Cancel || action.version != 0 || action.factory != address(0)
                || next.digest == bytes32(0) || action.runtimeHash != next.digest
        ) revert InvalidAction();
        _authorize(action, first, second);
        _clear();
    }

    function clearExpired() external {
        if (pending.digest == bytes32(0) || block.timestamp <= pending.expiresAt) revert NotExecutable();
        _clear();
    }

    function signerRotationDigest(SignerRotation calldata rotation) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ROTATION_TYPEHASH,
                    rotation.departingSigner,
                    rotation.incomingSigner,
                    rotation.signerSetEpoch,
                    rotation.nonce,
                    rotation.deadline
                )
            )
        );
    }

    function rotationAcceptanceDigest(bytes32 rotationDigest) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ROTATION_ACCEPTANCE_TYPEHASH, rotationDigest)));
    }

    function rotationCancellationDigest(RotationCancellation calldata cancellation) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ROTATION_CANCELLATION_TYPEHASH,
                    cancellation.rotationDigest,
                    cancellation.signerSetEpoch,
                    cancellation.nonce,
                    cancellation.deadline
                )
            )
        );
    }

    /// @notice Two current signers and the incoming EOA authorize replacing a single member.
    /// @dev Rotation has its own pending slot and can be prepared while discovery is suspended.
    function scheduleSignerRotation(
        SignerRotation calldata rotation,
        bytes calldata first,
        bytes calldata second,
        bytes calldata acceptance
    ) external {
        if (pendingRotation.digest != bytes32(0)) revert PendingAction();
        _validateRotation(rotation);
        bytes32 digest = signerRotationDigest(rotation);
        _authorizeSigners(digest, first, second);
        if (ECDSA.recover(rotationAcceptanceDigest(digest), acceptance) != rotation.incomingSigner) {
            revert InvalidSigners();
        }
        (uint48 executableAt, uint48 expiresAt) = _noticeWindow(rotation.deadline);
        pendingRotation = Pending(digest, executableAt, expiresAt);
        emit SignerRotationScheduled(
            digest,
            rotation.signerSetEpoch,
            rotation.nonce,
            rotation.departingSigner,
            rotation.incomingSigner,
            executableAt,
            expiresAt
        );
    }

    /// @notice Execute the exact rotation after notice. Existing discovery suspension stays in force.
    function executeSignerRotation(SignerRotation calldata rotation) external {
        Pending memory next = pendingRotation;
        if (
            next.digest == bytes32(0) || next.digest != signerRotationDigest(rotation)
                || block.timestamp < next.executableAt || block.timestamp > next.expiresAt
        ) revert NotExecutable();
        _validateRotation(rotation);
        address departing = rotation.departingSigner;
        if (departing == signerA) signerA = rotation.incomingSigner;
        else if (departing == signerB) signerB = rotation.incomingSigner;
        else signerC = rotation.incomingSigner;
        ++signerSetEpoch;
        _clearRotation();
        _clear();
        emit SignerRotationExecuted(next.digest, signerSetEpoch, rotation.nonce, departing, rotation.incomingSigner);
    }

    function cancelSignerRotation(
        RotationCancellation calldata cancellation,
        bytes calldata first,
        bytes calldata second
    ) external {
        if (
            pendingRotation.digest == bytes32(0) || pendingRotation.digest != cancellation.rotationDigest
                || cancellation.signerSetEpoch != signerSetEpoch || cancellation.nonce != rotationNonce
                || block.timestamp > cancellation.deadline
        ) revert InvalidRotation();
        _authorizeSigners(rotationCancellationDigest(cancellation), first, second);
        emit SignerRotationCancelled(cancellation.rotationDigest, signerSetEpoch, rotationNonce);
        _clearRotation();
    }

    function clearExpiredRotation() external {
        Pending memory next = pendingRotation;
        if (next.digest == bytes32(0) || block.timestamp <= next.expiresAt) revert NotExecutable();
        emit SignerRotationExpired(next.digest, signerSetEpoch, rotationNonce);
        _clearRotation();
    }

    function isSigner(address signer) public view returns (bool) {
        return _member(signer) && _eligible(signer);
    }

    function currentFactory() external view returns (FactoryPin memory) {
        if (suspended) return FactoryPin(address(0), bytes32(0));
        return factories[latestVersion];
    }

    function _validateFactory(Action calldata action) private view {
        if (
            action.version != latestVersion + 1 || action.factory.code.length == 0
                || action.factory.codehash != action.runtimeHash
        ) revert InvalidFactory();
        try IRMTLaunchCurveVersionV2(action.factory).engineVersion{gas: 30_000}() returns (uint32 version) {
            if (version != action.version) revert InvalidFactory();
        } catch {
            revert InvalidFactory();
        }
    }

    function _validateMigrationTemplate(Action calldata action) private view {
        uint32 version = action.version;
        if (
            suspended || version < 3 || version > MAX_CURVE_VERSION || action.factory.code.length == 0
                || action.factory.codehash != action.runtimeHash || migrationTemplates[version].factory != address(0)
                || (version != 3 && migrationTemplates[version - 1].factory == address(0))
        ) revert InvalidFactory();
        IRMTCurveMigrationTemplateV2 template = IRMTCurveMigrationTemplateV2(action.factory);
        try template.fromVersion{gas: 30_000}() returns (uint32 from) {
            if (from != version - 1) revert InvalidFactory();
        } catch {
            revert InvalidFactory();
        }
        try template.toVersion{gas: 30_000}() returns (uint32 to) {
            if (to != version) revert InvalidFactory();
        } catch {
            revert InvalidFactory();
        }
    }

    function _authorize(Action calldata action, bytes calldata first, bytes calldata second)
        private
        view
        returns (bytes32 digest)
    {
        if (action.nonce != nonce || action.signerSetEpoch != signerSetEpoch || block.timestamp > action.deadline) {
            revert InvalidAction();
        }
        digest = actionDigest(action);
        _authorizeSigners(digest, first, second);
    }

    function _authorizeSigners(bytes32 digest, bytes calldata first, bytes calldata second) private view {
        address firstSigner = ECDSA.recover(digest, first);
        address secondSigner = ECDSA.recover(digest, second);
        if (firstSigner == secondSigner || !isSigner(firstSigner) || !isSigner(secondSigner)) {
            revert InvalidSigners();
        }
    }

    function _member(address signer) private view returns (bool) {
        return signer == signerA || signer == signerB || signer == signerC;
    }

    function _eligible(address signer) private view returns (bool) {
        return uint160(signer) > 0xffff && signer.code.length == 0;
    }

    function _validateRotation(SignerRotation calldata rotation) private view {
        if (
            rotation.signerSetEpoch != signerSetEpoch || rotation.nonce != rotationNonce
                || block.timestamp > rotation.deadline || !_member(rotation.departingSigner)
                || !_eligible(rotation.incomingSigner) || _member(rotation.incomingSigner)
        ) revert InvalidRotation();
    }

    function _noticeWindow(uint48 deadline) private view returns (uint48 executableAt, uint48 expiresAt) {
        executableAt = uint48(block.timestamp) + publicationDelay;
        if (deadline < executableAt) revert InvalidAction();
        expiresAt = executableAt + executionWindow;
        if (deadline < expiresAt) expiresAt = deadline;
    }

    function _clearRotation() private {
        delete pendingRotation;
        ++rotationNonce;
    }

    function _empty(Action calldata action) private pure returns (bool) {
        return action.version == 0 && action.factory == address(0) && action.runtimeHash == bytes32(0);
    }

    function _clear() private {
        emit ActionCleared(pending.digest, nonce);
        delete pending;
        ++nonce;
    }
}
