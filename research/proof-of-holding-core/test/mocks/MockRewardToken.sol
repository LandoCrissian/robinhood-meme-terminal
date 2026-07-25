// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRewardToken is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") { }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
