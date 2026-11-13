// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IRMTLaunchCurveExecution} from "./interfaces/IRMTLaunchCurveExecution.sol";
import {RMTLaunchCurveMathV1} from "./RMTLaunchCurveMathV1.sol";

/// @notice First replaceable quote adapter for the stable V1 curve and ledger.
/// @dev Stateless and invoked only through STATICCALL. No asset or authority is delegated.
contract RMTLaunchCurveExecutionV2 is IRMTLaunchCurveExecution {
    function engineVersion() external pure returns (uint32) {
        return 2;
    }

    function economicRules() external pure returns (bytes32) {
        return RMTLaunchCurveMathV1.ECONOMIC_RULES;
    }

    function quote(QuoteState calldata state)
        external
        pure
        returns (uint256 amountOut, uint256 gross, uint256 fee, uint256 refund)
    {
        return RMTLaunchCurveMathV1.quote(state);
    }
}
