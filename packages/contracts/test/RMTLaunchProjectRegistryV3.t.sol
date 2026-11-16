// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTLaunchCurveTokenV2 as Token} from "../src/RMTLaunchCurveTokenV2.sol";
import {RMTLaunchCurveDirectoryV2 as Directory} from "../src/RMTLaunchCurveDirectoryV2.sol";
import {RMTLaunchProjectRegistryV2 as RegistryV2} from "../src/RMTLaunchProjectRegistryV2.sol";
import {RMTLaunchProjectRegistryV3 as RegistryV3} from "../src/RMTLaunchProjectRegistryV3.sol";
import {RegistryEpochCurve, RegistryEpochToken} from "./RMTLaunchProjectRegistryV2.t.sol";

interface ICallbackRegistry {
    function register(address token, address curve) external;
    function project(address token)
        external
        view
        returns (address factory, address curve, uint32 version, address engine, uint64 migrations);
    function proposeMigration(address token, address nextCurve, bytes32 runtimeHash, uint48 deadline) external;
    function migrationDigest(address token) external view returns (bytes32);
    function scheduleMigration(address token, bytes calldata first, bytes calldata second) external;
    function executeMigration(address token) external;
    function migrationNonce(address token) external view returns (uint64);
}

contract MigrationRouteConsumer {
    address public routedCurve;
    uint32 public routedVersion;
    bytes4 public unavailable;
    uint64 public observedNonce;
    address public unrelatedRoute;

    function route(ICallbackRegistry registry, address token, address unrelated) external {
        try registry.project(token) returns (address, address curve, uint32 version, address, uint64) {
            routedCurve = curve;
            routedVersion = version;
        } catch (bytes memory failure) {
            unavailable = bytes4(failure);
        }
        observedNonce = registry.migrationNonce(token);
        (, unrelatedRoute,,,) = registry.project(unrelated);
    }
}

contract PostHandoffCallbackFactory {
    uint32 public constant engineVersion = 1;
    ICallbackRegistry public immutable registry;
    MigrationRouteConsumer public immutable consumer;
    mapping(address token => address curve) public curveForToken;
    mapping(address token => mapping(uint32 version => address curve)) public migrationCandidate;
    address private unrelatedToken;

    constructor(ICallbackRegistry registry_) {
        registry = registry_;
        consumer = new MigrationRouteConsumer();
    }

    function create(address creator) external returns (address token, address origin, address successor) {
        return register(address(new Token("Test token", "TEST")), creator);
    }

    function register(address token, address creator) public returns (address, address origin, address successor) {
        origin = address(new RegistryEpochCurve(token, creator, address(registry), address(0), 1));
        successor = address(new RegistryEpochCurve(token, creator, address(registry), origin, 2));
        curveForToken[token] = origin;
        migrationCandidate[token][2] = successor;
        registry.register(token, origin);
        if (unrelatedToken == address(0)) unrelatedToken = token;
        return (token, origin, successor);
    }

    function successorDeployer() external view returns (address) {
        return address(this);
    }

    function successorDeployerRuntimeHash() external view returns (bytes32) {
        return address(this).codehash;
    }

    function executeMigration(address token, address nextEngine, bytes32 runtimeHash) external {
        require(msg.sender == address(registry) && nextEngine.codehash == runtimeHash);
        RegistryEpochCurve(curveForToken[token]).transferActivity(nextEngine);
        RegistryEpochCurve(nextEngine).acceptActivity();
        curveForToken[token] = nextEngine;
        consumer.route(registry, token, unrelatedToken);
    }
}

contract RMTLaunchProjectRegistryV3Test is Test {
    address private constant CREATOR = address(0x31103);

    function testHistoricalMixedRouteAndNewCandidateCallbackBarrier() external {
        vm.chainId(31_337);
        vm.warp(100 days);
        _checkCallback(false);
        _checkCallback(true);
    }

    function _checkCallback(bool guarded) private {
        Directory directory = new Directory(vm.addr(1), vm.addr(2), vm.addr(3));
        ICallbackRegistry registry = ICallbackRegistry(
            guarded ? address(new RegistryV3(directory)) : address(new RegistryV2(directory))
        );
        PostHandoffCallbackFactory factory = new PostHandoffCallbackFactory(registry);
        Directory.Action memory publish = Directory.Action(
            Directory.ActionKind.Publish,
            0,
            1,
            address(factory),
            address(factory).codehash,
            directory.signerSetEpoch(),
            uint48(vm.getBlockTimestamp() + 4 days)
        );
        bytes32 digest = directory.actionDigest(publish);
        directory.schedule(publish, _sign(digest, 1), _sign(digest, 2));
        vm.warp(vm.getBlockTimestamp() + 2 days);
        directory.execute(publish);
        if (guarded) _rejectBypassViaAdmittedFactory(factory);
        (, address unrelated,) = factory.create(CREATOR);
        (address token, address origin, address successor) = factory.create(CREATOR);
        vm.prank(CREATOR);
        registry.proposeMigration(token, successor, successor.codehash, uint48(vm.getBlockTimestamp() + 4 days));
        digest = registry.migrationDigest(token);
        registry.scheduleMigration(token, _sign(digest, 1), _sign(digest, 2));
        vm.warp(vm.getBlockTimestamp() + 2 days);
        registry.executeMigration(token);

        MigrationRouteConsumer consumer = factory.consumer();
        if (guarded) {
            assertFalse(RegistryV3(address(registry)).migrationInProgress(token));
            assertEq(consumer.unavailable(), RegistryV3.MigrationInProgress.selector);
            assertEq(consumer.routedCurve(), address(0));
            assertEq(consumer.observedNonce(), 0);
        } else {
            assertEq(consumer.unavailable(), bytes4(0));
            assertEq(consumer.routedCurve(), origin);
            assertEq(consumer.routedVersion(), 1);
            assertFalse(RegistryEpochCurve(origin).active());
            assertEq(consumer.observedNonce(), 1);
        }
        assertEq(consumer.unrelatedRoute(), unrelated);
        (, address committed, uint32 version, address engine, uint64 migrations) = registry.project(token);
        assertEq(committed, successor);
        assertEq(engine, successor);
        assertEq(version, 2);
        assertEq(migrations, 1);
        assertEq(factory.curveForToken(token), successor);
        assertEq(registry.migrationNonce(token), 1);
        assertTrue(RegistryEpochCurve(successor).active());
    }

    function _rejectBypassViaAdmittedFactory(PostHandoffCallbackFactory factory) private {
        address alternateCode = address(new RegistryEpochToken());
        vm.expectRevert(RegistryV3.InvalidProject.selector);
        factory.register(alternateCode, CREATOR);

        address wrongSupply = address(new Token("Wrong state", "WRONG"));
        vm.mockCall(wrongSupply, abi.encodeCall(IERC20.totalSupply, ()), abi.encode(1 ether));
        vm.expectRevert(RegistryV3.InvalidProject.selector);
        factory.register(wrongSupply, CREATOR);
        vm.clearMockedCalls();
    }

    function _sign(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
