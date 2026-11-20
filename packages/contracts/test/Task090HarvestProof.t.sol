// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {RMTLaunchCurveDeploymentV2} from "../src/RMTLaunchCurveDeploymentV2.sol";
import {RMTLaunchCurveFactoryV2} from "../src/RMTLaunchCurveFactoryV2.sol";
import {RMTLaunchBondingCurveV1} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveLpFeeLedgerV1} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {ICurvePermit2V1, ICurvePositionManagerV1, RMTV4CurveGraduationV1} from "../src/RMTV4CurveGraduationV1.sol";

/// @dev A hostile beneficiary is a real callback recipient, never a mocked ledger.
contract Task090LpClaimProbe {
    RMTV4CurveGraduationV1 public engine;
    address public token;
    RMTLaunchCurveLpFeeLedgerV1 public ledger;
    bool public probe;
    bool public rejectNative;
    bytes4 public nestedClaimError;
    bytes4 public nestedHarvestError;

    function configure(RMTV4CurveGraduationV1 e, address t, RMTLaunchCurveLpFeeLedgerV1 l, bool p, bool r) external {
        engine = e; token = t; ledger = l; probe = p; rejectNative = r;
    }
    function claim() external { ledger.claim(); }
    function claimToken() external { ledger.claimAsset(false); }
    receive() external payable {
        require(msg.sender == address(ledger));
        require(!rejectNative, "synthetic beneficiary rejects native payment");
        if (probe) {
            (bool claimed, bytes memory claimError) = address(ledger).call(abi.encodeCall(ledger.claim, ()));
            require(!claimed, "nested claim unexpectedly succeeded");
            nestedClaimError = bytes4(claimError);
            (bool harvested, bytes memory harvestError) = address(engine).call(
                abi.encodeCall(engine.collectLpFees, (token, block.timestamp))
            );
            require(!harvested, "same-ledger harvest unexpectedly succeeded during claim");
            nestedHarvestError = bytes4(harvestError);
        }
    }
}

contract Task090HarvestUnlockProbe is IUnlockCallback {
    IPoolManager private immutable manager;
    constructor(IPoolManager m) { manager = m; }
    function attempt(address engine, bytes memory data) external returns (bytes4) {
        return abi.decode(manager.unlock(abi.encode(engine, data)), (bytes4));
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (address engine, bytes memory request) = abi.decode(data, (address, bytes));
        (bool ok, bytes memory reason) = engine.call(request);
        require(!ok, "nested manager harvest unexpectedly succeeded");
        return abi.encode(bytes4(reason));
    }
}

contract Task090ForcedNative {
    constructor(address payable recipient) payable { selfdestruct(recipient); }
}

/// @notice One finding only: c7bf2ac4fa4f... LP harvest balance baseline.
/// Actual observed code runs at its pinned addresses in a fresh synthetic VM.
/// This is not a fork, production storage, live attack, or whole-stage clearance.
contract Task090HarvestProofTest is Test {
    using stdStorage for StdStorage;
    using PoolIdLibrary for PoolKey;
    using PositionInfoLibrary for PositionInfo;
    using StateLibrary for IPoolManager;

    bytes32 private constant MANAGER_HASH = 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    bytes32 private constant POSITIONS_HASH = 0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2;
    bytes32 private constant PERMIT_HASH = 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca;
    IPoolManager private manager;
    PositionManager private positions;
    ICurvePermit2V1 private permit;
    RMTV4CurveGraduationV1 private engine;
    RMTLaunchCurveFactoryV2 private factory;
    RMTLaunchBondingCurveV1 private curve;
    RMTLaunchCurveLpFeeLedgerV1 private ledger;
    IERC20 private asset;
    PoolKey private key;
    uint256 private originalId;
    uint128 private originalPrincipal;
    address private creator = makeAddr("harvest proof creator");
    address private buyer = makeAddr("harvest proof buyer");
    address private operating = makeAddr("harvest proof operations");
    address private reserve = makeAddr("harvest proof reserve");
    address private stranger = makeAddr("harvest proof stranger");
    Task090LpClaimProbe private beneficiary;

    struct Snapshot {
        uint256 managerNative; uint256 managerToken;
        uint256 engineNative; uint256 engineToken;
        uint256 ledgerNative; uint256 ledgerToken;
        uint256 curveNative; uint256 curveToken;
        uint256 buyerNative; uint256 buyerToken;
        uint256 strangerNative; uint256 strangerToken;
        uint256 accruedNative; uint256 accruedToken;
        uint256 claimedNative; uint256 claimedToken;
        uint256 pendingNative; uint256 pendingToken;
        uint256 id; uint128 principal; uint128 poolLiquidity;
        address owner; address approved;
        uint256[4] creditsNative; uint256[4] creditsToken;
        uint256[4] balancesNative; uint256[4] balancesToken;
    }
    event ConservationSnapshot(string stage, Snapshot state);

    function setUp() external {
        vm.chainId(31337);
        vm.deal(address(this), 50 ether); vm.deal(creator, 1 ether); vm.deal(buyer, 20 ether);
        string memory runtime = vm.readFile("./test/fixtures/task090-canonical-v4-runtime.json");
        manager = IPoolManager(_etch(runtime, "poolManager", MANAGER_HASH));
        positions = PositionManager(payable(_etch(runtime, "positionManager", POSITIONS_HASH)));
        permit = ICurvePermit2V1(_etch(runtime, "permit2", PERMIT_HASH));
        assertEq(address(positions.poolManager()), address(manager));
        assertEq(address(positions.permit2()), address(permit));
        // Fresh synthetic storage, not copied production storage. Initialize the
        // constructor's next-token counter before creating synthetic positions.
        stdstore.target(address(positions)).sig("nextTokenId()").checked_write(1);
        string memory profile = vm.readFile("./test/fixtures/task090-harvest-profile.json");
        assertEq(vm.parseJsonUint(profile, ".manifest.chainId"), 31337);
        assertEq(vm.parseUint(vm.parseJsonString(profile, ".manifest.terms.graduationBackingWei")), 2 ether);
        bytes memory successorCode = vm.parseJsonBytes(profile, ".artifacts.RMTLaunchCurveSuccessorDeployerV1.bytecode");
        address successor = _deploy(successorCode, "");
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes memory guardCode = vm.parseJsonBytes(profile, ".artifacts.RMTV4CurveInitializationGuardV1.bytecode");
        (, bytes32 salt) = HookMiner.find(predicted, Hooks.BEFORE_INITIALIZE_FLAG, guardCode,
            abi.encode(manager, vm.computeCreateAddress(predicted, 2)));
        RMTV4CurveGraduationV1.Dependencies memory dependencies = RMTV4CurveGraduationV1.Dependencies(
            manager, ICurvePositionManagerV1(address(positions)), permit, MANAGER_HASH, POSITIONS_HASH, PERMIT_HASH
        );
        RMTLaunchCurveDeploymentV2 deployment = RMTLaunchCurveDeploymentV2(_deploy(
            vm.parseJsonBytes(profile, ".artifacts.RMTLaunchCurveDeploymentV2.bytecode"),
            abi.encode(dependencies, salt, operating, reserve, address(0), successor, successor.codehash, 0.0004 ether)
        ));
        factory = deployment.factory(); engine = deployment.graduationEngine();
        beneficiary = new Task090LpClaimProbe();
        vm.prank(creator);
        (address token, address market) = factory.create{value: 0.0004 ether}(
            "Synthetic harvest proof", "HP090", "", address(beneficiary), 2250,
            keccak256("task090 synthetic harvest proof"), block.timestamp
        );
        asset = IERC20(token); curve = RMTLaunchBondingCurveV1(payable(market));
        assertEq(curve.GRADUATION_BACKING(), 2 ether); assertEq(curve.VIRTUAL_ETH(), 4 ether);
        vm.prank(buyer); curve.buy{value: 3 ether}(600_000_000 ether, block.timestamp);
        curve.graduate(block.timestamp);
        key = engine.canonicalPoolKey(token); (originalId, originalPrincipal) = engine.positions(token);
        ledger = engine.lpFeeLedger(token);
        beneficiary.configure(engine, token, ledger, false, false);
        _assertCustody();
    }

    function testCanonicalRuntimeHarvestConservesBothCurrenciesAndOriginalOnlyEntitlements() external {
        uint256 outsideId = _mintOutside(); uint128 outsidePrincipal = positions.getPositionLiquidity(outsideId);
        _swapBothWays();
        // Preexisting untracked surplus cannot compensate for or become earned fees.
        new Task090ForcedNative{value: 23}(payable(address(ledger)));
        new Task090ForcedNative{value: 11}(payable(address(manager)));
        vm.startPrank(buyer); asset.transfer(address(ledger), 41); asset.transfer(address(manager), 29); vm.stopPrank();
        Snapshot memory before = _snapshot();
        (uint256 paidNative, uint256 paidToken) = engine.collectLpFees(address(asset), block.timestamp);
        _assertHarvest(before, paidNative, paidToken);
        assertEq(positions.ownerOf(outsideId), buyer);
        assertEq(positions.getPositionLiquidity(outsideId), outsidePrincipal);
        _claimAll();
        assertEq(address(ledger).balance, 23); assertEq(asset.balanceOf(address(ledger)), 41);
        (uint256 accruedNative, uint256 accruedToken) = ledger.totalAccrued();
        (uint256 claimedNative, uint256 claimedToken) = ledger.totalClaimed();
        assertEq(accruedNative, claimedNative); assertEq(accruedToken, claimedToken);
        Snapshot memory settled = _snapshot();
        vm.expectRevert(RMTV4CurveGraduationV1.NoLpFees.selector);
        engine.collectLpFees(address(asset), block.timestamp);
        assertEq(keccak256(abi.encode(_snapshot())), keccak256(abi.encode(settled)));
        _swapBothWays(); before = _snapshot();
        (paidNative, paidToken) = engine.collectLpFees(address(asset), block.timestamp);
        _assertHarvest(before, paidNative, paidToken); _assertCustody();
    }

    function testSharedManagerUnlockRefusesHarvestWithoutChangingAnyPriorCreditOrPrincipal() external {
        _swapBothWays(); engine.collectLpFees(address(asset), block.timestamp); _swapBothWays();
        Snapshot memory before = _snapshot();
        Task090HarvestUnlockProbe probe = new Task090HarvestUnlockProbe(manager);
        assertEq(probe.attempt(address(engine), abi.encodeCall(engine.collectLpFees, (address(asset), block.timestamp))),
            IPoolManager.AlreadyUnlocked.selector);
        assertEq(keccak256(abi.encode(_snapshot())), keccak256(abi.encode(before)));
        (uint256 n, uint256 t) = engine.collectLpFees(address(asset), block.timestamp);
        _assertHarvest(before, n, t);
    }

    function testClaimCallbackCannotReenterCreditOrCompleteSameLedgerHarvest() external {
        _swapBothWays(); engine.collectLpFees(address(asset), block.timestamp); _swapBothWays();
        Snapshot memory before = _snapshot();
        (uint256 nativeCredit, uint256 tokenCredit) = ledger.claimable(address(beneficiary));
        beneficiary.configure(engine, address(asset), ledger, true, false); beneficiary.claim();
        assertEq(beneficiary.nestedClaimError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(beneficiary.nestedHarvestError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        Snapshot memory afterClaim = _snapshot();
        emit ConservationSnapshot("claim-callback-before", before);
        emit ConservationSnapshot("claim-callback-after", afterClaim);
        assertEq(afterClaim.managerNative, before.managerNative); assertEq(afterClaim.managerToken, before.managerToken);
        assertEq(afterClaim.pendingNative, before.pendingNative); assertEq(afterClaim.pendingToken, before.pendingToken);
        assertEq(afterClaim.accruedNative, before.accruedNative); assertEq(afterClaim.accruedToken, before.accruedToken);
        assertEq(afterClaim.ledgerNative, before.ledgerNative - nativeCredit);
        assertEq(afterClaim.ledgerToken, before.ledgerToken - tokenCredit);
        assertEq(afterClaim.claimedNative, before.claimedNative + nativeCredit);
        assertEq(afterClaim.claimedToken, before.claimedToken + tokenCredit);
        assertEq(address(beneficiary).balance, before.balancesNative[1] + nativeCredit);
        assertEq(asset.balanceOf(address(beneficiary)), before.balancesToken[1] + tokenCredit);
        assertEq(afterClaim.creditsNative[1], 0); assertEq(afterClaim.creditsToken[1], 0);
        _assertLiabilities(afterClaim); _assertCustody();
        (uint256 n, uint256 t) = engine.collectLpFees(address(asset), block.timestamp);
        _assertHarvest(afterClaim, n, t);
    }

    function testRejectedNativeClaimRollsBackTokenTransferAndEveryEntitlementThenAllowsTokenOnly() external {
        _swapBothWays(); engine.collectLpFees(address(asset), block.timestamp);
        beneficiary.configure(engine, address(asset), ledger, false, true);
        Snapshot memory before = _snapshot();
        vm.expectRevert(RMTLaunchCurveLpFeeLedgerV1.NativeTransferFailed.selector); beneficiary.claim();
        assertEq(keccak256(abi.encode(_snapshot())), keccak256(abi.encode(before)));
        emit ConservationSnapshot("rejected-claim-before", before);
        emit ConservationSnapshot("rejected-claim-after", _snapshot());
        beneficiary.claimToken(); Snapshot memory afterClaim = _snapshot();
        assertEq(afterClaim.creditsNative[1], before.creditsNative[1]); assertEq(afterClaim.creditsToken[1], 0);
        assertEq(afterClaim.ledgerNative, before.ledgerNative);
        assertEq(afterClaim.ledgerToken, before.ledgerToken - before.creditsToken[1]);
        assertEq(afterClaim.claimedNative, before.claimedNative);
        assertEq(afterClaim.claimedToken, before.claimedToken + before.creditsToken[1]);
        _assertLiabilities(afterClaim); _assertCustody();
    }

    function testRuntimeDriftAndUnapprovedPrincipalRemovalCannotChangeSettlement() external {
        _swapBothWays(); Snapshot memory before = _snapshot(); bytes memory code = address(positions).code;
        vm.etch(address(positions), hex"60006000fd");
        vm.expectRevert(RMTV4CurveGraduationV1.InvalidDependencies.selector);
        engine.collectLpFees(address(asset), block.timestamp);
        vm.etch(address(positions), code);
        assertEq(keccak256(abi.encode(_snapshot())), keccak256(abi.encode(before)));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(originalId, originalPrincipal, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, stranger);
        vm.expectRevert(abi.encodeWithSignature("NotApproved(address)", stranger)); vm.prank(stranger);
        positions.modifyLiquidities(abi.encode(abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)), params), block.timestamp);
        assertEq(keccak256(abi.encode(_snapshot())), keccak256(abi.encode(before))); _assertCustody();
    }

    function _etch(string memory json, string memory name, bytes32 expected) private returns (address target) {
        target = vm.parseJsonAddress(json, string.concat(".contracts.", name, ".address"));
        bytes memory code = vm.parseJsonBytes(json, string.concat(".contracts.", name, ".code"));
        assertEq(keccak256(code), expected); vm.etch(target, code); assertEq(target.codehash, expected);
    }
    function _deploy(bytes memory creation, bytes memory args) private returns (address deployed) {
        bytes memory input = bytes.concat(creation, args);
        assembly ("memory-safe") { deployed := create(0, add(input, 32), mload(input)) }
        require(deployed.code.length != 0, "verified profile deployment failed");
    }
    function _recipients() private view returns (address[4] memory) { return [creator, address(beneficiary), operating, reserve]; }
    function _snapshot() private view returns (Snapshot memory s) {
        s.managerNative = address(manager).balance; s.managerToken = asset.balanceOf(address(manager));
        s.engineNative = address(engine).balance; s.engineToken = asset.balanceOf(address(engine));
        s.ledgerNative = address(ledger).balance; s.ledgerToken = asset.balanceOf(address(ledger));
        s.curveNative = address(curve).balance; s.curveToken = asset.balanceOf(address(curve));
        s.buyerNative = buyer.balance; s.buyerToken = asset.balanceOf(buyer);
        s.strangerNative = stranger.balance; s.strangerToken = asset.balanceOf(stranger);
        (s.accruedNative, s.accruedToken) = ledger.totalAccrued(); (s.claimedNative, s.claimedToken) = ledger.totalClaimed();
        (s.pendingNative, s.pendingToken) = engine.previewLpFees(address(asset));
        (s.id, s.principal) = engine.positions(address(asset)); s.poolLiquidity = manager.getLiquidity(key.toId());
        s.owner = positions.ownerOf(originalId); s.approved = positions.getApproved(originalId);
        address[4] memory recipients = _recipients();
        for (uint256 i; i < 4; ++i) {
            (s.creditsNative[i], s.creditsToken[i]) = ledger.claimable(recipients[i]);
            s.balancesNative[i] = recipients[i].balance; s.balancesToken[i] = asset.balanceOf(recipients[i]);
        }
    }
    function _assertLiabilities(Snapshot memory s) private pure {
        uint256 n; uint256 t;
        for (uint256 i; i < 4; ++i) { n += s.creditsNative[i]; t += s.creditsToken[i]; }
        assertEq(n + s.claimedNative, s.accruedNative); assertEq(t + s.claimedToken, s.accruedToken);
        assertGe(s.ledgerNative, n); assertGe(s.ledgerToken, t);
    }
    function _assertCustody() private view {
        assertEq(address(manager).codehash, MANAGER_HASH); assertEq(address(positions).codehash, POSITIONS_HASH);
        assertEq(address(permit).codehash, PERMIT_HASH); assertEq(positions.ownerOf(originalId), address(engine));
        assertEq(positions.getPositionLiquidity(originalId), originalPrincipal); assertEq(positions.getApproved(originalId), address(0));
        (PoolKey memory actual, PositionInfo info) = positions.getPoolAndPositionInfo(originalId);
        assertEq(PoolId.unwrap(actual.toId()), PoolId.unwrap(key.toId())); assertFalse(info.hasSubscriber());
        assertEq(info.tickLower(), -887220); assertEq(info.tickUpper(), 887220);
        assertEq(asset.allowance(address(engine), address(permit)), 0);
        (uint160 amount,,) = permit.allowance(address(engine), address(asset), address(positions)); assertEq(amount, 0);
    }
    function _assertHarvest(Snapshot memory before, uint256 n, uint256 t) private {
        assertGt(n, 0); assertGt(t, 0); assertEq(n, before.pendingNative); assertEq(t, before.pendingToken);
        Snapshot memory afterHarvest = _snapshot();
        emit ConservationSnapshot("harvest-before", before);
        emit ConservationSnapshot("harvest-after", afterHarvest);
        assertEq(afterHarvest.managerNative + n, before.managerNative); assertEq(afterHarvest.managerToken + t, before.managerToken);
        assertEq(afterHarvest.ledgerNative, before.ledgerNative + n); assertEq(afterHarvest.ledgerToken, before.ledgerToken + t);
        assertEq(afterHarvest.engineNative, before.engineNative); assertEq(afterHarvest.engineToken, before.engineToken);
        assertEq(afterHarvest.accruedNative, before.accruedNative + n); assertEq(afterHarvest.accruedToken, before.accruedToken + t);
        assertEq(afterHarvest.claimedNative, before.claimedNative); assertEq(afterHarvest.claimedToken, before.claimedToken);
        assertEq(afterHarvest.pendingNative, 0); assertEq(afterHarvest.pendingToken, 0);
        assertEq(afterHarvest.poolLiquidity, before.poolLiquidity);
        assertEq(afterHarvest.curveNative, before.curveNative); assertEq(afterHarvest.curveToken, before.curveToken);
        assertEq(afterHarvest.buyerNative, before.buyerNative); assertEq(afterHarvest.buyerToken, before.buyerToken);
        assertEq(afterHarvest.strangerNative, before.strangerNative); assertEq(afterHarvest.strangerToken, before.strangerToken);
        for (uint256 i; i < 4; ++i) { assertEq(afterHarvest.balancesNative[i], before.balancesNative[i]); assertEq(afterHarvest.balancesToken[i], before.balancesToken[i]); }
        _assertLiabilities(afterHarvest); _assertCustody();
    }
    function _claimAll() private {
        address[4] memory recipients = _recipients();
        for (uint256 i; i < 4; ++i) {
            (uint256 n, uint256 t) = ledger.claimable(recipients[i]);
            uint256 priorNative = recipients[i].balance; uint256 priorToken = asset.balanceOf(recipients[i]);
            if (i == 1) beneficiary.claim(); else { vm.prank(recipients[i]); ledger.claim(); }
            assertEq(recipients[i].balance, priorNative + n); assertEq(asset.balanceOf(recipients[i]), priorToken + t);
            (n,t) = ledger.claimable(recipients[i]); assertEq(n,0); assertEq(t,0);
        }
    }
    function _swapBothWays() private {
        PoolSwapTest swapper = new PoolSwapTest(manager);
        vm.startPrank(buyer);
        swapper.swap{value: 0.03 ether}(key, SwapParams(true, -0.03 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), "");
        asset.approve(address(swapper), 1_000_000 ether);
        swapper.swap(key, SwapParams(false, -1_000_000 ether, TickMath.MAX_SQRT_PRICE - 1), PoolSwapTest.TestSettings(false, false), "");
        vm.stopPrank();
    }
    function _mintOutside() private returns (uint256 id) {
        RMTV4CurveGraduationV1.Funding memory f = engine.previewFunding(0.2 ether, 40_000_000 ether, 1_200_000_000 ether, 6 ether);
        id = positions.nextTokenId(); bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, int24(-887220), int24(887220), f.liquidity, f.nativeUsed, f.tokenUsed, buyer, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        vm.startPrank(buyer); asset.approve(address(permit), f.tokenUsed);
        permit.approve(address(asset), address(positions), f.tokenUsed, uint48(block.timestamp));
        positions.modifyLiquidities{value: f.nativeUsed}(abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params), block.timestamp);
        vm.stopPrank(); assertEq(positions.ownerOf(id), buyer);
    }
}
