// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRMTUniswapV3FactoryV1 {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IRMTUniswapV3PoolV1 {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IRMTUniswapSwapRouter02V1 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function factory() external view returns (address);
    function WETH9() external view returns (address);
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Provider-specific, non-custodial settlement primitive for RMT-authorized Uniswap V3 exact-input trades.
/// @dev The contract has no owner, upgrade path, arbitrary target, arbitrary calldata, rescue or retained-fund path.
///      One deployment binds one exact RMT policy and one exact Router02/factory/WETH runtime identity.
contract RMTUniswapV3FeeExecutorV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 4_663;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_FEE_BPS = 100;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    uint256 private constant EXECUTION_CALLDATA_LENGTH = 4 + (24 * 32);
    bytes32 public constant PROVIDER_ID = keccak256("RMT_UNISWAP_V3_ROUTER02_V1");
    bytes32 private constant ROUTE_DOMAIN = keccak256("RMT_UNISWAP_V3_ROUTE_V1");

    enum FeeSide {
        INPUT,
        OUTPUT
    }

    enum RouteKind {
        EXACT_INPUT_SINGLE,
        EXACT_INPUT_WETH_HOP
    }

    struct Route {
        RouteKind kind;
        address tokenIn;
        address tokenOut;
        uint24 fee0;
        uint24 fee1;
        address pool0;
        address pool1;
    }

    struct FeeAuthorization {
        bytes32 executionId;
        bytes32 policyIdHash;
        uint256 policyVersion;
        bytes32 policyHash;
        uint16 feeBps;
        FeeSide feeSide;
        address feeAsset;
        uint256 expectedFeeAtomic;
        uint256 maximumFeeAtomic;
        address trader;
        uint256 userGrossInput;
        uint256 providerInput;
        uint256 expectedGrossOutput;
        uint256 routerMinimumGrossOutput;
        uint256 protectedUserNetOutput;
        uint256 deadline;
        bytes32 routeIdentity;
    }

    address public immutable router;
    address public immutable factory;
    address public immutable weth;
    address public immutable treasury;
    bytes32 public immutable routerRuntimeHash;
    bytes32 public immutable factoryRuntimeHash;
    bytes32 public immutable wethRuntimeHash;
    bytes32 public immutable policyIdHash;
    uint256 public immutable policyVersion;
    bytes32 public immutable policyHash;
    uint16 public immutable policyFeeBps;
    uint256 public immutable policyFromBlock;
    uint256 public immutable policyBeforeBlock;
    bool public immutable nativeFeeAssetEligible;

    mapping(bytes32 executionId => bool consumed) public executionConsumed;
    mapping(address feeAsset => bool eligible) public feeAssetEligible;

    event RMTUniswapV3FeeSettled(
        bytes32 indexed executionId,
        bytes32 indexed policyHash,
        address indexed trader,
        bytes32 policyIdHash,
        uint256 policyVersion,
        bytes32 providerId,
        address router,
        bytes32 routeIdentity,
        address feeAsset,
        uint16 feeBps,
        FeeSide feeSide,
        uint256 userGrossInput,
        uint256 providerInput,
        uint256 grossActualOutput,
        uint256 actualRmtFee,
        uint256 actualUserNetOutput,
        address treasury
    );

    error InvalidConfiguration();
    error InvalidPolicy();
    error PolicyInactive();
    error InvalidAuthorization();
    error InvalidRoute();
    error InvalidPool();
    error RuntimeIdentityChanged();
    error ExecutionAlreadyConsumed();
    error UnsupportedTransferBehavior();
    error UnsafeOutput(uint256 actual, uint256 minimum);
    error NativeTransferFailed();

    constructor(
        address router_,
        bytes32 routerRuntimeHash_,
        address factory_,
        bytes32 factoryRuntimeHash_,
        address weth_,
        bytes32 wethRuntimeHash_,
        address treasury_,
        address[] memory eligibleFeeAssets_,
        bool nativeFeeAssetEligible_,
        bytes32 policyIdHash_,
        uint256 policyVersion_,
        bytes32 policyHash_,
        uint16 policyFeeBps_,
        uint256 policyFromBlock_,
        uint256 policyBeforeBlock_
    ) {
        if (block.chainid != CHAIN_ID) revert InvalidConfiguration();
        if (
            router_ == address(0) || factory_ == address(0) || weth_ == address(0) || treasury_ == address(0)
                || treasury_ == router_ || treasury_ == factory_ || treasury_ == weth_ || treasury_ == address(this)
                || routerRuntimeHash_ == bytes32(0) || factoryRuntimeHash_ == bytes32(0)
                || wethRuntimeHash_ == bytes32(0)
        ) revert InvalidConfiguration();
        if (
            policyIdHash_ == bytes32(0) || policyVersion_ == 0 || policyHash_ == bytes32(0) || policyFeeBps_ == 0
                || policyFeeBps_ > MAX_FEE_BPS || policyFromBlock_ == 0
                || (policyBeforeBlock_ != 0 && policyBeforeBlock_ <= policyFromBlock_)
                || (eligibleFeeAssets_.length == 0 && !nativeFeeAssetEligible_)
        ) revert InvalidPolicy();

        router = router_;
        factory = factory_;
        weth = weth_;
        treasury = treasury_;
        routerRuntimeHash = routerRuntimeHash_;
        factoryRuntimeHash = factoryRuntimeHash_;
        wethRuntimeHash = wethRuntimeHash_;
        policyIdHash = policyIdHash_;
        policyVersion = policyVersion_;
        policyHash = policyHash_;
        policyFeeBps = policyFeeBps_;
        policyFromBlock = policyFromBlock_;
        policyBeforeBlock = policyBeforeBlock_;
        nativeFeeAssetEligible = nativeFeeAssetEligible_;

        for (uint256 i; i < eligibleFeeAssets_.length; ++i) {
            address asset = eligibleFeeAssets_[i];
            if (asset == address(0) || asset == treasury_ || asset.code.length == 0 || feeAssetEligible[asset]) {
                revert InvalidPolicy();
            }
            feeAssetEligible[asset] = true;
        }

        _assertRuntimeIdentity();
        if (
            IRMTUniswapSwapRouter02V1(router_).factory() != factory_
                || IRMTUniswapSwapRouter02V1(router_).WETH9() != weth_
        ) revert InvalidConfiguration();
    }

    /// @notice Settles a trade whose authorized RMT fee is paid from the exact trade input.
    // slither-disable-start reentrancy-balance
    // Every external entry is protected by OpenZeppelin nonReentrant. Pre/post balance snapshots deliberately reject
    // unsupported transfer behavior and cannot be invalidated by an execution callback.
    function executeInputFee(FeeAuthorization calldata authorization, Route calldata route)
        external
        payable
        nonReentrant
        returns (uint256 grossActualOutput, uint256 actualRmtFee, uint256 actualUserNetOutput)
    {
        if (msg.data.length != EXECUTION_CALLDATA_LENGTH) revert InvalidAuthorization();
        _validateCommon(authorization, route, FeeSide.INPUT);
        actualRmtFee = calculateFee(authorization.userGrossInput, authorization.feeBps);
        if (
            authorization.expectedFeeAtomic != actualRmtFee || authorization.maximumFeeAtomic != actualRmtFee
                || authorization.providerInput != authorization.userGrossInput - actualRmtFee
                || authorization.routerMinimumGrossOutput != authorization.protectedUserNetOutput
        ) revert InvalidAuthorization();

        bool nativeInput = msg.value != 0;
        if (nativeInput) {
            if (
                route.tokenIn != weth || authorization.feeAsset != address(0)
                    || msg.value != authorization.userGrossInput
            ) revert InvalidAuthorization();
        } else if (authorization.feeAsset != route.tokenIn) {
            revert InvalidAuthorization();
        }

        executionConsumed[authorization.executionId] = true;
        uint256 nativeBalanceBefore = address(this).balance - msg.value;
        uint256 inputBalanceBefore = 0;
        if (!nativeInput) {
            inputBalanceBefore = _pullExact(route.tokenIn, authorization.trader, authorization.userGrossInput);
            _approveExact(route.tokenIn, authorization.providerInput);
        }

        uint256 traderOutputBefore = IERC20(route.tokenOut).balanceOf(authorization.trader);
        grossActualOutput = _swap(
            route,
            authorization.providerInput,
            authorization.routerMinimumGrossOutput,
            authorization.trader,
            nativeInput ? authorization.providerInput : 0
        );
        if (!nativeInput) _clearApproval(route.tokenIn);
        uint256 traderOutputAfter = IERC20(route.tokenOut).balanceOf(authorization.trader);
        if (traderOutputAfter < traderOutputBefore || traderOutputAfter - traderOutputBefore != grossActualOutput) {
            revert UnsupportedTransferBehavior();
        }
        if (grossActualOutput < authorization.protectedUserNetOutput) {
            revert UnsafeOutput(grossActualOutput, authorization.protectedUserNetOutput);
        }

        if (nativeInput) {
            if (actualRmtFee != 0) _sendNative(treasury, actualRmtFee);
            if (address(this).balance != nativeBalanceBefore) revert UnsupportedTransferBehavior();
        } else {
            _transferExact(route.tokenIn, treasury, actualRmtFee);
            if (IERC20(route.tokenIn).balanceOf(address(this)) != inputBalanceBefore) {
                revert UnsupportedTransferBehavior();
            }
        }
        actualUserNetOutput = grossActualOutput;
        _emitSettlement(authorization, grossActualOutput, actualRmtFee, actualUserNetOutput);
    }

    // slither-disable-end reentrancy-balance

    /// @notice Settles a trade whose authorized RMT fee is paid from the exact trade output.
    // slither-disable-start reentrancy-balance
    // See executeInputFee: the snapshots are security invariants inside the same nonReentrant boundary.
    function executeOutputFee(FeeAuthorization calldata authorization, Route calldata route)
        external
        payable
        nonReentrant
        returns (uint256 grossActualOutput, uint256 actualRmtFee, uint256 actualUserNetOutput)
    {
        if (msg.data.length != EXECUTION_CALLDATA_LENGTH) revert InvalidAuthorization();
        _validateCommon(authorization, route, FeeSide.OUTPUT);
        uint256 expectedFee = calculateFee(authorization.expectedGrossOutput, authorization.feeBps);
        uint256 protectedFee = calculateFee(authorization.routerMinimumGrossOutput, authorization.feeBps);
        if (protectedFee > authorization.maximumFeeAtomic) protectedFee = authorization.maximumFeeAtomic;
        if (
            authorization.feeAsset != route.tokenOut || authorization.userGrossInput != authorization.providerInput
                || authorization.expectedFeeAtomic != expectedFee || authorization.maximumFeeAtomic != expectedFee
                || authorization.protectedUserNetOutput != authorization.routerMinimumGrossOutput - protectedFee
        ) revert InvalidAuthorization();

        bool nativeInput = msg.value != 0;
        if (nativeInput) {
            if (route.tokenIn != weth || msg.value != authorization.providerInput) revert InvalidAuthorization();
        } else if (msg.value != 0) {
            revert InvalidAuthorization();
        }

        executionConsumed[authorization.executionId] = true;
        uint256 nativeBalanceBefore = address(this).balance - msg.value;
        uint256 inputBalanceBefore = 0;
        if (!nativeInput) {
            inputBalanceBefore = _pullExact(route.tokenIn, authorization.trader, authorization.providerInput);
            _approveExact(route.tokenIn, authorization.providerInput);
        }

        uint256 outputBalanceBefore = IERC20(route.tokenOut).balanceOf(address(this));
        grossActualOutput = _swap(
            route,
            authorization.providerInput,
            authorization.routerMinimumGrossOutput,
            address(this),
            nativeInput ? authorization.providerInput : 0
        );
        if (!nativeInput) {
            _clearApproval(route.tokenIn);
            if (IERC20(route.tokenIn).balanceOf(address(this)) != inputBalanceBefore) {
                revert UnsupportedTransferBehavior();
            }
        } else if (address(this).balance != nativeBalanceBefore) {
            revert UnsupportedTransferBehavior();
        }
        uint256 outputBalanceAfter = IERC20(route.tokenOut).balanceOf(address(this));
        if (outputBalanceAfter < outputBalanceBefore || outputBalanceAfter - outputBalanceBefore != grossActualOutput) {
            revert UnsupportedTransferBehavior();
        }

        actualRmtFee = calculateFee(grossActualOutput, authorization.feeBps);
        if (actualRmtFee > authorization.maximumFeeAtomic) actualRmtFee = authorization.maximumFeeAtomic;
        actualUserNetOutput = grossActualOutput - actualRmtFee;
        if (actualUserNetOutput < authorization.protectedUserNetOutput) {
            revert UnsafeOutput(actualUserNetOutput, authorization.protectedUserNetOutput);
        }

        _transferExact(route.tokenOut, treasury, actualRmtFee);
        _transferExact(route.tokenOut, authorization.trader, actualUserNetOutput);
        if (IERC20(route.tokenOut).balanceOf(address(this)) != outputBalanceBefore) {
            revert UnsupportedTransferBehavior();
        }
        _emitSettlement(authorization, grossActualOutput, actualRmtFee, actualUserNetOutput);
    }
    // slither-disable-end reentrancy-balance

    function calculateFee(uint256 amount, uint16 feeBps) public pure returns (uint256) {
        if (feeBps == 0 || feeBps > MAX_FEE_BPS) revert InvalidAuthorization();
        return amount * feeBps / BPS_DENOMINATOR;
    }

    function routeIdentity(Route calldata route) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ROUTE_DOMAIN,
                route.kind,
                route.tokenIn,
                route.tokenOut,
                route.fee0,
                route.fee1,
                route.pool0,
                route.pool1
            )
        );
    }

    function _validateCommon(FeeAuthorization calldata authorization, Route calldata route, FeeSide expectedSide)
        private
        view
    {
        _assertRuntimeIdentity();
        if (block.number < policyFromBlock || (policyBeforeBlock != 0 && block.number >= policyBeforeBlock)) {
            revert PolicyInactive();
        }
        if (executionConsumed[authorization.executionId]) revert ExecutionAlreadyConsumed();
        if (
            authorization.executionId == bytes32(0) || authorization.policyIdHash != policyIdHash
                || authorization.policyVersion != policyVersion || authorization.policyHash != policyHash
                || authorization.feeBps != policyFeeBps || authorization.feeSide != expectedSide
                || authorization.trader != msg.sender || authorization.trader == address(0)
                || authorization.trader == address(this)
                || (authorization.feeAsset == address(0)
                        ? !nativeFeeAssetEligible
                        : !feeAssetEligible[authorization.feeAsset]) || authorization.userGrossInput == 0
                || authorization.providerInput == 0 || authorization.expectedGrossOutput == 0
                || authorization.routerMinimumGrossOutput == 0 || authorization.protectedUserNetOutput == 0
                || authorization.routerMinimumGrossOutput > authorization.expectedGrossOutput
                || authorization.deadline < block.timestamp
                || authorization.deadline > block.timestamp + MAX_DEADLINE_WINDOW
                || authorization.routeIdentity != routeIdentity(route)
        ) revert InvalidAuthorization();
        _validateRoute(route);
    }

    function _validateRoute(Route calldata route) private view {
        if (
            route.tokenIn == address(0) || route.tokenOut == address(0) || route.tokenIn == route.tokenOut
                || route.tokenIn.code.length == 0 || route.tokenOut.code.length == 0 || !_allowedFee(route.fee0)
        ) revert InvalidRoute();
        _validatePool(
            route.pool0, route.tokenIn, route.kind == RouteKind.EXACT_INPUT_SINGLE ? route.tokenOut : weth, route.fee0
        );
        if (route.kind == RouteKind.EXACT_INPUT_SINGLE) {
            if (route.fee1 != 0 || route.pool1 != address(0)) revert InvalidRoute();
            return;
        }
        if (
            route.kind != RouteKind.EXACT_INPUT_WETH_HOP || route.tokenIn == weth || route.tokenOut == weth
                || !_allowedFee(route.fee1)
        ) revert InvalidRoute();
        _validatePool(route.pool1, weth, route.tokenOut, route.fee1);
    }

    function _validatePool(address pool, address tokenA, address tokenB, uint24 fee) private view {
        if (
            pool == address(0) || pool.code.length == 0
                || IRMTUniswapV3FactoryV1(factory).getPool(tokenA, tokenB, fee) != pool
        ) revert InvalidPool();
        address token0 = IRMTUniswapV3PoolV1(pool).token0();
        address token1 = IRMTUniswapV3PoolV1(pool).token1();
        if (!((token0 == tokenA && token1 == tokenB) || (token0 == tokenB && token1 == tokenA))) {
            revert InvalidPool();
        }
    }

    function _swap(Route calldata route, uint256 amountIn, uint256 minimumOut, address recipient, uint256 value)
        private
        returns (uint256 amountOut)
    {
        if (route.kind == RouteKind.EXACT_INPUT_SINGLE) {
            // slither-disable-next-line arbitrary-send-eth
            // The receiver is immutable verified Router02 and value is the exact authorized WETH-denominated input.
            amountOut = IRMTUniswapSwapRouter02V1(router).exactInputSingle{value: value}(
                IRMTUniswapSwapRouter02V1.ExactInputSingleParams({
                    tokenIn: route.tokenIn,
                    tokenOut: route.tokenOut,
                    fee: route.fee0,
                    recipient: recipient,
                    amountIn: amountIn,
                    amountOutMinimum: minimumOut,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            // slither-disable-next-line arbitrary-send-eth
            // The receiver is immutable verified Router02 and value is the exact authorized WETH-denominated input.
            amountOut = IRMTUniswapSwapRouter02V1(router).exactInput{value: value}(
                IRMTUniswapSwapRouter02V1.ExactInputParams({
                    path: abi.encodePacked(route.tokenIn, route.fee0, weth, route.fee1, route.tokenOut),
                    recipient: recipient,
                    amountIn: amountIn,
                    amountOutMinimum: minimumOut
                })
            );
        }
    }

    function _pullExact(address token, address trader, uint256 amount) private returns (uint256 balanceBefore) {
        IERC20 asset = IERC20(token);
        balanceBefore = asset.balanceOf(address(this));
        // slither-disable-next-line arbitrary-send-erc20
        // trader is required to equal msg.sender by _validateCommon; no third-party wallet can be selected.
        asset.safeTransferFrom(trader, address(this), amount);
        uint256 balanceAfter = asset.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert UnsupportedTransferBehavior();
        }
    }

    function _approveExact(address token, uint256 amount) private {
        IERC20 asset = IERC20(token);
        asset.forceApprove(router, 0);
        asset.forceApprove(router, amount);
        if (asset.allowance(address(this), router) != amount) revert UnsupportedTransferBehavior();
    }

    function _clearApproval(address token) private {
        IERC20 asset = IERC20(token);
        asset.forceApprove(router, 0);
        if (asset.allowance(address(this), router) != 0) revert UnsupportedTransferBehavior();
    }

    function _transferExact(address token, address recipient, uint256 amount) private {
        if (amount == 0) return;
        IERC20 asset = IERC20(token);
        uint256 senderBefore = asset.balanceOf(address(this));
        uint256 recipientBefore = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        uint256 senderAfter = asset.balanceOf(address(this));
        uint256 recipientAfter = asset.balanceOf(recipient);
        if (
            senderBefore < senderAfter || senderBefore - senderAfter != amount || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != amount
        ) revert UnsupportedTransferBehavior();
    }

    function _sendNative(address recipient, uint256 amount) private {
        // slither-disable-next-line arbitrary-send-eth,low-level-calls
        // recipient is the immutable treasury and this executes inside nonReentrant; failure reverts the full swap.
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    function _assertRuntimeIdentity() private view {
        if (
            router.code.length == 0 || factory.code.length == 0 || weth.code.length == 0
                || router.codehash != routerRuntimeHash || factory.codehash != factoryRuntimeHash
                || weth.codehash != wethRuntimeHash || IRMTUniswapSwapRouter02V1(router).factory() != factory
                || IRMTUniswapSwapRouter02V1(router).WETH9() != weth
        ) revert RuntimeIdentityChanged();
    }

    function _allowedFee(uint24 fee) private pure returns (bool) {
        return fee == 100 || fee == 500 || fee == 3_000 || fee == 10_000;
    }

    function _emitSettlement(
        FeeAuthorization calldata authorization,
        uint256 grossActualOutput,
        uint256 actualRmtFee,
        uint256 actualUserNetOutput
    ) private {
        emit RMTUniswapV3FeeSettled(
            authorization.executionId,
            authorization.policyHash,
            authorization.trader,
            authorization.policyIdHash,
            authorization.policyVersion,
            PROVIDER_ID,
            router,
            authorization.routeIdentity,
            authorization.feeAsset,
            authorization.feeBps,
            authorization.feeSide,
            authorization.userGrossInput,
            authorization.providerInput,
            grossActualOutput,
            actualRmtFee,
            actualUserNetOutput,
            treasury
        );
    }
}
