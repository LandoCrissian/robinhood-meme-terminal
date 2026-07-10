// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract FixedSupplyMemeToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    address public immutable creator;
    string public metadataURI;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ZeroAddress();
    error InvalidSupply();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        address creator_,
        address initialHolder_,
        string memory metadataURI_
    ) {
        if (creator_ == address(0) || initialHolder_ == address(0)) revert ZeroAddress();
        if (supply_ == 0) revert InvalidSupply();
        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        creator = creator_;
        metadataURI = metadataURI_;
        balanceOf[initialHolder_] = supply_;
        emit Transfer(address(0), initialHolder_, supply_);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < value) revert InsufficientAllowance();
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
