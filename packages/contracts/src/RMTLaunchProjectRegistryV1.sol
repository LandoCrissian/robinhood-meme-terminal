// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTLaunchCurveDirectoryV1 as Directory, IRMTLaunchCurveVersion} from "./RMTLaunchCurveDirectoryV1.sol";

interface IRegisteredCurveV1 {
    function factory() external view returns (address);
    function token() external view returns (address);
    function creator() external view returns (address);
    function projectRegistry() external view returns (address);
    function graduated() external view returns (bool);
    function executionVersion() external view returns (uint32);
    function executionEngine() external view returns (address);
    function migrateExecution(address engine, bytes32 expectedRuntimeHash) external;
}

interface IRegisteredCurveFactoryV1 is IRMTLaunchCurveVersion {
    function curveForToken(address token) external view returns (address);
}

/// @notice Permanent project identity and append-only migration evidence.
contract RMTLaunchProjectRegistryV1 is EIP712, ReentrancyGuard {
    uint48 public constant migrationDelay = 2 days;
    uint48 public constant migrationWindow = 7 days;
    bytes32 public constant MIGRATION_TYPEHASH = keccak256(
        "Migration(address token,uint64 nonce,uint32 fromVersion,address nextEngine,bytes32 runtimeHash,uint48 deadline)"
    );

    struct Project {
        address factory;
        address curve;
        uint32 version;
        address engine;
        uint64 migrations;
    }

    struct Migration {
        uint32 fromVersion;
        uint32 toVersion;
        address previousEngine;
        address nextEngine;
        bytes32 runtimeHash;
        uint64 effectiveBlock;
        uint48 effectiveAt;
    }

    struct Proposal {
        address nextEngine;
        bytes32 runtimeHash;
        uint48 deadline;
        uint48 executableAt;
        uint48 expiresAt;
    }

    Directory public immutable directory;
    mapping(address token => Project) public project;
    mapping(address token => mapping(uint64 index => Migration)) public migration;
    mapping(address token => Proposal) public proposal;
    mapping(address token => uint64) public migrationNonce;

    error InvalidDirectory();
    error InvalidProject();
    error InvalidProposal();
    error Unauthorized();
    error NotExecutable();

    event ProjectRegistered(address indexed token, address indexed factory, address indexed curve, uint32 version);
    event MigrationProposed(
        address indexed token, uint64 indexed nonce, address indexed nextEngine, bytes32 runtimeHash
    );
    event MigrationScheduled(address indexed token, uint64 indexed nonce, uint48 executableAt, uint48 expiresAt);
    event MigrationCleared(address indexed token, uint64 indexed nonce);
    event ProjectMigrated(address indexed token, uint64 indexed index, address indexed nextEngine, uint32 toVersion);

    constructor(Directory directory_) EIP712("RMT Launch Project Registry", "1") {
        if (address(directory_).code.length == 0) revert InvalidDirectory();
        directory = directory_;
    }

    function register(address token, address curve) external nonReentrant {
        if (
            directory.suspended() || token.code.length == 0 || curve.code.length == 0
                || project[token].curve != address(0)
        ) {
            revert InvalidProject();
        }
        IRegisteredCurveFactoryV1 factory = IRegisteredCurveFactoryV1(msg.sender);
        (address approved, bytes32 runtimeHash) = directory.factories(factory.engineVersion());
        IRegisteredCurveV1 market = IRegisteredCurveV1(curve);
        uint32 version = market.executionVersion();
        address engine = market.executionEngine();
        if (
            approved != msg.sender || msg.sender.codehash != runtimeHash || factory.curveForToken(token) != curve
                || market.factory() != msg.sender || market.token() != token || market.creator() == address(0)
                || market.projectRegistry() != address(this) || version == 0 || engine == address(0)
        ) revert InvalidProject();
        project[token] = Project(msg.sender, curve, version, engine, 0);
        emit ProjectRegistered(token, msg.sender, curve, version);
    }

    function proposeMigration(address token, address nextEngine, bytes32 runtimeHash, uint48 deadline)
        external
        nonReentrant
    {
        Project storage item = project[token];
        IRegisteredCurveV1 market = IRegisteredCurveV1(item.curve);
        if (item.curve == address(0) || market.creator() != msg.sender) revert Unauthorized();
        if (
            directory.suspended() || market.graduated() || proposal[token].nextEngine != address(0)
                || nextEngine == item.engine || nextEngine.code.length == 0 || nextEngine.codehash != runtimeHash
                || deadline < block.timestamp + migrationDelay || deadline > block.timestamp + 30 days
        ) revert InvalidProposal();
        proposal[token] = Proposal(nextEngine, runtimeHash, deadline, 0, 0);
        emit MigrationProposed(token, migrationNonce[token], nextEngine, runtimeHash);
    }

    function migrationDigest(address token) public view returns (bytes32) {
        Proposal storage next = proposal[token];
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MIGRATION_TYPEHASH,
                    token,
                    migrationNonce[token],
                    project[token].version,
                    next.nextEngine,
                    next.runtimeHash,
                    next.deadline
                )
            )
        );
    }

    function scheduleMigration(address token, bytes calldata first, bytes calldata second) external nonReentrant {
        Proposal storage next = proposal[token];
        uint48 executableAt = uint48(block.timestamp) + migrationDelay;
        if (
            directory.suspended() || next.nextEngine == address(0) || next.executableAt != 0
                || executableAt > next.deadline || next.nextEngine.codehash != next.runtimeHash
                || IRegisteredCurveV1(project[token].curve).graduated()
        ) revert InvalidProposal();
        bytes32 digest = migrationDigest(token);
        address a = ECDSA.recover(digest, first);
        address b = ECDSA.recover(digest, second);
        if (a == b || !_signer(a) || !_signer(b)) revert Unauthorized();
        next.executableAt = executableAt;
        uint48 latest = executableAt + migrationWindow;
        next.expiresAt = latest < next.deadline ? latest : next.deadline;
        emit MigrationScheduled(token, migrationNonce[token], executableAt, next.expiresAt);
    }

    function executeMigration(address token) external nonReentrant {
        Project storage item = project[token];
        Proposal memory next = proposal[token];
        if (
            directory.suspended() || next.executableAt == 0 || block.timestamp < next.executableAt
                || block.timestamp > next.expiresAt || next.nextEngine.codehash != next.runtimeHash
        ) revert NotExecutable();
        IRegisteredCurveV1 market = IRegisteredCurveV1(item.curve);
        if (market.graduated() || market.executionVersion() != item.version || market.executionEngine() != item.engine)
        {
            revert NotExecutable();
        }
        uint32 nextVersion = item.version + 1;
        market.migrateExecution(next.nextEngine, next.runtimeHash);
        if (market.executionVersion() != nextVersion || market.executionEngine() != next.nextEngine) {
            revert NotExecutable();
        }
        uint64 index = ++item.migrations;
        migration[token][index] = Migration(
            item.version,
            nextVersion,
            item.engine,
            next.nextEngine,
            next.runtimeHash,
            uint64(block.number),
            uint48(block.timestamp)
        );
        item.version = nextVersion;
        item.engine = next.nextEngine;
        _clear(token);
        emit ProjectMigrated(token, index, next.nextEngine, nextVersion);
    }

    function cancelMigration(address token) external nonReentrant {
        if (
            proposal[token].nextEngine == address(0) || IRegisteredCurveV1(project[token].curve).creator() != msg.sender
        ) {
            revert Unauthorized();
        }
        _clear(token);
    }

    function clearExpiredMigration(address token) external nonReentrant {
        Proposal memory next = proposal[token];
        uint48 expiry = next.expiresAt == 0 ? next.deadline : next.expiresAt;
        if (expiry == 0 || block.timestamp <= expiry) revert NotExecutable();
        _clear(token);
    }

    function _clear(address token) private {
        delete proposal[token];
        emit MigrationCleared(token, migrationNonce[token]++);
    }

    function _signer(address account) private view returns (bool) {
        return account == directory.signerA() || account == directory.signerB() || account == directory.signerC();
    }
}
