// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PositionInfo} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import {ILaunchPermit2V1, ILaunchPositionManagerV1, RMTV4LaunchTokenV1} from "./RMTV4LaunchFactoryV1.sol";
import {RMTV4LaunchFactoryV2} from "./RMTV4LaunchFactoryV2.sol";

interface IGrowthPositionManagerV1 is ILaunchPositionManagerV1 {
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, PositionInfo);
}

/// @notice Test-chain reserve vault bound to one creator, one launch intent and its canonical V2 pool.
/// @dev Reviewed reference prices require two immutable ECDSA keys. The vault has no signer, oracle or keeper of its own.
contract RMTV4GrowthVaultV1 is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 public constant CHAIN_ID = 31_337;
    uint64 public constant MAX_REFERENCE_AGE = 5 minutes;
    uint16 public constant MAX_SQRT_DEVIATION_BPS = 50;
    uint128 public constant MAX_NATIVE_IN = 100 ether;
    uint128 public constant MAX_TOKEN_IN = 1_000_000_000 ether;
    uint256 private constant SETTLEMENT_GAS_RESERVE = 230_000;
    uint256 private constant Q96 = 1 << 96;
    uint24 private constant LP_FEE = 3_000;
    int24 private constant TICK_SPACING = 60;
    int24 private constant TICK_LOWER = -887_220;
    int24 private constant TICK_UPPER = 887_220;
    uint8 private constant RESERVE_BUCKET = 2;
    bytes32 private constant PLAN_TYPEHASH = keccak256(
        "Reinvestment(bytes32 poolId,address token,uint256 nonce,uint128 maxNativeIn,uint128 maxTokenIn,uint128 minLiquidity,uint160 referenceSqrtPriceX96,uint16 maxSqrtDeviationBps,uint64 observedAt,uint64 deadline)"
    );

    enum Outcome {
        None,
        Added,
        InsufficientAssets,
        PriceDeviation,
        BelowMinimum,
        SettlementDeferred
    }

    struct Plan {
        uint256 nonce;
        uint128 maxNativeIn;
        uint128 maxTokenIn;
        uint128 minLiquidity;
        uint160 referenceSqrtPriceX96;
        uint16 maxSqrtDeviationBps;
        uint64 observedAt;
        uint64 deadline;
    }

    struct Snapshot {
        uint256 nativeCollected;
        uint256 tokenCollected;
        uint256 nativePositionFees;
        uint256 tokenPositionFees;
        uint256 nativeHeld;
        uint256 tokenHeld;
        uint256 nativeAdded;
        uint256 tokenAdded;
        uint128 liquidityAdded;
        uint256 positionTokenId;
        uint64 lastAttemptAt;
        Outcome outcome;
    }

    struct Addition {
        uint128 nativeAmount;
        uint128 tokenAmount;
        uint128 liquidity;
    }

    RMTV4LaunchFactoryV2 public immutable factory;
    bytes32 public immutable factoryRuntimeHash;
    bytes32 public immutable tokenRuntimeHash;
    address public immutable creator;
    bytes32 public immutable intentId;
    address public immutable reviewerA;
    address public immutable reviewerB;
    IPoolManager public immutable poolManager;
    IGrowthPositionManagerV1 public immutable positionManager;
    ILaunchPermit2V1 public immutable permit2;
    IHooks public immutable initializationGuard;

    uint256 public nextNonce;
    Snapshot private state;

    event ReserveCollected(address indexed token, uint256 nativeAmount, uint256 tokenAmount);
    event GrowthPositionFeesCollected(address indexed token, uint256 nativeAmount, uint256 tokenAmount);
    event GrowthLiquidityAdded(
        address indexed token,
        bytes32 indexed poolId,
        uint256 indexed positionTokenId,
        uint256 nonce,
        uint128 nativeAmount,
        uint128 tokenAmount,
        uint128 liquidity
    );
    event ReinvestmentAttempt(uint256 indexed nonce, bytes32 indexed planDigest, Outcome outcome);

    error WrongChain();
    error InvalidSetup();
    error RuntimeIdentityMismatch();
    error LaunchNotOptedIn();
    error UnexpectedTokenCode();
    error InvalidPlan();
    error InvalidReviewers();
    error InvalidDeadline();
    error UnverifiedCustody();
    error BalanceMismatch();
    error UnexpectedNativePayment();
    error SettlementCaller();
    error InsufficientExecutionGas();

    constructor(
        RMTV4LaunchFactoryV2 factory_,
        bytes32 factoryRuntimeHash_,
        bytes32 tokenRuntimeHash_,
        address creator_,
        bytes32 intentId_,
        address reviewerA_,
        address reviewerB_
    ) EIP712("RMT V4 Growth Vault", "1") {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (
            creator_ == address(0) || intentId_ == bytes32(0) || reviewerA_ == address(0) || reviewerB_ == address(0)
                || reviewerA_ == reviewerB_ || creator_ == reviewerA_ || creator_ == reviewerB_
                || tokenRuntimeHash_ == bytes32(0)
        ) revert InvalidSetup();
        if (address(factory_).code.length == 0 || address(factory_).codehash != factoryRuntimeHash_) {
            revert RuntimeIdentityMismatch();
        }
        factory = factory_;
        factoryRuntimeHash = factoryRuntimeHash_;
        tokenRuntimeHash = tokenRuntimeHash_;
        creator = creator_;
        intentId = intentId_;
        reviewerA = reviewerA_;
        reviewerB = reviewerB_;
        poolManager = factory_.poolManager();
        positionManager = IGrowthPositionManagerV1(address(factory_.positionManager()));
        permit2 = factory_.permit2();
        initializationGuard = IHooks(address(factory_.initializationGuard()));
        _verifyDependencies();
    }

    function snapshot() external view returns (Snapshot memory) {
        return state;
    }

    function launchContext() external view returns (address token, bytes32 poolId) {
        PoolKey memory key;
        (token, key) = _verifiedLaunch();
        poolId = PoolId.unwrap(key.toId());
    }

    function planDigest(Plan calldata plan) external view returns (bytes32) {
        (address token, PoolKey memory key) = _verifiedLaunch();
        return _planDigest(token, key.toId(), plan);
    }

    /// @notice Collect original LP fees and withdraw only this vault's fixed reserve allocation.
    // The vault-wide lock spans both balance reads and the pinned factory payout.
    // slither-disable-next-line reentrancy-balance
    function collectReserve(uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        _checkDeadline(deadline);
        (address token,) = _verifiedLaunch();
        factory.collectFees(token, deadline);
        (, nativeAmount, tokenAmount,,) = factory.feeBucket(token, RESERVE_BUCKET);
        if (nativeAmount == 0 && tokenAmount == 0) return (0, 0);

        IERC20 asset = IERC20(token);
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = asset.balanceOf(address(this));
        factory.withdrawFees(token, RESERVE_BUCKET);
        if (
            address(this).balance != nativeBefore + nativeAmount
                || asset.balanceOf(address(this)) != tokenBefore + tokenAmount
        ) revert BalanceMismatch();
        state.nativeCollected += nativeAmount;
        state.tokenCollected += tokenAmount;
        state.nativeHeld += nativeAmount;
        state.tokenHeld += tokenAmount;
        emit ReserveCollected(token, nativeAmount, tokenAmount);
    }

    /// @notice A separate fee-only harvest adds actual position fees to the tracked reserve balances.
    function harvestGrowthFees(uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        _checkDeadline(deadline);
        (address token, PoolKey memory key) = _verifiedLaunch();
        if (state.positionTokenId == 0) return (0, 0);
        (nativeAmount, tokenAmount) = _measureGrowthFees(token, key, deadline);
        _creditGrowthFees(token, nativeAmount, tokenAmount);
    }

    /// @notice Permissionless execution of a fresh, jointly reviewed, single-pool liquidity addition.
    function reinvest(Plan calldata plan, bytes calldata signatureA, bytes calldata signatureB)
        external
        nonReentrant
        returns (Outcome outcome)
    {
        (address token, PoolKey memory key) = _verifiedLaunch();
        _validatePlan(plan);
        PoolId poolId = key.toId();
        bytes32 digest = _planDigest(token, poolId, plan);
        if (ECDSA.recover(digest, signatureA) != reviewerA || ECDSA.recover(digest, signatureB) != reviewerB) {
            revert InvalidReviewers();
        }

        Addition memory addition;
        (outcome, addition) = _preview(poolId, plan);
        if (outcome == Outcome.Added) {
            // Leave gas for accounting or a recoverable deferral after the isolated settlement subcall.
            if (gasleft() < 850_000) revert InsufficientExecutionGas();
            try this.settle{gas: gasleft() - SETTLEMENT_GAS_RESERVE}(token, key, addition, plan.deadline) returns (
                uint256 positionId, uint256 nativeFees, uint256 tokenFees
            ) {
                _creditGrowthFees(token, nativeFees, tokenFees);
                state.positionTokenId = positionId;
                state.liquidityAdded += addition.liquidity;
                state.nativeHeld -= addition.nativeAmount;
                state.tokenHeld -= addition.tokenAmount;
                state.nativeAdded += addition.nativeAmount;
                state.tokenAdded += addition.tokenAmount;
                nextNonce = plan.nonce + 1;
                emit GrowthLiquidityAdded(
                    token,
                    PoolId.unwrap(poolId),
                    positionId,
                    plan.nonce,
                    addition.nativeAmount,
                    addition.tokenAmount,
                    addition.liquidity
                );
            } catch {
                // Every change inside settlement, including Permit2 approvals, is rolled back.
                outcome = Outcome.SettlementDeferred;
            }
        }
        // The validated uint48 deadline bounds the current block timestamp.
        state.lastAttemptAt = uint64(block.timestamp);
        state.outcome = outcome;
        emit ReinvestmentAttempt(plan.nonce, digest, outcome);
    }

    /// @dev The guarded caller records accounting only after this isolated settlement succeeds.
    // The self-call executes under the vault-wide lock and uses pinned token, manager and Permit2 code.
    // slither-disable-next-line reentrancy-balance
    function settle(address token, PoolKey calldata key, Addition calldata addition, uint256 deadline)
        external
        returns (uint256 id, uint256 nativeFees, uint256 tokenFees)
    {
        if (msg.sender != address(this) || !_reentrancyGuardEntered()) revert SettlementCaller();
        id = state.positionTokenId;
        IERC20 asset = IERC20(token);
        bytes[] memory params = new bytes[](2);
        uint8 liquidityAction;
        if (id == 0) {
            id = positionManager.nextTokenId();
            liquidityAction = uint8(Actions.MINT_POSITION);
            params[0] = abi.encode(
                key,
                TICK_LOWER,
                TICK_UPPER,
                addition.liquidity,
                addition.nativeAmount,
                addition.tokenAmount,
                address(this),
                bytes("")
            );
        } else {
            // Clear already-earned fees first so they cannot silently subsidize the measured principal input.
            (nativeFees, tokenFees) = _measureGrowthFees(token, key, deadline);
            liquidityAction = uint8(Actions.INCREASE_LIQUIDITY);
            params[0] = abi.encode(id, addition.liquidity, addition.nativeAmount, addition.tokenAmount, bytes(""));
        }
        params[1] = abi.encode(key.currency0, key.currency1);

        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = asset.balanceOf(address(this));
        if (nativeBefore < state.nativeHeld + nativeFees || tokenBefore < state.tokenHeld + tokenFees) {
            revert BalanceMismatch();
        }
        asset.forceApprove(address(permit2), addition.tokenAmount);
        // The only caller validated this deadline against the Permit2 expiration width.
        permit2.approve(token, address(positionManager), addition.tokenAmount, uint48(deadline));
        positionManager.modifyLiquidities{value: addition.nativeAmount}(
            abi.encode(abi.encodePacked(liquidityAction, uint8(Actions.SETTLE_PAIR)), params), deadline
        );
        permit2.approve(token, address(positionManager), 0, 0);
        asset.forceApprove(address(permit2), 0);
        if (
            address(this).balance != nativeBefore - addition.nativeAmount
                || asset.balanceOf(address(this)) != tokenBefore - addition.tokenAmount
        ) revert BalanceMismatch();
        _checkPosition(id, address(this), key.toId(), state.liquidityAdded + addition.liquidity);
    }

    receive() external payable {
        if (msg.sender != address(factory) && msg.sender != address(poolManager)) revert UnexpectedNativePayment();
    }

    function _measureGrowthFees(address token, PoolKey memory key, uint256 deadline)
        private
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        uint256 id = state.positionTokenId;
        PoolId poolId = key.toId();
        uint128 liquidity = state.liquidityAdded;
        _checkPosition(id, address(this), poolId, liquidity);
        IERC20 asset = IERC20(token);
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = asset.balanceOf(address(this));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(id, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(this));
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        positionManager.modifyLiquidities(abi.encode(actions, params), deadline);
        _checkPosition(id, address(this), poolId, liquidity);
        nativeAmount = address(this).balance - nativeBefore;
        tokenAmount = asset.balanceOf(address(this)) - tokenBefore;
    }

    function _creditGrowthFees(address token, uint256 nativeAmount, uint256 tokenAmount) private {
        if (nativeAmount == 0 && tokenAmount == 0) return;
        state.nativePositionFees += nativeAmount;
        state.tokenPositionFees += tokenAmount;
        state.nativeHeld += nativeAmount;
        state.tokenHeld += tokenAmount;
        emit GrowthPositionFeesCollected(token, nativeAmount, tokenAmount);
    }

    function _preview(PoolId poolId, Plan calldata plan) private view returns (Outcome, Addition memory addition) {
        if (state.nativeHeld == 0 || state.tokenHeld == 0) return (Outcome.InsufficientAssets, addition);
        (uint160 spot,,,) = poolManager.getSlot0(poolId);
        uint160 lower = TickMath.getSqrtPriceAtTick(TICK_LOWER);
        uint160 upper = TickMath.getSqrtPriceAtTick(TICK_UPPER);
        uint160 referencePrice = plan.referenceSqrtPriceX96;
        uint256 deviation = spot >= referencePrice ? spot - referencePrice : referencePrice - spot;
        if (spot <= lower || spot >= upper || deviation * 10_000 > uint256(referencePrice) * plan.maxSqrtDeviationBps) {
            return (Outcome.PriceDeviation, addition);
        }
        uint256 nativeLimit = Math.min(state.nativeHeld, plan.maxNativeIn);
        uint256 tokenLimit = Math.min(state.tokenHeld, plan.maxTokenIn);
        // Bound each leg before taking the minimum. An extreme price near one tick can make the unused leg
        // exceed uint128 even while the opposite leg and the actual addition are small.
        uint128 capacity = type(uint128).max - state.liquidityAdded;
        uint128 nativeLiquidity = _boundedLiquidity(nativeLimit, Math.mulDiv(spot, upper, Q96), upper - spot, capacity);
        uint128 tokenLiquidity = _boundedLiquidity(tokenLimit, Q96, spot - lower, capacity);
        addition.liquidity = nativeLiquidity < tokenLiquidity ? nativeLiquidity : tokenLiquidity;
        if (addition.liquidity < plan.minLiquidity) return (Outcome.BelowMinimum, addition);
        uint256 nativeAmount = SqrtPriceMath.getAmount0Delta(spot, upper, addition.liquidity, true);
        uint256 tokenAmount = SqrtPriceMath.getAmount1Delta(lower, spot, addition.liquidity, true);
        if (nativeAmount == 0 || tokenAmount == 0 || nativeAmount > nativeLimit || tokenAmount > tokenLimit) {
            return (Outcome.BelowMinimum, addition);
        }
        // Both limits are at most their respective uint128 plan caps.
        addition.nativeAmount = uint128(nativeAmount);
        addition.tokenAmount = uint128(tokenAmount);
        return (Outcome.Added, addition);
    }

    function _boundedLiquidity(uint256 amount, uint256 numerator, uint256 denominator, uint128 capacity)
        private
        pure
        returns (uint128)
    {
        uint256 amountAtCapacity = Math.mulDiv(capacity, denominator, numerator, Math.Rounding.Ceil);
        if (amount >= amountAtCapacity) return capacity;
        // Amounts below the ceiling produce liquidity strictly below uint128 capacity.
        return uint128(Math.mulDiv(amount, numerator, denominator));
    }

    function _validatePlan(Plan calldata plan) private view {
        _checkDeadline(plan.deadline);
        if (
            plan.nonce != nextNonce || plan.observedAt > block.timestamp
                || block.timestamp - plan.observedAt > MAX_REFERENCE_AGE
                || uint256(plan.deadline) > uint256(plan.observedAt) + MAX_REFERENCE_AGE || plan.maxNativeIn == 0
                || plan.maxNativeIn > MAX_NATIVE_IN || plan.maxTokenIn == 0 || plan.maxTokenIn > MAX_TOKEN_IN
                || plan.minLiquidity == 0 || plan.referenceSqrtPriceX96 <= TickMath.getSqrtPriceAtTick(TICK_LOWER)
                || plan.referenceSqrtPriceX96 >= TickMath.getSqrtPriceAtTick(TICK_UPPER)
                || plan.maxSqrtDeviationBps == 0 || plan.maxSqrtDeviationBps > MAX_SQRT_DEVIATION_BPS
        ) revert InvalidPlan();
    }

    function _planDigest(address token, PoolId poolId, Plan calldata plan) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PLAN_TYPEHASH,
                    PoolId.unwrap(poolId),
                    token,
                    plan.nonce,
                    plan.maxNativeIn,
                    plan.maxTokenIn,
                    plan.minLiquidity,
                    plan.referenceSqrtPriceX96,
                    plan.maxSqrtDeviationBps,
                    plan.observedAt,
                    plan.deadline
                )
            )
        );
    }

    function _verifiedLaunch() private view returns (address token, PoolKey memory key) {
        _verifyDependencies();
        token = factory.launches(creator, intentId);
        if (token == address(0)) revert LaunchNotOptedIn();
        if (token.codehash != tokenRuntimeHash) revert UnexpectedTokenCode();
        (address feeCreator,, address reserve,,, uint16 share) = factory.feePolicy(token);
        if (feeCreator != creator || reserve != address(this) || share == 0) revert LaunchNotOptedIn();
        (address positionCreator, uint256 originalId, uint128 originalLiquidity) = factory.positions(token);
        if (positionCreator != creator) revert LaunchNotOptedIn();
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(token), LP_FEE, TICK_SPACING, initializationGuard);
        _checkPosition(originalId, address(factory), key.toId(), originalLiquidity);
    }

    function _checkPosition(uint256 id, address owner, PoolId poolId, uint128 liquidity) private view {
        (PoolKey memory actualKey, PositionInfo info) = positionManager.getPoolAndPositionInfo(id);
        if (
            id == 0 || liquidity == 0 || positionManager.ownerOf(id) != owner
                || positionManager.getPositionLiquidity(id) != liquidity
                || PoolId.unwrap(actualKey.toId()) != PoolId.unwrap(poolId) || info.tickLower() != TICK_LOWER
                || info.tickUpper() != TICK_UPPER || info.hasSubscriber()
        ) revert UnverifiedCustody();
    }

    function _checkDeadline(uint256 deadline) private view {
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_REFERENCE_AGE || deadline > type(uint48).max) {
            revert InvalidDeadline();
        }
    }

    function _verifyDependencies() private view {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (
            address(factory).codehash != factoryRuntimeHash
                || address(poolManager).codehash != factory.poolManagerRuntimeHash()
                || address(positionManager).codehash != factory.positionManagerRuntimeHash()
                || address(permit2).codehash != factory.permit2RuntimeHash()
                || address(initializationGuard).codehash != factory.initializationGuardRuntimeHash()
                || uint160(address(initializationGuard)) & Hooks.ALL_HOOK_MASK != Hooks.BEFORE_INITIALIZE_FLAG
        ) revert RuntimeIdentityMismatch();
    }
}

/// @notice Registers one test vault for each creator-selected, unused V2 launch intent.
contract RMTV4GrowthVaultDeployerV1 {
    RMTV4LaunchFactoryV2 public immutable factory;
    bytes32 public immutable factoryRuntimeHash;
    bytes32 public immutable tokenRuntimeHash;
    address public immutable reviewerA;
    address public immutable reviewerB;
    mapping(address creator => mapping(bytes32 intentId => address vault)) public vaultFor;

    event GrowthVaultCreated(address indexed creator, bytes32 indexed intentId, address indexed vault);

    error WrongChain();
    error InvalidSetup();
    error IntentUnavailable();

    constructor(RMTV4LaunchFactoryV2 factory_, bytes32 factoryRuntimeHash_, address reviewerA_, address reviewerB_) {
        if (block.chainid != 31_337) revert WrongChain();
        if (
            address(factory_).code.length == 0 || address(factory_).codehash != factoryRuntimeHash_
                || reviewerA_ == address(0) || reviewerB_ == address(0) || reviewerA_ == reviewerB_
        ) revert InvalidSetup();
        factory = factory_;
        factoryRuntimeHash = factoryRuntimeHash_;
        tokenRuntimeHash = keccak256(type(RMTV4LaunchTokenV1).runtimeCode);
        reviewerA = reviewerA_;
        reviewerB = reviewerB_;
    }

    function createVault(bytes32 intentId) external returns (address vault) {
        if (block.chainid != 31_337) revert WrongChain();
        if (address(factory).codehash != factoryRuntimeHash) revert InvalidSetup();
        if (
            intentId == bytes32(0) || vaultFor[msg.sender][intentId] != address(0)
                || factory.launches(msg.sender, intentId) != address(0)
        ) revert IntentUnavailable();
        bytes32 salt = keccak256(abi.encode(msg.sender, intentId));
        vault = address(
            new RMTV4GrowthVaultV1{salt: salt}(
                factory, factoryRuntimeHash, tokenRuntimeHash, msg.sender, intentId, reviewerA, reviewerB
            )
        );
        vaultFor[msg.sender][intentId] = vault;
        emit GrowthVaultCreated(msg.sender, intentId, vault);
    }
}
