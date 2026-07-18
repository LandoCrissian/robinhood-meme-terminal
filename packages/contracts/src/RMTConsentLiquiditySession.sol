// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISushiV3PositionManager} from "./interfaces/ISushiV3PositionManager.sol";

/// @notice Immutable, reusable accounting session for atomic consent-based Sushi V3 mints.
/// @dev Only its bound router can begin or execute a session. The router calls begin, transfers the
///      owner's tokens directly here, and calls execute in one non-reentrant transaction. Any failure
///      rolls back the snapshot, transfers, mint, refunds, and final router verification together.
contract RMTConsentLiquiditySession is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;

    struct SessionRequest {
        uint256 pairedTokenDesired;
        uint256 wethDesired;
        uint256 pairedTokenMinimum;
        uint256 wethMinimum;
        uint128 minimumLiquidity;
        int24 tickLower;
        int24 tickUpper;
        uint256 deadline;
    }

    struct BalanceSnapshot {
        address owner;
        uint256 pairedTokenSession;
        uint256 wethSession;
        uint256 pairedTokenOwner;
        uint256 wethOwner;
    }

    address public immutable router;
    IERC20 public immutable pairedToken;
    IERC20 public immutable weth;
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    ISushiV3PositionManager public immutable positionManager;
    uint24 public immutable poolFee;
    bool public immutable pairedTokenIsToken0;

    bytes32 public activeMigrationId;
    address public activeOwner;
    uint256 public pairedTokenSessionBalanceBefore;
    uint256 public wethSessionBalanceBefore;
    uint256 public pairedTokenOwnerBalanceBefore;
    uint256 public wethOwnerBalanceBefore;

    error Unauthorized();
    error InvalidState();
    error InvalidSession();
    error InexactTokenTransfer();
    error ApprovalNotCleared();
    error SlippageExceeded();
    error PositionVerificationFailed();
    error WrongChain(uint256 actualChainId);

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    constructor(
        address router_,
        IERC20 pairedToken_,
        IERC20 weth_,
        ISushiV3PositionManager positionManager_,
        uint24 poolFee_
    ) {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (
            router_ == address(0) || address(pairedToken_) == address(0) || address(weth_) == address(0)
                || address(pairedToken_) == address(weth_) || address(pairedToken_).code.length == 0
                || address(weth_).code.length == 0 || address(positionManager_).code.length == 0 || poolFee_ == 0
        ) revert InvalidSession();

        router = router_;
        pairedToken = pairedToken_;
        weth = weth_;
        positionManager = positionManager_;
        poolFee = poolFee_;

        bool pairedIsToken0 = address(pairedToken_) < address(weth_);
        pairedTokenIsToken0 = pairedIsToken0;
        token0 = pairedIsToken0 ? pairedToken_ : weth_;
        token1 = pairedIsToken0 ? weth_ : pairedToken_;
    }

    receive() external payable {
        revert InvalidSession();
    }

    function begin(address owner, bytes32 migrationId) external onlyRouter nonReentrant {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (activeMigrationId != bytes32(0) || owner == address(0) || migrationId == bytes32(0)) {
            revert InvalidState();
        }

        // Activate before token callbacks and bind every saved balance to this owner and request.
        activeMigrationId = migrationId;
        activeOwner = owner;
        pairedTokenSessionBalanceBefore = pairedToken.balanceOf(address(this));
        wethSessionBalanceBefore = weth.balanceOf(address(this));
        pairedTokenOwnerBalanceBefore = pairedToken.balanceOf(owner);
        wethOwnerBalanceBefore = weth.balanceOf(owner);
    }

    function execute(bytes32 migrationId, SessionRequest calldata request)
        external
        onlyRouter
        nonReentrant
        returns (
            uint256 positionId,
            uint128 mintedLiquidity,
            uint256 pairedTokenUsed,
            uint256 wethUsed,
            uint256 pairedTokenRefunded,
            uint256 wethRefunded
        )
    {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        BalanceSnapshot memory snapshot = BalanceSnapshot({
            owner: activeOwner,
            pairedTokenSession: pairedTokenSessionBalanceBefore,
            wethSession: wethSessionBalanceBefore,
            pairedTokenOwner: pairedTokenOwnerBalanceBefore,
            wethOwner: wethOwnerBalanceBefore
        });
        if (migrationId == bytes32(0) || migrationId != activeMigrationId || snapshot.owner == address(0)) {
            revert InvalidState();
        }
        if (
            request.pairedTokenDesired == 0 || request.wethDesired == 0
                || request.pairedTokenMinimum > request.pairedTokenDesired || request.wethMinimum > request.wethDesired
                || request.minimumLiquidity == 0
                || snapshot.pairedTokenSession > type(uint256).max - request.pairedTokenDesired
                || snapshot.wethSession > type(uint256).max - request.wethDesired
                || snapshot.pairedTokenOwner < request.pairedTokenDesired || snapshot.wethOwner < request.wethDesired
        ) revert InvalidSession();

        // Keep no active session state across token, manager, or refund callbacks. A revert restores
        // the pre-call state, and the router's own non-reentrant frame prevents a second migration.
        _clearSession();
        if (
            pairedToken.balanceOf(address(this)) != snapshot.pairedTokenSession + request.pairedTokenDesired
                || weth.balanceOf(address(this)) != snapshot.wethSession + request.wethDesired
        ) revert InexactTokenTransfer();

        pairedToken.forceApprove(address(positionManager), request.pairedTokenDesired);
        weth.forceApprove(address(positionManager), request.wethDesired);

        uint256 amount0Used;
        uint256 amount1Used;
        (positionId, mintedLiquidity, amount0Used, amount1Used) =
            positionManager.mint(_mintParams(snapshot.owner, request));

        pairedToken.forceApprove(address(positionManager), 0);
        weth.forceApprove(address(positionManager), 0);
        _requireApprovalsCleared();

        pairedTokenUsed = pairedTokenIsToken0 ? amount0Used : amount1Used;
        wethUsed = pairedTokenIsToken0 ? amount1Used : amount0Used;
        if (
            positionId == 0 || mintedLiquidity < request.minimumLiquidity
                || pairedTokenUsed < request.pairedTokenMinimum || pairedTokenUsed > request.pairedTokenDesired
                || wethUsed < request.wethMinimum || wethUsed > request.wethDesired
                || pairedToken.balanceOf(address(this))
                    != snapshot.pairedTokenSession + request.pairedTokenDesired - pairedTokenUsed
                || weth.balanceOf(address(this)) != snapshot.wethSession + request.wethDesired - wethUsed
        ) revert SlippageExceeded();
        _verifyPosition(snapshot.owner, positionId, request, mintedLiquidity);

        pairedTokenRefunded = request.pairedTokenDesired - pairedTokenUsed;
        wethRefunded = request.wethDesired - wethUsed;
        if (pairedTokenRefunded != 0) pairedToken.safeTransfer(snapshot.owner, pairedTokenRefunded);
        if (wethRefunded != 0) weth.safeTransfer(snapshot.owner, wethRefunded);

        if (
            pairedToken.balanceOf(address(this)) != snapshot.pairedTokenSession
                || weth.balanceOf(address(this)) != snapshot.wethSession
                || pairedToken.balanceOf(snapshot.owner) != snapshot.pairedTokenOwner - pairedTokenUsed
                || weth.balanceOf(snapshot.owner) != snapshot.wethOwner - wethUsed
        ) revert InexactTokenTransfer();
        _verifyPosition(snapshot.owner, positionId, request, mintedLiquidity);
        _requireApprovalsCleared();
    }

    function _clearSession() private {
        activeMigrationId = bytes32(0);
        activeOwner = address(0);
        pairedTokenSessionBalanceBefore = 0;
        wethSessionBalanceBefore = 0;
        pairedTokenOwnerBalanceBefore = 0;
        wethOwnerBalanceBefore = 0;
    }

    function _requireApprovalsCleared() private view {
        if (
            pairedToken.allowance(address(this), address(positionManager)) != 0
                || weth.allowance(address(this), address(positionManager)) != 0
        ) revert ApprovalNotCleared();
    }

    function _mintParams(address owner, SessionRequest calldata request)
        private
        view
        returns (ISushiV3PositionManager.MintParams memory params)
    {
        params = ISushiV3PositionManager.MintParams({
            token0: address(token0),
            token1: address(token1),
            fee: poolFee,
            tickLower: request.tickLower,
            tickUpper: request.tickUpper,
            amount0Desired: pairedTokenIsToken0 ? request.pairedTokenDesired : request.wethDesired,
            amount1Desired: pairedTokenIsToken0 ? request.wethDesired : request.pairedTokenDesired,
            amount0Min: pairedTokenIsToken0 ? request.pairedTokenMinimum : request.wethMinimum,
            amount1Min: pairedTokenIsToken0 ? request.wethMinimum : request.pairedTokenMinimum,
            recipient: owner,
            deadline: request.deadline
        });
    }

    function _verifyPosition(
        address owner,
        uint256 positionId,
        SessionRequest calldata request,
        uint128 mintedLiquidity
    ) private view {
        address actualToken0;
        address actualToken1;
        uint24 actualFee;
        int24 actualTickLower;
        int24 actualTickUpper;
        uint128 actualLiquidity;
        (,, actualToken0, actualToken1, actualFee, actualTickLower, actualTickUpper, actualLiquidity,,,,) =
            positionManager.positions(positionId);

        if (
            positionManager.ownerOf(positionId) != owner || actualToken0 != address(token0)
                || actualToken1 != address(token1) || actualFee != poolFee || actualTickLower != request.tickLower
                || actualTickUpper != request.tickUpper || actualLiquidity != mintedLiquidity
                || actualLiquidity < request.minimumLiquidity
        ) revert PositionVerificationFailed();
    }
}
