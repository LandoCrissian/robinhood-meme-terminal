// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {FixedPoint128} from "@uniswap/v4-core/src/libraries/FixedPoint128.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {IRMTV4CurveGraduationV1} from "./interfaces/IRMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1} from "./RMTV4CurveInitializationGuardV1.sol";
import {RMTLaunchCurveLpFeeLedgerV1} from "./RMTLaunchCurveLpFeeLedgerV1.sol";

interface ICurveGraduationFactoryV1 {
    function curveForToken(address token) external view returns (address);
}

interface ICurveGraduationMarketV1 {
    function active() external view returns (bool);
    function token() external view returns (address);
    function factory() external view returns (address);
    function graduationEngine() external view returns (address);
    function creator() external view returns (address);
    function treasury() external view returns (address);
    function treasuryShareBps() external view returns (uint16);
    function operatingRecipient() external view returns (address);
    function futureReserveRecipient() external view returns (address);
}

interface ICurvePositionManagerV1 {
    function poolManager() external view returns (IPoolManager);
    function permit2() external view returns (address);
    function nextTokenId() external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, PositionInfo);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface ICurvePermit2V1 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
    function allowance(address owner, address token, address spender) external view returns (uint160, uint48, uint48);
}

/// @notice Atomically funds a permanently held full-range v4 position from an eligible V1 curve.
/// @dev The original position can only receive a zero-liquidity fee poke. Custody has no upgrade path.
contract RMTV4CurveGraduationV1 is IRMTV4CurveGraduationV1, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using PositionInfoLibrary for PositionInfo;
    using StateLibrary for IPoolManager;

    uint32 public constant LP_FEE_ACCOUNTING_VERSION = 1;
    uint256 public constant CHAIN_ID = 31_337;
    uint256 public constant MAX_DEADLINE_WINDOW = 30 minutes;
    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    int24 public constant TICK_LOWER = -887_220;
    int24 public constant TICK_UPPER = 887_220;

    struct Dependencies {
        IPoolManager poolManager;
        ICurvePositionManagerV1 positionManager;
        ICurvePermit2V1 permit2;
        bytes32 poolManagerHash;
        bytes32 positionManagerHash;
        bytes32 permit2Hash;
    }

    struct LockedPosition {
        uint256 tokenId;
        uint128 liquidity;
    }

    struct Funding {
        uint160 sqrtPriceX96;
        uint128 liquidity;
        uint128 nativeUsed;
        uint128 tokenUsed;
    }

    struct FeeSnapshot {
        uint256 nativeAmount;
        uint256 tokenAmount;
        uint256 growth0;
        uint256 growth1;
    }

    address public immutable override factory;
    IPoolManager public immutable poolManager;
    ICurvePositionManagerV1 public immutable positionManager;
    ICurvePermit2V1 public immutable permit2;
    RMTV4CurveInitializationGuardV1 public immutable initializationGuard;
    bytes32 public immutable poolManagerRuntimeHash;
    bytes32 public immutable positionManagerRuntimeHash;
    bytes32 public immutable permit2RuntimeHash;
    bytes32 public immutable initializationGuardRuntimeHash;

    mapping(address token => LockedPosition position) public positions;
    mapping(address token => RMTLaunchCurveLpFeeLedgerV1 ledger) public lpFeeLedger;

    event CurveGraduated(
        address indexed token,
        address indexed curve,
        bytes32 indexed poolId,
        PoolKey poolKey,
        uint160 sqrtPriceX96,
        uint256 positionTokenId,
        uint128 liquidity,
        uint128 nativeUsed,
        uint128 tokenUsed,
        uint128 nativeDust,
        uint128 tokenDust
    );
    event LpFeesCollected(
        address indexed token,
        uint256 indexed positionTokenId,
        address indexed ledger,
        uint256 nativeAmount,
        uint256 tokenAmount
    );

    error WrongChain();
    error InvalidDependencies();
    error UnauthorizedCurve();
    error AlreadyGraduated();
    error InvalidDeadline();
    error InvalidFunding();
    error SettlementMismatch();
    error DustReturnFailed();
    error NoLpFees();

    constructor(
        Dependencies memory dependencies,
        ICurveGraduationFactoryV1 factory_,
        RMTV4CurveInitializationGuardV1 guard
    ) {
        factory = address(factory_);
        poolManager = dependencies.poolManager;
        positionManager = dependencies.positionManager;
        permit2 = dependencies.permit2;
        initializationGuard = guard;
        poolManagerRuntimeHash = dependencies.poolManagerHash;
        positionManagerRuntimeHash = dependencies.positionManagerHash;
        permit2RuntimeHash = dependencies.permit2Hash;
        initializationGuardRuntimeHash = address(guard).codehash;
        _verifyDependencies();
        if (
            address(factory_) == address(0) || positionManager.poolManager() != poolManager
                || positionManager.permit2() != address(permit2) || guard.poolManager() != poolManager
                || guard.graduationEngine() != address(this)
                || uint160(address(guard)) & Hooks.ALL_HOOK_MASK != Hooks.BEFORE_INITIALIZE_FLAG
        ) revert InvalidDependencies();
    }

    function canonicalPoolKey(address token) public view returns (PoolKey memory) {
        return PoolKey(
            Currency.wrap(address(0)),
            Currency.wrap(token),
            POOL_FEE,
            TICK_SPACING,
            IHooks(address(initializationGuard))
        );
    }

    /// @notice Calculates the actual settlement amounts and the floor-rounded Q96 square-root price.
    /// @param priceNumerator Virtual token reserve at the terminal curve point.
    /// @param priceDenominator Virtual native reserve plus real native backing at the terminal curve point.
    function previewFunding(
        uint256 nativeReserve,
        uint256 tokenReserve,
        uint256 priceNumerator,
        uint256 priceDenominator
    ) public pure returns (Funding memory funding) {
        if (
            nativeReserve == 0 || nativeReserve > type(uint128).max || tokenReserve == 0
                || tokenReserve > type(uint128).max || priceNumerator == 0 || priceNumerator > type(uint128).max
                || priceDenominator == 0 || priceDenominator > type(uint128).max
        ) revert InvalidFunding();

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(TICK_LOWER);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(TICK_UPPER);
        funding.sqrtPriceX96 = Math.sqrt(Math.mulDiv(priceNumerator, 1 << 192, priceDenominator)).toUint160();
        if (funding.sqrtPriceX96 <= sqrtLower || funding.sqrtPriceX96 >= sqrtUpper) revert InvalidFunding();
        funding.liquidity = LiquidityAmounts.getLiquidityForAmounts(
            funding.sqrtPriceX96, sqrtLower, sqrtUpper, nativeReserve, tokenReserve
        );
        funding.nativeUsed =
            SqrtPriceMath.getAmount0Delta(funding.sqrtPriceX96, sqrtUpper, funding.liquidity, true).toUint128();
        funding.tokenUsed =
            SqrtPriceMath.getAmount1Delta(sqrtLower, funding.sqrtPriceX96, funding.liquidity, true).toUint128();
        if (
            funding.liquidity == 0 || funding.nativeUsed == 0 || funding.tokenUsed == 0
                || funding.nativeUsed > nativeReserve || funding.tokenUsed > tokenReserve
                || nativeReserve - funding.nativeUsed > nativeReserve / 10_000 + 1
                || tokenReserve - funding.tokenUsed > tokenReserve / 10_000 + 1
        ) revert InvalidFunding();
    }

    function graduate(
        address token,
        uint256 nativeReserve,
        uint256 tokenReserve,
        uint256 priceNumerator,
        uint256 priceDenominator,
        uint256 deadline
    )
        external
        payable
        override
        nonReentrant
        returns (bytes32 poolId, uint256 positionTokenId, uint256 nativeUsed, uint256 tokenUsed)
    {
        _verifyDependencies();
        ICurveGraduationMarketV1 curve = ICurveGraduationMarketV1(msg.sender);
        if (
            token.code.length == 0 || ICurveGraduationFactoryV1(factory).curveForToken(token) != msg.sender
                || !curve.active() || curve.token() != token || curve.factory() != factory
                || curve.graduationEngine() != address(this)
        ) {
            revert UnauthorizedCurve();
        }
        if (positions[token].liquidity != 0) revert AlreadyGraduated();
        _verifyDeadline(deadline);
        if (msg.value != nativeReserve) revert InvalidFunding();
        Funding memory funding = previewFunding(nativeReserve, tokenReserve, priceNumerator, priceDenominator);
        PoolKey memory key = canonicalPoolKey(token);
        poolId = PoolId.unwrap(key.toId());
        positionTokenId = positionManager.nextTokenId();
        // Reserve the original position identity before external settlement. Any failure rolls it back.
        positions[token] = LockedPosition(positionTokenId, funding.liquidity);
        lpFeeLedger[token] = new RMTLaunchCurveLpFeeLedgerV1(
            IERC20(token),
            address(poolManager),
            RMTLaunchCurveLpFeeLedgerV1.Policy(
                curve.creator(),
                curve.treasury(),
                curve.treasuryShareBps(),
                curve.operatingRecipient(),
                curve.futureReserveRecipient()
            )
        );
        int24 tick = poolManager.initialize(key, funding.sqrtPriceX96);
        if (tick < TICK_LOWER || tick >= TICK_UPPER) revert SettlementMismatch();
        _fundPosition(token, key, positionTokenId, funding, deadline);

        uint128 nativeDust = (nativeReserve - funding.nativeUsed).toUint128();
        if (nativeDust != 0) {
            (bool sent,) = msg.sender.call{value: nativeDust}("");
            if (!sent) revert DustReturnFailed();
        }
        emit CurveGraduated(
            token,
            msg.sender,
            poolId,
            key,
            funding.sqrtPriceX96,
            positionTokenId,
            funding.liquidity,
            funding.nativeUsed,
            funding.tokenUsed,
            nativeDust,
            (tokenReserve - funding.tokenUsed).toUint128()
        );
        return (poolId, positionTokenId, funding.nativeUsed, funding.tokenUsed);
    }

    /// @notice Original position's currently earned and uncollected fees at the calling block.
    function previewLpFees(address token) external view returns (uint256 nativeAmount, uint256 tokenAmount) {
        if (_reentrancyGuardEntered()) revert ReentrancyGuardReentrantCall();
        _verifyDependencies();
        LockedPosition memory position = positions[token];
        if (position.liquidity == 0) return (0, 0);
        PoolId id = _verifyPosition(canonicalPoolKey(token), position);
        FeeSnapshot memory fees = _positionFees(id, position);
        return (fees.nativeAmount, fees.tokenAmount);
    }

    /// @notice Collects earned fees from only this token's original position into its immutable ledger.
    function collectLpFees(address token, uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        _verifyDependencies();
        _verifyDeadline(deadline);
        LockedPosition memory position = positions[token];
        RMTLaunchCurveLpFeeLedgerV1 ledger = lpFeeLedger[token];
        if (position.liquidity == 0 || address(ledger) == address(0)) revert NoLpFees();
        PoolKey memory key = canonicalPoolKey(token);
        PoolId id = _verifyPosition(key, position);
        _verifyAllowances(IERC20(token));
        FeeSnapshot memory fees = _positionFees(id, position);
        if (fees.nativeAmount == 0 && fees.tokenAmount == 0) revert NoLpFees();

        uint256 ledgerNative = address(ledger).balance;
        uint256 ledgerToken = IERC20(token).balanceOf(address(ledger));
        // Only an increase with a zero liquidity delta and zero maximum inputs is encoded.
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(position.tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(ledger));
        bytes memory actions = abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        positionManager.modifyLiquidities(abi.encode(actions, params), deadline);

        _verifyPosition(key, position);
        _verifyAllowances(IERC20(token));
        (uint128 liquidity, uint256 growth0, uint256 growth1) =
            poolManager.getPositionInfo(id, address(positionManager), TICK_LOWER, TICK_UPPER, bytes32(position.tokenId));
        if (
            liquidity != position.liquidity || growth0 != fees.growth0 || growth1 != fees.growth1
                || address(ledger).balance != ledgerNative + fees.nativeAmount
                || IERC20(token).balanceOf(address(ledger)) != ledgerToken + fees.tokenAmount
        ) revert SettlementMismatch();
        ledger.record(fees.nativeAmount, fees.tokenAmount);
        emit LpFeesCollected(token, position.tokenId, address(ledger), fees.nativeAmount, fees.tokenAmount);
        return (fees.nativeAmount, fees.tokenAmount);
    }

    function _positionFees(PoolId id, LockedPosition memory position) private view returns (FeeSnapshot memory fees) {
        (uint128 liquidity, uint256 last0, uint256 last1) =
            poolManager.getPositionInfo(id, address(positionManager), TICK_LOWER, TICK_UPPER, bytes32(position.tokenId));
        if (liquidity != position.liquidity) revert SettlementMismatch();
        (fees.growth0, fees.growth1) = poolManager.getFeeGrowthInside(id, TICK_LOWER, TICK_UPPER);
        // Uniswap fee growth accumulators intentionally wrap modulo 2^256.
        unchecked {
            fees.nativeAmount = Math.mulDiv(fees.growth0 - last0, liquidity, FixedPoint128.Q128);
            fees.tokenAmount = Math.mulDiv(fees.growth1 - last1, liquidity, FixedPoint128.Q128);
        }
    }

    function _fundPosition(
        address token,
        PoolKey memory key,
        uint256 positionTokenId,
        Funding memory funding,
        uint256 deadline
    ) private {
        IERC20 asset = IERC20(token);
        _verifyAllowances(asset);
        uint256 engineBefore = asset.balanceOf(address(this));
        uint256 poolBefore = asset.balanceOf(address(poolManager));
        uint256 nativeBefore = address(poolManager).balance;
        asset.safeTransferFrom(msg.sender, address(this), funding.tokenUsed);
        if (asset.balanceOf(address(this)) != engineBefore + funding.tokenUsed) revert SettlementMismatch();

        if (!asset.approve(address(permit2), funding.tokenUsed)) revert SettlementMismatch();
        permit2.approve(token, address(positionManager), funding.tokenUsed, uint48(deadline));
        (uint160 granted, uint48 expiry,) = permit2.allowance(address(this), token, address(positionManager));
        if (
            granted != funding.tokenUsed || expiry != deadline
                || asset.allowance(address(this), address(permit2)) != funding.tokenUsed
        ) {
            revert SettlementMismatch();
        }
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            TICK_LOWER,
            TICK_UPPER,
            funding.liquidity,
            funding.nativeUsed,
            funding.tokenUsed,
            address(this),
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        positionManager.modifyLiquidities{value: funding.nativeUsed}(abi.encode(actions, params), deadline);
        // The fixed token and pinned Permit2 consume finite approvals on transfer.
        // Require complete consumption. A cleanup approval would hide residual spending authority.
        _verifyAllowances(asset);
        if (
            asset.balanceOf(address(this)) != engineBefore
                || asset.balanceOf(address(poolManager)) != poolBefore + funding.tokenUsed
                || address(poolManager).balance != nativeBefore + funding.nativeUsed
        ) revert SettlementMismatch();
        _verifyPosition(key, LockedPosition(positionTokenId, funding.liquidity));
    }

    function _verifyPosition(PoolKey memory key, LockedPosition memory position) private view returns (PoolId id) {
        (PoolKey memory actual, PositionInfo info) = positionManager.getPoolAndPositionInfo(position.tokenId);
        id = key.toId();
        if (
            positionManager.ownerOf(position.tokenId) != address(this)
                || positionManager.getApproved(position.tokenId) != address(0)
                || positionManager.getPositionLiquidity(position.tokenId) != position.liquidity
                || PoolId.unwrap(actual.toId()) != PoolId.unwrap(id) || info.poolId() != bytes25(PoolId.unwrap(id))
                || info.tickLower() != TICK_LOWER || info.tickUpper() != TICK_UPPER || info.hasSubscriber()
        ) revert SettlementMismatch();
    }

    function _verifyAllowances(IERC20 token) private view {
        (uint160 amount,,) = permit2.allowance(address(this), address(token), address(positionManager));
        if (amount != 0 || token.allowance(address(this), address(permit2)) != 0) revert SettlementMismatch();
    }

    function _verifyDeadline(uint256 deadline) private view {
        if (
            deadline < block.timestamp || deadline > type(uint48).max
                || deadline - block.timestamp > MAX_DEADLINE_WINDOW
        ) {
            revert InvalidDeadline();
        }
    }

    function _verifyDependencies() private view {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (
            !_matchesCode(address(poolManager), poolManagerRuntimeHash)
                || !_matchesCode(address(positionManager), positionManagerRuntimeHash)
                || !_matchesCode(address(permit2), permit2RuntimeHash)
                || !_matchesCode(address(initializationGuard), initializationGuardRuntimeHash)
        ) revert InvalidDependencies();
    }

    function _matchesCode(address target, bytes32 expected) private view returns (bool) {
        return target.code.length != 0 && target.codehash == expected;
    }
}
