// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Delayed discovery registry for future launch-factory versions.
/// @dev Updating this registry never changes existing tokens, markets, vaults, or liquidity.
contract VersionedFactoryRegistry {
    uint256 public constant MINIMUM_DELAY = 1 days;
    uint256 public constant MAXIMUM_DELAY = 30 days;

    address public immutable governance;
    uint256 public immutable activationDelay;

    address public activeFactory;
    bytes32 public activeVersion;

    address public pendingFactory;
    bytes32 public pendingVersion;
    uint64 public pendingActivationTime;

    event FactoryProposed(address indexed factory, bytes32 indexed version, uint256 activationTime);
    event FactoryProposalCancelled(address indexed factory, bytes32 indexed version);
    event FactoryActivated(address indexed previousFactory, address indexed factory, bytes32 indexed version);

    error OnlyGovernance();
    error InvalidConfiguration();
    error NoPendingFactory();
    error ActivationNotReady();
    error FactoryCodeMissing();

    constructor(
        address governance_,
        uint256 activationDelay_,
        address initialFactory_,
        bytes32 initialVersion_
    ) {
        if (
            governance_ == address(0) || activationDelay_ < MINIMUM_DELAY || activationDelay_ > MAXIMUM_DELAY
                || initialFactory_ == address(0) || initialVersion_ == bytes32(0)
        ) revert InvalidConfiguration();
        if (initialFactory_.code.length == 0) revert FactoryCodeMissing();

        governance = governance_;
        activationDelay = activationDelay_;
        activeFactory = initialFactory_;
        activeVersion = initialVersion_;
        emit FactoryActivated(address(0), initialFactory_, initialVersion_);
    }

    function proposeFactory(address factory, bytes32 version) external {
        if (msg.sender != governance) revert OnlyGovernance();
        if (factory == address(0) || version == bytes32(0) || factory == activeFactory) {
            revert InvalidConfiguration();
        }
        if (factory.code.length == 0) revert FactoryCodeMissing();

        pendingFactory = factory;
        pendingVersion = version;
        pendingActivationTime = uint64(block.timestamp + activationDelay);
        emit FactoryProposed(factory, version, pendingActivationTime);
    }

    function cancelProposal() external {
        if (msg.sender != governance) revert OnlyGovernance();
        address factory = pendingFactory;
        bytes32 version = pendingVersion;
        if (factory == address(0)) revert NoPendingFactory();

        delete pendingFactory;
        delete pendingVersion;
        delete pendingActivationTime;
        emit FactoryProposalCancelled(factory, version);
    }

    /// @notice Anyone may finalize a fully disclosed proposal after the delay.
    function activateFactory() external {
        address factory = pendingFactory;
        bytes32 version = pendingVersion;
        uint64 activationTime = pendingActivationTime;
        if (factory == address(0)) revert NoPendingFactory();
        if (block.timestamp < activationTime) revert ActivationNotReady();
        if (factory.code.length == 0) revert FactoryCodeMissing();

        address previous = activeFactory;
        activeFactory = factory;
        activeVersion = version;
        delete pendingFactory;
        delete pendingVersion;
        delete pendingActivationTime;
        emit FactoryActivated(previous, factory, version);
    }
}
