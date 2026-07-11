// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20MarketToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract BondingCurveMarket {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    IERC20MarketToken public immutable token;
    address payable public immutable rewardVault;
    uint16 public immutable feeBps;
    uint256 public immutable graduationTarget;
    uint256 public immutable invariantK;

    uint256 public virtualEthReserve;
    uint256 public virtualTokenReserve;
    uint256 public realEthReserve;
    bool public graduated;
    bool private _entered;

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

    error ZeroAddress();
    error InvalidConfiguration();
    error MarketGraduated();
    error DeadlineExpired();
    error ZeroInput();
    error SlippageExceeded();
    error InsufficientInventory();
    error InsufficientRealReserve();
    error TokenTransferFailed();
    error EthTransferFailed();
    error ReentrantCall();

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

    constructor(
        address token_,
        address payable rewardVault_,
        uint16 feeBps_,
        uint256 virtualEthReserve_,
        uint256 virtualTokenReserve_,
        uint256 graduationTarget_
    ) {
        if (token_ == address(0) || rewardVault_ == address(0)) revert ZeroAddress();
        if (
            feeBps_ >= BPS_DENOMINATOR || virtualEthReserve_ == 0 || virtualTokenReserve_ == 0 || graduationTarget_ == 0
        ) revert InvalidConfiguration();

        token = IERC20MarketToken(token_);
        rewardVault = rewardVault_;
        feeBps = feeBps_;
        virtualEthReserve = virtualEthReserve_;
        virtualTokenReserve = virtualTokenReserve_;
        graduationTarget = graduationTarget_;
        invariantK = virtualEthReserve_ * virtualTokenReserve_;
    }

    receive() external payable {
        revert InvalidConfiguration();
    }

    function quoteBuy(uint256 ethIn) public view returns (uint256 tokensOut, uint256 fee) {
        if (ethIn == 0) return (0, 0);
        fee = (ethIn * feeBps) / BPS_DENOMINATOR;
        uint256 netEth = ethIn - fee;
        uint256 nextVirtualEth = virtualEthReserve + netEth;
        uint256 nextVirtualToken = _ceilDiv(invariantK, nextVirtualEth);
        if (nextVirtualToken >= virtualTokenReserve) return (0, fee);
        tokensOut = virtualTokenReserve - nextVirtualToken;
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOut, uint256 fee, uint256 grossEth) {
        if (tokensIn == 0) return (0, 0, 0);
        uint256 nextVirtualToken = virtualTokenReserve + tokensIn;
        uint256 nextVirtualEth = _ceilDiv(invariantK, nextVirtualToken);
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
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value == 0) revert ZeroInput();

        uint256 fee;
        (tokensOut, fee) = quoteBuy(msg.value);
        if (tokensOut < minimumTokensOut || tokensOut == 0) revert SlippageExceeded();
        if (token.balanceOf(address(this)) < tokensOut) revert InsufficientInventory();

        uint256 netEth = msg.value - fee;
        virtualEthReserve += netEth;
        virtualTokenReserve -= tokensOut;
        realEthReserve += netEth;

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

        if (realEthReserve >= graduationTarget) {
            graduated = true;
            emit Graduated(realEthReserve, token.balanceOf(address(this)));
        }
    }

    function sell(uint256 tokensIn, uint256 minimumEthOut, address payable recipient, uint256 deadline)
        external
        active
        nonReentrant
        returns (uint256 ethOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
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

    function _sendEth(address payable recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert EthTransferFailed();
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }
}
