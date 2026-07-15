// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";
import {ExpandableGovernance} from "../src/ExpandableGovernance.sol";
import {RMTV6Governance} from "../src/RMTV6Governance.sol";
import {RMTLaunchFactoryV6} from "../src/RMTLaunchFactoryV6.sol";
import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";
import {RMTLaunchPolicyRegistry} from "../src/RMTLaunchPolicyRegistry.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V5GraduationHook} from "../src/V5GraduationHook.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
import {IRMTLaunchFactoryV6} from "../src/interfaces/IRMTLaunchFactoryV6.sol";
import {IRMTLaunchPolicyRegistry} from "../src/interfaces/IRMTLaunchPolicyRegistry.sol";
import {MainnetReleaseConfigV6 as Config} from "../script/MainnetReleaseConfigV6.sol";
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
    function prank(address caller) external;
}

contract V6ForkCollector {
    function collect(V4GraduationAdapter adapter, address token)
        external
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        return adapter.collectFees(token);
    }
}

contract V6ForkTreasury {
    receive() external payable {}
}

interface IV6LiveLegacyIdentity {
    function isNameUsed(string calldata name) external view returns (bool);
    function isSymbolUsed(string calldata symbol) external view returns (bool);
}

interface IV6LiveOfficialRMTToken {
    function creator() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @notice Deploys the complete V6 foundation against Robinhood's canonical V4 PoolManager on a fork.
/// @dev No transaction is broadcast. The test covers delayed policies, delayed activation, Fair Start,
///      official identity migration, graduation, two-way V4 trading, fee routing, and principal locking.
contract V6MainnetForkTest {
    IV6ForkVm private constant vm = IV6ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    IPoolManager private constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    bytes32 private constant FAIR_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    bytes32 private constant OPEN_POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");
    bytes32 private constant VERSION = keccak256("RMT_FACTORY_V6");

    receive() external payable {}

    function testLiveV6DependenciesMatchReviewedReleaseConfiguration() public {
        string memory rpcUrl = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);

        require(Config.REGISTRY_GOVERNANCE.code.length != 0, "live registry governance missing");
        require(Config.LEGACY_IDENTITY_FACTORY.code.length != 0, "live V5 factory missing");
        require(Config.OFFICIAL_LEGACY_RMT_TOKEN.code.length != 0, "official legacy RMT token missing");
        require(Config.VERSION_REGISTRY.code.length != 0, "live registry missing");
        require(Config.POOL_MANAGER.code.length != 0, "live PoolManager missing");
        require(Config.CREATE2_DEPLOYER.code.length != 0, "live CREATE2 deployer missing");

        ExpandableGovernance governance = ExpandableGovernance(payable(Config.REGISTRY_GOVERNANCE));
        require(governance.isSigner(Config.DEVELOPER_OPERATOR), "RMTMain is not governance signer");
        require(governance.signerCount() == 1, "unexpected governance signer count");
        require(governance.threshold() == 1, "unexpected governance threshold");
        require(governance.executionDelay() == Config.GOVERNANCE_DELAY, "unexpected governance delay");
        require(governance.transactionCount() == 0, "unreviewed live governance proposal");

        VersionedFactoryRegistry registry = VersionedFactoryRegistry(Config.VERSION_REGISTRY);
        require(registry.governance() == Config.REGISTRY_GOVERNANCE, "registry governance mismatch");
        require(registry.activationDelay() == Config.REGISTRY_ACTIVATION_DELAY, "registry delay mismatch");
        require(registry.activeFactory() == Config.LEGACY_IDENTITY_FACTORY, "V5 is not active");
        require(registry.activeVersion() == Config.LEGACY_FACTORY_VERSION, "active version is not V5");
        require(registry.pendingFactory() == address(0), "conflicting pending factory");
        require(registry.pendingVersion() == bytes32(0), "conflicting pending version");
        require(registry.pendingActivationTime() == 0, "conflicting pending activation");

        IV6LiveLegacyIdentity legacy = IV6LiveLegacyIdentity(Config.LEGACY_IDENTITY_FACTORY);
        require(legacy.isNameUsed("Robinhood Meme Terminal"), "official RMT name is not protected");
        require(legacy.isSymbolUsed("RMT"), "official RMT ticker is not protected");
        IV6LiveOfficialRMTToken officialLegacyToken = IV6LiveOfficialRMTToken(Config.OFFICIAL_LEGACY_RMT_TOKEN);
        require(officialLegacyToken.creator() == Config.DEVELOPER_OPERATOR, "official legacy RMT creator mismatch");
        require(
            keccak256(bytes(officialLegacyToken.name())) == keccak256(bytes("Robinhood Meme Terminal")),
            "official legacy RMT name mismatch"
        );
        require(
            keccak256(bytes(officialLegacyToken.symbol())) == keccak256(bytes("RMT")),
            "official legacy RMT ticker mismatch"
        );
    }

    function testV6LaunchesGraduatesTradesAndRoutesLockedPositionFees() public {
        string memory rpcUrl = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        vm.deal(address(this), 100 ether);
        require(address(POOL_MANAGER).code.length != 0, "canonical PoolManager missing");

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.BEFORE_DONATE_FLAG
        );
        bytes memory constructorArgs = abi.encode(POOL_MANAGER, address(this));
        (address expectedHook, bytes32 salt) =
            HookMiner.find(address(this), flags, type(V5GraduationHook).creationCode, constructorArgs);
        V5GraduationHook hook = new V5GraduationHook{salt: salt}(POOL_MANAGER, address(this));
        require(address(hook) == expectedHook, "hook address flags");

        V4GraduationAdapter adapter = new V4GraduationAdapter(POOL_MANAGER, hook, 5_000, 200);
        hook.bindAdapter(address(adapter));
        RMTV6Governance governance = new RMTV6Governance(address(this), 1 days, 7 days);
        ExpandableGovernance registryGovernance = new ExpandableGovernance(address(this), 1 days);
        V6ForkTreasury treasury = new V6ForkTreasury();
        RMTLaunchGate gate = new RMTLaunchGate(address(governance), address(this), 1 days);
        CloneBondingCurveMarketV6 marketImplementation = new CloneBondingCurveMarketV6();
        RMTLaunchPolicyRegistry policies = new RMTLaunchPolicyRegistry(
            address(governance),
            address(this),
            1 days,
            address(treasury),
            address(marketImplementation),
            address(adapter)
        );
        address legacyFactory = Config.LEGACY_IDENTITY_FACTORY;
        require(legacyFactory.code.length != 0, "live V5 identity factory missing");
        VersionedFactoryRegistry versionRegistry = new VersionedFactoryRegistry(
            address(registryGovernance), 2 days, legacyFactory, keccak256("RMT_FACTORY_V5")
        );
        RMTLaunchFactoryV6 factory = new RMTLaunchFactoryV6(
            address(gate),
            address(policies),
            address(versionRegistry),
            0.3 ether,
            1_017_500_000 ether,
            legacyFactory,
            Config.OFFICIAL_LEGACY_RMT_TOKEN,
            Config.DEVELOPER_OPERATOR
        );
        require(factory.creatorPayoutAuthority() == address(governance), "shared governance not derived");
        require(factory.officialLegacyToken() == Config.OFFICIAL_LEGACY_RMT_TOKEN, "official token not bound");
        require(
            factory.officialIdentityMigration().officialLegacyToken() == Config.OFFICIAL_LEGACY_RMT_TOKEN,
            "migration helper token not bound"
        );
        adapter.bindFactory(address(factory));

        IRMTLaunchPolicyRegistry.LaunchPolicy memory fairPolicy =
            _policy(FAIR_POLICY_ID, true, address(marketImplementation), address(adapter), address(treasury));
        IRMTLaunchPolicyRegistry.LaunchPolicy memory openPolicy =
            _policy(OPEN_POLICY_ID, false, address(marketImplementation), address(adapter), address(treasury));
        uint256 fairProposal =
            governance.propose(address(policies), 0, abi.encodeCall(policies.schedulePolicyRegistration, (fairPolicy)));
        uint256 openProposal =
            governance.propose(address(policies), 0, abi.encodeCall(policies.schedulePolicyRegistration, (openPolicy)));
        (bool earlyPolicyExecution,) = address(governance).call(abi.encodeCall(governance.execute, (fairProposal)));
        require(!earlyPolicyExecution, "governance policy delay bypassed");
        vm.warp(block.timestamp + governance.executionDelay());
        bytes32 fairRegistration = abi.decode(governance.execute(fairProposal), (bytes32));
        bytes32 openRegistration = abi.decode(governance.execute(openProposal), (bytes32));
        uint64 fairRegistrationTime = policies.scheduledOperations(fairRegistration);
        require(fairRegistrationTime == policies.scheduledOperations(openRegistration), "policy delay mismatch");
        vm.warp(fairRegistrationTime);
        policies.executePolicyRegistration(fairPolicy);
        policies.executePolicyRegistration(openPolicy);
        uint256 defaultProposal =
            governance.propose(address(policies), 0, abi.encodeCall(policies.scheduleDefaultPolicy, (FAIR_POLICY_ID)));
        vm.warp(block.timestamp + governance.executionDelay());
        bytes32 defaultOperation = abi.decode(governance.execute(defaultProposal), (bytes32));
        vm.warp(policies.scheduledOperations(defaultOperation));
        policies.executeDefaultPolicy(FAIR_POLICY_ID);

        uint256 factoryProposal = registryGovernance.propose(
            address(versionRegistry), 0, abi.encodeCall(versionRegistry.proposeFactory, (address(factory), VERSION))
        );
        (bool earlyFactoryProposal,) =
            address(registryGovernance).call(abi.encodeCall(registryGovernance.execute, (factoryProposal)));
        require(!earlyFactoryProposal, "factory governance delay bypassed");
        vm.warp(block.timestamp + registryGovernance.executionDelay());
        registryGovernance.execute(factoryProposal);
        vm.warp(versionRegistry.pendingActivationTime());
        versionRegistry.activateFactory();
        require(versionRegistry.activeFactory() == address(factory), "V6 registry activation");
        require(gate.launchesPaused(), "gate opened during activation");

        (bool openOfficialMigration,) = address(factory)
            .call(
                abi.encodeCall(
                    factory.launch, (OPEN_POLICY_ID, "Robinhood Meme Terminal", "RMT", "ipfs://wrong-open-policy")
                )
            );
        require(!openOfficialMigration, "official migration accepted non-Fair policy");
        require(!factory.officialIdentityMigration().consumed(), "wrong policy consumed official migration");

        vm.prank(Config.DEVELOPER_OPERATOR);
        (address officialToken, address fairMarket,) = factory.launchOfficialWhilePaused("ipfs://official-rmt-v6-fork");
        IRMTLaunchFactoryV6.LaunchView memory official = factory.getLaunch(0);
        require(official.officialMigration, "official identity not migrated");
        require(official.token == officialToken, "official token record");
        require(gate.launchesPaused(), "official launch reopened public gate");

        uint256 unpauseProposal = governance.propose(address(gate), 0, abi.encodeCall(gate.scheduleUnpause, ()));
        vm.warp(block.timestamp + governance.executionDelay());
        uint64 unpauseTime = abi.decode(governance.execute(unpauseProposal), (uint64));
        vm.warp(unpauseTime);
        gate.executeUnpause();

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
        require(splitter.authorizedMarket() == marketAddress, "splitter market source");
        require(splitter.graduationAdapter() == address(adapter), "splitter adapter source");
        (bool unauthorizedNativeDeposit,) = address(splitter).call{value: 1 wei}("");
        require(!unauthorizedNativeDeposit, "fork unauthorized native fee source");
        (bool unauthorizedTokenDeposit,) =
            address(splitter).call(abi.encodeCall(splitter.depositToken, (tokenAddress, 1 wei)));
        require(!unauthorizedTokenDeposit, "fork unauthorized token fee source");

        (uint256 tokensOut,) = curve.quoteBuy(2.1 ether);
        curve.buy{value: 2.1 ether}(address(this), tokensOut, block.timestamp + 10 minutes);
        require(curve.graduated(), "V6 curve did not graduate");
        (address pool, uint256 liquidity) = curve.migrateLiquidity();
        require(pool == address(POOL_MANAGER), "wrong V4 PoolManager");
        require(liquidity != 0, "zero V4 liquidity");
        require(adapter.isGraduated(tokenAddress), "adapter graduation missing");
        require(address(curve).balance == 0, "market retained ETH");
        require(token.balanceOf(address(curve)) == 0, "market retained tokens");

        (bool creatorChanged,) = address(splitter)
            .call(
                abi.encodeCall(
                    splitter.setCreatorWallet, (payable(address(treasury)), keccak256("documented-rug-evidence"), 0)
                )
            );
        require(!creatorChanged, "creator changed payout recipient");

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
                zeroForOne: true, amountSpecified: -int256(0.1 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
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
        uint256 creatorNativeBefore = address(this).balance;
        uint256 treasuryNativeBefore = address(treasury).balance;
        uint256 creatorTokensBefore = token.balanceOf(address(this));
        uint256 treasuryTokensBefore = token.balanceOf(address(treasury));
        (uint256 nativeFees, uint256 tokenFees) = collector.collect(adapter, tokenAddress);
        uint256 expectedCreatorNative = (nativeFees * 7_000) / 10_000;
        uint256 expectedCreatorTokens = (tokenFees * 7_000) / 10_000;
        require(address(this).balance - creatorNativeBefore == expectedCreatorNative, "creator native 70 percent");
        require(
            address(treasury).balance - treasuryNativeBefore == nativeFees - expectedCreatorNative,
            "RMT native 30 percent"
        );
        require(
            token.balanceOf(address(this)) - creatorTokensBefore == expectedCreatorTokens, "creator token 70 percent"
        );
        require(
            token.balanceOf(address(treasury)) - treasuryTokensBefore == tokenFees - expectedCreatorTokens,
            "RMT token 30 percent"
        );

        bytes32 evidenceHash = keccak256("documented-rug-evidence");
        uint256 redirectProposal = governance.propose(
            address(splitter),
            0,
            abi.encodeCall(splitter.setCreatorWallet, (payable(address(treasury)), evidenceHash, 0))
        );
        (bool earlyRedirect,) = address(governance).call(abi.encodeCall(governance.execute, (redirectProposal)));
        require(!earlyRedirect, "creator redirect governance delay bypassed");
        vm.warp(block.timestamp + governance.executionDelay());
        governance.execute(redirectProposal);
        require(splitter.creator() == address(treasury), "RMT treasury redirect not executed");
        require(splitter.originalCreator() == address(this), "original creator identity changed");

        uint256 beforeSecondBuy = token.balanceOf(address(this));
        router.swap{value: 0.05 ether}(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.05 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
        uint256 secondBuyTokens = token.balanceOf(address(this)) - beforeSecondBuy;
        require(secondBuyTokens != 0, "second V4 buy returned no tokens");
        require(token.approve(address(router), secondBuyTokens / 2), "second router approval");
        router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(secondBuyTokens / 2),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );

        uint256 oldCreatorNativeBefore = address(this).balance;
        uint256 redirectedTreasuryNativeBefore = address(treasury).balance;
        uint256 oldCreatorTokensBefore = token.balanceOf(address(this));
        uint256 redirectedTreasuryTokensBefore = token.balanceOf(address(treasury));
        (uint256 redirectedNativeFees, uint256 redirectedTokenFees) = collector.collect(adapter, tokenAddress);
        require(redirectedNativeFees != 0 && redirectedTokenFees != 0, "redirected fee currencies missing");
        require(address(this).balance == oldCreatorNativeBefore, "old creator received redirected native fees");
        require(token.balanceOf(address(this)) == oldCreatorTokensBefore, "old creator received redirected token fees");
        require(
            address(treasury).balance - redirectedTreasuryNativeBefore == redirectedNativeFees,
            "RMT missed redirected native fees"
        );
        require(
            token.balanceOf(address(treasury)) - redirectedTreasuryTokensBefore == redirectedTokenFees,
            "RMT missed redirected token fees"
        );

        (uint128 liquidityAfter,,) = StateLibrary.getPositionInfo(
            POOL_MANAGER, PoolId.wrap(poolIdValue), address(adapter), tickLower, tickUpper, bytes32(0)
        );
        require(nativeFees != 0 && tokenFees != 0, "both fee currencies not collected");
        require(splitter.totalReceived() >= nativeFees + redirectedNativeFees, "native V4 fees not routed");
        require(
            splitter.totalTokenReceived(tokenAddress) == tokenFees + redirectedTokenFees, "token V4 fees not routed"
        );
        require(
            address(collector).balance == 0 && token.balanceOf(address(collector)) == 0, "collector redirected fees"
        );
        require(liquidityAfter == liquidityBefore, "locked principal changed");
        require(liquidityAfter == adapter.lockedLiquidity(tokenAddress), "locked liquidity mismatch");
        require(address(adapter).balance == adapter.lockedNativeDust(tokenAddress), "adapter native dust changed");
        require(
            token.balanceOf(address(adapter)) == adapter.lockedTokenDust(tokenAddress), "adapter token dust changed"
        );
    }

    function _policy(
        bytes32 policyId,
        bool fairStart,
        address marketImplementation,
        address adapter,
        address protocolTreasury
    ) private pure returns (IRMTLaunchPolicyRegistry.LaunchPolicy memory) {
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
            protocolTreasury: protocolTreasury,
            graduationAdapter: adapter
        });
    }
}
