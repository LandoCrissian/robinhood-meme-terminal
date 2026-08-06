// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IRMTPositionGuardERC20 {
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

interface IRMTPositionGuardV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IRMTPositionGuardV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

interface IRMTPositionGuardSwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Ownerless, user-committed execution boundary for Position Guard V3 exits.
/// @dev A wallet must first register an exact token, pool, amount, protection plan, TWAP window and expiry. A delegated
///      signer can checkpoint or execute only that registered order. The contract derives the trigger and minimum output
///      from Uniswap V3 TWAP observations, always pays immutable WETH back to the same wallet, and exposes no owner,
///      arbitrary call, arbitrary recipient, custody account, native-currency receiver, fee path or rescue function.
contract RMTPositionGuardExecutor {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant UNIT_QUOTE_SCALE = 1e18;
    uint256 private constant Q128 = 1 << 128;
    uint256 private constant Q192 = 1 << 192;

    uint16 public constant MAX_SLIPPAGE_BPS = 500;
    uint16 public constant MIN_STOP_BPS = 500;
    uint16 public constant MAX_STOP_BPS = 5_000;
    uint16 public constant MIN_BREAK_EVEN_ACTIVATION_BPS = 1_000;
    uint16 public constant MAX_BREAK_EVEN_ACTIVATION_BPS = 10_000;
    uint32 public constant MIN_TWAP_SECONDS = 60;
    uint32 public constant MAX_TWAP_SECONDS = 30 minutes;
    uint256 public constant MIN_ORDER_DURATION = 5 minutes;
    uint256 public constant MAX_ORDER_DURATION = 7 days;
    uint256 public constant MIN_CONFIRMATION_WINDOW = 3 seconds;
    uint256 public constant MAX_CONFIRMATION_WINDOW = 60 seconds;
    uint256 public constant MAX_DEADLINE_WINDOW = 10 minutes;

    address public immutable factory;
    address public immutable router;
    address public immutable weth;

    enum OrderStatus {
        None,
        Active,
        Cancelled,
        Executed,
        Expired
    }

    enum TriggerState {
        Healthy,
        Confirming,
        Triggered,
        Expired
    }

    struct RegisterV3Order {
        address token;
        uint24 fee;
        uint128 amountIn;
        uint16 stopLossBps;
        uint16 trailingStopBps;
        uint16 breakEvenActivationBps;
        uint16 maxSlippageBps;
        uint32 twapSeconds;
        uint64 expiresAt;
        bytes32 orderId;
    }

    struct ExecuteV3Exit {
        bytes32 orderId;
        uint256 amountOutMinimum;
        uint256 deadline;
    }

    struct V3Order {
        address token;
        address pool;
        uint128 amountIn;
        uint256 entryUnitQuoteX18;
        uint256 highWatermarkUnitQuoteX18;
        uint64 expiresAt;
        uint64 firstBelowFloorAt;
        uint64 firstBelowFloorBlock;
        uint32 twapSeconds;
        uint24 fee;
        uint16 stopLossBps;
        uint16 trailingStopBps;
        uint16 breakEvenActivationBps;
        uint16 maxSlippageBps;
        OrderStatus status;
    }

    struct V3OrderPreview {
        TriggerState state;
        uint256 twapAmountOut;
        uint256 currentUnitQuoteX18;
        uint256 effectiveFloorUnitQuoteX18;
        uint256 highWatermarkUnitQuoteX18;
        uint64 firstBelowFloorAt;
        uint64 firstBelowFloorBlock;
    }

    mapping(address wallet => mapping(bytes32 orderId => V3Order order)) private _orders;
    mapping(address wallet => mapping(bytes32 orderId => bool consumed)) public orderConsumed;
    bool private _entered;

    event V3OrderRegistered(
        address indexed wallet,
        bytes32 indexed orderId,
        address indexed token,
        address pool,
        uint24 fee,
        uint256 amountIn,
        uint256 entryUnitQuoteX18,
        uint256 expiresAt
    );
    event V3OrderCheckpointed(
        address indexed wallet,
        bytes32 indexed orderId,
        TriggerState state,
        uint256 currentUnitQuoteX18,
        uint256 effectiveFloorUnitQuoteX18,
        uint256 highWatermarkUnitQuoteX18,
        uint256 firstBelowFloorAt,
        uint256 firstBelowFloorBlock
    );
    event V3OrderCancelled(address indexed wallet, bytes32 indexed orderId);
    event V3OrderExpired(address indexed wallet, bytes32 indexed orderId);
    event ProtectedExitExecuted(
        address indexed wallet,
        bytes32 indexed orderId,
        address indexed token,
        address pool,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    );

    error InvalidConfiguration();
    error InvalidOrder();
    error InvalidExit();
    error InvalidPool();
    error OrderAlreadyExists();
    error OrderNotActive();
    error OrderNotExpired();
    error OrderNotTriggered();
    error ConfirmationRequired();
    error ExactAllowanceRequired(uint256 currentAllowance, uint256 requiredAllowance);
    error InsufficientBalance(uint256 currentBalance, uint256 requiredBalance);
    error UnsafeMinimumOutput(uint256 supplied, uint256 required);
    error TokenTransferFailed();
    error UnsupportedTransferBehavior();
    error ReentrantCall();

    constructor(address factory_, address router_, address weth_) {
        if (
            factory_ == address(0) || router_ == address(0) || weth_ == address(0) || factory_.code.length == 0
                || router_.code.length == 0 || weth_.code.length == 0
        ) revert InvalidConfiguration();
        factory = factory_;
        router = router_;
        weth = weth_;
    }

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Registers the exact order a delegated signer may later checkpoint and execute.
    /// @dev Registration must be a user-reviewed wallet action. The allowance must equal the protected amount exactly.
    function registerV3Order(RegisterV3Order calldata request) external nonReentrant {
        _validateRegistration(request);
        if (_orders[msg.sender][request.orderId].status != OrderStatus.None) revert OrderAlreadyExists();

        (address pool, bool tokenInIsToken0) = _verifiedPool(request.token, request.fee);
        _requireExactAuthority(request.token, msg.sender, request.amountIn);
        uint256 entryAmountOut = _twapAmountOut(pool, request.amountIn, request.twapSeconds, tokenInIsToken0);
        uint256 entryUnitQuoteX18 = FullMath.mulDiv(entryAmountOut, UNIT_QUOTE_SCALE, request.amountIn);
        if (entryAmountOut == 0 || entryUnitQuoteX18 == 0) revert InvalidOrder();

        _orders[msg.sender][request.orderId] = V3Order({
            token: request.token,
            pool: pool,
            amountIn: request.amountIn,
            entryUnitQuoteX18: entryUnitQuoteX18,
            highWatermarkUnitQuoteX18: entryUnitQuoteX18,
            expiresAt: request.expiresAt,
            firstBelowFloorAt: 0,
            firstBelowFloorBlock: 0,
            twapSeconds: request.twapSeconds,
            fee: request.fee,
            stopLossBps: request.stopLossBps,
            trailingStopBps: request.trailingStopBps,
            breakEvenActivationBps: request.breakEvenActivationBps,
            maxSlippageBps: request.maxSlippageBps,
            status: OrderStatus.Active
        });

        emit V3OrderRegistered(
            msg.sender,
            request.orderId,
            request.token,
            pool,
            request.fee,
            request.amountIn,
            entryUnitQuoteX18,
            request.expiresAt
        );
    }

    /// @notice Advances the contract-enforced high watermark and trigger-confirmation state.
    /// @dev Anyone may checkpoint because price and state transitions are derived entirely onchain and can only tighten
    ///      protection or clear a recovered trigger. Checkpointing cannot move funds, change an order or redirect output.
    function checkpointV3Order(address wallet, bytes32 orderId)
        external
        returns (V3OrderPreview memory preview)
    {
        V3Order storage order = _orders[wallet][orderId];
        if (order.status != OrderStatus.Active) revert OrderNotActive();
        if (block.timestamp > order.expiresAt) {
            order.status = OrderStatus.Expired;
            emit V3OrderExpired(wallet, orderId);
            return V3OrderPreview({
                state: TriggerState.Expired,
                twapAmountOut: 0,
                currentUnitQuoteX18: 0,
                effectiveFloorUnitQuoteX18: 0,
                highWatermarkUnitQuoteX18: order.highWatermarkUnitQuoteX18,
                firstBelowFloorAt: order.firstBelowFloorAt,
                firstBelowFloorBlock: order.firstBelowFloorBlock
            });
        }

        preview = _previewActiveOrder(order);
        if (preview.currentUnitQuoteX18 > order.highWatermarkUnitQuoteX18) {
            order.highWatermarkUnitQuoteX18 = preview.currentUnitQuoteX18;
        }

        if (preview.state == TriggerState.Healthy) {
            order.firstBelowFloorAt = 0;
            order.firstBelowFloorBlock = 0;
        } else if (
            order.firstBelowFloorAt == 0
                || block.timestamp > uint256(order.firstBelowFloorAt) + MAX_CONFIRMATION_WINDOW
        ) {
            order.firstBelowFloorAt = uint64(block.timestamp);
            order.firstBelowFloorBlock = uint64(block.number);
            preview.state = TriggerState.Confirming;
        }

        preview.highWatermarkUnitQuoteX18 = order.highWatermarkUnitQuoteX18;
        preview.effectiveFloorUnitQuoteX18 = _effectiveFloor(order, order.highWatermarkUnitQuoteX18);
        preview.firstBelowFloorAt = order.firstBelowFloorAt;
        preview.firstBelowFloorBlock = order.firstBelowFloorBlock;

        emit V3OrderCheckpointed(
            wallet,
            orderId,
            preview.state,
            preview.currentUnitQuoteX18,
            preview.effectiveFloorUnitQuoteX18,
            preview.highWatermarkUnitQuoteX18,
            preview.firstBelowFloorAt,
            preview.firstBelowFloorBlock
        );
    }

    /// @notice Executes the exact registered order after an onchain TWAP checkpoint confirms the protected floor.
    /// @dev The caller must be the registered wallet. A policy-scoped signer may submit as that wallet, but cannot change
    ///      the token, pool, amount, expiry, trigger settings, TWAP window, recipient or maximum slippage.
    // slither-disable-start reentrancy-balance
    function executeV3Exit(ExecuteV3Exit calldata request) external nonReentrant returns (uint256 amountOut) {
        V3Order storage order = _orders[msg.sender][request.orderId];
        if (order.status != OrderStatus.Active) revert OrderNotActive();
        if (
            request.orderId == bytes32(0) || request.amountOutMinimum == 0 || request.deadline < block.timestamp
                || request.deadline > block.timestamp + MAX_DEADLINE_WINDOW || block.timestamp > order.expiresAt
        ) revert InvalidExit();

        _revalidateStoredPool(order);
        _requireExactAuthority(order.token, msg.sender, order.amountIn);
        V3OrderPreview memory preview = _previewActiveOrder(order);
        if (preview.state == TriggerState.Healthy) revert OrderNotTriggered();
        if (preview.state != TriggerState.Triggered) revert ConfirmationRequired();

        uint256 requiredMinimum =
            FullMath.mulDiv(preview.twapAmountOut, BPS_DENOMINATOR - order.maxSlippageBps, BPS_DENOMINATOR);
        if (requiredMinimum == 0 || request.amountOutMinimum < requiredMinimum) {
            revert UnsafeMinimumOutput(request.amountOutMinimum, requiredMinimum);
        }

        order.status = OrderStatus.Executed;
        orderConsumed[msg.sender][request.orderId] = true;
        uint256 balanceBefore = IRMTPositionGuardERC20(order.token).balanceOf(address(this));
        _safeTransferFrom(order.token, msg.sender, address(this), order.amountIn);
        if (IRMTPositionGuardERC20(order.token).balanceOf(address(this)) != balanceBefore + order.amountIn) {
            revert UnsupportedTransferBehavior();
        }
        _forceApprove(order.token, router, order.amountIn);

        amountOut = IRMTPositionGuardSwapRouter02(router).exactInputSingle(
            IRMTPositionGuardSwapRouter02.ExactInputSingleParams({
                tokenIn: order.token,
                tokenOut: weth,
                fee: order.fee,
                recipient: msg.sender,
                amountIn: order.amountIn,
                amountOutMinimum: request.amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );
        _forceApprove(order.token, router, 0);
        if (amountOut < request.amountOutMinimum) revert UnsafeMinimumOutput(amountOut, request.amountOutMinimum);
        if (IRMTPositionGuardERC20(order.token).balanceOf(address(this)) != balanceBefore) {
            revert UnsupportedTransferBehavior();
        }

        emit ProtectedExitExecuted(
            msg.sender,
            request.orderId,
            order.token,
            order.pool,
            order.fee,
            order.amountIn,
            amountOut
        );
    }
    // slither-disable-end reentrancy-balance

    /// @notice Cancels an active order onchain before wallet allowance or delegated signer cleanup.
    function cancelV3Order(bytes32 orderId) external {
        V3Order storage order = _orders[msg.sender][orderId];
        if (order.status != OrderStatus.Active) revert OrderNotActive();
        order.status = OrderStatus.Cancelled;
        order.firstBelowFloorAt = 0;
        order.firstBelowFloorBlock = 0;
        emit V3OrderCancelled(msg.sender, orderId);
    }

    /// @notice Marks an elapsed order expired without granting the caller any wallet authority.
    function expireV3Order(address wallet, bytes32 orderId) external {
        V3Order storage order = _orders[wallet][orderId];
        if (order.status != OrderStatus.Active) revert OrderNotActive();
        if (block.timestamp <= order.expiresAt) revert OrderNotExpired();
        order.status = OrderStatus.Expired;
        emit V3OrderExpired(wallet, orderId);
    }

    function getV3Order(address wallet, bytes32 orderId) external view returns (V3Order memory) {
        return _orders[wallet][orderId];
    }

    function previewV3Order(address wallet, bytes32 orderId) external view returns (V3OrderPreview memory) {
        V3Order storage order = _orders[wallet][orderId];
        if (order.status != OrderStatus.Active) revert OrderNotActive();
        if (block.timestamp > order.expiresAt) {
            return V3OrderPreview({
                state: TriggerState.Expired,
                twapAmountOut: 0,
                currentUnitQuoteX18: 0,
                effectiveFloorUnitQuoteX18: 0,
                highWatermarkUnitQuoteX18: order.highWatermarkUnitQuoteX18,
                firstBelowFloorAt: order.firstBelowFloorAt,
                firstBelowFloorBlock: order.firstBelowFloorBlock
            });
        }
        return _previewActiveOrder(order);
    }

    function _validateRegistration(RegisterV3Order calldata request) private view {
        if (
            request.token == address(0) || request.token == weth || request.token.code.length == 0
                || request.amountIn == 0 || request.orderId == bytes32(0)
                || request.stopLossBps < MIN_STOP_BPS || request.stopLossBps > MAX_STOP_BPS
                || request.trailingStopBps < MIN_STOP_BPS || request.trailingStopBps > MAX_STOP_BPS
                || request.breakEvenActivationBps < MIN_BREAK_EVEN_ACTIVATION_BPS
                || request.breakEvenActivationBps > MAX_BREAK_EVEN_ACTIVATION_BPS
                || request.maxSlippageBps == 0 || request.maxSlippageBps > MAX_SLIPPAGE_BPS
                || request.twapSeconds < MIN_TWAP_SECONDS || request.twapSeconds > MAX_TWAP_SECONDS
                || request.expiresAt < block.timestamp + MIN_ORDER_DURATION
                || request.expiresAt > block.timestamp + MAX_ORDER_DURATION
        ) revert InvalidOrder();
    }

    function _verifiedPool(address token, uint24 fee) private view returns (address pool, bool tokenInIsToken0) {
        pool = IRMTPositionGuardV3Factory(factory).getPool(token, weth, fee);
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool();
        address token0 = IRMTPositionGuardV3Pool(pool).token0();
        address token1 = IRMTPositionGuardV3Pool(pool).token1();
        if (token0 == token && token1 == weth) return (pool, true);
        if (token0 == weth && token1 == token) return (pool, false);
        revert InvalidPool();
    }

    function _revalidateStoredPool(V3Order storage order) private view {
        (address currentPool,) = _verifiedPool(order.token, order.fee);
        if (currentPool != order.pool) revert InvalidPool();
    }

    function _requireExactAuthority(address token, address wallet, uint256 amountIn) private view {
        uint256 allowance = IRMTPositionGuardERC20(token).allowance(wallet, address(this));
        if (allowance != amountIn) revert ExactAllowanceRequired(allowance, amountIn);
        uint256 balance = IRMTPositionGuardERC20(token).balanceOf(wallet);
        if (balance < amountIn) revert InsufficientBalance(balance, amountIn);
    }

    function _previewActiveOrder(V3Order storage order) private view returns (V3OrderPreview memory preview) {
        bool tokenInIsToken0 = IRMTPositionGuardV3Pool(order.pool).token0() == order.token;
        uint256 amountOut = _twapAmountOut(order.pool, order.amountIn, order.twapSeconds, tokenInIsToken0);
        uint256 currentUnitQuoteX18 = FullMath.mulDiv(amountOut, UNIT_QUOTE_SCALE, order.amountIn);
        if (amountOut == 0 || currentUnitQuoteX18 == 0) revert InvalidPool();

        uint256 highWatermark = currentUnitQuoteX18 > order.highWatermarkUnitQuoteX18
            ? currentUnitQuoteX18
            : order.highWatermarkUnitQuoteX18;
        uint256 floor = _effectiveFloor(order, highWatermark);
        TriggerState state;
        if (currentUnitQuoteX18 > floor) {
            state = TriggerState.Healthy;
        } else if (
            order.firstBelowFloorAt != 0 && block.number > order.firstBelowFloorBlock
                && block.timestamp >= uint256(order.firstBelowFloorAt) + MIN_CONFIRMATION_WINDOW
                && block.timestamp <= uint256(order.firstBelowFloorAt) + MAX_CONFIRMATION_WINDOW
        ) {
            state = TriggerState.Triggered;
        } else {
            state = TriggerState.Confirming;
        }

        preview = V3OrderPreview({
            state: state,
            twapAmountOut: amountOut,
            currentUnitQuoteX18: currentUnitQuoteX18,
            effectiveFloorUnitQuoteX18: floor,
            highWatermarkUnitQuoteX18: highWatermark,
            firstBelowFloorAt: order.firstBelowFloorAt,
            firstBelowFloorBlock: order.firstBelowFloorBlock
        });
    }

    function _effectiveFloor(V3Order storage order, uint256 highWatermark)
        private
        view
        returns (uint256 floor)
    {
        uint256 staticFloor =
            FullMath.mulDiv(order.entryUnitQuoteX18, BPS_DENOMINATOR - order.stopLossBps, BPS_DENOMINATOR);
        uint256 trailingFloor =
            FullMath.mulDiv(highWatermark, BPS_DENOMINATOR - order.trailingStopBps, BPS_DENOMINATOR);
        uint256 breakEvenFloor = highWatermark * BPS_DENOMINATOR
                >= order.entryUnitQuoteX18 * (BPS_DENOMINATOR + order.breakEvenActivationBps)
            ? order.entryUnitQuoteX18
            : 0;
        floor = staticFloor > trailingFloor ? staticFloor : trailingFloor;
        if (breakEvenFloor > floor) floor = breakEvenFloor;
    }

    function _twapAmountOut(address pool, uint256 amountIn, uint32 twapSeconds, bool tokenInIsToken0)
        private
        view
        returns (uint256 amountOut)
    {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapSeconds;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = IRMTPositionGuardV3Pool(pool).observe(secondsAgos);
        if (tickCumulatives.length != 2) revert InvalidPool();
        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int56 divisor = int56(uint56(twapSeconds));
        int24 arithmeticMeanTick = int24(tickDelta / divisor);
        if (tickDelta < 0 && tickDelta % divisor != 0) arithmeticMeanTick--;
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(arithmeticMeanTick);
        amountOut = _quoteAtSqrtPrice(sqrtPriceX96, amountIn, tokenInIsToken0);
    }

    function _quoteAtSqrtPrice(uint160 sqrtPriceX96, uint256 amountIn, bool tokenInIsToken0)
        private
        pure
        returns (uint256 amountOut)
    {
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            return tokenInIsToken0
                ? FullMath.mulDiv(ratioX192, amountIn, Q192)
                : FullMath.mulDiv(Q192, amountIn, ratioX192);
        }
        uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
        return tokenInIsToken0
            ? FullMath.mulDiv(ratioX128, amountIn, Q128)
            : FullMath.mulDiv(Q128, amountIn, ratioX128);
    }

    function _safeTransferFrom(address token, address owner, address recipient, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), owner, recipient, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenTransferFailed();
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        if (_approve(token, spender, amount)) return;
        if (!_approve(token, spender, 0) || !_approve(token, spender, amount)) revert TokenTransferFailed();
    }

    function _approve(address token, address spender, uint256 amount) private returns (bool) {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(bytes4(keccak256("approve(address,uint256)")), spender, amount));
        return success && (data.length == 0 || abi.decode(data, (bool)));
    }
}
