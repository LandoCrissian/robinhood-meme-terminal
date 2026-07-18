// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTConsentLiquidityMigrator} from "../src/RMTConsentLiquidityMigrator.sol";
import {ISushiV3Factory} from "../src/interfaces/ISushiV3Factory.sol";
import {ISushiV3Pool} from "../src/interfaces/ISushiV3Pool.sol";
import {ISushiV3PositionManager} from "../src/interfaces/ISushiV3PositionManager.sol";

interface ConsentMigratorDeployVm {
    function envAddress(string calldata name) external returns (address value);
    function envBytes32(string calldata name) external returns (bytes32 value);
    function envUint(string calldata name) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function getNonce(address account) external view returns (uint64 nonce);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deployment rehearsal for the isolated consent-based router on Robinhood Chain testnet.
/// @dev Deliberately disabled until Sushi's exact addresses, runtime hashes, terms, and manifest are
///      independently confirmed. Enabling deployment requires a reviewed source change that replaces
///      APPROVED_CONFIGURATION_MANIFEST_HASH; environment variables alone cannot bypass this stop.
contract DeployConsentLiquidityMigratorTestnet {
    ConsentMigratorDeployVm private constant vm =
        ConsentMigratorDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    bytes32 private constant APPROVED_CONFIGURATION_MANIFEST_HASH = bytes32(0);
    bytes32 private constant CONFIGURATION_TYPEHASH = keccak256(
        "RMTConsentLiquidityConfiguration(address migrator,uint256 chainId,address governance,address guardian,address weth,address pairedToken,address positionManager,address factory,address pool,uint24 poolFee,bytes32 positionManagerCodeHash,bytes32 factoryCodeHash,bytes32 poolCodeHash,bytes32 wethCodeHash,bytes32 pairedTokenCodeHash)"
    );
    bytes32 private constant TERMS_DOMAIN_TYPEHASH =
        keccak256("RMTConsentLiquidityTerms(bytes32 configurationHash,bytes32 termsDocumentHash)");
    bytes32 private constant DEPLOYMENT_MANIFEST_TYPEHASH = keccak256(
        "RMTConsentLiquidityDeployment(uint256 chainId,address deployer,address expectedMigrator,bytes32 creationCodeHash,bytes32 configurationHash,bytes32 migrationTermsHash)"
    );

    error DeploymentDisabled();
    error WrongChain(uint256 actualChainId);
    error InvalidEnvironment();
    error UnapprovedConfiguration();
    error BindingVerificationFailed();

    event ConsentLiquidityMigratorTestnetDeployed(
        address indexed migrator,
        address indexed pairedToken,
        address indexed weth,
        address positionManager,
        address factory,
        address pool,
        uint24 poolFee,
        bytes32 configurationHash,
        bytes32 migrationTermsHash
    );

    function run() external returns (RMTConsentLiquidityMigrator migrator) {
        if (APPROVED_CONFIGURATION_MANIFEST_HASH == bytes32(0)) revert DeploymentDisabled();
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address governance = vm.envAddress("MIGRATION_GOVERNANCE");
        address guardian = vm.envAddress("MIGRATION_GUARDIAN");
        address weth = vm.envAddress("MIGRATION_WETH");
        address pairedToken = vm.envAddress("MIGRATION_PAIRED_TOKEN");
        address positionManager = vm.envAddress("MIGRATION_SUSHI_V3_POSITION_MANAGER");
        address factory = vm.envAddress("MIGRATION_SUSHI_V3_FACTORY");
        address pool = vm.envAddress("MIGRATION_SUSHI_V3_POOL");
        uint256 rawPoolFee = vm.envUint("MIGRATION_SUSHI_V3_POOL_FEE");
        bytes32 positionManagerCodeHash = vm.envBytes32("MIGRATION_POSITION_MANAGER_CODE_HASH");
        bytes32 factoryCodeHash = vm.envBytes32("MIGRATION_FACTORY_CODE_HASH");
        bytes32 poolCodeHash = vm.envBytes32("MIGRATION_POOL_CODE_HASH");
        bytes32 wethCodeHash = vm.envBytes32("MIGRATION_WETH_CODE_HASH");
        bytes32 pairedTokenCodeHash = vm.envBytes32("MIGRATION_PAIRED_TOKEN_CODE_HASH");
        bytes32 termsDocumentHash = vm.envBytes32("MIGRATION_TERMS_DOCUMENT_HASH");

        if (
            privateKey == 0 || deployer == address(0) || governance.code.length == 0 || guardian == address(0)
                || weth.code.length == 0 || pairedToken.code.length == 0 || positionManager.code.length == 0
                || factory.code.length == 0 || pool.code.length == 0 || rawPoolFee == 0 || rawPoolFee > type(uint24).max
                || positionManagerCodeHash == bytes32(0) || factoryCodeHash == bytes32(0) || poolCodeHash == bytes32(0)
                || wethCodeHash == bytes32(0) || pairedTokenCodeHash == bytes32(0) || termsDocumentHash == bytes32(0)
                || positionManager.codehash != positionManagerCodeHash || factory.codehash != factoryCodeHash
                || pool.codehash != poolCodeHash || weth.codehash != wethCodeHash
                || pairedToken.codehash != pairedTokenCodeHash
        ) revert InvalidEnvironment();

        // Safe because rawPoolFee was bounded to uint24 above.
        uint24 poolFee = uint24(rawPoolFee);
        RMTConsentLiquidityMigrator.Configuration memory config = RMTConsentLiquidityMigrator.Configuration({
            destinationChainId: ROBINHOOD_TESTNET_CHAIN_ID,
            governance: governance,
            guardian: guardian,
            weth: IERC20(weth),
            pairedToken: IERC20(pairedToken),
            positionManager: ISushiV3PositionManager(positionManager),
            factory: ISushiV3Factory(factory),
            pool: ISushiV3Pool(pool),
            poolFee: poolFee,
            positionManagerCodeHash: positionManagerCodeHash,
            factoryCodeHash: factoryCodeHash,
            poolCodeHash: poolCodeHash,
            wethCodeHash: wethCodeHash,
            pairedTokenCodeHash: pairedTokenCodeHash,
            termsDocumentHash: termsDocumentHash
        });

        address expectedMigrator = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        bytes32 expectedConfigurationHash = _configurationHash(expectedMigrator, config);
        bytes32 expectedMigrationTermsHash =
            keccak256(abi.encode(TERMS_DOMAIN_TYPEHASH, expectedConfigurationHash, termsDocumentHash));
        bytes32 creationCodeHash = keccak256(type(RMTConsentLiquidityMigrator).creationCode);
        bytes32 manifestHash = keccak256(
            abi.encode(
                DEPLOYMENT_MANIFEST_TYPEHASH,
                ROBINHOOD_TESTNET_CHAIN_ID,
                deployer,
                expectedMigrator,
                creationCodeHash,
                expectedConfigurationHash,
                expectedMigrationTermsHash
            )
        );
        if (manifestHash != APPROVED_CONFIGURATION_MANIFEST_HASH) revert UnapprovedConfiguration();

        vm.startBroadcast(privateKey);
        migrator = new RMTConsentLiquidityMigrator(config);
        vm.stopBroadcast();

        if (
            address(migrator) != expectedMigrator || !migrator.paused()
                || migrator.destinationChainId() != ROBINHOOD_TESTNET_CHAIN_ID || migrator.governance() != governance
                || migrator.guardian() != guardian || address(migrator.weth()) != weth
                || address(migrator.pairedToken()) != pairedToken
                || address(migrator.positionManager()) != positionManager || address(migrator.sushiFactory()) != factory
                || address(migrator.sushiPool()) != pool || migrator.poolFee() != poolFee
                || migrator.termsDocumentHash() != termsDocumentHash
                || migrator.configurationHash() != expectedConfigurationHash
                || migrator.migrationTermsHash() != expectedMigrationTermsHash
        ) revert BindingVerificationFailed();

        emit ConsentLiquidityMigratorTestnetDeployed(
            address(migrator),
            pairedToken,
            weth,
            positionManager,
            factory,
            pool,
            poolFee,
            migrator.configurationHash(),
            migrator.migrationTermsHash()
        );
    }

    function _configurationHash(address expectedMigrator, RMTConsentLiquidityMigrator.Configuration memory config)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                CONFIGURATION_TYPEHASH,
                expectedMigrator,
                config.destinationChainId,
                config.governance,
                config.guardian,
                address(config.weth),
                address(config.pairedToken),
                address(config.positionManager),
                address(config.factory),
                address(config.pool),
                config.poolFee,
                config.positionManagerCodeHash,
                config.factoryCodeHash,
                config.poolCodeHash,
                config.wethCodeHash,
                config.pairedTokenCodeHash
            )
        );
    }
}
