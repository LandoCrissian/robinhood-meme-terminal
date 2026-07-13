// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV4} from "../src/LowCostMemeLaunchFactoryV4.sol";
import {CloneBondingCurveMarketV2} from "../src/clone/CloneBondingCurveMarketV2.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IMainnetForkVm {
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function deal(address account, uint256 balance) external;
    function roll(uint256 newHeight) external;
}

interface IERC20ForkProbe {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Exercises graduation against a forked copy of the deployed mainnet V4 factory.
/// @dev This test never broadcasts to Robinhood Chain. It returns early in ordinary unit-test jobs
///      and runs only when ROBINHOOD_MAINNET_RPC_URL is explicitly supplied by the fork workflow.
contract DeployedMainnetGraduationForkTest {
    IMainnetForkVm private constant vm =
        IMainnetForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    LowCostMemeLaunchFactoryV4 private constant FACTORY =
        LowCostMemeLaunchFactoryV4(0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4);
    address private constant CANONICAL_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643E40951;

    receive() external payable {}

    function testDeployedFactoryGraduatesIntoCanonicalV4WithoutRetainedAssets() public {
        string memory rpcUrl = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);

        require(address(FACTORY).code.length != 0, "deployed factory missing");
        uint256 launchCountBefore = FACTORY.launchCount();

        (address token, address market,) = FACTORY.launchSimple(
            "RMT Fork Graduation Probe",
            "RMFGP",
            "data:application/json,%7B%22name%22%3A%22RMT%20Fork%20Graduation%20Probe%22%7D"
        );

        require(FACTORY.launchCount() == launchCountBefore + 1, "fork launch not recorded");
        CloneBondingCurveMarketV2 curve = CloneBondingCurveMarketV2(payable(market));
        V4GraduationAdapter adapter = V4GraduationAdapter(payable(address(curve.graduationAdapter())));
        V4GraduationHook hook = adapter.hook();
        PoolId poolId = adapter.poolIds(token);

        require(adapter.factory() == address(FACTORY), "adapter factory mismatch");
        require(adapter.markets(token) == market, "market binding mismatch");
        require(PoolId.unwrap(poolId) == curve.graduationPoolId(), "pool reservation mismatch");
        require(hook.isReserved(poolId), "pool not reserved");
        require(!hook.isOpen(poolId), "pool opened before graduation");

        uint256 protectionBlocks =
            uint256(curve.FAIR_START_DELAY_BLOCKS()) + uint256(curve.FAIR_START_DURATION_BLOCKS()) + 1;
        vm.roll(block.number + protectionBlocks);
        vm.deal(address(this), 2 ether);

        uint256 buyValue = 1.02 ether;
        (uint256 tokensOut,) = curve.quoteBuy(buyValue);
        require(tokensOut != 0, "zero graduation quote");
        curve.buy{value: buyValue}(address(this), tokensOut, block.timestamp + 10 minutes);

        require(curve.graduated(), "graduation target not reached");
        require(curve.realEthReserve() >= FACTORY.graduationTarget(), "reserve below target");
        require(!curve.liquidityMigrated(), "liquidity migrated early");

        (address poolManager, uint256 liquidity) = curve.migrateLiquidity();

        require(poolManager == CANONICAL_POOL_MANAGER, "wrong V4 PoolManager");
        require(liquidity != 0, "zero V4 liquidity");
        require(curve.liquidityMigrated(), "migration not recorded");
        require(adapter.isGraduated(token), "adapter graduation not recorded");
        require(hook.isOpen(poolId), "reserved pool not opened");
        require(address(market).balance == 0, "market retained ETH");
        require(IERC20ForkProbe(token).balanceOf(market) == 0, "market retained tokens");
        require(address(adapter).balance == 0, "adapter retained ETH");
        require(IERC20ForkProbe(token).balanceOf(address(adapter)) == 0, "adapter retained tokens");
    }
}
