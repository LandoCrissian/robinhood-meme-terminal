// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MainnetReleaseConfigV6 as Config} from "../script/MainnetReleaseConfigV6.sol";

contract MainnetReleaseConfigV6Test {
    function testDeveloperOperatorIsCanonicalRMTMainWallet() public pure {
        require(Config.DEVELOPER_OPERATOR == 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA, "developer operator");
        require(
            Config.REGISTRY_GOVERNANCE == 0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953,
            "legacy registry governance"
        );
        require(Config.INITIAL_GUARDIAN == Config.DEVELOPER_OPERATOR, "guardian wallet");
        require(Config.PROTOCOL_TREASURY == Config.DEVELOPER_OPERATOR, "protocol treasury");
        require(Config.LEGACY_IDENTITY_FACTORY == 0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD, "legacy factory");
        require(
            Config.OFFICIAL_LEGACY_RMT_TOKEN == 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C,
            "official legacy RMT token"
        );
        require(Config.VERSION_REGISTRY == 0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1, "version registry");
        require(Config.LEGACY_FACTORY_VERSION == keccak256("RMT_FACTORY_V5"), "legacy factory version");
        require(Config.FACTORY_VERSION == keccak256("RMT_FACTORY_V6"), "factory version");
    }

    function testGovernanceAndRegistryDelaysAreNonZero() public pure {
        require(Config.GOVERNANCE_DELAY == 1 days, "governance delay");
        require(Config.GOVERNANCE_EXECUTION_WINDOW == 7 days, "governance execution window");
        require(Config.REGISTRY_ACTIVATION_DELAY == 2 days, "registry delay");
        require(Config.LAUNCH_UNPAUSE_DELAY == 1 days, "launch unpause delay");
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
        require(Config.CREATOR_FEE_SHARE_BPS == 7_000, "creator fee share");
        require(Config.PROTOCOL_FEE_SHARE_BPS == 3_000, "protocol fee share");
        require(Config.POST_GRADUATION_FEE_BPS == 50, "post graduation fee");
        require(Config.V4_POOL_FEE == uint24(Config.POST_GRADUATION_FEE_BPS) * 100, "V4 fee mismatch");
        require(Config.V4_TICK_SPACING == 200, "V4 tick spacing");
        require(Config.GRADUATION_TARGET == 2 ether, "graduation target");
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
