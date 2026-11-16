// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTLaunchCurveDirectoryV1 as Directory} from "../src/RMTLaunchCurveDirectoryV1.sol";

contract DirectoryFactoryFixture {
    uint32 public immutable engineVersion;
    mapping(address => uint256) public settledClaims;

    constructor(uint32 version) {
        engineVersion = version;
    }

    function recordClaim(uint256 amount) external {
        settledClaims[msg.sender] += amount;
    }
}

contract RMTLaunchCurveDirectoryV1Test is Test {
    Directory private directory;
    DirectoryFactoryFixture private factory;
    uint256 private constant SIGNER_A = 1;
    uint256 private constant SIGNER_B = 2;
    uint256 private constant SIGNER_C = 3;

    function setUp() public {
        vm.warp(1 days);
        directory = new Directory(vm.addr(SIGNER_A), vm.addr(SIGNER_B), vm.addr(SIGNER_C));
        factory = new DirectoryFactoryFixture(1);
    }

    function _action(Directory.ActionKind kind) private view returns (Directory.Action memory) {
        return Directory.Action(kind, directory.nonce(), 0, address(0), bytes32(0), uint48(block.timestamp + 9 days));
    }

    function _publish(DirectoryFactoryFixture candidate, uint32 version)
        private
        view
        returns (Directory.Action memory action)
    {
        action = _action(Directory.ActionKind.Publish);
        action.version = version;
        action.factory = address(candidate);
        action.runtimeHash = address(candidate).codehash;
    }

    function _signature(Directory.Action memory action, uint256 key) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, directory.actionDigest(action));
        return abi.encodePacked(r, s, v);
    }

    function _schedule(Directory.Action memory action) private {
        directory.schedule(action, _signature(action, SIGNER_A), _signature(action, SIGNER_C));
    }

    function _executeAfterDelay(Directory.Action memory action) private {
        vm.warp(block.timestamp + directory.publicationDelay());
        vm.prank(address(0xBEEF));
        directory.execute(action);
    }

    function testTwoSignersAndTimelockRequiredEvenWhenRelayerChanges() public {
        Directory.Action memory action = _publish(factory, 1);
        bytes memory first = _signature(action, SIGNER_A);
        bytes memory unrelated = _signature(action, 10);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.schedule(action, first, first);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.schedule(action, first, unrelated);

        _schedule(action);
        vm.expectRevert(Directory.PendingAction.selector);
        directory.schedule(action, first, unrelated);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(action);
        _executeAfterDelay(action);
        assertEq(directory.currentFactory().factory, address(factory));
        assertEq(directory.nonce(), 1);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(action);
    }

    function testReplayAcrossDirectoriesAndChainsRejected() public {
        Directory.Action memory action = _publish(factory, 1);
        bytes memory first = _signature(action, SIGNER_A);
        bytes memory second = _signature(action, SIGNER_B);
        Directory other = new Directory(vm.addr(SIGNER_A), vm.addr(SIGNER_B), vm.addr(SIGNER_C));
        vm.expectRevert(Directory.InvalidSigners.selector);
        other.schedule(action, first, second);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.schedule(action, first, second);
    }

    function testExpiredPublicationAndDigestBoundCancellation() public {
        Directory.Action memory publication = _publish(factory, 1);
        _schedule(publication);
        Directory.Action memory cancellation = _action(Directory.ActionKind.Cancel);
        cancellation.runtimeHash = bytes32(uint256(1));
        bytes memory wrongFirst = _signature(cancellation, SIGNER_A);
        bytes memory wrongSecond = _signature(cancellation, SIGNER_B);
        vm.expectRevert(Directory.InvalidAction.selector);
        directory.cancel(cancellation, wrongFirst, wrongSecond);

        cancellation.runtimeHash = directory.actionDigest(publication);
        directory.cancel(cancellation, _signature(cancellation, SIGNER_A), _signature(cancellation, SIGNER_B));
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(publication);
        publication = _publish(factory, 1);
        _schedule(publication);
        vm.warp(publication.deadline + 1);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(publication);
        directory.clearExpired();
        assertEq(directory.nonce(), 2);
    }

    function testSuspensionLeavesExistingClaimsAndVersionPinsUntouched() public {
        Directory.Action memory action = _publish(factory, 1);
        _schedule(action);
        _executeAfterDelay(action);
        factory.recordClaim(5);

        Directory.Action memory halt = _action(Directory.ActionKind.Suspend);
        directory.suspend(halt, _signature(halt, SIGNER_A), _signature(halt, SIGNER_B));
        assertEq(directory.currentFactory().factory, address(0));
        (address previous, bytes32 codeHash) = directory.factories(1);
        assertEq(previous, address(factory));
        assertEq(codeHash, address(factory).codehash);
        factory.recordClaim(7);

        Directory.Action memory resume = _action(Directory.ActionKind.Resume);
        _schedule(resume);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(resume);
        _executeAfterDelay(resume);
        assertEq(directory.currentFactory().factory, address(factory));
        assertEq(factory.settledClaims(address(this)), 12);
    }

    function testChangedRuntimeCannotExecuteAndApprovedReplacementCannotRewriteV1() public {
        Directory.Action memory action = _publish(factory, 1);
        _schedule(action);
        _executeAfterDelay(action);
        factory.recordClaim(9);

        DirectoryFactoryFixture replacement = new DirectoryFactoryFixture(2);
        Directory.Action memory next = _publish(replacement, 2);
        _schedule(next);
        bytes memory expectedCode = address(replacement).code;
        vm.etch(address(replacement), hex"60006000fd");
        vm.warp(block.timestamp + directory.publicationDelay());
        vm.expectRevert(Directory.InvalidFactory.selector);
        directory.execute(next);
        assertEq(directory.currentFactory().factory, address(factory));
        vm.etch(address(replacement), expectedCode);
        directory.execute(next);
        assertEq(directory.currentFactory().factory, address(replacement));
        (address previous,) = directory.factories(1);
        assertEq(previous, address(factory));
        assertEq(factory.settledClaims(address(this)), 9);
    }
}
