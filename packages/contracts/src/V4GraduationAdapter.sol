// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IV6GraduationAdapter} from "./interfaces/IV6GraduationAdapter.sol";
import {DirectLaunchFeeSplitter} from "./DirectLaunchFeeSplitter.sol";
import {V4GraduationHook} from "./V4GraduationHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface IERC20GraduationToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract V4GraduationAdapter is IV6GraduationAdapter, IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using SafeCast for uint256;

    uint256 private constant Q192 = 1 << 192;
    uint256 private constant BPS_TO_V4_FEE = 100;
    uint8 private constant ACTION_SEED = 1;
    uint8 private constant ACTION_COLLECT = 2;

    IPoolManager public immutable poolManager;
    V4GraduationHook public immutable hook;
    address public immutable deployer;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;

    address public factory;
    mapping(address token => PoolId poolId) public poolIds;
    mapping(address token => address market) public markets;
    mapping(address token => bool graduated) public isGraduated;
    mapping(address token => address feeSplitter) public feeSplitters;
    mapping(address token => uint16 feeBps) public postGraduationFeeBps;
    mapping(address token => uint128 liquidity) public lockedLiquidity;
    bool private _entered;

    event FactoryBound(address indexed factory);
    event MarketBound(address indexed token, address indexed market, PoolId indexed poolId);
    event PoolPrepared(address indexed token, PoolId indexed poolId);
    event LiquiditySeeded(
        address indexed token, PoolId indexed poolId, uint256 nativeAmount, uint256 tokenAmount, uint128 liquidity
    );
    event FeeRoutingConfigured(
        address indexed token, address indexed feeSplitter, uint16 postGraduationFeeBps
    );
    event GraduationFeesCollected(
        address indexed token, address indexed feeSplitter, uint256 nativeAmount, uint256 tokenAmount
    );

    error OnlyDeployer();
    error OnlyFactory();
    error OnlyPoolManager();
    error FactoryAlreadyBound();
    error InvalidConfiguration();
    error PoolAlreadyPrepared();
    error PoolNotPrepared();
    error MarketAlreadyBound();
    error OnlyBoundMarket();
    error AlreadyGraduated();
    error TokenTransferFailed();
    error InvalidSettlement();
    error ZeroLiquidity();
    error FeeRoutingAlreadyConfigured();
    error FeeRoutingNotConfigured();
    error ReentrantCall();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(IPoolManager poolManager_, V4GraduationHook hook_, uint24 poolFee_, int24 tickSpacing_) {
        if (address(poolManager_) == address(0) || address(hook_) == address(0)) revert InvalidConfiguration();
        if (address(hook_.poolManager()) != address(poolManager_)) revert InvalidConfiguration();
        if (poolFee_ >= 1_000_000 || tickSpacing_ <= 0) revert InvalidConfiguration();

        poolManager = poolManager_;
        hook = hook_;
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
        deployer = msg.sender;
    }

    receive() external payable {}

    function bindFactory(address factory_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (factory != address(0)) revert FactoryAlreadyBound();
        if (factory_ == address(0)) revert InvalidConfiguration();
        factory = factory_;
        emit FactoryBound(factory_);
    }

    function prepare(address token) external onlyFactory returns (bytes32 poolIdValue) {
        if (token == address(0)) revert InvalidConfiguration();
        if (PoolId.unwrap(poolIds[token]) != bytes32(0)) revert PoolAlreadyPrepared();

        PoolKey memory key = _poolKey(token);
        PoolId poolId = hook.reserve(key);
        poolIds[token] = poolId;
        poolIdValue = PoolId.unwrap(poolId);
        emit PoolPrepared(token, poolId);
    }

    function bindMarket(address token, address market) external onlyFactory {
        PoolId poolId = poolIds[token];
        if (PoolId.unwrap(poolId) == bytes32(0)) revert PoolNotPrepared();
        if (market == address(0)) revert InvalidConfiguration();
        if (markets[token] != address(0)) revert MarketAlreadyBound();
        markets[token] = market;
        emit MarketBound(token, market, poolId);
    }

    function configureFeeRouting(address token, address feeSplitter, uint16 feeBps) external onlyFactory {
        if (PoolId.unwrap(poolIds[token]) == bytes32(0)) revert PoolNotPrepared();
        if (markets[token] != address(0)) revert MarketAlreadyBound();
        if (feeSplitters[token] != address(0)) revert FeeRoutingAlreadyConfigured();
        if (
            feeSplitter == address(0) || feeSplitter.code.length == 0 || feeBps == 0
                || uint256(feeBps) * BPS_TO_V4_FEE != poolFee
        ) revert InvalidConfiguration();

        feeSplitters[token] = feeSplitter;
        postGraduationFeeBps[token] = feeBps;
        emit FeeRoutingConfigured(token, feeSplitter, feeBps);
    }

    function graduate(address token, uint256 tokenAmount)
        external payable nonReentrant returns (address pool, uint256 liquidity)
    {
        if (msg.sender != markets[token]) revert OnlyBoundMarket();
        if (isGraduated[token]) revert AlreadyGraduated();
        if (msg.value == 0 || tokenAmount == 0) revert InvalidConfiguration();

        PoolId poolId = poolIds[token];
        if (PoolId.unwrap(poolId) == bytes32(0)) revert PoolNotPrepared();
        isGraduated[token] = true;

        if (!IERC20GraduationToken(token).transferFrom(msg.sender, address(this), tokenAmount)) {
            revert TokenTransferFailed();
        }

        PoolKey memory key = _poolKey(token);
        uint160 sqrtPriceX96 = _sqrtPriceX96(msg.value, tokenAmount);
        poolManager.initialize(key, sqrtPriceX96);

        int24 tickLower = TickMath.minUsableTick(tickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(tickSpacing);
        uint128 liquidityAmount = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            msg.value,
            tokenAmount
        );
        if (liquidityAmount == 0) revert ZeroLiquidity();

        poolManager.unlock(abi.encode(ACTION_SEED, key, tickLower, tickUpper, liquidityAmount));

        if (address(this).balance != 0 || IERC20GraduationToken(token).balanceOf(address(this)) != 0) {
            revert InvalidSettlement();
        }

        hook.open(key);
        lockedLiquidity[token] = liquidityAmount;
        emit LiquiditySeeded(token, poolId, msg.value, tokenAmount, liquidityAmount);
        return (address(poolManager), liquidityAmount);
    }

    /// @notice Permissionlessly realizes fees earned by the permanently locked full-range position.
    /// @dev Uses a zero-liquidity-delta poke; there is no code path that can decrease liquidity principal.
    function collectFees(address token)
        external nonReentrant returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        if (!isGraduated[token]) revert PoolNotPrepared();
        address feeSplitter = feeSplitters[token];
        if (feeSplitter == address(0)) revert FeeRoutingNotConfigured();

        uint256 nativeBalanceBefore = address(this).balance;
        uint256 tokenBalanceBefore = IERC20GraduationToken(token).balanceOf(address(this));
        PoolKey memory key = _poolKey(token);
        int24 tickLower = TickMath.minUsableTick(tickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(tickSpacing);
        bytes memory result = poolManager.unlock(abi.encode(ACTION_COLLECT, key, tickLower, tickUpper));
        (nativeAmount, tokenAmount) = abi.decode(result, (uint256, uint256));

        if (nativeAmount != 0) DirectLaunchFeeSplitter(payable(feeSplitter)).deposit{value: nativeAmount}();
        if (tokenAmount != 0) {
            if (!IERC20GraduationToken(token).transfer(feeSplitter, tokenAmount)) revert TokenTransferFailed();
            DirectLaunchFeeSplitter(payable(feeSplitter)).depositToken(token, tokenAmount);
        }
        if (
            address(this).balance != nativeBalanceBefore
                || IERC20GraduationToken(token).balanceOf(address(this)) != tokenBalanceBefore
        ) {
            revert InvalidSettlement();
        }

        emit GraduationFeesCollected(token, feeSplitter, nativeAmount, tokenAmount);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        uint8 action = abi.decode(data, (uint8));
        if (action == ACTION_COLLECT) return _collectCallback(data);
        if (action != ACTION_SEED) revert InvalidConfiguration();

        (, PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            abi.decode(data, (uint8, PoolKey, int24, int24, uint128));

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)
        });
        (BalanceDelta delta,) = poolManager.modifyLiquidity(key, params, "");
        _settleDebt(key.currency0, delta.amount0());
        _settleDebt(key.currency1, delta.amount1());

        uint256 nativeRemainder = address(this).balance;
        uint256 tokenRemainder = key.currency1.balanceOfSelf();
        if (nativeRemainder != 0 || tokenRemainder != 0) {
            BalanceDelta donation = poolManager.donate(key, nativeRemainder, tokenRemainder, "");
            _settleDebt(key.currency0, donation.amount0());
            _settleDebt(key.currency1, donation.amount1());
        }

        return abi.encode(liquidity);
    }

    function _collectCallback(bytes calldata data) private returns (bytes memory) {
        (, PoolKey memory key, int24 tickLower, int24 tickUpper) =
            abi.decode(data, (uint8, PoolKey, int24, int24));
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: bytes32(0)
        });
        (BalanceDelta delta,) = poolManager.modifyLiquidity(key, params, "");
        int128 amount0Delta = delta.amount0();
        int128 amount1Delta = delta.amount1();
        if (amount0Delta < 0 || amount1Delta < 0) revert InvalidSettlement();

        uint256 nativeAmount = uint256(uint128(amount0Delta));
        uint256 tokenAmount = uint256(uint128(amount1Delta));
        if (nativeAmount != 0) poolManager.take(key.currency0, address(this), nativeAmount);
        if (tokenAmount != 0) poolManager.take(key.currency1, address(this), tokenAmount);
        return abi.encode(nativeAmount, tokenAmount);
    }

    function _poolKey(address token) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(hook))
        });
    }

    function _settleDebt(Currency currency, int128 delta) private {
        if (delta > 0) revert InvalidSettlement();
        if (delta == 0) return;
        uint256 amount = uint256(-int256(delta));
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            if (!IERC20GraduationToken(Currency.unwrap(currency)).transfer(address(poolManager), amount)) {
                revert TokenTransferFailed();
            }
            poolManager.settle();
        }
    }

    function _sqrtPriceX96(uint256 nativeAmount, uint256 tokenAmount) private pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(tokenAmount, Q192, nativeAmount);
        uint256 result = _sqrt(ratioX192);
        if (result <= TickMath.MIN_SQRT_PRICE || result >= TickMath.MAX_SQRT_PRICE) revert InvalidConfiguration();
        return result.toUint160();
    }

    function _sqrt(uint256 value) private pure returns (uint256 result) {
        if (value == 0) return 0;
        result = 2 ** (_log2(value) >> 1);
        unchecked {
            for (uint256 i; i < 7; ++i) {
                result = (result + value / result) >> 1;
            }
            uint256 roundedDown = value / result;
            if (roundedDown < result) result = roundedDown;
        }
    }

    function _log2(uint256 value) private pure returns (uint256 result) {
        if (value >> 128 > 0) {
            value >>= 128;
            result += 128;
        }
        if (value >> 64 > 0) {
            value >>= 64;
            result += 64;
        }
        if (value >> 32 > 0) {
            value >>= 32;
            result += 32;
        }
        if (value >> 16 > 0) {
            value >>= 16;
            result += 16;
        }
        if (value >> 8 > 0) {
            value >>= 8;
            result += 8;
        }
        if (value >> 4 > 0) {
            value >>= 4;
            result += 4;
        }
        if (value >> 2 > 0) {
            value >>= 2;
            result += 2;
        }
        if (value >> 1 > 0) result += 1;
    }
}
