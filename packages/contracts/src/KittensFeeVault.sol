// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IKittensFeeVault} from "./interfaces/IKittensFeeVault.sol";

/// @title KittensFeeVault
/// @notice Accounts the KITTENS experiment's native-CASHCAT hook fees into immutable economic lanes.
/// @dev The vault cannot swap, mint, change recipients, sweep arbitrary balances, or move burn/liquidity reserves
///      except to one-time-bound executor contracts. Extra or forced native currency is deliberately unaccounted.
contract KittensFeeVault is IKittensFeeVault {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant BURN_BPS = 7_000;
    uint16 public constant PAYMASTER_BPS = 1_000;
    uint16 public constant LIQUIDITY_BPS = 1_000;
    uint16 public constant OPERATIONS_BPS = 1_000;

    address public immutable configurator;
    address payable public immutable paymasterTreasury;
    address payable public immutable operationsTreasury;

    address public hook;
    address payable public burnExecutor;
    address payable public liquidityExecutor;
    bool public bindingsFinalized;
    bool private _entered;

    uint256 public burnReserve;
    uint256 public paymasterReserve;
    uint256 public liquidityReserve;
    uint256 public operationsReserve;
    uint256 public totalCredited;
    uint256 public totalReleased;

    event HookBound(address indexed hook);
    event BurnExecutorBound(address indexed executor);
    event LiquidityExecutorBound(address indexed executor);
    event BindingsFinalized(address indexed hook, address indexed burnExecutor, address indexed liquidityExecutor);
    event FeeCredited(
        uint256 amount,
        uint256 burnAmount,
        uint256 paymasterAmount,
        uint256 liquidityAmount,
        uint256 operationsAmount
    );
    event BurnBudgetWithdrawn(address indexed executor, uint256 amount);
    event LiquidityBudgetWithdrawn(address indexed executor, uint256 amount);
    event PaymasterReleased(address indexed recipient, uint256 amount);
    event OperationsReleased(address indexed recipient, uint256 amount);

    error OnlyConfigurator();
    error OnlyHook();
    error OnlyBurnExecutor();
    error OnlyLiquidityExecutor();
    error InvalidConfiguration();
    error BindingAlreadySet();
    error BindingsAlreadyFinalized();
    error BindingsNotFinalized();
    error InvalidAmount();
    error InsufficientBacking();
    error NothingToRelease();
    error TransferFailed();
    error ReentrantCall();

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address payable paymasterTreasury_, address payable operationsTreasury_) {
        if (paymasterTreasury_ == address(0) || operationsTreasury_ == address(0)) revert InvalidConfiguration();
        configurator = msg.sender;
        paymasterTreasury = paymasterTreasury_;
        operationsTreasury = operationsTreasury_;
    }

    receive() external payable {}

    function bindHook(address hook_) external {
        if (msg.sender != configurator) revert OnlyConfigurator();
        if (bindingsFinalized) revert BindingsAlreadyFinalized();
        if (hook != address(0)) revert BindingAlreadySet();
        if (hook_ == address(0) || hook_.code.length == 0) revert InvalidConfiguration();
        hook = hook_;
        emit HookBound(hook_);
    }

    function bindBurnExecutor(address payable executor) external {
        if (msg.sender != configurator) revert OnlyConfigurator();
        if (bindingsFinalized) revert BindingsAlreadyFinalized();
        if (burnExecutor != address(0)) revert BindingAlreadySet();
        if (executor == address(0) || executor.code.length == 0) revert InvalidConfiguration();
        burnExecutor = executor;
        emit BurnExecutorBound(executor);
    }

    function bindLiquidityExecutor(address payable executor) external {
        if (msg.sender != configurator) revert OnlyConfigurator();
        if (bindingsFinalized) revert BindingsAlreadyFinalized();
        if (liquidityExecutor != address(0)) revert BindingAlreadySet();
        if (executor == address(0) || executor.code.length == 0) revert InvalidConfiguration();
        liquidityExecutor = executor;
        emit LiquidityExecutorBound(executor);
    }

    /// @notice Permanently freezes the hook and executor topology.
    function finalizeBindings() external {
        if (msg.sender != configurator) revert OnlyConfigurator();
        if (bindingsFinalized) revert BindingsAlreadyFinalized();
        if (hook == address(0) || burnExecutor == address(0) || liquidityExecutor == address(0)) {
            revert InvalidConfiguration();
        }
        bindingsFinalized = true;
        emit BindingsFinalized(hook, burnExecutor, liquidityExecutor);
    }

    /// @inheritdoc IKittensFeeVault
    function creditFee(uint256 amount) external {
        if (msg.sender != hook) revert OnlyHook();
        if (!bindingsFinalized) revert BindingsNotFinalized();
        if (amount == 0) revert InvalidAmount();

        uint256 outstandingBefore = totalOutstanding();
        if (address(this).balance < outstandingBefore + amount) revert InsufficientBacking();

        uint256 paymasterAmount = amount * PAYMASTER_BPS / BPS_DENOMINATOR;
        uint256 liquidityAmount = amount * LIQUIDITY_BPS / BPS_DENOMINATOR;
        uint256 operationsAmount = amount * OPERATIONS_BPS / BPS_DENOMINATOR;
        // Give the burn lane all integer-division dust so every credited wei has exactly one destination.
        uint256 burnAmount = amount - paymasterAmount - liquidityAmount - operationsAmount;

        burnReserve += burnAmount;
        paymasterReserve += paymasterAmount;
        liquidityReserve += liquidityAmount;
        operationsReserve += operationsAmount;
        totalCredited += amount;

        emit FeeCredited(amount, burnAmount, paymasterAmount, liquidityAmount, operationsAmount);
    }

    /// @notice Transfers accrued buyback/burn fuel only to the immutable burn executor.
    function withdrawBurnBudget(uint256 maxAmount) external nonReentrant returns (uint256 amount) {
        if (msg.sender != burnExecutor) revert OnlyBurnExecutor();
        amount = _boundedAmount(burnReserve, maxAmount);
        burnReserve -= amount;
        totalReleased += amount;
        _send(payable(msg.sender), amount);
        emit BurnBudgetWithdrawn(msg.sender, amount);
    }

    /// @notice Transfers accrued liquidity-compounding fuel only to the immutable liquidity executor.
    function withdrawLiquidityBudget(uint256 maxAmount) external nonReentrant returns (uint256 amount) {
        if (msg.sender != liquidityExecutor) revert OnlyLiquidityExecutor();
        amount = _boundedAmount(liquidityReserve, maxAmount);
        liquidityReserve -= amount;
        totalReleased += amount;
        _send(payable(msg.sender), amount);
        emit LiquidityBudgetWithdrawn(msg.sender, amount);
    }

    /// @notice Permissionlessly forwards accrued paymaster funding to its immutable recipient.
    function releasePaymaster(uint256 maxAmount) external nonReentrant returns (uint256 amount) {
        amount = _boundedAmount(paymasterReserve, maxAmount);
        paymasterReserve -= amount;
        totalReleased += amount;
        _send(paymasterTreasury, amount);
        emit PaymasterReleased(paymasterTreasury, amount);
    }

    /// @notice Permissionlessly forwards accrued operations/security funding to its immutable recipient.
    function releaseOperations(uint256 maxAmount) external nonReentrant returns (uint256 amount) {
        amount = _boundedAmount(operationsReserve, maxAmount);
        operationsReserve -= amount;
        totalReleased += amount;
        _send(operationsTreasury, amount);
        emit OperationsReleased(operationsTreasury, amount);
    }

    function totalOutstanding() public view returns (uint256) {
        return burnReserve + paymasterReserve + liquidityReserve + operationsReserve;
    }

    /// @notice Native currency that was not authenticated and credited by the bound hook.
    /// @dev There is intentionally no privileged sweep path for this balance.
    function unaccountedBalance() external view returns (uint256) {
        uint256 outstanding = totalOutstanding();
        uint256 balance = address(this).balance;
        return balance > outstanding ? balance - outstanding : 0;
    }

    function _boundedAmount(uint256 available, uint256 maxAmount) private pure returns (uint256 amount) {
        if (maxAmount == 0) revert InvalidAmount();
        amount = maxAmount < available ? maxAmount : available;
        if (amount == 0) revert NothingToRelease();
    }

    function _send(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
