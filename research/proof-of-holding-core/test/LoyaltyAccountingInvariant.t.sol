// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IProofOfHoldingCore } from "../src/interfaces/IProofOfHoldingCore.sol";
import { LoyaltyAccounting } from "../src/LoyaltyAccounting.sol";
import { PoHPolicyV1 } from "../src/PoHPolicyV1.sol";
import { ProofOfHoldingToken } from "../src/ProofOfHoldingToken.sol";
import { TestBase, Vm } from "./TestBase.sol";

contract LoyaltyAccountingHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    ProofOfHoldingToken public immutable token;
    address[3] internal _actors;

    constructor(ProofOfHoldingToken token_, address[3] memory actors_) {
        token = token_;
        _actors = actors_;
    }

    function actor(uint256 index) external view returns (address) {
        return _actors[index % _actors.length];
    }

    function transfer(uint8 fromSeed, uint8 toSeed, uint192 rawAmount) external {
        address from = _actors[uint256(fromSeed) % _actors.length];
        address to = _actors[uint256(toSeed) % _actors.length];
        if (from == to) return;

        uint256 balance = token.balanceOf(from);
        uint256 amount = uint256(rawAmount) % (balance + 1);

        vm.prank(from);
        token.transfer(to, amount);
    }

    function burn(uint8 actorSeed, uint192 rawAmount) external {
        address account = _actors[uint256(actorSeed) % _actors.length];
        uint256 balance = token.balanceOf(account);
        uint256 amount = uint256(rawAmount) % (balance + 1);

        vm.prank(account);
        token.burn(amount);
    }

    function advanceTime(uint32 rawSeconds) external {
        uint256 elapsed = uint256(rawSeconds) % (30 days + 1);
        vm.warp(block.timestamp + elapsed);
    }
}

contract LoyaltyAccountingInvariantTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA401);

    ProofOfHoldingToken internal token;
    LoyaltyAccounting internal accounting;
    LoyaltyAccountingHandler internal handler;
    address[3] internal actors;

    function setUp() public {
        vm.warp(1_800_000_000);
        PoHPolicyV1 policy = new PoHPolicyV1();
        address[] memory exclusions = new address[](0);

        token = new ProofOfHoldingToken(
            "Proof of Holding",
            "POH",
            1_000_000_000e18,
            ALICE,
            address(this),
            address(policy),
            exclusions
        );
        accounting = token.accounting();

        address[3] memory configuredActors = [ALICE, BOB, CAROL];
        actors = configuredActors;
        handler = new LoyaltyAccountingHandler(token, configuredActors);
        vm.targetContract(address(handler));
    }

    function invariantTrackedBalancesEqualTokenBalances() public view {
        for (uint256 i; i < actors.length; ++i) {
            IProofOfHoldingCore.Position memory position = accounting.positionOf(actors[i]);
            assertEq(position.eligibleBalance, token.balanceOf(actors[i]));
        }
    }

    function invariantTrackedSupplyIsConserved() public view {
        uint256 trackedSupply;
        for (uint256 i; i < actors.length; ++i) {
            IProofOfHoldingCore.Position memory position = accounting.positionOf(actors[i]);
            trackedSupply += position.eligibleBalance;
        }
        assertEq(trackedSupply, token.totalSupply());
    }

    function invariantPositionTimestampsAreBounded() public view {
        for (uint256 i; i < actors.length; ++i) {
            IProofOfHoldingCore.Position memory position = accounting.positionOf(actors[i]);
            if (position.eligibleBalance == 0) {
                assertEq(position.weightedAcquisitionTime, 0);
                assertEq(position.activeSince, 0);
                assertEq(accounting.holdingAge(actors[i]), 0);
            } else {
                assertLe(position.weightedAcquisitionTime, block.timestamp);
                assertLe(position.activeSince, block.timestamp);
                assertGe(position.weightedAcquisitionTime, position.activeSince);
            }
        }
    }
}
