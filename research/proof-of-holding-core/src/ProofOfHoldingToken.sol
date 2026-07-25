// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import { LoyaltyAccounting } from "./LoyaltyAccounting.sol";

/// @title ProofOfHoldingToken
/// @notice Fixed-supply reference token for the Proof of Holding core accounting model.
/// @dev No owner, mint, pause, blacklist, transfer tax, or fee-routing capability exists here.
contract ProofOfHoldingToken is ERC20, ERC20Burnable, ERC20Permit {
    uint256 public constant MAX_SUPPLY = type(uint192).max;

    LoyaltyAccounting public immutable accounting;

    error ZeroAddress();
    error ZeroSupply();
    error SupplyExceedsAccountingBound(uint256 supply, uint256 maximum);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address initialHolder_,
        address governance_,
        address policy_,
        address[] memory initialExcluded_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (initialHolder_ == address(0) || governance_ == address(0)) revert ZeroAddress();
        if (initialSupply_ == 0) revert ZeroSupply();
        if (initialSupply_ > MAX_SUPPLY) {
            revert SupplyExceedsAccountingBound(initialSupply_, MAX_SUPPLY);
        }

        accounting = new LoyaltyAccounting(
            address(this),
            governance_,
            policy_,
            initialExcluded_
        );

        _mint(initialHolder_, initialSupply_);
    }

    /// @dev The immutable accounting module is part of transfer validity. It performs no external
    /// calls on this path and cannot be replaced after deployment.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        accounting.onTokenTransfer(from, to, value);
    }
}
