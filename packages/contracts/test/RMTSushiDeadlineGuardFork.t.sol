// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTSushiDeadlineGuard} from "../src/RMTSushiDeadlineGuard.sol";

interface SushiDeadlineForkVm {
    function createSelectFork(string calldata rpcAlias) external returns (uint256 forkId);
    function deal(address account, uint256 amount) external;
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function expectRevert(bytes4 selector) external;
    function prank(address caller) external;
}

/// @dev Opt-in, read-only fork verification against Sushi's live Robinhood Chain contracts.
///      Run with: RMT_RUN_MAINNET_FORK=true forge test --match-path test/RMTSushiDeadlineGuardFork.t.sol -vv
contract RMTSushiDeadlineGuardForkTest {
    SushiDeadlineForkVm private constant vm =
        SushiDeadlineForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant RED_SNWAPPER = 0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A;
    address private constant ROUTE_EXECUTOR = 0x0e867974275Cd31C25015C2753C9d75F9f355379;
    address private constant OFFICIAL_RMT_ASSET = 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C;
    address private constant WALLET = address(0xA11CE);
    bytes32 private constant RED_SNWAPPER_CODE_HASH =
        0x4b299d0674c86f701924420b3c90e4eb8efcc49f7865cc9680ee631ec7048b97;
    bytes32 private constant ROUTE_EXECUTOR_CODE_HASH =
        0x57d45a1dce631a859bd1780826e0fbb9a7489650453406e0dc593724eca6cb6b;
    bytes4 private constant ROUTE_EXECUTOR_ENTRYPOINT = 0x6be92b89;

    bool private enabled;

    function setUp() public {
        enabled = vm.envOr("RMT_RUN_MAINNET_FORK", false);
        if (!enabled) return;
        vm.createSelectFork("robinhood_mainnet");
    }

    function testLiveBindingsAndDeadlineFailureBoundary() public {
        if (!enabled) return;
        require(RED_SNWAPPER.codehash == RED_SNWAPPER_CODE_HASH, "RedSnwapper code changed");
        require(ROUTE_EXECUTOR.codehash == ROUTE_EXECUTOR_CODE_HASH, "route executor code changed");
        require(OFFICIAL_RMT_ASSET.code.length != 0, "RMT token missing");

        RMTSushiDeadlineGuard guard = new RMTSushiDeadlineGuard(
            RED_SNWAPPER, ROUTE_EXECUTOR, RED_SNWAPPER_CODE_HASH, ROUTE_EXECUTOR_CODE_HASH, ROUTE_EXECUTOR_ENTRYPOINT
        );
        vm.deal(WALLET, 1 ether);
        RMTSushiDeadlineGuard.Swap memory expired = RMTSushiDeadlineGuard.Swap({
            tokenIn: guard.NATIVE_TOKEN(),
            tokenOut: OFFICIAL_RMT_ASSET,
            amountIn: 1,
            amountOutMinimum: 1,
            deadline: block.timestamp - 1,
            orderId: keccak256("fork-expired-order"),
            executorData: abi.encodePacked(ROUTE_EXECUTOR_ENTRYPOINT, bytes1(0))
        });

        vm.expectRevert(RMTSushiDeadlineGuard.InvalidSwap.selector);
        vm.prank(WALLET);
        guard.execute{value: 1}(expired);
    }
}
