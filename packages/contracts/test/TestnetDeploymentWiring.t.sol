// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

contract TestnetDeploymentWiringTest {
    function testMinedHookAndAllBindingsMatchDeploymentPlan() public {
        PoolManager manager = new PoolManager(address(this));
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(IPoolManager(address(manager)), address(this));
        (address expectedHook, bytes32 salt) =
            HookMiner.find(address(this), flags, type(V4GraduationHook).creationCode, constructorArgs);

        V4GraduationHook hook = new V4GraduationHook{salt: salt}(IPoolManager(address(manager)), address(this));
        require(address(hook) == expectedHook, "mined hook address mismatch");

        V4GraduationAdapter adapter = new V4GraduationAdapter(IPoolManager(address(manager)), hook, 10_000, 200);
        hook.bindAdapter(address(adapter));
        MemeLaunchFactory factory =
            new MemeLaunchFactory(address(adapter), 100, 0.01 ether, 1_073_000_000 ether, 0.001 ether);
        adapter.bindFactory(address(factory));

        require(hook.deployer() == address(this), "hook admin mismatch");
        require(hook.adapter() == address(adapter), "hook adapter mismatch");
        require(adapter.factory() == address(factory), "adapter factory mismatch");
        require(address(adapter.poolManager()) == address(manager), "manager mismatch");
        require(address(adapter.hook()) == address(hook), "adapter hook mismatch");
        require(factory.graduationAdapter() == address(adapter), "factory adapter mismatch");
        require(uint160(address(hook)) & uint160((1 << 14) - 1) == flags, "hook flags mismatch");
    }
}
