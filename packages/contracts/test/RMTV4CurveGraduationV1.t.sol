// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RMTLaunchBondingCurveV1} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveFactoryV1} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchCurveLpFeeLedgerV1} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {RMTLaunchCurveDeploymentV1} from "../src/RMTLaunchCurveDeploymentV1.sol";
import {RMTLaunchCurveTokenV1} from "../src/RMTLaunchCurveTokenV1.sol";
import {ICurvePermit2V1, ICurvePositionManagerV1, RMTV4CurveGraduationV1} from "../src/RMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1} from "../src/RMTV4CurveInitializationGuardV1.sol";

/// @dev Models Permit2 allowance spending and a failure within funding, after v4 initialization.
contract CurvePermit2Fixture {
    mapping(address => mapping(address => mapping(address => uint160))) public amount;
    bool public settlementFails;
    address private reentryEngine;
    address private reentryCurve;
    bytes4 public engineReentry;
    bytes4 public curveReentry;
    bool public stickyApproval;
    bool private reentryOnApproval;
    bytes4[2] public approvalEngineReentry;
    bytes4[2] public approvalCurveReentry;

    error FundingInterrupted();

    function setFailure(bool fails) external {
        settlementFails = fails;
    }

    function approve(address token, address spender, uint160 grant, uint48) external {
        uint256 phase = grant == 0 ? 1 : 0;
        if (stickyApproval && grant == 0) grant = 1;
        amount[msg.sender][token][spender] = grant;
        if (reentryOnApproval) {
            (approvalEngineReentry[phase], approvalCurveReentry[phase]) = _tryReentry(token);
        }
    }

    function allowance(address owner, address token, address spender) external view returns (uint160, uint48, uint48) {
        return (amount[owner][token][spender], 0, 0);
    }

    function attemptReentry(address engine, address curve) external {
        reentryEngine = engine;
        reentryCurve = curve;
    }

    function setStickyApproval(bool value) external {
        stickyApproval = value;
    }

    function attemptApprovalReentry() external {
        reentryOnApproval = true;
    }

    function transferFrom(address from, address to, uint160 spend, address token) external {
        amount[from][token][msg.sender] -= spend;
        require(IERC20(token).transferFrom(from, to, spend));
        if (reentryEngine != address(0)) {
            (engineReentry, curveReentry) = _tryReentry(token);
        }
        if (settlementFails) revert FundingInterrupted();
    }

    function _tryReentry(address token) private returns (bytes4 engineError, bytes4 curveError) {
        (bool engineSuccess, bytes memory engineReason) =
            reentryEngine.call(abi.encodeCall(RMTV4CurveGraduationV1.collectLpFees, (token, block.timestamp)));
        (bool curveSuccess, bytes memory curveReason) =
            reentryCurve.call(abi.encodeCall(RMTLaunchBondingCurveV1.graduate, (block.timestamp)));
        require(!engineSuccess && !curveSuccess);
        return (bytes4(engineReason), bytes4(curveReason));
    }
}

/// @dev Exercises real v4 actions and changes only the explicitly selected hostile action in a local fixture.
contract AdversarialCurvePositionManager is PositionManager {
    enum Fault {
        None,
        EngineTokenDelta,
        PoolTokenDelta,
        PoolNativeDelta,
        WrongOwner,
        UnexpectedApproval,
        WrongTicks,
        DivertNativeFees,
        DivertTokenFees,
        DecreasePrincipal
    }

    Fault private fault;
    RMTV4CurveGraduationV1 private engine;
    RMTLaunchBondingCurveV1 private curve;
    address private token;
    address private target;
    bool private probeCallbacks;
    bytes4[4] public callbackErrors;

    constructor(IPoolManager manager, IAllowanceTransfer permit)
        PositionManager(manager, permit, 10_000, IPositionDescriptor(address(0)), IWETH9(address(0)))
    {}

    function configure(
        RMTV4CurveGraduationV1 engine_,
        RMTLaunchBondingCurveV1 curve_,
        address target_,
        Fault fault_,
        bool probeCallbacks_
    ) external {
        engine = engine_;
        curve = curve_;
        token = address(curve_.token());
        target = target_;
        fault = fault_;
        probeCallbacks = probeCallbacks_;
    }

    function _handleAction(uint256 action, bytes calldata params) internal override {
        if (action == Actions.INCREASE_LIQUIDITY && fault == Fault.DecreasePrincipal) {
            uint256 tokenId = abi.decode(params, (uint256));
            _decrease(tokenId, this.getPositionLiquidity(tokenId) / 2, 0, 0, params[:0]);
            return;
        }
        if (action == Actions.TAKE_PAIR && (fault == Fault.DivertNativeFees || fault == Fault.DivertTokenFees)) {
            (Currency nativeCurrency, Currency tokenCurrency, address ledger) =
                abi.decode(params, (Currency, Currency, address));
            _take(nativeCurrency, fault == Fault.DivertNativeFees ? target : ledger, _getFullCredit(nativeCurrency));
            _take(tokenCurrency, fault == Fault.DivertTokenFees ? target : ledger, _getFullCredit(tokenCurrency));
            return;
        }
        super._handleAction(action, params);
        if (action == Actions.SETTLE_PAIR) _afterFunding();
        if (action == Actions.TAKE_PAIR && probeCallbacks) _probe(false);
    }

    function _afterFunding() private {
        if (probeCallbacks) _probe(true);
        if (fault == Fault.EngineTokenDelta) {
            require(IERC20(token).transfer(address(engine), 1));
        } else if (fault == Fault.PoolTokenDelta) {
            require(IERC20(token).transfer(address(poolManager), 1));
        } else if (fault == Fault.PoolNativeDelta) {
            poolManager.donate(engine.canonicalPoolKey(token), 1, 0, "");
            poolManager.sync(Currency.wrap(address(0)));
            poolManager.settle{value: 1}();
        } else if (fault == Fault.WrongOwner) {
            _ownerOf[nextTokenId - 1] = target;
        } else if (fault == Fault.UnexpectedApproval) {
            getApproved[nextTokenId - 1] = target;
        } else if (fault == Fault.WrongTicks) {
            (PoolKey memory key, PositionInfo info) = getPoolAndPositionInfo(nextTokenId - 1);
            positionInfo[nextTokenId - 1] = PositionInfoLibrary.initialize(
                key, PositionInfoLibrary.tickLower(info) + key.tickSpacing, PositionInfoLibrary.tickUpper(info)
            );
        }
    }

    function _probe(bool funding) private {
        callbackErrors[0] = _blocked(
            address(engine),
            abi.encodeCall(RMTV4CurveGraduationV1.graduate, (token, 0, 0, 0, 0, block.timestamp)),
            false
        );
        callbackErrors[1] = _blocked(
            address(engine), abi.encodeCall(RMTV4CurveGraduationV1.collectLpFees, (token, block.timestamp)), false
        );
        callbackErrors[2] =
            _blocked(address(engine), abi.encodeCall(RMTV4CurveGraduationV1.previewLpFees, (token)), true);
        if (funding) {
            callbackErrors[3] =
                _blocked(address(curve), abi.encodeCall(RMTLaunchBondingCurveV1.graduate, (block.timestamp)), false);
        }
    }

    function _blocked(address destination, bytes memory data, bool readOnly) private returns (bytes4) {
        (bool ok, bytes memory reason) = readOnly ? destination.staticcall(data) : destination.call(data);
        require(!ok);
        return bytes4(reason);
    }
}

/// @dev Replaces canonical token code via a Foundry cheatcode while retaining its ERC20 storage.
contract AdversarialCurveToken is ERC20 {
    RMTV4CurveGraduationV1 private immutable engine;
    RMTLaunchBondingCurveV1 private immutable curve;
    bool private immutable shortTransfer;
    bool private immutable stickyApproval;
    bytes4[3] public engineCallbackErrors;
    bytes4[3] public curveCallbackErrors;

    constructor(
        RMTV4CurveGraduationV1 engine_,
        RMTLaunchBondingCurveV1 curve_,
        bool shortTransfer_,
        bool stickyApproval_
    ) ERC20("", "") {
        engine = engine_;
        curve = curve_;
        shortTransfer = shortTransfer_;
        stickyApproval = stickyApproval_;
    }

    function approve(address spender, uint256 value) public override returns (bool) {
        if (msg.sender == address(engine)) {
            _probe(value == 0 ? 2 : 1);
            if (value == 0 && stickyApproval) return super.approve(spender, 1);
        }
        return super.approve(spender, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (msg.sender == address(engine)) {
            _probe(0);
            if (shortTransfer) return super.transferFrom(from, to, value - 1);
        }
        return super.transferFrom(from, to, value);
    }

    function _probe(uint256 phase) private {
        (bool engineSuccess, bytes memory engineReason) =
            address(engine).call(abi.encodeCall(RMTV4CurveGraduationV1.collectLpFees, (address(this), block.timestamp)));
        (bool curveSuccess, bytes memory curveReason) =
            address(curve).call(abi.encodeCall(RMTLaunchBondingCurveV1.graduate, (block.timestamp)));
        require(!engineSuccess && !curveSuccess);
        engineCallbackErrors[phase] = bytes4(engineReason);
        curveCallbackErrors[phase] = bytes4(curveReason);
    }
}

contract RejectNativeLpBeneficiary {
    function claim(RMTLaunchCurveLpFeeLedgerV1 ledger) external {
        ledger.claim();
    }

    function claimToken(RMTLaunchCurveLpFeeLedgerV1 ledger) external {
        ledger.claimAsset(false);
    }
}

contract RMTV4CurveGraduationV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager private manager;
    AdversarialCurvePositionManager private positions;
    CurvePermit2Fixture private permit;
    RMTLaunchCurveFactoryV1 private factory;
    RMTV4CurveGraduationV1 private graduation;
    address private creator = makeAddr("creator");
    address private buyer = makeAddr("buyer");
    address private stranger = makeAddr("stranger");
    address private treasury = makeAddr("treasury");
    address private operating = makeAddr("operating");
    address private reserve = makeAddr("reserve");

    function setUp() public {
        vm.chainId(31337);
        manager = new PoolManager(address(this));
        permit = new CurvePermit2Fixture();
        positions = new AdversarialCurvePositionManager(manager, IAllowanceTransfer(address(permit)));
        RMTV4CurveGraduationV1.Dependencies memory dependencies = RMTV4CurveGraduationV1.Dependencies(
            manager,
            ICurvePositionManagerV1(address(positions)),
            ICurvePermit2V1(address(permit)),
            address(manager).codehash,
            address(positions).codehash,
            address(permit).codehash
        );
        RMTLaunchCurveSuccessorDeployerV1 successor = new RMTLaunchCurveSuccessorDeployerV1();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address engine = vm.computeCreateAddress(predicted, 2);
        (address expectedGuard, bytes32 salt) = HookMiner.find(
            predicted,
            Hooks.BEFORE_INITIALIZE_FLAG,
            type(RMTV4CurveInitializationGuardV1).creationCode,
            abi.encode(manager, engine)
        );
        RMTLaunchCurveDeploymentV1 deployment = new RMTLaunchCurveDeploymentV1(
            dependencies, salt, operating, reserve, address(0), address(successor), address(successor).codehash
        );
        graduation = deployment.graduationEngine();
        factory = deployment.factory();
        assertEq(address(graduation), engine);
        assertEq(address(graduation.factory()), address(factory));
        assertEq(address(graduation.initializationGuard()), expectedGuard);
        assertEq(address(factory.graduationEngine()), engine);
        vm.deal(buyer, 10 ether);
    }

    function testFundingUsesCurveSpotAndRealCapitalAcrossPresets() public view {
        uint256[3] memory supply = [uint256(1_000_000 ether), 10_000_000 ether, 100_000_000 ether];
        for (uint256 i; i < supply.length; ++i) {
            uint256 tokenReserve = supply[i] * 2 / 5;
            uint256 numerator = supply[i] * 6 / 5;
            uint256 denominator = 3 ether;
            RMTV4CurveGraduationV1.Funding memory funding =
                graduation.previewFunding(1 ether, tokenReserve, numerator, denominator);
            uint256 q192Price = Math.mulDiv(numerator, 1 << 192, denominator);
            uint256 root = uint256(funding.sqrtPriceX96);
            assertLe(root * root, q192Price);
            assertGt((root + 1) * (root + 1), q192Price);
            assertGt(funding.liquidity, 0);
            assertLe(1 ether - funding.nativeUsed, 100_000);
            assertLe(tokenReserve - funding.tokenUsed, 100_000);
        }
    }

    function testUnbalancedOrUnfundedMigrationRejected() public {
        vm.expectRevert(RMTV4CurveGraduationV1.InvalidFunding.selector);
        graduation.previewFunding(0, 100 ether, 100 ether, 1 ether);
        vm.expectRevert(RMTV4CurveGraduationV1.InvalidFunding.selector);
        graduation.previewFunding(1 ether, 200 ether, 100 ether, 1 ether);
    }

    function testGuardBlocksFrontRunAndOnlyRegisteredCurveCanFund() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        PoolKey memory key = graduation.canonicalPoolKey(token);
        vm.expectRevert();
        vm.prank(stranger);
        manager.initialize(key, uint160(1 << 96));

        PoolKey memory otherKey = PoolKey(key.currency0, key.currency1, key.fee, key.tickSpacing, IHooks(address(0)));
        vm.prank(stranger);
        manager.initialize(otherKey, uint160(1 << 96));
        (uint160 unopenedPrice,,,) = manager.getSlot0(key.toId());
        assertEq(unopenedPrice, 0);
        assertNotEq(PoolId.unwrap(otherKey.toId()), PoolId.unwrap(key.toId()));

        vm.expectRevert(RMTV4CurveGraduationV1.UnauthorizedCurve.selector);
        vm.prank(stranger);
        graduation.graduate(token, 0, 0, 0, 0, block.timestamp);
        assertFalse(curve.graduated());
    }

    function testFundingRollbackKeepsCurveBackingAndRetriableGraduation() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        uint256 deadline = block.timestamp + 1 minutes;
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, deadline);
        uint256 inventory = IERC20(token).balanceOf(address(curve));
        uint256 backing = curve.backingReserve();
        uint256 nextId = positions.nextTokenId();
        PoolKey memory key = graduation.canonicalPoolKey(token);
        permit.setFailure(true);

        vm.expectRevert(CurvePermit2Fixture.FundingInterrupted.selector);
        vm.prank(stranger);
        curve.graduate(deadline);
        (uint160 unopenedPrice,,,) = manager.getSlot0(key.toId());
        assertEq(unopenedPrice, 0);
        assertEq(positions.nextTokenId(), nextId);
        assertEq(curve.backingReserve(), backing);
        assertEq(address(curve).balance, backing);
        assertEq(IERC20(token).balanceOf(address(curve)), inventory);
        assertEq(IERC20(token).allowance(address(curve), address(graduation)), 0);
        assertFalse(curve.graduated());

        permit.setFailure(false);
        vm.prank(stranger);
        curve.graduate(deadline);
        assertTrue(curve.graduated());
        assertEq(curve.poolId(), PoolId.unwrap(key.toId()));
        assertEq(curve.positionTokenId(), nextId);
        assertEq(positions.ownerOf(nextId), address(graduation));
        (, uint128 liquidity) = graduation.positions(token);
        assertGt(liquidity, 0);
        assertEq(positions.getPositionLiquidity(nextId), liquidity);
        assertEq(IERC20(token).allowance(address(curve), address(graduation)), 0);
        assertEq(IERC20(token).allowance(address(graduation), address(permit)), 0);
        assertEq(permit.amount(address(graduation), token, address(positions)), 0);
        assertEq(address(manager).balance + address(curve).balance, backing);
        assertEq(IERC20(token).balanceOf(address(manager)) + IERC20(token).balanceOf(address(curve)), inventory);
        assertEq(IERC20(token).totalSupply(), 1_000_000 ether);

        vm.expectRevert();
        vm.prank(creator);
        IERC721(address(positions)).transferFrom(address(graduation), creator, nextId);
        vm.expectRevert();
        vm.prank(creator);
        IERC721(address(positions)).approve(creator, nextId);
        vm.expectRevert();
        vm.prank(creator);
        curve.graduate(deadline);
        assertEq(positions.ownerOf(nextId), address(graduation));
        assertEq(positions.getPositionLiquidity(nextId), liquidity);
    }

    function testHostilePermit2CannotReenterAndRetainedAllowanceRollsBack() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        uint256 deadline = block.timestamp + 1 minutes;
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, deadline);
        permit.attemptReentry(address(graduation), address(curve));
        permit.attemptApprovalReentry();
        permit.setStickyApproval(true);
        vm.expectRevert(RMTV4CurveGraduationV1.SettlementMismatch.selector);
        curve.graduate(deadline);
        assertFalse(curve.graduated());
        assertEq(curve.backingReserve(), 1 ether);
        assertEq(address(graduation.lpFeeLedger(token)), address(0));

        permit.setStickyApproval(false);
        curve.graduate(deadline);
        assertTrue(curve.graduated());
        assertEq(permit.engineReentry(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(permit.curveReentry(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        for (uint256 phase; phase < 2; ++phase) {
            assertEq(permit.approvalEngineReentry(phase), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
            assertEq(permit.approvalCurveReentry(phase), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        }
        assertEq(permit.amount(address(graduation), token, address(positions)), 0);
    }

    function testPositionManagerFundingCallbackCannotReenterOrReadTransientFees() public {
        (address token, RMTLaunchBondingCurveV1 curve, uint256 deadline) = _fundCurve();
        positions.configure(graduation, curve, stranger, AdversarialCurvePositionManager.Fault.None, true);
        vm.prank(stranger);
        curve.graduate(deadline);
        for (uint256 slot; slot < 4; ++slot) {
            assertEq(positions.callbackErrors(slot), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        }
        assertTrue(curve.graduated());
        assertEq(positions.ownerOf(curve.positionTokenId()), address(graduation));
        assertEq(IERC20(token).allowance(address(graduation), address(permit)), 0);
        assertEq(permit.amount(address(graduation), token, address(positions)), 0);
    }

    function testCanonicalTokenHasNoCallbackAndFundingStillRejectsInjectedTokenFaults() public {
        (address token, RMTLaunchBondingCurveV1 curve, uint256 deadline) = _fundCurve();
        assertEq(token.codehash, keccak256(type(RMTLaunchCurveTokenV1).runtimeCode));
        uint256 inventory = IERC20(token).balanceOf(address(curve));
        AdversarialCurveToken short = new AdversarialCurveToken(graduation, curve, true, false);
        vm.etch(token, address(short).code);
        vm.expectRevert(RMTV4CurveGraduationV1.SettlementMismatch.selector);
        curve.graduate(deadline);
        assertFalse(curve.graduated());
        assertEq(curve.backingReserve(), 1 ether);
        assertEq(IERC20(token).balanceOf(address(curve)), inventory);
        assertEq(IERC20(token).balanceOf(address(graduation)), 0);
        assertEq(address(graduation.lpFeeLedger(token)), address(0));

        AdversarialCurveToken sticky = new AdversarialCurveToken(graduation, curve, false, true);
        vm.etch(token, address(sticky).code);
        vm.expectRevert(RMTV4CurveGraduationV1.SettlementMismatch.selector);
        curve.graduate(deadline);
        assertFalse(curve.graduated());
        assertEq(curve.backingReserve(), 1 ether);
        assertEq(IERC20(token).balanceOf(address(curve)), inventory);
        assertEq(IERC20(token).allowance(address(graduation), address(permit)), 0);
        assertEq(address(graduation.lpFeeLedger(token)), address(0));

        AdversarialCurveToken callbacks = new AdversarialCurveToken(graduation, curve, false, false);
        vm.etch(token, address(callbacks).code);
        curve.graduate(deadline);
        for (uint256 phase; phase < 3; ++phase) {
            assertEq(
                AdversarialCurveToken(token).engineCallbackErrors(phase),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
            assertEq(
                AdversarialCurveToken(token).curveCallbackErrors(phase),
                ReentrancyGuard.ReentrancyGuardReentrantCall.selector
            );
        }
        vm.etch(token, type(RMTLaunchCurveTokenV1).runtimeCode);
        assertTrue(curve.graduated());
        assertEq(positions.ownerOf(curve.positionTokenId()), address(graduation));
        assertEq(IERC20(token).allowance(address(graduation), address(permit)), 0);
        assertEq(permit.amount(address(graduation), token, address(positions)), 0);
    }

    function testPositionManagerCorruptFundingRollsBackEveryBalanceAndCanRetry() public {
        (address token, RMTLaunchBondingCurveV1 curve, uint256 deadline) = _fundCurve();
        uint256 nextId = positions.nextTokenId();
        uint256 curveTokens = IERC20(token).balanceOf(address(curve));
        // Fund the hostile PositionManager with a real token and wei to mutate actual balances after settlement.
        vm.prank(buyer);
        IERC20(token).transfer(address(positions), 1);
        vm.deal(address(positions), 1);
        PoolKey memory key = graduation.canonicalPoolKey(token);
        AdversarialCurvePositionManager.Fault[6] memory faults = [
            AdversarialCurvePositionManager.Fault.EngineTokenDelta,
            AdversarialCurvePositionManager.Fault.PoolTokenDelta,
            AdversarialCurvePositionManager.Fault.PoolNativeDelta,
            AdversarialCurvePositionManager.Fault.WrongOwner,
            AdversarialCurvePositionManager.Fault.UnexpectedApproval,
            AdversarialCurvePositionManager.Fault.WrongTicks
        ];
        for (uint256 i; i < faults.length; ++i) {
            positions.configure(graduation, curve, stranger, faults[i], false);
            vm.expectRevert(RMTV4CurveGraduationV1.SettlementMismatch.selector);
            curve.graduate(deadline);
            (uint160 sqrtPrice,,,) = manager.getSlot0(key.toId());
            assertEq(sqrtPrice, 0);
            assertEq(positions.nextTokenId(), nextId);
            (uint256 lockedId, uint128 lockedLiquidity) = graduation.positions(token);
            assertEq(lockedId, 0);
            assertEq(lockedLiquidity, 0);
            assertEq(address(graduation.lpFeeLedger(token)), address(0));
            assertEq(address(manager).balance, 0);
            assertEq(IERC20(token).balanceOf(address(manager)), 0);
            assertEq(address(graduation).balance, 0);
            assertEq(IERC20(token).balanceOf(address(graduation)), 0);
            assertEq(address(positions).balance, 1);
            assertEq(IERC20(token).balanceOf(address(positions)), 1);
            assertEq(curve.backingReserve(), 1 ether);
            assertEq(address(curve).balance, 1 ether);
            assertEq(IERC20(token).balanceOf(address(curve)), curveTokens);
            assertEq(IERC20(token).allowance(address(curve), address(graduation)), 0);
            assertEq(IERC20(token).allowance(address(graduation), address(permit)), 0);
            assertEq(permit.amount(address(graduation), token, address(positions)), 0);
            assertFalse(curve.graduated());
        }

        positions.configure(graduation, curve, stranger, AdversarialCurvePositionManager.Fault.None, false);
        curve.graduate(deadline);
        assertEq(positions.ownerOf(nextId), address(graduation));
        assertTrue(curve.graduated());
    }

    function testPositionManagerHarvestRejectsReentryFeeDiversionAndPrincipalChange() public {
        (address token, RMTLaunchBondingCurveV1 curve, uint256 deadline) = _fundCurve();
        curve.graduate(deadline);
        (uint256 id, uint128 liquidity) = graduation.positions(token);
        RMTLaunchCurveLpFeeLedgerV1 ledger = graduation.lpFeeLedger(token);
        PoolKey memory key = graduation.canonicalPoolKey(token);
        _accrueFees(token, key);
        (uint256 expectedNative, uint256 expectedToken) = graduation.previewLpFees(token);
        assertGt(expectedNative, 0);
        assertGt(expectedToken, 0);
        uint256 managerNative = address(manager).balance;
        uint256 managerTokens = IERC20(token).balanceOf(address(manager));
        AdversarialCurvePositionManager.Fault[3] memory faults = [
            AdversarialCurvePositionManager.Fault.DivertNativeFees,
            AdversarialCurvePositionManager.Fault.DivertTokenFees,
            AdversarialCurvePositionManager.Fault.DecreasePrincipal
        ];
        for (uint256 i; i < faults.length; ++i) {
            positions.configure(graduation, curve, stranger, faults[i], true);
            vm.expectRevert(RMTV4CurveGraduationV1.SettlementMismatch.selector);
            graduation.collectLpFees(token, deadline);
            assertEq(address(ledger).balance, 0);
            assertEq(IERC20(token).balanceOf(address(ledger)), 0);
            (uint256 accruedNative, uint256 accruedToken) = ledger.totalAccrued();
            assertEq(accruedNative, 0);
            assertEq(accruedToken, 0);
            assertEq(stranger.balance, 0);
            assertEq(IERC20(token).balanceOf(stranger), 0);
            assertEq(address(manager).balance, managerNative);
            assertEq(IERC20(token).balanceOf(address(manager)), managerTokens);
            assertEq(positions.getPositionLiquidity(id), liquidity);
            assertEq(positions.ownerOf(id), address(graduation));
            (uint256 stillPendingNative, uint256 stillPendingToken) = graduation.previewLpFees(token);
            assertEq(stillPendingNative, expectedNative);
            assertEq(stillPendingToken, expectedToken);
        }

        positions.configure(graduation, curve, stranger, AdversarialCurvePositionManager.Fault.None, true);
        (uint256 collectedNative, uint256 collectedToken) = graduation.collectLpFees(token, deadline);
        assertEq(collectedNative, expectedNative);
        assertEq(collectedToken, expectedToken);
        for (uint256 slot; slot < 3; ++slot) {
            assertEq(positions.callbackErrors(slot), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        }
        assertEq(positions.getPositionLiquidity(id), liquidity);
        assertEq(positions.ownerOf(id), address(graduation));
        assertEq(positions.getApproved(id), address(0));
    }

    function testOriginalPositionFeesAccrueClaimAndKeepPrincipalLocked() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        uint256 deadline = block.timestamp + 1 minutes;
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, deadline);
        curve.graduate(deadline);
        (uint256 tokenId, uint128 liquidity) = graduation.positions(token);
        RMTLaunchCurveLpFeeLedgerV1 ledger = graduation.lpFeeLedger(token);
        assertEq(ledger.creator(), creator);
        assertEq(ledger.treasury(), treasury);
        assertEq(ledger.operatingRecipient(), operating);
        assertEq(ledger.futureReserveRecipient(), reserve);
        assertEq(ledger.treasuryShareBps(), 2_000);
        vm.expectRevert(RMTV4CurveGraduationV1.NoLpFees.selector);
        graduation.collectLpFees(token, deadline);
        vm.expectRevert(RMTV4CurveGraduationV1.InvalidDeadline.selector);
        graduation.collectLpFees(token, block.timestamp + 31 minutes);
        vm.expectRevert(RMTLaunchCurveLpFeeLedgerV1.Unauthorized.selector);
        ledger.record(1, 1);
        vm.expectRevert(RMTLaunchCurveLpFeeLedgerV1.Unauthorized.selector);
        payable(address(ledger)).transfer(1 wei);

        // An unsolicited direct ERC-20 transfer must never be attributed to the position.
        vm.prank(buyer);
        IERC20(token).transfer(address(ledger), 17);
        PoolKey memory key = graduation.canonicalPoolKey(token);
        _accrueFees(token, key);

        (uint256 expectedNative, uint256 expectedToken) = graduation.previewLpFees(token);
        assertGt(expectedNative, 0);
        assertGt(expectedToken, 0);
        assertEq(address(ledger).balance, 0);
        assertEq(IERC20(token).balanceOf(address(ledger)), 17);
        vm.prank(stranger);
        (uint256 nativeAmount, uint256 tokenAmount) = graduation.collectLpFees(token, deadline);
        assertEq(nativeAmount, expectedNative);
        assertEq(tokenAmount, expectedToken);
        assertEq(address(ledger).balance, nativeAmount);
        assertEq(IERC20(token).balanceOf(address(ledger)), tokenAmount + 17);
        (uint256 accruedNative, uint256 accruedToken) = ledger.totalAccrued();
        assertEq(accruedNative, nativeAmount);
        assertEq(accruedToken, tokenAmount);
        vm.expectRevert(RMTV4CurveGraduationV1.NoLpFees.selector);
        graduation.collectLpFees(token, deadline);
        vm.expectRevert(RMTLaunchCurveLpFeeLedgerV1.NothingToClaim.selector);
        vm.prank(stranger);
        ledger.claim();

        address[4] memory recipients = [creator, treasury, operating, reserve];
        for (uint256 bucket; bucket < recipients.length; ++bucket) {
            (uint256 nativeShare, uint256 tokenShare) = ledger.bucketAccrued(bucket);
            assertGt(nativeShare, 0);
            assertGt(tokenShare, 0);
            _claim(ledger, IERC20(token), recipients[bucket], nativeShare, tokenShare);
        }
        (uint256 claimedNative, uint256 claimedToken) = ledger.totalClaimed();
        assertEq(claimedNative, nativeAmount);
        assertEq(claimedToken, tokenAmount);
        assertEq(address(ledger).balance, 0);
        assertEq(IERC20(token).balanceOf(address(ledger)), 17);
        assertEq(positions.ownerOf(tokenId), address(graduation));
        assertEq(positions.getApproved(tokenId), address(0));
        assertEq(positions.getPositionLiquidity(tokenId), liquidity);
        assertEq(curve.backingReserve(), 0);
    }

    function testPositionEvidenceAndResidualAllowancesMustMatch() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        uint256 deadline = block.timestamp + 1 minutes;
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, deadline);
        curve.graduate(deadline);
        (uint256 tokenId,) = graduation.positions(token);
        vm.mockCall(address(positions), abi.encodeCall(positions.getApproved, (tokenId)), abi.encode(stranger));
        vm.expectRevert(RMTV4CurveGraduationV1.SettlementMismatch.selector);
        graduation.collectLpFees(token, deadline);
        vm.clearMockedCalls();
        vm.mockCall(
            address(permit),
            abi.encodeCall(permit.allowance, (address(graduation), token, address(positions))),
            abi.encode(uint160(1), uint48(0), uint48(0))
        );
        vm.expectRevert(RMTV4CurveGraduationV1.SettlementMismatch.selector);
        graduation.collectLpFees(token, deadline);
    }

    function testRejectingNativeBeneficiaryKeepsEthCreditAndCanClaimToken() public {
        RejectNativeLpBeneficiary beneficiary = new RejectNativeLpBeneficiary();
        // The allocation unit uses this test as its engine and the real local PoolManager as the ETH source.
        (address token,) = _create();
        RMTLaunchCurveLpFeeLedgerV1 ledger = new RMTLaunchCurveLpFeeLedgerV1(
            IERC20(token),
            address(manager),
            RMTLaunchCurveLpFeeLedgerV1.Policy(address(beneficiary), address(0), 0, operating, reserve)
        );
        deal(token, address(ledger), 101);
        vm.deal(address(manager), 101);
        vm.prank(address(manager));
        (bool credited,) = payable(address(ledger)).call{value: 101}("");
        assertTrue(credited);
        ledger.record(101, 101);
        (uint256 nativeAmount, uint256 tokenAmount) = ledger.claimable(address(beneficiary));
        assertEq(nativeAmount, 91);
        assertEq(tokenAmount, 91);
        vm.expectRevert(RMTLaunchCurveLpFeeLedgerV1.NativeTransferFailed.selector);
        beneficiary.claim(ledger);
        assertEq(IERC20(token).balanceOf(address(beneficiary)), 0);
        (uint256 unclaimedNative, uint256 unclaimedToken) = ledger.claimable(address(beneficiary));
        assertEq(unclaimedNative, nativeAmount);
        assertEq(unclaimedToken, tokenAmount);

        beneficiary.claimToken(ledger);
        assertEq(IERC20(token).balanceOf(address(beneficiary)), tokenAmount);
        (unclaimedNative, unclaimedToken) = ledger.claimable(address(beneficiary));
        assertEq(unclaimedNative, nativeAmount);
        assertEq(unclaimedToken, 0);
        assertEq(address(ledger).balance, 101);
    }

    function testOutsideLpKeepsItsFeesAndDoesNotShareOriginalCustody() public {
        (address token, RMTLaunchBondingCurveV1 curve) = _create();
        uint256 deadline = block.timestamp + 1 minutes;
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, deadline);
        curve.graduate(deadline);
        (uint256 originalId, uint128 originalLiquidity) = graduation.positions(token);
        PoolKey memory key = graduation.canonicalPoolKey(token);
        RMTV4CurveGraduationV1.Funding memory outside =
            graduation.previewFunding(0.2 ether, 80_000 ether, 400_000 ether, 1 ether);
        uint256 outsideId = positions.nextTokenId();
        _mintOutside(token, key, outside, deadline);
        assertEq(positions.ownerOf(outsideId), buyer);
        assertEq(manager.getLiquidity(key.toId()), originalLiquidity + outside.liquidity);

        PoolSwapTest swapper = new PoolSwapTest(manager);
        vm.prank(buyer);
        swapper.swap{value: 0.1 ether}(
            key, SwapParams(true, -0.1 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), ""
        );
        (uint256 originalFees, uint256 noTokenFees) = graduation.previewLpFees(token);
        assertEq(noTokenFees, 0);
        // A 0.30% swap distributes fees over both active positions, with integer rounding.
        uint256 grossLpFee = 0.1 ether * 3_000 / 1_000_000;
        assertLt(originalFees, grossLpFee);
        assertApproxEqAbs(
            originalFees, Math.mulDiv(grossLpFee, originalLiquidity, originalLiquidity + outside.liquidity), 1
        );
        (uint256 actual,) = graduation.collectLpFees(token, deadline);
        assertEq(actual, originalFees);
        assertEq(positions.ownerOf(originalId), address(graduation));
        assertEq(positions.getPositionLiquidity(originalId), originalLiquidity);
        assertEq(positions.ownerOf(outsideId), buyer);
        assertEq(positions.getPositionLiquidity(outsideId), outside.liquidity);

        uint256 before = buyer.balance;
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(outsideId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, buyer);
        vm.prank(buyer);
        positions.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)), params), deadline
        );
        uint256 outsideFees = buyer.balance - before;
        assertGt(outsideFees, 0);
        assertApproxEqAbs(originalFees + outsideFees, grossLpFee, 2);
        assertEq(positions.getPositionLiquidity(outsideId), outside.liquidity);
    }

    function _mintOutside(
        address token,
        PoolKey memory key,
        RMTV4CurveGraduationV1.Funding memory funding,
        uint256 deadline
    ) private {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            graduation.TICK_LOWER(),
            graduation.TICK_UPPER(),
            funding.liquidity,
            funding.nativeUsed,
            funding.tokenUsed,
            buyer,
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        vm.startPrank(buyer);
        IERC20(token).approve(address(permit), funding.tokenUsed);
        permit.approve(token, address(positions), funding.tokenUsed, uint48(deadline));
        positions.modifyLiquidities{value: funding.nativeUsed}(
            abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params), deadline
        );
        vm.stopPrank();
    }

    function _accrueFees(address token, PoolKey memory key) private {
        PoolSwapTest swapper = new PoolSwapTest(manager);
        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings(false, false);
        vm.startPrank(buyer);
        swapper.swap{value: 0.1 ether}(key, SwapParams(true, -0.1 ether, TickMath.MIN_SQRT_PRICE + 1), settings, "");
        IERC20(token).approve(address(swapper), 10_000 ether);
        swapper.swap(key, SwapParams(false, -10_000 ether, TickMath.MAX_SQRT_PRICE - 1), settings, "");
        vm.stopPrank();
    }

    function _claim(
        RMTLaunchCurveLpFeeLedgerV1 ledger,
        IERC20 token,
        address recipient,
        uint256 nativeShare,
        uint256 tokenShare
    ) private {
        uint256 nativeBefore = recipient.balance;
        uint256 tokenBefore = token.balanceOf(recipient);
        vm.prank(recipient);
        (uint256 receivedNative, uint256 receivedToken) = ledger.claim();
        assertEq(receivedNative, nativeShare);
        assertEq(receivedToken, tokenShare);
        assertEq(recipient.balance, nativeBefore + nativeShare);
        assertEq(token.balanceOf(recipient), tokenBefore + tokenShare);
    }

    function _create() private returns (address token, RMTLaunchBondingCurveV1 curve) {
        vm.prank(creator);
        address curveAddress;
        (token, curveAddress) =
            factory.create("Graduation Test", "GRAD", "", 0, treasury, 2_000, bytes32(uint256(1)), block.timestamp);
        curve = RMTLaunchBondingCurveV1(payable(curveAddress));
    }

    function _fundCurve() private returns (address token, RMTLaunchBondingCurveV1 curve, uint256 deadline) {
        (token, curve) = _create();
        deadline = block.timestamp + 1 minutes;
        uint256 minimum = curve.graduationSold();
        vm.prank(buyer);
        curve.buy{value: 2 ether}(minimum, deadline);
    }
}
