// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @notice Ownerless atomic RMT_EXECUTION_V2 settlement primitive for one exact Uniswap V4 PoolKey.
/// @dev This contract is intentionally not wired to the public provider registry. It has no owner, upgrade,
///      rescue, arbitrary target, arbitrary calldata, arbitrary callback, or non-empty hookData surface.
contract RMTUniswapV4FeeExecutorV2 is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using BalanceDeltaLibrary for BalanceDelta;
    using PoolIdLibrary for PoolKey;

    uint256 public constant CHAIN_ID = 4_663;
    uint16 public constant FEE_BPS = 25;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    bytes32 public constant POLICY_ID_HASH = keccak256("RMT_EXECUTION_V2");
    uint256 public constant POLICY_VERSION = 2;
    bytes32 public constant PROVIDER_ID = keccak256("RMT_UNISWAP_V4_POOL_MANAGER_V2");
    bytes32 public constant EMPTY_HOOK_DATA_HASH = keccak256("");
    bytes32 private constant REQUEST_DOMAIN = keccak256("RMT_UNISWAP_V4_REQUEST_V2");

    enum FeeSide {
        INPUT
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
        address recipient;
        address requestedInputAsset;
        address requestedOutputAsset;
        uint256 userGrossInput;
        uint256 expectedFeeAtomic;
        uint256 maximumFeeAtomic;
        uint256 providerInput;
        uint256 expectedProviderOutput;
        uint256 protectedOutput;
        uint256 deadline;
        bytes32 poolId;
        bytes32 hookDataHash;
        bytes32 requestIdentity;
    }

    struct CallbackData {
        bytes32 executionId;
        PoolKey poolKey;
        address inputAsset;
        address outputAsset;
        uint256 providerInput;
        uint256 protectedOutput;
    }

    IPoolManager public immutable poolManager;
    address public immutable treasury;
    bytes32 public immutable poolManagerRuntimeHash;
    bytes32 public immutable policyHash;
    uint256 public immutable policyFromBlock;
    uint256 public immutable policyBeforeBlock;

    mapping(bytes32 executionId => bool consumed) public executionConsumed;
    bytes32 private activeCallbackHash;

    event RMTUniswapV4FeeSettledV2(
        bytes32 indexed executionId,
        bytes32 indexed policyHash,
        address indexed trader,
        bytes32 policyIdHash,
        uint256 policyVersion,
        bytes32 providerId,
        address poolManager,
        bytes32 poolId,
        address recipient,
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
    error InvalidPoolKey();
    error PoolIdMismatch();
    error RuntimeIdentityChanged();
    error ExecutionAlreadyConsumed();
    error UnsupportedHookData();
    error UnsupportedTransferBehavior();
    error InvalidCallback();
    error UnsafeOutput(uint256 actual, uint256 minimum);
    error NativeTransferFailed();

    constructor(
        address poolManager_,
        bytes32 poolManagerRuntimeHash_,
        address treasury_,
        bytes32 policyIdHash_,
        uint256 policyVersion_,
        bytes32 policyHash_,
        uint16 feeBps_,
        uint256 policyFromBlock_,
        uint256 policyBeforeBlock_
    ) {
        if (block.chainid != CHAIN_ID) revert InvalidConfiguration();
        if (
            poolManager_ == address(0) || poolManagerRuntimeHash_ == bytes32(0)
                || poolManager_.codehash != poolManagerRuntimeHash_ || treasury_ == address(0)
                || treasury_ == poolManager_ || treasury_ == address(this) || policyHash_ == bytes32(0)
                || (policyBeforeBlock_ != 0 && policyBeforeBlock_ <= policyFromBlock_)
        ) revert InvalidConfiguration();
        if (
            policyIdHash_ != POLICY_ID_HASH || policyVersion_ != POLICY_VERSION || feeBps_ != FEE_BPS
                || policyFromBlock_ == 0
        ) {
            revert InvalidPolicy();
        }
        poolManager = IPoolManager(poolManager_);
        poolManagerRuntimeHash = poolManagerRuntimeHash_;
        treasury = treasury_;
        policyHash = policyHash_;
        policyFromBlock = policyFromBlock_;
        policyBeforeBlock = policyBeforeBlock_;
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert InvalidCallback();
    }

    function calculateFee(uint256 grossInput) public pure returns (uint256) {
        return grossInput * FEE_BPS / BPS_DENOMINATOR;
    }

    function derivePoolId(PoolKey calldata poolKey) external pure returns (bytes32) {
        PoolKey memory key = poolKey;
        return PoolId.unwrap(key.toId());
    }

    function deriveRequestIdentity(FeeAuthorization calldata authorization, PoolKey calldata poolKey)
        external
        pure
        returns (bytes32)
    {
        return _requestIdentity(authorization, poolKey);
    }

    // Exact before/after balance checks intentionally span token and PoolManager calls. The
    // nonReentrant entry guard plus the PoolManager-only, exact-hash callback gate make these
    // observations fail-closed rather than reentrant authority.
    // slither-disable-start reentrancy-balance
    function execute(FeeAuthorization calldata authorization, PoolKey calldata poolKey)
        external
        payable
        nonReentrant
        returns (uint256 actualProviderOutput, uint256 actualRmtFee)
    {
        _assertRuntimeAndPolicy();
        _assertAuthorization(authorization, poolKey);

        if (executionConsumed[authorization.executionId]) revert ExecutionAlreadyConsumed();
        executionConsumed[authorization.executionId] = true;
        actualRmtFee = calculateFee(authorization.userGrossInput);

        uint256 inputBalanceBefore;
        if (authorization.requestedInputAsset == address(0)) {
            if (msg.value != authorization.userGrossInput) revert UnsupportedTransferBehavior();
            inputBalanceBefore = address(this).balance - msg.value;
        } else {
            if (msg.value != 0) revert UnsupportedTransferBehavior();
            IERC20 inputToken = IERC20(authorization.requestedInputAsset);
            if (inputToken.allowance(msg.sender, address(this)) != authorization.userGrossInput) {
                revert UnsupportedTransferBehavior();
            }
            inputBalanceBefore = inputToken.balanceOf(address(this));
            inputToken.safeTransferFrom(msg.sender, address(this), authorization.userGrossInput);
            if (inputToken.balanceOf(address(this)) - inputBalanceBefore != authorization.userGrossInput) {
                revert UnsupportedTransferBehavior();
            }
        }

        uint256 outputBalanceBefore = _balanceOf(authorization.requestedOutputAsset, address(this));
        CallbackData memory callbackData = CallbackData({
            executionId: authorization.executionId,
            poolKey: poolKey,
            inputAsset: authorization.requestedInputAsset,
            outputAsset: authorization.requestedOutputAsset,
            providerInput: authorization.providerInput,
            protectedOutput: authorization.protectedOutput
        });
        bytes memory encodedCallback = abi.encode(callbackData);
        activeCallbackHash = keccak256(encodedCallback);
        bytes memory result = poolManager.unlock(encodedCallback);
        if (activeCallbackHash != bytes32(0)) revert InvalidCallback();
        actualProviderOutput = abi.decode(result, (uint256));
        if (actualProviderOutput < authorization.protectedOutput) {
            revert UnsafeOutput(actualProviderOutput, authorization.protectedOutput);
        }
        if (_balanceOf(authorization.requestedOutputAsset, address(this)) - outputBalanceBefore != actualProviderOutput)
        {
            revert UnsupportedTransferBehavior();
        }

        _transferExact(authorization.requestedOutputAsset, authorization.recipient, actualProviderOutput);
        _transferExact(authorization.requestedInputAsset, treasury, actualRmtFee);
        _assertExecutionBalancesRestored(authorization, inputBalanceBefore, outputBalanceBefore);

        emit RMTUniswapV4FeeSettledV2(
            authorization.executionId,
            authorization.policyHash,
            authorization.trader,
            authorization.policyIdHash,
            authorization.policyVersion,
            PROVIDER_ID,
            address(poolManager),
            authorization.poolId,
            authorization.recipient,
            authorization.requestedInputAsset,
            authorization.requestedOutputAsset,
            authorization.feeAsset,
            authorization.feeBps,
            authorization.feeSide,
            authorization.userGrossInput,
            authorization.providerInput,
            actualProviderOutput,
            actualRmtFee,
            authorization.treasury
        );
    }
    // slither-disable-end reentrancy-balance

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || activeCallbackHash == bytes32(0)) revert InvalidCallback();
        if (keccak256(data) != activeCallbackHash) revert InvalidCallback();
        activeCallbackHash = bytes32(0);

        CallbackData memory callbackData = abi.decode(data, (CallbackData));
        bool zeroForOne = Currency.unwrap(callbackData.poolKey.currency0) == callbackData.inputAsset;
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(callbackData.providerInput),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        BalanceDelta delta = poolManager.swap(callbackData.poolKey, params, "");
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta != -int128(int256(callbackData.providerInput)) || outputDelta <= 0) {
            revert UnsupportedTransferBehavior();
        }
        uint256 outputAmount = uint256(uint128(outputDelta));
        if (outputAmount < callbackData.protectedOutput) {
            revert UnsafeOutput(outputAmount, callbackData.protectedOutput);
        }

        Currency inputCurrency = zeroForOne ? callbackData.poolKey.currency0 : callbackData.poolKey.currency1;
        Currency outputCurrency = zeroForOne ? callbackData.poolKey.currency1 : callbackData.poolKey.currency0;
        _settle(inputCurrency, callbackData.providerInput);
        poolManager.take(outputCurrency, address(this), outputAmount);
        return abi.encode(outputAmount);
    }

    function _assertRuntimeAndPolicy() private view {
        if (block.chainid != CHAIN_ID || address(poolManager).codehash != poolManagerRuntimeHash) {
            revert RuntimeIdentityChanged();
        }
        uint256 currentBlock = block.number;
        if (currentBlock < policyFromBlock || (policyBeforeBlock != 0 && currentBlock >= policyBeforeBlock)) {
            revert PolicyInactive();
        }
    }

    function _assertAuthorization(FeeAuthorization calldata authorization, PoolKey calldata poolKey) private view {
        if (
            msg.sender != authorization.trader || authorization.executionId == bytes32(0)
                || authorization.policyIdHash != POLICY_ID_HASH || authorization.policyVersion != POLICY_VERSION
                || authorization.policyHash != policyHash || authorization.feeBps != FEE_BPS
                || authorization.feeSide != FeeSide.INPUT || authorization.feeAsset != authorization.requestedInputAsset
                || authorization.treasury != treasury || authorization.recipient == address(0)
                || authorization.recipient == address(this) || authorization.recipient == address(poolManager)
                || authorization.recipient == treasury
                || authorization.requestedInputAsset == authorization.requestedOutputAsset
                || authorization.userGrossInput == 0 || authorization.providerInput == 0
                || authorization.providerInput > uint256(uint128(type(int128).max))
                || authorization.expectedProviderOutput == 0 || authorization.protectedOutput == 0
                || authorization.protectedOutput > authorization.expectedProviderOutput
                || authorization.deadline < block.timestamp
                || authorization.deadline > block.timestamp + MAX_DEADLINE_WINDOW
                || authorization.hookDataHash != EMPTY_HOOK_DATA_HASH
                || authorization.requestIdentity != _requestIdentity(authorization, poolKey)
        ) revert InvalidAuthorization();

        uint256 fee = calculateFee(authorization.userGrossInput);
        if (
            authorization.expectedFeeAtomic != fee || authorization.maximumFeeAtomic != fee
                || authorization.providerInput != authorization.userGrossInput - fee
        ) revert InvalidAuthorization();

        address currency0 = Currency.unwrap(poolKey.currency0);
        address currency1 = Currency.unwrap(poolKey.currency1);
        if (
            currency0 >= currency1 || currency1 == address(0) || address(poolKey.hooks) == address(this)
                || (authorization.requestedInputAsset != currency0 && authorization.requestedInputAsset != currency1)
                || (authorization.requestedOutputAsset != currency0 && authorization.requestedOutputAsset != currency1)
        ) revert InvalidPoolKey();
        PoolKey memory key = poolKey;
        if (authorization.poolId != PoolId.unwrap(key.toId())) revert PoolIdMismatch();
    }

    function _requestIdentity(FeeAuthorization calldata authorization, PoolKey calldata poolKey)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                REQUEST_DOMAIN,
                authorization.executionId,
                authorization.policyIdHash,
                authorization.policyVersion,
                authorization.policyHash,
                authorization.feeBps,
                authorization.feeSide,
                authorization.feeAsset,
                authorization.treasury,
                authorization.trader,
                authorization.recipient,
                authorization.requestedInputAsset,
                authorization.requestedOutputAsset,
                authorization.userGrossInput,
                authorization.expectedFeeAtomic,
                authorization.maximumFeeAtomic,
                authorization.providerInput,
                authorization.expectedProviderOutput,
                authorization.protectedOutput,
                authorization.deadline,
                authorization.poolId,
                authorization.hookDataHash,
                poolKey.currency0,
                poolKey.currency1,
                poolKey.fee,
                poolKey.tickSpacing,
                poolKey.hooks
            )
        );
    }

    function _settle(Currency currency, uint256 amount) private {
        if (currency.isAddressZero()) {
            poolManager.sync(currency);
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    // Recipient balance deltas are an exact-transfer invariant. Any recipient-side mutation
    // makes the enclosing nonReentrant execution revert atomically.
    // slither-disable-start reentrancy-balance
    function _transferExact(address asset, address recipient, uint256 amount) private {
        if (amount == 0) return;
        uint256 beforeBalance = _balanceOf(asset, recipient);
        if (asset == address(0)) {
            // slither-disable-next-line arbitrary-send-eth,low-level-calls -- recipient is exact authorization-bound input.
            (bool success,) = payable(recipient).call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
        if (_balanceOf(asset, recipient) - beforeBalance != amount) revert UnsupportedTransferBehavior();
    }
    // slither-disable-end reentrancy-balance

    function _assertExecutionBalancesRestored(
        FeeAuthorization calldata authorization,
        uint256 inputBalanceBefore,
        uint256 outputBalanceBefore
    ) private view {
        if (_balanceOf(authorization.requestedInputAsset, address(this)) != inputBalanceBefore) {
            revert UnsupportedTransferBehavior();
        }
        if (_balanceOf(authorization.requestedOutputAsset, address(this)) != outputBalanceBefore) {
            revert UnsupportedTransferBehavior();
        }
    }

    function _balanceOf(address asset, address account) private view returns (uint256) {
        return asset == address(0) ? account.balance : IERC20(asset).balanceOf(account);
    }
}
