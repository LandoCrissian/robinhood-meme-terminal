// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract ClonePurposeRewardVault {
    address public controller;
    address public token;
    bytes32 public purpose;
    uint256 public totalReceived;
    uint256 public totalReleased;
    bool private _initialized;

    event FundsReceived(uint256 amount, uint256 totalReceived);
    event FundsReleased(address indexed recipient, uint256 amount, bytes32 indexed purpose);
    error AlreadyInitialized();
    error InvalidConfiguration();
    error Unauthorized();
    error InvalidRelease();
    error TransferFailed();

    function initialize(address controller_, address token_, bytes32 purpose_) external {
        if (_initialized) revert AlreadyInitialized();
        if (controller_ == address(0) || token_ == address(0) || purpose_ == bytes32(0)) revert InvalidConfiguration();
        _initialized = true;
        controller = controller_;
        token = token_;
        purpose = purpose_;
    }

    receive() external payable {
        totalReceived += msg.value;
        emit FundsReceived(msg.value, totalReceived);
    }

    function release(address payable recipient, uint256 amount) external {
        if (msg.sender != controller) revert Unauthorized();
        if (recipient == address(0) || amount == 0 || amount > address(this).balance) revert InvalidRelease();
        totalReleased += amount;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit FundsReleased(recipient, amount, purpose);
    }
}
