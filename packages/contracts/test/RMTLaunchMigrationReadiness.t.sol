// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1 as Deployer} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveSuccessorDeployerV2 as V3Deployer} from "../src/RMTLaunchBondingCurveV3.sol";
import {RMTLaunchCurveFactoryV1 as Factory} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchCurveDirectoryV1 as Directory} from "../src/RMTLaunchCurveDirectoryV1.sol";
import {RMTLaunchProjectRegistryV1 as Registry} from "../src/RMTLaunchProjectRegistryV1.sol";
import {RMTLaunchCurveRevenueLedgerV1 as Ledger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";

contract MigrationGraduationBinding {
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }
}

/// @dev An economic-identity-compatible V3 candidate outside the canonical template path.
contract MigrationV3Probe is Curve {
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

    function engineVersion() external pure returns (uint32) {
        return 2;
    }
}

/// @dev Exercises directory admission metadata without providing a V4 migration implementation.
contract V4TemplateAdmissionFixture {
    uint32 public constant fromVersion = 3;
    uint32 public constant toVersion = 4;
}

/// @dev Test-only fault injection. Delegates to the exact original bytecode at the existing storage address.
contract MigrationCallbackProbe {
    address private immutable originalRuntime;
    bytes4 private immutable intercepted;
    Curve private immutable predecessor;
    Curve private immutable successor;
    Registry private immutable registry;
    Factory private immutable factory;
    address private immutable asset;
    bool private immutable buyAfterAccrual;

    constructor(
        address originalRuntime_,
        bytes4 intercepted_,
        Curve predecessor_,
        Curve successor_,
        Registry registry_,
        Factory factory_,
        address asset_,
        bool buyAfterAccrual_
    ) {
        originalRuntime = originalRuntime_;
        intercepted = intercepted_;
        predecessor = predecessor_;
        successor = successor_;
        registry = registry_;
        factory = factory_;
        asset = asset_;
        buyAfterAccrual = buyAfterAccrual_;
    }

    fallback() external payable {
        if (msg.sig == intercepted) {
            require(!predecessor.active() && predecessor.migratedTo() == address(successor));
            require(predecessor.backingReserve() == 0 && factory.curveForToken(asset) == address(predecessor));
            require(successor.active() == (intercepted == Ledger.moveAccrual.selector));
            _rejected(
                address(predecessor),
                abi.encodeCall(Curve.buy, (1, block.timestamp)),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
            _rejected(
                address(predecessor),
                abi.encodeCall(Curve.sell, (1, 1, block.timestamp)),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
            _rejected(
                address(predecessor),
                abi.encodeCall(Curve.graduate, (block.timestamp)),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
            _rejected(
                address(predecessor),
                abi.encodeCall(Curve.migrateAssets, (payable(address(successor)), address(successor).codehash)),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
            _rejected(
                address(registry),
                abi.encodeCall(Registry.executeMigration, (asset)),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
            _rejected(
                address(factory),
                abi.encodeCall(Factory.executeMigration, (asset, address(successor), address(successor).codehash)),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
            if (!successor.active()) {
                _rejected(
                    address(successor), abi.encodeCall(Curve.buy, (1, block.timestamp)), Curve.CurveClosed.selector
                );
            }
        }
        (bool ok, bytes memory output) = originalRuntime.delegatecall(msg.data);
        if (ok && msg.sig == Ledger.moveAccrual.selector && buyAfterAccrual) {
            successor.buy{value: 0.05 ether}(1, block.timestamp);
        }
        assembly ("memory-safe") {
            switch ok
            case 0 { revert(add(output, 32), mload(output)) }
            default { return(add(output, 32), mload(output)) }
        }
    }

    function _rejected(address target, bytes memory data, bytes4 expected) private {
        (bool success, bytes memory failure) = target.call(data);
        require(!success && bytes4(failure) == expected, "unexpected callback result");
    }
}

contract RMTLaunchMigrationReadinessTest is Test {
    address private constant CREATOR = address(0x201);
    address private constant TREASURY = address(0x202);
    address private constant OPERATING = address(0x203);
    address private constant FUTURE = address(0x204);
    address private constant HOLDER = address(0x205);
    address private constant STRANGER = address(0x206);

    Directory private directory;
    Registry private registry;
    Factory private factory;
    Curve private origin;
    Curve private successor;
    IERC20 private token;
    Ledger private ledger;

    struct Snapshot {
        uint256 sold;
        uint256 backing;
        uint256 inventory;
        uint256 supply;
        uint256 holderTokens;
        uint256 ledgerNative;
        uint256 accrued;
        uint256 claimed;
        uint256[4] credits;
    }

    function setUp() external {
        vm.chainId(31_337);
        vm.warp(100 days);
        directory = new Directory(vm.addr(1), vm.addr(2), vm.addr(3));
        registry = new Registry(directory);
        Deployer helper = new Deployer();
        address expectedFactory = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        MigrationGraduationBinding graduation = new MigrationGraduationBinding(expectedFactory);
        factory = new Factory(
            address(graduation), OPERATING, FUTURE, address(registry), address(helper), address(helper).codehash, 0
        );
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
        (address asset, address curve) =
            factory.create("Migration review", "RMTM", "", 0, TREASURY, 2_000, bytes32(uint256(1)), block.timestamp);
        token = IERC20(asset);
        origin = Curve(payable(curve));
        ledger = origin.revenueLedger();
        vm.deal(HOLDER, 5 ether);
        vm.prank(HOLDER);
        origin.buy{value: 0.4 ether}(1, block.timestamp);
        successor = Curve(payable(factory.prepareMigration(asset, 2)));
    }

    function testV2ToV3NeedsSeparateTemplateAdmissionDespiteFactoryPublication() external {
        Snapshot memory before = _snapshot(origin);
        _schedule();
        vm.prank(STRANGER);
        registry.executeMigration(address(token));
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
        assertEq(origin.migratedTo(), address(successor));
        assertEq(successor.executionVersion(), 2);
        assertEq(registry.nextMigrationVersion(address(token)), 0);
        assertEq(registry.originCurve(address(token)), address(origin));

        MigrationV3Probe candidate = new MigrationV3Probe(successor);
        assertEq(candidate.executionVersion(), 3);
        assertEq(candidate.migrationSource(), address(successor));
        assertEq(candidate.migrationCommitment(), successor.migrationCommitment());
        assertFalse(candidate.active());
        vm.expectRevert(Factory.InvalidMigration.selector);
        factory.prepareMigration(address(token), 3);
        vm.expectRevert(Factory.InvalidMigration.selector);
        factory.prepareMigration(address(token), 2);
        vm.prank(CREATOR);
        vm.expectRevert(Registry.InvalidProposal.selector);
        registry.proposeMigration(
            address(token), address(candidate), address(candidate).codehash, uint48(block.timestamp + 4 days)
        );
        vm.prank(address(registry));
        vm.expectRevert(Factory.InvalidMigration.selector);
        factory.executeMigration(address(token), address(candidate), address(candidate).codehash);
        vm.prank(address(registry));
        vm.expectRevert(Factory.InvalidMigration.selector);
        factory.executeMigration(address(token), address(successor), address(successor).codehash);

        Directory.Action memory publication = Directory.Action(
            Directory.ActionKind.Publish,
            1,
            2,
            address(candidate),
            address(candidate).codehash,
            uint48(block.timestamp + 4 days)
        );
        bytes32 digest = directory.actionDigest(publication);
        directory.schedule(publication, _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(publication);
        Directory.FactoryPin memory current = directory.currentFactory();
        assertEq(current.factory, address(candidate));
        assertEq(registry.nextMigrationVersion(address(token)), 0);
        vm.prank(CREATOR);
        vm.expectRevert(Registry.InvalidProposal.selector);
        registry.proposeMigration(
            address(token), address(candidate), address(candidate).codehash, uint48(block.timestamp + 4 days)
        );
        (address canonicalFactory, address active, uint32 version, address engine, uint64 migrations) =
            registry.project(address(token));
        assertEq(canonicalFactory, address(factory));
        assertEq(active, address(successor));
        assertEq(version, 2);
        assertEq(engine, address(successor));
        assertEq(migrations, 1);
        assertEq(registry.migrationNonce(address(token)), 1);
        assertEq(ledger.activeCurve(), address(successor));
        assertEq(address(candidate).balance, 0);
        assertEq(token.balanceOf(address(candidate)), 0);
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
        _sell(successor, before.holderTokens);
        assertEq(successor.backingReserve(), 0);
    }

    function testGovernedV2ToV3MigrationRollsBackOnFailedAcceptanceThenRetries() external {
        _schedule();
        registry.executeMigration(address(token));
        vm.prank(HOLDER);
        successor.buy{value: 0.1 ether}(1, block.timestamp);
        Snapshot memory before = _snapshot(successor);
        address helper = address(new V3Deployer());
        Directory.Action memory publication = _templateAction(helper, 3);
        bytes32 templateDigest = directory.actionDigest(publication);
        directory.schedule(publication, _sign(templateDigest, 1), _sign(templateDigest, 3));
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(publication);
        vm.expectRevert(Factory.InvalidMigration.selector);
        factory.prepareMigration(address(token), 3);
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(publication);
        (address pinned, bytes32 pinnedHash) = registry.migrationTemplate(address(factory), 2);
        assertEq(pinned, helper);
        assertEq(pinnedHash, helper.codehash);
        assertEq(registry.nextMigrationVersion(address(token)), 3);
        address next = factory.prepareMigration(address(token), 3);
        assertEq(factory.prepareMigration(address(token), 3), next);
        assertFalse(Curve(payable(next)).active());
        vm.prank(CREATOR);
        registry.proposeMigration(address(token), next, next.codehash, uint48(block.timestamp + 4 days));
        bytes32 digest = registry.migrationDigest(address(token));
        registry.scheduleMigration(address(token), _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + registry.migrationDelay());
        vm.mockCallRevert(
            next,
            abi.encodeCall(Curve.acceptMigration, (before.sold, before.backing, before.inventory)),
            bytes("interrupted V3 acceptance")
        );
        vm.expectRevert(bytes("interrupted V3 acceptance"));
        registry.executeMigration(address(token));
        vm.clearMockedCalls();
        assertEq(factory.curveForToken(address(token)), address(successor));
        assertTrue(successor.active());
        assertEq(successor.migratedTo(), address(0));
        assertEq(address(successor).balance, before.backing);
        assertEq(ledger.activeCurve(), address(successor));
        assertEq(next.balance, 0);
        assertEq(token.balanceOf(next), 0);
        assertFalse(Curve(payable(next)).active());
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
        assertEq(registry.migrationNonce(address(token)), 1);
        vm.prank(STRANGER);
        registry.executeMigration(address(token));
        Curve latest = Curve(payable(next));
        assertEq(latest.executionVersion(), 3);
        assertEq(latest.migrationCommitment(), origin.migrationCommitment());
        assertEq(keccak256(abi.encode(_snapshot(latest))), keccak256(abi.encode(before)));
        assertEq(address(successor).balance, 0);
        assertEq(token.balanceOf(address(successor)), 0);
        assertFalse(successor.active());
        assertEq(successor.migratedTo(), next);
        assertEq(ledger.activeCurve(), next);
        assertEq(registry.originCurve(address(token)), address(origin));
        assertEq(registry.nextMigrationVersion(address(token)), 0);
        (uint32 from, uint32 to, address previous, address destination, bytes32 runtimeHash,,) =
            registry.migration(address(token), 2);
        assertEq(from, 2);
        assertEq(to, 3);
        assertEq(previous, address(successor));
        assertEq(destination, next);
        assertEq(runtimeHash, next.codehash);
        _sell(latest, before.holderTokens);
        assertEq(latest.backingReserve(), 0);
    }

    function testFutureTemplateAdmissionRejectsUnreviewedVersionHashOrTemplateReplacement() external {
        address helper = address(new V3Deployer());
        address v4Helper = address(new V4TemplateAdmissionFixture());
        Directory.Action memory action = _templateAction(v4Helper, 4);
        bytes32 digest = directory.actionDigest(action);
        bytes memory first = _sign(digest, 1);
        bytes memory second = _sign(digest, 2);
        vm.expectRevert(Directory.InvalidFactory.selector);
        directory.schedule(action, first, second);
        action = _templateAction(helper, 3);
        action.runtimeHash = bytes32(uint256(1));
        vm.expectRevert(Directory.InvalidFactory.selector);
        directory.schedule(action, first, second);
        action = _templateAction(helper, 3);
        digest = directory.actionDigest(action);
        first = _sign(digest, 1);
        second = _sign(digest, 2);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.schedule(action, first, first);
        directory.schedule(action, first, second);
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(action);
        action = _templateAction(helper, 3);
        vm.expectRevert(Directory.InvalidFactory.selector);
        directory.schedule(action, first, second);

        action = _templateAction(helper, 4);
        digest = directory.actionDigest(action);
        first = _sign(digest, 1);
        second = _sign(digest, 2);
        vm.expectRevert(Directory.InvalidFactory.selector);
        directory.schedule(action, first, second);

        action = _templateAction(v4Helper, 4);
        digest = directory.actionDigest(action);
        first = _sign(digest, 1);
        second = _sign(digest, 2);
        directory.schedule(action, first, second);
        (address pending,) = directory.migrationTemplates(4);
        assertEq(pending, address(0));
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(action);
        (address published, bytes32 publishedHash) = directory.migrationTemplates(4);
        assertEq(published, v4Helper);
        assertEq(publishedHash, v4Helper.codehash);
    }

    function _templateAction(address deployer, uint32 version) private view returns (Directory.Action memory) {
        return Directory.Action(
            Directory.ActionKind.PublishMigrationTemplate,
            directory.nonce(),
            version,
            deployer,
            deployer.codehash,
            uint48(block.timestamp + 4 days)
        );
    }

    function testTokenCallbackCannotReenterEitherCurveFactoryOrRegistry() external {
        Snapshot memory before = _snapshot(origin);
        _schedule();
        _etchProbe(address(token), IERC20.transfer.selector, false);
        registry.executeMigration(address(token));
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
        assertEq(address(origin).balance, 0);
        assertEq(token.balanceOf(address(origin)), 0);
    }

    function testDestinationCodePinRejectsRuntimeSubstitution() external {
        Snapshot memory before = _snapshot(origin);
        _schedule();
        bytes memory reviewedRuntime = address(successor).code;
        _etchProbe(address(successor), Curve.acceptMigration.selector, false);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(address(token));
        _assertIntact(before);
        vm.etch(address(successor), reviewedRuntime);
        registry.executeMigration(address(token));
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
    }

    function testDestinationAcceptanceCallbackCannotReenterPredecessorFactoryOrRegistry() external {
        Snapshot memory before = _snapshot(origin);
        // Schedule after the test-only injection to reach the acceptance callback itself.
        _etchProbe(address(successor), Curve.acceptMigration.selector, false);
        _schedule();
        registry.executeMigration(address(token));
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
        assertEq(ledger.activeCurve(), address(successor));
    }

    function testLedgerCallbackTamperingAfterHandoffRevertsAllEffectsAndCanRetry() external {
        Snapshot memory before = _snapshot(origin);
        _schedule();
        // The fault-injected ledger gets surplus ETH to prove even a funded nested buy cannot survive.
        vm.deal(address(ledger), address(ledger).balance + 1 ether);
        before.ledgerNative = address(ledger).balance;
        bytes memory reviewedRuntime = address(ledger).code;
        _etchProbe(address(ledger), Ledger.moveAccrual.selector, true);
        vm.expectRevert(Curve.InvalidMigrationSettlement.selector);
        registry.executeMigration(address(token));
        _assertIntact(before);
        assertEq(token.balanceOf(address(ledger)), 0);
        vm.etch(address(ledger), reviewedRuntime);
        registry.executeMigration(address(token));
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
    }

    function testLedgerCallbackCannotReenterPredecessorFactoryOrRegistry() external {
        Snapshot memory before = _snapshot(origin);
        _schedule();
        _etchProbe(address(ledger), Ledger.moveAccrual.selector, false);
        registry.executeMigration(address(token));
        assertEq(keccak256(abi.encode(_snapshot(successor))), keccak256(abi.encode(before)));
        assertEq(ledger.activeCurve(), address(successor));
    }

    function testCreatorConsentDoesNotAllowExpirySuspensionOrReplay() external {
        Snapshot memory before = _snapshot(origin);
        uint48 deadline = uint48(block.timestamp + 4 days);
        vm.prank(CREATOR);
        registry.proposeMigration(address(token), address(successor), address(successor).codehash, deadline);
        bytes32 digest = registry.migrationDigest(address(token));
        vm.prank(CREATOR);
        registry.cancelMigration(address(token));
        vm.prank(CREATOR);
        registry.proposeMigration(address(token), address(successor), address(successor).codehash, deadline);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(address(token), _sign(digest, 1), _sign(digest, 2));
        digest = registry.migrationDigest(address(token));
        registry.scheduleMigration(address(token), _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + registry.migrationDelay());
        Directory.Action memory suspension =
            Directory.Action(Directory.ActionKind.Suspend, 1, 0, address(0), bytes32(0), deadline);
        digest = directory.actionDigest(suspension);
        directory.suspend(suspension, _sign(digest, 1), _sign(digest, 3));
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(address(token));
        vm.warp(deadline + 1);
        registry.clearExpiredMigration(address(token));
        assertEq(registry.migrationNonce(address(token)), 2);
        _assertIntact(before);
        _sell(origin, before.holderTokens);
        assertEq(origin.backingReserve(), 0);
    }

    function _etchProbe(address target, bytes4 selector, bool buyAfterAccrual) private {
        address runtime = makeAddr("original dependency runtime");
        vm.etch(runtime, target.code);
        MigrationCallbackProbe wrapper = new MigrationCallbackProbe(
            runtime, selector, origin, successor, registry, factory, address(token), buyAfterAccrual
        );
        vm.etch(target, address(wrapper).code);
    }

    function _snapshot(Curve curve) private view returns (Snapshot memory result) {
        result.sold = curve.sold();
        result.backing = curve.backingReserve();
        result.inventory = token.balanceOf(address(curve));
        result.supply = token.totalSupply();
        result.holderTokens = token.balanceOf(HOLDER);
        result.ledgerNative = address(ledger).balance;
        result.accrued = ledger.totalAccrued();
        result.claimed = ledger.totalClaimed();
        result.credits = [
            ledger.claimable(CREATOR), ledger.claimable(TREASURY), ledger.claimable(OPERATING), ledger.claimable(FUTURE)
        ];
    }

    function _assertIntact(Snapshot memory before) private view {
        assertEq(keccak256(abi.encode(_snapshot(origin))), keccak256(abi.encode(before)));
        assertTrue(origin.active());
        assertEq(origin.migratedTo(), address(0));
        assertEq(address(origin).balance, before.backing);
        assertEq(factory.curveForToken(address(token)), address(origin));
        assertEq(ledger.activeCurve(), address(origin));
        assertFalse(successor.active());
        assertEq(successor.backingReserve(), 0);
        assertEq(address(successor).balance, 0);
        assertEq(token.balanceOf(address(successor)), 0);
        (, address active, uint32 version,, uint64 migrations) = registry.project(address(token));
        assertEq(active, address(origin));
        assertEq(version, 1);
        assertEq(migrations, 0);
    }

    function _schedule() private {
        vm.prank(CREATOR);
        registry.proposeMigration(
            address(token), address(successor), address(successor).codehash, uint48(block.timestamp + 4 days)
        );
        bytes32 digest = registry.migrationDigest(address(token));
        registry.scheduleMigration(address(token), _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + registry.migrationDelay());
    }

    function _sell(Curve curve, uint256 amount) private {
        vm.startPrank(HOLDER);
        token.approve(address(curve), amount);
        curve.sell(amount, 1, block.timestamp);
        vm.stopPrank();
    }

    function _sign(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
