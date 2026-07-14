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
        require(Config.SIMPLE_FAIR_V1_POLICY_ID == keccak256("RMT_SIMPLE_FAIR_V1"), "fair policy id");
        require(Config.SIMPLE_OPEN_V1_POLICY_ID == keccak256("RMT_SIMPLE_OPEN_V1"), "open policy id");
        require(Config.DEFAULT_POLICY_ID == Config.SIMPLE_FAIR_V1_POLICY_ID, "default policy id");
        require(
            uint256(Config.CREATOR_FEE_SHARE_BPS) + uint256(Config.PROTOCOL_FEE_SHARE_BPS) == 10_000,
            "fee shares"
        );
        require(Config.CURVE_FEE_BPS == 100, "curve fee");
        require(Config.POST_GRADUATION_FEE_BPS == 50, "post graduation fee");
        require(Config.V4_POOL_FEE == uint24(Config.POST_GRADUATION_FEE_BPS) * 100, "V4 fee mismatch");
        require(Config.V4_TICK_SPACING == 200, "V4 tick spacing");
    }

    function testGraduationValuationAndPoolPriceStayAligned() public pure {
        uint256 supply = 1_000_000_000 ether;
        uint256 invariant = Config.INITIAL_VIRTUAL_ETH_RESERVE * Config.INITIAL_VIRTUAL_TOKEN_RESERVE;
        uint256 virtualEthAtGraduation = Config.INITIAL_VIRTUAL_ETH_RESERVE + Config.GRADUATION_TARGET;
        uint256 virtualTokensAtGraduation = invariant / virtualEthAtGraduation;
        uint256 tokensSold = Config.INITIAL_VIRTUAL_TOKEN_RESERVE - virtualTokensAtGraduation;
        uint256 poolTokens = supply - tokensSold;

        uint256 curveFdvEth = (virtualEthAtGraduation * supply) / virtualTokensAtGraduation;
        uint256 poolFdvEth = (Config.GRADUATION_TARGET * supply) / poolTokens;
        require(curveFdvEth >= 17 ether && curveFdvEth <= 18 ether, "graduation valuation");
        uint256 difference = curveFdvEth > poolFdvEth ? curveFdvEth - poolFdvEth : poolFdvEth - curveFdvEth;
        require((difference * 10_000) / curveFdvEth <= 50, "graduation price discontinuity");
    }
}
