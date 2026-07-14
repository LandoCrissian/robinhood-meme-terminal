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
    bool private _claiming;

    mapping(address recipient => uint256 amount) public pending;
    uint256 public totalReceived;
    uint256 public totalPaid;

    event Initialized(address indexed creator, address indexed protocolTreasury, uint16 creatorShareBps);
    event FeeReceived(address indexed payer, uint256 amount);
    event DirectPayment(address indexed recipient, uint256 amount);
    event PaymentDeferred(address indexed recipient, uint256 amount);
    event DeferredPaymentClaimed(address indexed recipient, uint256 amount);

    error AlreadyInitialized();
    error InvalidConfiguration();
    error NothingToClaim();
    error TransferFailed();
    error ReentrantCall();

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

    receive() external payable {
        _split(msg.sender, msg.value);
    }

    function deposit() external payable {
        _split(msg.sender, msg.value);
    }

    function claimDeferred() external {
        if (_claiming) revert ReentrantCall();
        uint256 amount = pending[msg.sender];
        if (amount == 0) revert NothingToClaim();

        _claiming = true;
        pending[msg.sender] = 0;
        totalPaid += amount;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        _claiming = false;
        if (!success) revert TransferFailed();
        emit DeferredPaymentClaimed(msg.sender, amount);
    }

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
}
