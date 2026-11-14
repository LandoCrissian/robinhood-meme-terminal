// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTLaunchCurveRevenueLedgerV1 as RevenueLedger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {RMTLaunchCurveDirectoryV1 as Directory} from "../src/RMTLaunchCurveDirectoryV1.sol";

contract Task040FactoryPinFixture {
    uint32 public constant engineVersion = 1;
}

contract RMTLaunchTask040ReviewTest is Test {
    address private creator = makeAddr("review creator");
    address private treasury = makeAddr("review project treasury");
    address private operating = makeAddr("review operations");
    address private reserve = makeAddr("review future reserve");

    function testFuzzCurveFeePartitionIsInvariantToFragmentationAndInterleavedClaims(
        uint96 rawFirst,
        uint96 rawSecond,
        uint16 rawShare
    ) external {
        uint256 first = bound(rawFirst, 1, 2 ether);
        uint256 second = bound(rawSecond, 1, 2 ether);
        uint16 share = uint16(bound(rawShare, 0, 9_000));
        address projectTreasury = share == 0 ? address(0) : treasury;
        RevenueLedger fragmented = new RevenueLedger(creator, projectTreasury, share, operating, reserve);
        RevenueLedger single = new RevenueLedger(creator, projectTreasury, share, operating, reserve);
        vm.deal(address(this), (first + second) * 2);

        fragmented.accrue{value: first}();
        uint256 earlierClaim = fragmented.claimable(creator);
        if (earlierClaim > 0) {
            vm.prank(creator);
            assertEq(fragmented.claim(), earlierClaim);
        }
        fragmented.accrue{value: second}();
        single.accrue{value: first + second}();

        uint256 total = first + second;
        uint256 platform = total / 10;
        uint256 project = total - platform;
        uint256 treasuryAmount = project * share / 9_000;
        assertEq(fragmented.totalAccrued(), total);
        assertEq(fragmented.totalClaimed(), earlierClaim);
        assertEq(address(fragmented).balance + earlierClaim, total);
        assertEq(single.totalClaimed(), 0);
        assertEq(address(single).balance, total);
        assertEq(fragmented.claimable(creator) + earlierClaim, project - treasuryAmount);
        assertEq(fragmented.claimable(treasury), treasuryAmount);
        assertEq(fragmented.claimable(operating), platform / 2);
        assertEq(fragmented.claimable(reserve), platform - platform / 2);
        for (uint256 bucket = 0; bucket < 4; ++bucket) {
            assertEq(fragmented.bucketAccrued(bucket), single.bucketAccrued(bucket));
        }
    }

    function testDirectorySuspensionClearsPendingPublicationAndResumeWaitsFullDelay() external {
        vm.warp(1 days);
        Directory directory = new Directory(vm.addr(11), vm.addr(12), vm.addr(13));
        Task040FactoryPinFixture candidate = new Task040FactoryPinFixture();
        Directory.Action memory publication = _action(directory, Directory.ActionKind.Publish);
        publication.version = 1;
        publication.factory = address(candidate);
        publication.runtimeHash = address(candidate).codehash;
        bytes memory reviewA = _signature(directory, publication, 11);
        bytes memory reviewB = _signature(directory, publication, 12);
        directory.schedule(publication, reviewA, reviewB);

        Directory.Action memory suspension = _action(directory, Directory.ActionKind.Suspend);
        directory.suspend(suspension, _signature(directory, suspension, 11), _signature(directory, suspension, 13));
        assertTrue(directory.suspended());
        assertEq(directory.nonce(), 1);

        Directory.Action memory resume = _action(directory, Directory.ActionKind.Resume);
        directory.schedule(resume, _signature(directory, resume, 12), _signature(directory, resume, 13));
        uint256 readyAt = block.timestamp + directory.publicationDelay();
        vm.warp(readyAt - 1);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(resume);
        assertTrue(directory.suspended());

        vm.warp(readyAt);
        directory.execute(resume);
        assertFalse(directory.suspended());
        assertEq(directory.nonce(), 2);
        assertEq(directory.currentFactory().factory, address(0));
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(publication);
        vm.expectRevert(Directory.InvalidAction.selector);
        directory.schedule(publication, reviewA, reviewB);
    }

    function _action(Directory directory, Directory.ActionKind kind) private view returns (Directory.Action memory) {
        return Directory.Action(kind, directory.nonce(), 0, address(0), bytes32(0), uint48(block.timestamp + 9 days));
    }

    function _signature(Directory directory, Directory.Action memory action, uint256 fixtureKey)
        private view returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fixtureKey, directory.actionDigest(action));
        return abi.encodePacked(r, s, v);
    }
}
