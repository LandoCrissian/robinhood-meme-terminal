// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Shape/provenance rejection is not admission of a price oracle.
/// @dev Every otherwise well-formed observation still ends UNADMITTED. There is
/// no administrator, mutable allowlist or way to turn a caller's assertion of
/// independence into permission to spend. Amounts/prices use integer base units.
library PurchaseEvidenceV2 {
    enum Status { Unadmitted, WrongIdentity, Missing, Future, Stale, Reorged, SameMarket, ThinHistory, ThinLiquidity }
    struct Observation {
        uint256 chainId;
        address token;
        address quoteAsset;
        address source;
        address originMarket;
        bytes32 originPoolId;
        uint64 blockNumber;
        bytes32 blockHash;
        uint48 observedAt;
        uint32 historySeconds;
        uint128 nativeLiquidity;
        // Token base units obtainable per whole native ETH, NOT sqrtPriceX96.
        uint128 tokensPerEth;
    }
    struct Context { address token; address curve; address poolManager; bytes32 poolId; }

    function inspect(Observation calldata o, Context memory c) internal view returns (Status) {
        if (o.chainId != block.chainid || o.token != c.token || o.quoteAsset != address(0)) return Status.WrongIdentity;
        if (o.source == address(0) || o.blockHash == bytes32(0) || o.tokensPerEth == 0) return Status.Missing;
        if (o.blockNumber >= block.number || o.observedAt > block.timestamp) return Status.Future;
        if (block.number - o.blockNumber > 64 || block.timestamp - o.observedAt > 60) return Status.Stale;
        if (blockhash(o.blockNumber) != o.blockHash) return Status.Reorged;
        if (o.source == c.curve || o.source == c.poolManager || o.originMarket == c.curve
            || (c.poolId != bytes32(0) && o.originPoolId == c.poolId)) return Status.SameMarket;
        // Test-only thresholds, NOT approved production economics or proof that
        // another market is independent. A caller can invent every field here.
        if (o.historySeconds < 1 days) return Status.ThinHistory;
        if (o.nativeLiquidity < 2 ether) return Status.ThinLiquidity;
        return Status.Unadmitted;
    }

    function priceDeviationBps(uint128 currentTokensPerEth, uint128 referenceTokensPerEth) internal pure returns (uint256) {
        require(referenceTokensPerEth != 0, "zero reference");
        uint256 difference = currentTokensPerEth > referenceTokensPerEth
            ? uint256(currentTokensPerEth) - referenceTokensPerEth : uint256(referenceTokensPerEth) - currentTokensPerEth;
        // uint128 input bounds make multiplication exact within uint256.
        return difference * 10_000 / referenceTokensPerEth;
    }
}
