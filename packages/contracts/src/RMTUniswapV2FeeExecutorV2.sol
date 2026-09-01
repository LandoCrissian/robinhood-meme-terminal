// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRMTUniswapV2FactoryV2 {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IRMTUniswapV2PairV2 {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IRMTUniswapV2RouterV2 {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IRMTArbSysUniswapV2 {
    function arbBlockNumber() external view returns (uint256);
}

/// @notice Ownerless atomic settlement primitive for RMT_EXECUTION_V2 Uniswap V2 exact-input trades.
/// @dev There is no owner, proxy, upgrade, rescue, arbitrary target, calldata, path, treasury, or fee surface.
/// Forced native or ERC20 balances cannot be prevented on the EVM and remain permanently stranded. Each execution
/// preserves those pre-existing baselines exactly while rejecting any native, token, or allowance residue it creates.
contract RMTUniswapV2FeeExecutorV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 4_663;
    uint16 public constant FEE_BPS = 25;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    address public constant ARBSYS = address(100);
    bytes32 public constant POLICY_ID_HASH = keccak256("RMT_EXECUTION_V2");
    uint256 public constant POLICY_VERSION = 2;
    bytes32 public constant PROVIDER_ID = keccak256("RMT_UNISWAP_V2_ROUTER_V2");
    bytes32 private constant ROUTE_DOMAIN = keccak256("RMT_UNISWAP_V2_ROUTE_V2");
    uint256 private constant EXECUTION_CALLDATA_LENGTH = 4 + (26 * 32);

    enum FeeSide {
        INPUT
    }
    enum RouteKind {
        DIRECT,
        WETH_HOP
    }

    struct Route {
        RouteKind kind;
        address tokenIn;
        address tokenOut;
        address pair0;
        address pair1;
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
    address public immutable treasury;
    bytes32 public immutable routerRuntimeHash;
    bytes32 public immutable factoryRuntimeHash;
    bytes32 public immutable pairRuntimeHash;
    bytes32 public immutable wethRuntimeHash;
    bytes32 public immutable policyHash;
    uint256 public immutable policyFromBlock;
    uint256 public immutable policyBeforeBlock;

    mapping(bytes32 executionId => bool consumed) public executionConsumed;

    event RMTUniswapV2FeeSettledV2(
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
    error InvalidPair();
    error RuntimeIdentityChanged();
    error ExecutionAlreadyConsumed();
    error UnsupportedTransferBehavior();
    error NativeTransferFailed();

    constructor(
        address router_,
        bytes32 routerRuntimeHash_,
        address factory_,
        bytes32 factoryRuntimeHash_,
        bytes32 pairRuntimeHash_,
        address weth_,
        bytes32 wethRuntimeHash_,
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
            router_ == address(0) || factory_ == address(0) || weth_ == address(0) || treasury_ == address(0)
                || treasury_ == router_ || treasury_ == factory_ || treasury_ == weth_ || treasury_ == address(this)
                || routerRuntimeHash_ == bytes32(0) || factoryRuntimeHash_ == bytes32(0)
                || pairRuntimeHash_ == bytes32(0) || wethRuntimeHash_ == bytes32(0)
        ) revert InvalidConfiguration();
        if (
            policyIdHash_ != POLICY_ID_HASH || policyVersion_ != POLICY_VERSION || policyHash_ == bytes32(0)
                || policyFeeBps_ != FEE_BPS || policyFromBlock_ == 0
                || (policyBeforeBlock_ != 0 && policyBeforeBlock_ <= policyFromBlock_)
        ) revert InvalidPolicy();
        router = router_;
        routerRuntimeHash = routerRuntimeHash_;
        factory = factory_;
        factoryRuntimeHash = factoryRuntimeHash_;
        pairRuntimeHash = pairRuntimeHash_;
        weth = weth_;
        wethRuntimeHash = wethRuntimeHash_;
        treasury = treasury_;
        policyHash = policyHash_;
        policyFromBlock = policyFromBlock_;
        policyBeforeBlock = policyBeforeBlock_;
        _assertRuntimeIdentity();
    }

    receive() external payable {
        if (msg.sender != router) revert NativeTransferFailed();
    }

    function calculateFee(uint256 userGrossInput) public pure returns (uint256) {
        if (userGrossInput == 0) revert InvalidAuthorization();
        return userGrossInput * FEE_BPS / BPS_DENOMINATOR;
    }

    function routeIdentity(Route calldata route) public pure returns (bytes32) {
        return keccak256(abi.encode(ROUTE_DOMAIN, route.kind, route.tokenIn, route.tokenOut, route.pair0, route.pair1));
    }

    function currentPolicyBlock() public view returns (uint256) {
        try IRMTArbSysUniswapV2(ARBSYS).arbBlockNumber() returns (uint256 currentBlock) {
            if (currentBlock == 0) revert RuntimeIdentityChanged();
            return currentBlock;
        } catch {
            revert RuntimeIdentityChanged();
        }
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
        uint256 inputBalanceBefore = 0;
        if (!nativeInput) {
            inputBalanceBefore = _pullExact(route.tokenIn, authorization.userGrossInput);
            _approveExact(route.tokenIn, authorization.providerInput);
        }

        address[] memory path = _path(route);
        if (nativeOutput) {
            uint256 beforeNativeOutput = address(this).balance;
            uint256[] memory amounts = IRMTUniswapV2RouterV2(router)
                .swapExactTokensForETH(
                    authorization.providerInput,
                    authorization.protectedOutput,
                    path,
                    address(this),
                    authorization.deadline
                );
            _clearApproval(route.tokenIn);
            actualProviderOutput = _exactRouterOutput(amounts, path.length, authorization.providerInput);
            if (address(this).balance - beforeNativeOutput != actualProviderOutput) {
                revert UnsupportedTransferBehavior();
            }
            _sendNative(authorization.trader, actualProviderOutput);
        } else {
            uint256 traderOutputBefore = IERC20(route.tokenOut).balanceOf(authorization.trader);
            uint256[] memory amounts;
            if (nativeInput) {
                amounts = IRMTUniswapV2RouterV2(router).swapExactETHForTokens{value: authorization.providerInput}(
                    authorization.protectedOutput, path, authorization.trader, authorization.deadline
                );
            } else {
                amounts = IRMTUniswapV2RouterV2(router)
                    .swapExactTokensForTokens(
                        authorization.providerInput,
                        authorization.protectedOutput,
                        path,
                        authorization.trader,
                        authorization.deadline
                    );
                _clearApproval(route.tokenIn);
            }
            actualProviderOutput = _exactRouterOutput(amounts, path.length, authorization.providerInput);
            uint256 traderOutputAfter = IERC20(route.tokenOut).balanceOf(authorization.trader);
            if (
                traderOutputAfter < traderOutputBefore || traderOutputAfter - traderOutputBefore != actualProviderOutput
            ) {
                revert UnsupportedTransferBehavior();
            }
        }
        if (actualProviderOutput < authorization.protectedOutput) revert UnsupportedTransferBehavior();

        if (nativeInput) {
            if (actualRmtFee != 0) _sendNative(treasury, actualRmtFee);
        } else {
            _transferExact(route.tokenIn, treasury, actualRmtFee);
            if (IERC20(route.tokenIn).balanceOf(address(this)) != inputBalanceBefore) {
                revert UnsupportedTransferBehavior();
            }
            if (IERC20(route.tokenIn).allowance(address(this), router) != 0) revert UnsupportedTransferBehavior();
        }
        if (address(this).balance != nativeBalanceBefore) revert UnsupportedTransferBehavior();

        emit RMTUniswapV2FeeSettledV2(
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
                route.tokenIn != weth || authorization.feeAsset != address(0)
                    || msg.value != authorization.userGrossInput
            ) revert InvalidAuthorization();
        } else if (
            msg.value != 0 || authorization.requestedInputAsset != route.tokenIn
                || authorization.feeAsset != authorization.requestedInputAsset || route.tokenIn.code.length == 0
        ) {
            revert InvalidAuthorization();
        }
        if (nativeOutput) {
            if (route.tokenOut != weth) revert InvalidAuthorization();
        } else if (authorization.requestedOutputAsset != route.tokenOut || route.tokenOut.code.length == 0) {
            revert InvalidAuthorization();
        }
        if (authorization.requestedInputAsset == authorization.requestedOutputAsset) revert InvalidAuthorization();
        _validateRoute(route);
    }

    function _validateRoute(Route calldata route) private view {
        if (
            route.tokenIn == address(0) || route.tokenOut == address(0) || route.tokenIn == route.tokenOut
                || route.tokenIn.code.length == 0 || route.tokenOut.code.length == 0
                || (route.kind != RouteKind.DIRECT && route.kind != RouteKind.WETH_HOP)
                || (route.kind == RouteKind.WETH_HOP && (route.tokenIn == weth || route.tokenOut == weth))
        ) revert InvalidRoute();
        _validatePair(route.pair0, route.tokenIn, route.kind == RouteKind.DIRECT ? route.tokenOut : weth);
        if (route.kind == RouteKind.DIRECT) {
            if (route.pair1 != address(0)) revert InvalidRoute();
            return;
        }
        _validatePair(route.pair1, weth, route.tokenOut);
    }

    function _validatePair(address pair, address tokenA, address tokenB) private view {
        if (
            pair == address(0) || pair.code.length == 0 || pair.codehash != pairRuntimeHash
                || IRMTUniswapV2FactoryV2(factory).getPair(tokenA, tokenB) != pair
                || IRMTUniswapV2PairV2(pair).factory() != factory
        ) revert InvalidPair();
        address token0 = IRMTUniswapV2PairV2(pair).token0();
        address token1 = IRMTUniswapV2PairV2(pair).token1();
        if (!((token0 == tokenA && token1 == tokenB) || (token0 == tokenB && token1 == tokenA))) revert InvalidPair();
    }

    function _path(Route calldata route) private view returns (address[] memory path) {
        if (route.kind == RouteKind.DIRECT) {
            path = new address[](2);
            path[0] = route.tokenIn;
            path[1] = route.tokenOut;
        } else {
            path = new address[](3);
            path[0] = route.tokenIn;
            path[1] = weth;
            path[2] = route.tokenOut;
        }
    }

    function _exactRouterOutput(uint256[] memory amounts, uint256 expectedLength, uint256 providerInput)
        private
        pure
        returns (uint256 output)
    {
        if (amounts.length != expectedLength || amounts[0] != providerInput) revert UnsupportedTransferBehavior();
        output = amounts[amounts.length - 1];
    }

    // slither-disable-start reentrancy-balance
    function _pullExact(address token, uint256 amount) private returns (uint256 balanceBefore) {
        IERC20 asset = IERC20(token);
        if (asset.allowance(msg.sender, address(this)) != amount) revert UnsupportedTransferBehavior();
        balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.allowance(msg.sender, address(this)) != 0) revert UnsupportedTransferBehavior();
        uint256 afterBalance = asset.balanceOf(address(this));
        if (afterBalance < balanceBefore || afterBalance - balanceBefore != amount) {
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
        uint256 beforeBalance = recipient.balance;
        // slither-disable-next-line arbitrary-send-eth,low-level-calls
        (bool success,) = recipient.call{value: amount}("");
        if (!success || recipient.balance < beforeBalance || recipient.balance - beforeBalance != amount) {
            revert NativeTransferFailed();
        }
    }

    function _assertRuntimeIdentity() private view {
        if (
            router.code.length == 0 || factory.code.length == 0 || weth.code.length == 0
                || router.codehash != routerRuntimeHash || factory.codehash != factoryRuntimeHash
                || weth.codehash != wethRuntimeHash || IRMTUniswapV2RouterV2(router).factory() != factory
                || IRMTUniswapV2RouterV2(router).WETH() != weth
        ) revert RuntimeIdentityChanged();
    }
}
