// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
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
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RMTLaunchBondingCurveV1} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveFactoryV1} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchCurveLpFeeLedgerV1} from "../src/RMTLaunchCurveLpFeeLedgerV1.sol";
import {RMTLaunchCurveDeploymentV1} from "../src/RMTLaunchCurveDeploymentV1.sol";
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

    error FundingInterrupted();

    function setFailure(bool fails) external {
        settlementFails = fails;
    }

    function approve(address token, address spender, uint160 grant, uint48) external {
        if (stickyApproval && grant == 0) grant = 1;
        amount[msg.sender][token][spender] = grant;
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

    function transferFrom(address from, address to, uint160 spend, address token) external {
        amount[from][token][msg.sender] -= spend;
        require(IERC20(token).transferFrom(from, to, spend));
        if (reentryEngine != address(0)) {
            (bool engineSuccess, bytes memory engineError) =
                reentryEngine.call(abi.encodeCall(RMTV4CurveGraduationV1.collectLpFees, (token, block.timestamp)));
            (bool curveSuccess, bytes memory curveError) =
                reentryCurve.call(abi.encodeCall(RMTLaunchBondingCurveV1.graduate, (block.timestamp)));
            require(!engineSuccess && !curveSuccess);
            engineReentry = bytes4(engineError);
            curveReentry = bytes4(curveError);
        }
        if (settlementFails) revert FundingInterrupted();
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
    PositionManager private positions;
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
        positions = new PositionManager(
            manager, IAllowanceTransfer(address(permit)), 10_000, IPositionDescriptor(address(0)), IWETH9(address(0))
        );
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
        assertEq(permit.amount(address(graduation), token, address(positions)), 0);
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
        PoolSwapTest swapper = new PoolSwapTest(manager);
        PoolKey memory key = graduation.canonicalPoolKey(token);
        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings(false, false);
        vm.startPrank(buyer);
        swapper.swap{value: 0.1 ether}(key, SwapParams(true, -0.1 ether, TickMath.MIN_SQRT_PRICE + 1), settings, "");
        IERC20(token).approve(address(swapper), 10_000 ether);
        swapper.swap(key, SwapParams(false, -10_000 ether, TickMath.MAX_SQRT_PRICE - 1), settings, "");
        vm.stopPrank();

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
}
