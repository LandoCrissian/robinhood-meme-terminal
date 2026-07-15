// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Starts 1-of-1 and can add signers or increase its threshold only through an executed proposal.
contract ExpandableGovernance {
    mapping(address => bool) public isSigner;
    uint256 public signerCount;
    uint256 public threshold = 1;
    uint256 public immutable executionDelay;
    uint256 public transactionCount;

    struct Transaction { address target; uint256 value; bytes data; uint64 executeAfter; uint256 confirmations; bool executed; }
    mapping(uint256 => Transaction) private _transactions;
    mapping(uint256 => mapping(address => bool)) public confirmedBy;

    error Unauthorized(); error InvalidConfiguration(); error InvalidTransaction(); error ExecutionFailed();
    event Proposed(uint256 indexed id, address indexed target, uint256 value, bytes data);
    event Confirmed(uint256 indexed id, address indexed signer);
    event Executed(uint256 indexed id);
    event SignerAdded(address indexed signer);
    event ThresholdChanged(uint256 threshold);

    constructor(address initialSigner, uint256 executionDelay_) {
        if (initialSigner == address(0) || executionDelay_ == 0 || executionDelay_ > 30 days) {
            revert InvalidConfiguration();
        }
        executionDelay = executionDelay_;
        isSigner[initialSigner] = true; signerCount = 1; emit SignerAdded(initialSigner);
    }

    receive() external payable {}
    modifier onlySigner() { if (!isSigner[msg.sender]) revert Unauthorized(); _; }
    modifier onlySelf() { if (msg.sender != address(this)) revert Unauthorized(); _; }

    function propose(address target, uint256 value, bytes calldata data) external onlySigner returns (uint256 id) {
        if (target == address(0)) revert InvalidConfiguration();
        id = transactionCount++;
        _transactions[id] = Transaction(target, value, data, uint64(block.timestamp + executionDelay), 1, false);
        confirmedBy[id][msg.sender] = true; emit Proposed(id, target, value, data); emit Confirmed(id, msg.sender);
    }

    function confirm(uint256 id) external onlySigner {
        Transaction storage t = _transactions[id];
        if (t.target == address(0) || t.executed || confirmedBy[id][msg.sender]) revert InvalidTransaction();
        confirmedBy[id][msg.sender] = true; ++t.confirmations; emit Confirmed(id, msg.sender);
    }

    function execute(uint256 id) external returns (bytes memory result) {
        Transaction storage t = _transactions[id];
        if (t.target == address(0) || t.executed || t.confirmations < threshold || block.timestamp < t.executeAfter) {
            revert InvalidTransaction();
        }
        t.executed = true; (bool ok, bytes memory output) = t.target.call{value: t.value}(t.data);
        if (!ok) revert ExecutionFailed(); emit Executed(id); return output;
    }

    function addSigner(address signer) external onlySelf {
        if (signer == address(0) || isSigner[signer]) revert InvalidConfiguration();
        isSigner[signer] = true; ++signerCount; emit SignerAdded(signer);
    }

    function setThreshold(uint256 nextThreshold) external onlySelf {
        if (nextThreshold == 0 || nextThreshold > signerCount) revert InvalidConfiguration();
        threshold = nextThreshold; emit ThresholdChanged(nextThreshold);
    }
}
