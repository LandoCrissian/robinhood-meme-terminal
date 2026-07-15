// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationAdapter} from "../interfaces/IGraduationAdapter.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

interface IERC20V6MarketToken {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

interface INativeFeeSplitterV6 {
    function deposit() external payable;
}

/// @notice V6 bonding-curve market with launch-policy-defined Fair Start settings.
/// @dev Every setting is fixed during initialization and remains unchanged for the life of the market.
contract CloneBondingCurveMarketV6 {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MAX_GRADUATION_PRICE_DIFFERENCE_BPS = 50;
    uint256 private constant MINIMUM_MIGRATION_INVENTORY_BPS = 100;
    uint256 private constant REFUND_GAS_STIPEND = 30_000;

    IERC20V6MarketToken public token;
    address payable public feeSplitter;
    IGraduationAdapter public graduationAdapter;
    bytes32 public graduationPoolId;
    bytes32 public policyId;
    uint32 public policyVersion;
    uint16 public feeBps;
    uint256 public graduationTarget;
    uint256 public curveInvariantK;

    bool public fairStartEnabled;
    uint64 public fairStartDelayBlocks;
    uint64 public fairStartDurationBlocks;
    uint16 public fairStartMaxTxBps;
    uint16 public fairStartMaxWalletBps;

    uint256 public virtualEthReserve;
    uint256 public virtualTokenReserve;
    uint256 public realEthReserve;
    uint256 public trackedTokenInventory;
    uint256 public totalPendingRefunds;
    uint256 public retainedEthSurplus;
    uint256 public retainedTokenSurplus;
    uint64 public tradingOpensAtBlock;
    uint64 public fairStartEndsAtBlock;
    mapping(address wallet => uint256 tokenAmount) public fairStartPurchased;
    mapping(address wallet => uint256 blockNumber) public lastFairStartBuyBlock;
    mapping(address payer => uint256 amount) public pendingRefunds;

    bool public graduated;
    bool public liquidityMigrated;
    bool private _initialized;
    bool private _entered;

    event FairStartConfigured(
        bool enabled,
        uint256 tradingOpensAtBlock,
        uint256 fairStartEndsAtBlock,
        uint256 maximumTokensPerTransaction,
        uint256 maximumTokensPerWallet
    );
    event Trade(
        address indexed trader,
        address indexed recipient,
        bool indexed isBuy,
        uint256 tokenAmount,
        uint256 ethAmount,
        uint256 feeAmount,
        uint256 virtualEthReserve,
        uint256 virtualTokenReserve,
        uint256 realEthReserve
    );
    event Graduated(uint256 realEthReserve, uint256 tokenInventory);
    event LiquidityMigrated(address indexed adapter, address indexed pool, uint256 ethAmount, uint256 tokenAmount, uint256 liquidity);
    event ExcessPaymentRefunded(address indexed payer, uint256 amount);
    event ExcessPaymentRefundDeferred(address indexed payer, uint256 amount);
    event PendingRefundClaimed(address indexed payer, address indexed recipient, uint256 amount);
    event MigrationSurplusRetained(uint256 ethAmount, uint256 tokenAmount, uint256 pendingRefundAmount);

    error AlreadyInitialized();
    error ZeroAddress();
    error InvalidConfiguration();
    error MarketGraduated();
    error TradingNotOpen();
    error FairStartRecipientMismatch();
    error FairStartTransactionLimit();
    error FairStartWalletLimit();
    error FairStartBlockLimit();
    error DeadlineExpired();
    error ZeroInput();
    error SlippageExceeded();
    error InsufficientInventory();
    error InsufficientRealReserve();
    error TokenTransferFailed();
    error EthTransferFailed();
    error ReentrantCall();
    error NotGraduated();
    error AlreadyMigrated();
    error InvalidMigration();
    error NoPendingRefund();

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    modifier active() {
        if (graduated) revert MarketGraduated();
        _;
    }

    function initialize(
        address token_,
        address payable feeSplitter_,
        address graduationAdapter_,
        bytes32 graduationPoolId_,
        bytes32 policyId_,
        uint32 policyVersion_,
        uint16 feeBps_,
        uint256 virtualEthReserve_,
        uint256 virtualTokenReserve_,
        uint256 graduationTarget_,
        bool fairStartEnabled_,
        uint64 fairStartDelayBlocks_,
        uint64 fairStartDurationBlocks_,
        uint16 fairStartMaxTxBps_,
        uint16 fairStartMaxWalletBps_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (token_ == address(0) || feeSplitter_ == address(0) || graduationAdapter_ == address(0)) revert ZeroAddress();
        if (token_.code.length == 0 || feeSplitter_.code.length == 0 || graduationAdapter_.code.length == 0) {
            revert InvalidConfiguration();
        }
        if (graduationPoolId_ == bytes32(0) || policyId_ == bytes32(0) || policyVersion_ == 0) revert InvalidConfiguration();
        if (feeBps_ >= BPS_DENOMINATOR || virtualEthReserve_ == 0 || virtualTokenReserve_ == 0 || graduationTarget_ == 0) {
            revert InvalidConfiguration();
        }
        if (fairStartEnabled_) {
            if (
                fairStartDelayBlocks_ == 0 || fairStartDurationBlocks_ == 0 || fairStartMaxTxBps_ == 0
                    || fairStartMaxWalletBps_ < fairStartMaxTxBps_ || fairStartMaxWalletBps_ > BPS_DENOMINATOR
            ) revert InvalidConfiguration();
        } else if (
            fairStartDelayBlocks_ != 0 || fairStartDurationBlocks_ != 0 || fairStartMaxTxBps_ != 0
                || fairStartMaxWalletBps_ != 0
        ) revert InvalidConfiguration();

        _initialized = true;
        uint256 supply = IERC20V6MarketToken(token_).totalSupply();
        _validateGraduationConfiguration(
            supply,
            feeBps_,
            virtualEthReserve_,
            virtualTokenReserve_,
            graduationTarget_
        );

        token = IERC20V6MarketToken(token_);
        feeSplitter = feeSplitter_;
        graduationAdapter = IGraduationAdapter(graduationAdapter_);
        graduationPoolId = graduationPoolId_;
        policyId = policyId_;
        policyVersion = policyVersion_;
        feeBps = feeBps_;
        virtualEthReserve = virtualEthReserve_;
        virtualTokenReserve = virtualTokenReserve_;
        graduationTarget = graduationTarget_;
        curveInvariantK = virtualEthReserve_ * virtualTokenReserve_;

        fairStartEnabled = fairStartEnabled_;
        fairStartDelayBlocks = fairStartDelayBlocks_;
        fairStartDurationBlocks = fairStartDurationBlocks_;
        fairStartMaxTxBps = fairStartMaxTxBps_;
        fairStartMaxWalletBps = fairStartMaxWalletBps_;

        tradingOpensAtBlock = uint64(block.number + fairStartDelayBlocks_);
        fairStartEndsAtBlock = fairStartEnabled_ ? tradingOpensAtBlock + fairStartDurationBlocks_ : tradingOpensAtBlock;
        trackedTokenInventory = supply;
        emit FairStartConfigured(
            fairStartEnabled_,
            tradingOpensAtBlock,
            fairStartEndsAtBlock,
            fairStartEnabled_ ? (supply * fairStartMaxTxBps_) / BPS_DENOMINATOR : 0,
            fairStartEnabled_ ? (supply * fairStartMaxWalletBps_) / BPS_DENOMINATOR : 0
        );
    }

    receive() external payable { revert InvalidConfiguration(); }

    function fairStartActive() public view returns (bool) {
        return fairStartEnabled && block.number >= tradingOpensAtBlock && block.number < fairStartEndsAtBlock;
    }

    function quoteBuy(uint256 ethIn) public view returns (uint256 tokensOut, uint256 fee) {
        (tokensOut, fee,) = _quoteBuy(ethIn);
    }

    /// @notice Returns the executable buy quote, including any graduation-boundary refund.
    function quoteBuyExecution(uint256 ethIn)
        external
        view
        returns (uint256 tokensOut, uint256 acceptedEth, uint256 fee, uint256 refund)
    {
        (tokensOut, fee, acceptedEth) = _quoteBuy(ethIn);
        refund = ethIn - acceptedEth;
    }

    function _quoteBuy(uint256 ethIn) private view returns (uint256 tokensOut, uint256 fee, uint256 acceptedEth) {
        if (ethIn == 0 || realEthReserve >= graduationTarget) return (0, 0, 0);

        acceptedEth = ethIn;
        uint256 inputFee = _feeForGross(ethIn);
        uint256 remainingNetEth = graduationTarget - realEthReserve;
        if (ethIn - inputFee >= remainingNetEth) acceptedEth = _grossForExactNet(remainingNetEth);

        fee = _feeForGross(acceptedEth);
        uint256 netEth = acceptedEth - fee;
        uint256 nextVirtualEth = virtualEthReserve + netEth;
        uint256 nextVirtualToken = _ceilDiv(curveInvariantK, nextVirtualEth);
        if (nextVirtualToken >= virtualTokenReserve) return (0, fee, acceptedEth);
        tokensOut = virtualTokenReserve - nextVirtualToken;
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOut, uint256 fee, uint256 grossEth) {
        if (tokensIn == 0) return (0, 0, 0);
        uint256 nextVirtualToken = virtualTokenReserve + tokensIn;
        uint256 nextVirtualEth = _ceilDiv(curveInvariantK, nextVirtualToken);
        if (nextVirtualEth >= virtualEthReserve) return (0, 0, 0);
        grossEth = virtualEthReserve - nextVirtualEth;
        fee = _feeForGross(grossEth);
        ethOut = grossEth - fee;
    }

    function buy(address recipient, uint256 minimumTokensOut, uint256 deadline)
        external payable active nonReentrant returns (uint256 tokensOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (block.number < tradingOpensAtBlock) revert TradingNotOpen();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value == 0) revert ZeroInput();

        uint256 fee;
        uint256 acceptedEth;
        (tokensOut, fee, acceptedEth) = _quoteBuy(msg.value);
        if (tokensOut < minimumTokensOut || tokensOut == 0) revert SlippageExceeded();
        if (trackedTokenInventory < tokensOut || token.balanceOf(address(this)) < tokensOut) {
            revert InsufficientInventory();
        }
        if (fairStartActive()) _enforceFairStart(recipient, tokensOut);

        uint256 netEth = acceptedEth - fee;
        virtualEthReserve += netEth;
        virtualTokenReserve -= tokensOut;
        realEthReserve += netEth;
        trackedTokenInventory -= tokensOut;
        bool graduationReached = realEthReserve == graduationTarget;
        if (graduationReached) graduated = true;

        if (!token.transfer(recipient, tokensOut)) revert TokenTransferFailed();
        _depositFee(fee);
        _refundOrDefer(msg.sender, msg.value - acceptedEth);
        emit Trade(
            msg.sender,
            recipient,
            true,
            tokensOut,
            acceptedEth,
            fee,
            virtualEthReserve,
            virtualTokenReserve,
            realEthReserve
        );
        if (graduationReached) emit Graduated(realEthReserve, trackedTokenInventory);
    }

    function sell(uint256 tokensIn, uint256 minimumEthOut, address payable recipient, uint256 deadline)
        external active nonReentrant returns (uint256 ethOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (block.number < tradingOpensAtBlock) revert TradingNotOpen();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (tokensIn == 0) revert ZeroInput();

        uint256 fee;
        uint256 grossEth;
        (ethOut, fee, grossEth) = quoteSell(tokensIn);
        if (ethOut < minimumEthOut || ethOut == 0) revert SlippageExceeded();
        if (grossEth > realEthReserve) revert InsufficientRealReserve();

        virtualTokenReserve += tokensIn;
        virtualEthReserve -= grossEth;
        realEthReserve -= grossEth;
        trackedTokenInventory += tokensIn;
        if (!token.transferFrom(msg.sender, address(this), tokensIn)) revert TokenTransferFailed();
        _depositFee(fee);
        _sendEth(recipient, ethOut);
        emit Trade(msg.sender, recipient, false, tokensIn, grossEth, fee, virtualEthReserve, virtualTokenReserve, realEthReserve);
    }

    function progressBps() external view returns (uint256) {
        if (graduated || realEthReserve >= graduationTarget) return BPS_DENOMINATOR;
        return (realEthReserve * BPS_DENOMINATOR) / graduationTarget;
    }

    /// @notice Claims a refund that could not be delivered during the buy.
    /// @dev The payer controls the claim and may route it to a different payable recipient.
    function claimPendingRefund(address payable recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert ZeroAddress();
        amount = pendingRefunds[msg.sender];
        if (amount == 0) revert NoPendingRefund();

        pendingRefunds[msg.sender] = 0;
        totalPendingRefunds -= amount;
        _sendEth(recipient, amount);
        emit PendingRefundClaimed(msg.sender, recipient, amount);
    }

    function migrateLiquidity() external nonReentrant returns (address pool, uint256 liquidity) {
        if (!graduated) revert NotGraduated();
        if (liquidityMigrated) revert AlreadyMigrated();
        uint256 trackedEthReserve = realEthReserve;
        uint256 marketBalance = address(this).balance;
        if (marketBalance < totalPendingRefunds) revert InvalidMigration();
        uint256 availableEth = marketBalance - totalPendingRefunds;
        uint256 marketTokenBalance = token.balanceOf(address(this));
        uint256 tokenAmount = trackedTokenInventory;
        if (
            trackedEthReserve == 0 || availableEth < trackedEthReserve || tokenAmount == 0
                || marketTokenBalance < tokenAmount
        ) revert InvalidMigration();

        uint256 ethSurplus = availableEth - trackedEthReserve;
        uint256 tokenSurplus = marketTokenBalance - tokenAmount;

        liquidityMigrated = true;
        realEthReserve = 0;
        trackedTokenInventory = 0;
        retainedEthSurplus = ethSurplus;
        retainedTokenSurplus = tokenSurplus;
        // Migration is already finalized under nonReentrant; the post-call balances are conservation assertions.
        // slither-disable-next-line reentrancy-balance
        if (!token.approve(address(graduationAdapter), tokenAmount)) revert TokenTransferFailed();
        // The factory initializes this clone atomically with a contract-validated adapter and an adapter-prepared pool.
        // slither-disable-next-line arbitrary-send-eth,reentrancy-balance
        (pool, liquidity) = graduationAdapter.graduate{value: trackedEthReserve}(address(token), tokenAmount);
        if (pool == address(0) || liquidity == 0 || address(this).balance != totalPendingRefunds + ethSurplus) {
            revert InvalidMigration();
        }
        if (token.balanceOf(address(this)) != tokenSurplus) revert InvalidMigration();
        emit MigrationSurplusRetained(ethSurplus, tokenSurplus, totalPendingRefunds);
        emit LiquidityMigrated(address(graduationAdapter), pool, trackedEthReserve, tokenAmount, liquidity);
    }

    function _enforceFairStart(address recipient, uint256 tokensOut) private {
        if (recipient != msg.sender) revert FairStartRecipientMismatch();
        if (lastFairStartBuyBlock[msg.sender] == block.number) revert FairStartBlockLimit();
        uint256 supply = token.totalSupply();
        if (tokensOut > (supply * fairStartMaxTxBps) / BPS_DENOMINATOR) revert FairStartTransactionLimit();
        uint256 cumulative = fairStartPurchased[msg.sender] + tokensOut;
        if (cumulative > (supply * fairStartMaxWalletBps) / BPS_DENOMINATOR) revert FairStartWalletLimit();
        fairStartPurchased[msg.sender] = cumulative;
        lastFairStartBuyBlock[msg.sender] = block.number;
    }

    function _sendEth(address payable recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert EthTransferFailed();
    }

    function _depositFee(uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = feeSplitter.call{value: amount}(abi.encodeCall(INativeFeeSplitterV6.deposit, ()));
        if (!success) revert EthTransferFailed();
    }

    function _refundOrDefer(address payer, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = payable(payer).call{value: amount, gas: REFUND_GAS_STIPEND}("");
        if (success) {
            emit ExcessPaymentRefunded(payer, amount);
            return;
        }

        pendingRefunds[payer] += amount;
        totalPendingRefunds += amount;
        emit ExcessPaymentRefundDeferred(payer, amount);
    }

    function _feeForGross(uint256 grossEth) private view returns (uint256) {
        return FullMath.mulDiv(grossEth, feeBps, BPS_DENOMINATOR);
    }

    function _grossForExactNet(uint256 netEth) private view returns (uint256) {
        if (feeBps == 0) return netEth;
        uint256 netDenominator = BPS_DENOMINATOR - feeBps;
        uint256 feeGrossUp = FullMath.mulDiv(netEth - 1, feeBps, netDenominator);
        return netEth + feeGrossUp;
    }

    function _validateGraduationConfiguration(
        uint256 supply,
        uint16 feeBps_,
        uint256 virtualEthReserve_,
        uint256 virtualTokenReserve_,
        uint256 graduationTarget_
    ) private pure {
        if (
            supply == 0 || virtualEthReserve_ > type(uint256).max - graduationTarget_
                || virtualEthReserve_ > type(uint256).max / virtualTokenReserve_
        ) revert InvalidConfiguration();

        uint256 feeGrossUp = FullMath.mulDiv(
            graduationTarget_ - 1,
            feeBps_,
            BPS_DENOMINATOR - feeBps_
        );
        if (graduationTarget_ > type(uint256).max - feeGrossUp) revert InvalidConfiguration();

        uint256 invariant = virtualEthReserve_ * virtualTokenReserve_;
        uint256 terminalVirtualEth = virtualEthReserve_ + graduationTarget_;
        uint256 terminalVirtualTokens = _ceilDiv(invariant, terminalVirtualEth);
        if (terminalVirtualTokens >= virtualTokenReserve_) revert InvalidConfiguration();

        uint256 tokensSold = virtualTokenReserve_ - terminalVirtualTokens;
        if (tokensSold >= supply) revert InvalidConfiguration();
        uint256 migrationInventory = supply - tokensSold;
        uint256 minimumMigrationInventory =
            FullMath.mulDivRoundingUp(supply, MINIMUM_MIGRATION_INVENTORY_BPS, BPS_DENOMINATOR);
        if (migrationInventory < minimumMigrationInventory) revert InvalidConfiguration();

        uint256 curveFdv = FullMath.mulDiv(terminalVirtualEth, supply, terminalVirtualTokens);
        uint256 poolFdv = FullMath.mulDiv(graduationTarget_, supply, migrationInventory);
        if (curveFdv == 0 || poolFdv == 0) revert InvalidConfiguration();
        uint256 fdvDifference = curveFdv > poolFdv ? curveFdv - poolFdv : poolFdv - curveFdv;
        if (FullMath.mulDiv(fdvDifference, BPS_DENOMINATOR, curveFdv) > MAX_GRADUATION_PRICE_DIFFERENCE_BPS) {
            revert InvalidConfiguration();
        }
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }
}
