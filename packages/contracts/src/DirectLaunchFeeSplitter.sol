// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Per-launch V6 fee splitter that pays creator and protocol treasury directly.
/// @dev A failed direct transfer is credited for pull-based recovery so trading cannot be blocked by a recipient.
contract DirectLaunchFeeSplitter {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    address payable public creator;
    address payable public protocolTreasury;
    uint16 public creatorShareBps;
    bool private _initialized;
    bool private _entered;

    mapping(address recipient => uint256 amount) public pending;
    mapping(address token => mapping(address recipient => uint256 amount)) public pendingToken;
    uint256 public totalReceived;
    uint256 public totalPaid;
    mapping(address token => uint256 amount) public totalTokenReceived;
    mapping(address token => uint256 amount) public totalTokenPaid;

    event Initialized(address indexed creator, address indexed protocolTreasury, uint16 creatorShareBps);
    event FeeReceived(address indexed payer, uint256 amount);
    event DirectPayment(address indexed recipient, uint256 amount);
    event PaymentDeferred(address indexed recipient, uint256 amount);
    event DeferredPaymentClaimed(address indexed recipient, uint256 amount);
    event TokenFeeReceived(address indexed payer, address indexed token, uint256 amount);
    event DirectTokenPayment(address indexed token, address indexed recipient, uint256 amount);
    event TokenPaymentDeferred(address indexed token, address indexed recipient, uint256 amount);
    event DeferredTokenPaymentClaimed(address indexed token, address indexed recipient, uint256 amount);

    error AlreadyInitialized();
    error InvalidConfiguration();
    error NothingToClaim();
    error TransferFailed();
    error ReentrantCall();

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    function initialize(address payable creator_, address payable protocolTreasury_, uint16 creatorShareBps_) external {
        if (_initialized) revert AlreadyInitialized();
        if (
            creator_ == address(0) || protocolTreasury_ == address(0)
                || creatorShareBps_ > BPS_DENOMINATOR
        ) revert InvalidConfiguration();

        _initialized = true;
        creator = creator_;
        protocolTreasury = protocolTreasury_;
        creatorShareBps = creatorShareBps_;
        emit Initialized(creator_, protocolTreasury_, creatorShareBps_);
    }

    receive() external payable nonReentrant {
        _split(msg.sender, msg.value);
    }

    function deposit() external payable nonReentrant {
        _split(msg.sender, msg.value);
    }

    function claimDeferred() external nonReentrant {
        uint256 amount = pending[msg.sender];
        if (amount == 0) revert NothingToClaim();

        pending[msg.sender] = 0;
        totalPaid += amount;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit DeferredPaymentClaimed(msg.sender, amount);
    }

    /// @notice Accounts for tokens already transferred to this splitter and distributes them using the immutable split.
    function depositToken(address token, uint256 amount) external nonReentrant {
        if (!_initialized || token == address(0) || token.code.length == 0 || amount == 0) {
            revert InvalidConfiguration();
        }

        uint256 outstanding = totalTokenReceived[token] - totalTokenPaid[token];
        if (_tokenBalance(token) < outstanding + amount) revert InvalidConfiguration();
        totalTokenReceived[token] += amount;

        uint256 creatorAmount = (amount * creatorShareBps) / BPS_DENOMINATOR;
        uint256 protocolAmount = amount - creatorAmount;
        _payTokenOrCredit(token, creator, creatorAmount);
        _payTokenOrCredit(token, protocolTreasury, protocolAmount);
        emit TokenFeeReceived(msg.sender, token, amount);
    }

    function claimDeferredToken(address token) external nonReentrant {
        uint256 amount = pendingToken[token][msg.sender];
        if (amount == 0) revert NothingToClaim();

        pendingToken[token][msg.sender] = 0;
        totalTokenPaid[token] += amount;
        if (!_transferToken(token, msg.sender, amount)) revert TransferFailed();
        emit DeferredTokenPaymentClaimed(token, msg.sender, amount);
    }

    // All external paths into this helper are nonReentrant; recipient callbacks are covered by the adversarial test.
    // slither-disable-next-line reentrancy-eth
    function _split(address payer, uint256 amount) private {
        if (!_initialized || amount == 0) revert InvalidConfiguration();
        totalReceived += amount;

        uint256 creatorAmount = (amount * creatorShareBps) / BPS_DENOMINATOR;
        uint256 protocolAmount = amount - creatorAmount;
        _payOrCredit(creator, creatorAmount);
        _payOrCredit(protocolTreasury, protocolAmount);
        emit FeeReceived(payer, amount);
    }

    function _payOrCredit(address payable recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = recipient.call{value: amount}("");
        if (success) {
            totalPaid += amount;
            emit DirectPayment(recipient, amount);
        } else {
            pending[recipient] += amount;
            emit PaymentDeferred(recipient, amount);
        }
    }

    function _payTokenOrCredit(address token, address recipient, uint256 amount) private {
        if (amount == 0) return;
        if (_transferToken(token, recipient, amount)) {
            totalTokenPaid[token] += amount;
            emit DirectTokenPayment(token, recipient, amount);
        } else {
            pendingToken[token][recipient] += amount;
            emit TokenPaymentDeferred(token, recipient, amount);
        }
    }

    function _tokenBalance(address token) private view returns (uint256 balance) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!success || data.length < 32) revert InvalidConfiguration();
        balance = abi.decode(data, (uint256));
    }

    function _transferToken(address token, address recipient, uint256 amount) private returns (bool) {
        (bool success, bytes memory data) = token.call(abi.encodeWithSignature("transfer(address,uint256)", recipient, amount));
        return success && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));
    }
}
