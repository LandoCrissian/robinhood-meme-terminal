// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTLaunchCurveDirectoryV2 as Directory} from "../src/RMTLaunchCurveDirectoryV2.sol";
import {RMTLaunchProjectRegistryV2 as Registry} from "../src/RMTLaunchProjectRegistryV2.sol";

// These fixtures isolate the registry authorization boundary. Asset settlement is exercised on the 4663 fork.
contract RegistryEpochToken {}

contract RegistryEpochCurve {
    address public immutable factory;
    address public immutable token;
    address public immutable creator;
    address public immutable projectRegistry;
    address public immutable migrationSource;
    uint32 public immutable executionVersion;
    bytes32 public constant migrationCommitment = keccak256("epoch fixture: immutable economics");
    bool public constant graduated = false;
    bool public active;
    address public migratedTo;

    constructor(address token_, address creator_, address registry_, address source_, uint32 version_) {
        factory = msg.sender;
        token = token_;
        creator = creator_;
        projectRegistry = registry_;
        migrationSource = source_;
        executionVersion = version_;
        active = source_ == address(0);
    }

    function executionEngine() external view returns (address) {
        return address(this);
    }

    function transferActivity(address successor) external {
        require(msg.sender == factory && active);
        active = false;
        migratedTo = successor;
    }

    function acceptActivity() external {
        require(msg.sender == factory && !active);
        active = true;
    }
}

contract RegistryEpochFactory {
    uint32 public constant engineVersion = 1;
    Registry private immutable registry;
    Directory private immutable directory;
    mapping(address token => address curve) public curveForToken;
    mapping(address token => mapping(uint32 version => address curve)) public migrationCandidate;
    bytes private settlementCallback;

    constructor(Registry registry_, Directory directory_) {
        registry = registry_;
        directory = directory_;
    }

    function create(address creator) external returns (address token, address origin, address nextEngine) {
        token = address(new RegistryEpochToken());
        origin = address(new RegistryEpochCurve(token, creator, address(registry), address(0), 1));
        nextEngine = address(new RegistryEpochCurve(token, creator, address(registry), origin, 2));
        curveForToken[token] = origin;
        migrationCandidate[token][2] = nextEngine;
        registry.register(token, origin);
    }

    function successorDeployer() external view returns (address) {
        return address(this);
    }

    function successorDeployerRuntimeHash() external view returns (bytes32) {
        return address(this).codehash;
    }

    function setSettlementCallback(bytes calldata callback) external {
        settlementCallback = callback;
    }

    function executeMigration(address token, address nextEngine, bytes32 runtimeHash) external {
        require(msg.sender == address(registry) && nextEngine.codehash == runtimeHash);
        RegistryEpochCurve(curveForToken[token]).transferActivity(nextEngine);
        RegistryEpochCurve(nextEngine).acceptActivity();
        curveForToken[token] = nextEngine;
        if (settlementCallback.length != 0) {
            (bool ok,) = address(directory).call(settlementCallback);
            require(ok, "fixture rotation callback must succeed");
        }
    }
}

contract RMTLaunchProjectRegistryV2Test is Test {
    uint256 private constant SIGNER_A_KEY = 103;
    uint256 private constant SIGNER_B_KEY = 104;
    uint256 private constant SIGNER_C_KEY = 105;
    uint256 private constant INCOMING_KEY = 106;
    address private constant CREATOR = address(0x31101);
    address private constant RELAY = address(0x31102);

    Directory private directory;
    Registry private registry;
    RegistryEpochFactory private factory;
    address private token;
    address private origin;
    address private nextEngine;

    function setUp() external {
        vm.chainId(31_337);
        vm.warp(100 days);
        directory = new Directory(vm.addr(SIGNER_A_KEY), vm.addr(SIGNER_B_KEY), vm.addr(SIGNER_C_KEY));
        registry = new Registry(directory);
        factory = new RegistryEpochFactory(registry, directory);
        Directory.Action memory publication =
            _directoryAction(Directory.ActionKind.Publish, 1, address(factory), address(factory).codehash);
        bytes32 digest = directory.actionDigest(publication);
        directory.schedule(publication, _sign(digest, SIGNER_A_KEY), _sign(digest, SIGNER_B_KEY));
        vm.warp(vm.getBlockTimestamp() + directory.publicationDelay());
        directory.execute(publication);
        (token, origin, nextEngine) = factory.create(CREATOR);
    }

    function testRotationClearsOnlyApprovalAndRestartsNotice() external {
        uint48 deadline = _propose(12 days);
        (bytes memory oldFirst, bytes memory oldSecond) = _approvals(SIGNER_B_KEY, SIGNER_C_KEY);
        registry.scheduleMigration(token, oldFirst, oldSecond);
        _assertProposal(deadline, uint48(vm.getBlockTimestamp() + 2 days), uint48(vm.getBlockTimestamp() + 9 days), 1);
        _rotate(SIGNER_A_KEY, INCOMING_KEY);

        // The scheduled execution was already mature when the rotation happened.
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(token);
        _assertOrigin();
        vm.prank(RELAY);
        registry.clearStaleMigration(token);
        assertEq(registry.migrationNonce(token), 1);
        _assertProposal(deadline, 0, 0, 0);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.clearStaleMigration(token);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(token, oldFirst, oldSecond);

        (bytes memory removed, bytes memory current) = _approvals(SIGNER_A_KEY, SIGNER_B_KEY);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(token, removed, current);
        _schedule(INCOMING_KEY, SIGNER_B_KEY);
        _assertProposal(deadline, uint48(vm.getBlockTimestamp() + 2 days), uint48(vm.getBlockTimestamp() + 9 days), 2);
        vm.warp(vm.getBlockTimestamp() + 2 days - 1);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(token);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(RELAY);
        registry.executeMigration(token);
        assertEq(registry.originCurve(token), origin);
        assertEq(factory.curveForToken(token), nextEngine);
        assertEq(registry.migrationNonce(token), 2);
        (address factory_, address currentCurve, uint32 version, address engine, uint64 count) = registry.project(token);
        assertEq(factory_, address(factory));
        assertEq(currentCurve, nextEngine);
        assertEq(engine, nextEngine);
        assertEq(version, 2);
        assertEq(count, 1);
    }

    function testUnscheduledSignaturesCannotReplayAfterRemovingAndReaddingSigner() external {
        _propose(16 days);
        (bytes memory originalA, bytes memory originalB) = _approvals(SIGNER_A_KEY, SIGNER_B_KEY);
        _rotate(SIGNER_A_KEY, INCOMING_KEY);
        _rotate(INCOMING_KEY, SIGNER_A_KEY);
        assertTrue(directory.isSigner(vm.addr(SIGNER_A_KEY)));
        assertEq(directory.signerSetEpoch(), 3);
        assertEq(registry.migrationNonce(token), 0);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(token, originalA, originalB);
        _schedule(SIGNER_A_KEY, SIGNER_B_KEY);
    }

    function testStaleScheduleNeverExtendsCreatorDeadlineAndAnyoneCanClearExpiry() external {
        uint48 deadline = _propose(3 days);
        _schedule(SIGNER_A_KEY, SIGNER_B_KEY);
        _rotate(SIGNER_A_KEY, INCOMING_KEY);
        vm.prank(RELAY);
        registry.clearStaleMigration(token);
        _assertProposal(deadline, 0, 0, 0);
        bytes32 digest = registry.migrationDigest(token);
        bytes memory incoming = _sign(digest, INCOMING_KEY);
        bytes memory current = _sign(digest, SIGNER_B_KEY);
        vm.expectRevert(Registry.InvalidProposal.selector);
        registry.scheduleMigration(token, incoming, current);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.clearExpiredMigration(token);
        vm.warp(deadline + 1);
        vm.prank(RELAY);
        registry.clearExpiredMigration(token);
        (address candidate,,,,,) = registry.proposal(token);
        assertEq(candidate, address(0));
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.proposeMigration(token, nextEngine, nextEngine.codehash, uint48(vm.getBlockTimestamp() + 4 days));
        _propose(4 days);
        _schedule(INCOMING_KEY, SIGNER_B_KEY);
    }

    function testObsoleteExecutionWindowCannotEraseUnexpiredCreatorConsent() external {
        uint48 deadline = _propose(20 days);
        _schedule(SIGNER_A_KEY, SIGNER_B_KEY);
        _rotate(SIGNER_A_KEY, INCOMING_KEY);
        vm.warp(vm.getBlockTimestamp() + 8 days);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.clearExpiredMigration(token);
        registry.clearStaleMigration(token);
        _assertProposal(deadline, 0, 0, 0);
        _schedule(INCOMING_KEY, SIGNER_B_KEY);
    }

    function testCancelledCreatorConsentCannotBeReplayedAgainstIdenticalTerms() external {
        uint48 deadline = _propose(12 days);
        (bytes memory originalA, bytes memory originalB) = _approvals(SIGNER_A_KEY, SIGNER_B_KEY);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.cancelMigration(token);
        vm.prank(CREATOR);
        registry.cancelMigration(token);
        vm.prank(CREATOR);
        registry.proposeMigration(token, nextEngine, nextEngine.codehash, deadline);
        assertEq(registry.migrationNonce(token), 1);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(token, originalA, originalB);
        _schedule(SIGNER_A_KEY, SIGNER_B_KEY);
    }

    function testRotationWhileSuspendedRequiresDelayedResumeAndFreshMigrationNotice() external {
        uint48 deadline = _propose(16 days);
        _schedule(SIGNER_A_KEY, SIGNER_B_KEY);
        Directory.Action memory suspension = _directoryAction(Directory.ActionKind.Suspend, 0, address(0), bytes32(0));
        bytes32 suspendDigest = directory.actionDigest(suspension);
        directory.suspend(suspension, _sign(suspendDigest, SIGNER_B_KEY), _sign(suspendDigest, SIGNER_C_KEY));
        _rotate(SIGNER_A_KEY, INCOMING_KEY);
        assertTrue(directory.suspended());
        registry.clearStaleMigration(token);
        _assertProposal(deadline, 0, 0, 0);
        (bytes memory first, bytes memory second) = _approvals(INCOMING_KEY, SIGNER_B_KEY);
        vm.expectRevert(Registry.InvalidProposal.selector);
        registry.scheduleMigration(token, first, second);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(token);
        _assertOrigin();
        Directory.Action memory resume = _directoryAction(Directory.ActionKind.Resume, 0, address(0), bytes32(0));
        bytes32 resumeDigest = directory.actionDigest(resume);
        directory.schedule(resume, _sign(resumeDigest, INCOMING_KEY), _sign(resumeDigest, SIGNER_B_KEY));
        vm.warp(vm.getBlockTimestamp() + directory.publicationDelay());
        directory.execute(resume);
        registry.scheduleMigration(token, first, second);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(token);
        vm.warp(vm.getBlockTimestamp() + registry.migrationDelay());
        registry.executeMigration(token);
        assertEq(factory.curveForToken(token), nextEngine);
    }

    function testSettlementCannotCommitIfFixtureExecutesMatureRotationInCallback() external {
        uint48 deadline = _propose(12 days);
        _schedule(SIGNER_B_KEY, SIGNER_C_KEY);
        Directory.SignerRotation memory rotation = _scheduleRotation(SIGNER_A_KEY, INCOMING_KEY);
        factory.setSettlementCallback(abi.encodeCall(Directory.executeSignerRotation, (rotation)));
        vm.warp(vm.getBlockTimestamp() + directory.publicationDelay());

        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(token);
        assertEq(directory.signerSetEpoch(), 1);
        assertTrue(directory.isSigner(vm.addr(SIGNER_A_KEY)));
        assertEq(registry.migrationNonce(token), 0);
        _assertProposal(deadline, uint48(vm.getBlockTimestamp()), uint48(vm.getBlockTimestamp() + 7 days), 1);
        _assertOrigin();

        factory.setSettlementCallback("");
        registry.executeMigration(token);
        directory.executeSignerRotation(rotation);
        assertEq(directory.signerSetEpoch(), 2);
        assertEq(factory.curveForToken(token), nextEngine);
    }

    function testDigestBindsSignerEpochRegistryChainAndCreatorProposal() external {
        uint48 deadline = _propose(12 days);
        bytes32 typehash = keccak256(
            "CurveAssetMigration(address token,address sourceCurve,uint64 nonce,uint32 fromVersion,address nextCurve,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)"
        );
        assertEq(registry.MIGRATION_TYPEHASH(), typehash);
        bytes32 messageHash = keccak256(
            abi.encode(
                typehash, token, origin, uint64(0), uint32(1), nextEngine, nextEngine.codehash, uint64(1), deadline
            )
        );
        bytes32 digest = _typedDigest(address(registry), block.chainid, messageHash);
        assertEq(registry.migrationDigest(token), digest);
        bytes32 otherRegistry = _typedDigest(address(0x31103), block.chainid, messageHash);
        bytes32 otherChain = _typedDigest(address(registry), 4_663, messageHash);
        _expectUnauthorized(otherRegistry, SIGNER_A_KEY, SIGNER_B_KEY);
        _expectUnauthorized(otherChain, SIGNER_A_KEY, SIGNER_B_KEY);
        _expectUnauthorized(digest, SIGNER_A_KEY, SIGNER_A_KEY);
        vm.etch(vm.addr(SIGNER_A_KEY), hex"00");
        _expectUnauthorized(digest, SIGNER_A_KEY, SIGNER_B_KEY);
        vm.etch(vm.addr(SIGNER_A_KEY), "");
        _schedule(SIGNER_A_KEY, SIGNER_B_KEY);
    }

    function _expectUnauthorized(bytes32 digest, uint256 firstKey, uint256 secondKey) private {
        bytes memory first = _sign(digest, firstKey);
        bytes memory second = _sign(digest, secondKey);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(token, first, second);
    }

    function _typedDigest(address verifyingContract, uint256 chainId, bytes32 messageHash)
        private
        pure
        returns (bytes32)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("RMT Launch Project Registry"),
                keccak256("3"),
                chainId,
                verifyingContract
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, messageHash));
    }

    function _assertOrigin() private view {
        assertEq(factory.curveForToken(token), origin);
        assertTrue(RegistryEpochCurve(origin).active());
        assertFalse(RegistryEpochCurve(nextEngine).active());
    }

    function _assertProposal(uint48 deadline, uint48 executableAt, uint48 expiresAt, uint64 epoch) private view {
        (
            address candidate,
            bytes32 runtimeHash,
            uint48 expiresConsent,
            uint48 allowedAt,
            uint48 expiresApproval,
            uint64 signerEpoch
        ) = registry.proposal(token);
        assertEq(candidate, nextEngine);
        assertEq(runtimeHash, nextEngine.codehash);
        assertEq(expiresConsent, deadline);
        assertEq(allowedAt, executableAt);
        assertEq(expiresApproval, expiresAt);
        assertEq(signerEpoch, epoch);
    }

    function _directoryAction(Directory.ActionKind kind, uint32 version, address target, bytes32 runtimeHash)
        private
        view
        returns (Directory.Action memory)
    {
        return Directory.Action(
            kind,
            directory.nonce(),
            version,
            target,
            runtimeHash,
            directory.signerSetEpoch(),
            uint48(vm.getBlockTimestamp() + 4 days)
        );
    }

    function _propose(uint48 consentDuration) private returns (uint48 deadline) {
        deadline = uint48(vm.getBlockTimestamp()) + consentDuration;
        vm.prank(CREATOR);
        registry.proposeMigration(token, nextEngine, nextEngine.codehash, deadline);
    }

    function _approvals(uint256 firstKey, uint256 secondKey) private view returns (bytes memory, bytes memory) {
        bytes32 digest = registry.migrationDigest(token);
        return (_sign(digest, firstKey), _sign(digest, secondKey));
    }

    function _schedule(uint256 firstKey, uint256 secondKey) private {
        (bytes memory first, bytes memory second) = _approvals(firstKey, secondKey);
        registry.scheduleMigration(token, first, second);
    }

    function _scheduleRotation(uint256 departingKey, uint256 incomingKey)
        private
        returns (Directory.SignerRotation memory rotation)
    {
        rotation = Directory.SignerRotation(
            vm.addr(departingKey),
            vm.addr(incomingKey),
            directory.signerSetEpoch(),
            directory.rotationNonce(),
            uint48(vm.getBlockTimestamp() + 4 days)
        );
        bytes32 digest = directory.signerRotationDigest(rotation);
        directory.scheduleSignerRotation(
            rotation,
            _sign(digest, SIGNER_B_KEY),
            _sign(digest, SIGNER_C_KEY),
            _sign(directory.rotationAcceptanceDigest(digest), incomingKey)
        );
    }

    function _rotate(uint256 departingKey, uint256 incomingKey) private {
        Directory.SignerRotation memory rotation = _scheduleRotation(departingKey, incomingKey);
        vm.warp(vm.getBlockTimestamp() + directory.publicationDelay());
        directory.executeSignerRotation(rotation);
    }

    function _sign(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
