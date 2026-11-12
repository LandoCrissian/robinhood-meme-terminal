// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ILaunchPermit2V1, ILaunchPositionManagerV1} from "../src/RMTV4LaunchFactoryV1.sol";
import {RMTV4LaunchFactoryV2} from "../src/RMTV4LaunchFactoryV2.sol";
import {RMTV4LongevityLedger} from "../src/RMTV4LongevityLedger.sol";
import {RMTV4GrowthVaultV1, RMTV4GrowthVaultDeployerV1} from "../src/RMTV4GrowthVaultV1.sol";
import {GuardedLaunchFixture} from "./RMTV4LaunchFactoryV2.t.sol";

/// @dev The failure and callback paths let a fixed-runtime local dependency simulate a hostile settlement.
/// The separate fork suite uses the pinned official Permit2 and PositionManager bytecode.
contract GrowthAllowanceHarness {
    struct Grant {
        uint160 amount;
        uint48 expiration;
    }

    mapping(address => mapping(address => mapping(address => Grant))) public grants;
    RMTV4GrowthVaultV1 private callbackVault;
    bool public refuseSettlement;
    bool public callbackRan;
    bool public callbackSucceeded;

    function setRefuseSettlement(bool refusal) external {
        refuseSettlement = refusal;
    }

    function setCallback(RMTV4GrowthVaultV1 vault) external {
        callbackVault = vault;
    }

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        grants[msg.sender][token][spender] = Grant(amount, expiration);
    }

    function transferFrom(address owner, address recipient, uint160 amount, address token) external {
        require(!refuseSettlement, "fixture settlement failed");
        Grant storage grant = grants[owner][token][msg.sender];
        require(amount <= grant.amount && block.timestamp <= grant.expiration, "unapproved");
        grant.amount -= amount;
        if (owner == address(callbackVault)) {
            callbackRan = true;
            (callbackSucceeded,) =
                address(callbackVault).call(abi.encodeCall(RMTV4GrowthVaultV1.collectReserve, (block.timestamp)));
        }
        require(IERC20(token).transferFrom(owner, recipient, amount), "token transfer failed");
    }
}

contract MaliciousGrowthToken {
    function balanceOf(address) external pure returns (uint256) {
        revert("unexpected arbitrary token call");
    }
}

abstract contract GrowthVaultFixture is GuardedLaunchFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 internal constant REVIEWER_A_KEY = 0xA012001;
    uint256 internal constant REVIEWER_B_KEY = 0xB012001;
    uint8 internal constant ADDED = 1;
    uint8 internal constant INSUFFICIENT = 2;
    uint8 internal constant PRICE_DEFERRED = 3;
    uint8 internal constant MINIMUM_DEFERRED = 4;
    uint8 internal constant SETTLEMENT_DEFERRED = 5;

    IPoolManager internal manager;
    PositionManager internal positionManager;
    address internal permit2;
    RMTV4LaunchFactoryV2 internal factory;
    RMTV4GrowthVaultDeployerV1 internal vaultDeployer;
    address internal creator = makeAddr("growth creator");
    address internal trader = makeAddr("independent growth trader");
    address internal treasury = makeAddr("growth treasury");
    address internal relayer = makeAddr("permissionless growth relayer");

    function _install(IPoolManager manager_, PositionManager positionManager_, address permit2_) internal {
        manager = manager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        factory = _deployPair(
            manager,
            ILaunchPositionManagerV1(address(positionManager)),
            ILaunchPermit2V1(permit2),
            _predictPair(manager)
        );
        vaultDeployer = new RMTV4GrowthVaultDeployerV1(
            factory, address(factory).codehash, vm.addr(REVIEWER_A_KEY), vm.addr(REVIEWER_B_KEY)
        );
        vm.deal(creator, 5 ether);
        vm.deal(trader, 5 ether);
        vm.deal(relayer, 1 ether);
    }

    function _createVault(bytes32 intent) internal returns (RMTV4GrowthVaultV1 vault) {
        vm.prank(creator);
        vault = RMTV4GrowthVaultV1(payable(vaultDeployer.createVault(intent)));
        assertEq(vaultDeployer.vaultFor(creator, intent), address(vault));
        assertEq(vault.creator(), creator);
        assertEq(vault.intentId(), intent);
        assertEq(address(vault.factory()), address(factory));
    }

    function _launch(bytes32 intent, address reserve)
        internal
        returns (address token, PoolKey memory key, uint160 independentOpeningReference)
    {
        RMTV4LaunchFactoryV2.Terms memory terms =
            RMTV4LaunchFactoryV2.Terms("Growth Launch", "GROWTH", "", intent, 0, 8_000, 1 ether, _deadline());
        // Reviewers use the pre-trade, fixed launch ratio for this controlled test.
        // A production deployment would need a separate, trustworthy price reference.
        (,, independentOpeningReference,,,) =
            factory.preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        vm.prank(creator);
        if (reserve == address(0)) {
            token = factory.launch{value: terms.nativeAmount}(terms);
        } else {
            token = factory.launchWithLongevity{value: terms.nativeAmount}(
                terms, RMTV4LongevityLedger.FeePolicy(treasury, reserve, 6_000, 1_000, 3_000)
            );
        }
        key = _pool(token, address(factory.initializationGuard()));
        (uint160 openingPrice,,,) = manager.getSlot0(key.toId());
        assertEq(openingPrice, independentOpeningReference);
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 minutes;
    }

    function _plan(RMTV4GrowthVaultV1 vault, uint160 reviewedPrice)
        internal
        view
        returns (RMTV4GrowthVaultV1.Plan memory)
    {
        return RMTV4GrowthVaultV1.Plan({
            nonce: vault.nextNonce(),
            maxNativeIn: 0.001 ether,
            maxTokenIn: 1_000 ether,
            minLiquidity: 1,
            referenceSqrtPriceX96: reviewedPrice,
            maxSqrtDeviationBps: 30,
            observedAt: uint64(block.timestamp),
            deadline: uint64(_deadline())
        });
    }

    function _signature(uint256 signer, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signer, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signed(RMTV4GrowthVaultV1 vault, RMTV4GrowthVaultV1.Plan memory plan)
        internal
        view
        returns (bytes memory first, bytes memory second)
    {
        bytes32 digest = vault.planDigest(plan);
        return (_signature(REVIEWER_A_KEY, digest), _signature(REVIEWER_B_KEY, digest));
    }

    function _execute(RMTV4GrowthVaultV1 vault, RMTV4GrowthVaultV1.Plan memory plan)
        internal
        returns (uint8 outcome)
    {
        (bytes memory first, bytes memory second) = _signed(vault, plan);
        vm.prank(relayer);
        return uint8(vault.reinvest(plan, first, second));
    }

    function _assertLocked(address token, PoolKey memory key, RMTV4GrowthVaultV1 vault) internal view {
        (, uint256 original, uint128 originalLiquidity) = factory.positions(token);
        RMTV4GrowthVaultV1.Snapshot memory state = vault.snapshot();
        assertEq(positionManager.ownerOf(original), address(factory));
        assertEq(positionManager.getPositionLiquidity(original), originalLiquidity);
        assertGt(state.positionTokenId, 0);
        assertNotEq(state.positionTokenId, original);
        assertEq(positionManager.ownerOf(state.positionTokenId), address(vault));
        assertEq(positionManager.getPositionLiquidity(state.positionTokenId), state.liquidityAdded);
        (PoolKey memory recorded,) = positionManager.getPoolAndPositionInfo(state.positionTokenId);
        assertEq(PoolId.unwrap(recorded.toId()), PoolId.unwrap(key.toId()));
        assertEq(IERC20(token).allowance(address(vault), permit2), 0);
    }

    function _assertAccounting(RMTV4GrowthVaultV1.Snapshot memory state) internal pure {
        assertEq(state.nativeHeld + state.nativeAdded, state.nativeCollected + state.nativePositionFees);
        assertEq(state.tokenHeld + state.tokenAdded, state.tokenCollected + state.tokenPositionFees);
    }
}

contract RMTV4GrowthVaultV1Test is GrowthVaultFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    bytes32 private constant INTENT = bytes32(uint256(11));
    GrowthAllowanceHarness private allowanceHarness;
    PoolSwapTest private swapper;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_900_000_000);
        IPoolManager localManager = new PoolManager(address(this));
        allowanceHarness = new GrowthAllowanceHarness();
        PositionManager localPositionManager = new PositionManager(
            localManager,
            IAllowanceTransfer(address(allowanceHarness)),
            10_000,
            IPositionDescriptor(address(0)),
            IWETH9(address(0))
        );
        _install(localManager, localPositionManager, address(allowanceHarness));
        swapper = new PoolSwapTest(localManager);
    }

    function testOptInCannotBeSubstitutedAfterLaunchOrByAnotherCreator() public {
        RMTV4GrowthVaultV1 rejected = _createVault(INTENT);
        _launch(INTENT, makeAddr("ordinary wallet reserve"));
        vm.expectRevert(RMTV4GrowthVaultV1.LaunchNotOptedIn.selector);
        rejected.collectReserve(_deadline());
        vm.expectRevert(RMTV4GrowthVaultDeployerV1.IntentUnavailable.selector);
        vm.prank(creator);
        vaultDeployer.createVault(INTENT);

        vm.prank(relayer);
        address other = vaultDeployer.createVault(INTENT);
        assertNotEq(other, address(rejected));
        assertEq(vaultDeployer.vaultFor(creator, INTENT), address(rejected));
        vm.expectRevert(RMTV4GrowthVaultV1.LaunchNotOptedIn.selector);
        RMTV4GrowthVaultV1(payable(other)).collectReserve(_deadline());
    }

    function testZeroFeesAndSurplusDoNotCreateSpendableReserve() public {
        (RMTV4GrowthVaultV1 vault, address token,, uint160 reviewedPrice) = _start();
        vm.prank(creator);
        assertTrue(IERC20(token).transfer(address(vault), 100 ether));
        vm.deal(address(vault), 1 ether);
        vault.collectReserve(_deadline());
        assertEq(_execute(vault, _plan(vault, reviewedPrice)), INSUFFICIENT);
        RMTV4GrowthVaultV1.Snapshot memory state = vault.snapshot();
        assertEq(state.nativeHeld, 0);
        assertEq(state.tokenHeld, 0);
        assertEq(state.liquidityAdded, 0);
        assertEq(address(vault).balance, 1 ether);
        assertEq(IERC20(token).balanceOf(address(vault)), 100 ether);
        assertEq(vault.nextNonce(), 0);
        _assertAccounting(state);
    }

    function testAccruedFeesAddLiquidityAndFutureFeesStayInTheSameReserve() public {
        (RMTV4GrowthVaultV1 vault, address token, PoolKey memory key, uint160 reviewedPrice) = _start();
        _earnFees(vault, token, key);
        RMTV4GrowthVaultV1.Snapshot memory collected = vault.snapshot();
        assertGt(collected.nativeCollected, 0);
        assertGt(collected.tokenCollected, 0);
        assertEq(collected.nativeCollected, collected.nativeHeld);
        assertEq(collected.tokenCollected, collected.tokenHeld);
        uint128 activeBefore = manager.getLiquidity(key.toId());
        RMTV4GrowthVaultV1.Plan memory first = _plan(vault, reviewedPrice);
        assertEq(_execute(vault, first), ADDED);
        RMTV4GrowthVaultV1.Snapshot memory added = vault.snapshot();
        _assertLocked(token, key, vault);
        _assertAccounting(added);
        assertGt(added.nativeAdded, 0);
        assertGt(added.tokenAdded, 0);
        assertLe(added.nativeAdded, first.maxNativeIn);
        assertLe(added.tokenAdded, first.maxTokenIn);
        assertEq(manager.getLiquidity(key.toId()), activeBefore + added.liquidityAdded);
        _assertNoApproval(vault, token);
        (bytes memory firstSignature, bytes memory secondSignature) = _signed(vault, first);
        vm.expectRevert(RMTV4GrowthVaultV1.InvalidPlan.selector);
        vault.reinvest(first, firstSignature, secondSignature);

        _earnFees(vault, token, key);
        vault.harvestGrowthFees(_deadline());
        RMTV4GrowthVaultV1.Snapshot memory harvested = vault.snapshot();
        assertGt(harvested.nativePositionFees, 0);
        assertGt(harvested.tokenPositionFees, 0);
        _assertAccounting(harvested);
        assertEq(harvested.positionTokenId, added.positionTokenId);
        assertEq(harvested.liquidityAdded, added.liquidityAdded);
        vault.harvestGrowthFees(_deadline());
        assertEq(vault.snapshot().nativePositionFees, harvested.nativePositionFees);
        assertEq(vault.snapshot().tokenPositionFees, harvested.tokenPositionFees);
        assertEq(_execute(vault, _plan(vault, reviewedPrice)), ADDED);
        RMTV4GrowthVaultV1.Snapshot memory increased = vault.snapshot();
        assertEq(increased.positionTokenId, added.positionTokenId);
        assertGt(increased.liquidityAdded, added.liquidityAdded);
        assertEq(vault.nextNonce(), 2);
        _assertLocked(token, key, vault);
        _assertAccounting(increased);
        _assertNoApproval(vault, token);
    }

    function testManipulatedSpotDefersAndReviewedPlanCanRecover() public {
        (RMTV4GrowthVaultV1 vault, address token, PoolKey memory key, uint160 reviewedPrice) = _start();
        _earnFees(vault, token, key);
        RMTV4GrowthVaultV1.Plan memory plan = _plan(vault, reviewedPrice);
        RMTV4GrowthVaultV1.Snapshot memory before = vault.snapshot();
        _swap(key, true, 0.4 ether);
        assertEq(_execute(vault, plan), PRICE_DEFERRED);
        RMTV4GrowthVaultV1.Snapshot memory deferred = vault.snapshot();
        assertEq(deferred.nativeHeld, before.nativeHeld);
        assertEq(deferred.tokenHeld, before.tokenHeld);
        assertEq(deferred.liquidityAdded, 0);
        assertEq(uint8(deferred.outcome), PRICE_DEFERRED);
        assertEq(deferred.lastAttemptAt, block.timestamp);
        assertEq(vault.nextNonce(), plan.nonce);
        _assertNoApproval(vault, token);
        _swap(key, false, IERC20(token).balanceOf(trader));
        assertEq(_execute(vault, plan), ADDED);
        _assertLocked(token, key, vault);
    }

    function testUnreachableMinimumAndOneSidedInventoryLeaveFundsHeld() public {
        (RMTV4GrowthVaultV1 vault, address token, PoolKey memory key, uint160 reviewedPrice) = _start();
        _swap(key, true, 0.001 ether);
        vault.collectReserve(_deadline());
        RMTV4GrowthVaultV1.Snapshot memory oneSided = vault.snapshot();
        assertGt(oneSided.nativeHeld, 0);
        assertEq(oneSided.tokenHeld, 0);
        assertEq(_execute(vault, _plan(vault, reviewedPrice)), INSUFFICIENT);
        _swap(key, false, IERC20(token).balanceOf(trader));
        vault.collectReserve(_deadline());
        RMTV4GrowthVaultV1.Plan memory plan = _plan(vault, reviewedPrice);
        plan.minLiquidity = type(uint128).max;
        RMTV4GrowthVaultV1.Snapshot memory before = vault.snapshot();
        assertEq(_execute(vault, plan), MINIMUM_DEFERRED);
        RMTV4GrowthVaultV1.Snapshot memory afterAttempt = vault.snapshot();
        assertEq(before.nativeHeld, afterAttempt.nativeHeld);
        assertEq(before.tokenHeld, afterAttempt.tokenHeld);
        assertEq(vault.nextNonce(), 0);
        _assertNoApproval(vault, token);
    }

    function testRejectedSettlementRollsBackAndReentrancyCannotReachTheLedger() public {
        (RMTV4GrowthVaultV1 vault, address token, PoolKey memory key, uint160 reviewedPrice) = _start();
        _earnFees(vault, token, key);
        RMTV4GrowthVaultV1.Plan memory plan = _plan(vault, reviewedPrice);
        RMTV4GrowthVaultV1.Snapshot memory before = vault.snapshot();
        allowanceHarness.setRefuseSettlement(true);
        assertEq(_execute(vault, plan), SETTLEMENT_DEFERRED);
        RMTV4GrowthVaultV1.Snapshot memory failed = vault.snapshot();
        assertEq(failed.nativeHeld, before.nativeHeld);
        assertEq(failed.tokenHeld, before.tokenHeld);
        assertEq(failed.positionTokenId, 0);
        assertEq(uint8(failed.outcome), SETTLEMENT_DEFERRED);
        assertEq(vault.nextNonce(), 0);
        _assertNoApproval(vault, token);

        allowanceHarness.setRefuseSettlement(false);
        allowanceHarness.setCallback(vault);
        assertEq(_execute(vault, plan), ADDED);
        assertTrue(allowanceHarness.callbackRan());
        assertFalse(allowanceHarness.callbackSucceeded());
        _assertLocked(token, key, vault);
        _assertAccounting(vault.snapshot());
        _assertNoApproval(vault, token);
    }

    function testSignaturesBindThePlanVaultAndChainAndCannotBeReplayed() public {
        (RMTV4GrowthVaultV1 vault,,, uint160 reviewedPrice) = _start();
        RMTV4GrowthVaultV1.Plan memory plan = _plan(vault, reviewedPrice);
        bytes32 digest = vault.planDigest(plan);
        bytes memory first = _signature(REVIEWER_A_KEY, digest);
        bytes memory second = _signature(REVIEWER_B_KEY, digest);
        vm.expectRevert(RMTV4GrowthVaultV1.InvalidReviewers.selector);
        vault.reinvest(plan, first, first);
        vm.expectRevert(RMTV4GrowthVaultV1.InvalidReviewers.selector);
        vault.reinvest(plan, second, first);
        plan.maxTokenIn -= 1;
        vm.expectRevert(RMTV4GrowthVaultV1.InvalidReviewers.selector);
        vault.reinvest(plan, first, second);
        plan.maxTokenIn += 1;

        bytes32 otherIntent = bytes32(uint256(INTENT) + 1);
        RMTV4GrowthVaultV1 other = _createVault(otherIntent);
        _launch(otherIntent, address(other));
        assertNotEq(other.planDigest(plan), digest);
        vm.expectRevert(RMTV4GrowthVaultV1.InvalidReviewers.selector);
        other.reinvest(plan, first, second);
        vm.chainId(1);
        vm.expectRevert(RMTV4GrowthVaultV1.WrongChain.selector);
        vault.reinvest(plan, first, second);
        vm.chainId(31337);
        vm.warp(plan.deadline + 1);
        vm.expectRevert(RMTV4GrowthVaultV1.InvalidDeadline.selector);
        vault.reinvest(plan, first, second);
        assertEq(vault.nextNonce(), 0);
    }

    function testVaultPositionIsNotTransferableOrWithdrawableByTheCreator() public {
        (RMTV4GrowthVaultV1 vault, address token, PoolKey memory key, uint160 reviewedPrice) = _start();
        _earnFees(vault, token, key);
        assertEq(_execute(vault, _plan(vault, reviewedPrice)), ADDED);
        RMTV4GrowthVaultV1.Snapshot memory state = vault.snapshot();
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        vm.prank(creator);
        IERC721(address(positionManager)).transferFrom(address(vault), creator, state.positionTokenId);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(state.positionTokenId, uint256(state.liquidityAdded), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, creator);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        vm.expectRevert(abi.encodeWithSelector(IPositionManager.NotApproved.selector, creator));
        vm.prank(creator);
        positionManager.modifyLiquidities(abi.encode(actions, params), _deadline());
        _assertLocked(token, key, vault);
    }

    function testAlteredTokenRuntimeCannotReinvestPreviouslyCollectedReserve() public {
        (RMTV4GrowthVaultV1 vault, address token, PoolKey memory key, uint160 reviewedPrice) = _start();
        _earnFees(vault, token, key);
        RMTV4GrowthVaultV1.Snapshot memory before = vault.snapshot();
        RMTV4GrowthVaultV1.Plan memory plan = _plan(vault, reviewedPrice);
        (bytes memory first, bytes memory second) = _signed(vault, plan);
        vm.etch(token, address(new MaliciousGrowthToken()).code);
        vm.expectRevert(RMTV4GrowthVaultV1.UnexpectedTokenCode.selector);
        vault.reinvest(plan, first, second);
        RMTV4GrowthVaultV1.Snapshot memory afterAttempt = vault.snapshot();
        assertEq(afterAttempt.nativeHeld, before.nativeHeld);
        assertEq(afterAttempt.tokenHeld, before.tokenHeld);
        assertEq(afterAttempt.positionTokenId, 0);
        assertEq(vault.nextNonce(), 0);
    }

    function _start()
        private
        returns (RMTV4GrowthVaultV1 vault, address token, PoolKey memory key, uint160 reviewedPrice)
    {
        vault = _createVault(INTENT);
        (token, key, reviewedPrice) = _launch(INTENT, address(vault));
        (, address actualTreasury, address reserve,,, uint16 reserveBps) = factory.feePolicy(token);
        assertEq(reserve, address(vault));
        assertEq(actualTreasury, treasury);
        assertEq(reserveBps, 3_000);
    }

    function _earnFees(RMTV4GrowthVaultV1 vault, address token, PoolKey memory key) private {
        _swap(key, true, 0.02 ether);
        _swap(key, false, IERC20(token).balanceOf(trader));
        vm.prank(relayer);
        vault.collectReserve(_deadline());
    }

    function _swap(PoolKey memory key, bool buy, uint256 input) private {
        vm.startPrank(trader);
        if (!buy) {
            assertTrue(IERC20(Currency.unwrap(key.currency1)).approve(address(swapper), input));
        }
        swapper.swap{value: buy ? input : 0}(
            key,
            SwapParams(
                buy, -int256(input), buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        vm.stopPrank();
    }

    function _assertNoApproval(RMTV4GrowthVaultV1 vault, address token) private view {
        assertEq(IERC20(token).allowance(address(vault), permit2), 0);
        (uint160 amount, uint48 expiration) = allowanceHarness.grants(address(vault), token, address(positionManager));
        assertEq(amount, 0);
        assertEq(expiration, 0);
    }
}
