// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

uint256 constant RMT_FIXED_TOKEN_SUPPLY = 1_000_000_000 ether;

/// @notice One billion tokens are minted once, at construction.
contract RMTLaunchCurveTokenV2 is ERC20 {
    uint256 public constant FIXED_SUPPLY = RMT_FIXED_TOKEN_SUPPLY;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, FIXED_SUPPLY);
    }
}
