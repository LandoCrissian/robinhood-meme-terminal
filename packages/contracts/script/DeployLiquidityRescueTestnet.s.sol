// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTLiquidityRescueVault, IRescueERC20, IRescueWETH} from "../src/RMTLiquidityRescueVault.sol";
import {ILiquidityRescueSeeder} from "../src/interfaces/ILiquidityRescueSeeder.sol";

interface LiquidityRescueDeployVm {
    function envAddress(string calldata name) external returns (address value);
    function envUint(string calldata name) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys only the isolated Liquidity Rescue destination vault on Robinhood Chain testnet.
/// @dev The WETH, paired token, reviewed seeder, governance, guardian, and custodian must already exist.
///      This script deliberately cannot deploy or guess a Sushi liquidity adapter.
contract DeployLiquidityRescueTestnet {
    LiquidityRescueDeployVm private constant vm =
        LiquidityRescueDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;

    error WrongChain(uint256 actualChainId);
    error InvalidEnvironment();
    error BindingVerificationFailed();

    event LiquidityRescueTestnetDeployed(
        address indexed vault,
        address indexed pairedToken,
        address indexed weth,
        address governance,
        address guardian,
        address seeder,
        address liquidityCustodian,
        uint256 globalContributionCap,
        uint256 minimumLiquidityWeth,
        uint64 fundingDeadline
    );

    function run() external returns (RMTLiquidityRescueVault vault) {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address governance = vm.envAddress("RESCUE_GOVERNANCE");
        address guardian = vm.envAddress("RESCUE_GUARDIAN");
        address weth = vm.envAddress("RESCUE_WETH");
        address pairedToken = vm.envAddress("RESCUE_PAIRED_TOKEN");
        address seeder = vm.envAddress("RESCUE_LIQUIDITY_SEEDER");
        address custodian = vm.envAddress("RESCUE_LIQUIDITY_CUSTODIAN");
        uint256 globalCap = vm.envUint("RESCUE_GLOBAL_WETH_CAP");
        uint256 minimumWeth = vm.envUint("RESCUE_MINIMUM_WETH");
        uint256 fundingDuration = vm.envUint("RESCUE_FUNDING_DURATION");

        if (
            privateKey == 0 || deployer == address(0) || governance.code.length == 0 || guardian == address(0)
                || weth.code.length == 0 || pairedToken.code.length == 0 || seeder.code.length == 0
                || custodian.code.length == 0 || globalCap == 0 || minimumWeth == 0 || minimumWeth > globalCap
                || fundingDuration == 0 || fundingDuration > 180 days
        ) revert InvalidEnvironment();

        uint64 fundingDeadline = uint64(block.timestamp + fundingDuration);
        vm.startBroadcast(privateKey);
        vault = new RMTLiquidityRescueVault(
            ROBINHOOD_TESTNET_CHAIN_ID,
            governance,
            guardian,
            IRescueWETH(weth),
            IRescueERC20(pairedToken),
            ILiquidityRescueSeeder(seeder),
            custodian,
            globalCap,
            minimumWeth,
            fundingDeadline
        );
        vm.stopBroadcast();

        if (
            vault.destinationChainId() != ROBINHOOD_TESTNET_CHAIN_ID || vault.governance() != governance
                || vault.guardian() != guardian || address(vault.weth()) != weth
                || address(vault.pairedToken()) != pairedToken || address(vault.liquiditySeeder()) != seeder
                || vault.liquidityCustodian() != custodian || vault.globalContributionCap() != globalCap
                || vault.minimumLiquidityWeth() != minimumWeth || vault.fundingDeadline() != fundingDeadline
        ) revert BindingVerificationFailed();

        emit LiquidityRescueTestnetDeployed(
            address(vault),
            pairedToken,
            weth,
            governance,
            guardian,
            seeder,
            custodian,
            globalCap,
            minimumWeth,
            fundingDeadline
        );
    }
}
