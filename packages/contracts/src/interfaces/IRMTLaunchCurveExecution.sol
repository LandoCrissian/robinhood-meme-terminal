// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Stateless quote adapter. A curve checks every answer against its immutable rules.
interface IRMTLaunchCurveExecution {
    struct QuoteState {
        uint256 sold;
        uint256 backing;
        uint256 virtualToken;
        uint256 threshold;
        uint256 amountIn;
        bool isBuy;
    }

    function engineVersion() external pure returns (uint32);
    function economicRules() external pure returns (bytes32);
    function quote(QuoteState calldata state)
        external
        pure
        returns (uint256 amountOut, uint256 gross, uint256 fee, uint256 refund);
}
