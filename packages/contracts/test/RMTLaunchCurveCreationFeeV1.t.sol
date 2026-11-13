// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTLaunchBondingCurveV1} from "../src/RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveSuccessorDeployerV1} from "../src/RMTLaunchBondingCurveV2.sol";
import {RMTLaunchCurveFactoryV1} from "../src/RMTLaunchCurveFactoryV1.sol";
import {RMTLaunchCurveTokenV1} from "../src/RMTLaunchCurveTokenV1.sol";

contract CreationFeeGraduationBinding {
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }
}

contract CreationFeeRegistry {
    mapping(address token => address curve) public registered;
    bool public rejectRegistration;

    error RegistrationRejected();

    function setRejectRegistration(bool reject) external {
        rejectRegistration = reject;
    }

    function register(address token, address curve) external {
        registered[token] = curve;
        if (rejectRegistration) revert RegistrationRejected();
    }
}

contract CreationFeeReceiver {
    RMTLaunchCurveFactoryV1 private factory;
    bool private rejectNative;
    uint256 public totalReceived;
    bytes4 public createReentry;
    bytes4 public claimReentry;
    bytes4 public prepareReentry;
    bytes4 public migrateReentry;

    function configure(RMTLaunchCurveFactoryV1 factory_, bool reject) external {
        factory = factory_;
        rejectNative = reject;
    }

    function create(bytes32 intent) external payable returns (address token, address curve) {
        return factory.create{value: msg.value}("Fee Token", "FEE", "", 0, address(0), 0, intent, block.timestamp);
    }

    receive() external payable {
        require(!rejectNative);
        totalReceived += msg.value;
        (bool createOk, bytes memory createFailure) = address(factory)
            .call(
                abi.encodeCall(
                    factory.create, ("Reentry", "REE", "", 0, address(0), 0, bytes32("nested"), block.timestamp)
                )
            );
        (bool claimOk, bytes memory claimFailure) = address(factory).call(abi.encodeCall(factory.claimCreationFees, ()));
        (bool prepareOk, bytes memory prepareFailure) =
            address(factory).call(abi.encodeCall(factory.prepareMigration, (address(0), 2)));
        (bool migrateOk, bytes memory migrateFailure) =
            address(factory).call(abi.encodeCall(factory.executeMigration, (address(0), address(0), bytes32(0))));
        require(!createOk && !claimOk && !prepareOk && !migrateOk);
        createReentry = bytes4(createFailure);
        claimReentry = bytes4(claimFailure);
        prepareReentry = bytes4(prepareFailure);
        migrateReentry = bytes4(migrateFailure);
    }
}

contract RMTLaunchCurveCreationFeeV1Test is Test {
    uint256 private constant FEE = 0.0004 ether;
    bytes32 private constant INTENT = bytes32("creation-fee");
    RMTLaunchCurveFactoryV1 private factory;
    CreationFeeRegistry private registry;
    CreationFeeReceiver private treasury;
    address private creator = makeAddr("creator");
    address private caller = makeAddr("claim caller");

    event CreationFeePaid(
        address indexed token, address indexed creator, address indexed recipient, uint256 fee, uint256 refund
    );
    event CreationFeesClaimed(address indexed recipient, uint256 amount);

    function setUp() public {
        vm.chainId(31_337);
        treasury = new CreationFeeReceiver();
        registry = new CreationFeeRegistry();
        address successorDeployer = address(new RMTLaunchCurveSuccessorDeployerV1());
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        CreationFeeGraduationBinding graduation = new CreationFeeGraduationBinding(predicted);
        factory = new RMTLaunchCurveFactoryV1(
            address(graduation),
            address(treasury),
            makeAddr("future reserve"),
            address(registry),
            successorDeployer,
            successorDeployer.codehash,
            FEE
        );
        treasury.configure(factory, false);
        vm.deal(creator, 1 ether);
    }

    function testExactFeeCreatesZeroBackingAndClaimsOnlyFixedTreasuryCredit() public {
        assertEq(factory.creationFeeWei(), FEE);
        assertEq(factory.operatingRecipient(), address(treasury));
        address expectedToken = _predictedToken(creator);
        vm.expectEmit(true, true, true, true, address(factory));
        emit CreationFeePaid(expectedToken, creator, address(treasury), FEE, 0);
        (address token, address curveAddress) = _create(FEE);
        assertEq(token, expectedToken);
        RMTLaunchBondingCurveV1 curve = RMTLaunchBondingCurveV1(payable(curveAddress));
        assertEq(creator.balance, 1 ether - FEE);
        assertEq(registry.registered(token), curveAddress);
        assertEq(factory.tokenForIntent(creator, INTENT), token);
        assertEq(factory.creationFeesAccrued(), FEE);
        assertEq(address(factory).balance, FEE);
        assertEq(address(treasury).balance, 0);
        assertEq(address(curve).balance, 0);
        assertEq(curve.backingReserve(), 0);
        assertEq(address(curve.revenueLedger()).balance, 0);
        assertEq(IERC20(token).balanceOf(curveAddress), IERC20(token).totalSupply());
        assertEq(IERC20(token).balanceOf(creator), 0);

        // A pre-existing or forced balance is never a credit.
        vm.deal(address(factory), FEE + 17);
        vm.expectEmit(true, false, false, true, address(factory));
        emit CreationFeesClaimed(address(treasury), FEE);
        vm.prank(caller);
        assertEq(factory.claimCreationFees(), FEE);
        assertEq(caller.balance, 0);
        assertEq(treasury.totalReceived(), FEE);
        assertEq(address(treasury).balance, FEE);
        assertEq(factory.creationFeesAccrued(), 0);
        assertEq(address(factory).balance, 17);
        _assertReentryBlocked(treasury);
        vm.expectRevert(RMTLaunchCurveFactoryV1.NoCreationFees.selector);
        factory.claimCreationFees();
    }

    function testFuzzOverpaymentRefundsExactSurplus(uint96 rawRefund) public {
        uint256 refund = bound(uint256(rawRefund), 1, 1 ether - FEE);
        vm.expectEmit(true, true, true, true, address(factory));
        emit CreationFeePaid(_predictedToken(creator), creator, address(treasury), FEE, refund);
        _create(FEE + refund);
        assertEq(creator.balance, 1 ether - FEE);
        assertEq(address(factory).balance, FEE);
        assertEq(factory.creationFeesAccrued(), FEE);
    }

    function testRejectsInvalidOperatingTreasuryBindings() public {
        address reserve = factory.futureReserveRecipient();
        address deployer = address(factory.successorDeployer());
        bytes32 runtimeHash = factory.successorDeployerRuntimeHash();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        CreationFeeGraduationBinding graduation = new CreationFeeGraduationBinding(predicted);
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidConfiguration.selector);
        new RMTLaunchCurveFactoryV1(
            address(graduation), predicted, reserve, address(registry), deployer, runtimeHash, FEE
        );
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidConfiguration.selector);
        new RMTLaunchCurveFactoryV1(
            address(graduation), address(0), reserve, address(registry), deployer, runtimeHash, FEE
        );
        vm.expectRevert(RMTLaunchCurveFactoryV1.InvalidConfiguration.selector);
        new RMTLaunchCurveFactoryV1(
            address(graduation), reserve, reserve, address(registry), deployer, runtimeHash, FEE
        );
    }

    function testUnderpaymentDuplicateAndRegistryFailureKeepFeesAndIntentAtomic() public {
        vm.expectRevert(abi.encodeWithSelector(RMTLaunchCurveFactoryV1.InsufficientCreationFee.selector, FEE, FEE - 1));
        _create(FEE - 1);
        assertEq(factory.tokenForIntent(creator, INTENT), address(0));
        assertEq(factory.creationFeesAccrued(), 0);
        assertEq(creator.balance, 1 ether);

        registry.setRejectRegistration(true);
        vm.expectRevert(CreationFeeRegistry.RegistrationRejected.selector);
        _create(FEE);
        assertEq(factory.tokenForIntent(creator, INTENT), address(0));
        address expectedToken = _predictedToken(creator);
        assertEq(registry.registered(expectedToken), address(0));
        assertEq(expectedToken.code.length, 0);
        assertEq(factory.creationFeesAccrued(), 0);
        assertEq(address(factory).balance, 0);
        assertEq(creator.balance, 1 ether);

        registry.setRejectRegistration(false);
        (address token,) = _create(FEE);
        vm.expectRevert(RMTLaunchCurveFactoryV1.DuplicateIntent.selector);
        _create(FEE + 1);
        assertEq(factory.tokenForIntent(creator, INTENT), token);
        assertEq(factory.creationFeesAccrued(), FEE);
        assertEq(address(factory).balance, FEE);
        assertEq(creator.balance, 1 ether - FEE);
    }

    function testRefundRejectionRollsBackAndReentrantRefundCanRetrySameIntent() public {
        CreationFeeReceiver receiver = new CreationFeeReceiver();
        receiver.configure(factory, true);
        vm.deal(address(this), FEE + 17);
        vm.expectRevert(RMTLaunchCurveFactoryV1.CreationRefundFailed.selector);
        receiver.create{value: FEE + 17}(INTENT);
        assertEq(factory.tokenForIntent(address(receiver), INTENT), address(0));
        address expectedToken = _predictedToken(address(receiver));
        assertEq(registry.registered(expectedToken), address(0));
        assertEq(expectedToken.code.length, 0);
        assertEq(factory.creationFeesAccrued(), 0);
        assertEq(address(factory).balance, 0);
        assertEq(address(receiver).balance, 0);
        assertEq(address(this).balance, FEE + 17);

        receiver.configure(factory, false);
        (address token, address curve) = receiver.create{value: FEE + 17}(INTENT);
        assertEq(token, expectedToken);
        assertEq(factory.tokenForIntent(address(receiver), INTENT), token);
        assertEq(registry.registered(token), curve);
        assertEq(receiver.totalReceived(), 17);
        assertEq(address(receiver).balance, 17);
        assertEq(address(factory).balance, FEE);
        assertEq(factory.creationFeesAccrued(), FEE);
        _assertReentryBlocked(receiver);
    }

    function testRejectingTreasuryCannotBlockCreationAndKeepsItsCreditForRetry() public {
        treasury.configure(factory, true);
        _create(FEE);
        vm.expectRevert(RMTLaunchCurveFactoryV1.CreationFeePayoutFailed.selector);
        factory.claimCreationFees();
        assertEq(factory.creationFeesAccrued(), FEE);
        assertEq(address(factory).balance, FEE);
        assertEq(address(treasury).balance, 0);

        treasury.configure(factory, false);
        assertEq(factory.claimCreationFees(), FEE);
        assertEq(factory.creationFeesAccrued(), 0);
        assertEq(address(treasury).balance, FEE);
        _assertReentryBlocked(treasury);
    }

    function _create(uint256 value) private returns (address token, address curve) {
        vm.prank(creator);
        return factory.create{value: value}("Fee Token", "FEE", "", 0, address(0), 0, INTENT, block.timestamp);
    }

    function _predictedToken(address launchCreator) private view returns (address) {
        bytes32 salt = keccak256(abi.encode(launchCreator, INTENT));
        bytes32 initHash = keccak256(
            abi.encodePacked(type(RMTLaunchCurveTokenV1).creationCode, abi.encode("Fee Token", "FEE", 1_000_000 ether))
        );
        return vm.computeCreate2Address(salt, initHash, address(factory));
    }

    function _assertReentryBlocked(CreationFeeReceiver receiver) private view {
        assertEq(receiver.createReentry(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(receiver.claimReentry(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(receiver.prepareReentry(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(receiver.migrateReentry(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(factory.tokenForIntent(address(receiver), bytes32("nested")), address(0));
    }
}
