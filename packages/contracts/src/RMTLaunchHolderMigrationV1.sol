// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTLaunchCurveTokenV1} from "./RMTLaunchCurveTokenV1.sol";

interface IHolderMigrationRegistryV1 {
    function project(address token)
        external
        view
        returns (address factory, address curve, uint32 version, address engine, uint64 migrations);
}

interface IHolderMigrationFactoryV1 {
    function curveForToken(address token) external view returns (address);
    function projectRegistry() external view returns (address);
}

interface IHolderMigrationCurveV1 {
    function creator() external view returns (address);
    function token() external view returns (address);
}

/// @notice Opt-in 1:1 replacement-token redemption for a registered launch in the isolated review environment.
/// @dev This escrow never interacts with the original curve, LP position, reserve or ledger. It has no administrator.
contract RMTLaunchHolderMigrationV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 31_337;
    uint256 public constant MAX_DEADLINE_WINDOW = 30 minutes;

    address public immutable registry;
    bytes32 public immutable registryRuntimeHash;
    address public immutable projectFactory;
    address public immutable projectCurve;
    address public immutable projectCreator;
    IERC20 public immutable originalToken;
    bytes32 public immutable originalRuntimeHash;
    RMTLaunchCurveTokenV1 public immutable replacementToken;
    uint256 public immutable supply;
    uint256 public totalRedeemed;

    error WrongChain();
    error InvalidProject();
    error UnauthorizedCreator();
    error InvalidTerms();
    error InvalidDeadline();
    error InvalidRedemption();
    error SettlementMismatch();

    event MigrationOpened(
        address indexed originalToken,
        address indexed replacementToken,
        address indexed projectCurve,
        address registry,
        address projectCreator,
        bytes32 originalRuntimeHash,
        uint256 supply
    );
    event TokensRedeemed(address indexed holder, uint256 amount, uint256 totalRedeemed);

    constructor(
        address registry_,
        bytes32 expectedRegistryRuntimeHash,
        address original,
        bytes32 expectedOriginalRuntimeHash,
        string memory replacementName,
        string memory replacementSymbol
    ) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (
            registry_.code.length == 0 || registry_.codehash != expectedRegistryRuntimeHash || original.code.length == 0
                || original.codehash != expectedOriginalRuntimeHash
        ) revert InvalidProject();
        (address factory, address curve,,,) = IHolderMigrationRegistryV1(registry_).project(original);
        if (
            factory.code.length == 0 || curve.code.length == 0
                || IHolderMigrationFactoryV1(factory).projectRegistry() != registry_
                || IHolderMigrationFactoryV1(factory).curveForToken(original) != curve
                || IHolderMigrationCurveV1(curve).token() != original
        ) revert InvalidProject();
        if (IHolderMigrationCurveV1(curve).creator() != msg.sender) revert UnauthorizedCreator();
        uint256 fixedSupply = IERC20(original).totalSupply();
        if (
            IERC20Metadata(original).decimals() != 18 || fixedSupply == 0 || bytes(replacementName).length == 0
                || bytes(replacementName).length > 48 || bytes(replacementSymbol).length == 0
                || bytes(replacementSymbol).length > 12
        ) revert InvalidTerms();
        registry = registry_;
        registryRuntimeHash = expectedRegistryRuntimeHash;
        projectFactory = factory;
        projectCurve = curve;
        projectCreator = msg.sender;
        originalToken = IERC20(original);
        originalRuntimeHash = expectedOriginalRuntimeHash;
        supply = fixedSupply;
        replacementToken = new RMTLaunchCurveTokenV1(replacementName, replacementSymbol, fixedSupply);
        emit MigrationOpened(
            original, address(replacementToken), curve, registry_, msg.sender, expectedOriginalRuntimeHash, fixedSupply
        );
    }

    /// @notice The caller exchanges their own approved original tokens at exactly 1:1. Old tokens remain locked.
    /// @dev A direct token transfer to this address is not a redemption. Call this function after exact approval.
    function redeem(uint256 amount, uint256 deadline) external nonReentrant {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert InvalidDeadline();
        uint256 prior = totalRedeemed;
        if (amount == 0 || amount > supply - prior || originalToken.allowance(msg.sender, address(this)) != amount) {
            revert InvalidRedemption();
        }
        if (address(originalToken).codehash != originalRuntimeHash || originalToken.totalSupply() != supply) {
            revert InvalidProject();
        }
        uint256 originalHolderBefore = originalToken.balanceOf(msg.sender);
        uint256 originalEscrowBefore = originalToken.balanceOf(address(this));
        uint256 replacementHolderBefore = replacementToken.balanceOf(msg.sender);
        uint256 replacementEscrowBefore = replacementToken.balanceOf(address(this));
        if (originalHolderBefore < amount || replacementEscrowBefore < amount) revert InvalidRedemption();

        totalRedeemed = prior + amount;
        originalToken.safeTransferFrom(msg.sender, address(this), amount);
        if (
            originalToken.balanceOf(msg.sender) != originalHolderBefore - amount
                || originalToken.balanceOf(address(this)) != originalEscrowBefore + amount
                || originalToken.allowance(msg.sender, address(this)) != 0 || originalToken.totalSupply() != supply
        ) revert SettlementMismatch();
        if (!replacementToken.transfer(msg.sender, amount)) revert SettlementMismatch();
        if (
            replacementToken.balanceOf(msg.sender) != replacementHolderBefore + amount
                || replacementToken.balanceOf(address(this)) != replacementEscrowBefore - amount
        ) revert SettlementMismatch();
        emit TokensRedeemed(msg.sender, amount, totalRedeemed);
    }
}
