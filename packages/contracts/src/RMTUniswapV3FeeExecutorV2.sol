// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRMTUniswapV3FactoryV2 {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IRMTUniswapV3PoolV2 {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IRMTArbSysV2 {
    function arbBlockNumber() external view returns (uint256);
}

interface IRMTWETHV2 is IERC20 {
    function withdraw(uint256 amount) external;
}

interface IRMTUniswapSwapRouter02V2 {
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

/// @notice Ownerless atomic settlement primitive for RMT_EXECUTION_V2 Uniswap V3 exact-input trades.
/// @dev The contract has no owner, upgrade, proxy, rescue, arbitrary target or arbitrary calldata surface.
///      Every deployment binds one exact V2 policy and one exact Router02/factory/WETH runtime identity.
contract RMTUniswapV3FeeExecutorV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 4_663;
    uint16 public constant FEE_BPS = 25;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    address public constant ARBSYS = address(100);
    bytes32 public constant POLICY_ID_HASH = keccak256("RMT_EXECUTION_V2");
    uint256 public constant POLICY_VERSION = 2;
    bytes32 public constant PROVIDER_ID = keccak256("RMT_UNISWAP_V3_ROUTER02_V2");
    uint256 private constant EXECUTION_CALLDATA_LENGTH = 4 + (28 * 32);
    bytes32 private constant ROUTE_DOMAIN = keccak256("RMT_UNISWAP_V3_ROUTE_V2");

    enum FeeSide {
        INPUT
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
        address treasury;
        address trader;
        address requestedInputAsset;
        address requestedOutputAsset;
        address routedInputAsset;
        address routedOutputAsset;
        uint256 userGrossInput;
        uint256 expectedFeeAtomic;
        uint256 maximumFeeAtomic;
        uint256 providerInput;
        uint256 expectedProviderOutput;
        uint256 protectedOutput;
        uint256 deadline;
        bytes32 routeIdentity;
    }

    address public immutable router;
    address public immutable factory;
    address public immutable weth;
    address public immutable wethImplementation;
    address public immutable treasury;
    bytes32 public immutable routerRuntimeHash;
    bytes32 public immutable factoryRuntimeHash;
    bytes32 public immutable wethRuntimeHash;
    bytes32 public immutable wethImplementationRuntimeHash;
    bytes32 public immutable policyHash;
    uint256 public immutable policyFromBlock;
    uint256 public immutable policyBeforeBlock;

    mapping(bytes32 executionId => bool consumed) public executionConsumed;

    event RMTUniswapV3FeeSettledV2(
        bytes32 indexed executionId,
        bytes32 indexed policyHash,
        address indexed trader,
        bytes32 policyIdHash,
        uint256 policyVersion,
        bytes32 providerId,
        address router,
        bytes32 routeIdentity,
        address requestedInputAsset,
        address requestedOutputAsset,
        address feeAsset,
        uint16 feeBps,
        FeeSide feeSide,
        uint256 userGrossInput,
        uint256 providerInput,
        uint256 actualProviderOutput,
        uint256 actualRmtFee,
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
        address wethImplementation_,
        bytes32 wethImplementationRuntimeHash_,
        address treasury_,
        bytes32 policyIdHash_,
        uint256 policyVersion_,
        bytes32 policyHash_,
        uint16 policyFeeBps_,
        uint256 policyFromBlock_,
        uint256 policyBeforeBlock_
    ) {
        if (block.chainid != CHAIN_ID) revert InvalidConfiguration();
        if (
            router_ == address(0) || factory_ == address(0) || weth_ == address(0) || wethImplementation_ == address(0)
                || treasury_ == address(0) || treasury_ == router_ || treasury_ == factory_ || treasury_ == weth_
                || treasury_ == wethImplementation_ || treasury_ == address(this) || routerRuntimeHash_ == bytes32(0)
                || factoryRuntimeHash_ == bytes32(0) || wethRuntimeHash_ == bytes32(0)
                || wethImplementationRuntimeHash_ == bytes32(0)
        ) revert InvalidConfiguration();
        if (
            policyIdHash_ != POLICY_ID_HASH || policyVersion_ != POLICY_VERSION || policyHash_ == bytes32(0)
                || policyFeeBps_ != FEE_BPS || policyFromBlock_ == 0
                || (policyBeforeBlock_ != 0 && policyBeforeBlock_ <= policyFromBlock_)
        ) revert InvalidPolicy();

        router = router_;
        factory = factory_;
        weth = weth_;
        wethImplementation = wethImplementation_;
        treasury = treasury_;
        routerRuntimeHash = routerRuntimeHash_;
        factoryRuntimeHash = factoryRuntimeHash_;
        wethRuntimeHash = wethRuntimeHash_;
        wethImplementationRuntimeHash = wethImplementationRuntimeHash_;
        policyHash = policyHash_;
        policyFromBlock = policyFromBlock_;
        policyBeforeBlock = policyBeforeBlock_;

        _assertRuntimeIdentity();
        if (
            IRMTUniswapSwapRouter02V2(router_).factory() != factory_
                || IRMTUniswapSwapRouter02V2(router_).WETH9() != weth_
        ) revert InvalidConfiguration();
    }

    receive() external payable {
        if (msg.sender != weth) revert NativeTransferFailed();
    }

    // slither-disable-start reentrancy-balance
    function execute(FeeAuthorization calldata authorization, Route calldata route)
        external
        payable
        nonReentrant
        returns (uint256 actualProviderOutput, uint256 actualRmtFee)
    {
        if (msg.data.length != EXECUTION_CALLDATA_LENGTH) revert InvalidAuthorization();
        (bool nativeInput, bool nativeOutput) = _validate(authorization, route);
        actualRmtFee = calculateFee(authorization.userGrossInput);
        if (
            authorization.expectedFeeAtomic != actualRmtFee || authorization.maximumFeeAtomic != actualRmtFee
                || authorization.providerInput != authorization.userGrossInput - actualRmtFee
        ) revert InvalidAuthorization();

        executionConsumed[authorization.executionId] = true;
        uint256 nativeBalanceBefore = address(this).balance - msg.value;
        uint256 inputBalanceBefore;
        if (!nativeInput) {
            inputBalanceBefore = _pullExact(route.tokenIn, authorization.userGrossInput);
            _approveExact(route.tokenIn, authorization.providerInput);
        }

        if (nativeOutput) {
            uint256 wethBalanceBefore = IERC20(weth).balanceOf(address(this));
            actualProviderOutput = _swap(
                route,
                authorization.providerInput,
                authorization.protectedOutput,
                address(this),
                nativeInput ? authorization.providerInput : 0
            );
            if (!nativeInput) _clearApproval(route.tokenIn);
            uint256 wethBalanceAfter = IERC20(weth).balanceOf(address(this));
            if (
                wethBalanceAfter < wethBalanceBefore || wethBalanceAfter - wethBalanceBefore != actualProviderOutput
                    || actualProviderOutput < authorization.protectedOutput
            ) revert UnsupportedTransferBehavior();
            IRMTWETHV2(weth).withdraw(actualProviderOutput);
            if (IERC20(weth).balanceOf(address(this)) != wethBalanceBefore) revert UnsupportedTransferBehavior();
            _sendNative(authorization.trader, actualProviderOutput);
        } else {
            uint256 traderOutputBefore = IERC20(route.tokenOut).balanceOf(authorization.trader);
            actualProviderOutput = _swap(
                route,
                authorization.providerInput,
                authorization.protectedOutput,
                authorization.trader,
                nativeInput ? authorization.providerInput : 0
            );
            if (!nativeInput) _clearApproval(route.tokenIn);
            uint256 traderOutputAfter = IERC20(route.tokenOut).balanceOf(authorization.trader);
            if (
                traderOutputAfter < traderOutputBefore || traderOutputAfter - traderOutputBefore != actualProviderOutput
                    || actualProviderOutput < authorization.protectedOutput
            ) revert UnsupportedTransferBehavior();
        }

        if (nativeInput) {
            if (actualRmtFee != 0) _sendNative(treasury, actualRmtFee);
        } else {
            _transferExact(route.tokenIn, treasury, actualRmtFee);
            if (
                IERC20(route.tokenIn).balanceOf(address(this)) != inputBalanceBefore
                    || IERC20(route.tokenIn).allowance(address(this), router) != 0
            ) revert UnsupportedTransferBehavior();
        }
        if (address(this).balance != nativeBalanceBefore) revert UnsupportedTransferBehavior();

        emit RMTUniswapV3FeeSettledV2(
            authorization.executionId,
            authorization.policyHash,
            authorization.trader,
            authorization.policyIdHash,
            authorization.policyVersion,
            PROVIDER_ID,
            router,
            authorization.routeIdentity,
            authorization.requestedInputAsset,
            authorization.requestedOutputAsset,
            authorization.feeAsset,
            authorization.feeBps,
            authorization.feeSide,
            authorization.userGrossInput,
            authorization.providerInput,
            actualProviderOutput,
            actualRmtFee,
            treasury
        );
    }
    // slither-disable-end reentrancy-balance

    function calculateFee(uint256 userGrossInput) public pure returns (uint256) {
        if (userGrossInput == 0) revert InvalidAuthorization();
        return userGrossInput * FEE_BPS / BPS_DENOMINATOR;
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

    function currentPolicyBlock() public view returns (uint256 l2BlockNumber) {
        try IRMTArbSysV2(ARBSYS).arbBlockNumber() returns (uint256 currentL2Block) {
            if (currentL2Block == 0) revert RuntimeIdentityChanged();
            return currentL2Block;
        } catch {
            revert RuntimeIdentityChanged();
        }
    }

    function _validate(FeeAuthorization calldata authorization, Route calldata route)
        private
        view
        returns (bool nativeInput, bool nativeOutput)
    {
        _assertRuntimeIdentity();
        uint256 policyBlock = currentPolicyBlock();
        if (policyBlock < policyFromBlock || (policyBeforeBlock != 0 && policyBlock >= policyBeforeBlock)) {
            revert PolicyInactive();
        }
        if (executionConsumed[authorization.executionId]) revert ExecutionAlreadyConsumed();
        if (
            authorization.executionId == bytes32(0) || authorization.policyIdHash != POLICY_ID_HASH
                || authorization.policyVersion != POLICY_VERSION || authorization.policyHash != policyHash
                || authorization.feeBps != FEE_BPS || authorization.feeSide != FeeSide.INPUT
                || authorization.treasury != treasury || authorization.trader != msg.sender
                || authorization.trader == address(0) || authorization.trader == address(this)
                || authorization.userGrossInput == 0 || authorization.providerInput == 0
                || authorization.expectedProviderOutput == 0 || authorization.protectedOutput == 0
                || authorization.protectedOutput > authorization.expectedProviderOutput
                || authorization.deadline < block.timestamp
                || authorization.deadline > block.timestamp + MAX_DEADLINE_WINDOW
                || authorization.routeIdentity != routeIdentity(route)
                || authorization.routedInputAsset != route.tokenIn || authorization.routedOutputAsset != route.tokenOut
        ) revert InvalidAuthorization();

        nativeInput = authorization.requestedInputAsset == address(0);
        nativeOutput = authorization.requestedOutputAsset == address(0);
        if (nativeInput && nativeOutput) revert InvalidAuthorization();
        if (nativeInput) {
            if (
                authorization.routedInputAsset != weth || authorization.feeAsset != address(0)
                    || msg.value != authorization.userGrossInput
            ) revert InvalidAuthorization();
        } else if (
            msg.value != 0 || authorization.requestedInputAsset != authorization.routedInputAsset
                || authorization.feeAsset != authorization.requestedInputAsset
                || authorization.requestedInputAsset.code.length == 0
        ) {
            revert InvalidAuthorization();
        }
        if (nativeOutput) {
            if (authorization.routedOutputAsset != weth) revert InvalidAuthorization();
        } else if (
            authorization.requestedOutputAsset != authorization.routedOutputAsset
                || authorization.requestedOutputAsset.code.length == 0
        ) {
            revert InvalidAuthorization();
        }
        if (authorization.requestedInputAsset == authorization.requestedOutputAsset) revert InvalidAuthorization();
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
                || IRMTUniswapV3FactoryV2(factory).getPool(tokenA, tokenB, fee) != pool
        ) revert InvalidPool();
        address token0 = IRMTUniswapV3PoolV2(pool).token0();
        address token1 = IRMTUniswapV3PoolV2(pool).token1();
        if (!((token0 == tokenA && token1 == tokenB) || (token0 == tokenB && token1 == tokenA))) {
            revert InvalidPool();
        }
    }

    function _swap(Route calldata route, uint256 amountIn, uint256 minimumOut, address recipient, uint256 value)
        private
        returns (uint256 amountOut)
    {
        if (route.kind == RouteKind.EXACT_INPUT_SINGLE) {
            amountOut = IRMTUniswapSwapRouter02V2(router).exactInputSingle{value: value}(
                IRMTUniswapSwapRouter02V2.ExactInputSingleParams({
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
            amountOut = IRMTUniswapSwapRouter02V2(router).exactInput{value: value}(
                IRMTUniswapSwapRouter02V2.ExactInputParams({
                    path: abi.encodePacked(route.tokenIn, route.fee0, weth, route.fee1, route.tokenOut),
                    recipient: recipient,
                    amountIn: amountIn,
                    amountOutMinimum: minimumOut
                })
            );
        }
    }

    // slither-disable-start reentrancy-balance
    function _pullExact(address token, uint256 amount) private returns (uint256 balanceBefore) {
        IERC20 asset = IERC20(token);
        balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = asset.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert UnsupportedTransferBehavior();
        }
    }
    // slither-disable-end reentrancy-balance

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

    // slither-disable-start reentrancy-balance
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
    // slither-disable-end reentrancy-balance

    function _sendNative(address recipient, uint256 amount) private {
        uint256 recipientBefore = recipient.balance;
        (bool success,) = recipient.call{value: amount}("");
        if (!success || recipient.balance < recipientBefore || recipient.balance - recipientBefore != amount) {
            revert NativeTransferFailed();
        }
    }

    function _assertRuntimeIdentity() private view {
        if (
            router.code.length == 0 || factory.code.length == 0 || weth.code.length == 0
                || wethImplementation.code.length == 0 || router.codehash != routerRuntimeHash
                || factory.codehash != factoryRuntimeHash || weth.codehash != wethRuntimeHash
                || wethImplementation.codehash != wethImplementationRuntimeHash
                || IRMTUniswapSwapRouter02V2(router).factory() != factory
                || IRMTUniswapSwapRouter02V2(router).WETH9() != weth
        ) revert RuntimeIdentityChanged();
    }

    function _allowedFee(uint24 fee) private pure returns (bool) {
        return fee == 100 || fee == 500 || fee == 3_000 || fee == 10_000;
    }
}
