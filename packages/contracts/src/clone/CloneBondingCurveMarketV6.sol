// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationAdapter} from "../interfaces/IGraduationAdapter.sol";

interface IERC20V6MarketToken {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

/// @notice V6 bonding-curve market with launch-policy-defined Fair Start settings.
/// @dev Every setting is fixed during initialization and remains unchanged for the life of the market.
contract CloneBondingCurveMarketV6 {
    uint256 private constant BPS_DENOMINATOR = 10_000;

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
    uint64 public tradingOpensAtBlock;
    uint64 public fairStartEndsAtBlock;
    mapping(address wallet => uint256 tokenAmount) public fairStartPurchased;
    mapping(address wallet => uint256 blockNumber) public lastFairStartBuyBlock;

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
        uint256 supply = IERC20V6MarketToken(token_).totalSupply();
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
        if (ethIn == 0) return (0, 0);
        fee = (ethIn * feeBps) / BPS_DENOMINATOR;
        uint256 netEth = ethIn - fee;
        uint256 nextVirtualEth = virtualEthReserve + netEth;
        uint256 nextVirtualToken = _ceilDiv(curveInvariantK, nextVirtualEth);
        if (nextVirtualToken >= virtualTokenReserve) return (0, fee);
        tokensOut = virtualTokenReserve - nextVirtualToken;
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOut, uint256 fee, uint256 grossEth) {
        if (tokensIn == 0) return (0, 0, 0);
        uint256 nextVirtualToken = virtualTokenReserve + tokensIn;
        uint256 nextVirtualEth = _ceilDiv(curveInvariantK, nextVirtualToken);
        if (nextVirtualEth >= virtualEthReserve) return (0, 0, 0);
        grossEth = virtualEthReserve - nextVirtualEth;
        fee = (grossEth * feeBps) / BPS_DENOMINATOR;
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
        (tokensOut, fee) = quoteBuy(msg.value);
        if (tokensOut < minimumTokensOut || tokensOut == 0) revert SlippageExceeded();
        if (token.balanceOf(address(this)) < tokensOut) revert InsufficientInventory();
        if (fairStartActive()) _enforceFairStart(recipient, tokensOut);

        uint256 netEth = msg.value - fee;
        virtualEthReserve += netEth;
        virtualTokenReserve -= tokensOut;
        realEthReserve += netEth;
        bool graduationReached = realEthReserve >= graduationTarget;
        if (graduationReached) graduated = true;

        if (!token.transfer(recipient, tokensOut)) revert TokenTransferFailed();
        _sendEth(feeSplitter, fee);
        emit Trade(msg.sender, recipient, true, tokensOut, msg.value, fee, virtualEthReserve, virtualTokenReserve, realEthReserve);
        if (graduationReached) emit Graduated(realEthReserve, token.balanceOf(address(this)));
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
        if (!token.transferFrom(msg.sender, address(this), tokensIn)) revert TokenTransferFailed();
        _sendEth(feeSplitter, fee);
        _sendEth(recipient, ethOut);
        emit Trade(msg.sender, recipient, false, tokensIn, grossEth, fee, virtualEthReserve, virtualTokenReserve, realEthReserve);
    }

    function progressBps() external view returns (uint256) {
        if (graduated || realEthReserve >= graduationTarget) return BPS_DENOMINATOR;
        return (realEthReserve * BPS_DENOMINATOR) / graduationTarget;
    }

    function migrateLiquidity() external nonReentrant returns (address pool, uint256 liquidity) {
        if (!graduated) revert NotGraduated();
        if (liquidityMigrated) revert AlreadyMigrated();
        uint256 trackedEthReserve = realEthReserve;
        uint256 ethAmount = address(this).balance;
        uint256 tokenAmount = token.balanceOf(address(this));
        if (trackedEthReserve == 0 || ethAmount < trackedEthReserve || tokenAmount == 0) revert InvalidMigration();

        liquidityMigrated = true;
        realEthReserve = 0;
        // Migration is already finalized under nonReentrant; the post-call balances are conservation assertions.
        // slither-disable-next-line reentrancy-balance
        if (!token.approve(address(graduationAdapter), tokenAmount)) revert TokenTransferFailed();
        // The factory initializes this clone atomically with a contract-validated adapter and an adapter-prepared pool.
        // slither-disable-next-line arbitrary-send-eth,reentrancy-balance
        (pool, liquidity) = graduationAdapter.graduate{value: ethAmount}(address(token), tokenAmount);
        if (pool == address(0) || liquidity == 0 || token.balanceOf(address(this)) != 0 || address(this).balance != 0) {
            revert InvalidMigration();
        }
        emit LiquidityMigrated(address(graduationAdapter), pool, ethAmount, tokenAmount, liquidity);
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

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }
}
