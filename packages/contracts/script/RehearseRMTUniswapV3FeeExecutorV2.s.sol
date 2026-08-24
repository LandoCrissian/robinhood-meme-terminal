// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTUniswapV3FeeExecutorV2} from "../src/RMTUniswapV3FeeExecutorV2.sol";
import {RMTUniswapV3FeeExecutorV2Deployment as Deployment} from "./RMTUniswapV3FeeExecutorV2Deployment.sol";

interface RMTUniswapV3V2RehearsalVm {
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function envUint(string calldata name) external returns (uint256 value);
    function load(address target, bytes32 slot) external view returns (bytes32 value);
    function rpc(string calldata method, string calldata params) external returns (bytes memory data);
}

interface RMTUniswapV3V2RouterState {
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

/// @notice Full no-broadcast rehearsal against a local Robinhood mainnet fork.
/// @dev The CREATE2 factory call mutates only the ephemeral fork unless a separate deploy script is explicitly broadcast.
contract RehearseRMTUniswapV3FeeExecutorV2 {
    RMTUniswapV3V2RehearsalVm private constant vm =
        RMTUniswapV3V2RehearsalVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant EIP1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    error RehearsalModeRequired();
    error WrongChain(uint256 actualChainId);
    error LiveDependencyMismatch();
    error WethImplementationMismatch(address actual);
    error ArbSysUnavailable();
    error Create2RehearsalFailed();
    error ExecutorVerificationFailed();

    event RMTUniswapV3FeeExecutorV2Rehearsed(
        address indexed predictedExecutor,
        bytes32 indexed policyHash,
        bytes32 salt,
        bytes32 constructorArgsHash,
        bytes32 initCodeHash,
        bytes32 deployedRuntimeHash,
        uint256 l2Block
    );

    function run() external returns (address executor) {
        if (!vm.envOr("RMT_UNISWAP_V3_V2_REHEARSAL", false)) revert RehearsalModeRequired();
        if (block.chainid != Deployment.CHAIN_ID) revert WrongChain(block.chainid);

        address treasury = vm.envAddress("RMT_UNISWAP_V3_V2_TREASURY");
        uint256 fromBlock = vm.envUint("RMT_UNISWAP_V3_V2_POLICY_FROM_BLOCK");
        uint256 beforeBlock = vm.envUint("RMT_UNISWAP_V3_V2_POLICY_BEFORE_BLOCK");
        Deployment.Plan memory deploymentPlan = Deployment.plan(treasury, fromBlock, beforeBlock);
        _assertLiveDependencies();

        bytes memory arbSysResult =
            vm.rpc("eth_call", '[{"to":"0x0000000000000000000000000000000000000064","data":"0xa3b1b31d"},"latest"]');
        uint256 l2Block = abi.decode(arbSysResult, (uint256));
        if (l2Block == 0) revert ArbSysUnavailable();

        (bool success,) = Deployment.DETERMINISTIC_FACTORY.call(Deployment.deploymentCalldata(deploymentPlan));
        if (!success || deploymentPlan.predictedExecutor.code.length == 0) revert Create2RehearsalFailed();
        executor = deploymentPlan.predictedExecutor;

        RMTUniswapV3FeeExecutorV2 deployed = RMTUniswapV3FeeExecutorV2(payable(executor));
        if (
            deployed.router() != Deployment.ROUTER || deployed.factory() != Deployment.FACTORY
                || deployed.weth() != Deployment.WETH || deployed.wethImplementation() != Deployment.WETH_IMPLEMENTATION
                || deployed.treasury() != treasury || deployed.policyHash() != deploymentPlan.policyHash
                || deployed.policyFromBlock() != fromBlock || deployed.policyBeforeBlock() != beforeBlock
        ) revert ExecutorVerificationFailed();

        emit RMTUniswapV3FeeExecutorV2Rehearsed(
            executor,
            deploymentPlan.policyHash,
            deploymentPlan.salt,
            deploymentPlan.constructorArgsHash,
            deploymentPlan.initCodeHash,
            executor.codehash,
            l2Block
        );
    }

    function _assertLiveDependencies() private view {
        if (
            Deployment.ROUTER.codehash != Deployment.ROUTER_RUNTIME_HASH
                || Deployment.FACTORY.codehash != Deployment.FACTORY_RUNTIME_HASH
                || Deployment.WETH.codehash != Deployment.WETH_RUNTIME_HASH
                || Deployment.WETH_IMPLEMENTATION.codehash != Deployment.WETH_IMPLEMENTATION_RUNTIME_HASH
                || Deployment.DETERMINISTIC_FACTORY.codehash != Deployment.DETERMINISTIC_FACTORY_RUNTIME_HASH
                || RMTUniswapV3V2RouterState(Deployment.ROUTER).factory() != Deployment.FACTORY
                || RMTUniswapV3V2RouterState(Deployment.ROUTER).WETH9() != Deployment.WETH
        ) revert LiveDependencyMismatch();
        address currentImplementation = address(uint160(uint256(vm.load(Deployment.WETH, EIP1967_IMPLEMENTATION_SLOT))));
        if (currentImplementation != Deployment.WETH_IMPLEMENTATION) {
            revert WethImplementationMismatch(currentImplementation);
        }
    }
}
