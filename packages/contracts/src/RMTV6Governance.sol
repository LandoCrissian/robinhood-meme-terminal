// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Delayed, inspectable governance for the RMT V6 protocol foundation.
/// @dev Proposals may call any target, including this contract. Signer and threshold changes are available only
///      through atomic self-calls. Every such change advances the configuration epoch, permanently invalidating
///      every older pending proposal and its confirmations without an unbounded storage loop.
contract RMTV6Governance {
    uint8 public constant SIGNER_ACTION_ADD = 1;
    uint8 public constant SIGNER_ACTION_REPLACE = 2;

    struct Transaction {
        address proposer;
        address target;
        uint256 value;
        bytes data;
        uint64 executeAfter;
        uint64 executeBefore;
        uint64 configurationEpoch;
        uint256 confirmations;
        bool executed;
        bool cancelled;
    }

    struct SignerRoleAcceptance {
        uint64 configurationEpoch;
        uint64 expiresAt;
        uint8 action;
        address currentSigner;
        uint256 nextThreshold;
    }

    mapping(address => bool) public isSigner;
    /// @notice A prospective signer's exact, expiring consent to an add or replacement transition.
    /// @dev Storage scopes consent to this governance deployment. The epoch, action, affected signer, and next
    ///      threshold prevent consent from being reused for a materially different governance configuration.
    mapping(address => SignerRoleAcceptance) public signerRoleAcceptances;
    mapping(uint256 => mapping(address => bool)) public confirmedBy;

    uint256 public signerCount;
    uint256 public threshold;
    uint256 public transactionCount;
    uint64 public configurationEpoch = 1;
    uint64 public immutable executionDelay;
    uint64 public immutable executionWindow;

    mapping(uint256 => Transaction) private _transactions;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidTransaction();
    error ExecutionFailed(bytes revertData);

    event Proposed(
        uint256 indexed id,
        uint64 indexed configurationEpoch,
        address indexed proposer,
        address target,
        uint256 value,
        bytes data,
        uint64 executeAfter,
        uint64 executeBefore
    );
    event Confirmed(uint256 indexed id, uint64 indexed configurationEpoch, address indexed signer);
    event Cancelled(uint256 indexed id, uint64 indexed configurationEpoch, address indexed signer);
    event Executed(uint256 indexed id, uint64 indexed configurationEpoch, address indexed executor);
    event SignerRoleAccepted(
        address indexed signer,
        uint64 indexed configurationEpoch,
        uint8 indexed action,
        address currentSigner,
        uint256 nextThreshold,
        uint64 expiresAt
    );
    event SignerRoleAcceptanceRevoked(
        address indexed signer, uint64 indexed configurationEpoch, uint8 indexed action
    );
    event SignerRoleAcceptanceConsumed(
        address indexed signer, uint64 indexed configurationEpoch, uint8 indexed action
    );
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event ThresholdChanged(uint256 threshold);
    event ConfigurationEpochAdvanced(uint64 indexed previousEpoch, uint64 indexed nextEpoch);

    constructor(address initialSigner, uint64 executionDelay_, uint64 executionWindow_) {
        if (
            initialSigner == address(0) || executionDelay_ == 0 || executionDelay_ > 30 days
                || executionWindow_ == 0 || executionWindow_ > 30 days
        ) revert InvalidConfiguration();

        executionDelay = executionDelay_;
        executionWindow = executionWindow_;
        isSigner[initialSigner] = true;
        signerCount = 1;
        threshold = 1;

        emit SignerAdded(initialSigner);
        emit ThresholdChanged(1);
    }

    receive() external payable {}

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert Unauthorized();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert Unauthorized();
        _;
    }

    /// @notice Proposes a generic call to any contract and records the proposer's confirmation.
    /// @dev The call remains executable only during its fixed window and only while its configuration epoch is live.
    function propose(address target, uint256 value, bytes calldata data) external onlySigner returns (uint256 id) {
        if (target == address(0)) revert InvalidConfiguration();

        uint64 executeAfter = uint64(block.timestamp + executionDelay);
        uint64 executeBefore = executeAfter + executionWindow;
        uint64 epoch = configurationEpoch;

        id = transactionCount++;
        _transactions[id] = Transaction({
            proposer: msg.sender,
            target: target,
            value: value,
            data: data,
            executeAfter: executeAfter,
            executeBefore: executeBefore,
            configurationEpoch: epoch,
            confirmations: 1,
            executed: false,
            cancelled: false
        });
        confirmedBy[id][msg.sender] = true;

        emit Proposed(id, epoch, msg.sender, target, value, data, executeAfter, executeBefore);
        emit Confirmed(id, epoch, msg.sender);
    }

    function confirm(uint256 id) external onlySigner {
        Transaction storage transaction = _transactions[id];
        if (
            transaction.target == address(0) || transaction.executed || transaction.cancelled
                || transaction.configurationEpoch != configurationEpoch || block.timestamp > transaction.executeBefore
                || confirmedBy[id][msg.sender]
        ) revert InvalidTransaction();

        confirmedBy[id][msg.sender] = true;
        ++transaction.confirmations;
        emit Confirmed(id, transaction.configurationEpoch, msg.sender);
    }

    /// @notice Cancels a live pending proposal. Any current signer may use this safety control.
    /// @dev Cancellation is guaranteed to prevent execution before `executeAfter`. Once execution is also valid,
    ///      cancellation and permissionless execution compete by transaction ordering; neither can undo a mined call.
    function cancel(uint256 id) external onlySigner {
        Transaction storage transaction = _transactions[id];
        if (
            transaction.target == address(0) || transaction.executed || transaction.cancelled
                || transaction.configurationEpoch != configurationEpoch || block.timestamp > transaction.executeBefore
        ) revert InvalidTransaction();

        transaction.cancelled = true;
        emit Cancelled(id, transaction.configurationEpoch, msg.sender);
    }

    /// @notice Executes a fully approved current-epoch proposal during its execution window.
    /// @dev Execution is permissionless because signers already fixed and approved every call field. The caller
    ///      receives no privilege, payment, or protocol role and cannot alter the target, value, or calldata.
    function execute(uint256 id) external returns (bytes memory result) {
        Transaction storage transaction = _transactions[id];
        if (
            transaction.target == address(0) || transaction.executed || transaction.cancelled
                || transaction.configurationEpoch != configurationEpoch || transaction.confirmations < threshold
                || block.timestamp < transaction.executeAfter || block.timestamp > transaction.executeBefore
        ) revert InvalidTransaction();

        transaction.executed = true;
        (bool success, bytes memory output) = transaction.target.call{value: transaction.value}(transaction.data);
        if (!success) revert ExecutionFailed(output);

        emit Executed(id, transaction.configurationEpoch, msg.sender);
        return output;
    }

    /// @notice Returns the complete proposal, including generic call data and its execution window.
    function getTransaction(uint256 id) external view returns (Transaction memory transaction) {
        transaction = _transactions[id];
        if (transaction.target == address(0)) revert InvalidTransaction();
    }

    /// @notice Proves control and consents to one exact, time-bounded signer transition in the current epoch.
    /// @dev `currentSigner` must be zero for an addition and the signer being replaced for a replacement. Consent
    ///      cannot remain valid longer than one complete proposal delay plus execution window from this call.
    function acceptSignerRole(
        uint64 expectedConfigurationEpoch,
        uint8 action,
        address currentSigner,
        uint256 nextThreshold,
        uint64 expiresAt
    ) external {
        if (
            isSigner[msg.sender] || expectedConfigurationEpoch != configurationEpoch
                || expiresAt <= block.timestamp
                || expiresAt > block.timestamp + executionDelay + executionWindow
        ) revert InvalidConfiguration();

        if (action == SIGNER_ACTION_ADD) {
            if (currentSigner != address(0)) revert InvalidConfiguration();
            _validateThreshold(nextThreshold, signerCount + 1);
        } else if (action == SIGNER_ACTION_REPLACE) {
            if (!isSigner[currentSigner]) revert InvalidConfiguration();
            _validateThreshold(nextThreshold, signerCount);
        } else {
            revert InvalidConfiguration();
        }

        signerRoleAcceptances[msg.sender] = SignerRoleAcceptance({
            configurationEpoch: expectedConfigurationEpoch,
            expiresAt: expiresAt,
            action: action,
            currentSigner: currentSigner,
            nextThreshold: nextThreshold
        });
        emit SignerRoleAccepted(
            msg.sender,
            expectedConfigurationEpoch,
            action,
            currentSigner,
            nextThreshold,
            expiresAt
        );
    }

    /// @notice Withdraws a prospective signer's unconsumed consent, including consent made stale by an epoch change.
    /// @dev A candidate can revoke before execution so governance cannot rely on an opt-in the candidate no longer
    ///      intends to honor. A later add or replacement requires the candidate to accept again for the live epoch.
    function revokeSignerRoleAcceptance(uint64 acceptedConfigurationEpoch) external {
        SignerRoleAcceptance memory acceptance = signerRoleAcceptances[msg.sender];
        if (acceptedConfigurationEpoch == 0 || acceptance.configurationEpoch != acceptedConfigurationEpoch) {
            revert InvalidConfiguration();
        }

        delete signerRoleAcceptances[msg.sender];
        emit SignerRoleAcceptanceRevoked(msg.sender, acceptedConfigurationEpoch, acceptance.action);
    }

    /// @notice Atomically adds a signer and applies the resulting threshold.
    /// @dev A governance with multiple signers can never be configured as unsafe 1-of-N. The prospective signer
    ///      must have proved control and accepted the role during the current configuration epoch.
    function addSignerAndSetThreshold(address signer, uint256 nextThreshold) external onlySelf {
        if (signer == address(0) || isSigner[signer]) revert InvalidConfiguration();

        uint256 nextSignerCount = signerCount + 1;
        _validateThreshold(nextThreshold, nextSignerCount);
        _consumeSignerAcceptance(signer, SIGNER_ACTION_ADD, address(0), nextThreshold);

        isSigner[signer] = true;
        signerCount = nextSignerCount;
        threshold = nextThreshold;
        emit SignerAdded(signer);
        emit ThresholdChanged(nextThreshold);
        _advanceConfigurationEpoch();
    }

    /// @notice Atomically removes a signer and applies a valid threshold for the remaining signer set.
    function removeSignerAndSetThreshold(address signer, uint256 nextThreshold) external onlySelf {
        if (!isSigner[signer] || signerCount == 1) revert InvalidConfiguration();

        uint256 nextSignerCount = signerCount - 1;
        _validateThreshold(nextThreshold, nextSignerCount);

        isSigner[signer] = false;
        signerCount = nextSignerCount;
        threshold = nextThreshold;
        emit SignerRemoved(signer);
        emit ThresholdChanged(nextThreshold);
        _advanceConfigurationEpoch();
    }

    /// @notice Atomically rotates one signer to a new address and applies the resulting threshold.
    /// @dev The replacement must have proved control and accepted the role during the current configuration epoch.
    function replaceSignerAndSetThreshold(address currentSigner, address replacementSigner, uint256 nextThreshold)
        external
        onlySelf
    {
        if (
            !isSigner[currentSigner] || replacementSigner == address(0) || isSigner[replacementSigner]
                || currentSigner == replacementSigner
        ) revert InvalidConfiguration();
        _validateThreshold(nextThreshold, signerCount);
        _consumeSignerAcceptance(
            replacementSigner, SIGNER_ACTION_REPLACE, currentSigner, nextThreshold
        );

        isSigner[currentSigner] = false;
        isSigner[replacementSigner] = true;
        threshold = nextThreshold;
        emit SignerRemoved(currentSigner);
        emit SignerAdded(replacementSigner);
        emit ThresholdChanged(nextThreshold);
        _advanceConfigurationEpoch();
    }

    /// @notice Changes only the approval threshold and invalidates all older pending proposals.
    function setThreshold(uint256 nextThreshold) external onlySelf {
        _validateThreshold(nextThreshold, signerCount);
        if (nextThreshold == threshold) revert InvalidConfiguration();

        threshold = nextThreshold;
        emit ThresholdChanged(nextThreshold);
        _advanceConfigurationEpoch();
    }

    function _validateThreshold(uint256 nextThreshold, uint256 nextSignerCount) private pure {
        if (
            nextThreshold == 0 || nextThreshold > nextSignerCount
                || (nextSignerCount > 1 && nextThreshold == 1)
        ) revert InvalidConfiguration();
    }

    function _consumeSignerAcceptance(
        address signer,
        uint8 action,
        address currentSigner,
        uint256 nextThreshold
    ) private {
        uint64 epoch = configurationEpoch;
        SignerRoleAcceptance memory acceptance = signerRoleAcceptances[signer];
        if (
            acceptance.configurationEpoch != epoch || acceptance.expiresAt < block.timestamp
                || acceptance.action != action || acceptance.currentSigner != currentSigner
                || acceptance.nextThreshold != nextThreshold
        ) revert InvalidConfiguration();
        delete signerRoleAcceptances[signer];
        emit SignerRoleAcceptanceConsumed(signer, epoch, action);
    }

    function _advanceConfigurationEpoch() private {
        uint64 previousEpoch = configurationEpoch;
        if (previousEpoch == type(uint64).max) revert InvalidConfiguration();
        configurationEpoch = previousEpoch + 1;
        emit ConfigurationEpochAdvanced(previousEpoch, previousEpoch + 1);
    }
}
