// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV2} from "../src/clone/CloneBondingCurveMarketV2.sol";
import {LowCostMemeLaunchFactoryV4} from "../src/LowCostMemeLaunchFactoryV4.sol";
import {ProtocolRevenueRouter} from "../src/ProtocolRevenueRouter.sol";
import {PurposeRewardsController} from "../src/PurposeRewardsController.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {MainnetReleaseConfig as Config} from "./MainnetReleaseConfig.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

interface MainnetVm {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployMainnetMemeLaunchFactory {
    MainnetVm private constant vm = MainnetVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actualChainId);
    error MissingCanonicalContract(address account);
    error InvalidOperatorAddress();
    error DuplicateRevenueRecipient();
    error HookAddressMismatch();
    error BindingVerificationFailed();

    function run()
        external
        returns (
            V4GraduationHook hook,
            V4GraduationAdapter adapter,
            ProtocolRevenueRouter revenueRouter,
            PurposeRewardsController rewardsController,
            LowCostMemeLaunchFactoryV4 factory,
            VersionedFactoryRegistry registry
        )
    {
        if (block.chainid != Config.CHAIN_ID) revert WrongChain(block.chainid);
        if (Config.POOL_MANAGER.code.length == 0) revert MissingCanonicalContract(Config.POOL_MANAGER);
        if (Config.CREATE2_DEPLOYER.code.length == 0) revert MissingCanonicalContract(Config.CREATE2_DEPLOYER);

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address rewardsGovernance = vm.envAddress("REWARDS_GOVERNANCE");
        address governance = vm.envAddress("FACTORY_GOVERNANCE");
        address[5] memory revenueRecipients = [
            vm.envAddress("TREASURY_RECIPIENT"),
            vm.envAddress("BUYBACK_RESERVE_RECIPIENT"),
            vm.envAddress("GRADUATION_ASSISTANCE_RECIPIENT"),
            vm.envAddress("REFERRAL_RESERVE_RECIPIENT"),
            vm.envAddress("ECOSYSTEM_GROWTH_RECIPIENT")
        ];

        if (deployer == address(0) || rewardsGovernance == address(0) || governance == address(0)) {
            revert InvalidOperatorAddress();
        }
        for (uint256 i; i < revenueRecipients.length; ++i) {
            if (revenueRecipients[i] == address(0)) revert InvalidOperatorAddress();
            for (uint256 j; j < i; ++j) {
                if (revenueRecipients[i] == revenueRecipients[j]) revert DuplicateRevenueRecipient();
            }
        }

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(IPoolManager(Config.POOL_MANAGER), deployer);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(Config.CREATE2_DEPLOYER, flags, type(V4GraduationHook).creationCode, constructorArgs);

        vm.startBroadcast(deployerPrivateKey);
        hook = new V4GraduationHook{salt: salt}(IPoolManager(Config.POOL_MANAGER), deployer);
        if (address(hook) != expectedHook) revert HookAddressMismatch();

        adapter = new V4GraduationAdapter(
            IPoolManager(Config.POOL_MANAGER), hook, Config.V4_POOL_FEE, Config.V4_TICK_SPACING
        );
        hook.bindAdapter(address(adapter));

        revenueRouter = new ProtocolRevenueRouter(revenueRecipients);
        rewardsController =
            new PurposeRewardsController(deployer, rewardsGovernance, Config.REWARD_RELEASE_DELAY);
        factory = new LowCostMemeLaunchFactoryV4(
            address(adapter),
            Config.MARKET_FEE_BPS,
            Config.INITIAL_VIRTUAL_ETH_RESERVE,
            Config.INITIAL_VIRTUAL_TOKEN_RESERVE,
            Config.GRADUATION_TARGET,
            address(rewardsController),
            address(revenueRouter)
        );
        adapter.bindFactory(address(factory));
        rewardsController.bindFactory(address(factory));

        registry = new VersionedFactoryRegistry(
            governance, Config.FACTORY_ACTIVATION_DELAY, address(factory), Config.FACTORY_VERSION
        );
        vm.stopBroadcast();

        CloneBondingCurveMarketV2 marketImplementation =
            CloneBondingCurveMarketV2(payable(factory.marketImplementation()));

        if (
            hook.adapter() != address(adapter) || adapter.factory() != address(factory)
                || address(adapter.poolManager()) != Config.POOL_MANAGER || address(adapter.hook()) != address(hook)
                || factory.graduationAdapter() != address(adapter)
                || factory.platformTreasury() != address(revenueRouter)
                || factory.rewardsController() != address(rewardsController)
                || rewardsController.factory() != address(factory)
                || rewardsController.governance() != rewardsGovernance
                || rewardsController.releaseDelay() != Config.REWARD_RELEASE_DELAY
                || factory.marketFeeBps() != Config.MARKET_FEE_BPS
                || factory.initialVirtualEthReserve() != Config.INITIAL_VIRTUAL_ETH_RESERVE
                || factory.initialVirtualTokenReserve() != Config.INITIAL_VIRTUAL_TOKEN_RESERVE
                || factory.graduationTarget() != Config.GRADUATION_TARGET || registry.governance() != governance
                || registry.activationDelay() != Config.FACTORY_ACTIVATION_DELAY
                || registry.activeFactory() != address(factory) || registry.activeVersion() != Config.FACTORY_VERSION
                || marketImplementation.FAIR_START_DELAY_BLOCKS() != 3
                || marketImplementation.FAIR_START_DURATION_BLOCKS() != 25
                || marketImplementation.FAIR_START_MAX_TX_BPS() != 50
                || marketImplementation.FAIR_START_MAX_WALLET_BPS() != 150
        ) revert BindingVerificationFailed();

        for (uint256 i; i < revenueRecipients.length; ++i) {
            if (revenueRouter.recipients(i) != revenueRecipients[i]) revert BindingVerificationFailed();
        }
    }
}
