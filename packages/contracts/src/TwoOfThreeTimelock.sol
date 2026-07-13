// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal 2-of-3 governance wallet with an immutable execution delay.
/// @dev No delegatecall, proxy, single-signer bypass, or owner-only escape hatch.
contract TwoOfThreeTimelock {
    uint256 public constant MAXIMUM_DELAY = 30 days;
    uint8 public constant REQUIRED_CONFIRMATIONS = 2;

    address[3] public signers;
    mapping(address signer => bool authorized) public isSigner;
    uint256 public immutable executionDelay;
    uint256 public transactionCount;

    struct Transaction {
        address target;
        uint256 value;
        uint64 executeAfter;
        uint8 confirmations;
        bool executed;
        bool cancelled;
        bytes data;
    }

    mapping(uint256 transactionId => Transaction transaction) private _transactions;
    mapping(uint256 transactionId => mapping(address signer => bool confirmed)) public confirmedBy;

    event TransactionProposed(
        uint256 indexed transactionId,
        address indexed proposer,
        address indexed target,
        uint256 value,
        uint256 executeAfter,
        bytes data
    );
    event TransactionConfirmed(uint256 indexed transactionId, address indexed signer, uint256 confirmations);
    event TransactionExecuted(uint256 indexed transactionId, address indexed executor, bytes returnData);
    event TransactionCancelled(uint256 indexed transactionId);
    event SignerReplaced(address indexed previousSigner, address indexed newSigner);

    error OnlySigner();
    error OnlySelf();
    error InvalidConfiguration();
    error InvalidTransaction();
    error AlreadyConfirmed();
    error InsufficientConfirmations();
    error ExecutionNotReady();
    error ExecutionFailed(bytes reason);
    error ReentrantExecution();

    bool private _executing;

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert OnlySigner();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    constructor(address[3] memory signers_, uint256 executionDelay_) {
        if (executionDelay_ > MAXIMUM_DELAY) revert InvalidConfiguration();
        for (uint256 i; i < signers_.length; ++i) {
            address signer = signers_[i];
            if (signer == address(0) || isSigner[signer]) revert InvalidConfiguration();
            signers[i] = signer;
            isSigner[signer] = true;
        }
        executionDelay = executionDelay_;
    }

    receive() external payable {}

    function propose(address target, uint256 value, bytes calldata data)
        external
        onlySigner
        returns (uint256 transactionId)
    {
        if (target == address(0)) revert InvalidConfiguration();

        transactionId = transactionCount++;
        uint64 executeAfter = uint64(block.timestamp + executionDelay);
        Transaction storage transaction = _transactions[transactionId];
        transaction.target = target;
        transaction.value = value;
        transaction.executeAfter = executeAfter;
        transaction.data = data;

        emit TransactionProposed(transactionId, msg.sender, target, value, executeAfter, data);
        _confirm(transactionId, msg.sender, transaction);
    }

    function confirm(uint256 transactionId) external onlySigner {
        Transaction storage transaction = _validPending(transactionId);
        _confirm(transactionId, msg.sender, transaction);
    }

    function execute(uint256 transactionId) external returns (bytes memory returnData) {
        if (_executing) revert ReentrantExecution();
        Transaction storage transaction = _validPending(transactionId);
        if (transaction.confirmations < REQUIRED_CONFIRMATIONS) revert InsufficientConfirmations();
        if (block.timestamp < transaction.executeAfter) revert ExecutionNotReady();

        _executing = true;
        transaction.executed = true;
        (bool success, bytes memory result) = transaction.target.call{value: transaction.value}(transaction.data);
        _executing = false;
        if (!success) revert ExecutionFailed(result);

        emit TransactionExecuted(transactionId, msg.sender, result);
        return result;
    }

    /// @notice Signer rotation requires an ordinary 2-of-3 proposal targeting this wallet.
    function replaceSigner(address previousSigner, address newSigner) external onlySelf {
        if (!isSigner[previousSigner] || newSigner == address(0) || isSigner[newSigner]) {
            revert InvalidConfiguration();
        }

        for (uint256 i; i < signers.length; ++i) {
            if (signers[i] == previousSigner) {
                signers[i] = newSigner;
                isSigner[previousSigner] = false;
                isSigner[newSigner] = true;
                emit SignerReplaced(previousSigner, newSigner);
                return;
            }
        }
        revert InvalidConfiguration();
    }

    /// @notice Cancellation also requires an ordinary 2-of-3 proposal targeting this wallet.
    function cancel(uint256 transactionId) external onlySelf {
        Transaction storage transaction = _validPending(transactionId);
        transaction.cancelled = true;
        emit TransactionCancelled(transactionId);
    }

    function getTransaction(uint256 transactionId)
        external
        view
        returns (
            address target,
            uint256 value,
            uint256 executeAfter,
            uint256 confirmations,
            bool executed,
            bool cancelled,
            bytes memory data
        )
    {
        Transaction storage transaction = _transactions[transactionId];
        if (transaction.target == address(0)) revert InvalidTransaction();
        return (
            transaction.target,
            transaction.value,
            transaction.executeAfter,
            transaction.confirmations,
            transaction.executed,
            transaction.cancelled,
            transaction.data
        );
    }

    function _confirm(uint256 transactionId, address signer, Transaction storage transaction) private {
        if (confirmedBy[transactionId][signer]) revert AlreadyConfirmed();
        confirmedBy[transactionId][signer] = true;
        transaction.confirmations += 1;
        emit TransactionConfirmed(transactionId, signer, transaction.confirmations);
    }

    function _validPending(uint256 transactionId) private view returns (Transaction storage transaction) {
        transaction = _transactions[transactionId];
        if (transaction.target == address(0) || transaction.executed || transaction.cancelled) {
            revert InvalidTransaction();
        }
    }
}
