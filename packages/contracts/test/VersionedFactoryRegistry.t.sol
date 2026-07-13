// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";

interface RegistryVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract RegistryMockFactory {}

contract VersionedFactoryRegistryTest {
    RegistryVm private constant vm = RegistryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private governance = address(0xBEEF);
    RegistryMockFactory private first;
    RegistryMockFactory private second;
    VersionedFactoryRegistry private registry;

    function setUp() public {
        first = new RegistryMockFactory();
        second = new RegistryMockFactory();
        registry = new VersionedFactoryRegistry(governance, 2 days, address(first), keccak256("V1"));
    }

    function testFactoryChangeRequiresGovernanceAndDelay() public {
        (bool unauthorized,) = address(registry).call(
            abi.encodeCall(registry.proposeFactory, (address(second), keccak256("V2")))
        );
        require(!unauthorized, "unauthorized proposal accepted");

        vm.prank(governance);
        registry.proposeFactory(address(second), keccak256("V2"));

        (bool early,) = address(registry).call(abi.encodeCall(registry.activateFactory, ()));
        require(!early, "early activation accepted");

        vm.warp(block.timestamp + 2 days);
        registry.activateFactory();

        require(registry.activeFactory() == address(second), "factory not activated");
        require(registry.activeVersion() == keccak256("V2"), "version not activated");
    }

    function testRegistryCannotMutateFactories() public {
        require(address(first).code.length != 0, "initial factory missing");
        require(address(second).code.length != 0, "future factory missing");

        vm.prank(governance);
        registry.proposeFactory(address(second), keccak256("V2"));
        vm.prank(governance);
        registry.cancelProposal();

        require(registry.activeFactory() == address(first), "active factory changed");
        require(address(first).code.length != 0, "initial factory altered");
        require(address(second).code.length != 0, "future factory altered");
    }
}
