// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IRMTDistributionEngineV1} from "../src/interfaces/IRMTDistributionEngineV1.sol";
import {RMTDistributionEngineV1} from "../src/RMTDistributionEngineV1.sol";
import {RMTRetirementSinkV1} from "../src/RMTRetirementSinkV1.sol";
import {DistributionERC20Mock} from "./mocks/RMTDistributionEngineV1Mocks.sol";

/// @dev Opt-in Robinhood mainnet fork rehearsal. All state changes remain inside Foundry's local fork.
///      Run with: RMT_RUN_DISTRIBUTION_FORK=true forge test --match-path test/RMTDistributionEngineV1Fork.t.sol -vv
contract RMTDistributionEngineV1ForkTest is Test {
    address private constant OFFICIAL_RMT = 0xdBa33be56C89CC9fc014c4459028d7e5c7878671;
    bytes32 private constant OFFICIAL_RMT_RUNTIME_HASH =
        0x49cd48d0204b35d27e6fca131febe8ce5aff6cd0c2fb6c5c21d5f0ad616e99e9;
    address private constant SENDER = address(0xA11CE);
    uint256 private constant ERC20_COST = 1 ether;

    bool private enabled;
    RMTRetirementSinkV1 private sink;
    RMTDistributionEngineV1 private engine;

    function setUp() external {
        enabled = vm.envOr("RMT_RUN_DISTRIBUTION_FORK", false);
        if (!enabled) return;
        vm.createSelectFork("robinhood_mainnet");
        sink = new RMTRetirementSinkV1();
        engine = new RMTDistributionEngineV1(OFFICIAL_RMT, address(sink), ERC20_COST, 2 ether, 3 ether);
    }

    function testOfficialRmtRuntimeAndAtomicRmtDistribution() external {
        if (!enabled) return;
        assertEq(block.chainid, 4_663);
        assertEq(OFFICIAL_RMT.codehash, OFFICIAL_RMT_RUNTIME_HASH);
        assertEq(engine.rmtToken(), OFFICIAL_RMT);
        assertEq(engine.rmtTokenRuntimeHash(), OFFICIAL_RMT_RUNTIME_HASH);
        assertEq(engine.retirementSink(), address(sink));
        assertEq(engine.retirementSinkRuntimeHash(), address(sink).codehash);

        address[] memory recipients = _recipients(3, 0x10_000);
        uint256 distributedPerRecipient = 2 ether;
        uint256 distributionTotal = distributedPerRecipient * recipients.length;
        uint256 utility = engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, recipients.length);
        deal(OFFICIAL_RMT, SENDER, distributionTotal + utility, true);

        vm.startPrank(SENDER);
        IERC20(OFFICIAL_RMT).approve(address(engine), distributionTotal + utility);
        engine.airdropERC20Equal(keccak256("official-rmt-fork"), OFFICIAL_RMT, recipients, distributedPerRecipient);
        vm.stopPrank();

        assertEq(IERC20(OFFICIAL_RMT).balanceOf(SENDER), 0);
        assertEq(IERC20(OFFICIAL_RMT).balanceOf(address(sink)), utility);
        assertEq(IERC20(OFFICIAL_RMT).balanceOf(address(engine)), 0);
        for (uint256 i; i < recipients.length; ++i) {
            assertEq(IERC20(OFFICIAL_RMT).balanceOf(recipients[i]), distributedPerRecipient);
        }
    }

    function testDistributionFailureRollsBackOfficialRmtRetirement() external {
        if (!enabled) return;
        DistributionERC20Mock asset = new DistributionERC20Mock();
        address[] memory recipients = _recipients(2, 0x20_000);
        uint256 utility = engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, recipients.length);
        asset.mint(SENDER, 20 ether);
        asset.setFailingRecipient(recipients[1]);
        deal(OFFICIAL_RMT, SENDER, utility, true);

        bytes32 distributionId = keccak256("fork-rollback");
        bytes32 executionKey = engine.getExecutionKey(SENDER, distributionId);
        vm.startPrank(SENDER);
        asset.approve(address(engine), 20 ether);
        IERC20(OFFICIAL_RMT).approve(address(engine), utility);
        vm.expectRevert("token revert");
        engine.airdropERC20Equal(distributionId, address(asset), recipients, 10 ether);
        vm.stopPrank();

        assertEq(IERC20(OFFICIAL_RMT).balanceOf(SENDER), utility);
        assertEq(IERC20(OFFICIAL_RMT).balanceOf(address(sink)), 0);
        assertEq(asset.balanceOf(recipients[0]), 0);
        assertFalse(engine.executionConsumed(executionKey));
    }

    function testGasOfficialRmtByBatchSize() external {
        if (!enabled) return;
        _sampleOfficialRmtGas(10, 0x30_000);
        _sampleOfficialRmtGas(25, 0x40_000);
        _sampleOfficialRmtGas(50, 0x50_000);
        _sampleOfficialRmtGas(100, 0x60_000);
        _sampleOfficialRmtGas(200, 0x70_000);
    }

    function _sampleOfficialRmtGas(uint256 count, uint256 recipientBase) private {
        address[] memory recipients = _recipients(count, recipientBase);
        uint256 amount = 1 ether;
        uint256 distributionTotal = amount * count;
        uint256 utility = engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, count);
        deal(OFFICIAL_RMT, SENDER, distributionTotal + utility, true);

        vm.startPrank(SENDER);
        IERC20(OFFICIAL_RMT).approve(address(engine), distributionTotal + utility);
        uint256 gasBefore = gasleft();
        engine.airdropERC20Equal(bytes32(count), OFFICIAL_RMT, recipients, amount);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        emit log_named_uint("official RMT recipient count", count);
        emit log_named_uint("official RMT fork gas used", gasUsed);
        assertGt(gasUsed, 0);
        assertLt(gasUsed, block.gaslimit);
        assertEq(IERC20(OFFICIAL_RMT).balanceOf(address(engine)), 0);
    }

    function _recipients(uint256 count, uint256 recipientBase) private pure returns (address[] memory recipients) {
        recipients = new address[](count);
        for (uint256 i; i < count; ++i) {
            recipients[i] = address(uint160(recipientBase + i));
        }
    }
}
