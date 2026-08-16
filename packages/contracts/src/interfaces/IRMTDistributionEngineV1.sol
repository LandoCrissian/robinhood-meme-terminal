// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IRMTDistributionEngineV1 {
    enum ActionKind {
        ERC20_EQUAL,
        ERC20_CUSTOM,
        ERC721,
        ERC1155
    }

    event DistributionExecuted(
        bytes32 indexed executionKey,
        address indexed sender,
        address indexed asset,
        bytes32 distributionId,
        ActionKind actionKind,
        uint256 recipientCount,
        uint256 totalAssetAmount,
        uint256 rmtRetired,
        address retirementSink,
        bytes32 batchHash
    );

    function rmtToken() external view returns (address);
    function retirementSink() external view returns (address);
    function rmtTokenRuntimeHash() external view returns (bytes32);
    function retirementSinkRuntimeHash() external view returns (bytes32);
    function erc20CostPerRecipient() external view returns (uint256);
    function erc721CostPerRecipient() external view returns (uint256);
    function erc1155CostPerRecipient() external view returns (uint256);
    function executionConsumed(bytes32 executionKey) external view returns (bool);

    function quoteUtilityCost(ActionKind actionKind, uint256 recipientCount) external view returns (uint256);
    function getExecutionKey(address sender, bytes32 distributionId) external view returns (bytes32);

    function hashERC20EqualBatch(address asset, address[] calldata recipients, uint256 amount)
        external
        pure
        returns (bytes32);

    function hashERC20Batch(address asset, address[] calldata recipients, uint256[] calldata amounts)
        external
        pure
        returns (bytes32);

    function hashERC721Batch(address asset, address[] calldata recipients, uint256[] calldata tokenIds)
        external
        pure
        returns (bytes32);

    function hashERC1155Batch(
        address asset,
        address[] calldata recipients,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external pure returns (bytes32);

    function airdropERC20Equal(bytes32 distributionId, address asset, address[] calldata recipients, uint256 amount)
        external
        returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired);

    function airdropERC20(
        bytes32 distributionId,
        address asset,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired);

    function airdropERC721(
        bytes32 distributionId,
        address asset,
        address[] calldata recipients,
        uint256[] calldata tokenIds
    ) external returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired);

    function airdropERC1155(
        bytes32 distributionId,
        address asset,
        address[] calldata recipients,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external returns (bytes32 executionKey, bytes32 batchHash, uint256 totalAssetAmount, uint256 rmtRetired);
}
