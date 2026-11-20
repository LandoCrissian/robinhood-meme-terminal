// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm, VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTLaunchCurveTokenV2 as Token} from "../src/RMTLaunchCurveTokenV2.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1 as V2Deployer} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveSuccessorDeployerV2 as V3Deployer} from "../src/RMTLaunchBondingCurveV3.sol";
import {RMTLaunchCurveFactoryV2 as Factory} from "../src/RMTLaunchCurveFactoryV2.sol";
import {RMTLaunchProjectRegistryV3 as Registry} from "../src/RMTLaunchProjectRegistryV3.sol";
import {RMTLaunchCurveDirectoryV2 as Directory} from "../src/RMTLaunchCurveDirectoryV2.sol";
import {RMTLaunchCurveRevenueLedgerV1 as Ledger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {MigrationCallbackProbe} from "./RMTLaunchMigrationReadiness.t.sol";

/// @dev Migration never calls the graduation engine. Its constructor binding is the only fixture method.
contract Task090MigrationGraduationBinding {
    address public immutable factory;
    constructor(address factory_) { factory = factory_; }
}

/// @dev VM-only substituted runtime, deliberately outside the immutable canonical ledger implementation.
contract Task090MutableLedgerCounterfactual {
    address private immutable original;
    address private immutable receiver;
    constructor(address original_, address receiver_) { original = original_; receiver = receiver_; }
    fallback(bytes calldata input) external payable returns (bytes memory output) {
        bool ok;
        (ok, output) = original.delegatecall(input);
        if (!ok) assembly ("memory-safe") { revert(add(output, 32), mload(output)) }
        if (msg.sig == Ledger.moveAccrual.selector) {
            (ok,) = payable(receiver).call{value: 1}("");
            require(ok, "synthetic receiver rejected");
        }
    }
}

/// @dev VM-only admitted successor fault. The allowance is a test switch, not a production permission.
contract Task090AdjacentNativeFault {
    address private immutable original;
    IERC20 private immutable asset;
    address private immutable donor;
    address private immutable receiver;
    constructor(address original_, IERC20 asset_, address donor_, address receiver_) {
        original = original_; asset = asset_; donor = donor_; receiver = receiver_;
    }
    fallback(bytes calldata input) external payable returns (bytes memory output) {
        bool ok;
        (ok, output) = original.delegatecall(input);
        if (!ok) assembly ("memory-safe") { revert(add(output, 32), mload(output)) }
        if (msg.sig == Curve.acceptMigration.selector && asset.allowance(donor, address(this)) == 1) {
            (ok,) = payable(receiver).call{value: 1}("");
            require(ok, "synthetic receiver rejected");
        }
    }
}

/// @notice Six migration findings: concrete conservation, exact mutable-call graph and counterfactual boundaries.
contract Task090MigrationProofTest is Test {
    address private constant CREATOR = address(0x901);
    address private constant TREASURY = address(0x902);
    address private constant OPERATING = address(0x903);
    address private constant RESERVE = address(0x904);
    address private constant HOLDER = address(0x905);
    address private constant OUTSIDER = address(0x906);
    address private constant RECEIVER = address(0x907);
    uint256 private constant CREATION_FEE = 0.0004 ether;
    Directory private directory;
    Registry private registry;
    Factory private factory;
    Curve private origin;
    Curve private next;
    IERC20 private asset;
    Ledger private ledger;
    bool private canonicalProfile;
    string private canonicalArtifacts;

    struct Assets {
        uint256 sourceNative;
        uint256 destinationNative;
        uint256 sourceTokens;
        uint256 destinationTokens;
        uint256 sold;
        uint256 backing;
        uint256 supply;
        uint256 holderTokens;
        bytes32 fees;
    }

    function setUp() external {
        // The isolated 4663 runner sets this explicitly; the ordinary repository suite stays on 31337.
        vm.chainId(vm.envOr("RMT_TASK090_MIGRATION_CHAIN_ID", uint256(31337)));
        canonicalProfile = vm.envOr("RMT_TASK090_MIGRATION_CANONICAL", false);
        if (canonicalProfile) {
            canonicalArtifacts = vm.readFile("test/fixtures/task090-migration-profile.json");
            assertEq(block.chainid, 4663);
            assertEq(vm.parseJsonString(canonicalArtifacts, ".manifest.inputSha256"),
                "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10");
        }
        vm.warp(100 days);
        directory = Directory(_deploy("RMTLaunchCurveDirectoryV2", type(Directory).creationCode,
            abi.encode(vm.addr(1), vm.addr(2), vm.addr(3))));
        registry = Registry(_deploy("RMTLaunchProjectRegistryV3", type(Registry).creationCode, abi.encode(directory)));
        V2Deployer template = V2Deployer(_deploy("RMTLaunchCurveSuccessorDeployerV1", type(V2Deployer).creationCode, ""));
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        Task090MigrationGraduationBinding graduation = new Task090MigrationGraduationBinding(predicted);
        factory = Factory(_deploy("RMTLaunchCurveFactoryV2", type(Factory).creationCode,
            abi.encode(address(graduation), OPERATING, RESERVE, address(registry), address(template),
                address(template).codehash, CREATION_FEE)));
        _publish(Directory.ActionKind.Publish, 1, address(factory));
        vm.deal(CREATOR, CREATION_FEE);
        vm.prank(CREATOR);
        (address token, address curve) = factory.create{value: CREATION_FEE}(
            "Task090 migration", "MIG90", "", TREASURY, 2_000, bytes32(uint256(90)), block.timestamp);
        asset = IERC20(token);
        origin = Curve(payable(curve));
        ledger = origin.revenueLedger();
        next = Curve(payable(factory.prepareMigration(token, 2)));
        assertEq(token.codehash, keccak256(canonicalProfile
            ? vm.parseJsonBytes(canonicalArtifacts, ".runtimeCode.RMTLaunchCurveTokenV2") : type(Token).runtimeCode));
        assertEq(origin.GRADUATION_BACKING(), canonicalProfile ? 2 ether : 1 ether);
        assertEq(address(next.revenueLedger()), address(ledger));
        assertEq(next.migrationCommitment(), origin.migrationCommitment());
        vm.deal(HOLDER, 10 ether);
    }

    function testFuzzCanonicalHandoffConservesSurplusesAndAlreadyEarnedClaims(
        uint96 budgetSeed, uint96 tokenSeed, uint96 nativeSeed
    ) external {
        _seed(origin, next, bound(budgetSeed, 0.01 ether, 0.5 ether), tokenSeed, nativeSeed);
        Assets memory before = _assets(origin, next);
        _schedule(next, true);
        vm.prank(OUTSIDER);
        registry.executeMigration(address(asset));
        _assertHandoff(origin, next, before, 2);
        _claimRemaining();
    }

    function testCanonicalCallGraphHasOnlySixMutableFramesAndOneLedgerWrite() external {
        _seed(origin, next, 0.3 ether, 57, 91);
        Assets memory before = _assets(origin, next);
        _schedule(next, true);
        _emitVector("before", origin, next);
        vm.record();
        ledger.activeCurve();
        (bytes32[] memory writerSlots,) = vm.accesses(address(ledger));
        assertEq(writerSlots.length, 1);
        vm.startStateDiffRecording();
        registry.executeMigration(address(asset));
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        address[6] memory callers = [address(this), address(registry), address(factory), address(origin), address(origin), address(origin)];
        address[6] memory targets = [address(registry), address(factory), address(origin), address(asset), address(ledger), address(next)];
        bytes4[6] memory selectors = [Registry.executeMigration.selector, Factory.executeMigration.selector,
            Curve.migrateAssets.selector, IERC20.transfer.selector, Ledger.moveAccrual.selector, Curve.acceptMigration.selector];
        uint256 calls;
        uint256 ledgerWrites;
        for (uint256 i; i < accesses.length; ++i) {
            Vm.AccountAccess memory access = accesses[i];
            assertTrue(access.kind != VmSafe.AccountAccessKind.DelegateCall && access.kind != VmSafe.AccountAccessKind.CallCode
                && access.kind != VmSafe.AccountAccessKind.Create && access.kind != VmSafe.AccountAccessKind.SelfDestruct);
            if (access.kind == VmSafe.AccountAccessKind.Call) {
                assertLt(calls, 6, "unexpected mutable callback");
                assertEq(access.accessor, callers[calls]);
                assertEq(access.account, targets[calls]);
                assertEq(bytes4(access.data), selectors[calls]);
                assertEq(access.value, calls == 5 ? before.backing : 0);
                assertFalse(access.reverted);
                ++calls;
            }
            for (uint256 j; j < access.storageAccesses.length; ++j) {
                Vm.StorageAccess memory write = access.storageAccesses[j];
                if (write.account == address(ledger) && write.isWrite) {
                    assertEq(write.slot, writerSlots[0], "migration changed an earned-fee storage slot");
                    assertEq(write.newValue, bytes32(uint256(uint160(address(next)))));
                    assertFalse(write.reverted);
                    ++ledgerWrites;
                }
            }
        }
        assertEq(calls, 6);
        assertEq(ledgerWrites, 1);
        _assertHandoff(origin, next, before, 2);
        _emitVector("after", origin, next);
        _claimRemaining();
        _emitVector("after-claims", origin, next);
    }

    function testRealAdjacentV2ToV3RetainsOriginalLedgerAndSeparateTemplateConsent() external {
        _seed(origin, next, 0.2 ether, 11, 19);
        Assets memory first = _assets(origin, next);
        _schedule(next, true);
        registry.executeMigration(address(asset));
        _assertHandoff(origin, next, first, 2);
        vm.expectRevert(Factory.InvalidMigration.selector);
        factory.prepareMigration(address(asset), 3);
        address v3 = _deploy("RMTLaunchCurveSuccessorDeployerV2", type(V3Deployer).creationCode, "");
        _publish(Directory.ActionKind.PublishMigrationTemplate, 3, v3);
        Curve third = Curve(payable(factory.prepareMigration(address(asset), 3)));
        _seed(next, third, 0.1 ether, 21, 33);
        Assets memory second = _assets(next, third);
        _schedule(third, true);
        registry.executeMigration(address(asset));
        _assertHandoff(next, third, second, 3);
        assertEq(registry.originCurve(address(asset)), address(origin));
        assertEq(ledger.curve(), address(origin));
        _claimRemaining();
    }

    function testHostileLedgerPostWriterTradeRollsBackAssetsClaimsProposalAndRoutes() external {
        _seed(origin, next, 0.3 ether, 5, 17);
        // Fund the injected probe's 0.05 ETH callback so CurveClosed, rather than insufficient funds, is exercised.
        vm.deal(address(ledger), address(ledger).balance + 0.05 ether);
        address runtime = makeAddr("canonical ledger body");
        vm.etch(runtime, address(ledger).code);
        MigrationCallbackProbe hostile = new MigrationCallbackProbe(runtime, Ledger.moveAccrual.selector,
            origin, next, registry, factory, address(asset), true);
        vm.etch(address(ledger), address(hostile).code);
        _schedule(next, true);
        bytes32 before = _state(origin, next);
        vm.expectRevert(Curve.CurveClosed.selector);
        registry.executeMigration(address(asset));
        assertEq(_state(origin, next), before);
        assertEq(registry.migrationNonce(address(asset)), 0);
    }

    function testHostileAdmittedSuccessorNativeDiversionRevertsAndSameProposalCanRetry() external {
        _seed(origin, next, 0.3 ether, 23, 47);
        address runtime = makeAddr("canonical successor body");
        vm.etch(runtime, address(next).code);
        Task090AdjacentNativeFault hostile = new Task090AdjacentNativeFault(runtime, asset, HOLDER, RECEIVER);
        vm.etch(address(next), address(hostile).code);
        vm.prank(HOLDER);
        asset.approve(address(next), 1);
        _schedule(next, true); // Deliberately sign the injected runtime, rather than silently evading a code pin.
        Assets memory beforeAssets = _assets(origin, next);
        bytes32 before = _state(origin, next);
        uint256 receiverBefore = RECEIVER.balance;
        vm.expectRevert(Curve.InvalidMigrationSettlement.selector);
        registry.executeMigration(address(asset));
        assertEq(_state(origin, next), before);
        assertEq(RECEIVER.balance, receiverBefore);
        assertEq(asset.allowance(HOLDER, address(next)), 1);
        vm.prank(HOLDER);
        asset.approve(address(next), 0);
        registry.executeMigration(address(asset));
        _assertHandoff(origin, next, beforeAssets, 2);
    }

    function testCounterfactualMutableLedgerDemonstratesTheExactLedgerCodeAssumption() external {
        _seed(origin, next, 0.3 ether, 9, 13);
        address runtime = makeAddr("canonical fee ledger body");
        vm.etch(runtime, address(ledger).code);
        Task090MutableLedgerCounterfactual hostile = new Task090MutableLedgerCounterfactual(runtime, RECEIVER);
        vm.etch(address(ledger), address(hostile).code);
        uint256 feesBefore = address(ledger).balance;
        uint256 liabilityBefore = _credits();
        uint256 receiverBefore = RECEIVER.balance;
        _schedule(next, true);
        registry.executeMigration(address(asset));
        // Outer source/destination deltas do not independently protect a replaceable ledger's own ETH.
        // The deployed ledger is NOT replaceable; this VM-only counterfactual must not be called a live defect.
        assertEq(factory.curveForToken(address(asset)), address(next));
        assertEq(ledger.activeCurve(), address(next));
        assertEq(_credits(), liabilityBefore);
        assertEq(address(ledger).balance, feesBefore - 1);
        assertEq(RECEIVER.balance, receiverBefore + 1);
        assertEq(_credits(), address(ledger).balance + 1);
    }

    function testMissingCreatorQuorumWrongVersionAndPauseCannotMoveAnyAssets() external {
        _seed(origin, next, 0.3 ether, 13, 27);
        bytes32 before = _state(origin, next);
        vm.prank(OUTSIDER);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.proposeMigration(address(asset), address(next), address(next).codehash, uint48(block.timestamp + 4 days));
        assertEq(_state(origin, next), before);
        vm.expectRevert(Factory.InvalidMigration.selector);
        factory.prepareMigration(address(asset), 3);
        assertEq(_state(origin, next), before);
        vm.prank(OUTSIDER);
        vm.expectRevert(Curve.UnauthorizedMigration.selector);
        origin.migrateAssets(payable(address(next)), address(next).codehash);
        assertEq(_state(origin, next), before);
        vm.prank(CREATOR);
        registry.proposeMigration(address(asset), address(next), address(next).codehash, uint48(block.timestamp + 4 days));
        bytes32 signed = registry.migrationDigest(address(asset));
        before = _state(origin, next);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(address(asset), _sign(signed, 1), _sign(signed, 1));
        assertEq(_state(origin, next), before);
        registry.scheduleMigration(address(asset), _sign(signed, 1), _sign(signed, 2));
        before = _state(origin, next);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(address(asset));
        assertEq(_state(origin, next), before);
        vm.warp(block.timestamp + registry.migrationDelay());
        Directory.Action memory suspension = Directory.Action(Directory.ActionKind.Suspend, directory.nonce(),
            0, address(0), bytes32(0), directory.signerSetEpoch(), uint48(block.timestamp + 1 days));
        signed = directory.actionDigest(suspension);
        directory.suspend(suspension, _sign(signed, 1), _sign(signed, 2));
        before = _state(origin, next);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(address(asset));
        assertEq(_state(origin, next), before);
    }

    function testCancelledCreatorConsentAndExpiryCannotReuseApprovalOrMoveAssets() external {
        _seed(origin, next, 0.3 ether, 29, 43);
        uint48 deadline = uint48(block.timestamp + registry.migrationDelay());
        vm.prank(CREATOR);
        registry.proposeMigration(address(asset), address(next), address(next).codehash, deadline);
        bytes32 oldDigest = registry.migrationDigest(address(asset));
        bytes32 fees = _feeState();
        vm.prank(CREATOR);
        registry.cancelMigration(address(asset));
        assertEq(registry.migrationNonce(address(asset)), 1);
        vm.prank(CREATOR);
        registry.proposeMigration(address(asset), address(next), address(next).codehash, deadline);
        bytes32 before = _state(origin, next);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(address(asset), _sign(oldDigest, 1), _sign(oldDigest, 2));
        assertEq(_state(origin, next), before);
        bytes32 currentDigest = registry.migrationDigest(address(asset));
        assertNotEq(currentDigest, oldDigest);
        registry.scheduleMigration(address(asset), _sign(currentDigest, 1), _sign(currentDigest, 2));
        vm.warp(uint256(deadline) + 1);
        before = _state(origin, next);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(address(asset));
        assertEq(_state(origin, next), before);
        assertEq(_feeState(), fees);
    }

    function testPostSignatureRuntimeReplacementFailsBeforeHandoffAndRestoredPinRetries() external {
        _seed(origin, next, 0.3 ether, 31, 53);
        Assets memory beforeAssets = _assets(origin, next);
        bytes memory canonical = address(next).code;
        _schedule(next, true);
        address delegate = makeAddr("changed-next-original-runtime");
        vm.etch(delegate, canonical);
        Task090AdjacentNativeFault changed = new Task090AdjacentNativeFault(delegate, asset, HOLDER, RECEIVER);
        vm.etch(address(next), address(changed).code);
        bytes32 before = _state(origin, next);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(address(asset));
        assertEq(_state(origin, next), before);
        vm.etch(address(next), canonical);
        registry.executeMigration(address(asset));
        _assertHandoff(origin, next, beforeAssets, 2);
    }

    function _seed(Curve source, Curve destination, uint256 budget, uint256 tokenSeed, uint256 nativeSeed) private {
        vm.prank(HOLDER);
        source.buy{value: budget}(1, block.timestamp);
        uint256 quarter = asset.balanceOf(HOLDER) / 4;
        vm.startPrank(HOLDER);
        asset.transfer(address(source), tokenSeed % (quarter + 1));
        asset.transfer(address(destination), (tokenSeed / 3) % (quarter + 1));
        vm.stopPrank();
        vm.deal(address(source), address(source).balance + nativeSeed % 1 ether);
        vm.deal(address(destination), address(destination).balance + (nativeSeed / 3) % 1 ether);
        for (uint256 i; i < 2; ++i) {
            address recipient = i == 0 ? CREATOR : OPERATING;
            if (ledger.claimable(recipient) != 0) { vm.prank(recipient); ledger.claim(); }
        }
        assertGt(ledger.totalClaimed(), 0);
        assertGt(ledger.claimable(TREASURY), 0);
        assertGt(ledger.claimable(RESERVE), 0);
        assertEq(_credits(), address(ledger).balance);
    }

    function _assets(Curve source, Curve destination) private view returns (Assets memory a) {
        a = Assets(address(source).balance, address(destination).balance, asset.balanceOf(address(source)),
            asset.balanceOf(address(destination)), source.sold(), source.backingReserve(), asset.totalSupply(),
            asset.balanceOf(HOLDER), _feeState());
    }

    function _assertHandoff(Curve source, Curve destination, Assets memory a, uint32 version) private view {
        uint256 inventory = a.supply - a.sold;
        assertEq(address(source).balance, a.sourceNative - a.backing);
        assertEq(address(destination).balance, a.destinationNative + a.backing);
        assertEq(asset.balanceOf(address(source)), a.sourceTokens - inventory);
        assertEq(asset.balanceOf(address(destination)), a.destinationTokens + inventory);
        assertEq(asset.balanceOf(address(source)) + asset.balanceOf(address(destination)), a.sourceTokens + a.destinationTokens);
        assertEq(address(source).balance + address(destination).balance, a.sourceNative + a.destinationNative);
        assertEq(asset.totalSupply(), a.supply);
        assertEq(asset.totalSupply(), 1_000_000_000 ether);
        assertEq(asset.balanceOf(HOLDER), a.holderTokens);
        assertEq(_feeState(), a.fees);
        assertFalse(source.active());
        assertEq(source.migratedTo(), address(destination));
        assertEq(source.backingReserve(), 0);
        assertTrue(destination.active());
        assertEq(destination.sold(), a.sold);
        assertEq(destination.backingReserve(), a.backing);
        assertEq(destination.migrationCommitment(), origin.migrationCommitment());
        assertEq(address(destination.revenueLedger()), address(ledger));
        assertEq(ledger.activeCurve(), address(destination));
        assertEq(factory.curveForToken(address(asset)), address(destination));
        (address registeredFactory, address route, uint32 recorded, address engine, uint64 migrations) = registry.project(address(asset));
        assertEq(registeredFactory, address(factory));
        assertEq(route, address(destination));
        assertEq(engine, address(destination));
        assertEq(recorded, version);
        assertEq(migrations, version - 1);
        assertEq(registry.migrationNonce(address(asset)), version - 1);
        assertFalse(registry.migrationInProgress(address(asset)));
    }

    function _feeState() private view returns (bytes32) {
        uint256[4] memory buckets;
        uint256[4] memory credits;
        uint256[4] memory balances;
        address[4] memory recipients = [CREATOR, TREASURY, OPERATING, RESERVE];
        for (uint256 i; i < 4; ++i) {
            buckets[i] = ledger.bucketAccrued(i);
            credits[i] = ledger.claimable(recipients[i]);
            balances[i] = recipients[i].balance;
        }
        return keccak256(abi.encode(address(ledger).balance, asset.balanceOf(address(ledger)), ledger.totalAccrued(),
            ledger.totalClaimed(), buckets, credits, balances, ledger.curve(), ledger.creator(), ledger.treasury(),
            ledger.operatingRecipient(), ledger.futureReserveRecipient(), ledger.treasuryShareBps(),
            factory.creationFeesAccrued(), address(factory).balance));
    }

    function _emitVector(string memory phase, Curve source, Curve destination) private {
        uint256[] memory balances = new uint256[](14);
        balances[0] = address(source).balance;
        balances[1] = address(destination).balance;
        balances[2] = asset.balanceOf(address(source));
        balances[3] = asset.balanceOf(address(destination));
        balances[4] = source.sold();
        balances[5] = source.backingReserve();
        balances[6] = asset.totalSupply();
        balances[7] = asset.balanceOf(HOLDER);
        balances[8] = address(ledger).balance;
        balances[9] = asset.balanceOf(address(ledger));
        balances[10] = ledger.totalAccrued();
        balances[11] = ledger.totalClaimed();
        balances[12] = address(factory).balance;
        balances[13] = factory.creationFeesAccrued();
        uint256[] memory buckets = new uint256[](4);
        uint256[] memory credits = new uint256[](4);
        uint256[] memory beneficiaries = new uint256[](4);
        address[4] memory recipients = [CREATOR, TREASURY, OPERATING, RESERVE];
        for (uint256 i; i < 4; ++i) {
            buckets[i] = ledger.bucketAccrued(i);
            credits[i] = ledger.claimable(recipients[i]);
            beneficiaries[i] = recipients[i].balance;
        }
        vm.serializeString(phase, "phase", phase);
        vm.serializeBool(phase, "canonicalBytecodes", canonicalProfile);
        vm.serializeUint(phase, "chainId", block.chainid);
        vm.serializeString(phase, "graduationBackingWei", vm.toString(source.GRADUATION_BACKING()));
        vm.serializeUint(phase, "balances", balances);
        vm.serializeUint(phase, "bucketAccrued", buckets);
        vm.serializeUint(phase, "claimable", credits);
        emit log_named_string("TASK090_MIGRATION_VECTOR", vm.serializeUint(phase, "beneficiaryNative", beneficiaries));
    }

    function _credits() private view returns (uint256) {
        return ledger.claimable(CREATOR) + ledger.claimable(TREASURY) + ledger.claimable(OPERATING) + ledger.claimable(RESERVE);
    }

    function _state(Curve source, Curve destination) private view returns (bytes32) {
        return keccak256(abi.encode(_assets(source, destination), source.active(), source.backingReserve(),
            source.migratedTo(), destination.active(), destination.sold(), destination.backingReserve(), ledger.activeCurve(),
            _read(address(registry), abi.encodeCall(Registry.project, (address(asset)))),
            _read(address(registry), abi.encodeWithSignature("proposal(address)", address(asset))),
            registry.migrationNonce(address(asset)), registry.migrationInProgress(address(asset)),
            factory.curveForToken(address(asset)), directory.suspended(), directory.signerSetEpoch()));
    }

    function _read(address target, bytes memory data) private view returns (bytes memory output) {
        bool ok;
        (ok, output) = target.staticcall(data);
        require(ok, "snapshot read failed");
    }

    function _claimRemaining() private {
        address[4] memory recipients = [CREATOR, TREASURY, OPERATING, RESERVE];
        for (uint256 i; i < 4; ++i) {
            uint256 credit = ledger.claimable(recipients[i]);
            if (credit == 0) continue;
            uint256 before = recipients[i].balance;
            vm.prank(recipients[i]);
            assertEq(ledger.claim(), credit);
            assertEq(recipients[i].balance, before + credit);
        }
        assertEq(_credits(), 0);
        assertEq(address(ledger).balance, 0);
        assertEq(ledger.totalAccrued(), ledger.totalClaimed());
    }

    function _schedule(Curve candidate, bool mature) private {
        vm.prank(CREATOR);
        registry.proposeMigration(address(asset), address(candidate), address(candidate).codehash, uint48(block.timestamp + 4 days));
        bytes32 digest = registry.migrationDigest(address(asset));
        registry.scheduleMigration(address(asset), _sign(digest, 1), _sign(digest, 2));
        if (mature) vm.warp(block.timestamp + registry.migrationDelay());
    }

    function _publish(Directory.ActionKind kind, uint32 version, address target) private {
        Directory.Action memory action = Directory.Action(kind, directory.nonce(), version, target, target.codehash,
            directory.signerSetEpoch(), uint48(block.timestamp + 4 days));
        bytes32 digest = directory.actionDigest(action);
        directory.schedule(action, _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(action);
    }

    function _sign(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _deploy(string memory name, bytes memory original, bytes memory arguments) private returns (address deployed) {
        bytes memory code = abi.encodePacked(canonicalProfile
            ? vm.parseJsonBytes(canonicalArtifacts, string.concat(".creationCode.", name)) : original, arguments);
        assembly ("memory-safe") { deployed := create(0, add(code, 32), mload(code)) }
        require(deployed != address(0), "synthetic canonical deployment failed");
    }
}
