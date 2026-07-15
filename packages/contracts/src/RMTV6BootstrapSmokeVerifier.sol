// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRMTLaunchFactoryV6} from "./interfaces/IRMTLaunchFactoryV6.sol";
import {IRMTLaunchPolicyRegistry} from "./interfaces/IRMTLaunchPolicyRegistry.sol";

interface IRMTV6SmokeFactory is IRMTLaunchFactoryV6 {}

interface IRMTV6SmokeToken {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function creator() external view returns (address);
}

interface IRMTV6SmokeMarket {
    function token() external view returns (address);
    function feeSplitter() external view returns (address);
    function graduationAdapter() external view returns (address);
    function policyId() external view returns (bytes32);
    function policyVersion() external view returns (uint32);
    function feeBps() external view returns (uint16);
    function graduationTarget() external view returns (uint256);
    function fairStartEnabled() external view returns (bool);
    function fairStartDelayBlocks() external view returns (uint64);
    function fairStartDurationBlocks() external view returns (uint64);
    function fairStartMaxTxBps() external view returns (uint16);
    function fairStartMaxWalletBps() external view returns (uint16);
    function curveInvariantK() external view returns (uint256);
    function virtualEthReserve() external view returns (uint256);
    function virtualTokenReserve() external view returns (uint256);
    function realEthReserve() external view returns (uint256);
    function trackedTokenInventory() external view returns (uint256);
    function graduated() external view returns (bool);
    function liquidityMigrated() external view returns (bool);
}

interface IRMTV6SmokeFeeSplitter {
    function originalCreator() external view returns (address);
    function creator() external view returns (address);
    function creatorPayoutAuthority() external view returns (address);
    function protocolTreasury() external view returns (address);
    function launchToken() external view returns (address);
    function authorizedMarket() external view returns (address);
    function graduationAdapter() external view returns (address);
    function creatorShareBps() external view returns (uint16);
    function totalReceived() external view returns (uint256);
    function totalPaid() external view returns (uint256);
    function pending(address recipient) external view returns (uint256);
}

/// @notice Stateless official-launch smoke verifier created and permanently bound by one V6 bootstrap controller.
contract RMTV6BootstrapSmokeVerifier {
    address private constant OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    bytes32 private constant FAIR_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    uint256 private constant INITIAL_VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 private constant INITIAL_VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint256 private constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 private constant GRADUATION_TARGET = 2 ether;
    uint256 private constant CURVE_INVARIANT_K = INITIAL_VIRTUAL_ETH_RESERVE * INITIAL_VIRTUAL_TOKEN_RESERVE;

    address public immutable controller;

    error Unauthorized();
    error SmokeIncomplete();
    error InvalidConfiguration();

    constructor(address controller_) {
        if (controller_ == address(0) || msg.sender != controller_) revert InvalidConfiguration();
        controller = controller_;
    }

    function validateOfficialLaunchAndSmoke(address governance, address policyRegistry, address factory) external view {
        if (msg.sender != controller) revert Unauthorized();
        if (
            governance == address(0) || governance.code.length == 0 || policyRegistry == address(0)
                || policyRegistry.code.length == 0 || factory == address(0) || factory.code.length == 0
        ) revert InvalidConfiguration();

        IRMTV6SmokeFactory reviewedFactory = IRMTV6SmokeFactory(factory);
        if (reviewedFactory.launchCount() != 1) revert SmokeIncomplete();
        IRMTLaunchFactoryV6.LaunchView memory launched = reviewedFactory.getLaunch(0);
        if (
            !launched.officialMigration || launched.creator != OPERATOR || launched.policyId != FAIR_POLICY_ID
                || launched.policyVersion != 1 || launched.token == address(0) || launched.token.code.length == 0
                || launched.market == address(0) || launched.market.code.length == 0
                || launched.rewardVault == address(0) || launched.rewardVault.code.length == 0
        ) revert SmokeIncomplete();

        _validateOfficialToken(launched.token);
        _validateOfficialMarket(policyRegistry, launched);
        _validateOfficialSplitter(governance, policyRegistry, launched);
    }

    function _validateOfficialToken(address tokenAddress) private view {
        IRMTV6SmokeToken token = IRMTV6SmokeToken(tokenAddress);
        if (
            token.creator() != OPERATOR || token.totalSupply() != TOKEN_SUPPLY
                || keccak256(bytes(token.name())) != keccak256(bytes("Robinhood Meme Terminal"))
                || keccak256(bytes(token.symbol())) != keccak256(bytes("RMT"))
        ) revert SmokeIncomplete();
    }

    function _validateOfficialMarket(address policyRegistry, IRMTLaunchFactoryV6.LaunchView memory launched)
        private
        view
    {
        IRMTV6SmokeMarket market = IRMTV6SmokeMarket(launched.market);
        address expectedAdapter = IRMTLaunchPolicyRegistry(policyRegistry).canonicalGraduationAdapter();
        uint256 realEthReserve = market.realEthReserve();
        uint256 virtualEthReserve = market.virtualEthReserve();
        uint256 virtualTokenReserve = market.virtualTokenReserve();
        uint256 trackedTokenInventory = market.trackedTokenInventory();
        if (
            market.token() != launched.token || market.feeSplitter() != launched.rewardVault
                || market.graduationAdapter() != expectedAdapter || market.policyId() != FAIR_POLICY_ID
                || market.policyVersion() != 1 || market.feeBps() != 100
                || market.graduationTarget() != GRADUATION_TARGET || !market.fairStartEnabled()
                || market.fairStartDelayBlocks() != 1 || market.fairStartDurationBlocks() != 10
                || market.fairStartMaxTxBps() != 100 || market.fairStartMaxWalletBps() != 300 || market.graduated()
                || market.liquidityMigrated() || realEthReserve == 0 || realEthReserve >= GRADUATION_TARGET
                || virtualEthReserve != INITIAL_VIRTUAL_ETH_RESERVE + realEthReserve
                || market.curveInvariantK() != CURVE_INVARIANT_K || virtualTokenReserve >= INITIAL_VIRTUAL_TOKEN_RESERVE
                || trackedTokenInventory == 0 || trackedTokenInventory >= TOKEN_SUPPLY
        ) revert SmokeIncomplete();
        uint256 netTokensSold = INITIAL_VIRTUAL_TOKEN_RESERVE - virtualTokenReserve;
        if (netTokensSold >= TOKEN_SUPPLY || trackedTokenInventory != TOKEN_SUPPLY - netTokensSold) {
            revert SmokeIncomplete();
        }
    }

    function _validateOfficialSplitter(
        address governance,
        address policyRegistry,
        IRMTLaunchFactoryV6.LaunchView memory launched
    ) private view {
        IRMTV6SmokeFeeSplitter splitter = IRMTV6SmokeFeeSplitter(launched.rewardVault);
        address expectedAdapter = IRMTLaunchPolicyRegistry(policyRegistry).canonicalGraduationAdapter();
        uint256 totalReceived = splitter.totalReceived();
        if (
            splitter.originalCreator() != OPERATOR || splitter.creator() != OPERATOR
                || splitter.creatorPayoutAuthority() != governance || splitter.protocolTreasury() != governance
                || splitter.launchToken() != launched.token || splitter.authorizedMarket() != launched.market
                || splitter.graduationAdapter() != expectedAdapter || splitter.creatorShareBps() != 7_000
                || totalReceived == 0 || splitter.totalPaid() != totalReceived || splitter.pending(OPERATOR) != 0
                || splitter.pending(governance) != 0
        ) revert SmokeIncomplete();
    }
}
