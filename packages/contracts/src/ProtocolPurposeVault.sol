// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Immutable, purpose-labelled ETH vault controlled only by RMT's 2-of-3 protocol governance.
/// @dev It cannot change governance, execute arbitrary calls, access launch markets, or redirect other vaults.
contract ProtocolPurposeVault {
    address public immutable governance;
    bytes32 public immutable purpose;
    uint256 public totalReceived;
    uint256 public totalReleased;

    event FundsReceived(address indexed payer, uint256 amount);
    event FundsReleased(address indexed recipient, uint256 amount, bytes32 indexed purpose);

    error OnlyGovernance();
    error InvalidConfiguration();
    error InvalidRelease();
    error TransferFailed();

    constructor(address governance_, bytes32 purpose_) {
        if (governance_ == address(0) || governance_.code.length == 0 || purpose_ == bytes32(0)) {
            revert InvalidConfiguration();
        }
        governance = governance_;
        purpose = purpose_;
    }

    receive() external payable {
        if (msg.value == 0) revert InvalidRelease();
        totalReceived += msg.value;
        emit FundsReceived(msg.sender, msg.value);
    }

    function release(address payable recipient, uint256 amount) external {
        if (msg.sender != governance) revert OnlyGovernance();
        if (recipient == address(0) || amount == 0 || amount > address(this).balance) revert InvalidRelease();

        totalReleased += amount;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit FundsReleased(recipient, amount, purpose);
    }
}
