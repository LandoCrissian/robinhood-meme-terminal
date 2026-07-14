// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MainnetReleaseConfig as Config} from "../script/MainnetReleaseConfig.sol";

contract MainnetReleaseConfigTest {
    function testCanonicalRobinhoodAndUniswapConfiguration() public pure {
        require(Config.CHAIN_ID == 4_663, "chain id");
        require(Config.POOL_MANAGER == 0x8366a39CC670B4001A1121B8F6A443A643e40951, "pool manager");
        require(Config.CREATE2_DEPLOYER == 0x4e59b44847b379578588920cA78FbF26c0B4956C, "create2");
        require(Config.V4_POOL_FEE == 10_000, "pool fee");
        require(Config.V4_TICK_SPACING == 200, "tick spacing");
    }

    function testEconomicsRemainWithinReviewedBounds() public pure {
        require(Config.MARKET_FEE_BPS == 100, "market fee");
        require(Config.MARKET_FEE_BPS <= 100, "fee cap");
        require(Config.INITIAL_VIRTUAL_ETH_RESERVE == 0.3 ether, "virtual eth");
        require(Config.INITIAL_VIRTUAL_TOKEN_RESERVE == 1_017_500_000 ether, "virtual token");
        require(Config.INITIAL_VIRTUAL_TOKEN_RESERVE > 1_000_000_000 ether, "inventory buffer");
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
