// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IRMTDistributionEngineV1} from "../src/interfaces/IRMTDistributionEngineV1.sol";
import {RMTDistributionEngineV1} from "../src/RMTDistributionEngineV1.sol";
import {RMTRetirementSinkV1} from "../src/RMTRetirementSinkV1.sol";
import {DistributionERC20Mock} from "./mocks/RMTDistributionEngineV1Mocks.sol";

contract RMTDistributionEngineV1InvariantTest is Test {
    uint256 private constant ERC20_COST = 1 ether;
    address private constant TRADER = address(0xA11CE);
    address private constant VICTIM = address(0xBEEF);
    address private constant ATTACKER = address(0xBAD);

    DistributionERC20Mock private rmt;
    DistributionERC20Mock private asset;
    RMTRetirementSinkV1 private sink;
    RMTDistributionEngineV1 private engine;

    function setUp() external {
        vm.chainId(4_663);
        rmt = new DistributionERC20Mock();
        asset = new DistributionERC20Mock();
        sink = new RMTRetirementSinkV1();
        engine = new RMTDistributionEngineV1(address(rmt), address(sink), ERC20_COST, 2 ether, 3 ether);
    }

    function testFuzzSuccessfulEqualDistributionNeverRetainsAssets(
        uint8 rawCount,
        uint96 rawAmount,
        bytes32 distributionId
    ) external {
        uint256 count = bound(rawCount, 1, 20);
        uint256 amount = bound(rawAmount, 1, 1_000_000 ether);
        if (distributionId == bytes32(0)) distributionId = bytes32(uint256(1));
        uint256 total = amount * count;
        uint256 utility = ERC20_COST * count;
        address[] memory recipients = new address[](count);
        for (uint256 i; i < count; ++i) {
            recipients[i] = address(uint160(0x10_000 + i));
        }

        asset.mint(TRADER, total);
        rmt.mint(TRADER, utility);
        vm.startPrank(TRADER);
        asset.approve(address(engine), total);
        rmt.approve(address(engine), utility);
        engine.airdropERC20Equal(distributionId, address(asset), recipients, amount);
        vm.stopPrank();

        assertEq(asset.balanceOf(TRADER), 0);
        assertEq(rmt.balanceOf(TRADER), 0);
        assertEq(asset.balanceOf(address(engine)), 0);
        assertEq(rmt.balanceOf(address(engine)), 0);
        assertEq(rmt.balanceOf(address(sink)), utility);
        for (uint256 i; i < count; ++i) {
            assertEq(asset.balanceOf(recipients[i]), amount);
        }
    }

    function testFuzzApprovedVictimAssetsCanNeverBePulledByAnotherCaller(uint96 rawAmount, bytes32 distributionId)
        external
    {
        uint256 amount = bound(rawAmount, 1, 1_000_000 ether);
        if (distributionId == bytes32(0)) distributionId = bytes32(uint256(1));
        asset.mint(VICTIM, amount);
        rmt.mint(ATTACKER, ERC20_COST);
        vm.prank(VICTIM);
        asset.approve(address(engine), amount);
        vm.prank(ATTACKER);
        rmt.approve(address(engine), ERC20_COST);
        address[] memory recipients = new address[](1);
        recipients[0] = address(0xCAFE);

        vm.prank(ATTACKER);
        vm.expectRevert("allowance");
        engine.airdropERC20Equal(distributionId, address(asset), recipients, amount);

        assertEq(asset.balanceOf(VICTIM), amount);
        assertEq(asset.allowance(VICTIM, address(engine)), amount);
        assertEq(asset.balanceOf(recipients[0]), 0);
        assertEq(rmt.balanceOf(address(sink)), 0);
        assertFalse(engine.executionConsumed(engine.getExecutionKey(ATTACKER, distributionId)));
    }

    function testFuzzUtilityCostIsBatchInvariant(uint16 first, uint16 second) external view {
        uint256 count1 = bound(first, 1, 1_000);
        uint256 count2 = bound(second, 1, 1_000);
        uint256 combined = engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_CUSTOM, count1 + count2);
        uint256 split = engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_EQUAL, count1)
            + engine.quoteUtilityCost(IRMTDistributionEngineV1.ActionKind.ERC20_CUSTOM, count2);
        assertEq(combined, split);
    }

    function testFuzzExecutionKeyBindsSenderAndId(address sender, bytes32 distributionId) external view {
        address other = sender == address(1) ? address(2) : address(1);
        bytes32 key = engine.getExecutionKey(sender, distributionId);
        assertEq(key, engine.getExecutionKey(sender, distributionId));
        assertTrue(key != engine.getExecutionKey(other, distributionId));
        bytes32 otherId = bytes32(uint256(distributionId) ^ 1);
        assertTrue(key != engine.getExecutionKey(sender, otherId));
    }

    function testFuzzBatchHashBindsOrderAmountAndAsset(uint96 amount1, uint96 amount2) external view {
        amount1 = uint96(bound(amount1, 1, type(uint96).max));
        amount2 = uint96(bound(amount2, 1, type(uint96).max));
        address[] memory recipients = new address[](2);
        recipients[0] = address(0x1111);
        recipients[1] = address(0x2222);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount1;
        amounts[1] = amount2;
        bytes32 base = engine.hashERC20Batch(address(asset), recipients, amounts);

        recipients[0] = address(0x2222);
        recipients[1] = address(0x1111);
        assertTrue(base != engine.hashERC20Batch(address(asset), recipients, amounts));
        recipients[0] = address(0x1111);
        recipients[1] = address(0x2222);
        amounts[0] = uint256(amount1) + 1;
        assertTrue(base != engine.hashERC20Batch(address(asset), recipients, amounts));
        assertTrue(base != engine.hashERC20Batch(address(rmt), recipients, amounts));
    }
}
