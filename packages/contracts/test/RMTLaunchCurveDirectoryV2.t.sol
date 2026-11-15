// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTLaunchCurveDirectoryV2 as Directory} from "../src/RMTLaunchCurveDirectoryV2.sol";

contract RotationTestFactory {
    function engineVersion() external pure returns (uint32) {
        return 1;
    }
}

contract RMTLaunchCurveDirectoryV2Test is Test {
    uint256 private constant A = 0x10001;
    uint256 private constant B = 0x10002;
    uint256 private constant C = 0x10003;
    uint256 private constant D = 0x10004;

    Directory private directory;
    address private factory;
    address private signerA;
    address private signerB;
    address private signerC;
    address private signerD;

    function setUp() public {
        vm.chainId(4663);
        signerA = vm.addr(A);
        signerB = vm.addr(B);
        signerC = vm.addr(C);
        signerD = vm.addr(D);
        directory = new Directory(signerA, signerB, signerC);
        factory = address(new RotationTestFactory());
    }

    function testOtherTwoSignersReplaceUnavailableMemberAfterNotice() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        bytes32 digest = directory.signerRotationDigest(rotation);
        bytes memory first = _sign(B, digest);
        bytes memory second = _sign(C, digest);
        bytes memory acceptance = _accept(rotation, D);
        vm.expectEmit(true, true, true, true, address(directory));
        emit Directory.SignerRotationScheduled(
            digest, 1, 0, signerA, signerD, uint48(vm.getBlockTimestamp() + 2 days), rotation.deadline
        );
        directory.scheduleSignerRotation(rotation, first, second, acceptance);
        vm.warp(vm.getBlockTimestamp() + 2 days - 1);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.executeSignerRotation(rotation);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.expectEmit(true, true, true, true, address(directory));
        emit Directory.SignerRotationExecuted(digest, 2, 0, signerA, signerD);
        directory.executeSignerRotation(rotation);
        assertEq(directory.signerA(), signerD);
        assertEq(directory.signerB(), signerB);
        assertEq(directory.signerC(), signerC);
        assertEq(directory.signerSetEpoch(), 2);
        assertEq(directory.rotationNonce(), 1);
        assertFalse(directory.isSigner(signerA));
        assertTrue(directory.isSigner(signerD));
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.executeSignerRotation(rotation);
    }

    function testCompromisedSignerAndLostQuorumCannotRotate() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        bytes32 digest = directory.signerRotationDigest(rotation);
        bytes memory lone = _sign(B, digest);
        bytes memory outsider = _sign(D, digest);
        bytes memory acceptance = _accept(rotation, D);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.scheduleSignerRotation(rotation, lone, lone, acceptance);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.scheduleSignerRotation(rotation, lone, outsider, acceptance);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.executeSignerRotation(rotation);
        assertEq(directory.signerSetEpoch(), 1);
    }

    function testIncomingSignerMustAcceptExactActionAndBeEligible() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        bytes32 digest = directory.signerRotationDigest(rotation);
        bytes memory first = _sign(B, digest);
        bytes memory second = _sign(C, digest);
        bytes memory wrong = _accept(rotation, C);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.scheduleSignerRotation(rotation, first, second, wrong);
        bytes memory wrongPurpose = _sign(D, digest);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.scheduleSignerRotation(rotation, first, second, wrongPurpose);

        address[4] memory invalid = [address(0), address(1), signerB, factory];
        for (uint256 i; i < invalid.length; ++i) {
            rotation.incomingSigner = invalid[i];
            vm.expectRevert(Directory.InvalidRotation.selector);
            directory.scheduleSignerRotation(rotation, "", "", "");
        }
        vm.expectRevert(Directory.InvalidSigners.selector);
        new Directory(signerA, signerB, factory);
        vm.expectRevert(Directory.InvalidSigners.selector);
        new Directory(signerA, signerB, signerA);
        vm.expectRevert(Directory.InvalidSigners.selector);
        new Directory(signerA, signerB, address(0));
    }

    function testIncomingAccountTypeIsRecheckedAtExecution() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        _scheduleRotation(rotation, B, C, D);
        vm.etch(signerD, hex"00");
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.expectRevert(Directory.InvalidRotation.selector);
        directory.executeSignerRotation(rotation);
        assertEq(directory.signerA(), signerA);
        assertFalse(directory.isSigner(signerD));
    }

    function testRotationSignaturesBindChainAndDirectory() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        bytes32 digest = directory.signerRotationDigest(rotation);
        bytes memory first = _sign(B, digest);
        bytes memory second = _sign(C, digest);
        bytes memory acceptance = _accept(rotation, D);
        Directory other = new Directory(signerA, signerB, signerC);
        vm.expectRevert(Directory.InvalidSigners.selector);
        other.scheduleSignerRotation(rotation, first, second, acceptance);
        vm.chainId(31337);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.scheduleSignerRotation(rotation, first, second, acceptance);
        vm.chainId(4663);
        directory.scheduleSignerRotation(rotation, first, second, acceptance);
    }

    function testCancellationAndExpiryConsumeRotationNonceWithoutEpochChange() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        bytes32 digest = directory.signerRotationDigest(rotation);
        _scheduleRotation(rotation, B, C, D);
        Directory.RotationCancellation memory cancellation = Directory.RotationCancellation(
            digest, directory.signerSetEpoch(), directory.rotationNonce(), uint48(vm.getBlockTimestamp() + 9 days)
        );
        bytes32 cancelDigest = directory.rotationCancellationDigest(cancellation);
        bytes memory first = _sign(B, cancelDigest);
        bytes memory second = _sign(C, cancelDigest);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.cancelSignerRotation(cancellation, first, first);
        vm.expectEmit(true, true, true, true, address(directory));
        emit Directory.SignerRotationCancelled(digest, 1, 0);
        directory.cancelSignerRotation(cancellation, first, second);
        assertEq(directory.rotationNonce(), 1);
        assertEq(directory.signerSetEpoch(), 1);
        vm.expectRevert(Directory.InvalidRotation.selector);
        directory.scheduleSignerRotation(rotation, "", "", "");

        rotation = _rotation(signerA, signerD);
        rotation.deadline = uint48(vm.getBlockTimestamp() + 30 days);
        digest = directory.signerRotationDigest(rotation);
        _scheduleRotation(rotation, B, C, D);
        (,, uint48 expiry) = directory.pendingRotation();
        assertEq(expiry, vm.getBlockTimestamp() + 9 days);
        vm.warp(expiry);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.clearExpiredRotation();
        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.executeSignerRotation(rotation);
        vm.expectEmit(true, true, true, true, address(directory));
        emit Directory.SignerRotationExpired(digest, 1, 1);
        directory.clearExpiredRotation();
        assertEq(directory.rotationNonce(), 2);
        assertEq(directory.signerSetEpoch(), 1);
    }

    function testIncomingDeadlineMustAllowFullNotice() public {
        Directory.SignerRotation memory rotation = _rotation(signerA, signerD);
        rotation.deadline = uint48(vm.getBlockTimestamp() + 2 days - 1);
        bytes32 digest = directory.signerRotationDigest(rotation);
        bytes memory first = _sign(B, digest);
        bytes memory second = _sign(C, digest);
        bytes memory acceptance = _accept(rotation, D);
        vm.expectRevert(Directory.InvalidAction.selector);
        directory.scheduleSignerRotation(rotation, first, second, acceptance);
    }

    function testRotationInvalidatesPendingPublicationAndReaddedKeyCannotReplay() public {
        Directory.Action memory old = _publication();
        bytes32 oldDigest = directory.actionDigest(old);
        bytes memory oldFirst = _sign(A, oldDigest);
        bytes memory oldSecond = _sign(B, oldDigest);
        directory.schedule(old, oldFirst, oldSecond);
        _rotate(signerA, signerD, B, C, D);
        (bytes32 pending,,) = directory.pending();
        assertEq(pending, bytes32(0));
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(old);

        Directory.Action memory fresh = _publication();
        bytes32 digest = directory.actionDigest(fresh);
        bytes memory removed = _sign(A, digest);
        bytes memory active = _sign(B, digest);
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.schedule(fresh, removed, active);

        _rotate(signerD, signerA, B, C, A);
        assertTrue(directory.isSigner(signerA));
        assertEq(directory.signerSetEpoch(), 3);
        vm.expectRevert(Directory.InvalidAction.selector);
        directory.schedule(old, oldFirst, oldSecond);
        fresh = _publication();
        vm.expectRevert(Directory.InvalidSigners.selector);
        directory.schedule(fresh, oldFirst, oldSecond);
        _schedule(fresh, A, B);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        directory.execute(fresh);
        assertEq(directory.currentFactory().factory, factory);
    }

    function testRotationDuringSuspensionPreservesPauseAndFreshResumeDelay() public {
        Directory.Action memory publication = _publication();
        _schedule(publication, A, B);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        directory.execute(publication);
        Directory.Action memory suspend = _action(Directory.ActionKind.Suspend);
        bytes32 digest = directory.actionDigest(suspend);
        directory.suspend(suspend, _sign(A, digest), _sign(C, digest));
        Directory.Action memory oldResume = _action(Directory.ActionKind.Resume);
        _schedule(oldResume, A, C);
        _rotate(signerA, signerD, B, C, D);
        assertTrue(directory.suspended());
        assertEq(directory.currentFactory().factory, address(0));
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(oldResume);

        Directory.Action memory resume = _action(Directory.ActionKind.Resume);
        _schedule(resume, B, D);
        vm.expectRevert(Directory.NotExecutable.selector);
        directory.execute(resume);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        directory.execute(resume);
        assertFalse(directory.suspended());
        assertEq(directory.currentFactory().factory, factory);
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _accept(Directory.SignerRotation memory rotation, uint256 key) private view returns (bytes memory) {
        return _sign(key, directory.rotationAcceptanceDigest(directory.signerRotationDigest(rotation)));
    }

    function _rotation(address departing, address incoming) private view returns (Directory.SignerRotation memory) {
        return Directory.SignerRotation(
            departing,
            incoming,
            directory.signerSetEpoch(),
            directory.rotationNonce(),
            uint48(vm.getBlockTimestamp() + 8 days)
        );
    }

    function _scheduleRotation(
        Directory.SignerRotation memory rotation,
        uint256 first,
        uint256 second,
        uint256 incoming
    ) private {
        bytes32 digest = directory.signerRotationDigest(rotation);
        directory.scheduleSignerRotation(
            rotation, _sign(first, digest), _sign(second, digest), _accept(rotation, incoming)
        );
    }

    function _rotate(address departing, address incoming, uint256 first, uint256 second, uint256 incomingKey) private {
        Directory.SignerRotation memory rotation = _rotation(departing, incoming);
        _scheduleRotation(rotation, first, second, incomingKey);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        directory.executeSignerRotation(rotation);
    }

    function _action(Directory.ActionKind kind) private view returns (Directory.Action memory) {
        return Directory.Action(
            kind,
            directory.nonce(),
            0,
            address(0),
            bytes32(0),
            directory.signerSetEpoch(),
            uint48(vm.getBlockTimestamp() + 8 days)
        );
    }

    function _publication() private view returns (Directory.Action memory action) {
        action = _action(Directory.ActionKind.Publish);
        action.version = 1;
        action.factory = factory;
        action.runtimeHash = factory.codehash;
    }

    function _schedule(Directory.Action memory action, uint256 first, uint256 second) private {
        bytes32 digest = directory.actionDigest(action);
        directory.schedule(action, _sign(first, digest), _sign(second, digest));
    }
}
