// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV4FeeExecutorV2} from "../src/RMTUniswapV4FeeExecutorV2.sol";
import {FeeExecutorToken, RejectNativeTreasury} from "./RMTUniswapV3FeeExecutorV1.t.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract MockV4PoolManagerV2 {
    using CurrencyLibrary for Currency;

    uint256 public outputBps = 10_000;
    bool public swapReverts;
    bool public lieAboutInput;
    bool public callbackAgain;
    uint256 public swapCalls;
    Currency public syncedCurrency;

    receive() external payable {}

    function setBehavior(uint256 outputBps_, bool swapReverts_, bool lieAboutInput_, bool callbackAgain_) external {
        outputBps = outputBps_;
        swapReverts = swapReverts_;
        lieAboutInput = lieAboutInput_;
        callbackAgain = callbackAgain_;
    }

    function unlock(bytes calldata data) external returns (bytes memory result) {
        result = IUnlockCallback(msg.sender).unlockCallback(data);
        if (callbackAgain) IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta delta)
    {
        require(!swapReverts, "swap revert");
        require(hookData.length == 0, "nonempty hook data");
        require(params.amountSpecified < 0, "not exact input");
        swapCalls += 1;
        uint256 inputAmount = uint256(-params.amountSpecified);
        uint256 reportedInput = lieAboutInput ? inputAmount - 1 : inputAmount;
        uint256 outputAmount = inputAmount * outputBps / 10_000;
        require(outputAmount <= uint256(uint128(type(int128).max)), "output overflow");
        if (params.zeroForOne) {
            delta = toBalanceDelta(-int128(int256(reportedInput)), int128(int256(outputAmount)));
        } else {
            delta = toBalanceDelta(int128(int256(outputAmount)), -int128(int256(reportedInput)));
        }
        key;
    }

    function sync(Currency currency) external {
        syncedCurrency = currency;
    }

    function settle() external payable returns (uint256 paid) {
        paid = msg.value;
    }

    function take(Currency currency, address to, uint256 amount) external {
        if (currency.isAddressZero()) {
            (bool success,) = payable(to).call{value: amount}("");
            require(success, "native take");
        } else {
            require(FeeExecutorToken(Currency.unwrap(currency)).transfer(to, amount), "token take");
        }
    }

    function attackCallback(address executor, bytes calldata data) external {
        IUnlockCallback(executor).unlockCallback(data);
    }
}

contract RMTUniswapV4FeeExecutorV2Test is Test {
    using PoolIdLibrary for PoolKey;

    address private constant TRADER = address(0xA11CE);
    address private constant RECIPIENT = address(0xB0B);
    address private constant TREASURY = address(0xBEEF);
    address private constant HOOK = address(0xE5E7);
    bytes32 private constant POLICY_ID_HASH = keccak256("RMT_EXECUTION_V2");
    bytes32 private constant POLICY_HASH = keccak256("test-only-rmt-execution-v2-policy");

    FeeExecutorToken private tokenA;
    FeeExecutorToken private tokenB;
    MockV4PoolManagerV2 private manager;
    RMTUniswapV4FeeExecutorV2 private executor;

    function setUp() public {
        vm.chainId(4_663);
        vm.roll(100);
        vm.warp(1_000_000);
        tokenA = new FeeExecutorToken();
        tokenB = new FeeExecutorToken();
        manager = new MockV4PoolManagerV2();
        executor = _deploy(TREASURY);
        tokenA.mint(TRADER, 2_000_000);
        tokenB.mint(TRADER, 2_000_000);
        tokenA.mint(address(manager), 10_000_000);
        tokenB.mint(address(manager), 10_000_000);
        vm.deal(TRADER, 10 ether);
        vm.deal(address(manager), 10 ether);
    }

    function testNativeBuySettlesAtomicInputFeeAndNoDust() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(0), address(tokenA), 40_000, keccak256("native-buy"));
        uint256 treasuryBefore = TREASURY.balance;
        vm.prank(TRADER);
        (uint256 output, uint256 fee) = executor.execute{value: 40_000}(auth, key);

        assertEq(output, 39_900);
        assertEq(fee, 100);
        assertEq(tokenA.balanceOf(RECIPIENT), 39_900);
        assertEq(TREASURY.balance - treasuryBefore, 100);
        _assertNoDust();
    }

    function testErc20SellToNativeSettlesExactRecipientAndNoDust() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(tokenA), address(0), 40_000, keccak256("native-sell"));
        vm.prank(TRADER);
        tokenA.approve(address(executor), 40_000);
        uint256 recipientBefore = RECIPIENT.balance;
        vm.prank(TRADER);
        executor.execute(auth, key);

        assertEq(RECIPIENT.balance - recipientBefore, 39_900);
        assertEq(tokenA.balanceOf(TREASURY), 100);
        assertEq(tokenA.allowance(TRADER, address(executor)), 0);
        _assertNoDust();
    }

    function testErc20ToErc20UsesTheExactPoolKeyDirection() public {
        PoolKey memory key = _erc20Key(address(tokenA), address(tokenB));
        address inputAsset = Currency.unwrap(key.currency1);
        address outputAsset = Currency.unwrap(key.currency0);
        FeeExecutorToken(inputAsset).mint(TRADER, 40_000);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, inputAsset, outputAsset, 40_000, keccak256("erc20-pair"));
        vm.prank(TRADER);
        FeeExecutorToken(inputAsset).approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(auth, key);

        assertEq(FeeExecutorToken(outputAsset).balanceOf(RECIPIENT), 39_900);
        assertEq(FeeExecutorToken(inputAsset).balanceOf(TREASURY), 100);
        _assertNoDust();
    }

    function testPreexistingErc20AndNativeBalancesDoNotBlockErc20ToNative() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        uint256 preexistingToken = 777;
        uint256 preexistingNative = 1_234;
        tokenA.mint(address(executor), preexistingToken);
        vm.deal(address(executor), preexistingNative);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(tokenA), address(0), 40_000, keccak256("preexisting-native-sell"));

        vm.prank(TRADER);
        tokenA.approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(auth, key);

        assertEq(tokenA.balanceOf(address(executor)), preexistingToken, "preexisting input changed");
        assertEq(address(executor).balance, preexistingNative, "preexisting native changed");
        assertEq(tokenA.allowance(TRADER, address(executor)), 0);
    }

    function testPreexistingErc20BalancesDoNotBlockErc20ToErc20() public {
        PoolKey memory key = _erc20Key(address(tokenA), address(tokenB));
        address inputAsset = Currency.unwrap(key.currency1);
        address outputAsset = Currency.unwrap(key.currency0);
        uint256 preexistingInput = 777;
        uint256 preexistingOutput = 888;
        uint256 preexistingNative = 1_234;
        FeeExecutorToken(inputAsset).mint(address(executor), preexistingInput);
        FeeExecutorToken(outputAsset).mint(address(executor), preexistingOutput);
        vm.deal(address(executor), preexistingNative);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, inputAsset, outputAsset, 40_000, keccak256("preexisting-erc20-pair"));

        vm.prank(TRADER);
        FeeExecutorToken(inputAsset).approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(auth, key);

        assertEq(FeeExecutorToken(inputAsset).balanceOf(address(executor)), preexistingInput, "input baseline changed");
        assertEq(
            FeeExecutorToken(outputAsset).balanceOf(address(executor)), preexistingOutput, "output baseline changed"
        );
        assertEq(address(executor).balance, preexistingNative, "unrelated native changed");
    }

    function testRevertingExecutionPreservesPreexistingBalancesAtomically() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        uint256 preexistingToken = 777;
        uint256 preexistingNative = 1_234;
        tokenA.mint(address(executor), preexistingToken);
        vm.deal(address(executor), preexistingNative);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(tokenA), address(0), 40_000, keccak256("preexisting-failed-sell"));
        uint256 traderBefore = tokenA.balanceOf(TRADER);
        uint256 recipientBefore = RECIPIENT.balance;
        uint256 treasuryBefore = tokenA.balanceOf(TREASURY);
        manager.setBehavior(10_000, true, false, false);

        vm.prank(TRADER);
        tokenA.approve(address(executor), 40_000);
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute(auth, key);

        assertEq(tokenA.balanceOf(address(executor)), preexistingToken, "failed input baseline changed");
        assertEq(address(executor).balance, preexistingNative, "failed native baseline changed");
        assertEq(tokenA.balanceOf(TRADER), traderBefore, "failed execution debited trader");
        assertEq(RECIPIENT.balance, recipientBefore, "failed execution paid recipient");
        assertEq(tokenA.balanceOf(TREASURY), treasuryBefore, "failed execution paid fee");
        assertEq(tokenA.allowance(TRADER, address(executor)), 40_000, "failed execution consumed allowance");
        assertFalse(executor.executionConsumed(auth.executionId));
    }

    function testFeeFloorRoundingMatchesV2Economics() public view {
        assertEq(executor.calculateFee(1), 0);
        assertEq(executor.calculateFee(399), 0);
        assertEq(executor.calculateFee(400), 1);
        assertEq(executor.calculateFee(10_000), 25);
    }

    function testPoolKeyAndPoolIdMutationsRevert() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(0), address(tokenA), 40_000, keccak256("pool-mutations"));
        auth.poolId = keccak256("wrong-pool");
        _expectNativeRevert(auth, key);

        auth = _authorization(key, address(0), address(tokenA), 40_000, keccak256("currency1"));
        PoolKey memory changed = key;
        changed.currency1 = Currency.wrap(address(tokenB));
        _expectNativeRevert(auth, changed);

        changed = key;
        changed.fee = 500;
        _expectNativeRevert(auth, changed);
        changed = key;
        changed.tickSpacing = 10;
        _expectNativeRevert(auth, changed);
        changed = key;
        changed.hooks = IHooks(address(0xCAFE));
        _expectNativeRevert(auth, changed);
    }

    function testAuthorizationTamperingReverts() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory base =
            _authorization(key, address(0), address(tokenA), 40_000, keccak256("authorization"));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory changed = base;
        changed.recipient = address(0xBAD);
        _expectNativeRevert(changed, key);
        changed = base;
        changed.userGrossInput += 1;
        _expectNativeRevert(changed, key);
        changed = base;
        changed.providerInput -= 1;
        _expectNativeRevert(changed, key);
        changed = base;
        changed.protectedOutput = changed.expectedProviderOutput + 1;
        _expectNativeRevert(changed, key);
        changed = base;
        changed.deadline = block.timestamp - 1;
        _expectNativeRevert(changed, key);
        changed = base;
        changed.deadline = block.timestamp + 5 minutes + 1;
        _expectNativeRevert(changed, key);
        changed = base;
        changed.treasury = address(0xBAD);
        _expectNativeRevert(changed, key);
        changed = base;
        changed.hookDataHash = keccak256("nonempty");
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.InvalidAuthorization.selector);
        vm.prank(TRADER);
        executor.execute{value: 40_000}(changed, key);
    }

    function testWrongValueAllowanceBalanceAndTransferBehaviorRevert() public {
        PoolKey memory nativeKey = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory nativeAuth =
            _authorization(nativeKey, address(0), address(tokenA), 40_000, keccak256("wrong-value"));
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute{value: 39_999}(nativeAuth, nativeKey);

        PoolKey memory tokenKey = _erc20Key(address(tokenA), address(tokenB));
        address inputAsset = Currency.unwrap(tokenKey.currency0);
        address outputAsset = Currency.unwrap(tokenKey.currency1);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory tokenAuth =
            _authorization(tokenKey, inputAsset, outputAsset, 40_000, keccak256("allowance"));
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(tokenAuth, tokenKey);
        vm.prank(TRADER);
        FeeExecutorToken(inputAsset).approve(address(executor), 40_001);
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(tokenAuth, tokenKey);

        FeeExecutorToken(inputAsset).setFeeOnTransfer(true);
        tokenAuth.executionId = keccak256("fee-on-transfer");
        tokenAuth.requestIdentity = executor.deriveRequestIdentity(tokenAuth, tokenKey);
        vm.prank(TRADER);
        FeeExecutorToken(inputAsset).approve(address(executor), 40_000);
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.UnsupportedTransferBehavior.selector);
        vm.prank(TRADER);
        executor.execute(tokenAuth, tokenKey);
    }

    function testSwapMinimumAndFeeSettlementFailuresAreAtomic() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(0), address(tokenA), 40_000, keccak256("swap-failure"));
        manager.setBehavior(10_000, true, false, false);
        _expectNativeRevert(auth, key);
        assertEq(TREASURY.balance, 0);
        assertFalse(executor.executionConsumed(auth.executionId));

        manager.setBehavior(9_000, false, false, false);
        auth.executionId = keccak256("minimum-failure");
        _expectNativeRevert(auth, key);
        assertEq(TREASURY.balance, 0);

        RejectNativeTreasury rejectTreasury = new RejectNativeTreasury();
        RMTUniswapV4FeeExecutorV2 rejecting = _deploy(address(rejectTreasury));
        manager.setBehavior(10_000, false, false, false);
        auth = _authorizationFor(rejecting, key, address(0), address(tokenA), 40_000, keccak256("fee-failure"));
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.NativeTransferFailed.selector);
        vm.prank(TRADER);
        rejecting.execute{value: 40_000}(auth, key);
        assertEq(tokenA.balanceOf(RECIPIENT), 0);
    }

    function testReentrancyAndCallbackAbuseAreRejected() public {
        PoolKey memory key = _erc20Key(address(tokenA), address(tokenB));
        address inputAsset = Currency.unwrap(key.currency0);
        address outputAsset = Currency.unwrap(key.currency1);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory nested =
            _authorization(key, inputAsset, outputAsset, 400, keccak256("nested"));
        FeeExecutorToken(inputAsset).setReentry(address(executor), abi.encodeCall(executor.execute, (nested, key)));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory outer =
            _authorization(key, inputAsset, outputAsset, 40_000, keccak256("outer"));
        vm.prank(TRADER);
        FeeExecutorToken(inputAsset).approve(address(executor), 40_000);
        vm.prank(TRADER);
        executor.execute(outer, key);
        assertFalse(executor.executionConsumed(nested.executionId));

        vm.expectRevert(RMTUniswapV4FeeExecutorV2.InvalidCallback.selector);
        manager.attackCallback(address(executor), abi.encode(bytes32("abuse")));

        manager.setBehavior(10_000, false, false, true);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory callbackAgain =
            _authorization(key, inputAsset, outputAsset, 40_000, keccak256("callback-again"));
        FeeExecutorToken(inputAsset).mint(TRADER, 40_000);
        vm.prank(TRADER);
        FeeExecutorToken(inputAsset).approve(address(executor), 40_000);
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.InvalidCallback.selector);
        vm.prank(TRADER);
        executor.execute(callbackAgain, key);
    }

    function testNoAdminTargetCalldataTreasuryOrRescueSurface() public {
        bytes[8] memory calls = [
            abi.encodeWithSignature("owner()"),
            abi.encodeWithSignature("setPoolManager(address)", address(0xBAD)),
            abi.encodeWithSignature("setTreasury(address)", address(0xBAD)),
            abi.encodeWithSignature("upgradeTo(address)", address(0xBAD)),
            abi.encodeWithSignature("rescue(address)", address(tokenA)),
            abi.encodeWithSignature("execute(address,bytes)", address(manager), hex"00"),
            abi.encodeWithSignature("delegateExecute(address,bytes)", address(manager), hex"00"),
            abi.encodeWithSignature("setHookData(bytes)", hex"01")
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool success,) = address(executor).call(calls[i]);
            assertFalse(success, "prohibited capability exists");
        }
        assertEq(address(executor.poolManager()), address(manager));
        assertEq(executor.treasury(), TREASURY);
    }

    function testRuntimePolicyReplayAndAbnormalDeltaFailClosed() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(0), address(tokenA), 40_000, keccak256("replay"));
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, key);
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.ExecutionAlreadyConsumed.selector);
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, key);

        manager.setBehavior(10_000, false, true, false);
        auth.executionId = keccak256("delta-lie");
        _expectNativeRevert(auth, key);
        assertEq(TREASURY.balance, 100);

        bytes memory code = address(manager).code;
        vm.etch(address(manager), hex"00");
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.RuntimeIdentityChanged.selector);
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, key);
        vm.etch(address(manager), code);
    }

    function testChainAndPolicyBoundariesFailClosed() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(0), address(tokenA), 40_000, keccak256("chain"));
        vm.chainId(1);
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.RuntimeIdentityChanged.selector);
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, key);
        vm.chainId(4_663);

        RMTUniswapV4FeeExecutorV2 future = new RMTUniswapV4FeeExecutorV2(
            address(manager), address(manager).codehash, TREASURY, POLICY_ID_HASH, 2, POLICY_HASH, 25, 101, 0
        );
        auth = _authorizationFor(future, key, address(0), address(tokenA), 40_000, keccak256("future"));
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.PolicyInactive.selector);
        vm.prank(TRADER);
        future.execute{value: 40_000}(auth, key);

        vm.expectRevert(RMTUniswapV4FeeExecutorV2.InvalidPolicy.selector);
        new RMTUniswapV4FeeExecutorV2(
            address(manager), address(manager).codehash, TREASURY, POLICY_ID_HASH, 2, POLICY_HASH, 26, 1, 0
        );
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.InvalidConfiguration.selector);
        new RMTUniswapV4FeeExecutorV2(
            address(manager), address(manager).codehash, address(manager), POLICY_ID_HASH, 2, POLICY_HASH, 25, 1, 0
        );

        vm.expectRevert(RMTUniswapV4FeeExecutorV2.InvalidPolicy.selector);
        new RMTUniswapV4FeeExecutorV2(
            address(manager), address(manager).codehash, TREASURY, POLICY_ID_HASH, 2, POLICY_HASH, 25, 0, 0
        );

        vm.chainId(1);
        vm.expectRevert(RMTUniswapV4FeeExecutorV2.InvalidConfiguration.selector);
        new RMTUniswapV4FeeExecutorV2(
            address(manager), address(manager).codehash, TREASURY, POLICY_ID_HASH, 2, POLICY_HASH, 25, 1, 0
        );
        vm.chainId(4_663);
    }

    function testExactSettlementEvent() public {
        PoolKey memory key = _nativeKey(address(tokenA));
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth =
            _authorization(key, address(0), address(tokenA), 40_000, keccak256("event"));
        vm.expectEmit(true, true, true, true);
        emit RMTUniswapV4FeeExecutorV2.RMTUniswapV4FeeSettledV2(
            auth.executionId,
            POLICY_HASH,
            TRADER,
            POLICY_ID_HASH,
            2,
            executor.PROVIDER_ID(),
            address(manager),
            auth.poolId,
            RECIPIENT,
            address(0),
            address(tokenA),
            address(0),
            25,
            RMTUniswapV4FeeExecutorV2.FeeSide.INPUT,
            40_000,
            39_900,
            39_900,
            100,
            TREASURY
        );
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, key);
    }

    function _deploy(address treasury_) private returns (RMTUniswapV4FeeExecutorV2) {
        return new RMTUniswapV4FeeExecutorV2(
            address(manager), address(manager).codehash, treasury_, POLICY_ID_HASH, 2, POLICY_HASH, 25, 1, 0
        );
    }

    function _nativeKey(address token) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: 0,
            tickSpacing: 200,
            hooks: IHooks(HOOK)
        });
    }

    function _erc20Key(address left, address right) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(left < right ? left : right),
            currency1: Currency.wrap(left < right ? right : left),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0))
        });
    }

    function _authorization(
        PoolKey memory key,
        address inputAsset,
        address outputAsset,
        uint256 gross,
        bytes32 executionId
    ) private view returns (RMTUniswapV4FeeExecutorV2.FeeAuthorization memory) {
        return _authorizationFor(executor, key, inputAsset, outputAsset, gross, executionId);
    }

    function _authorizationFor(
        RMTUniswapV4FeeExecutorV2 target,
        PoolKey memory key,
        address inputAsset,
        address outputAsset,
        uint256 gross,
        bytes32 executionId
    ) private view returns (RMTUniswapV4FeeExecutorV2.FeeAuthorization memory) {
        uint256 fee = gross * 25 / 10_000;
        uint256 providerInput = gross - fee;
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory authorization = RMTUniswapV4FeeExecutorV2.FeeAuthorization({
            executionId: executionId,
            policyIdHash: POLICY_ID_HASH,
            policyVersion: 2,
            policyHash: POLICY_HASH,
            feeBps: 25,
            feeSide: RMTUniswapV4FeeExecutorV2.FeeSide.INPUT,
            feeAsset: inputAsset,
            treasury: target.treasury(),
            trader: TRADER,
            recipient: RECIPIENT,
            requestedInputAsset: inputAsset,
            requestedOutputAsset: outputAsset,
            userGrossInput: gross,
            expectedFeeAtomic: fee,
            maximumFeeAtomic: fee,
            providerInput: providerInput,
            expectedProviderOutput: providerInput,
            protectedOutput: providerInput * 97 / 100,
            deadline: block.timestamp + 4 minutes,
            poolId: PoolId.unwrap(key.toId()),
            hookDataHash: keccak256(""),
            requestIdentity: bytes32(0)
        });
        authorization.requestIdentity = target.deriveRequestIdentity(authorization, key);
        return authorization;
    }

    function _expectNativeRevert(RMTUniswapV4FeeExecutorV2.FeeAuthorization memory auth, PoolKey memory key) private {
        vm.expectRevert();
        vm.prank(TRADER);
        executor.execute{value: 40_000}(auth, key);
    }

    function _assertNoDust() private view {
        assertEq(address(executor).balance, 0, "native retained");
        assertEq(tokenA.balanceOf(address(executor)), 0, "token A retained");
        assertEq(tokenB.balanceOf(address(executor)), 0, "token B retained");
    }
}
