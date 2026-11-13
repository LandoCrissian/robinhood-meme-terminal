// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IRMTLaunchCurveVersion {
    function engineVersion() external view returns (uint32);
}

/// @notice Non-custodial discovery authority for new curve versions.
/// @dev The directory never owns a launch and has no call path into a launch.
contract RMTLaunchCurveDirectoryV1 is EIP712 {
    uint48 public constant publicationDelay = 2 days;
    uint48 public constant executionWindow = 7 days;
    bytes32 public constant ACTION_TYPEHASH =
        keccak256("Action(uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint48 deadline)");

    enum ActionKind {
        Publish,
        Resume,
        Suspend,
        Cancel
    }

    struct Action {
        ActionKind kind;
        uint64 nonce;
        uint32 version;
        address factory;
        bytes32 runtimeHash;
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

    address public immutable signerA;
    address public immutable signerB;
    address public immutable signerC;

    uint64 public nonce;
    uint32 public latestVersion;
    bool public suspended;
    Pending public pending;
    mapping(uint32 => FactoryPin) public factories;

    error InvalidSigners();
    error InvalidAction();
    error InvalidFactory();
    error PendingAction();
    error NotExecutable();

    event ActionScheduled(bytes32 indexed digest, uint64 indexed nonce, uint48 executableAt, uint48 expiresAt);
    event ActionCleared(bytes32 indexed digest, uint64 indexed nonce);
    event FactoryPublished(uint32 indexed version, address indexed factory, bytes32 runtimeHash);
    event DiscoverySuspended(bool suspended);

    constructor(address signerA_, address signerB_, address signerC_) EIP712("RMT Launch Curve Directory", "1") {
        if (
            signerA_ == address(0) || signerB_ == address(0) || signerC_ == address(0) || signerA_ == signerB_
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
                    action.deadline
                )
            )
        );
    }

    function schedule(Action calldata action, bytes calldata first, bytes calldata second) external {
        if (pending.digest != bytes32(0)) revert PendingAction();
        if (action.kind == ActionKind.Publish) _validateFactory(action);
        else if (action.kind != ActionKind.Resume || !suspended || !_empty(action)) revert InvalidAction();

        bytes32 digest = _authorize(action, first, second);
        uint48 executableAt = uint48(block.timestamp) + publicationDelay;
        if (action.deadline < executableAt) revert InvalidAction();
        uint48 expiresAt = executableAt + executionWindow;
        if (action.deadline < expiresAt) expiresAt = action.deadline;
        pending = Pending(digest, executableAt, expiresAt);
        emit ActionScheduled(digest, action.nonce, executableAt, expiresAt);
    }

    function execute(Action calldata action) external {
        Pending memory next = pending;
        if (
            next.digest == bytes32(0) || next.digest != actionDigest(action) || action.nonce != nonce
                || block.timestamp < next.executableAt || block.timestamp > next.expiresAt
        ) revert NotExecutable();
        if (action.kind == ActionKind.Publish) {
            _validateFactory(action);
            latestVersion = action.version;
            factories[action.version] = FactoryPin(action.factory, action.runtimeHash);
            emit FactoryPublished(action.version, action.factory, action.runtimeHash);
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

    function currentFactory() external view returns (FactoryPin memory) {
        if (suspended) return FactoryPin(address(0), bytes32(0));
        return factories[latestVersion];
    }

    function _validateFactory(Action calldata action) private view {
        if (
            action.version != latestVersion + 1 || action.factory.code.length == 0
                || action.factory.codehash != action.runtimeHash
        ) revert InvalidFactory();
        try IRMTLaunchCurveVersion(action.factory).engineVersion{gas: 30_000}() returns (uint32 version) {
            if (version != action.version) revert InvalidFactory();
        } catch {
            revert InvalidFactory();
        }
    }

    function _authorize(Action calldata action, bytes calldata first, bytes calldata second)
        private
        view
        returns (bytes32 digest)
    {
        if (action.nonce != nonce || block.timestamp > action.deadline) revert InvalidAction();
        digest = actionDigest(action);
        address firstSigner = ECDSA.recover(digest, first);
        address secondSigner = ECDSA.recover(digest, second);
        if (firstSigner == secondSigner || !_isSigner(firstSigner) || !_isSigner(secondSigner)) {
            revert InvalidSigners();
        }
    }

    function _isSigner(address signer) private view returns (bool) {
        return signer == signerA || signer == signerB || signer == signerC;
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
