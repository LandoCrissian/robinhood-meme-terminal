// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockOutboundFeeToken is ERC20 {
    address public taxedSender;

    constructor() ERC20("Outbound Fee Token", "OFT") { }

    function setTaxedSender(address account) external {
        taxedSender = account;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == taxedSender && to != address(0) && value >= 10) {
            uint256 fee = value / 10;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
            return;
        }
        super._update(from, to, value);
    }
}
