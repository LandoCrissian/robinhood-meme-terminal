// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV3FeeExecutorV2Deployment as Deployment} from "../script/RMTUniswapV3FeeExecutorV2Deployment.sol";

contract RMTUniswapV3FeeExecutorV2ProposedPackageTest is Test {
    address private constant TREASURY = 0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC;
    uint256 private constant EFFECTIVE_FROM_BLOCK = 51_296_658;
    uint256 private constant EFFECTIVE_BEFORE_BLOCK = 0;
    bytes32 private constant EXPECTED_POLICY_HASH =
        0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484;
    bytes32 private constant EXPECTED_CONSTRUCTOR_ARGS_HASH =
        0x6198dd3a8fd00ad064846dc2c4418755a16871a694975811b0e98ab154dbff50;
    bytes32 private constant EXPECTED_CREATION_CODE_HASH =
        0x4aad11354c2be1ac4632ddfa1968e40394fdd3127e51038e369c73d389d79a02;
    bytes32 private constant EXPECTED_INIT_CODE_HASH =
        0xbaf7664de34dd6c2713a7eb0df80bcd39564fa9c55e6669ac111fe1a9e7c646f;
    bytes32 private constant EXPECTED_SALT =
        0x8042491cf951a01116a97dc3ec93870a88f8f92a9f28cc20db0bbf2c304aeb69;
    address private constant EXPECTED_EXECUTOR = 0xef729FbC9aDfC431ae46ECc198144160e2dD7832;
    bytes32 private constant EXPECTED_DEPLOYMENT_CALLDATA_HASH =
        0x11b8155284275c8edabdc24ee0f404b0cb8178f25912a21f75cac2f6393afd43;

    function testProposedOwnerAuthorizationPackageIsExact() public pure {
        Deployment.Plan memory result = Deployment.plan(TREASURY, EFFECTIVE_FROM_BLOCK, EFFECTIVE_BEFORE_BLOCK);
        bytes memory constructorArgs = Deployment.constructorArgs(
            TREASURY, result.policyHash, EFFECTIVE_FROM_BLOCK, EFFECTIVE_BEFORE_BLOCK
        );
        bytes memory deploymentCalldata = Deployment.deploymentCalldata(result);

        assertEq(keccak256(constructorArgs), result.constructorArgsHash);
        assertEq(keccak256(Deployment.initCode(result)), result.initCodeHash);
        assertEq(deploymentCalldata.length, 32 + Deployment.initCode(result).length);
        assertEq(result.policyHash, EXPECTED_POLICY_HASH);
        assertEq(result.constructorArgsHash, EXPECTED_CONSTRUCTOR_ARGS_HASH);
        assertEq(result.creationCodeHash, EXPECTED_CREATION_CODE_HASH);
        assertEq(result.initCodeHash, EXPECTED_INIT_CODE_HASH);
        assertEq(result.salt, EXPECTED_SALT);
        assertEq(result.predictedExecutor, EXPECTED_EXECUTOR);
        assertEq(keccak256(deploymentCalldata), EXPECTED_DEPLOYMENT_CALLDATA_HASH);
        assertTrue(result.predictedExecutor != 0xcB9c00524848038D211921e0f3975190D7Aa1e8f);
        assertTrue(result.predictedExecutor != TREASURY);
        assertTrue(result.predictedExecutor != Deployment.ROUTER);
        assertTrue(result.predictedExecutor != Deployment.FACTORY);
        assertTrue(result.predictedExecutor != Deployment.WETH);
        assertTrue(result.predictedExecutor != Deployment.DETERMINISTIC_FACTORY);
    }

    function testHistoricalRehearsalBoundaryCannotReproduceProposedPackage() public pure {
        Deployment.Plan memory rehearsal = Deployment.plan(TREASURY, 50_000_000, 0);
        assertTrue(rehearsal.policyHash != EXPECTED_POLICY_HASH);
        assertTrue(rehearsal.constructorArgsHash != EXPECTED_CONSTRUCTOR_ARGS_HASH);
        assertTrue(rehearsal.initCodeHash != EXPECTED_INIT_CODE_HASH);
        assertTrue(rehearsal.salt != EXPECTED_SALT);
        assertTrue(rehearsal.predictedExecutor != EXPECTED_EXECUTOR);
    }
}
