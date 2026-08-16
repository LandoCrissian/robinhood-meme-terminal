// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IRMTDistributionEngineV1} from "./interfaces/IRMTDistributionEngineV1.sol";
import {RMTRetirementSinkV1} from "./RMTRetirementSinkV1.sol";

/// @notice Typed, sender-bound asset distribution with atomic RMT utility retirement.
/// @dev Every distributed asset moves directly from msg.sender to the exact recipient. The engine has no owner,
///      upgrade path, arbitrary target, arbitrary calldata, rescue, sweep, custody, or caller-supplied `from`.
contract RMTDistributionEngineV1 is IRMTDistributionEngineV1, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 4_663;

    bytes32 private constant EXECUTION_DOMAIN = keccak256("RMT_DISTRIBUTION_EXECUTION_V1");
    bytes32 private constant ERC20_EQUAL_BATCH_DOMAIN = keccak256("RMT_DISTRIBUTION_ERC20_EQUAL_BATCH_V1");
    bytes32 private constant ERC20_BATCH_DOMAIN = keccak256("RMT_DISTRIBUTION_ERC20_BATCH_V1");
    bytes32 private constant ERC721_BATCH_DOMAIN = keccak256("RMT_DISTRIBUTION_ERC721_BATCH_V1");
    bytes32 private constant ERC1155_BATCH_DOMAIN = keccak256("RMT_DISTRIBUTION_ERC1155_BATCH_V1");

    address public immutable rmtToken;
    address public immutable retirementSink;
    bytes32 public immutable rmtTokenRuntimeHash;
    bytes32 public immutable retirementSinkRuntimeHash;
    uint256 public immutable erc20CostPerRecipient;
    uint256 public immutable erc721CostPerRecipient;
    uint256 public immutable erc1155CostPerRecipient;

    mapping(bytes32 executionKey => bool consumed) public executionConsumed;

    error InvalidConfiguration();
    error RuntimeIdentityChanged();
    error EmptyDistribution();
    error InvalidDistributionId();
    error InvalidAsset();
    error LengthMismatch();
    error InvalidRecipient(uint256 index);
    error InvalidAmount(uint256 index);
    error ExecutionAlreadyConsumed();
    error UnsupportedTransferBehavior();
    error InvalidAssetOwnership(uint256 index);

    constructor(
        address rmtToken_,
        address retirementSink_,
        uint256 erc20CostPerRecipient_,
        uint256 erc721CostPerRecipient_,
        uint256 erc1155CostPerRecipient_
    ) {
        bytes32 expectedSinkRuntimeHash = keccak256(type(RMTRetirementSinkV1).runtimeCode);
        if (
            block.chainid != CHAIN_ID || rmtToken_ == address(0) || retirementSink_ == address(0)
                || rmtToken_ == retirementSink_ || rmtToken_.code.length == 0 || retirementSink_.code.length == 0
                || retirementSink_.codehash != expectedSinkRuntimeHash || erc20CostPerRecipient_ == 0
                || erc721CostPerRecipient_ == 0 || erc1155CostPerRecipient_ == 0
        ) revert InvalidConfiguration();

        rmtToken = rmtToken_;
        retirementSink = retirementSink_;
        rmtTokenRuntimeHash = rmtToken_.codehash;
        retirementSinkRuntimeHash = expectedSinkRuntimeHash;
        erc20CostPerRecipient = erc20CostPerRecipient_;
        erc721CostPerRecipient = erc721CostPerRecipient_;
        erc1155CostPerRecipient = erc1155CostPerRecipient_;
    }

    function quoteUtilityCost(ActionKind actionKind, uint256 recipientCount) public view returns (uint256) {
        if (recipientCount == 0) revert EmptyDistribution();
        if (actionKind == ActionKind.ERC20_EQUAL || actionKind == ActionKind.ERC20_CUSTOM) {
            return erc20CostPerRecipient * recipientCount;
        }
        if (actionKind == ActionKind.ERC721) return erc721CostPerRecipient * recipientCount;
        return erc1155CostPerRecipient * recipientCount;
    }

    function getExecutionKey(address sender, bytes32 distributionId) public view returns (bytes32) {
        return keccak256(abi.encode(EXECUTION_DOMAIN, CHAIN_ID, address(this), sender, distributionId));
    }

    function hashERC20EqualBatch(address asset, address[] calldata recipients, uint256 amount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(ERC20_EQUAL_BATCH_DOMAIN, asset, recipients, amount));
    }

    function hashERC20Batch(address asset, address[] calldata recipients, uint256[] calldata amounts)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(ERC20_BATCH_DOMAIN, asset, recipients, amounts));
    }

    function hashERC721Batch(address asset, address[] calldata recipients, uint256[] calldata tokenIds)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(ERC721_BATCH_DOMAIN, asset, recipients, tokenIds));
    }

    function hashERC1155Batch(
        address asset,
        address[] calldata recipients,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(ERC1155_BATCH_DOMAIN, asset, recipients, tokenIds, amounts));
    }

    function airdropERC20Equal(bytes32 distributionId, address asset, address[] calldata recipients, uint256 amount)
        external
        nonReentrant
        returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired)
    {
        _validateAssetAndRecipients(asset, recipients);
        if (amount == 0) revert InvalidAmount(0);

        totalAssetAmount = amount * recipients.length;
        batchHash = hashERC20EqualBatch(asset, recipients, amount);
        uint256 engineRmtBalanceBefore;
        (executionKey, rmtRetired, engineRmtBalanceBefore) =
            _begin(distributionId, ActionKind.ERC20_EQUAL, recipients.length);
        uint256 engineAssetBalanceBefore = IERC20(asset).balanceOf(address(this));

        for (uint256 i; i < recipients.length; ++i) {
            _transferERC20Exact(asset, msg.sender, recipients[i], amount);
        }

        _assertEngineERC20Balances(asset, engineAssetBalanceBefore, engineRmtBalanceBefore);
        _emitDistribution(
            executionKey,
            distributionId,
            ActionKind.ERC20_EQUAL,
            asset,
            recipients.length,
            totalAssetAmount,
            rmtRetired,
            batchHash
        );
    }

    function airdropERC20(
        bytes32 distributionId,
        address asset,
        address[] calldata recipients,
        uint256[] calldata amounts
    )
        external
        nonReentrant
        returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired)
    {
        _validateAssetAndRecipients(asset, recipients);
        if (recipients.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] == 0) revert InvalidAmount(i);
            totalAssetAmount += amounts[i];
        }

        batchHash = hashERC20Batch(asset, recipients, amounts);
        uint256 engineRmtBalanceBefore;
        (executionKey, rmtRetired, engineRmtBalanceBefore) =
            _begin(distributionId, ActionKind.ERC20_CUSTOM, recipients.length);
        uint256 engineAssetBalanceBefore = IERC20(asset).balanceOf(address(this));

        for (uint256 i; i < recipients.length; ++i) {
            _transferERC20Exact(asset, msg.sender, recipients[i], amounts[i]);
        }

        _assertEngineERC20Balances(asset, engineAssetBalanceBefore, engineRmtBalanceBefore);
        _emitDistribution(
            executionKey,
            distributionId,
            ActionKind.ERC20_CUSTOM,
            asset,
            recipients.length,
            totalAssetAmount,
            rmtRetired,
            batchHash
        );
    }

    // slither-disable-start reentrancy-balance
    // Every state-changing entry is nonReentrant. The pre/post RMT balance snapshot is a deliberate no-custody
    // invariant; a receiver callback that changes that balance can only make the whole distribution revert.
    function airdropERC721(
        bytes32 distributionId,
        address asset,
        address[] calldata recipients,
        uint256[] calldata tokenIds
    )
        external
        nonReentrant
        returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired)
    {
        _validateAssetAndRecipients(asset, recipients);
        if (recipients.length != tokenIds.length) revert LengthMismatch();

        totalAssetAmount = recipients.length;
        batchHash = hashERC721Batch(asset, recipients, tokenIds);
        uint256 engineRmtBalanceBefore;
        (executionKey, rmtRetired, engineRmtBalanceBefore) =
            _begin(distributionId, ActionKind.ERC721, recipients.length);

        IERC721 token = IERC721(asset);
        for (uint256 i; i < recipients.length; ++i) {
            if (token.ownerOf(tokenIds[i]) != msg.sender) revert InvalidAssetOwnership(i);
            token.safeTransferFrom(msg.sender, recipients[i], tokenIds[i]);
            if (token.ownerOf(tokenIds[i]) != recipients[i]) revert UnsupportedTransferBehavior();
        }

        if (IERC20(rmtToken).balanceOf(address(this)) != engineRmtBalanceBefore) {
            revert UnsupportedTransferBehavior();
        }
        _emitDistribution(
            executionKey,
            distributionId,
            ActionKind.ERC721,
            asset,
            recipients.length,
            totalAssetAmount,
            rmtRetired,
            batchHash
        );
    }

    // slither-disable-end reentrancy-balance

    // slither-disable-start reentrancy-balance
    // See airdropERC721: receiver callbacks cannot reenter the engine, and any RMT balance mutation fails closed.
    function airdropERC1155(
        bytes32 distributionId,
        address asset,
        address[] calldata recipients,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    )
        external
        nonReentrant
        returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired)
    {
        _validateAssetAndRecipients(asset, recipients);
        if (recipients.length != tokenIds.length || recipients.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] == 0) revert InvalidAmount(i);
            totalAssetAmount += amounts[i];
        }

        batchHash = hashERC1155Batch(asset, recipients, tokenIds, amounts);
        uint256 engineRmtBalanceBefore;
        (executionKey, rmtRetired, engineRmtBalanceBefore) =
            _begin(distributionId, ActionKind.ERC1155, recipients.length);

        IERC1155 token = IERC1155(asset);
        for (uint256 i; i < recipients.length; ++i) {
            uint256 senderBefore = token.balanceOf(msg.sender, tokenIds[i]);
            uint256 recipientBefore = token.balanceOf(recipients[i], tokenIds[i]);
            uint256 engineBefore = token.balanceOf(address(this), tokenIds[i]);
            token.safeTransferFrom(msg.sender, recipients[i], tokenIds[i], amounts[i], "");
            uint256 senderAfter = token.balanceOf(msg.sender, tokenIds[i]);
            uint256 recipientAfter = token.balanceOf(recipients[i], tokenIds[i]);
            if (
                senderAfter > senderBefore || senderBefore - senderAfter != amounts[i]
                    || recipientAfter < recipientBefore || recipientAfter - recipientBefore != amounts[i]
                    || token.balanceOf(address(this), tokenIds[i]) != engineBefore
            ) revert UnsupportedTransferBehavior();
        }

        if (IERC20(rmtToken).balanceOf(address(this)) != engineRmtBalanceBefore) {
            revert UnsupportedTransferBehavior();
        }
        _emitDistribution(
            executionKey,
            distributionId,
            ActionKind.ERC1155,
            asset,
            recipients.length,
            totalAssetAmount,
            rmtRetired,
            batchHash
        );
    }
    // slither-disable-end reentrancy-balance

    function _validateAssetAndRecipients(address asset, address[] calldata recipients) private view {
        if (asset == address(0) || asset == address(this) || asset == retirementSink || asset.code.length == 0) {
            revert InvalidAsset();
        }
        if (recipients.length == 0) revert EmptyDistribution();
        for (uint256 i; i < recipients.length; ++i) {
            address recipient = recipients[i];
            if (
                recipient == address(0) || recipient == address(this) || recipient == retirementSink
                    || recipient == msg.sender
            ) revert InvalidRecipient(i);
        }
    }

    function _begin(bytes32 distributionId, ActionKind actionKind, uint256 recipientCount)
        private
        returns (bytes32 executionKey, uint256 rmtRetired, uint256 engineRmtBalanceBefore)
    {
        if (distributionId == bytes32(0)) revert InvalidDistributionId();
        _assertRuntimeIdentity();
        engineRmtBalanceBefore = IERC20(rmtToken).balanceOf(address(this));
        executionKey = getExecutionKey(msg.sender, distributionId);
        if (executionConsumed[executionKey]) revert ExecutionAlreadyConsumed();
        executionConsumed[executionKey] = true;
        rmtRetired = quoteUtilityCost(actionKind, recipientCount);
        _retireRmtExact(msg.sender, rmtRetired);
    }

    // slither-disable-start reentrancy-balance
    // The snapshots are exact-transfer security postconditions inside a nonReentrant external entry. The pinned RMT
    // runtime has no callback, and an abnormal distributed token can only invalidate the deltas and revert atomically.
    function _retireRmtExact(address sender, uint256 amount) private {
        IERC20 token = IERC20(rmtToken);
        uint256 senderBefore = token.balanceOf(sender);
        uint256 sinkBefore = token.balanceOf(retirementSink);
        token.safeTransferFrom(sender, retirementSink, amount);
        uint256 senderAfter = token.balanceOf(sender);
        uint256 sinkAfter = token.balanceOf(retirementSink);
        if (
            senderAfter > senderBefore || senderBefore - senderAfter != amount || sinkAfter < sinkBefore
                || sinkAfter - sinkBefore != amount
        ) revert UnsupportedTransferBehavior();
    }

    // slither-disable-end reentrancy-balance

    // slither-disable-start reentrancy-balance
    // This exact-transfer snapshot is evaluated inside a nonReentrant external entry; callback-driven delta changes
    // fail the postcondition and roll back the complete distribution and RMT retirement.
    function _transferERC20Exact(address asset, address sender, address recipient, uint256 amount) private {
        IERC20 token = IERC20(asset);
        uint256 senderBefore = token.balanceOf(sender);
        uint256 recipientBefore = token.balanceOf(recipient);
        token.safeTransferFrom(sender, recipient, amount);
        uint256 senderAfter = token.balanceOf(sender);
        uint256 recipientAfter = token.balanceOf(recipient);
        if (
            senderAfter > senderBefore || senderBefore - senderAfter != amount || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != amount
        ) revert UnsupportedTransferBehavior();
    }
    // slither-disable-end reentrancy-balance

    function _assertEngineERC20Balances(address asset, uint256 engineAssetBalanceBefore, uint256 engineRmtBalanceBefore)
        private
        view
    {
        if (
            IERC20(asset).balanceOf(address(this)) != engineAssetBalanceBefore
                || IERC20(rmtToken).balanceOf(address(this)) != engineRmtBalanceBefore
        ) revert UnsupportedTransferBehavior();
    }

    function _assertRuntimeIdentity() private view {
        if (
            block.chainid != CHAIN_ID || rmtToken.codehash != rmtTokenRuntimeHash
                || retirementSink.codehash != retirementSinkRuntimeHash
        ) {
            revert RuntimeIdentityChanged();
        }
    }

    function _emitDistribution(
        bytes32 executionKey,
        bytes32 distributionId,
        ActionKind actionKind,
        address asset,
        uint256 recipientCount,
        uint256 totalAssetAmount,
        uint256 rmtRetired,
        bytes32 batchHash
    ) private {
        emit DistributionExecuted(
            executionKey,
            msg.sender,
            asset,
            distributionId,
            actionKind,
            recipientCount,
            totalAssetAmount,
            rmtRetired,
            retirementSink,
            batchHash
        );
    }
}
