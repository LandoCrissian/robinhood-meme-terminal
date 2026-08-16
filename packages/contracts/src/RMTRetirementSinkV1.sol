// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Permanently retires ERC-20 balances by exposing no method capable of moving them.
/// @dev ERC-20 transfers can credit this address without a receiver hook. This contract intentionally has no owner,
///      admin, withdrawal, rescue, sweep, arbitrary-call, delegatecall, receive, fallback, or selfdestruct surface.
contract RMTRetirementSinkV1 {}
