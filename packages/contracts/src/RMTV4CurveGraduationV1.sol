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
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IRMTV4CurveGraduationV1} from "./interfaces/IRMTV4CurveGraduationV1.sol";
import {RMTV4CurveInitializationGuardV1} from "./RMTV4CurveInitializationGuardV1.sol";

interface ICurveGraduationFactoryV1 {
    function curveForToken(address token) external view returns (address);
}

interface ICurvePositionManagerV1 {
    function poolManager() external view returns (IPoolManager);
    function permit2() external view returns (address);
    function nextTokenId() external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface ICurvePermit2V1 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @notice Atomically funds a permanently held full-range v4 position from an eligible V1 curve.
/// @dev This contract is never proxied. No action can transfer, approve, decrease, burn or collect the position.
contract RMTV4CurveGraduationV1 is IRMTV4CurveGraduationV1, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

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

    error WrongChain();
    error InvalidDependencies();
    error UnauthorizedCurve();
    error AlreadyGraduated();
    error InvalidDeadline();
    error InvalidFunding();
    error SettlementMismatch();
    error DustReturnFailed();

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
        if (token.code.length == 0 || ICurveGraduationFactoryV1(factory).curveForToken(token) != msg.sender) {
            revert UnauthorizedCurve();
        }
        if (positions[token].liquidity != 0) revert AlreadyGraduated();
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert InvalidDeadline();
        if (msg.value != nativeReserve) revert InvalidFunding();
        Funding memory funding = previewFunding(nativeReserve, tokenReserve, priceNumerator, priceDenominator);
        PoolKey memory key = canonicalPoolKey(token);
        poolId = PoolId.unwrap(key.toId());
        positionTokenId = positionManager.nextTokenId();
        int24 tick = poolManager.initialize(key, funding.sqrtPriceX96);
        if (tick < TICK_LOWER || tick >= TICK_UPPER) revert SettlementMismatch();
        _fundPosition(token, key, positionTokenId, funding, deadline);
        positions[token] = LockedPosition(positionTokenId, funding.liquidity);

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

    function _fundPosition(
        address token,
        PoolKey memory key,
        uint256 positionTokenId,
        Funding memory funding,
        uint256 deadline
    ) private {
        IERC20 asset = IERC20(token);
        uint256 engineBefore = asset.balanceOf(address(this));
        uint256 poolBefore = asset.balanceOf(address(poolManager));
        uint256 nativeBefore = address(poolManager).balance;
        asset.safeTransferFrom(msg.sender, address(this), funding.tokenUsed);
        if (asset.balanceOf(address(this)) != engineBefore + funding.tokenUsed) revert SettlementMismatch();

        asset.forceApprove(address(permit2), funding.tokenUsed);
        permit2.approve(token, address(positionManager), funding.tokenUsed, deadline.toUint48());
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
        permit2.approve(token, address(positionManager), 0, 0);
        asset.forceApprove(address(permit2), 0);
        (PoolKey memory mintedKey,) = positionManager.getPoolAndPositionInfo(positionTokenId);
        if (
            asset.balanceOf(address(this)) != engineBefore
                || asset.balanceOf(address(poolManager)) != poolBefore + funding.tokenUsed
                || address(poolManager).balance != nativeBefore + funding.nativeUsed
                || positionManager.ownerOf(positionTokenId) != address(this)
                || positionManager.getPositionLiquidity(positionTokenId) != funding.liquidity
                || PoolId.unwrap(mintedKey.toId()) != PoolId.unwrap(key.toId())
        ) revert SettlementMismatch();
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
