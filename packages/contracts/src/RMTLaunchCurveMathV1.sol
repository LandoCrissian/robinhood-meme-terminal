// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IRMTLaunchCurveExecution} from "./interfaces/IRMTLaunchCurveExecution.sol";

/// @notice Immutable V1 economic rules. Active quote adapters cannot bypass them.
library RMTLaunchCurveMathV1 {
    bytes32 internal constant ECONOMIC_RULES =
        keccak256("RMTLaunchCurveV1:180%-virtual-token;2ether-virtual-eth;60%-sold;1ether-backing;100bps-gross-ceil");
    uint256 internal constant BPS = 10_000;
    uint256 internal constant TRADE_FEE_BPS = 100;
    uint256 internal constant VIRTUAL_ETH = 2 ether;
    uint256 internal constant GRADUATION_BACKING = 1 ether;

    function quote(IRMTLaunchCurveExecution.QuoteState memory state)
        internal
        pure
        returns (uint256 amountOut, uint256 gross, uint256 fee, uint256 refund)
    {
        if (!state.isBuy) {
            if (state.amountIn == 0 || state.amountIn > state.sold) return (0, 0, 0, 0);
            gross = state.backing - _requiredBacking(state.virtualToken, state.sold - state.amountIn);
            fee = Math.mulDiv(gross, TRADE_FEE_BPS, BPS, Math.Rounding.Ceil);
            return (gross - fee, gross, fee, 0);
        }
        if (state.sold == state.threshold || state.amountIn == 0) return (0, 0, 0, state.amountIn);
        uint256 netBudget = Math.mulDiv(state.amountIn, BPS - TRADE_FEE_BPS, BPS);
        if (netBudget == 0) return (0, 0, 0, state.amountIn);
        uint256 targetBacking = state.backing + Math.min(netBudget, GRADUATION_BACKING - state.backing);
        uint256 newSold =
            state.virtualToken - Math.ceilDiv(VIRTUAL_ETH * state.virtualToken, VIRTUAL_ETH + targetBacking);
        if (newSold <= state.sold) return (0, 0, 0, state.amountIn);
        uint256 backingIn = _requiredBacking(state.virtualToken, newSold) - state.backing;
        if (backingIn == 0) return (0, 0, 0, state.amountIn);
        gross = Math.mulDiv(backingIn, BPS, BPS - TRADE_FEE_BPS, Math.Rounding.Ceil);
        return (newSold - state.sold, gross, gross - backingIn, state.amountIn - gross);
    }

    /// @dev Integer reserve potential is anchored to zero at creation.
    function _requiredBacking(uint256 virtualToken, uint256 sold) private pure returns (uint256) {
        return Math.ceilDiv(VIRTUAL_ETH * virtualToken, virtualToken - sold) - VIRTUAL_ETH;
    }
}
