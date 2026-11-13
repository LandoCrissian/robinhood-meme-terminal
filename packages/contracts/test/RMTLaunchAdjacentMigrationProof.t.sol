// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1 as V2Deployer} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveDirectoryV1 as Directory} from "../src/RMTLaunchCurveDirectoryV1.sol";
import {RMTLaunchCurveRevenueLedgerV1 as Ledger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {RMTLaunchCurveTokenV1 as Token} from "../src/RMTLaunchCurveTokenV1.sol";
import {IRMTV4CurveGraduationV1} from "../src/interfaces/IRMTV4CurveGraduationV1.sol";

/// @dev Isolated pre-release template for an adjacent successor with identical launch economics.
contract AdjacentProofCurveV3 is Curve {
    constructor(Curve source)
        Curve(
            source.token(),
            source.creator(),
            source.treasury(),
            source.treasuryShareBps(),
            source.operatingRecipient(),
            source.futureReserveRecipient(),
            source.graduationEngine(),
            source.projectRegistry(),
            source.factory(),
            address(source),
            source.revenueLedger()
        )
    {}

    function executionVersion() public pure override returns (uint32) {
        return 3;
    }
}

contract AdjacentProofV3Deployer {
    function prepare(Curve source, bytes32 salt) external returns (address) {
        require(source.factory() == msg.sender && source.executionVersion() == 2);
        return address(new AdjacentProofCurveV3{salt: keccak256(abi.encode(msg.sender, salt))}(source));
    }
}

/// @dev Standalone development factory with a closed transition set and no graduation dependency.
contract AdjacentProofFactory {
    uint32 public constant engineVersion = 1;
    AdjacentProofRegistry public immutable registry;
    V2Deployer public immutable v2;
    AdjacentProofV3Deployer public immutable v3;
    bytes32 public immutable v2Runtime;
    bytes32 public immutable v3Runtime;
    mapping(address token => address curve) public curveForToken;
    mapping(address token => mapping(uint32 version => address curve)) public candidate;

    error UnsupportedTransition();
    error Unauthorized();
    error BadDeployment();

    constructor(AdjacentProofRegistry registry_, V2Deployer v2_, AdjacentProofV3Deployer v3_) {
        if (block.chainid != 31_337 || address(v2_).code.length == 0 || address(v3_).code.length == 0) {
            revert BadDeployment();
        }
        registry = registry_;
        v2 = v2_;
        v3 = v3_;
        v2Runtime = address(v2_).codehash;
        v3Runtime = address(v3_).codehash;
    }

    function create(address treasury, address operating, address future) external returns (Token token, Curve curve) {
        token = new Token("Adjacent migration proof", "ADJ", 1_000_000 ether);
        curve = new Curve(
            IERC20(address(token)),
            msg.sender,
            treasury,
            2_000,
            operating,
            future,
            IRMTV4CurveGraduationV1(address(0)),
            address(registry),
            address(this),
            address(0),
            Ledger(address(0))
        );
        curveForToken[address(token)] = address(curve);
        require(token.transfer(address(curve), token.totalSupply()));
        registry.register(address(token), curve);
    }

    function prepare(address token, uint32 nextVersion) external returns (Curve next) {
        Curve source = Curve(payable(curveForToken[token]));
        if (
            address(source) == address(0) || !source.active() || source.graduated()
                || nextVersion != source.executionVersion() + 1 || nextVersion > 3
        ) revert UnsupportedTransition();
        address prepared = candidate[token][nextVersion];
        if (prepared != address(0)) return Curve(payable(prepared));
        bytes32 salt = keccak256(abi.encode(token, address(source), nextVersion));
        if (nextVersion == 2 && address(v2).codehash == v2Runtime) {
            prepared = v2.prepare(source, salt);
        } else if (nextVersion == 3 && address(v3).codehash == v3Runtime) {
            prepared = v3.prepare(source, salt);
        } else {
            revert BadDeployment();
        }
        candidate[token][nextVersion] = prepared;
        return Curve(payable(prepared));
    }

    function settle(address token, Curve source, Curve next, uint32 version, bytes32 runtimeHash) external {
        if (msg.sender != address(registry)) revert Unauthorized();
        if (
            curveForToken[token] != address(source) || candidate[token][version] != address(next)
                || version != source.executionVersion() + 1 || version > 3 || address(next).codehash != runtimeHash
        ) revert UnsupportedTransition();
        source.migrateAssets(payable(address(next)), runtimeHash);
        curveForToken[token] = address(next);
    }
}

/// @dev Isolated governance proof. EIP-712 binds each adjacent migration to immutable project and candidate evidence.
contract AdjacentProofRegistry is EIP712, ReentrancyGuard {
    bytes32 private constant MIGRATION_TYPEHASH = keccak256(
        "AdjacentCurveMigration(address token,address source,address successor,uint32 fromVersion,uint32 toVersion,bytes32 runtimeHash,uint64 nonce,uint48 deadline)"
    );
    uint48 public constant delay = 2 days;
    uint48 public constant executionWindow = 7 days;
    Directory public immutable directory;

    struct Project {
        AdjacentProofFactory factory;
        Curve origin;
        Curve active;
        uint32 version;
        uint64 nonce;
    }

    struct Migration {
        Curve source;
        Curve successor;
        uint32 fromVersion;
        uint32 toVersion;
        bytes32 runtimeHash;
        uint48 deadline;
        uint48 executableAt;
    }

    mapping(address token => Project) public project;
    mapping(address token => Migration) public pending;
    mapping(address token => mapping(uint64 index => Migration)) public history;

    error Unauthorized();
    error InvalidTransition();
    error NotExecutable();

    event MigrationScheduled(
        address indexed token, address indexed source, address indexed successor, uint32 version, uint48 executableAt
    );

    constructor(Directory directory_) EIP712("RMT Adjacent Curve Development Proof", "1") {
        directory = directory_;
    }

    function register(address token, Curve origin) external nonReentrant {
        if (directory.suspended() || address(project[token].origin) != address(0)) revert InvalidTransition();
        (address pinned, bytes32 runtimeHash) = directory.factories(1);
        if (msg.sender != pinned || msg.sender.codehash != runtimeHash) revert Unauthorized();
        AdjacentProofFactory factory = AdjacentProofFactory(msg.sender);
        if (
            factory.curveForToken(token) != address(origin) || address(origin.token()) != token
                || origin.factory() != msg.sender || origin.projectRegistry() != address(this) || !origin.active()
                || origin.executionVersion() != 1
        ) revert InvalidTransition();
        project[token] = Project(factory, origin, origin, 1, 0);
    }

    function propose(address token, Curve successor, bytes32 runtimeHash, uint48 deadline) external nonReentrant {
        Project storage item = project[token];
        if (address(item.active) == address(0) || item.active.creator() != msg.sender) revert Unauthorized();
        Migration memory action =
            Migration(item.active, successor, item.version, item.version + 1, runtimeHash, deadline, 0);
        if (
            directory.suspended() || address(pending[token].successor) != address(0)
                || deadline < block.timestamp + delay || deadline > block.timestamp + 30 days
                || !_valid(item, token, action)
        ) revert InvalidTransition();
        pending[token] = action;
    }

    function digest(address token) public view returns (bytes32) {
        Migration memory action = pending[token];
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MIGRATION_TYPEHASH,
                    token,
                    action.source,
                    action.successor,
                    action.fromVersion,
                    action.toVersion,
                    action.runtimeHash,
                    project[token].nonce,
                    action.deadline
                )
            )
        );
    }

    function schedule(address token, bytes calldata first, bytes calldata second) external nonReentrant {
        Migration storage action = pending[token];
        uint48 executableAt = uint48(block.timestamp) + delay;
        if (
            directory.suspended() || action.executableAt != 0 || executableAt > action.deadline
                || !_valid(project[token], token, action)
        ) revert InvalidTransition();
        bytes32 signed = digest(token);
        address a = ECDSA.recover(signed, first);
        address b = ECDSA.recover(signed, second);
        if (a == b || !_signer(a) || !_signer(b)) revert Unauthorized();
        action.executableAt = executableAt;
        emit MigrationScheduled(
            token, address(action.source), address(action.successor), action.toVersion, executableAt
        );
    }

    function execute(address token) external nonReentrant {
        Project storage item = project[token];
        Migration memory action = pending[token];
        if (
            directory.suspended() || action.executableAt == 0 || block.timestamp < action.executableAt
                || block.timestamp > action.deadline || block.timestamp > action.executableAt + executionWindow
                || !_valid(item, token, action)
        ) revert NotExecutable();
        item.factory.settle(token, action.source, action.successor, action.toVersion, action.runtimeHash);
        if (
            action.source.active() || action.source.migratedTo() != address(action.successor)
                || !action.successor.active() || item.factory.curveForToken(token) != address(action.successor)
        ) revert InvalidTransition();
        item.active = action.successor;
        item.version = action.toVersion;
        history[token][++item.nonce] = action;
        delete pending[token];
    }

    function _valid(Project storage item, address token, Migration memory action) private view returns (bool) {
        Curve source = action.source;
        Curve successor = action.successor;
        if (
            address(source) == address(0) || address(successor).code.length == 0
                || address(successor).codehash != action.runtimeHash || address(item.active) != address(source)
                || item.version != action.fromVersion || action.toVersion != action.fromVersion + 1
                || action.toVersion > 3 || item.factory.curveForToken(token) != address(source)
                || item.factory.candidate(token, action.toVersion) != address(successor)
        ) return false;
        return source.active() && !source.graduated() && !successor.active() && !successor.graduated()
            && source.executionVersion() == action.fromVersion && successor.executionVersion() == action.toVersion
            && successor.migrationSource() == address(source)
            && source.migrationCommitment() == successor.migrationCommitment();
    }

    function _signer(address account) private view returns (bool) {
        return account == directory.signerA() || account == directory.signerB() || account == directory.signerC();
    }
}

contract RMTLaunchAdjacentMigrationProofTest is Test {
    address private constant CREATOR = address(0x301);
    address private constant TREASURY = address(0x302);
    address private constant OPERATING = address(0x303);
    address private constant FUTURE = address(0x304);
    address private constant HOLDER = address(0x305);
    address private constant STRANGER = address(0x306);

    Directory private directory;
    AdjacentProofRegistry private registry;
    AdjacentProofFactory private factory;
    Token private token;
    Curve private origin;
    Ledger private ledger;

    function setUp() external {
        vm.chainId(31_337);
        vm.warp(200 days);
        directory = new Directory(vm.addr(1), vm.addr(2), vm.addr(3));
        registry = new AdjacentProofRegistry(directory);
        factory = new AdjacentProofFactory(registry, new V2Deployer(), new AdjacentProofV3Deployer());
        Directory.Action memory publication = Directory.Action(
            Directory.ActionKind.Publish,
            0,
            1,
            address(factory),
            address(factory).codehash,
            uint48(block.timestamp + 4 days)
        );
        bytes32 digest = directory.actionDigest(publication);
        directory.schedule(publication, _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(publication);
        vm.prank(CREATOR);
        (token, origin) = factory.create(TREASURY, OPERATING, FUTURE);
        ledger = origin.revenueLedger();
        vm.deal(HOLDER, 5 ether);
    }

    function testGovernedV1ToV2ToV3PreservesAssetsCreditsAndTradeExits() external {
        vm.prank(HOLDER);
        origin.buy{value: 0.25 ether}(1, block.timestamp);
        vm.expectRevert(AdjacentProofFactory.UnsupportedTransition.selector);
        factory.prepare(address(token), 3);
        Curve v2 = factory.prepare(address(token), 2);
        bytes32 firstDigest = _advance(origin, v2);

        vm.prank(HOLDER);
        v2.buy{value: 0.15 ether}(1, block.timestamp);
        Curve v3 = factory.prepare(address(token), 3);
        bytes32 before = _snapshot(v2);
        vm.prank(CREATOR);
        registry.propose(address(token), v3, address(v3).codehash, uint48(block.timestamp + 4 days));
        vm.expectRevert(AdjacentProofRegistry.Unauthorized.selector);
        registry.schedule(address(token), _sign(firstDigest, 1), _sign(firstDigest, 2));
        vm.expectRevert(AdjacentProofFactory.Unauthorized.selector);
        factory.settle(address(token), v2, v3, 3, address(v3).codehash);
        vm.prank(CREATOR);
        vm.expectRevert(AdjacentProofRegistry.InvalidTransition.selector);
        registry.propose(address(token), v3, address(v3).codehash, uint48(block.timestamp + 4 days));
        _scheduleAndExecute(true);
        assertEq(_snapshot(v3), before);
        _assertTransition(v2, v3, 3, 2);
        (, Curve registeredOrigin, Curve active, uint32 version, uint64 nonce) = registry.project(address(token));
        assertEq(address(registeredOrigin), address(origin));
        assertEq(address(active), address(v3));
        assertEq(version, 3);
        assertEq(nonce, 2);
        vm.expectRevert(AdjacentProofFactory.UnsupportedTransition.selector);
        factory.prepare(address(token), 4);
        uint256 holderTokens = token.balanceOf(HOLDER);
        (uint256 payout,,) = v3.quoteSell(holderTokens);
        vm.startPrank(HOLDER);
        token.approve(address(v3), holderTokens);
        assertEq(v3.sell(holderTokens, payout, block.timestamp), payout);
        vm.stopPrank();
        assertEq(v3.backingReserve(), 0);
        uint256 creatorCredit = ledger.claimable(CREATOR);
        uint256 creatorBefore = CREATOR.balance;
        vm.prank(CREATOR);
        assertEq(ledger.claim(), creatorCredit);
        assertEq(CREATOR.balance, creatorBefore + creatorCredit);
    }

    function _advance(Curve source, Curve next) private returns (bytes32 signed) {
        bytes32 before = _snapshot(source);
        vm.prank(CREATOR);
        registry.propose(address(token), next, address(next).codehash, uint48(block.timestamp + 4 days));
        signed = registry.digest(address(token));
        _scheduleAndExecute(false);
        assertEq(_snapshot(next), before);
        _assertTransition(source, next, 2, 1);
    }

    function _scheduleAndExecute(bool exerciseRollback) private {
        bytes32 signed = registry.digest(address(token));
        bytes memory first = _sign(signed, 1);
        vm.expectRevert(AdjacentProofRegistry.Unauthorized.selector);
        registry.schedule(address(token), first, first);
        (Curve source, Curve successor,, uint32 version,,,) = registry.pending(address(token));
        vm.expectEmit(true, true, true, true, address(registry));
        emit AdjacentProofRegistry.MigrationScheduled(
            address(token), address(source), address(successor), version, uint48(block.timestamp + registry.delay())
        );
        registry.schedule(address(token), first, _sign(signed, 2));
        vm.expectRevert(AdjacentProofRegistry.NotExecutable.selector);
        registry.execute(address(token));
        vm.warp(block.timestamp + registry.delay());
        if (exerciseRollback) {
            bytes32 before = _snapshot(source);
            uint256 inventory = token.balanceOf(address(source));
            vm.mockCallRevert(
                address(successor),
                abi.encodeCall(Curve.acceptMigration, (source.sold(), source.backingReserve(), inventory)),
                abi.encodeWithSignature("Error(string)", "interrupted acceptance")
            );
            vm.expectRevert(bytes("interrupted acceptance"));
            registry.execute(address(token));
            vm.clearMockedCalls();
            assertEq(_snapshot(source), before);
            assertTrue(source.active());
            assertEq(source.migratedTo(), address(0));
            assertFalse(successor.active());
            assertEq(address(successor).balance, 0);
            assertEq(token.balanceOf(address(successor)), 0);
            assertEq(factory.curveForToken(address(token)), address(source));
            assertEq(ledger.activeCurve(), address(source));
            (,, Curve active, uint32 current, uint64 nonce) = registry.project(address(token));
            assertEq(address(active), address(source));
            assertEq(current, version - 1);
            assertEq(nonce, 1);
        }
        vm.prank(STRANGER);
        registry.execute(address(token));
    }

    function _assertTransition(Curve source, Curve next, uint32 version, uint64 historyIndex) private {
        assertFalse(source.active());
        assertEq(source.migratedTo(), address(next));
        assertEq(source.backingReserve(), 0);
        assertEq(address(source).balance, 0);
        assertEq(token.balanceOf(address(source)), 0);
        assertTrue(next.active());
        assertEq(next.executionVersion(), version);
        assertEq(next.migrationSource(), address(source));
        assertEq(next.migrationCommitment(), origin.migrationCommitment());
        assertEq(address(next.revenueLedger()), address(ledger));
        assertEq(ledger.activeCurve(), address(next));
        assertEq(factory.curveForToken(address(token)), address(next));
        (Curve prior, Curve recorded, uint32 from, uint32 to, bytes32 runtimeHash,,) =
            registry.history(address(token), historyIndex);
        assertEq(address(prior), address(source));
        assertEq(address(recorded), address(next));
        assertEq(from, version - 1);
        assertEq(to, version);
        assertEq(runtimeHash, address(next).codehash);
        vm.prank(HOLDER);
        vm.expectRevert(Curve.CurveClosed.selector);
        source.buy{value: 0.01 ether}(1, block.timestamp);
    }

    function _snapshot(Curve curve) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                curve.sold(),
                curve.backingReserve(),
                address(curve).balance,
                token.balanceOf(address(curve)),
                token.totalSupply(),
                token.balanceOf(HOLDER),
                address(ledger).balance,
                ledger.totalAccrued(),
                ledger.totalClaimed(),
                ledger.claimable(CREATOR),
                ledger.claimable(TREASURY),
                ledger.claimable(OPERATING),
                ledger.claimable(FUTURE)
            )
        );
    }

    function _sign(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
