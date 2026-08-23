// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTUniswapV3FeeExecutorV2} from "../src/RMTUniswapV3FeeExecutorV2.sol";

/// @notice Canonical, side-effect-free deployment math for RMTUniswapV3FeeExecutorV2.
/// @dev This library selects no treasury or activation block. Callers must supply both explicitly.
library RMTUniswapV3FeeExecutorV2Deployment {
    uint256 internal constant CHAIN_ID = 4_663;
    uint16 internal constant FEE_BPS = 25;
    uint256 internal constant POLICY_VERSION = 2;

    string internal constant POLICY_ID = "RMT_EXECUTION_V2";
    string internal constant POLICY_DOMAIN = "RMT_EXECUTION_FEE_POLICY_V2";
    string internal constant FEE_BASIS = "user_gross_input";
    string internal constant FEE_SIDE = "input";
    string internal constant ROUNDING_MODE = "floor";
    string internal constant EXECUTION_ORIGIN = "authenticated_rmt";
    string internal constant SETTLEMENT_MODE = "v2-atomic-input-fee";

    address internal constant ADMIN_DEPLOYER = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    address internal constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address internal constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant WETH_IMPLEMENTATION = 0xC6B81b429797E0f555440b70cD99e032D7AE947e;
    address internal constant DETERMINISTIC_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant ARBSYS = address(100);

    bytes32 internal constant ROUTER_RUNTIME_HASH = 0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc;
    bytes32 internal constant FACTORY_RUNTIME_HASH = 0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739;
    bytes32 internal constant WETH_RUNTIME_HASH = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;
    bytes32 internal constant WETH_IMPLEMENTATION_RUNTIME_HASH =
        0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650;
    bytes32 internal constant DETERMINISTIC_FACTORY_RUNTIME_HASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;
    bytes32 internal constant POLICY_ID_HASH = keccak256(bytes(POLICY_ID));
    bytes32 internal constant SALT_DOMAIN = keccak256("RMT_UNISWAP_V3_FEE_EXECUTOR_V2_CREATE2");

    struct Plan {
        address treasury;
        uint256 policyFromBlock;
        uint256 policyBeforeBlock;
        bytes32 policyHash;
        bytes32 constructorArgsHash;
        bytes32 creationCodeHash;
        bytes32 initCodeHash;
        bytes32 salt;
        address predictedExecutor;
    }

    error InvalidTreasury();
    error InvalidPolicyBoundary();

    function plan(address treasury, uint256 policyFromBlock, uint256 policyBeforeBlock)
        internal
        pure
        returns (Plan memory result)
    {
        validateTreasury(treasury);
        if (policyFromBlock == 0 || (policyBeforeBlock != 0 && policyBeforeBlock <= policyFromBlock)) {
            revert InvalidPolicyBoundary();
        }

        result.treasury = treasury;
        result.policyFromBlock = policyFromBlock;
        result.policyBeforeBlock = policyBeforeBlock;
        result.policyHash = policyHash(treasury, policyFromBlock, policyBeforeBlock);
        bytes memory args = constructorArgs(treasury, result.policyHash, policyFromBlock, policyBeforeBlock);
        result.constructorArgsHash = keccak256(args);
        result.creationCodeHash = keccak256(type(RMTUniswapV3FeeExecutorV2).creationCode);
        result.initCodeHash = keccak256(bytes.concat(type(RMTUniswapV3FeeExecutorV2).creationCode, args));
        result.salt = salt(result.policyHash, treasury, policyFromBlock, policyBeforeBlock, result.creationCodeHash);
        result.predictedExecutor = predict(DETERMINISTIC_FACTORY, result.salt, result.initCodeHash);
    }

    function policyHash(address treasury, uint256 policyFromBlock, uint256 policyBeforeBlock)
        internal
        pure
        returns (bytes32)
    {
        string[] memory settlementModes = new string[](1);
        settlementModes[0] = SETTLEMENT_MODE;
        return keccak256(
            abi.encode(
                POLICY_DOMAIN,
                POLICY_ID,
                POLICY_VERSION,
                CHAIN_ID,
                FEE_BPS,
                treasury,
                policyFromBlock,
                policyBeforeBlock,
                FEE_BASIS,
                FEE_SIDE,
                ROUNDING_MODE,
                EXECUTION_ORIGIN,
                settlementModes
            )
        );
    }

    function constructorArgs(
        address treasury,
        bytes32 expectedPolicyHash,
        uint256 policyFromBlock,
        uint256 policyBeforeBlock
    ) internal pure returns (bytes memory) {
        return abi.encode(
            ROUTER,
            ROUTER_RUNTIME_HASH,
            FACTORY,
            FACTORY_RUNTIME_HASH,
            WETH,
            WETH_RUNTIME_HASH,
            WETH_IMPLEMENTATION,
            WETH_IMPLEMENTATION_RUNTIME_HASH,
            treasury,
            POLICY_ID_HASH,
            POLICY_VERSION,
            expectedPolicyHash,
            FEE_BPS,
            policyFromBlock,
            policyBeforeBlock
        );
    }

    function initCode(Plan memory deploymentPlan) internal pure returns (bytes memory) {
        return bytes.concat(
            type(RMTUniswapV3FeeExecutorV2).creationCode,
            constructorArgs(
                deploymentPlan.treasury,
                deploymentPlan.policyHash,
                deploymentPlan.policyFromBlock,
                deploymentPlan.policyBeforeBlock
            )
        );
    }

    function deploymentCalldata(Plan memory deploymentPlan) internal pure returns (bytes memory) {
        return bytes.concat(deploymentPlan.salt, initCode(deploymentPlan));
    }

    function salt(
        bytes32 expectedPolicyHash,
        address treasury,
        uint256 policyFromBlock,
        uint256 policyBeforeBlock,
        bytes32 creationCodeHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SALT_DOMAIN,
                CHAIN_ID,
                expectedPolicyHash,
                treasury,
                policyFromBlock,
                policyBeforeBlock,
                creationCodeHash
            )
        );
    }

    function predict(address deterministicFactory, bytes32 deploymentSalt, bytes32 initCodeHash)
        internal
        pure
        returns (address)
    {
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), deterministicFactory, deploymentSalt, initCodeHash)))
            )
        );
    }

    function validateTreasury(address treasury) internal pure {
        if (
            treasury == address(0) || treasury == ROUTER || treasury == FACTORY || treasury == WETH
                || treasury == WETH_IMPLEMENTATION || treasury == DETERMINISTIC_FACTORY || treasury == ARBSYS
        ) revert InvalidTreasury();
    }
}
