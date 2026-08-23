// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV3FeeExecutorV2Deployment as Deployment} from "../script/RMTUniswapV3FeeExecutorV2Deployment.sol";

contract RMTUniswapV3FeeExecutorV2DeploymentTest is Test {
    address private constant REHEARSAL_TREASURY = 0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC;
    uint256 private constant REHEARSAL_FROM_BLOCK = 50_000_000;

    function testPlanIsDeterministicAndDomainSeparated() public pure {
        Deployment.Plan memory first = Deployment.plan(REHEARSAL_TREASURY, REHEARSAL_FROM_BLOCK, 0);
        Deployment.Plan memory second = Deployment.plan(REHEARSAL_TREASURY, REHEARSAL_FROM_BLOCK, 0);
        assertEq(first.policyHash, second.policyHash);
        assertEq(first.constructorArgsHash, second.constructorArgsHash);
        assertEq(first.creationCodeHash, second.creationCodeHash);
        assertEq(first.initCodeHash, second.initCodeHash);
        assertEq(first.salt, second.salt);
        assertEq(first.predictedExecutor, second.predictedExecutor);
        assertTrue(first.salt != keccak256("RMT_UNISWAP_V3_FEE_EXECUTOR_V1"));
    }

    function testTreasuryMutationChangesPolicyInitCodeAndAddress() public pure {
        Deployment.Plan memory first = Deployment.plan(REHEARSAL_TREASURY, REHEARSAL_FROM_BLOCK, 0);
        Deployment.Plan memory mutated = Deployment.plan(address(0xBEEF), REHEARSAL_FROM_BLOCK, 0);
        assertTrue(first.policyHash != mutated.policyHash);
        assertTrue(first.constructorArgsHash != mutated.constructorArgsHash);
        assertTrue(first.initCodeHash != mutated.initCodeHash);
        assertTrue(first.salt != mutated.salt);
        assertTrue(first.predictedExecutor != mutated.predictedExecutor);
    }

    function testEffectiveBlockMutationChangesPolicyInitCodeAndAddress() public pure {
        Deployment.Plan memory first = Deployment.plan(REHEARSAL_TREASURY, REHEARSAL_FROM_BLOCK, 0);
        Deployment.Plan memory mutated = Deployment.plan(REHEARSAL_TREASURY, REHEARSAL_FROM_BLOCK + 1, 0);
        assertTrue(first.policyHash != mutated.policyHash);
        assertTrue(first.constructorArgsHash != mutated.constructorArgsHash);
        assertTrue(first.initCodeHash != mutated.initCodeHash);
        assertTrue(first.salt != mutated.salt);
        assertTrue(first.predictedExecutor != mutated.predictedExecutor);
    }

    function testBeforeBlockZeroIsCanonicalOpenEndedBoundary() public pure {
        Deployment.Plan memory result = Deployment.plan(REHEARSAL_TREASURY, REHEARSAL_FROM_BLOCK, 0);
        assertEq(result.policyBeforeBlock, 0);
    }

    function testInvalidTreasuriesAndBoundariesFailClosed() public {
        vm.expectRevert(Deployment.InvalidTreasury.selector);
        this.externalPlan(address(0), REHEARSAL_FROM_BLOCK, 0);
        vm.expectRevert(Deployment.InvalidTreasury.selector);
        this.externalPlan(Deployment.ROUTER, REHEARSAL_FROM_BLOCK, 0);
        vm.expectRevert(Deployment.InvalidPolicyBoundary.selector);
        this.externalPlan(REHEARSAL_TREASURY, 0, 0);
        vm.expectRevert(Deployment.InvalidPolicyBoundary.selector);
        this.externalPlan(REHEARSAL_TREASURY, REHEARSAL_FROM_BLOCK, REHEARSAL_FROM_BLOCK);
    }

    function externalPlan(address treasury, uint256 fromBlock, uint256 beforeBlock)
        external
        pure
        returns (Deployment.Plan memory)
    {
        return Deployment.plan(treasury, fromBlock, beforeBlock);
    }
}
