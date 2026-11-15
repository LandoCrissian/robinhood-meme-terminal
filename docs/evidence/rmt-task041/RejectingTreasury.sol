// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Local receipt fixture only. The release deployment has no edge to this account.
contract RejectingTreasury {
    address public immutable controller;
    bool public rejectNative = true;

    constructor(address controller_) {
        controller = controller_;
    }

    function allowNative() external {
        require(msg.sender == controller);
        rejectNative = false;
    }

    function invoke(address ledger, bytes calldata data) external {
        require(msg.sender == controller);
        (bool ok, bytes memory result) = ledger.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }

    receive() external payable {
        require(!rejectNative);
    }
}
