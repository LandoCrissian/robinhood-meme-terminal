// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {RMTSushiDeadlineGuard} from "../src/RMTSushiDeadlineGuard.sol";

/// @notice Deploys the reviewed, ownerless Sushi deadline boundary on Robinhood Chain mainnet.
/// @dev This script broadcasts only when the operator explicitly supplies --broadcast and a deployer key.
contract DeployRMTSushiDeadlineGuard is Script {
    address private constant RED_SNWAPPER = 0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A;
    address private constant ROUTE_EXECUTOR = 0x0e867974275Cd31C25015C2753C9d75F9f355379;
    bytes32 private constant RED_SNWAPPER_CODE_HASH =
        0x4b299d0674c86f701924420b3c90e4eb8efcc49f7865cc9680ee631ec7048b97;
    bytes32 private constant ROUTE_EXECUTOR_CODE_HASH =
        0x57d45a1dce631a859bd1780826e0fbb9a7489650453406e0dc593724eca6cb6b;
    bytes4 private constant ROUTE_EXECUTOR_ENTRYPOINT = 0x6be92b89;

    function run() external returns (RMTSushiDeadlineGuard guard) {
        require(block.chainid == 4_663, "wrong chain");
        require(RED_SNWAPPER.codehash == RED_SNWAPPER_CODE_HASH, "RedSnwapper code drift");
        require(ROUTE_EXECUTOR.codehash == ROUTE_EXECUTOR_CODE_HASH, "route executor code drift");

        vm.startBroadcast();
        guard = new RMTSushiDeadlineGuard(
            RED_SNWAPPER, ROUTE_EXECUTOR, RED_SNWAPPER_CODE_HASH, ROUTE_EXECUTOR_CODE_HASH, ROUTE_EXECUTOR_ENTRYPOINT
        );
        vm.stopBroadcast();

        require(guard.redSnwapper() == RED_SNWAPPER, "RedSnwapper binding");
        require(guard.routeExecutor() == ROUTE_EXECUTOR, "route executor binding");
        require(guard.redSnwapperCodeHash() == RED_SNWAPPER_CODE_HASH, "RedSnwapper hash binding");
        require(guard.routeExecutorCodeHash() == ROUTE_EXECUTOR_CODE_HASH, "executor hash binding");
        require(guard.routeExecutorEntrypoint() == ROUTE_EXECUTOR_ENTRYPOINT, "entrypoint binding");
        console2.log("RMTSushiDeadlineGuard", address(guard));
        console2.logBytes32(address(guard).codehash);
    }
}
