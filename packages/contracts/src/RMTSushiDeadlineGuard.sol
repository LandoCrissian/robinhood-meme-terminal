// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRMTRedSnwapper {
    function snwap(
        IERC20 tokenIn,
        uint256 amountIn,
        address recipient,
        IERC20 tokenOut,
        uint256 amountOutMin,
        address executor,
        bytes calldata executorData
    ) external payable returns (uint256 amountOut);
}

/// @notice Deadline-bound, self-custodial execution boundary for one reviewed Sushi RedSnwapper release.
/// @dev The caller supplies one exact input, is always the output recipient, and receives output directly from
///      RedSnwapper. The guard has no owner, arbitrary call, arbitrary recipient, fee, upgrade, withdrawal, or sweep.
contract RMTSushiDeadlineGuard is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ROBINHOOD_CHAIN_ID = 4_663;
    uint256 public constant MAX_DEADLINE_WINDOW = 10 minutes;
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    address public immutable redSnwapper;
    address public immutable routeExecutor;
    bytes32 public immutable redSnwapperCodeHash;
    bytes32 public immutable routeExecutorCodeHash;
    bytes4 public immutable routeExecutorEntrypoint;

    mapping(address wallet => mapping(bytes32 orderId => bool consumed)) public orderConsumed;

    struct Swap {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint256 deadline;
        bytes32 orderId;
        bytes executorData;
    }

    event SushiSwapExecuted(
        address indexed wallet,
        bytes32 indexed orderId,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 deadline
    );

    error WrongChain(uint256 actualChainId);
    error InvalidConfiguration();
    error ConfigurationIntegrityFailed();
    error InvalidSwap();
    error OrderAlreadyConsumed();
    error UnsupportedTransferBehavior();
    error InsufficientOutput(uint256 received, uint256 minimum);

    constructor(
        address redSnwapper_,
        address routeExecutor_,
        bytes32 redSnwapperCodeHash_,
        bytes32 routeExecutorCodeHash_,
        bytes4 routeExecutorEntrypoint_
    ) {
        if (block.chainid != ROBINHOOD_CHAIN_ID) revert WrongChain(block.chainid);
        if (
            redSnwapper_ == address(0) || routeExecutor_ == address(0) || redSnwapper_ == routeExecutor_
                || redSnwapper_.code.length == 0 || routeExecutor_.code.length == 0
                || redSnwapperCodeHash_ == bytes32(0) || routeExecutorCodeHash_ == bytes32(0)
                || routeExecutorEntrypoint_ == bytes4(0) || redSnwapper_.codehash != redSnwapperCodeHash_
                || routeExecutor_.codehash != routeExecutorCodeHash_
        ) revert InvalidConfiguration();

        redSnwapper = redSnwapper_;
        routeExecutor = routeExecutor_;
        redSnwapperCodeHash = redSnwapperCodeHash_;
        routeExecutorCodeHash = routeExecutorCodeHash_;
        routeExecutorEntrypoint = routeExecutorEntrypoint_;
    }

    receive() external payable {
        revert InvalidSwap();
    }

    /// @notice Executes one exact, deadline-bound Sushi swap and sends output directly to the calling wallet.
    /// @dev ERC-20 callers approve this guard for no more than `amountIn`. Native swaps send exactly `amountIn` ETH.
    // slither-disable-start reentrancy-balance -- nonReentrant covers every token/router callback; the retained
    // balance comparisons deliberately reject fee-on-transfer and partial-spend behavior.
    function execute(Swap calldata swap) external payable nonReentrant returns (uint256 amountOut) {
        _requireConfigurationIntegrity();
        _validateSwap(swap);
        if (orderConsumed[msg.sender][swap.orderId]) revert OrderAlreadyConsumed();
        orderConsumed[msg.sender][swap.orderId] = true;

        if (swap.tokenIn == NATIVE_TOKEN) {
            if (msg.value != swap.amountIn) revert InvalidSwap();
            amountOut = IRMTRedSnwapper(redSnwapper).snwap{value: swap.amountIn}(
                IERC20(swap.tokenIn),
                swap.amountIn,
                msg.sender,
                IERC20(swap.tokenOut),
                swap.amountOutMinimum,
                routeExecutor,
                swap.executorData
            );
        } else {
            if (msg.value != 0) revert InvalidSwap();
            IERC20 input = IERC20(swap.tokenIn);
            uint256 balanceBefore = input.balanceOf(address(this));
            input.safeTransferFrom(msg.sender, address(this), swap.amountIn);
            if (input.balanceOf(address(this)) != balanceBefore + swap.amountIn) {
                revert UnsupportedTransferBehavior();
            }

            input.forceApprove(redSnwapper, swap.amountIn);
            amountOut = IRMTRedSnwapper(redSnwapper)
                .snwap(
                    input,
                    swap.amountIn,
                    msg.sender,
                    IERC20(swap.tokenOut),
                    swap.amountOutMinimum,
                    routeExecutor,
                    swap.executorData
                );
            input.forceApprove(redSnwapper, 0);

            if (input.balanceOf(address(this)) != balanceBefore || input.allowance(address(this), redSnwapper) != 0) {
                revert UnsupportedTransferBehavior();
            }
        }

        if (amountOut < swap.amountOutMinimum) revert InsufficientOutput(amountOut, swap.amountOutMinimum);
        _requireConfigurationIntegrity();
        emit SushiSwapExecuted(
            msg.sender, swap.orderId, swap.tokenIn, swap.tokenOut, swap.amountIn, amountOut, swap.deadline
        );
    }

    // slither-disable-end reentrancy-balance

    // slither-disable-start timestamp -- the bounded user deadline is the guard's core safety invariant.
    function _validateSwap(Swap calldata swap) private view {
        bool nativeInput = swap.tokenIn == NATIVE_TOKEN;
        bool nativeOutput = swap.tokenOut == NATIVE_TOKEN;
        if (
            swap.tokenIn == address(0) || swap.tokenOut == address(0) || swap.tokenIn == swap.tokenOut
                || nativeInput == nativeOutput || (!nativeInput && swap.tokenIn.code.length == 0)
                || (!nativeOutput && swap.tokenOut.code.length == 0) || swap.amountIn == 0 || swap.amountOutMinimum == 0
                || swap.orderId == bytes32(0) || swap.deadline < block.timestamp
                || swap.deadline > block.timestamp + MAX_DEADLINE_WINDOW || swap.executorData.length < 4
                || bytes4(swap.executorData[:4]) != routeExecutorEntrypoint
        ) revert InvalidSwap();
    }
    // slither-disable-end timestamp

    function _requireConfigurationIntegrity() private view {
        if (
            block.chainid != ROBINHOOD_CHAIN_ID || redSnwapper.codehash != redSnwapperCodeHash
                || routeExecutor.codehash != routeExecutorCodeHash
        ) revert ConfigurationIntegrityFailed();
    }
}
