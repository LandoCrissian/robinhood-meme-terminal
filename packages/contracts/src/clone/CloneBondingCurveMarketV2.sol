// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationAdapter} from "../interfaces/IGraduationAdapter.sol";

interface IERC20ProtectedMarketToken {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

/// @notice Versioned bonding-curve market with automatic, temporary Fair Start protections.
/// @dev Protection is market-only and expires automatically. The ERC-20 remains unrestricted.
contract CloneBondingCurveMarketV2 {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    uint64 public constant FAIR_START_DELAY_BLOCKS = 3;
    uint64 public constant FAIR_START_DURATION_BLOCKS = 25;
    uint16 public constant FAIR_START_MAX_TX_BPS = 50;
    uint16 public constant FAIR_START_MAX_WALLET_BPS = 150;

    IERC20ProtectedMarketToken public token;
    address payable public rewardVault;
    IGraduationAdapter public graduationAdapter;
    bytes32 public graduationPoolId;
    uint16 public feeBps;
    uint256 public graduationTarget;
    uint256 public curveInvariantK;

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
    event LiquidityMigrated(
        address indexed adapter, address indexed pool, uint256 ethAmount, uint256 tokenAmount, uint256 liquidity
    );

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
        address payable rewardVault_,
        address graduationAdapter_,
        bytes32 graduationPoolId_,
        uint16 feeBps_,
        uint256 virtualEthReserve_,
        uint256 virtualTokenReserve_,
        uint256 graduationTarget_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (token_ == address(0) || rewardVault_ == address(0) || graduationAdapter_ == address(0)) {
            revert ZeroAddress();
        }
        if (graduationPoolId_ == bytes32(0)) revert InvalidConfiguration();
        if (
            feeBps_ >= BPS_DENOMINATOR || virtualEthReserve_ == 0 || virtualTokenReserve_ == 0 || graduationTarget_ == 0
        ) revert InvalidConfiguration();

        _initialized = true;
        token = IERC20ProtectedMarketToken(token_);
        rewardVault = rewardVault_;
        graduationAdapter = IGraduationAdapter(graduationAdapter_);
        graduationPoolId = graduationPoolId_;
        feeBps = feeBps_;
        virtualEthReserve = virtualEthReserve_;
        virtualTokenReserve = virtualTokenReserve_;
        graduationTarget = graduationTarget_;
        curveInvariantK = virtualEthReserve_ * virtualTokenReserve_;

        tradingOpensAtBlock = uint64(block.number + FAIR_START_DELAY_BLOCKS);
        fairStartEndsAtBlock = tradingOpensAtBlock + FAIR_START_DURATION_BLOCKS;
        uint256 supply = IERC20ProtectedMarketToken(token_).totalSupply();
        emit FairStartConfigured(
            tradingOpensAtBlock,
            fairStartEndsAtBlock,
            (supply * FAIR_START_MAX_TX_BPS) / BPS_DENOMINATOR,
            (supply * FAIR_START_MAX_WALLET_BPS) / BPS_DENOMINATOR
        );
    }

    receive() external payable {
        revert InvalidConfiguration();
    }

    function fairStartActive() public view returns (bool) {
        return block.number >= tradingOpensAtBlock && block.number < fairStartEndsAtBlock;
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
        external
        payable
        active
        nonReentrant
        returns (uint256 tokensOut)
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

        // Commit graduation state before external interactions. A failed transfer still rolls back atomically.
        bool graduationReached = realEthReserve >= graduationTarget;
        if (graduationReached) graduated = true;

        if (!token.transfer(recipient, tokensOut)) revert TokenTransferFailed();
        _sendEth(rewardVault, fee);

        emit Trade(
            msg.sender,
            recipient,
            true,
            tokensOut,
            msg.value,
            fee,
            virtualEthReserve,
            virtualTokenReserve,
            realEthReserve
        );

        if (graduationReached) emit Graduated(realEthReserve, token.balanceOf(address(this)));
    }

    function sell(uint256 tokensIn, uint256 minimumEthOut, address payable recipient, uint256 deadline)
        external
        active
        nonReentrant
        returns (uint256 ethOut)
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
        _sendEth(rewardVault, fee);
        _sendEth(recipient, ethOut);

        emit Trade(
            msg.sender,
            recipient,
            false,
            tokensIn,
            grossEth,
            fee,
            virtualEthReserve,
            virtualTokenReserve,
            realEthReserve
        );
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

        // ETH can be forced into any EVM contract without calling receive().
        // Include any surplus in permanent graduation liquidity so it cannot freeze migration or be withdrawn.
        liquidityMigrated = true;
        realEthReserve = 0;

        if (!token.approve(address(graduationAdapter), tokenAmount)) revert TokenTransferFailed();
        // The adapter is fixed at initialization by the immutable V4 factory, and it accepts graduation
        // only from the market permanently bound to this token.
        // slither-disable-next-line arbitrary-send-eth
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
        if (tokensOut > (supply * FAIR_START_MAX_TX_BPS) / BPS_DENOMINATOR) {
            revert FairStartTransactionLimit();
        }

        uint256 cumulative = fairStartPurchased[msg.sender] + tokensOut;
        if (cumulative > (supply * FAIR_START_MAX_WALLET_BPS) / BPS_DENOMINATOR) {
            revert FairStartWalletLimit();
        }

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
