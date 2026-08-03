// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

interface IRMTPositionGuardERC20 {
    function balanceOf(address account) external view returns (uint256);
}

interface IRMTPositionGuardV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IRMTPositionGuardV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
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

/// @notice A narrow execution boundary for user-authorized Position Guard exits.
/// @dev The caller is always the wallet being protected. The contract can only exchange a caller-approved token for
///      immutable WETH through an immutable V3 router and always sends the output back to that same caller. There is no
///      owner, arbitrary call, arbitrary recipient, native-currency receiver, fee path, or rescue function.
contract RMTPositionGuardExecutor {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_SLIPPAGE_BPS = 500;
    uint256 public constant MAX_DEADLINE_WINDOW = 10 minutes;
    uint256 private constant Q128 = 1 << 128;
    uint256 private constant Q192 = 1 << 192;

    address public immutable factory;
    address public immutable router;
    address public immutable weth;

    mapping(address wallet => mapping(bytes32 orderId => bool consumed)) public orderConsumed;
    bool private _entered;

    struct Exit {
        address token;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint16 maxSlippageBps;
        uint256 deadline;
        bytes32 orderId;
    }

    event ProtectedExitExecuted(
        address indexed wallet,
        bytes32 indexed orderId,
        address indexed token,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    );

    error InvalidConfiguration();
    error InvalidExit();
    error InvalidPool();
    error UnsafeMinimumOutput(uint256 supplied, uint256 required);
    error OrderAlreadyConsumed();
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

    /// @notice Executes one bounded V3 token-to-WETH exit for the calling wallet.
    /// @dev A Privy signer may submit this transaction as the wallet only after the user grants a policy-scoped signer.
    ///      A direct wallet transaction works identically. The wallet must separately approve no more than the amount it
    ///      is prepared to protect; an unused or revoked allowance cannot be bypassed here.
    // slither-disable-start reentrancy-balance
    // The nonReentrant modifier is entered before every external token/router call. The balance snapshot is an
    // intentional invariant that rejects fee-on-transfer, rebasing, or otherwise unsupported token behavior.
    function executeV3Exit(Exit calldata exit) external nonReentrant returns (uint256 amountOut) {
        if (
            exit.token == address(0) || exit.token == weth || exit.token.code.length == 0 || exit.amountIn == 0
                || exit.amountOutMinimum == 0 || exit.orderId == bytes32(0) || exit.maxSlippageBps == 0
                || exit.maxSlippageBps > MAX_SLIPPAGE_BPS || exit.deadline < block.timestamp
                || exit.deadline > block.timestamp + MAX_DEADLINE_WINDOW
        ) revert InvalidExit();
        if (orderConsumed[msg.sender][exit.orderId]) revert OrderAlreadyConsumed();

        address pool = IRMTPositionGuardV3Factory(factory).getPool(exit.token, weth, exit.fee);
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool();
        address token0 = IRMTPositionGuardV3Pool(pool).token0();
        address token1 = IRMTPositionGuardV3Pool(pool).token1();
        if (!((token0 == exit.token && token1 == weth) || (token0 == weth && token1 == exit.token))) {
            revert InvalidPool();
        }
        (uint160 sqrtPriceX96,,,,,, bool unlocked) = IRMTPositionGuardV3Pool(pool).slot0();
        if (!unlocked || sqrtPriceX96 == 0) revert InvalidPool();

        uint256 spotOutput = _quoteAtSqrtPrice(sqrtPriceX96, exit.amountIn, token0 == exit.token);
        uint256 requiredMinimum = FullMath.mulDiv(spotOutput, BPS_DENOMINATOR - exit.maxSlippageBps, BPS_DENOMINATOR);
        if (requiredMinimum == 0 || exit.amountOutMinimum < requiredMinimum) {
            revert UnsafeMinimumOutput(exit.amountOutMinimum, requiredMinimum);
        }

        orderConsumed[msg.sender][exit.orderId] = true;
        uint256 balanceBefore = IRMTPositionGuardERC20(exit.token).balanceOf(address(this));
        _safeTransferFrom(exit.token, msg.sender, address(this), exit.amountIn);
        if (IRMTPositionGuardERC20(exit.token).balanceOf(address(this)) != balanceBefore + exit.amountIn) {
            revert UnsupportedTransferBehavior();
        }
        _forceApprove(exit.token, router, exit.amountIn);

        amountOut = IRMTPositionGuardSwapRouter02(router)
            .exactInputSingle(
                IRMTPositionGuardSwapRouter02.ExactInputSingleParams({
                tokenIn: exit.token,
                tokenOut: weth,
                fee: exit.fee,
                recipient: msg.sender,
                amountIn: exit.amountIn,
                amountOutMinimum: exit.amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
            );
        _forceApprove(exit.token, router, 0);
        if (amountOut < exit.amountOutMinimum) revert UnsafeMinimumOutput(amountOut, exit.amountOutMinimum);
        if (IRMTPositionGuardERC20(exit.token).balanceOf(address(this)) != balanceBefore) {
            revert UnsupportedTransferBehavior();
        }

        emit ProtectedExitExecuted(msg.sender, exit.orderId, exit.token, exit.fee, exit.amountIn, amountOut);
    }
    // slither-disable-end reentrancy-balance

    function _quoteAtSqrtPrice(uint160 sqrtPriceX96, uint256 amountIn, bool tokenInIsToken0)
        private
        pure
        returns (uint256 amountOut)
    {
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            return
                tokenInIsToken0
                    ? FullMath.mulDiv(ratioX192, amountIn, Q192)
                    : FullMath.mulDiv(Q192, amountIn, ratioX192);
        }
        uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
        return tokenInIsToken0 ? FullMath.mulDiv(ratioX128, amountIn, Q128) : FullMath.mulDiv(Q128, amountIn, ratioX128);
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
