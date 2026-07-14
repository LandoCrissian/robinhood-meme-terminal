// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {ExpandableGovernance} from "../src/ExpandableGovernance.sol";
import {RMTLaunchFactoryV6} from "../src/RMTLaunchFactoryV6.sol";
import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";
import {RMTLaunchPolicyRegistry} from "../src/RMTLaunchPolicyRegistry.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V5GraduationHook} from "../src/V5GraduationHook.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
import {IRMTLaunchPolicyRegistry} from "../src/interfaces/IRMTLaunchPolicyRegistry.sol";
import {MainnetReleaseConfigV6 as Config} from "./MainnetReleaseConfigV6.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

interface V6ReleaseVm {
    function envUint(string calldata name) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the paused policy-driven V6 foundation and submits only delayed governance proposals.
/// @dev This phase cannot register policies, activate V6, set the default, or reopen launches.
contract DeployMainnetV6OfficialMigration {
    V6ReleaseVm private constant vm = V6ReleaseVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actualChainId);
    error WrongOperator(address actualOperator);
    error MissingContract(address account);
    error WrongActiveFactory(address activeFactory);
    error HookDeploymentFailed(address expectedHook);
    error BindingVerificationFailed();

    event V6FoundationDeployed(
        address indexed factory,
        address indexed policyRegistry,
        address indexed launchGate,
        address adapter,
        address hook,
        address marketImplementation,
        uint256 fairPolicyProposalId,
        uint256 openPolicyProposalId,
        uint256 factoryProposalId
    );

    function run() external {
        if (block.chainid != Config.CHAIN_ID) revert WrongChain(block.chainid);
        address[5] memory requiredContracts = [
            Config.EXPANDABLE_GOVERNANCE,
            Config.LEGACY_IDENTITY_FACTORY,
            Config.VERSION_REGISTRY,
            Config.POOL_MANAGER,
            Config.CREATE2_DEPLOYER
        ];
        for (uint256 i; i < requiredContracts.length; ++i) {
            address required = requiredContracts[i];
            if (required.code.length == 0) revert MissingContract(required);
        }
        address activeFactory = VersionedFactoryRegistry(Config.VERSION_REGISTRY).activeFactory();
        if (activeFactory != Config.LEGACY_IDENTITY_FACTORY) revert WrongActiveFactory(activeFactory);

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        if (deployer != Config.DEVELOPER_OPERATOR) revert WrongOperator(deployer);

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory hookConstructorArgs = abi.encode(IPoolManager(Config.POOL_MANAGER), Config.DEVELOPER_OPERATOR);
        bytes memory hookInitCode = abi.encodePacked(type(V5GraduationHook).creationCode, hookConstructorArgs);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(Config.CREATE2_DEPLOYER, flags, type(V5GraduationHook).creationCode, hookConstructorArgs);

        vm.startBroadcast(privateKey);
        (bool hookDeploymentSuccess,) = Config.CREATE2_DEPLOYER.call(abi.encodePacked(salt, hookInitCode));
        if (!hookDeploymentSuccess || expectedHook.code.length == 0) revert HookDeploymentFailed(expectedHook);
        V5GraduationHook hook = V5GraduationHook(expectedHook);

        V4GraduationAdapter adapter = new V4GraduationAdapter(
            IPoolManager(Config.POOL_MANAGER), hook, Config.V4_POOL_FEE, Config.V4_TICK_SPACING
        );
        hook.bindAdapter(address(adapter));

        RMTLaunchGate launchGate = new RMTLaunchGate(
            Config.EXPANDABLE_GOVERNANCE, Config.INITIAL_GUARDIAN, Config.LAUNCH_UNPAUSE_DELAY
        );
        RMTLaunchPolicyRegistry policyRegistry = new RMTLaunchPolicyRegistry(
            Config.EXPANDABLE_GOVERNANCE, Config.INITIAL_GUARDIAN, Config.GOVERNANCE_DELAY
        );
        CloneBondingCurveMarketV6 marketImplementation = new CloneBondingCurveMarketV6();
        RMTLaunchFactoryV6 factory = new RMTLaunchFactoryV6(
            address(launchGate),
            address(policyRegistry),
            Config.INITIAL_VIRTUAL_ETH_RESERVE,
            Config.INITIAL_VIRTUAL_TOKEN_RESERVE,
            Config.LEGACY_IDENTITY_FACTORY,
            Config.DEVELOPER_OPERATOR
        );
        adapter.bindFactory(address(factory));

        IRMTLaunchPolicyRegistry.LaunchPolicy memory fairPolicy =
            _policy(Config.SIMPLE_FAIR_V1_POLICY_ID, true, address(marketImplementation), address(adapter));
        IRMTLaunchPolicyRegistry.LaunchPolicy memory openPolicy =
            _policy(Config.SIMPLE_OPEN_V1_POLICY_ID, false, address(marketImplementation), address(adapter));

        ExpandableGovernance governance = ExpandableGovernance(payable(Config.EXPANDABLE_GOVERNANCE));
        uint256 fairPolicyProposalId = governance.propose(
            address(policyRegistry),
            0,
            abi.encodeCall(RMTLaunchPolicyRegistry.schedulePolicyRegistration, (fairPolicy))
        );
        uint256 openPolicyProposalId = governance.propose(
            address(policyRegistry),
            0,
            abi.encodeCall(RMTLaunchPolicyRegistry.schedulePolicyRegistration, (openPolicy))
        );
        uint256 factoryProposalId = governance.propose(
            Config.VERSION_REGISTRY,
            0,
            abi.encodeCall(VersionedFactoryRegistry.proposeFactory, (address(factory), Config.FACTORY_VERSION))
        );
        vm.stopBroadcast();

        if (
            address(hook) != expectedHook || hook.adapter() != address(adapter) || adapter.factory() != address(factory)
                || adapter.poolFee() != Config.V4_POOL_FEE || launchGate.governance() != Config.EXPANDABLE_GOVERNANCE
                || launchGate.guardian() != Config.INITIAL_GUARDIAN || !launchGate.launchesPaused()
                || policyRegistry.governance() != Config.EXPANDABLE_GOVERNANCE
                || policyRegistry.guardian() != Config.INITIAL_GUARDIAN || factory.protocolVersion() != 6
                || address(factory.launchGate()) != address(launchGate)
                || address(factory.policyRegistry()) != address(policyRegistry)
                || factory.legacyIdentityFactory() != Config.LEGACY_IDENTITY_FACTORY
                || VersionedFactoryRegistry(Config.VERSION_REGISTRY).activeFactory()
                    != Config.LEGACY_IDENTITY_FACTORY
        ) revert BindingVerificationFailed();

        emit V6FoundationDeployed(
            address(factory),
            address(policyRegistry),
            address(launchGate),
            address(adapter),
            address(hook),
            address(marketImplementation),
            fairPolicyProposalId,
            openPolicyProposalId,
            factoryProposalId
        );
    }

    function _policy(bytes32 policyId, bool fairStart, address marketImplementation, address adapter)
        private pure returns (IRMTLaunchPolicyRegistry.LaunchPolicy memory)
    {
        return IRMTLaunchPolicyRegistry.LaunchPolicy({
            policyId: policyId,
            policyVersion: 1,
            enabled: true,
            publiclySelectable: true,
            curveFeeBps: Config.CURVE_FEE_BPS,
            creatorFeeShareBps: Config.CREATOR_FEE_SHARE_BPS,
            protocolFeeShareBps: Config.PROTOCOL_FEE_SHARE_BPS,
            postGraduationFeeBps: Config.POST_GRADUATION_FEE_BPS,
            graduationTarget: Config.GRADUATION_TARGET,
            fairStartMode: fairStart ? Config.FAIR_START_ENABLED : Config.FAIR_START_DISABLED,
            fairStartDelayBlocks: fairStart ? Config.FAIR_START_DELAY_BLOCKS : 0,
            fairStartDurationBlocks: fairStart ? Config.FAIR_START_DURATION_BLOCKS : 0,
            fairStartMaxTxBps: fairStart ? Config.FAIR_START_MAX_TX_BPS : 0,
            fairStartMaxWalletBps: fairStart ? Config.FAIR_START_MAX_WALLET_BPS : 0,
            marketImplementation: marketImplementation,
            protocolTreasury: Config.PROTOCOL_TREASURY,
            graduationAdapter: adapter
        });
    }
}
