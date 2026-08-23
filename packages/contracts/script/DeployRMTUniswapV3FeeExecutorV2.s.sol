// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTUniswapV3FeeExecutorV2} from "../src/RMTUniswapV3FeeExecutorV2.sol";
import {RMTUniswapV3FeeExecutorV2Deployment as Deployment} from "./RMTUniswapV3FeeExecutorV2Deployment.sol";

interface RMTUniswapV3V2DeployVm {
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function envUint(string calldata name) external returns (uint256 value);
    function envBytes32(string calldata name) external returns (bytes32 value);
    function load(address target, bytes32 slot) external view returns (bytes32 value);
    function rpc(string calldata method, string calldata params) external returns (bytes memory data);
    function startBroadcast(address signer) external;
    function stopBroadcast() external;
}

interface RMTUniswapV3V2DeployRouterState {
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

/// @notice Lease-like fail-closed deterministic deployment script for a future owner-authorized release.
/// @dev Reads no private key. A future broadcast must use an external Foundry signer for ADMIN_DEPLOYER.
contract DeployRMTUniswapV3FeeExecutorV2 {
    RMTUniswapV3V2DeployVm private constant vm =
        RMTUniswapV3V2DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant EIP1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    error DeploymentAuthorizationRequired();
    error WrongChain(uint256 actualChainId);
    error DeploymentInputMismatch();
    error LiveDependencyMismatch();
    error DeploymentFailed();
    error DeploymentVerificationFailed();

    event RMTUniswapV3FeeExecutorV2Deployed(
        address indexed executor,
        address indexed deployer,
        address indexed treasury,
        bytes32 policyHash,
        bytes32 salt,
        bytes32 initCodeHash,
        bytes32 runtimeHash,
        uint256 policyFromBlock,
        uint256 policyBeforeBlock
    );

    function run() external returns (address executor) {
        if (!vm.envOr("RMT_UNISWAP_V3_V2_DEPLOYMENT_AUTHORIZED", false)) {
            revert DeploymentAuthorizationRequired();
        }
        if (block.chainid != Deployment.CHAIN_ID) revert WrongChain(block.chainid);
        _assertExplicitConstants();

        address treasury = vm.envAddress("RMT_UNISWAP_V3_V2_TREASURY");
        uint256 fromBlock = vm.envUint("RMT_UNISWAP_V3_V2_POLICY_FROM_BLOCK");
        uint256 beforeBlock = vm.envUint("RMT_UNISWAP_V3_V2_POLICY_BEFORE_BLOCK");
        Deployment.Plan memory deploymentPlan = Deployment.plan(treasury, fromBlock, beforeBlock);
        _assertPlan(deploymentPlan);
        _assertLiveDependencies();

        vm.startBroadcast(Deployment.ADMIN_DEPLOYER);
        (bool success,) = Deployment.DETERMINISTIC_FACTORY.call(Deployment.deploymentCalldata(deploymentPlan));
        vm.stopBroadcast();
        if (!success || deploymentPlan.predictedExecutor.code.length == 0) revert DeploymentFailed();
        executor = deploymentPlan.predictedExecutor;

        bytes32 expectedRuntimeHash = vm.envBytes32("RMT_UNISWAP_V3_V2_EXPECTED_RUNTIME_HASH");
        RMTUniswapV3FeeExecutorV2 deployed = RMTUniswapV3FeeExecutorV2(payable(executor));
        if (
            executor.codehash != expectedRuntimeHash || deployed.treasury() != treasury
                || deployed.policyHash() != deploymentPlan.policyHash || deployed.policyFromBlock() != fromBlock
                || deployed.policyBeforeBlock() != beforeBlock || deployed.router() != Deployment.ROUTER
                || deployed.factory() != Deployment.FACTORY || deployed.weth() != Deployment.WETH
                || deployed.wethImplementation() != Deployment.WETH_IMPLEMENTATION
        ) revert DeploymentVerificationFailed();

        emit RMTUniswapV3FeeExecutorV2Deployed(
            executor,
            Deployment.ADMIN_DEPLOYER,
            treasury,
            deploymentPlan.policyHash,
            deploymentPlan.salt,
            deploymentPlan.initCodeHash,
            executor.codehash,
            fromBlock,
            beforeBlock
        );
    }

    function _assertExplicitConstants() private {
        if (
            vm.envUint("RMT_UNISWAP_V3_V2_CHAIN_ID") != Deployment.CHAIN_ID
                || vm.envAddress("RMT_UNISWAP_V3_V2_DEPLOYER") != Deployment.ADMIN_DEPLOYER
                || vm.envAddress("RMT_UNISWAP_V3_V2_ROUTER") != Deployment.ROUTER
                || vm.envBytes32("RMT_UNISWAP_V3_V2_ROUTER_RUNTIME_HASH") != Deployment.ROUTER_RUNTIME_HASH
                || vm.envAddress("RMT_UNISWAP_V3_V2_FACTORY") != Deployment.FACTORY
                || vm.envBytes32("RMT_UNISWAP_V3_V2_FACTORY_RUNTIME_HASH") != Deployment.FACTORY_RUNTIME_HASH
                || vm.envAddress("RMT_UNISWAP_V3_V2_WETH") != Deployment.WETH
                || vm.envBytes32("RMT_UNISWAP_V3_V2_WETH_RUNTIME_HASH") != Deployment.WETH_RUNTIME_HASH
                || vm.envAddress("RMT_UNISWAP_V3_V2_WETH_IMPLEMENTATION") != Deployment.WETH_IMPLEMENTATION
                || vm.envBytes32("RMT_UNISWAP_V3_V2_WETH_IMPLEMENTATION_RUNTIME_HASH")
                    != Deployment.WETH_IMPLEMENTATION_RUNTIME_HASH
                || vm.envAddress("RMT_UNISWAP_V3_V2_CREATE2_FACTORY") != Deployment.DETERMINISTIC_FACTORY
                || vm.envBytes32("RMT_UNISWAP_V3_V2_CREATE2_FACTORY_RUNTIME_HASH")
                    != Deployment.DETERMINISTIC_FACTORY_RUNTIME_HASH
        ) revert DeploymentInputMismatch();
    }

    function _assertPlan(Deployment.Plan memory deploymentPlan) private {
        if (
            vm.envBytes32("RMT_UNISWAP_V3_V2_POLICY_HASH") != deploymentPlan.policyHash
                || vm.envBytes32("RMT_UNISWAP_V3_V2_CONSTRUCTOR_ARGS_HASH") != deploymentPlan.constructorArgsHash
                || vm.envBytes32("RMT_UNISWAP_V3_V2_CREATION_CODE_HASH") != deploymentPlan.creationCodeHash
                || vm.envBytes32("RMT_UNISWAP_V3_V2_INIT_CODE_HASH") != deploymentPlan.initCodeHash
                || vm.envBytes32("RMT_UNISWAP_V3_V2_CREATE2_SALT") != deploymentPlan.salt
                || vm.envAddress("RMT_UNISWAP_V3_V2_EXPECTED_EXECUTOR") != deploymentPlan.predictedExecutor
        ) revert DeploymentInputMismatch();
    }

    function _assertLiveDependencies() private {
        address currentWethImplementation =
            address(uint160(uint256(vm.load(Deployment.WETH, EIP1967_IMPLEMENTATION_SLOT))));
        bytes memory arbSysResult =
            vm.rpc("eth_call", '[{"to":"0x0000000000000000000000000000000000000064","data":"0xa3b1b31d"},"latest"]');
        uint256 l2Block = abi.decode(arbSysResult, (uint256));
        if (
            Deployment.ROUTER.codehash != Deployment.ROUTER_RUNTIME_HASH
                || Deployment.FACTORY.codehash != Deployment.FACTORY_RUNTIME_HASH
                || Deployment.WETH.codehash != Deployment.WETH_RUNTIME_HASH
                || Deployment.WETH_IMPLEMENTATION.codehash != Deployment.WETH_IMPLEMENTATION_RUNTIME_HASH
                || Deployment.DETERMINISTIC_FACTORY.codehash != Deployment.DETERMINISTIC_FACTORY_RUNTIME_HASH
                || RMTUniswapV3V2DeployRouterState(Deployment.ROUTER).factory() != Deployment.FACTORY
                || RMTUniswapV3V2DeployRouterState(Deployment.ROUTER).WETH9() != Deployment.WETH
                || currentWethImplementation != Deployment.WETH_IMPLEMENTATION || l2Block == 0
        ) revert LiveDependencyMismatch();
    }
}
