// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

/// @notice Lightweight adapter used only to exercise launches, curve trading and rewards on testnet.
/// @dev DEX graduation deliberately reverts until the production V4 stack is deployed.
contract TestnetGraduationAdapter is IGraduationAdapter {
    address public immutable deployer;
    address public factory;
    uint256 private _reservationNonce;

    mapping(address => bytes32) public poolIdForToken;
    mapping(address => address) public marketForToken;

    error Unauthorized();
    error AlreadyBound();
    error InvalidToken();
    error InvalidMarket();
    error GraduationDisabled();

    constructor(address deployer_) {
        if (deployer_ == address(0)) revert Unauthorized();
        deployer = deployer_;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != deployer) revert Unauthorized();
        if (factory != address(0)) revert AlreadyBound();
        if (factory_ == address(0)) revert Unauthorized();
        factory = factory_;
    }

    function prepare(address token) external returns (bytes32 poolId) {
        if (msg.sender != factory) revert Unauthorized();
        if (token == address(0) || poolIdForToken[token] != bytes32(0)) revert InvalidToken();
        poolId = keccak256(abi.encode(block.chainid, address(this), token, ++_reservationNonce));
        poolIdForToken[token] = poolId;
    }

    function bindMarket(address token, address market) external {
        if (msg.sender != factory) revert Unauthorized();
        if (poolIdForToken[token] == bytes32(0) || market == address(0) || marketForToken[token] != address(0)) {
            revert InvalidMarket();
        }
        marketForToken[token] = market;
    }

    function graduate(address, uint256) external payable returns (address, uint256) {
        revert GraduationDisabled();
    }
}
