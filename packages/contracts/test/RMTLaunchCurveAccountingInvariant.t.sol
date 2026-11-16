// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTLaunchBondingCurveV1 as Curve} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1 as V2Template} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveSuccessorDeployerV2 as V3Template} from "../src/RMTLaunchBondingCurveV3.sol";
import {RMTLaunchCurveDirectoryV1 as Directory} from "../src/RMTLaunchCurveDirectoryV1.sol";
import {RMTLaunchCurveFactoryV1 as Factory} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchProjectRegistryV1 as Registry} from "../src/RMTLaunchProjectRegistryV1.sol";
import {RMTLaunchCurveRevenueLedgerV1 as Ledger} from "../src/RMTLaunchCurveRevenueLedgerV1.sol";
import {MigrationGraduationBinding} from "./RMTLaunchMigrationReadiness.t.sol";

contract CurveAccountingHandler is Test {
    Factory private immutable factory;
    Registry private immutable registry;
    IERC20 private immutable asset;
    Ledger private immutable ledger;
    address[2] private traders;
    address[4] private recipients;

    uint256 public tradeFees;
    uint256 public claims;
    bool public creationClaimed;

    constructor(Factory factory_, Registry registry_, Curve origin, address[2] memory traders_) {
        factory = factory_;
        registry = registry_;
        asset = origin.token();
        ledger = origin.revenueLedger();
        traders = traders_;
        recipients = [origin.creator(), origin.treasury(), origin.operatingRecipient(), origin.futureReserveRecipient()];
    }

    function buy(uint256 actorSeed, uint96 budgetSeed) external {
        Curve market = _market();
        address trader = traders[actorSeed % traders.length];
        uint256 budget = bound(budgetSeed, 3, 0.4 ether);
        (uint256 received, uint256 gross, uint256 fee, uint256 refund) = market.quoteBuy(budget);
        if (received == 0) return;
        uint256 before = trader.balance;
        vm.prank(trader);
        assertEq(market.buy{value: budget}(received, block.timestamp), received);
        assertEq(before - trader.balance, gross);
        assertEq(gross + refund, budget);
        tradeFees += fee;
    }

    function sell(uint256 actorSeed, uint96 amountSeed) external {
        Curve market = _market();
        address trader = traders[actorSeed % traders.length];
        uint256 held = asset.balanceOf(trader);
        if (held == 0) return;
        uint256 amount = bound(amountSeed, 1, held);
        (uint256 nativeOut, uint256 gross, uint256 fee) = market.quoteSell(amount);
        if (nativeOut == 0) return;
        uint256 before = trader.balance;
        vm.startPrank(trader);
        assertTrue(asset.approve(address(market), amount));
        assertEq(market.sell(amount, nativeOut, block.timestamp), nativeOut);
        vm.stopPrank();
        assertEq(trader.balance - before, nativeOut);
        assertEq(nativeOut + fee, gross);
        assertEq(asset.allowance(trader, address(market)), 0);
        tradeFees += fee;
    }

    function claim(uint256 recipientSeed) external {
        uint256 bucket = recipientSeed % (recipients.length + 1);
        if (bucket == recipients.length) {
            if (creationClaimed) return;
            uint256 before = factory.operatingRecipient().balance;
            assertEq(factory.claimCreationFees(), factory.creationFeeWei());
            assertEq(factory.operatingRecipient().balance - before, factory.creationFeeWei());
            creationClaimed = true;
            return;
        }
        address recipient = recipients[bucket];
        uint256 credit = ledger.claimable(recipient);
        if (credit == 0) return;
        uint256 priorBalance = recipient.balance;
        vm.prank(recipient);
        assertEq(ledger.claim(), credit);
        assertEq(recipient.balance - priorBalance, credit);
        claims += credit;
    }

    function migrate() external {
        Curve source = _market();
        uint32 version = source.executionVersion();
        if (version == 3) return;
        address tokenAddress = address(asset);
        address next = factory.prepareMigration(tokenAddress, version + 1);
        vm.prank(source.creator());
        registry.proposeMigration(tokenAddress, next, next.codehash, uint48(block.timestamp + 4 days));
        bytes32 digest = registry.migrationDigest(tokenAddress);
        registry.scheduleMigration(tokenAddress, _sign(digest, 1), _sign(digest, 2));
        vm.warp(block.timestamp + registry.migrationDelay());
        registry.executeMigration(tokenAddress);
        assertFalse(source.active());
        assertEq(source.migratedTo(), next);
        assertEq(source.backingReserve(), 0);
        assertEq(address(source).balance, 0);
        assertEq(asset.balanceOf(address(source)), 0);
    }

    function _market() private view returns (Curve) {
        return Curve(payable(factory.curveForToken(address(asset))));
    }

    function _sign(bytes32 digest, uint256 key) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}

contract RMTLaunchCurveAccountingInvariantTest is Test {
    address private constant CREATOR = address(0x301);
    address private constant TREASURY = address(0x302);
    address private constant OPERATING = address(0x303);
    address private constant RESERVE = address(0x304);
    address private constant ALICE = address(0x305);
    address private constant BOB = address(0x306);
    uint256 private constant CREATION_FEE = 0.0004 ether;
    uint256 private constant STARTING_BALANCE = 20 ether;

    Factory private factory;
    Registry private registry;
    Curve private origin;
    IERC20 private asset;
    Ledger private ledger;
    CurveAccountingHandler private handler;

    function setUp() external {
        vm.chainId(31_337);
        vm.warp(100 days);
        Directory directory = new Directory(vm.addr(1), vm.addr(2), vm.addr(3));
        registry = new Registry(directory);
        address v2 = address(new V2Template());
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        MigrationGraduationBinding graduation = new MigrationGraduationBinding(predicted);
        factory = new Factory(address(graduation), OPERATING, RESERVE, address(registry), v2, v2.codehash, CREATION_FEE);
        _publish(directory, Directory.ActionKind.Publish, 1, address(factory));
        _publish(directory, Directory.ActionKind.PublishMigrationTemplate, 3, address(new V3Template()));
        vm.deal(CREATOR, CREATION_FEE);
        vm.prank(CREATOR);
        (address tokenAddress, address curveAddress) = factory.create{value: CREATION_FEE}(
            "Accounting review", "ACCT", "", 0, TREASURY, 2_000, bytes32(uint256(1)), block.timestamp
        );
        asset = IERC20(tokenAddress);
        origin = Curve(payable(curveAddress));
        ledger = origin.revenueLedger();
        vm.deal(ALICE, STARTING_BALANCE);
        vm.deal(BOB, STARTING_BALANCE);
        handler = new CurveAccountingHandler(factory, registry, origin, [ALICE, BOB]);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 32
    /// forge-config: default.invariant.fail-on-revert = true
    function invariantConservesBackingInventoryAndIndependentFeeBucketsAcrossGovernedVersions() external view {
        (address registeredFactory, address registeredCurve, uint32 version, address engine, uint64 migrations) =
            registry.project(address(asset));
        Curve market = Curve(payable(registeredCurve));
        assertEq(registeredFactory, address(factory));
        assertEq(registeredCurve, factory.curveForToken(address(asset)));
        assertEq(registry.originCurve(address(asset)), address(origin));
        assertEq(registeredCurve, engine);
        assertEq(market.executionVersion(), version);
        assertEq(migrations, version - 1);
        assertEq(registry.migrationNonce(address(asset)), migrations);
        assertTrue(market.active());
        assertFalse(market.graduated());
        assertEq(market.migrationCommitment(), origin.migrationCommitment());
        assertEq(ledger.activeCurve(), registeredCurve);
        assertEq(address(market.revenueLedger()), address(ledger));

        uint256 sold = market.sold();
        uint256 supply = asset.totalSupply();
        assertEq(supply, 1_000_000 ether);
        assertLe(sold, market.graduationSold());
        assertEq(asset.balanceOf(ALICE) + asset.balanceOf(BOB), sold);
        assertEq(asset.balanceOf(registeredCurve) + sold, supply);
        uint256 denominator = market.virtualToken() - sold;
        uint256 roundedBacking = (market.VIRTUAL_ETH() * sold + denominator - 1) / denominator;
        assertEq(market.backingReserve(), roundedBacking);
        assertEq(registeredCurve.balance, roundedBacking);

        uint256 fees = handler.tradeFees();
        uint256 claimed = handler.claims();
        uint256 platform = fees / 10;
        uint256 project = fees - platform;
        uint256 treasury = project * 2_000 / 9_000;
        assertEq(ledger.totalAccrued(), fees);
        assertEq(ledger.totalClaimed(), claimed);
        assertEq(ledger.bucketAccrued(0), project - treasury);
        assertEq(ledger.bucketAccrued(1), treasury);
        assertEq(ledger.bucketAccrued(2), platform / 2);
        assertEq(ledger.bucketAccrued(3), platform - platform / 2);
        assertEq(
            ledger.claimable(CREATOR) + ledger.claimable(TREASURY) + ledger.claimable(OPERATING)
                + ledger.claimable(RESERVE),
            fees - claimed
        );
        assertEq(address(ledger).balance, fees - claimed);
        uint256 factoryBalance = handler.creationClaimed() ? 0 : CREATION_FEE;
        assertEq(factory.creationFeesAccrued(), factoryBalance);
        assertEq(address(factory).balance, factoryBalance);
        assertEq(
            CREATOR.balance + TREASURY.balance + OPERATING.balance + RESERVE.balance,
            claimed + CREATION_FEE - factoryBalance
        );
        assertEq(ALICE.balance + BOB.balance + registeredCurve.balance + fees, STARTING_BALANCE * 2);
    }

    function _publish(Directory directory, Directory.ActionKind kind, uint32 version, address target) private {
        Directory.Action memory action = Directory.Action(
            kind, directory.nonce(), version, target, target.codehash, uint48(block.timestamp + 4 days)
        );
        bytes32 digest = directory.actionDigest(action);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(1, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(2, digest);
        directory.schedule(action, abi.encodePacked(r1, s1, v1), abi.encodePacked(r2, s2, v2));
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(action);
    }
}
