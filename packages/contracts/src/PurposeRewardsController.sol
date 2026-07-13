// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IRegisteredPurposeVault {
    function controller() external view returns (address);
    function token() external view returns (address);
    function purpose() external view returns (bytes32);
    function release(address payable recipient, uint256 amount) external;
}

/// @notice Delayed, purpose-vault-only controller for community and trader reward distributions.
/// @dev Governance cannot call arbitrary contracts, change the delay, replace itself, or touch market liquidity.
contract PurposeRewardsController {
    uint256 public constant MINIMUM_DELAY = 1 days;
    uint256 public constant MAXIMUM_DELAY = 30 days;

    address public immutable deployer;
    address public immutable governance;
    uint256 public immutable releaseDelay;

    address public factory;
    uint256 public proposalCount;
    mapping(address vault => bool registered) public isRegisteredVault;

    struct ReleaseProposal {
        address vault;
        address payable recipient;
        uint256 amount;
        uint64 executeAfter;
        bool executed;
        bool cancelled;
    }

    mapping(uint256 proposalId => ReleaseProposal proposal) public proposals;

    event FactoryBound(address indexed factory);
    event PurposeVaultRegistered(address indexed vault, address indexed token, bytes32 indexed purpose);
    event ReleaseProposed(
        uint256 indexed proposalId,
        address indexed vault,
        address indexed recipient,
        uint256 amount,
        uint256 executeAfter
    );
    event ReleaseCancelled(uint256 indexed proposalId);
    event ReleaseExecuted(
        uint256 indexed proposalId, address indexed vault, address indexed recipient, uint256 amount
    );

    error OnlyDeployer();
    error OnlyFactory();
    error OnlyGovernance();
    error InvalidConfiguration();
    error FactoryAlreadyBound();
    error VaultAlreadyRegistered();
    error VaultNotRegistered();
    error InvalidVault();
    error InvalidProposal();
    error ReleaseNotReady();

    constructor(address deployer_, address governance_, uint256 releaseDelay_) {
        if (
            deployer_ == address(0) || governance_ == address(0) || releaseDelay_ < MINIMUM_DELAY
                || releaseDelay_ > MAXIMUM_DELAY
        ) revert InvalidConfiguration();

        deployer = deployer_;
        governance = governance_;
        releaseDelay = releaseDelay_;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (factory != address(0)) revert FactoryAlreadyBound();
        if (factory_ == address(0) || factory_.code.length == 0) revert InvalidConfiguration();

        factory = factory_;
        emit FactoryBound(factory_);
    }

    function registerVault(address vault, address token, bytes32 purpose) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (vault == address(0) || vault.code.length == 0 || token == address(0) || purpose == bytes32(0)) {
            revert InvalidVault();
        }
        if (isRegisteredVault[vault]) revert VaultAlreadyRegistered();

        IRegisteredPurposeVault candidate = IRegisteredPurposeVault(vault);
        if (
            candidate.controller() != address(this) || candidate.token() != token || candidate.purpose() != purpose
        ) revert InvalidVault();

        isRegisteredVault[vault] = true;
        emit PurposeVaultRegistered(vault, token, purpose);
    }

    function proposeRelease(address vault, address payable recipient, uint256 amount)
        external
        returns (uint256 proposalId)
    {
        if (msg.sender != governance) revert OnlyGovernance();
        if (!isRegisteredVault[vault]) revert VaultNotRegistered();
        if (recipient == address(0) || amount == 0 || amount > vault.balance) revert InvalidProposal();

        proposalId = proposalCount++;
        uint64 executeAfter = uint64(block.timestamp + releaseDelay);
        proposals[proposalId] = ReleaseProposal(vault, recipient, amount, executeAfter, false, false);
        emit ReleaseProposed(proposalId, vault, recipient, amount, executeAfter);
    }

    function cancelRelease(uint256 proposalId) external {
        if (msg.sender != governance) revert OnlyGovernance();
        ReleaseProposal storage proposal = proposals[proposalId];
        if (
            proposal.vault == address(0) || proposal.executed || proposal.cancelled
        ) revert InvalidProposal();

        proposal.cancelled = true;
        emit ReleaseCancelled(proposalId);
    }

    /// @notice Anyone may execute a disclosed release after its immutable delay.
    function executeRelease(uint256 proposalId) external {
        ReleaseProposal storage proposal = proposals[proposalId];
        if (
            proposal.vault == address(0) || proposal.executed || proposal.cancelled
        ) revert InvalidProposal();
        if (block.timestamp < proposal.executeAfter) revert ReleaseNotReady();

        proposal.executed = true;
        IRegisteredPurposeVault(proposal.vault).release(proposal.recipient, proposal.amount);
        emit ReleaseExecuted(proposalId, proposal.vault, proposal.recipient, proposal.amount);
    }
}
