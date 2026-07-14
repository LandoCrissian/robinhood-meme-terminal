// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ILaunchRewardSourceV2 {
    function claim() external;
}

/// @notice Immutable protocol-fee router with permissionless settlement to fixed purpose vaults.
contract ProtocolRevenueRouterV2 {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    uint16 public constant TREASURY_BPS = 4_000;
    uint16 public constant BUYBACK_RESERVE_BPS = 2_000;
    uint16 public constant GRADUATION_ASSISTANCE_BPS = 2_000;
    uint16 public constant REFERRAL_RESERVE_BPS = 1_000;
    uint16 public constant ECOSYSTEM_GROWTH_BPS = 1_000;

    address[5] public recipients;
    mapping(address recipient => uint256 amount) public claimable;
    uint256 public totalReceived;
    uint256 public totalClaimed;
    bool private _collecting;
    bool private _claiming;

    event RevenueReceived(address indexed payer, uint256 amount);
    event RevenueAccrued(address indexed recipient, uint256 amount);
    event LaunchRevenueCollected(address indexed launchVault, uint256 amount);
    event RevenueClaimed(address indexed recipient, uint256 amount);

    error ZeroAddress();
    error DuplicateRecipient();
    error ZeroDeposit();
    error NothingCollected();
    error NothingToClaim();
    error TransferFailed();
    error ReentrantCall();

    constructor(address[5] memory recipients_) {
        for (uint256 i; i < recipients_.length; ++i) {
            if (recipients_[i] == address(0)) revert ZeroAddress();
            for (uint256 j; j < i; ++j) if (recipients_[i] == recipients_[j]) revert DuplicateRecipient();
            recipients[i] = recipients_[i];
        }
    }

    receive() external payable {
        _accrue(msg.sender, msg.value);
    }

    function deposit() external payable {
        _accrue(msg.sender, msg.value);
    }

    function collect(address launchVault) external {
        if (_collecting) revert ReentrantCall();
        if (launchVault == address(0) || launchVault.code.length == 0) revert ZeroAddress();
        uint256 beforeReceived = totalReceived;
        _collecting = true;
        ILaunchRewardSourceV2(launchVault).claim();
        _collecting = false;
        uint256 collected = totalReceived - beforeReceived;
        if (collected == 0) revert NothingCollected();
        emit LaunchRevenueCollected(launchVault, collected);
    }

    function claim() external {
        _claim(msg.sender);
    }

    function claimFor(address recipient) external {
        _claim(recipient);
    }

    function _claim(address recipient) private {
        if (_claiming) revert ReentrantCall();
        uint256 amount = claimable[recipient];
        if (amount == 0) revert NothingToClaim();
        _claiming = true;
        claimable[recipient] = 0;
        totalClaimed += amount;
        (bool success,) = recipient.call{value: amount}("");
        _claiming = false;
        if (!success) revert TransferFailed();
        emit RevenueClaimed(recipient, amount);
    }

    function _accrue(address payer, uint256 amount) private {
        if (amount == 0) revert ZeroDeposit();
        uint16[5] memory bps = [
            TREASURY_BPS,
            BUYBACK_RESERVE_BPS,
            GRADUATION_ASSISTANCE_BPS,
            REFERRAL_RESERVE_BPS,
            ECOSYSTEM_GROWTH_BPS
        ];
        totalReceived += amount;
        uint256 allocated;
        for (uint256 i; i < recipients.length - 1; ++i) {
            uint256 share = (amount * bps[i]) / BPS_DENOMINATOR;
            allocated += share;
            claimable[recipients[i]] += share;
            emit RevenueAccrued(recipients[i], share);
        }
        uint256 finalShare = amount - allocated;
        claimable[recipients[recipients.length - 1]] += finalShare;
        emit RevenueAccrued(recipients[recipients.length - 1], finalShare);
        emit RevenueReceived(payer, amount);
    }
}
