// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {RMTDistributionEngineV1} from "../src/RMTDistributionEngineV1.sol";
import {RMTRetirementSinkV1} from "../src/RMTRetirementSinkV1.sol";
import {DistributionERC20Mock} from "./mocks/RMTDistributionEngineV1Mocks.sol";

/// @dev Synthetic gas evidence only. Official-RMT fork evidence belongs to the separately gated fork tranche.
contract RMTDistributionEngineV1GasTest is Test {
    address private constant TRADER = address(0xA11CE);

    DistributionERC20Mock private rmt;
    DistributionERC20Mock private asset;
    RMTDistributionEngineV1 private engine;

    function setUp() external {
        vm.chainId(4_663);
        rmt = new DistributionERC20Mock();
        asset = new DistributionERC20Mock();
        RMTRetirementSinkV1 sink = new RMTRetirementSinkV1();
        engine = new RMTDistributionEngineV1(address(rmt), address(sink), 1 ether, 2 ether, 3 ether);
    }

    function testGasERC20Equal10() external {
        _runEqualDistribution(10);
    }

    function testGasERC20Equal25() external {
        _runEqualDistribution(25);
    }

    function testGasERC20Equal50() external {
        _runEqualDistribution(50);
    }

    function testGasERC20Equal100() external {
        _runEqualDistribution(100);
    }

    function testGasERC20Equal200() external {
        _runEqualDistribution(200);
    }

    function _runEqualDistribution(uint256 count) private {
        uint256 amount = 1 ether;
        uint256 total = amount * count;
        uint256 utility = engine.erc20CostPerRecipient() * count;
        address[] memory recipients = new address[](count);
        for (uint256 i; i < count; ++i) {
            recipients[i] = address(uint160(0x10_000 + i));
        }
        asset.mint(TRADER, total);
        rmt.mint(TRADER, utility);

        vm.startPrank(TRADER);
        asset.approve(address(engine), total);
        rmt.approve(address(engine), utility);
        uint256 gasBefore = gasleft();
        engine.airdropERC20Equal(bytes32(count), address(asset), recipients, amount);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        emit log_named_uint("recipient count", count);
        emit log_named_uint("synthetic gas used", gasUsed);
        assertEq(asset.balanceOf(address(engine)), 0);
        assertEq(rmt.balanceOf(address(engine)), 0);
    }
}
