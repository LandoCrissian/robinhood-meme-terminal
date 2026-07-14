// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ExpandableGovernance} from "../src/ExpandableGovernance.sol";

interface GovernanceVm { function warp(uint256) external; function prank(address) external; }

contract ExpandableGovernanceTest {
    GovernanceVm private constant vm = GovernanceVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant SECOND = address(0xBEEF);

    function testStartsOneOfOneAndCanAddSignerThenRaiseThreshold() public {
        ExpandableGovernance governance = new ExpandableGovernance(address(this), 1 days);
        uint256 addId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.addSigner, (SECOND))
        );
        (bool early,) = address(governance).call(abi.encodeCall(governance.execute, (addId)));
        require(!early, "delay bypassed");
        vm.warp(1 days + 2);
        governance.execute(addId);
        require(governance.isSigner(SECOND), "signer missing");

        uint256 thresholdId = governance.propose(
            address(governance), 0, abi.encodeCall(governance.setThreshold, (2))
        );
        vm.warp(2 days + 3);
        governance.execute(thresholdId);
        require(governance.threshold() == 2, "threshold not raised");

        uint256 next = governance.propose(address(this), 0, "");
        vm.warp(3 days + 4);
        (bool oneSignature,) = address(governance).call(abi.encodeCall(governance.execute, (next)));
        require(!oneSignature, "threshold bypassed");
        vm.prank(SECOND);
        governance.confirm(next);
        governance.execute(next);
    }
}
