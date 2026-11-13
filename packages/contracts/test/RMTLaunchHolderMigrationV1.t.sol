// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTLaunchBondingCurveV1} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveDirectoryV1 as Directory} from "../src/RMTLaunchCurveDirectoryV1.sol";
import {RMTLaunchCurveFactoryV1} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchHolderMigrationV1} from "../src/RMTLaunchHolderMigrationV1.sol";
import {RMTLaunchProjectRegistryV1} from "../src/RMTLaunchProjectRegistryV1.sol";

contract HolderMigrationCurveFixture {
    address public immutable creator;
    address public immutable token;

    constructor(address creator_, address token_) {
        creator = creator_;
        token = token_;
    }
}

contract HolderMigrationRegistryFixture {
    address public factory;
    address public curve;
    address public token;

    function record(address factory_, address curve_, address token_) external {
        factory = factory_;
        curve = curve_;
        token = token_;
    }

    function project(address token_) external view returns (address, address, uint32, address, uint64) {
        require(token_ == token);
        return (factory, curve, 1, address(0), 0);
    }

    function projectRegistry() external view returns (address) {
        return address(this);
    }

    function curveForToken(address token_) external view returns (address) {
        return token_ == token ? curve : address(0);
    }
}

contract HolderMigrationGraduationFixture {
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }
}

contract HolderMigrationTokenFixture is ERC20 {
    bool private levy;
    uint8 private precision = 18;
    bool public attemptedReentry;
    bool public reentrySucceeded;
    bytes4 public reentryFailure;
    address private reentryEscrow;

    constructor(address holder, uint256 supply) ERC20("Original", "OLD") {
        _mint(holder, supply);
    }

    function decimals() public view override returns (uint8) {
        return precision;
    }

    function setPrecision(uint8 value) external {
        precision = value;
    }

    function setFee(bool on) external {
        levy = on;
    }

    function tryReenter(address escrow) external {
        reentryEscrow = escrow;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (reentryEscrow != address(0)) {
            attemptedReentry = true;
            bytes memory reason;
            (reentrySucceeded, reason) =
                reentryEscrow.call(abi.encodeCall(RMTLaunchHolderMigrationV1.redeem, (amount, block.timestamp)));
            reentryFailure = bytes4(reason);
        }
        if (!levy) return super.transferFrom(from, to, amount);
        _spendAllowance(from, _msgSender(), amount);
        _transfer(from, to, amount - 1);
        _transfer(from, address(1), 1);
        return true;
    }
}

contract RMTLaunchHolderMigrationV1Test is Test {
    address private creator = makeAddr("migration creator");
    address private holder = makeAddr("migration holder");
    address private other = makeAddr("migration other");
    HolderMigrationRegistryFixture private registry;
    HolderMigrationTokenFixture private original;
    HolderMigrationCurveFixture private curve;
    RMTLaunchHolderMigrationV1 private migration;
    uint256 private constant SUPPLY = 1_000_000 ether;

    function setUp() public {
        vm.chainId(31337);
        registry = new HolderMigrationRegistryFixture();
        original = new HolderMigrationTokenFixture(holder, SUPPLY);
        curve = new HolderMigrationCurveFixture(creator, address(original));
        registry.record(address(registry), address(curve), address(original));
        migration = _deploy(creator, address(registry).codehash, address(original).codehash);
    }

    function testNoHolderChangesBeforeOptInAndAllUnitsRedeemOneForOne() public {
        IERC20 replacement = IERC20(address(migration.replacementToken()));
        assertEq(address(replacement) == address(original), false);
        assertEq(original.totalSupply(), SUPPLY);
        assertEq(original.balanceOf(holder), SUPPLY);
        assertEq(replacement.totalSupply(), SUPPLY);
        assertEq(replacement.balanceOf(address(migration)), SUPPLY);
        assertEq(replacement.balanceOf(holder), 0);

        vm.startPrank(holder);
        original.approve(address(migration), SUPPLY);
        migration.redeem(SUPPLY, block.timestamp);
        vm.stopPrank();
        assertEq(original.totalSupply(), SUPPLY);
        assertEq(original.balanceOf(holder), 0);
        assertEq(original.balanceOf(address(migration)), SUPPLY);
        assertEq(replacement.balanceOf(holder), SUPPLY);
        assertEq(replacement.balanceOf(address(migration)), 0);
        assertEq(migration.totalRedeemed(), SUPPLY);
        assertEq(original.allowance(holder, address(migration)), 0);

        vm.prank(creator);
        (bool drained,) = address(migration).call(abi.encodeWithSignature("withdraw(address,uint256)", creator, SUPPLY));
        assertFalse(drained);
        assertEq(original.balanceOf(address(migration)), SUPPLY);
    }

    function testRequiresVerifiedProjectRuntimeCreatorAndDecimals() public {
        vm.expectRevert(RMTLaunchHolderMigrationV1.UnauthorizedCreator.selector);
        _deploy(other, address(registry).codehash, address(original).codehash);
        vm.expectRevert(RMTLaunchHolderMigrationV1.InvalidProject.selector);
        _deploy(creator, bytes32(uint256(1)), address(original).codehash);
        vm.expectRevert(RMTLaunchHolderMigrationV1.InvalidProject.selector);
        _deploy(creator, address(registry).codehash, bytes32(uint256(1)));
        original.setPrecision(6);
        vm.expectRevert(RMTLaunchHolderMigrationV1.InvalidTerms.selector);
        _deploy(creator, address(registry).codehash, address(original).codehash);
        vm.chainId(4663);
        vm.expectRevert(RMTLaunchHolderMigrationV1.WrongChain.selector);
        _deploy(creator, address(registry).codehash, address(original).codehash);
    }

    function testHolderCannotRedeemForAnotherOrUseOpenEndedApproval() public {
        vm.prank(holder);
        original.approve(address(migration), type(uint256).max);
        vm.expectRevert(RMTLaunchHolderMigrationV1.InvalidRedemption.selector);
        vm.prank(holder);
        migration.redeem(100, block.timestamp);
        vm.expectRevert(RMTLaunchHolderMigrationV1.InvalidRedemption.selector);
        vm.prank(other);
        migration.redeem(100, block.timestamp);
        vm.expectRevert(RMTLaunchHolderMigrationV1.InvalidDeadline.selector);
        vm.prank(holder);
        migration.redeem(100, block.timestamp + 31 minutes);
        assertEq(migration.totalRedeemed(), 0);
    }

    function testUnderpaymentRevertsEveryBalanceAndExactAllowanceThenCanRetry() public {
        IERC20 replacement = IERC20(address(migration.replacementToken()));
        original.setFee(true);
        vm.startPrank(holder);
        original.approve(address(migration), 100);
        vm.expectRevert(RMTLaunchHolderMigrationV1.SettlementMismatch.selector);
        migration.redeem(100, block.timestamp);
        vm.stopPrank();
        assertEq(original.balanceOf(holder), SUPPLY);
        assertEq(original.balanceOf(address(migration)), 0);
        assertEq(original.allowance(holder, address(migration)), 100);
        assertEq(replacement.balanceOf(holder), 0);
        assertEq(migration.totalRedeemed(), 0);
        original.setFee(false);
        vm.prank(holder);
        migration.redeem(100, block.timestamp);
        assertEq(replacement.balanceOf(holder), 100);
        assertEq(migration.totalRedeemed(), 100);
    }

    function testMaliciousCallbackCannotReenterOrReleaseAdditionalSupply() public {
        original.tryReenter(address(migration));
        vm.startPrank(holder);
        original.approve(address(migration), 100);
        migration.redeem(100, block.timestamp);
        vm.stopPrank();
        assertTrue(original.attemptedReentry());
        assertFalse(original.reentrySucceeded());
        assertEq(original.reentryFailure(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(migration.totalRedeemed(), 100);
        assertEq(migration.replacementToken().balanceOf(holder), 100);
        assertEq(original.balanceOf(address(migration)), 100);
    }

    function testDirectDonationDoesNotCreateRedemptionOrClaim() public {
        vm.prank(holder);
        original.transfer(address(migration), 50);
        assertEq(migration.totalRedeemed(), 0);
        assertEq(migration.replacementToken().balanceOf(holder), 0);
        vm.startPrank(holder);
        original.approve(address(migration), 100);
        migration.redeem(100, block.timestamp);
        vm.stopPrank();
        assertEq(original.balanceOf(address(migration)), 150);
        assertEq(migration.totalRedeemed(), 100);
        assertEq(migration.replacementToken().balanceOf(holder), 100);
    }

    function testRegisteredLaunchEscrowPreservesCanonicalProjectAndCurveBacking() public {
        Directory directory = new Directory(vm.addr(41), vm.addr(42), vm.addr(43));
        RMTLaunchProjectRegistryV1 projects = new RMTLaunchProjectRegistryV1(directory);
        address predictedFactory = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        HolderMigrationGraduationFixture graduate = new HolderMigrationGraduationFixture(predictedFactory);
        RMTLaunchCurveFactoryV1 launchFactory =
            new RMTLaunchCurveFactoryV1(address(graduate), makeAddr("ops"), makeAddr("reserve"), address(projects));
        Directory.Action memory publish = Directory.Action(
            Directory.ActionKind.Publish,
            0,
            1,
            address(launchFactory),
            address(launchFactory).codehash,
            uint48(block.timestamp + 4 days)
        );
        bytes32 digest = directory.actionDigest(publish);
        directory.schedule(publish, _sign(digest, 41), _sign(digest, 42));
        vm.warp(block.timestamp + directory.publicationDelay());
        directory.execute(publish);

        vm.prank(creator);
        (address token, address market) =
            launchFactory.create("Registered", "REG", "", 0, address(0), 0, bytes32(uint256(1)), block.timestamp);
        RMTLaunchBondingCurveV1 bonded = RMTLaunchBondingCurveV1(payable(market));
        vm.deal(holder, 1 ether);
        vm.prank(holder);
        uint256 tokens = bonded.buy{value: 0.1 ether}(1, block.timestamp);
        uint256 backingBefore = bonded.backingReserve();
        uint256 feesBefore = bonded.revenueLedger().totalAccrued();
        vm.prank(creator);
        RMTLaunchHolderMigrationV1 proposed = new RMTLaunchHolderMigrationV1(
            address(projects), address(projects).codehash, token, token.codehash, "Registered Replacement", "REGR"
        );
        vm.startPrank(holder);
        IERC20(token).approve(address(proposed), tokens);
        proposed.redeem(tokens, block.timestamp);
        vm.stopPrank();

        (address registeredFactory, address registeredCurve, uint32 version, address engine, uint64 migrations) =
            projects.project(token);
        assertEq(registeredFactory, address(launchFactory));
        assertEq(registeredCurve, market);
        assertEq(version, 1);
        assertEq(engine, market);
        assertEq(migrations, 0);
        (address replacementFactory,,,,) = projects.project(address(proposed.replacementToken()));
        assertEq(replacementFactory, address(0));
        assertEq(bonded.backingReserve(), backingBefore);
        assertEq(bonded.revenueLedger().totalAccrued(), feesBefore);
        assertEq(IERC20(token).totalSupply(), SUPPLY);
        assertEq(IERC20(token).balanceOf(address(proposed)), tokens);
        assertEq(proposed.replacementToken().balanceOf(holder), tokens);
    }

    function _sign(bytes32 digest, uint256 key) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _deploy(address sender, bytes32 registryHash, bytes32 originalHash)
        private
        returns (RMTLaunchHolderMigrationV1)
    {
        vm.prank(sender);
        return
            new RMTLaunchHolderMigrationV1(
                address(registry), registryHash, address(original), originalHash, "New", "NEW"
            );
    }
}
