// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";
import {RMTLaunchFactoryV6} from "../src/RMTLaunchFactoryV6.sol";
import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";
import {RMTLaunchPolicyRegistry} from "../src/RMTLaunchPolicyRegistry.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V5GraduationHook} from "../src/V5GraduationHook.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
import {IRMTLaunchFactoryV6} from "../src/interfaces/IRMTLaunchFactoryV6.sol";
import {IRMTLaunchPolicyRegistry} from "../src/interfaces/IRMTLaunchPolicyRegistry.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

interface IV6ForkVm {
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function deal(address account, uint256 balance) external;
    function roll(uint256 newHeight) external;
    function warp(uint256 newTimestamp) external;
}

contract V6ForkLegacyIdentity {
    function isNameUsed(string calldata name) external pure returns (bool) {
        return keccak256(bytes(name)) == keccak256("Robinhood Meme Terminal");
    }

    function isSymbolUsed(string calldata symbol) external pure returns (bool) {
        return keccak256(bytes(symbol)) == keccak256("RMT");
    }
}

contract V6ForkCollector {
    function collect(V4GraduationAdapter adapter, address token)
        external returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        return adapter.collectFees(token);
    }
}

/// @notice Deploys the complete V6 foundation against Robinhood's canonical V4 PoolManager on a fork.
/// @dev No transaction is broadcast. The test covers delayed policies, delayed activation, Fair Start,
///      official identity migration, graduation, two-way V4 trading, fee routing, and principal locking.
contract V6MainnetForkTest {
    IV6ForkVm private constant vm = IV6ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    IPoolManager private constant POOL_MANAGER =
        IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    bytes32 private constant FAIR_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    bytes32 private constant OPEN_POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");
    bytes32 private constant VERSION = keccak256("RMT_FACTORY_V6");

    receive() external payable {}

    function testV6LaunchesGraduatesTradesAndRoutesLockedPositionFees() public {
        string memory rpcUrl = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        vm.deal(address(this), 100 ether);
        require(address(POOL_MANAGER).code.length != 0, "canonical PoolManager missing");

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(POOL_MANAGER, address(this));
        (address expectedHook, bytes32 salt) =
            HookMiner.find(address(this), flags, type(V5GraduationHook).creationCode, constructorArgs);
        V5GraduationHook hook = new V5GraduationHook{salt: salt}(POOL_MANAGER, address(this));
        require(address(hook) == expectedHook, "hook address flags");

        V4GraduationAdapter adapter = new V4GraduationAdapter(POOL_MANAGER, hook, 5_000, 200);
        hook.bindAdapter(address(adapter));
        RMTLaunchGate gate = new RMTLaunchGate(address(this), address(this), 1 days);
        RMTLaunchPolicyRegistry policies = new RMTLaunchPolicyRegistry(address(this), address(this), 1 days);
        CloneBondingCurveMarketV6 marketImplementation = new CloneBondingCurveMarketV6();
        V6ForkLegacyIdentity legacy = new V6ForkLegacyIdentity();
        RMTLaunchFactoryV6 factory = new RMTLaunchFactoryV6(
            address(gate), address(policies), 0.3 ether, 1_017_500_000 ether, address(legacy), address(this)
        );
        adapter.bindFactory(address(factory));

        IRMTLaunchPolicyRegistry.LaunchPolicy memory fairPolicy =
            _policy(FAIR_POLICY_ID, true, address(marketImplementation), address(adapter));
        IRMTLaunchPolicyRegistry.LaunchPolicy memory openPolicy =
            _policy(OPEN_POLICY_ID, false, address(marketImplementation), address(adapter));
        bytes32 fairRegistration = policies.schedulePolicyRegistration(fairPolicy);
        bytes32 openRegistration = policies.schedulePolicyRegistration(openPolicy);
        uint64 fairRegistrationTime = policies.scheduledOperations(fairRegistration);
        require(fairRegistrationTime == policies.scheduledOperations(openRegistration), "policy delay mismatch");
        vm.warp(fairRegistrationTime);
        policies.executePolicyRegistration(fairPolicy);
        policies.executePolicyRegistration(openPolicy);
        bytes32 defaultOperation = policies.scheduleDefaultPolicy(FAIR_POLICY_ID);
        vm.warp(policies.scheduledOperations(defaultOperation));
        policies.executeDefaultPolicy(FAIR_POLICY_ID);

        VersionedFactoryRegistry versionRegistry =
            new VersionedFactoryRegistry(address(this), 2 days, address(legacy), keccak256("RMT_FACTORY_V5"));
        versionRegistry.proposeFactory(address(factory), VERSION);
        vm.warp(versionRegistry.pendingActivationTime());
        versionRegistry.activateFactory();
        require(versionRegistry.activeFactory() == address(factory), "V6 registry activation");
        require(gate.launchesPaused(), "gate opened during activation");

        uint64 unpauseTime = gate.scheduleUnpause();
        vm.warp(unpauseTime);
        gate.executeUnpause();

        (address officialToken, address fairMarket,) = factory.launchSimple(
            "Robinhood Meme Terminal", "RMT", "ipfs://official-rmt-v6-fork"
        );
        IRMTLaunchFactoryV6.LaunchView memory official = factory.getLaunch(0);
        require(official.officialMigration, "official identity not migrated");
        require(official.token == officialToken, "official token record");

        CloneBondingCurveMarketV6 fairCurve = CloneBondingCurveMarketV6(payable(fairMarket));
        (bool earlyBuy,) = fairMarket.call{value: 0.001 ether}(
            abi.encodeCall(fairCurve.buy, (address(this), 0, block.timestamp + 10 minutes))
        );
        require(!earlyBuy, "Fair Start delay bypassed");
        vm.roll(block.number + 1);
        (uint256 fairTokens,) = fairCurve.quoteBuy(0.001 ether);
        require(fairTokens != 0 && fairTokens <= 10_000_000 ether, "Fair Start quote");
        fairCurve.buy{value: 0.001 ether}(address(this), fairTokens, block.timestamp + 10 minutes);
        (bool sameBlockBuy,) = fairMarket.call{value: 0.001 ether}(
            abi.encodeCall(fairCurve.buy, (address(this), 0, block.timestamp + 10 minutes))
        );
        require(!sameBlockBuy, "Fair Start block limit bypassed");

        (address tokenAddress, address marketAddress, address splitterAddress) =
            factory.launch(OPEN_POLICY_ID, "V6 Fork Graduation", "V6FG", "ipfs://v6-fork-graduation");
        CloneFixedSupplyMemeToken token = CloneFixedSupplyMemeToken(tokenAddress);
        CloneBondingCurveMarketV6 curve = CloneBondingCurveMarketV6(payable(marketAddress));
        DirectLaunchFeeSplitter splitter = DirectLaunchFeeSplitter(payable(splitterAddress));

        (uint256 tokensOut,) = curve.quoteBuy(2.1 ether);
        curve.buy{value: 2.1 ether}(address(this), tokensOut, block.timestamp + 10 minutes);
        require(curve.graduated(), "V6 curve did not graduate");
        (address pool, uint256 liquidity) = curve.migrateLiquidity();
        require(pool == address(POOL_MANAGER), "wrong V4 PoolManager");
        require(liquidity != 0, "zero V4 liquidity");
        require(adapter.isGraduated(tokenAddress), "adapter graduation missing");
        require(address(curve).balance == 0, "market retained ETH");
        require(token.balanceOf(address(curve)) == 0, "market retained tokens");

        bytes32 poolIdValue = PoolId.unwrap(adapter.poolIds(tokenAddress));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(tokenAddress),
            fee: adapter.poolFee(),
            tickSpacing: adapter.tickSpacing(),
            hooks: IHooks(address(hook))
        });
        int24 tickLower = TickMath.minUsableTick(adapter.tickSpacing());
        int24 tickUpper = TickMath.maxUsableTick(adapter.tickSpacing());
        (uint128 liquidityBefore,,) = StateLibrary.getPositionInfo(
            POOL_MANAGER, PoolId.wrap(poolIdValue), address(adapter), tickLower, tickUpper, bytes32(0)
        );

        PoolSwapTest router = new PoolSwapTest(POOL_MANAGER);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        uint256 beforeTokenSwap = token.balanceOf(address(this));
        router.swap{value: 0.1 ether}(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(0.1 ether),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
        uint256 receivedTokens = token.balanceOf(address(this)) - beforeTokenSwap;
        require(receivedTokens != 0, "V4 buy returned no tokens");
        require(token.approve(address(router), receivedTokens / 2), "router approval");
        router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(receivedTokens / 2),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );

        V6ForkCollector collector = new V6ForkCollector();
        (uint256 nativeFees, uint256 tokenFees) = collector.collect(adapter, tokenAddress);
        (uint128 liquidityAfter,,) = StateLibrary.getPositionInfo(
            POOL_MANAGER, PoolId.wrap(poolIdValue), address(adapter), tickLower, tickUpper, bytes32(0)
        );
        require(nativeFees != 0 && tokenFees != 0, "both fee currencies not collected");
        require(splitter.totalReceived() >= nativeFees, "native V4 fees not routed");
        require(splitter.totalTokenReceived(tokenAddress) == tokenFees, "token V4 fees not routed");
        require(address(collector).balance == 0 && token.balanceOf(address(collector)) == 0, "collector redirected fees");
        require(liquidityAfter == liquidityBefore, "locked principal changed");
        require(liquidityAfter == adapter.lockedLiquidity(tokenAddress), "locked liquidity mismatch");
        require(address(adapter).balance == 0 && token.balanceOf(address(adapter)) == 0, "adapter retained fees");
    }

    function _policy(bytes32 policyId, bool fairStart, address marketImplementation, address adapter)
        private pure returns (IRMTLaunchPolicyRegistry.LaunchPolicy memory)
    {
        return IRMTLaunchPolicyRegistry.LaunchPolicy({
            policyId: policyId,
            policyVersion: 1,
            enabled: true,
            publiclySelectable: true,
            curveFeeBps: 100,
            creatorFeeShareBps: 7_000,
            protocolFeeShareBps: 3_000,
            postGraduationFeeBps: 50,
            graduationTarget: 2 ether,
            fairStartMode: fairStart ? 1 : 0,
            fairStartDelayBlocks: fairStart ? 1 : 0,
            fairStartDurationBlocks: fairStart ? 10 : 0,
            fairStartMaxTxBps: fairStart ? 100 : 0,
            fairStartMaxWalletBps: fairStart ? 300 : 0,
            marketImplementation: marketImplementation,
            protocolTreasury: address(0x7E8E),
            graduationAdapter: adapter
        });
    }
}
