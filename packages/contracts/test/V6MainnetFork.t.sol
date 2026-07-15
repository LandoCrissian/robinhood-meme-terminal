// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";
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

        require(Config.LEGACY_IDENTITY_FACTORY.code.length != 0, "live V5 factory missing");
        require(Config.OFFICIAL_LEGACY_RMT_TOKEN.code.length != 0, "official legacy RMT token missing");
        require(Config.POOL_MANAGER.code.length != 0, "live PoolManager missing");
        require(Config.CREATE2_DEPLOYER.code.length != 0, "live CREATE2 deployer missing");

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
        RMTLaunchGate gate = new RMTLaunchGate(address(governance), address(this), 1 days);
        CloneBondingCurveMarketV6 marketImplementation = new CloneBondingCurveMarketV6();
        RMTLaunchPolicyRegistry policies = new RMTLaunchPolicyRegistry(
            address(governance),
            address(this),
            1 days,
            address(governance),
            address(marketImplementation),
            address(adapter)
        );
        address legacyFactory = Config.LEGACY_IDENTITY_FACTORY;
        require(legacyFactory.code.length != 0, "live V5 identity factory missing");
        VersionedFactoryRegistry versionRegistry = new VersionedFactoryRegistry(
            address(governance), 2 days, legacyFactory, keccak256("RMT_FACTORY_V5")
        );
        require(versionRegistry.governance() == address(governance), "registry governance mismatch");
        require(versionRegistry.activationDelay() == 2 days, "registry delay mismatch");
        require(versionRegistry.activeFactory() == legacyFactory, "legacy factory not active");
        require(versionRegistry.activeVersion() == keccak256("RMT_FACTORY_V5"), "legacy version not active");
        require(policies.canonicalProtocolTreasury() == address(governance), "protocol treasury mismatch");
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
        require(factory.FACTORY_VERSION() == VERSION, "factory V6 version mismatch");
        require(factory.LEGACY_FACTORY_VERSION() == keccak256("RMT_FACTORY_V5"), "factory V5 anchor mismatch");
        require(factory.officialLegacyToken() == Config.OFFICIAL_LEGACY_RMT_TOKEN, "official token not bound");
        require(
            factory.officialIdentityMigration().officialLegacyToken() == Config.OFFICIAL_LEGACY_RMT_TOKEN,
            "migration helper token not bound"
        );
        adapter.bindFactory(address(factory));

        IRMTLaunchPolicyRegistry.LaunchPolicy memory fairPolicy =
            _policy(FAIR_POLICY_ID, true, address(marketImplementation), address(adapter), address(governance));
        IRMTLaunchPolicyRegistry.LaunchPolicy memory openPolicy =
            _policy(OPEN_POLICY_ID, false, address(marketImplementation), address(adapter), address(governance));
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

        uint256 factoryProposal = governance.propose(
            address(versionRegistry), 0, abi.encodeCall(versionRegistry.proposeFactory, (address(factory), VERSION))
        );
        (bool earlyFactoryProposal,) = address(governance).call(abi.encodeCall(governance.execute, (factoryProposal)));
        require(!earlyFactoryProposal, "factory governance delay bypassed");
        vm.warp(block.timestamp + governance.executionDelay());
        governance.execute(factoryProposal);
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
        require(official.market == fairMarket, "official market record");
        require(official.creator == Config.DEVELOPER_OPERATOR, "official creator record");
        require(gate.launchesPaused(), "official launch reopened public gate");

        address tokenAddress = officialToken;
        address marketAddress = fairMarket;
        address splitterAddress = official.rewardVault;
        CloneFixedSupplyMemeToken token = CloneFixedSupplyMemeToken(tokenAddress);
        CloneBondingCurveMarketV6 curve = CloneBondingCurveMarketV6(payable(marketAddress));
        DirectLaunchFeeSplitter splitter = DirectLaunchFeeSplitter(payable(splitterAddress));
        require(token.creator() == Config.DEVELOPER_OPERATOR, "official token creator mismatch");
        require(token.balanceOf(Config.DEVELOPER_OPERATOR) == 0, "official creator received token allocation");
        require(splitter.originalCreator() == Config.DEVELOPER_OPERATOR, "splitter original creator mismatch");
        require(splitter.creator() == Config.DEVELOPER_OPERATOR, "splitter creator mismatch");
        require(splitter.creatorPayoutAuthority() == address(governance), "splitter authority mismatch");
        require(splitter.protocolTreasury() == address(governance), "splitter treasury mismatch");
        require(splitter.authorizedMarket() == marketAddress, "splitter market source");
        require(splitter.graduationAdapter() == address(adapter), "splitter adapter source");
        (bool unauthorizedNativeDeposit,) = address(splitter).call{value: 1 wei}("");
        require(!unauthorizedNativeDeposit, "fork unauthorized native fee source");
        (bool unauthorizedTokenDeposit,) =
            address(splitter).call(abi.encodeCall(splitter.depositToken, (tokenAddress, 1 wei)));
        require(!unauthorizedTokenDeposit, "fork unauthorized token fee source");

        uint256 unpauseProposal = governance.propose(address(gate), 0, abi.encodeCall(gate.scheduleUnpause, ()));
        vm.warp(block.timestamp + governance.executionDelay());
        uint64 unpauseTime = abi.decode(governance.execute(unpauseProposal), (uint64));
        vm.warp(unpauseTime);
        gate.executeUnpause();
        require(!gate.launchesPaused(), "public launches not reopened");

        (bool earlyBuy,) = fairMarket.call{value: 0.001 ether}(
            abi.encodeCall(curve.buy, (address(this), 0, block.timestamp + 10 minutes))
        );
        require(!earlyBuy, "Fair Start delay bypassed");
        vm.roll(block.number + 1);
        uint256 operatorNativeBeforeCurveFees = Config.DEVELOPER_OPERATOR.balance;
        uint256 governanceNativeBeforeCurveFees = address(governance).balance;
        (uint256 fairTokens,) = curve.quoteBuy(0.001 ether);
        require(fairTokens != 0 && fairTokens <= 10_000_000 ether, "Fair Start quote");
        curve.buy{value: 0.001 ether}(address(this), fairTokens, block.timestamp + 10 minutes);
        (bool sameBlockBuy,) = fairMarket.call{value: 0.001 ether}(
            abi.encodeCall(curve.buy, (address(this), 0, block.timestamp + 10 minutes))
        );
        require(!sameBlockBuy, "Fair Start block limit bypassed");
        vm.roll(curve.fairStartEndsAtBlock());
        (uint256 tokensOut,,,) = curve.quoteBuyExecution(2.1 ether);
        curve.buy{value: 2.1 ether}(address(this), tokensOut, block.timestamp + 10 minutes);
        uint256 totalCurveFees = splitter.totalReceived();
        uint256 expectedCurveCreatorFee = (totalCurveFees * 7_000) / 10_000;
        require(
            Config.DEVELOPER_OPERATOR.balance - operatorNativeBeforeCurveFees == expectedCurveCreatorFee,
            "official creator curve native 70 percent"
        );
        require(
            address(governance).balance - governanceNativeBeforeCurveFees == totalCurveFees - expectedCurveCreatorFee,
            "curve RMT native 30 percent"
        );
        require(totalCurveFees != 0, "curve fee not accounted");
        require(token.balanceOf(Config.DEVELOPER_OPERATOR) == 0, "official creator received curve allocation");
        require(curve.graduated(), "official RMT curve did not graduate");
        (address pool, uint256 liquidity) = curve.migrateLiquidity();
        require(pool == address(POOL_MANAGER), "wrong V4 PoolManager");
        require(liquidity != 0, "zero V4 liquidity");
        require(adapter.isGraduated(tokenAddress), "adapter graduation missing");
        require(address(curve).balance == 0, "market retained ETH");
        require(token.balanceOf(address(curve)) == 0, "market retained tokens");

        vm.prank(Config.DEVELOPER_OPERATOR);
        (bool creatorChanged,) = address(splitter)
            .call(
                abi.encodeCall(
                    splitter.setCreatorWallet,
                    (payable(address(governance)), keccak256("documented-rug-evidence"), 0)
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
        uint256 creatorNativeBefore = Config.DEVELOPER_OPERATOR.balance;
        uint256 governanceNativeBefore = address(governance).balance;
        uint256 creatorTokensBefore = token.balanceOf(Config.DEVELOPER_OPERATOR);
        uint256 governanceTokensBefore = token.balanceOf(address(governance));
        uint256 creatorNativeRemainderBefore = splitter.nativeCreatorShareRemainder(Config.DEVELOPER_OPERATOR);
        uint256 creatorTokenRemainderBefore =
            splitter.tokenCreatorShareRemainder(tokenAddress, Config.DEVELOPER_OPERATOR);
        (uint256 nativeFees, uint256 tokenFees) = collector.collect(adapter, tokenAddress);
        uint256 expectedCreatorNative = _creatorShare(nativeFees, creatorNativeRemainderBefore);
        uint256 expectedCreatorTokens = _creatorShare(tokenFees, creatorTokenRemainderBefore);
        require(
            Config.DEVELOPER_OPERATOR.balance - creatorNativeBefore == expectedCreatorNative,
            "official creator native 70 percent"
        );
        require(
            address(governance).balance - governanceNativeBefore == nativeFees - expectedCreatorNative,
            "RMT native 30 percent"
        );
        require(
            token.balanceOf(Config.DEVELOPER_OPERATOR) - creatorTokensBefore == expectedCreatorTokens,
            "official creator token-fee 70 percent"
        );
        require(
            token.balanceOf(address(governance)) - governanceTokensBefore == tokenFees - expectedCreatorTokens,
            "RMT token 30 percent"
        );

        address feeRecipient = Config.DEVELOPER_OPERATOR;
        uint256 nativeTreasuryAmount = address(governance).balance;
        uint256 tokenTreasuryAmount = token.balanceOf(address(governance));
        require(nativeTreasuryAmount != 0 && tokenTreasuryAmount != 0, "governance fees missing");
        uint256 nativeRecipientBefore = feeRecipient.balance;
        uint256 tokenRecipientBefore = token.balanceOf(feeRecipient);
        address relayer = address(0xB0B);
        uint256 relayerNativeBefore = relayer.balance;
        uint256 relayerTokensBefore = token.balanceOf(relayer);
        uint256 nativeTransferProposal = governance.propose(feeRecipient, nativeTreasuryAmount, "");
        uint256 tokenTransferProposal = governance.propose(
            tokenAddress, 0, abi.encodeCall(token.transfer, (feeRecipient, tokenTreasuryAmount))
        );
        (bool earlyTreasuryTransfer,) =
            address(governance).call(abi.encodeCall(governance.execute, (nativeTransferProposal)));
        require(!earlyTreasuryTransfer, "governance treasury delay bypassed");
        vm.warp(block.timestamp + governance.executionDelay());
        vm.prank(relayer);
        governance.execute(nativeTransferProposal);
        vm.prank(relayer);
        bytes memory tokenTransferResult = governance.execute(tokenTransferProposal);
        require(abi.decode(tokenTransferResult, (bool)), "governance token transfer returned false");
        require(feeRecipient.balance - nativeRecipientBefore == nativeTreasuryAmount, "governance ETH not transferred");
        require(
            token.balanceOf(feeRecipient) - tokenRecipientBefore == tokenTreasuryAmount,
            "governance token fees not transferred"
        );
        require(address(governance).balance == 0, "governance retained transferred ETH");
        require(token.balanceOf(address(governance)) == 0, "governance retained transferred tokens");
        require(relayer.balance == relayerNativeBefore, "permissionless executor received ETH");
        require(token.balanceOf(relayer) == relayerTokensBefore, "permissionless executor received tokens");

        bytes32 evidenceHash = keccak256("documented-rug-evidence");
        uint256 redirectProposal = governance.propose(
            address(splitter),
            0,
            abi.encodeCall(splitter.setCreatorWallet, (payable(address(governance)), evidenceHash, 0))
        );
        (bool earlyRedirect,) = address(governance).call(abi.encodeCall(governance.execute, (redirectProposal)));
        require(!earlyRedirect, "creator redirect governance delay bypassed");
        vm.warp(block.timestamp + governance.executionDelay());
        governance.execute(redirectProposal);
        require(splitter.creator() == address(governance), "RMT treasury redirect not executed");
        require(splitter.originalCreator() == Config.DEVELOPER_OPERATOR, "original creator identity changed");

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

        uint256 oldCreatorNativeBefore = Config.DEVELOPER_OPERATOR.balance;
        uint256 redirectedGovernanceNativeBefore = address(governance).balance;
        uint256 oldCreatorTokensBefore = token.balanceOf(Config.DEVELOPER_OPERATOR);
        uint256 redirectedGovernanceTokensBefore = token.balanceOf(address(governance));
        (uint256 redirectedNativeFees, uint256 redirectedTokenFees) = collector.collect(adapter, tokenAddress);
        require(redirectedNativeFees != 0 && redirectedTokenFees != 0, "redirected fee currencies missing");
        require(
            Config.DEVELOPER_OPERATOR.balance == oldCreatorNativeBefore,
            "old creator received redirected native fees"
        );
        require(
            token.balanceOf(Config.DEVELOPER_OPERATOR) == oldCreatorTokensBefore,
            "old creator received redirected token fees"
        );
        require(
            address(governance).balance - redirectedGovernanceNativeBefore == redirectedNativeFees,
            "RMT missed redirected native fees"
        );
        require(
            token.balanceOf(address(governance)) - redirectedGovernanceTokensBefore == redirectedTokenFees,
            "RMT missed redirected token fees"
        );

        uint256 restoreProposal = governance.propose(
            address(splitter),
            0,
            abi.encodeCall(
                splitter.setCreatorWallet,
                (payable(Config.DEVELOPER_OPERATOR), keccak256("documented-recovery-complete"), 1)
            )
        );
        (bool earlyRestore,) = address(governance).call(abi.encodeCall(governance.execute, (restoreProposal)));
        require(!earlyRestore, "creator restore governance delay bypassed");
        vm.warp(block.timestamp + governance.executionDelay());
        governance.execute(restoreProposal);
        require(splitter.creator() == Config.DEVELOPER_OPERATOR, "original creator payout not restored");
        require(splitter.creatorPayoutNonce() == 2, "creator payout nonce mismatch");

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

    function _creatorShare(uint256 amount, uint256 priorRemainder) private pure returns (uint256 creatorAmount) {
        uint256 numerator = (amount % 10_000) * 7_000 + priorRemainder;
        creatorAmount = (amount / 10_000) * 7_000 + numerator / 10_000;
    }
}
