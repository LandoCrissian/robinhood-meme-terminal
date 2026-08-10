// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title KittensToken
/// @notice Fixed-supply ERC-20 for the isolated RMT Labs KITTENS experiment.
/// @dev There is deliberately no owner, mint function, transfer tax, blacklist, pause, proxy, or privileged transfer path.
contract KittensToken {
    string public constant name = "Kittens";
    string public constant symbol = "KITTENS";
    uint8 public constant decimals = 18;
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(address initialRecipient) {
        if (initialRecipient == address(0)) revert ZeroAddress();
        totalSupply = INITIAL_SUPPLY;
        balanceOf[initialRecipient] = INITIAL_SUPPLY;
        emit Transfer(address(0), initialRecipient, INITIAL_SUPPLY);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < value) revert InsufficientAllowance();
            unchecked {
                currentAllowance -= value;
            }
            allowance[from][msg.sender] = currentAllowance;
            emit Approval(from, msg.sender, currentAllowance);
        }
        _transfer(from, to, value);
        return true;
    }

    /// @notice Permanently destroys KITTENS held by the caller.
    /// @dev The flywheel burn executor must first acquire KITTENS and then call this function itself.
    function burn(uint256 value) external {
        uint256 balance = balanceOf[msg.sender];
        if (balance < value) revert InsufficientBalance();
        unchecked {
            balanceOf[msg.sender] = balance - value;
            totalSupply -= value;
        }
        emit Transfer(msg.sender, address(0), value);
    }

    function _transfer(address from, address to, uint256 value) private {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
