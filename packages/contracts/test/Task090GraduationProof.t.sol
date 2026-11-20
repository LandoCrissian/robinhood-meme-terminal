// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveFactoryV2 as Factory} from "../src/RMTLaunchCurveFactoryV2.sol";
import {RMTLaunchCurveDeploymentV2} from "../src/RMTLaunchCurveDeploymentV2.sol";
import {RMTLaunchCurveLpFeeLedgerV1 as LpLedger} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {RMTLaunchCurveDirectoryV2 as Directory} from "../src/RMTLaunchCurveDirectoryV2.sol";
import {RMTLaunchProjectRegistryV3 as Registry} from "../src/RMTLaunchProjectRegistryV3.sol";
import {RMTV4CurveGraduationV1 as Graduation, ICurvePositionManagerV1, ICurvePermit2V1} from "../src/RMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1} from "../src/RMTV4CurveInitializationGuardV1.sol";

contract Task090GraduationUnlockProbe is IUnlockCallback {
    IPoolManager private immutable manager;
    constructor(IPoolManager manager_) { manager = manager_; }
    function attempt(Curve curve) external returns (bytes4) {
        return abi.decode(manager.unlock(abi.encode(curve)), (bytes4));
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (bool ok, bytes memory reason) = address(abi.decode(data, (Curve))).call(abi.encodeCall(Curve.graduate, (block.timestamp)));
        require(!ok, "nested graduation unexpectedly succeeded");
        return abi.encode(bytes4(reason));
    }
}

/// @notice Defensive local proof, not a production deployment or full security clearance.
/// @dev Exact observed PoolManager/PositionManager/Permit2 code, fresh synthetic storage.
///      Default source is 31337/1 ETH; the explicit canonical mode deploys exact 4663/2 ETH bytecode.
contract Task090GraduationProofTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using PositionInfoLibrary for PositionInfo;
    using stdStorage for StdStorage;

    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 constant PERMIT2_RUNTIME_HASH = 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca;
    IPoolManager manager;
    PositionManager positions;
    IAllowanceTransfer permit;
    Graduation engine;
    Factory factory;
    Task090GraduationUnlockProbe probe;
    address buyer = makeAddr("task090 buyer");
    address stranger = makeAddr("task090 stranger");
    address creator = makeAddr("task090 creator");
    uint256 serial;
    bool canonicalProfile;
    string canonicalArtifacts;

    struct Balances { uint256[8] native; uint256[8] token; }
    struct Edge { VmSafe.AccountAccessKind kind; address from; address to; bytes data; uint256 value; uint64 depth; }
    event ExactCallbackEdge(uint256 index, address caller, address target, bytes32 calldataHash, uint256 value, uint64 depth);
    event Conservation(address token, address curve, uint256[8] nativeBefore, uint256[8] nativeAfter,
        uint256[8] tokenBefore, uint256[8] tokenAfter, uint256 nativeUsed, uint256 tokenUsed,
        uint256 nativeDust, uint256 tokenDust, uint256 positionId, uint128 liquidity);

    function setUp() external {
        canonicalProfile = vm.envOr("RMT_TASK090_GRADUATION_CANONICAL", false);
        vm.chainId(canonicalProfile ? 4663 : 31337);
        if (canonicalProfile) {
            canonicalArtifacts = vm.readFile("test/fixtures/task090-migration-profile.json");
            assertEq(vm.parseJsonString(canonicalArtifacts, ".manifest.inputSha256"),
                "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10");
        }
        vm.warp(1_800_000_000);
        string memory runtimes = vm.readFile("test/fixtures/task090-canonical-v4-runtime.json");
        address managerAddress = vm.parseJsonAddress(runtimes, ".contracts.poolManager.address");
        address positionAddress = vm.parseJsonAddress(runtimes, ".contracts.positionManager.address");
        vm.etch(managerAddress, vm.parseJsonBytes(runtimes, ".contracts.poolManager.code"));
        vm.etch(positionAddress, vm.parseJsonBytes(runtimes, ".contracts.positionManager.code"));
        manager = IPoolManager(managerAddress);
        positions = PositionManager(payable(positionAddress));
        assertEq(managerAddress.codehash, 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626);
        assertEq(positionAddress.codehash, 0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2);
        // Fresh VM storage represents a new PositionManager's constructor counter.
        // It is neither copied production storage nor a production manager reset.
        stdstore.target(positionAddress).sig("nextTokenId()").checked_write(uint256(1));
        // The embedded Permit2 bytes are independently bound to both RPC witnesses.
        vm.etch(PERMIT2, _permit2Runtime());
        assertEq(PERMIT2.codehash, PERMIT2_RUNTIME_HASH);
        permit = IAllowanceTransfer(PERMIT2);
        assertEq(address(positions.poolManager()), managerAddress);
        assertEq(address(positions.permit2()), PERMIT2);
        Graduation.Dependencies memory dependencies = Graduation.Dependencies(manager,
            ICurvePositionManagerV1(address(positions)), ICurvePermit2V1(PERMIT2),
            address(manager).codehash, address(positions).codehash, PERMIT2_RUNTIME_HASH);
        Directory directory;
        Registry registry;
        if (canonicalProfile) {
            directory = Directory(_deploy("RMTLaunchCurveDirectoryV2", type(Directory).creationCode,
                abi.encode(vm.addr(1), vm.addr(2), vm.addr(3))));
            registry = Registry(_deploy("RMTLaunchProjectRegistryV3", type(Registry).creationCode, abi.encode(directory)));
        }
        RMTLaunchCurveSuccessorDeployerV1 successor = RMTLaunchCurveSuccessorDeployerV1(_deploy("RMTLaunchCurveSuccessorDeployerV1",
            type(RMTLaunchCurveSuccessorDeployerV1).creationCode, ""));
        address deploymentAddress = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address engineAddress = vm.computeCreateAddress(deploymentAddress, 2);
        (, bytes32 salt) = HookMiner.find(deploymentAddress, Hooks.BEFORE_INITIALIZE_FLAG,
            _creationCode("RMTV4CurveInitializationGuardV1", type(RMTV4CurveInitializationGuardV1).creationCode), abi.encode(manager, engineAddress));
        RMTLaunchCurveDeploymentV2 deployment = RMTLaunchCurveDeploymentV2(_deploy("RMTLaunchCurveDeploymentV2",
            type(RMTLaunchCurveDeploymentV2).creationCode, abi.encode(dependencies, salt,
                address(0x51), address(0x52), address(registry), address(successor), address(successor).codehash,
                canonicalProfile ? uint256(400_000_000_000_000) : 0)));
        engine = deployment.graduationEngine();
        factory = deployment.factory();
        if (canonicalProfile) {
            // Synthetic local authority only, with known test keys. No external RPC,
            // owner key, real publication or transaction is involved.
            Directory.Action memory action = Directory.Action(Directory.ActionKind.Publish, directory.nonce(), 1,
                address(factory), address(factory).codehash, directory.signerSetEpoch(), uint48(block.timestamp + 4 days));
            bytes32 digest = directory.actionDigest(action);
            directory.schedule(action, _syntheticSignature(digest, 1), _syntheticSignature(digest, 2));
            vm.warp(block.timestamp + directory.publicationDelay());
            directory.execute(action);
        }
        probe = new Task090GraduationUnlockProbe(manager);
        vm.deal(buyer, 20 ether);
        vm.deal(creator, 1 ether);
    }

    function testExactRealPermit2GraphConservesPrefundingAndOriginalPosition() external {
        (IERC20 sibling, Curve previous) = _fund();
        previous.graduate(block.timestamp);
        uint256 siblingManager = sibling.balanceOf(address(manager));
        (uint256 siblingId, uint128 siblingLiquidity) = engine.positions(address(sibling));
        (IERC20 token, Curve curve) = _fund();
        _prefund(token, curve, 31, 37);
        _graduateAndConserve(token, curve, true);
        assertEq(sibling.balanceOf(address(manager)), siblingManager);
        assertEq(positions.getPositionLiquidity(siblingId), siblingLiquidity);
        assertEq(positions.ownerOf(siblingId), address(engine));
    }

    function testFuzzRealPermit2ConservesIndependentPrefundedBalances(uint64 nativeSeed, uint64 tokenSeed) external {
        (IERC20 token, Curve curve) = _fund();
        _prefund(token, curve, bound(tokenSeed, 0, 1_000_000), bound(nativeSeed, 0, 1_000_000));
        _graduateAndConserve(token, curve, false);
    }

    function testSharedUnlockWithRealPermit2RollsBackAllStateThenRetries() external {
        (IERC20 token, Curve curve) = _fund();
        _prefund(token, curve, 101, 103);
        bytes32 beforeState = _digest(token, curve);
        assertEq(probe.attempt(curve), IPoolManager.AlreadyUnlocked.selector);
        assertEq(_digest(token, curve), beforeState);
        assertFalse(curve.graduated());
        _assertUninitialized(token, curve);
        _graduateAndConserve(token, curve, false);
    }

    function testWrongPermitExpiryRollsBackAllStateThenRetries() external {
        (IERC20 token, Curve curve) = _fund();
        _prefund(token, curve, 107, 109);
        bytes32 beforeState = _digest(token, curve);
        // First admit zero existing authority, then report the exact granted amount
        // with a wrong expiry. This independently reaches the expiry guard.
        Graduation.Funding memory expected = engine.previewFunding(curve.backingReserve(), curve.totalSupply() - curve.sold(),
            curve.virtualToken() - curve.sold(), curve.VIRTUAL_ETH() + curve.backingReserve());
        bytes[] memory responses = new bytes[](2);
        responses[0] = abi.encode(uint160(0), uint48(0), uint48(0));
        responses[1] = abi.encode(uint160(expected.tokenUsed), uint48(block.timestamp + 1), uint48(0));
        vm.mockCalls(PERMIT2, abi.encodeCall(ICurvePermit2V1.allowance, (address(engine), address(token), address(positions))), responses);
        vm.expectRevert(Graduation.SettlementMismatch.selector);
        curve.graduate(block.timestamp);
        vm.clearMockedCalls();
        assertEq(_digest(token, curve), beforeState);
        _assertUninitialized(token, curve);
        _graduateAndConserve(token, curve, false);
    }

    function testEachDependencyRuntimeSubstitutionFailsBeforeSettlement() external {
        (IERC20 token, Curve curve) = _fund();
        _prefund(token, curve, 113, 127);
        bytes32 beforeState = _digest(token, curve);
        address[3] memory dependencies = [address(manager), address(positions), PERMIT2];
        for (uint256 i; i < dependencies.length; ++i) {
            bytes memory priorCode = dependencies[i].code;
            vm.etch(dependencies[i], hex"00");
            vm.expectRevert(Graduation.InvalidDependencies.selector);
            curve.graduate(block.timestamp);
            vm.etch(dependencies[i], priorCode);
            assertEq(_digest(token, curve), beforeState);
            _assertUninitialized(token, curve);
        }
        _graduateAndConserve(token, curve, false);
    }

    function testUnapprovedThirdPartyCannotSpendInventoryOrCaptureOriginalNft() external {
        (IERC20 token, Curve curve) = _fund();
        bytes32 beforeState = _digest(token, curve);
        vm.expectRevert();
        vm.prank(stranger);
        permit.transferFrom(address(engine), stranger, 1, address(token));
        vm.expectRevert();
        vm.prank(stranger);
        token.transferFrom(address(curve), stranger, 1);
        assertEq(_digest(token, curve), beforeState);
        _graduateAndConserve(token, curve, false);
        beforeState = _digest(token, curve);
        uint256 positionId = curve.positionTokenId();
        vm.expectRevert();
        vm.prank(stranger);
        positions.transferFrom(address(engine), stranger, positionId);
        // Even the admitted PositionManager has no remaining finite token authority.
        vm.expectRevert();
        vm.prank(address(positions));
        permit.transferFrom(address(engine), stranger, 1, address(token));
        assertEq(_digest(token, curve), beforeState);
    }

    function _graduateAndConserve(IERC20 token, Curve curve, bool bindGraph) private {
        Balances memory before = _balances(token, curve);
        uint256 inventory = curve.totalSupply() - curve.sold();
        uint256 backing = curve.backingReserve();
        uint256 supply = token.totalSupply();
        uint256 nextId = positions.nextTokenId();
        Graduation.Funding memory expected = engine.previewFunding(backing, inventory,
            curve.virtualToken() - curve.sold(), curve.VIRTUAL_ETH() + backing);
        PoolKey memory key = engine.canonicalPoolKey(address(token));
        if (bindGraph) vm.startStateDiffRecording();
        vm.prank(stranger);
        curve.graduate(block.timestamp);
        if (bindGraph) _assertGraph(token, curve, key, expected, nextId, inventory, backing, vm.stopAndReturnStateDiff());
        Balances memory afterState = _balances(token, curve);
        for (uint256 i; i < before.native.length; ++i) {
            if (i == 0) {
                assertEq(afterState.native[i], before.native[i] - expected.nativeUsed);
                assertEq(afterState.token[i], before.token[i] - expected.tokenUsed);
            } else if (i == 2) {
                assertEq(afterState.native[i], before.native[i] + expected.nativeUsed);
                assertEq(afterState.token[i], before.token[i] + expected.tokenUsed);
            } else {
                assertEq(afterState.native[i], before.native[i]);
                assertEq(afterState.token[i], before.token[i]);
            }
        }
        assertEq(_sum(afterState.native), _sum(before.native));
        assertEq(_sum(afterState.token), _sum(before.token));
        assertEq(token.totalSupply(), supply);
        assertEq(curve.backingReserve(), 0);
        assertEq(curve.nativeDust(), backing - expected.nativeUsed);
        assertEq(curve.tokenDust(), inventory - expected.tokenUsed);
        assertTrue(curve.graduated());
        assertEq(curve.poolId(), PoolId.unwrap(key.toId()));
        assertEq(curve.positionTokenId(), nextId);
        assertEq(positions.nextTokenId(), nextId + 1);
        (uint256 id, uint128 liquidity) = engine.positions(address(token));
        assertEq(id, nextId);
        assertEq(liquidity, expected.liquidity);
        assertEq(positions.ownerOf(id), address(engine));
        assertEq(positions.getApproved(id), address(0));
        assertFalse(positions.isApprovedForAll(address(engine), stranger));
        assertEq(positions.getPositionLiquidity(id), expected.liquidity);
        (PoolKey memory actual, PositionInfo info) = positions.getPoolAndPositionInfo(id);
        assertEq(keccak256(abi.encode(actual)), keccak256(abi.encode(key)));
        assertEq(info.tickLower(), engine.TICK_LOWER());
        assertEq(info.tickUpper(), engine.TICK_UPPER());
        assertFalse(info.hasSubscriber());
        assertEq(manager.getLiquidity(key.toId()), expected.liquidity);
        assertEq(manager.currencyDelta(address(positions), key.currency0), 0);
        assertEq(manager.currencyDelta(address(positions), key.currency1), 0);
        assertEq(manager.getNonzeroDeltaCount(), 0);
        assertFalse(manager.isUnlocked());
        assertEq(token.allowance(address(curve), address(engine)), 0);
        assertEq(token.allowance(address(engine), PERMIT2), 0);
        (uint160 amount, uint48 expiry, uint48 nonce) = permit.allowance(address(engine), address(token), address(positions));
        assertEq(amount, 0);
        assertEq(expiry, block.timestamp);
        assertEq(nonce, 0);
        address ledger = address(engine.lpFeeLedger(address(token)));
        assertNotEq(ledger, address(0));
        assertEq(ledger.balance, 0);
        assertEq(token.balanceOf(ledger), 0);
        if (bindGraph) emit Conservation(address(token), address(curve), before.native, afterState.native,
            before.token, afterState.token, expected.nativeUsed, expected.tokenUsed,
            curve.nativeDust(), curve.tokenDust(), id, liquidity);
    }

    function _assertGraph(IERC20 token, Curve curve, PoolKey memory key, Graduation.Funding memory funding,
        uint256 id, uint256 inventory, uint256 backing, VmSafe.AccountAccess[] memory accesses) private {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, engine.TICK_LOWER(), engine.TICK_UPPER(), funding.liquidity,
            funding.nativeUsed, funding.tokenUsed, address(engine), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        bytes memory data = abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params);
        uint256 dust = backing - funding.nativeUsed;
        address ledger = address(engine.lpFeeLedger(address(token)));
        Edge[] memory expected = new Edge[](dust == 0 ? 20 : 21);
        uint256 n;
        expected[n++] = _call(stranger, address(curve), abi.encodeCall(Curve.graduate, (block.timestamp)), 0, 0);
        expected[n++] = _call(address(curve), address(token), abi.encodeCall(IERC20.approve, (address(engine), inventory)), 0, 1);
        expected[n++] = _call(address(curve), address(engine), abi.encodeCall(Graduation.graduate, (address(token), backing, inventory,
            curve.virtualToken() - curve.sold(), curve.VIRTUAL_ETH() + backing, block.timestamp)), backing, 1);
        expected[n++] = Edge(VmSafe.AccountAccessKind.Create, address(engine), ledger,
            bytes.concat(_creationCode("RMTLaunchCurveLpFeeLedgerV1", type(LpLedger).creationCode), abi.encode(token, address(manager), LpLedger.Policy(curve.creator(), curve.treasury(),
                curve.treasuryShareBps(), curve.operatingRecipient(), curve.futureReserveRecipient()))), 0, 2);
        expected[n++] = _call(address(engine), address(manager), abi.encodeCall(IPoolManager.initialize, (key, funding.sqrtPriceX96)), 0, 2);
        expected[n++] = _call(address(manager), address(key.hooks), abi.encodeCall(IHooks.beforeInitialize, (address(engine), key, funding.sqrtPriceX96)), 0, 3);
        expected[n++] = _call(address(engine), address(token), abi.encodeCall(IERC20.transferFrom, (address(curve), address(engine), funding.tokenUsed)), 0, 2);
        expected[n++] = _call(address(engine), address(token), abi.encodeCall(IERC20.approve, (PERMIT2, funding.tokenUsed)), 0, 2);
        expected[n++] = _call(address(engine), PERMIT2, abi.encodeCall(ICurvePermit2V1.approve, (address(token), address(positions), funding.tokenUsed, uint48(block.timestamp))), 0, 2);
        expected[n++] = _call(address(engine), address(positions), abi.encodeCall(ICurvePositionManagerV1.modifyLiquidities, (data, block.timestamp)), funding.nativeUsed, 2);
        expected[n++] = _call(address(positions), address(manager), abi.encodeCall(IPoolManager.unlock, (data)), 0, 3);
        expected[n++] = _call(address(manager), address(positions), abi.encodeCall(IUnlockCallback.unlockCallback, (data)), 0, 4);
        expected[n++] = _call(address(positions), address(manager), abi.encodeCall(IPoolManager.modifyLiquidity, (key,
            ModifyLiquidityParams(engine.TICK_LOWER(), engine.TICK_UPPER(), int256(uint256(funding.liquidity)), bytes32(id)), bytes(""))), 0, 5);
        expected[n++] = _call(address(positions), address(manager), abi.encodeCall(IPoolManager.sync, (key.currency0)), 0, 5);
        expected[n++] = _call(address(positions), address(manager), abi.encodeCall(IPoolManager.settle, ()), funding.nativeUsed, 5);
        expected[n++] = _call(address(positions), address(manager), abi.encodeCall(IPoolManager.sync, (key.currency1)), 0, 5);
        expected[n++] = _call(address(positions), PERMIT2, abi.encodeWithSignature("transferFrom(address,address,uint160,address)", address(engine), address(manager), funding.tokenUsed, address(token)), 0, 5);
        expected[n++] = _call(PERMIT2, address(token), abi.encodeCall(IERC20.transferFrom, (address(engine), address(manager), funding.tokenUsed)), 0, 6);
        expected[n++] = _call(address(positions), address(manager), abi.encodeCall(IPoolManager.settle, ()), 0, 5);
        if (dust != 0) expected[n++] = _call(address(engine), address(curve), bytes(""), dust, 2);
        expected[n++] = _call(address(curve), address(token), abi.encodeCall(IERC20.approve, (address(engine), 0)), 0, 1);
        assertEq(n, expected.length);
        uint256 cursor;
        uint64 baseDepth;
        assertLt(accesses.length, 180);
        for (uint256 i; i < accesses.length; ++i) {
            VmSafe.AccountAccess memory access = accesses[i];
            assertFalse(access.reverted, "failed internal frame");
            if (access.kind == VmSafe.AccountAccessKind.Call || access.kind == VmSafe.AccountAccessKind.Create) {
                assertLt(cursor, expected.length, "unexpected mutable callback");
                if (cursor == 0) baseDepth = access.depth;
                Edge memory edge = expected[cursor];
                assertEq(uint256(access.kind), uint256(edge.kind));
                assertEq(access.accessor, edge.from, "callback caller changed");
                assertEq(access.account, edge.to, "callback target changed");
                assertEq(keccak256(access.data), keccak256(edge.data), "callback calldata changed");
                assertEq(access.value, edge.value, "callback native value changed");
                assertEq(access.depth, baseDepth + edge.depth, "callback depth changed");
                emit ExactCallbackEdge(cursor++, access.accessor, access.account, keccak256(access.data), access.value, edge.depth);
            } else if (access.kind == VmSafe.AccountAccessKind.StaticCall) {
                assertTrue(_knownRead(access.account, token, curve, ledger), "unexpected static target");
                assertEq(access.value, 0);
            } else {
                assertTrue(access.kind == VmSafe.AccountAccessKind.Resume || access.kind == VmSafe.AccountAccessKind.Balance
                    || access.kind == VmSafe.AccountAccessKind.Extcodesize || access.kind == VmSafe.AccountAccessKind.Extcodehash
                    || access.kind == VmSafe.AccountAccessKind.Extcodecopy, "unexpected execution kind");
            }
        }
        assertEq(cursor, expected.length, "missing mutable callback");
    }

    function _call(address from, address to, bytes memory data, uint256 value, uint64 depth) private pure returns (Edge memory) {
        return Edge(VmSafe.AccountAccessKind.Call, from, to, data, value, depth);
    }

    function _knownRead(address target, IERC20 token, Curve curve, address ledger) private view returns (bool) {
        return target == address(token) || target == address(curve) || target == address(engine) || target == address(factory)
            || target == address(manager) || target == address(positions) || target == PERMIT2 || target == ledger
            || target == address(engine.initializationGuard());
    }

    function _fund() private returns (IERC20 token, Curve curve) {
        ++serial;
        uint256 creationFee = factory.creationFeeWei();
        vm.prank(creator);
        (address asset, address market) = factory.create{value: creationFee}("Task090 graduation proof", "T090", "", address(0), 0, bytes32(serial), block.timestamp);
        token = IERC20(asset);
        curve = Curve(payable(market));
        assertEq(curve.GRADUATION_BACKING(), canonicalProfile ? 2 ether : 1 ether);
        uint256 terminalSold = curve.graduationSold();
        uint256 payment = curve.GRADUATION_BACKING() * 2;
        vm.prank(buyer);
        curve.buy{value: payment}(terminalSold, block.timestamp);
    }

    function _prefund(IERC20 token, Curve curve, uint256 tokenAmount, uint256 nativeAmount) private {
        address[5] memory accounts = [address(curve), address(engine), address(manager), address(positions), PERMIT2];
        for (uint256 i; i < accounts.length; ++i) {
            vm.prank(buyer);
            assertTrue(token.transfer(accounts[i], tokenAmount + i));
            vm.deal(accounts[i], accounts[i].balance + nativeAmount + i);
        }
    }

    function _balances(IERC20 token, Curve curve) private view returns (Balances memory result) {
        // Exact index order is retained in the evidence README and Conservation event.
        address[8] memory accounts = [address(curve), address(engine), address(manager), address(positions), PERMIT2,
            buyer, address(curve.revenueLedger()), stranger];
        for (uint256 i; i < accounts.length; ++i) {
            result.native[i] = accounts[i].balance;
            result.token[i] = token.balanceOf(accounts[i]);
        }
    }

    function _digest(IERC20 token, Curve curve) private view returns (bytes32) {
        PoolKey memory key = engine.canonicalPoolKey(address(token));
        (uint160 sqrtPrice,,,) = manager.getSlot0(key.toId());
        (uint256 id, uint128 liquidity) = engine.positions(address(token));
        (uint160 allowance, uint48 expiry, uint48 nonce) = permit.allowance(address(engine), address(token), address(positions));
        return keccak256(abi.encode(_balances(token, curve), token.totalSupply(), curve.sold(), curve.backingReserve(),
            curve.graduated(), curve.poolId(), curve.positionTokenId(), curve.nativeDust(), curve.tokenDust(),
            token.allowance(address(curve), address(engine)), token.allowance(address(engine), PERMIT2), allowance, expiry, nonce,
            positions.nextTokenId(), sqrtPrice, manager.getLiquidity(key.toId()), id, liquidity,
            address(engine.lpFeeLedger(address(token))), manager.getNonzeroDeltaCount(), manager.isUnlocked()));
    }

    function _assertUninitialized(IERC20 token, Curve curve) private view {
        (uint160 price,,,) = manager.getSlot0(engine.canonicalPoolKey(address(token)).toId());
        assertEq(price, 0);
        assertEq(curve.backingReserve(), curve.GRADUATION_BACKING());
        assertFalse(curve.graduated());
        assertEq(token.allowance(address(curve), address(engine)), 0);
        assertEq(token.allowance(address(engine), PERMIT2), 0);
        (uint160 amount,,) = permit.allowance(address(engine), address(token), address(positions));
        assertEq(amount, 0);
        (uint256 id, uint128 liquidity) = engine.positions(address(token));
        assertEq(id, 0);
        assertEq(liquidity, 0);
        assertEq(address(engine.lpFeeLedger(address(token))), address(0));
    }

    function _sum(uint256[8] memory values) private pure returns (uint256 result) {
        for (uint256 i; i < values.length; ++i) result += values[i];
    }

    function _creationCode(string memory name, bytes memory original) private view returns (bytes memory) {
        return canonicalProfile ? vm.parseJsonBytes(canonicalArtifacts, string.concat(".creationCode.", name)) : original;
    }

    function _deploy(string memory name, bytes memory original, bytes memory arguments) private returns (address deployedAddress) {
        bytes memory code = bytes.concat(_creationCode(name, original), arguments);
        assembly ("memory-safe") { deployedAddress := create(0, add(code, 32), mload(code)) }
        require(deployedAddress != address(0), "local canonical constructor failed");
    }

    function _syntheticSignature(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _permit2Runtime() private pure returns (bytes memory) {
        return hex"6040608081526004908136101561001557600080fd5b600090813560e01c80630d58b1db1461126c578063137c29fe146110755780632a2d80d114610db75780632b67b57014610bde57806330f28b7a14610ade5780633644e51514610a9d57806336c7851614610a285780633ff9dcb1146109a85780634fe02b441461093f57806365d9723c146107ac57806387517c451461067a578063927da105146105c3578063cc53287f146104a3578063edd9444b1461033a5763fe8ec1a7146100c657600080fd5b346103365760c07ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126103365767ffffffffffffffff833581811161033257610114903690860161164b565b60243582811161032e5761012b903690870161161a565b6101336114e6565b9160843585811161032a5761014b9036908a016115c1565b98909560a43590811161032657610164913691016115c1565b969095815190610173826113ff565b606b82527f5065726d697442617463685769746e6573735472616e7366657246726f6d285460208301527f6f6b656e5065726d697373696f6e735b5d207065726d69747465642c61646472838301527f657373207370656e6465722c75696e74323536206e6f6e63652c75696e74323560608301527f3620646561646c696e652c000000000000000000000000000000000000000000608083015282519a8b9181610222602085018096611f93565b918237018a8152039961025b7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe09b8c8101835282611437565b5190209085515161026b81611ebb565b908a5b8181106102f95750506102f6999a6102ed9183516102a081610294602082018095611f66565b03848101835282611437565b519020602089810151858b015195519182019687526040820192909252336060820152608081019190915260a081019390935260643560c08401528260e081015b03908101835282611437565b51902093611cf7565b80f35b8061031161030b610321938c5161175e565b51612054565b61031b828661175e565b52611f0a565b61026e565b8880fd5b8780fd5b8480fd5b8380fd5b5080fd5b5091346103365760807ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126103365767ffffffffffffffff9080358281116103325761038b903690830161164b565b60243583811161032e576103a2903690840161161a565b9390926103ad6114e6565b9160643590811161049f576103c4913691016115c1565b949093835151976103d489611ebb565b98885b81811061047d5750506102f697988151610425816103f9602082018095611f66565b037fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe08101835282611437565b5190206020860151828701519083519260208401947ffcf35f5ac6a2c28868dc44c302166470266239195f02b0ee408334829333b7668652840152336060840152608083015260a082015260a081526102ed8161141b565b808b61031b8261049461030b61049a968d5161175e565b9261175e565b6103d7565b8680fd5b5082346105bf57602090817ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126103325780359067ffffffffffffffff821161032e576104f49136910161161a565b929091845b848110610504578580f35b8061051a610515600193888861196c565b61197c565b61052f84610529848a8a61196c565b0161197c565b3389528385528589209173ffffffffffffffffffffffffffffffffffffffff80911692838b528652868a20911690818a5285528589207fffffffffffffffffffffffff000000000000000000000000000000000000000081541690558551918252848201527f89b1add15eff56b3dfe299ad94e01f2b52fbcb80ae1a3baea6ae8c04cb2b98a4853392a2016104f9565b8280fd5b50346103365760607ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261033657610676816105ff6114a0565b936106086114c3565b6106106114e6565b73ffffffffffffffffffffffffffffffffffffffff968716835260016020908152848420928816845291825283832090871683528152919020549251938316845260a083901c65ffffffffffff169084015260d09190911c604083015281906060820190565b0390f35b50346103365760807ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610336576106b26114a0565b906106bb6114c3565b916106c46114e6565b65ffffffffffff926064358481169081810361032a5779ffffffffffff0000000000000000000000000000000000000000947fda9fa7c1b00402c17d0161b249b1ab8bbec047c5a52207b9c112deffd817036b94338a5260016020527fffffffffffff0000000000000000000000000000000000000000000000000000858b209873ffffffffffffffffffffffffffffffffffffffff809416998a8d5260205283878d209b169a8b8d52602052868c209486156000146107a457504216925b8454921697889360a01b16911617179055815193845260208401523392a480f35b905092610783565b5082346105bf5760607ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126105bf576107e56114a0565b906107ee6114c3565b9265ffffffffffff604435818116939084810361032a57338852602091600183528489209673ffffffffffffffffffffffffffffffffffffffff80911697888b528452858a20981697888a5283528489205460d01c93848711156109175761ffff9085840316116108f05750907f55eb90d810e1700b35a8e7e25395ff7f2b2259abd7415ca2284dfb1c246418f393929133895260018252838920878a528252838920888a5282528389209079ffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffff000000000000000000000000000000000000000000000000000083549260d01b16911617905582519485528401523392a480f35b84517f24d35a26000000000000000000000000000000000000000000000000000000008152fd5b5084517f756688fe000000000000000000000000000000000000000000000000000000008152fd5b503461033657807ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610336578060209273ffffffffffffffffffffffffffffffffffffffff61098f6114a0565b1681528084528181206024358252845220549051908152f35b5082346105bf57817ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126105bf577f3704902f963766a4e561bbaab6e6cdc1b1dd12f6e9e99648da8843b3f46b918d90359160243533855284602052818520848652602052818520818154179055815193845260208401523392a280f35b8234610a9a5760807ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610a9a57610a606114a0565b610a686114c3565b610a706114e6565b6064359173ffffffffffffffffffffffffffffffffffffffff8316830361032e576102f6936117a1565b80fd5b503461033657817ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261033657602090610ad7611b1e565b9051908152f35b508290346105bf576101007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126105bf57610b1a3661152a565b90807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7c36011261033257610b4c611478565b9160e43567ffffffffffffffff8111610bda576102f694610b6f913691016115c1565b939092610b7c8351612054565b6020840151828501519083519260208401947f939c21a48a8dbe3a9a2404a1d46691e4d39f6583d6ec6b35714604c986d801068652840152336060840152608083015260a082015260a08152610bd18161141b565b51902091611c25565b8580fd5b509134610336576101007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261033657610c186114a0565b7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc360160c08112610332576080855191610c51836113e3565b1261033257845190610c6282611398565b73ffffffffffffffffffffffffffffffffffffffff91602435838116810361049f578152604435838116810361049f57602082015265ffffffffffff606435818116810361032a5788830152608435908116810361049f576060820152815260a435938285168503610bda576020820194855260c4359087830182815260e43567ffffffffffffffff811161032657610cfe90369084016115c1565b929093804211610d88575050918591610d786102f6999a610d7e95610d238851611fbe565b90898c511690519083519260208401947ff3841cd1ff0085026a6327b620b67997ce40f282c88a8e905a7a5626e310f3d086528401526060830152608082015260808152610d70816113ff565b519020611bd9565b916120c7565b519251169161199d565b602492508a51917fcd21db4f000000000000000000000000000000000000000000000000000000008352820152fd5b5091346103365760607ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc93818536011261033257610df36114a0565b9260249081359267ffffffffffffffff9788851161032a578590853603011261049f578051978589018981108282111761104a578252848301358181116103265785019036602383011215610326578382013591610e50836115ef565b90610e5d85519283611437565b838252602093878584019160071b83010191368311611046578801905b828210610fe9575050508a526044610e93868801611509565b96838c01978852013594838b0191868352604435908111610fe557610ebb90369087016115c1565b959096804211610fba575050508998995151610ed681611ebb565b908b5b818110610f9757505092889492610d7892610f6497958351610f02816103f98682018095611f66565b5190209073ffffffffffffffffffffffffffffffffffffffff9a8b8b51169151928551948501957faf1b0d30d2cab0380e68f0689007e3254993c596f2fdd0aaa7f4d04f794408638752850152830152608082015260808152610d70816113ff565b51169082515192845b848110610f78578580f35b80610f918585610f8b600195875161175e565b5161199d565b01610f6d565b80610311610fac8e9f9e93610fb2945161175e565b51611fbe565b9b9a9b610ed9565b8551917fcd21db4f000000000000000000000000000000000000000000000000000000008352820152fd5b8a80fd5b6080823603126110465785608091885161100281611398565b61100b85611509565b8152611018838601611509565b838201526110278a8601611607565b8a8201528d611037818701611607565b90820152815201910190610e7a565b8c80fd5b84896041867f4e487b7100000000000000000000000000000000000000000000000000000000835252fd5b5082346105bf576101407ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126105bf576110b03661152a565b91807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7c360112610332576110e2611478565b67ffffffffffffffff93906101043585811161049f5761110590369086016115c1565b90936101243596871161032a57611125610bd1966102f6983691016115c1565b969095825190611134826113ff565b606482527f5065726d69745769746e6573735472616e7366657246726f6d28546f6b656e5060208301527f65726d697373696f6e73207065726d69747465642c6164647265737320737065848301527f6e6465722c75696e74323536206e6f6e63652c75696e7432353620646561646c60608301527f696e652c0000000000000000000000000000000000000000000000000000000060808301528351948591816111e3602085018096611f93565b918237018b8152039361121c7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe095868101835282611437565b5190209261122a8651612054565b6020878101518589015195519182019687526040820192909252336060820152608081019190915260a081019390935260e43560c08401528260e081016102e1565b5082346105bf576020807ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261033257813567ffffffffffffffff92838211610bda5736602383011215610bda5781013592831161032e576024906007368386831b8401011161049f57865b8581106112e5578780f35b80821b83019060807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc83360301126103265761139288876001946060835161132c81611398565b611368608461133c8d8601611509565b9485845261134c60448201611509565b809785015261135d60648201611509565b809885015201611509565b918291015273ffffffffffffffffffffffffffffffffffffffff80808093169516931691166117a1565b016112da565b6080810190811067ffffffffffffffff8211176113b457604052565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6060810190811067ffffffffffffffff8211176113b457604052565b60a0810190811067ffffffffffffffff8211176113b457604052565b60c0810190811067ffffffffffffffff8211176113b457604052565b90601f7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0910116810190811067ffffffffffffffff8211176113b457604052565b60c4359073ffffffffffffffffffffffffffffffffffffffff8216820361149b57565b600080fd5b6004359073ffffffffffffffffffffffffffffffffffffffff8216820361149b57565b6024359073ffffffffffffffffffffffffffffffffffffffff8216820361149b57565b6044359073ffffffffffffffffffffffffffffffffffffffff8216820361149b57565b359073ffffffffffffffffffffffffffffffffffffffff8216820361149b57565b7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc01906080821261149b576040805190611563826113e3565b8082941261149b57805181810181811067ffffffffffffffff8211176113b457825260043573ffffffffffffffffffffffffffffffffffffffff8116810361149b578152602435602082015282526044356020830152606435910152565b9181601f8401121561149b5782359167ffffffffffffffff831161149b576020838186019501011161149b57565b67ffffffffffffffff81116113b45760051b60200190565b359065ffffffffffff8216820361149b57565b9181601f8401121561149b5782359167ffffffffffffffff831161149b576020808501948460061b01011161149b57565b91909160608184031261149b576040805191611666836113e3565b8294813567ffffffffffffffff9081811161149b57830182601f8201121561149b578035611693816115ef565b926116a087519485611437565b818452602094858086019360061b8501019381851161149b579086899897969594939201925b8484106116e3575050505050855280820135908501520135910152565b90919293949596978483031261149b578851908982019082821085831117611730578a928992845261171487611509565b81528287013583820152815201930191908897969594936116c6565b602460007f4e487b710000000000000000000000000000000000000000000000000000000081526041600452fd5b80518210156117725760209160051b010190565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052603260045260246000fd5b92919273ffffffffffffffffffffffffffffffffffffffff604060008284168152600160205282828220961695868252602052818120338252602052209485549565ffffffffffff8760a01c16804211611884575082871696838803611812575b5050611810955016926118b5565b565b878484161160001461184f57602488604051907ff96fb0710000000000000000000000000000000000000000000000000000000082526004820152fd5b7fffffffffffffffffffffffff000000000000000000000000000000000000000084846118109a031691161790553880611802565b602490604051907fd81b2f2e0000000000000000000000000000000000000000000000000000000082526004820152fd5b9060006064926020958295604051947f23b872dd0000000000000000000000000000000000000000000000000000000086526004860152602485015260448401525af13d15601f3d116001600051141617161561190e57565b60646040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601460248201527f5452414e534645525f46524f4d5f4641494c45440000000000000000000000006044820152fd5b91908110156117725760061b0190565b3573ffffffffffffffffffffffffffffffffffffffff8116810361149b5790565b9065ffffffffffff908160608401511673ffffffffffffffffffffffffffffffffffffffff908185511694826020820151169280866040809401511695169560009187835260016020528383208984526020528383209916988983526020528282209184835460d01c03611af5579185611ace94927fc6a377bfc4eb120024a8ac08eef205be16b817020812c73223e81d1bdb9708ec98979694508715600014611ad35779ffffffffffff00000000000000000000000000000000000000009042165b60a01b167fffffffffffff00000000000000000000000000000000000000000000000000006001860160d01b1617179055519384938491604091949373ffffffffffffffffffffffffffffffffffffffff606085019616845265ffffffffffff809216602085015216910152565b0390a4565b5079ffffffffffff000000000000000000000000000000000000000087611a60565b600484517f756688fe000000000000000000000000000000000000000000000000000000008152fd5b467f000000000000000000000000000000000000000000000000000000000000123703611b69577f448684463b1f7965c1ec7c249cee11520df24c07242efc2b20f6e54c85614fad90565b60405160208101907f8cad95687ba82c2ce50e74f7b754645e5117c3a5bec8151c0726d5857980a86682527f9ac997416e8ff9d2ff6bebeb7149f65cdae5e32e2b90440b566bb3044041d36a604082015246606082015230608082015260808152611bd3816113ff565b51902090565b611be1611b1e565b906040519060208201927f190100000000000000000000000000000000000000000000000000000000000084526022830152604282015260428152611bd381611398565b9192909360a435936040840151804211611cc65750602084510151808611611c955750918591610d78611c6594611c60602088015186611e47565b611bd9565b73ffffffffffffffffffffffffffffffffffffffff809151511692608435918216820361149b57611810936118b5565b602490604051907f3728b83d0000000000000000000000000000000000000000000000000000000082526004820152fd5b602490604051907fcd21db4f0000000000000000000000000000000000000000000000000000000082526004820152fd5b959093958051519560409283830151804211611e175750848803611dee57611d2e918691610d7860209b611c608d88015186611e47565b60005b868110611d42575050505050505050565b611d4d81835161175e565b5188611d5a83878a61196c565b01359089810151808311611dbe575091818888886001968596611d84575b50505050505001611d31565b611db395611dad9273ffffffffffffffffffffffffffffffffffffffff6105159351169561196c565b916118b5565b803888888883611d78565b6024908651907f3728b83d0000000000000000000000000000000000000000000000000000000082526004820152fd5b600484517fff633a38000000000000000000000000000000000000000000000000000000008152fd5b6024908551907fcd21db4f0000000000000000000000000000000000000000000000000000000082526004820152fd5b9073ffffffffffffffffffffffffffffffffffffffff600160ff83161b9216600052600060205260406000209060081c6000526020526040600020818154188091551615611e9157565b60046040517f756688fe000000000000000000000000000000000000000000000000000000008152fd5b90611ec5826115ef565b611ed26040519182611437565b8281527fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0611f0082946115ef565b0190602036910137565b7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8114611f375760010190565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b805160208092019160005b828110611f7f575050505090565b835185529381019392810192600101611f71565b9081519160005b838110611fab575050016000815290565b8060208092840101518185015201611f9a565b60405160208101917f65626cad6cb96493bf6f5ebea28756c966f023ab9e8a83a7101849d5573b3678835273ffffffffffffffffffffffffffffffffffffffff8082511660408401526020820151166060830152606065ffffffffffff9182604082015116608085015201511660a082015260a0815260c0810181811067ffffffffffffffff8211176113b45760405251902090565b6040516020808201927f618358ac3db8dc274f0cd8829da7e234bd48cd73c4a740aede1adec9846d06a1845273ffffffffffffffffffffffffffffffffffffffff81511660408401520151606082015260608152611bd381611398565b919082604091031261149b576020823592013590565b6000843b61222e5750604182036121ac576120e4828201826120b1565b939092604010156117725760209360009360ff6040608095013560f81c5b60405194855216868401526040830152606082015282805260015afa156121a05773ffffffffffffffffffffffffffffffffffffffff806000511691821561217657160361214c57565b60046040517f815e1d64000000000000000000000000000000000000000000000000000000008152fd5b60046040517f8baa579f000000000000000000000000000000000000000000000000000000008152fd5b6040513d6000823e3d90fd5b60408203612204576121c0918101906120b1565b91601b7f7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff84169360ff1c019060ff8211611f375760209360009360ff608094612102565b60046040517f4be6321b000000000000000000000000000000000000000000000000000000008152fd5b929391601f928173ffffffffffffffffffffffffffffffffffffffff60646020957fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0604051988997889687947f1626ba7e000000000000000000000000000000000000000000000000000000009e8f8752600487015260406024870152816044870152868601378b85828601015201168101030192165afa9081156123a857829161232a575b507fffffffff000000000000000000000000000000000000000000000000000000009150160361230057565b60046040517fb0669cbc000000000000000000000000000000000000000000000000000000008152fd5b90506020813d82116123a0575b8161234460209383611437565b810103126103365751907fffffffff0000000000000000000000000000000000000000000000000000000082168203610a9a57507fffffffff0000000000000000000000000000000000000000000000000000000090386122d4565b3d9150612337565b6040513d84823e3d90fdfea164736f6c6343000811000a";
    }
}
