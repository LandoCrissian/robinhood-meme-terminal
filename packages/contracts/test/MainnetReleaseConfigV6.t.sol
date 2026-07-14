// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MainnetReleaseConfigV6 as Config} from "../script/MainnetReleaseConfigV6.sol";

contract MainnetReleaseConfigV6Test {
    function testDeveloperOperatorIsCanonicalRMTMainWallet() public pure {
        require(Config.DEVELOPER_OPERATOR == 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA, "developer operator");
        require(Config.INITIAL_GOVERNANCE == Config.DEVELOPER_OPERATOR, "governance wallet");
        require(Config.INITIAL_GUARDIAN == Config.DEVELOPER_OPERATOR, "guardian wallet");
        require(Config.PROTOCOL_TREASURY == Config.DEVELOPER_OPERATOR, "protocol treasury");
    }

    function testGovernanceAndRegistryDelaysAreNonZero() public pure {
        require(Config.GOVERNANCE_DELAY == 1 days, "governance delay");
        require(Config.REGISTRY_ACTIVATION_DELAY == 2 days, "registry delay");
    }

    function testSimplePolicyFeeSharesBalance() public pure {
        require(Config.SIMPLE_V1_POLICY_ID == keccak256("RMT_SIMPLE_V1"), "policy id");
        require(
            uint256(Config.CREATOR_FEE_SHARE_BPS) + uint256(Config.PROTOCOL_FEE_SHARE_BPS) == 10_000,
            "fee shares"
        );
        require(Config.CURVE_FEE_BPS == 100, "curve fee");
        require(Config.POST_GRADUATION_FEE_BPS == 50, "post graduation fee");
    }
}
