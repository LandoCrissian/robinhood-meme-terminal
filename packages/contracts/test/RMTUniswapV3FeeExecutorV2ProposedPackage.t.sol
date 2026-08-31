// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV3FeeExecutorV2Deployment as Deployment} from "../script/RMTUniswapV3FeeExecutorV2Deployment.sol";

contract RMTUniswapV3FeeExecutorV2ProposedPackageTest is Test {
    address private constant TREASURY = 0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC;
    uint256 private constant EFFECTIVE_FROM_BLOCK = 52_031_325;
    uint256 private constant EFFECTIVE_BEFORE_BLOCK = 0;
    bytes32 private constant EXPECTED_POLICY_HASH =
        0x817c811c7d6f5d4d7fd5740f6169114394415292e7a4c6043e15efbc23da003a;
    bytes32 private constant EXPECTED_CONSTRUCTOR_ARGS_HASH =
        0x10d3f6c445ac7e746a72f858f37a94512b27cf214e1d748aaec043f4fb382ce5;
    bytes32 private constant EXPECTED_CREATION_CODE_HASH =
        0x4aad11354c2be1ac4632ddfa1968e40394fdd3127e51038e369c73d389d79a02;
    bytes32 private constant EXPECTED_INIT_CODE_HASH =
        0x6d92231b7b5435809c57a91139b98624b729709ec67c60e029b8d471214fd3b3;
    bytes32 private constant EXPECTED_SALT =
        0xd9d5e78f113848ce84aedd7c54f0b44bcf232e679856f6156c82aa4ae02861bc;
    address private constant EXPECTED_EXECUTOR = 0x6D4CdBC3000Ae0C3d23C00BF70E48c9682f77CE2;
    bytes32 private constant EXPECTED_DEPLOYMENT_CALLDATA_HASH =
        0xe2a27bc21ddd89cf122ad6b410acd1c7b9dade16ff49cc95549b404bfb2b6d97;

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
