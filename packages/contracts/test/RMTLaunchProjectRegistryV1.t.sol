// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTLaunchCurveDirectoryV1 as Directory} from "../src/RMTLaunchCurveDirectoryV1.sol";
import {RMTLaunchProjectRegistryV1 as Registry} from "../src/RMTLaunchProjectRegistryV1.sol";

contract RegistryMarketFixture {
    address public immutable factory = msg.sender;
    address public immutable projectRegistry;
    address public immutable token;
    address public immutable creator;
    uint32 public executionVersion = 1;
    address public executionEngine;
    bool public graduated;
    bool public reject;
    uint256 public backing = 21;

    constructor(address registry, address asset, address creator_) {
        projectRegistry = registry;
        token = asset;
        creator = creator_;
        executionEngine = address(this);
    }

    function configure(bool reject_, bool graduated_) external {
        reject = reject_;
        graduated = graduated_;
    }

    function migrateExecution(address engine, bytes32 runtimeHash) external {
        require(msg.sender == projectRegistry && engine.codehash == runtimeHash);
        ++executionVersion;
        executionEngine = engine;
        if (reject) revert("fixture migration fault");
    }
}

contract RegistryFactoryFixture {
    uint32 public constant engineVersion = 1;
    mapping(address => address) public curveForToken;

    function create(Registry registry, address token, address creator) external returns (RegistryMarketFixture market) {
        market = new RegistryMarketFixture(address(registry), token, creator);
        curveForToken[token] = address(market);
        registry.register(token, address(market));
    }
}

contract RMTLaunchProjectRegistryV1Test is Test {
    Directory private directory;
    Registry private registry;
    RegistryFactoryFixture private factory;
    RegistryMarketFixture private market;
    address private token;
    address private engine;

    function setUp() public {
        vm.warp(10 days);
        directory = new Directory(vm.addr(1), vm.addr(2), vm.addr(3));
        registry = new Registry(directory);
        factory = new RegistryFactoryFixture();
        Directory.Action memory publication = Directory.Action(
            Directory.ActionKind.Publish,
            0,
            1,
            address(factory),
            address(factory).codehash,
            uint48(block.timestamp + 4 days)
        );
        bytes32 digest = directory.actionDigest(publication);
        directory.schedule(publication, _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(publication);
        token = address(new RegistryFactoryFixture());
        engine = address(new RegistryFactoryFixture());
        market = factory.create(registry, token, address(this));
    }

    function _sign(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _propose() private {
        registry.proposeMigration(token, engine, engine.codehash, uint48(block.timestamp + 5 days));
    }

    function _schedule() private {
        bytes32 digest = registry.migrationDigest(token);
        registry.scheduleMigration(token, _sign(digest, 1), _sign(digest, 3));
    }

    function testRequiresExactCreatorProposalTwoSignersAndPublicDelay() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.proposeMigration(token, engine, engine.codehash, uint48(block.timestamp + 5 days));
        _propose();
        bytes32 digest = registry.migrationDigest(token);
        bytes memory first = _sign(digest, 1);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(token, first, first);
        _schedule();
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(token);
        vm.warp(block.timestamp + registry.migrationDelay());
        vm.prank(address(0xBEEF));
        registry.executeMigration(token);
        (address factory_, address curve, uint32 version, address current, uint64 count) = registry.project(token);
        assertEq(factory_, address(factory));
        assertEq(curve, address(market));
        assertEq(version, 2);
        assertEq(current, engine);
        assertEq(count, 1);
        assertEq(market.backing(), 21);
        (uint32 from, uint32 to, address previous, address next, bytes32 hash,,) = registry.migration(token, 1);
        assertEq(from, 1);
        assertEq(to, 2);
        assertEq(previous, address(market));
        assertEq(next, engine);
        assertEq(hash, engine.codehash);
    }

    function testMigrationFailureOrGraduationDoesNotAdvanceHistory() public {
        _propose();
        _schedule();
        vm.warp(block.timestamp + registry.migrationDelay());
        market.configure(true, false);
        vm.expectRevert(bytes("fixture migration fault"));
        registry.executeMigration(token);
        (,, uint32 version,, uint64 count) = registry.project(token);
        assertEq(version, 1);
        assertEq(count, 0);
        assertEq(market.executionVersion(), 1);
        market.configure(false, true);
        vm.expectRevert(Registry.NotExecutable.selector);
        registry.executeMigration(token);
        assertEq(market.executionVersion(), 1);
    }

    function testCancelledSignaturesCannotScheduleAReplacementProposal() public {
        _propose();
        bytes32 digest = registry.migrationDigest(token);
        bytes memory first = _sign(digest, 1);
        bytes memory second = _sign(digest, 2);
        registry.cancelMigration(token);
        _propose();
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.scheduleMigration(token, first, second);
        assertEq(registry.migrationNonce(token), 1);
        _schedule();
    }
}
