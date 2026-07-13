// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract CloneLaunchRewardVault {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    address[5] public recipients;
    uint16[5] public rewardBps;
    mapping(address => uint256) public claimable;
    uint256 public totalReceived;
    uint256 public totalClaimed;
    bool private _initialized;
    bool private _claiming;

    event RewardsDeposited(address indexed payer, uint256 amount);
    event RewardsAccrued(address indexed recipient, uint256 amount);
    event RewardsClaimed(address indexed recipient, uint256 amount);

    error AlreadyInitialized();
    error ZeroAddress();
    error InvalidRewardSplit();
    error NothingToClaim();
    error TransferFailed();
    error ReentrantClaim();

    function initialize(address[5] calldata recipients_, uint16[5] calldata rewardBps_) external {
        if (_initialized) revert AlreadyInitialized();
        uint256 totalBps;
        for (uint256 i; i < recipients_.length; ++i) {
            if (recipients_[i] == address(0)) revert ZeroAddress();
            recipients[i] = recipients_[i];
            rewardBps[i] = rewardBps_[i];
            totalBps += rewardBps_[i];
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidRewardSplit();
        _initialized = true;
    }

    receive() external payable {
        _accrue(msg.value);
    }

    function deposit() external payable {
        _accrue(msg.value);
    }

    function claim() external {
        if (_claiming) revert ReentrantClaim();
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        _claiming = true;
        claimable[msg.sender] = 0;
        totalClaimed += amount;
        // Effects and the reentrancy lock are set before this interaction; lock reset is intentional.
        // slither-disable-next-line reentrancy-eth
        (bool success,) = msg.sender.call{value: amount}("");
        _claiming = false;
        if (!success) revert TransferFailed();
        emit RewardsClaimed(msg.sender, amount);
    }

    function _accrue(uint256 amount) private {
        if (!_initialized) revert InvalidRewardSplit();
        totalReceived += amount;
        uint256 allocated;
        for (uint256 i; i < recipients.length - 1; ++i) {
            uint256 share = (amount * rewardBps[i]) / BPS_DENOMINATOR;
            allocated += share;
            claimable[recipients[i]] += share;
            emit RewardsAccrued(recipients[i], share);
        }
        uint256 finalShare = amount - allocated;
        claimable[recipients[recipients.length - 1]] += finalShare;
        emit RewardsAccrued(recipients[recipients.length - 1], finalShare);
        emit RewardsDeposited(msg.sender, amount);
    }
}
