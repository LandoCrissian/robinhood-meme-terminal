// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

interface V4AdapterTestVm {
    function deal(address account, uint256 balance) external;
    function etch(address target, bytes calldata code) external;
}

contract TestableV4GraduationHook is V4GraduationHook {
    constructor(IPoolManager manager) V4GraduationHook(manager, msg.sender) {}

    function validateHookAddress(BaseHook) internal pure override {}
}

contract UnauthorizedAdapterCaller {
    function prepare(V4GraduationAdapter adapter, address token) external returns (bool success) {
        (success,) = address(adapter).call(abi.encodeCall(adapter.prepare, (token)));
    }

    function bindMarket(V4GraduationAdapter adapter, address token, address market) external returns (bool success) {
        (success,) = address(adapter).call(abi.encodeCall(adapter.bindMarket, (token, market)));
    }

    function graduate(V4GraduationAdapter adapter, address token, uint256 amount) external returns (bool success) {
        (success,) = address(adapter).call{value: 1 ether}(abi.encodeCall(adapter.graduate, (token, amount)));
    }

    function collect(V4GraduationAdapter adapter, address token)
        external
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        return adapter.collectFees(token);
    }

    receive() external payable {}
}

contract AdapterDustDonatingRecipient {
    address payable private immutable _adapter;

    constructor(address payable adapter_) {
        _adapter = adapter_;
    }

    receive() external payable {
        (bool success,) = _adapter.call{value: 1 wei}("");
        require(success, "dust donation failed");
    }
}

contract ReentrantFeeRecipient {
    V4GraduationAdapter private immutable _adapter;
    address private immutable _token;

    // Initialized nonzero so recording the callback result stays within the splitter's bounded payment gas.
    uint256 public callbackStatus = 1;

    constructor(V4GraduationAdapter adapter_, address token_) {
        _adapter = adapter_;
        _token = token_;
    }

    receive() external payable {
        (bool success,) = address(_adapter).call(abi.encodeCall(_adapter.collectFees, (_token)));
        callbackStatus = success ? 3 : 2;
    }
}

contract ExternalPoolDonor is IUnlockCallback {
    IPoolManager private immutable _manager;
    FixedSupplyMemeToken private immutable _token;

    constructor(IPoolManager manager_, FixedSupplyMemeToken token_) {
        _manager = manager_;
        _token = token_;
    }

    receive() external payable {}

    function attempt(PoolKey calldata key) external returns (bool success) {
        (success,) = address(_manager).call(abi.encodeCall(_manager.unlock, (abi.encode(key))));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(_manager), "only manager");
        PoolKey memory key = abi.decode(data, (PoolKey));
        _manager.donate(key, 1, 1, "");

        // If the hook ever stops rejecting donations, fully settle both deltas so attempt() succeeds and the
        // regression fails for the intended reason rather than merely failing from an unsettled balance.
        _manager.sync(Currency.wrap(address(0)));
        _manager.settle{value: 1}();
        _manager.sync(Currency.wrap(address(_token)));
        require(_token.transfer(address(_manager), 1), "token settlement failed");
        _manager.settle();
        return "";
    }
}

contract ExternalLiquidityRemover is IUnlockCallback {
    IPoolManager private immutable _manager;

    constructor(IPoolManager manager_) {
        _manager = manager_;
    }

    function attempt(PoolKey calldata key, int24 tickLower, int24 tickUpper, uint128 liquidity)
        external
        returns (bool success)
    {
        (success,) = address(_manager)
            .call(abi.encodeCall(_manager.unlock, (abi.encode(key, tickLower, tickUpper, liquidity))));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(_manager), "only manager");
        (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            abi.decode(data, (PoolKey, int24, int24, uint128));
        _manager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        return "";
    }
}

/// @dev Leaves PoolManager's transaction-scoped synced currency set to an ERC-20, then returns with no deltas.
///      This models a preceding unlock inside the same multicall or smart-wallet transaction.
contract PoolManagerSyncPoisoner is IUnlockCallback {
    IPoolManager private immutable _manager;

    constructor(IPoolManager manager_) {
        _manager = manager_;
    }

    function poison(Currency currency) external {
        _manager.unlock(abi.encode(currency));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(_manager), "only manager");
        _manager.sync(abi.decode(data, (Currency)));
        return "";
    }
}

contract V4GraduationAdapterTest {
    V4AdapterTestVm private constant vm = V4AdapterTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint160 private constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 11) | (1 << 7) | (1 << 5);

    PoolManager private manager;
    V4GraduationHook private hook;
    V4GraduationAdapter private adapter;
    FixedSupplyMemeToken private token;

    receive() external payable {}

    /// @dev Lets this contract, which is both adapter deployer and bound factory in the fixture, attempt the same
    ///      PoolManager position debit as an unprivileged caller. Position ownership must still isolate the adapter.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only manager");
        (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            abi.decode(data, (PoolKey, int24, int24, uint128));
        manager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        return "";
    }

    function setUp() public {
        vm.deal(address(this), 200 ether);
        manager = new PoolManager(address(this));

        TestableV4GraduationHook implementation = new TestableV4GraduationHook(IPoolManager(address(manager)));
        address flaggedHook = address(uint160(0x4444000000000000000000000000000000000000) | REQUIRED_HOOK_FLAGS);
        vm.etch(flaggedHook, address(implementation).code);
        hook = V4GraduationHook(flaggedHook);

        adapter = new V4GraduationAdapter(IPoolManager(address(manager)), hook, 5_000, 200);
        hook.bindAdapter(address(adapter));
        adapter.bindFactory(address(this));

        token =
            new FixedSupplyMemeToken("Graduation Test", "GRAD", 1_000_000_000 ether, address(this), address(this), "");
    }

    function testSeedsRealV4PoolAndOpensOnlyAfterExactSettlement() public {
        bytes32 poolId = adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));

        uint256 tokenAmount = 200_000_000 ether;
        uint256 nativeAmount = 85 ether;
        require(token.approve(address(adapter), tokenAmount), "approval failed");

        (address pool, uint256 liquidity) = adapter.graduate{value: nativeAmount}(address(token), tokenAmount);

        require(pool == address(manager), "wrong V4 pool manager");
        require(liquidity != 0, "zero liquidity");
        require(adapter.isGraduated(address(token)), "graduation not recorded");
        require(PoolId.unwrap(adapter.poolIds(address(token))) == poolId, "pool id changed");
        require(hook.isOpen(PoolId.wrap(poolId)), "pool not opened");
        require(address(adapter).balance == adapter.lockedNativeDust(address(token)), "native dust record");
        require(token.balanceOf(address(adapter)) == adapter.lockedTokenDust(address(token)), "token dust record");
        require(address(manager).balance + address(adapter).balance == nativeAmount, "native conservation");
        require(
            token.balanceOf(address(manager)) + token.balanceOf(address(adapter)) == tokenAmount, "token conservation"
        );
    }

    function testGraduationResetsAPreviouslySyncedErc20BeforeNativeSettlement() public {
        bytes32 poolId = adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));

        uint256 tokenAmount = 200_000_000 ether;
        uint256 nativeAmount = 85 ether;
        require(token.approve(address(adapter), tokenAmount), "approval failed");

        PoolManagerSyncPoisoner poisoner = new PoolManagerSyncPoisoner(IPoolManager(address(manager)));
        poisoner.poison(Currency.wrap(address(token)));

        (address pool, uint256 liquidity) = adapter.graduate{value: nativeAmount}(address(token), tokenAmount);

        require(pool == address(manager), "wrong V4 pool manager");
        require(liquidity != 0, "zero liquidity");
        require(adapter.isGraduated(address(token)), "graduation not recorded");
        require(PoolId.unwrap(adapter.poolIds(address(token))) == poolId, "pool id changed");
        require(hook.isOpen(PoolId.wrap(poolId)), "pool not opened");
    }

    function testFactoryAndMarketBindingsCannotBeBypassed() public {
        UnauthorizedAdapterCaller caller = new UnauthorizedAdapterCaller();
        vm.deal(address(caller), 2 ether);
        require(!caller.prepare(adapter, address(token)), "unauthorized preparation accepted");

        adapter.prepare(address(token));
        require(!caller.bindMarket(adapter, address(token), address(caller)), "unauthorized market binding accepted");
        adapter.bindMarket(address(token), address(this));

        require(token.approve(address(adapter), 1 ether), "approval failed");
        require(!caller.graduate(adapter, address(token), 1 ether), "unbound market graduated pool");
    }

    function testSeedSettlementDustIsPermanentlyLockedAndNotCollectibleAsFees() public {
        adapter.prepare(address(token));
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(this)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(adapter)
        );
        adapter.configureFeeRouting(address(token), address(splitter), 50);
        adapter.bindMarket(address(token), address(this));

        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);
        uint256 nativeDust = adapter.lockedNativeDust(address(token));
        uint256 tokenDust = adapter.lockedTokenDust(address(token));

        (uint256 nativeFees, uint256 tokenFees) = adapter.collectFees(address(token));
        require(nativeFees == 0 && tokenFees == 0, "seed dust became collectible fees");
        require(splitter.totalReceived() == 0, "seed native dust routed as fees");
        require(splitter.totalTokenReceived(address(token)) == 0, "seed token dust routed as fees");
        require(address(adapter).balance == nativeDust, "native dust moved");
        require(token.balanceOf(address(adapter)) == tokenDust, "token dust moved");
    }

    function testSequentialGraduationsCannotConsumeAnotherPoolsLockedDust() public {
        adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));
        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "first adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);
        uint256 firstNativeDust = adapter.lockedNativeDust(address(token));
        uint256 firstTokenDust = adapter.lockedTokenDust(address(token));

        FixedSupplyMemeToken secondToken = new FixedSupplyMemeToken(
            "Second Graduation", "GRAD2", 1_000_000_000 ether, address(this), address(this), ""
        );
        adapter.prepare(address(secondToken));
        adapter.bindMarket(address(secondToken), address(this));
        require(secondToken.approve(address(adapter), tokenAmount), "second adapter approval");
        adapter.graduate{value: 85 ether}(address(secondToken), tokenAmount);

        require(adapter.lockedNativeDust(address(token)) == firstNativeDust, "first native dust record changed");
        require(adapter.lockedTokenDust(address(token)) == firstTokenDust, "first token dust record changed");
        require(token.balanceOf(address(adapter)) == firstTokenDust, "first token dust consumed");
        require(
            address(adapter).balance == firstNativeDust + adapter.lockedNativeDust(address(secondToken)),
            "second pool consumed first native dust"
        );
        require(
            secondToken.balanceOf(address(adapter)) == adapter.lockedTokenDust(address(secondToken)),
            "second token dust record"
        );
    }

    function testFactoryAndMarketBindingsArePermanent() public {
        UnauthorizedAdapterCaller caller = new UnauthorizedAdapterCaller();
        (bool reboundFactory,) = address(adapter).call(abi.encodeCall(adapter.bindFactory, (address(caller))));
        require(!reboundFactory, "factory rebound");

        adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));
        (bool reboundMarket,) =
            address(adapter).call(abi.encodeCall(adapter.bindMarket, (address(token), address(caller))));
        require(!reboundMarket, "market rebound");
    }

    function testFactoryBindingRejectsAnAddressWithoutCode() public {
        V4GraduationAdapter unbound = new V4GraduationAdapter(IPoolManager(address(manager)), hook, 5_000, 200);
        (bool eoaBinding,) = address(unbound).call(abi.encodeCall(unbound.bindFactory, (address(0xBEEF))));
        require(!eoaBinding, "EOA factory binding accepted");
        require(unbound.factory() == address(0), "failed binding changed factory");

        unbound.bindFactory(address(this));
        require(unbound.factory() == address(this), "contract factory binding failed");
    }

    function testV6FeeRoutingMustMatchImmutablePoolFeeAndCannotBeChanged() public {
        adapter.prepare(address(token));
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(this)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(adapter)
        );

        DirectLaunchFeeSplitter wrongAdapterSplitter = new DirectLaunchFeeSplitter();
        wrongAdapterSplitter.initialize(
            payable(address(this)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(this)
        );
        (bool wrongAdapterSuccess,) = address(adapter)
            .call(abi.encodeCall(adapter.configureFeeRouting, (address(token), address(wrongAdapterSplitter), 50)));
        require(!wrongAdapterSuccess, "mismatched splitter adapter accepted");

        (bool mismatchSuccess,) =
            address(adapter).call(abi.encodeCall(adapter.configureFeeRouting, (address(token), address(splitter), 100)));
        require(!mismatchSuccess, "mismatched fee policy accepted");

        adapter.configureFeeRouting(address(token), address(splitter), 50);
        require(adapter.feeSplitters(address(token)) == address(splitter), "splitter not bound");
        require(adapter.postGraduationFeeBps(address(token)) == 50, "fee bps not recorded");

        (bool reconfigureSuccess,) =
            address(adapter).call(abi.encodeCall(adapter.configureFeeRouting, (address(token), address(splitter), 50)));
        require(!reconfigureSuccess, "fee routing changed");
    }

    function testV6FeeRoutingRequiresThePermanentlyBoundMarketSource() public {
        adapter.prepare(address(token));
        UnauthorizedAdapterCaller authorizedMarket = new UnauthorizedAdapterCaller();
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(this)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(authorizedMarket),
            address(adapter)
        );
        adapter.configureFeeRouting(address(token), address(splitter), 50);

        (bool wrongMarketSuccess,) =
            address(adapter).call(abi.encodeCall(adapter.bindMarket, (address(token), address(this))));
        require(!wrongMarketSuccess, "mismatched splitter market accepted");
        adapter.bindMarket(address(token), address(authorizedMarket));
        require(adapter.markets(address(token)) == address(authorizedMarket), "authorized market not bound");
    }

    function testV6FeeRoutingCannotBeConfiguredAfterMarketBinding() public {
        adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(this)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(adapter)
        );

        (bool success,) =
            address(adapter).call(abi.encodeCall(adapter.configureFeeRouting, (address(token), address(splitter), 50)));
        require(!success, "late fee routing accepted");
    }

    function testCannotGraduateTwice() public {
        adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));
        uint256 tokenAmount = 1_000_000 ether;
        require(token.approve(address(adapter), tokenAmount * 2), "approval failed");
        adapter.graduate{value: 1 ether}(address(token), tokenAmount);

        (bool secondGraduation,) =
            address(adapter).call{value: 1 ether}(abi.encodeCall(adapter.graduate, (address(token), tokenAmount)));
        require(!secondGraduation, "second graduation accepted");
    }

    function testCollectsBothFeeCurrenciesWithoutChangingLockedLiquidity() public {
        bytes32 poolIdValue = adapter.prepare(address(token));
        AdapterDustDonatingRecipient creator = new AdapterDustDonatingRecipient(payable(address(adapter)));
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(adapter)
        );
        adapter.configureFeeRouting(address(token), address(splitter), 50);
        adapter.bindMarket(address(token), address(this));

        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: adapter.poolFee(),
            tickSpacing: adapter.tickSpacing(),
            hooks: IHooks(address(hook))
        });
        int24 tickLower = TickMath.minUsableTick(adapter.tickSpacing());
        int24 tickUpper = TickMath.maxUsableTick(adapter.tickSpacing());
        (uint128 liquidityBefore,,) = StateLibrary.getPositionInfo(
            IPoolManager(address(manager)), PoolId.wrap(poolIdValue), address(adapter), tickLower, tickUpper, bytes32(0)
        );

        PoolSwapTest swapRouter = new PoolSwapTest(IPoolManager(address(manager)));
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        uint256 tokenBalanceBeforeSwap = token.balanceOf(address(this));
        swapRouter.swap{value: 1 ether}(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );

        uint256 receivedTokens = token.balanceOf(address(this)) - tokenBalanceBeforeSwap;
        uint256 tokenSwapAmount = receivedTokens / 2;
        require(tokenSwapAmount != 0, "no token swap input");
        require(token.approve(address(swapRouter), tokenSwapAmount), "router approval");
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(tokenSwapAmount),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );

        uint256 lockedNativeDust = adapter.lockedNativeDust(address(token));
        uint256 lockedTokenDust = adapter.lockedTokenDust(address(token));
        UnauthorizedAdapterCaller collector = new UnauthorizedAdapterCaller();
        (uint256 nativeFees, uint256 tokenFees) = collector.collect(adapter, address(token));
        (uint128 liquidityAfter,,) = StateLibrary.getPositionInfo(
            IPoolManager(address(manager)), PoolId.wrap(poolIdValue), address(adapter), tickLower, tickUpper, bytes32(0)
        );

        require(nativeFees != 0, "native fees not collected");
        require(tokenFees != 0, "token fees not collected");
        uint256 exactNativeFee = 0.005 ether;
        require(nativeFees <= exactNativeFee && exactNativeFee - nativeFees <= 1, "pool did not charge 0.5%");
        require(splitter.totalReceived() == nativeFees, "native fees not routed");
        require(splitter.totalTokenReceived(address(token)) == tokenFees, "token fees not routed");
        require(address(collector).balance == 0, "collector redirected native fees");
        require(token.balanceOf(address(collector)) == 0, "collector redirected token fees");
        require(liquidityAfter == liquidityBefore, "liquidity principal changed");
        require(liquidityAfter == adapter.lockedLiquidity(address(token)), "locked liquidity record mismatch");
        require(address(adapter).balance == lockedNativeDust + 1 wei, "recipient dust donation not tolerated");
        require(token.balanceOf(address(adapter)) == lockedTokenDust, "locked token dust changed");
    }

    function testCollectionUsesCreatorRecipientActiveAtCollectionTimeForBothFeeCurrencies() public {
        bytes32 poolIdValue = adapter.prepare(address(token));
        address payable originalCreator = payable(address(0xCAFE));
        address payable treasury = payable(address(0xBEEF));
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            originalCreator, treasury, address(token), 7_000, address(this), address(this), address(adapter)
        );
        adapter.configureFeeRouting(address(token), address(splitter), 50);
        adapter.bindMarket(address(token), address(this));

        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);
        PoolKey memory key = _poolKey();
        uint128 liquidityBefore = adapter.lockedLiquidity(address(token));

        _accrueBothFeeCurrencies(key);
        uint256 creatorNativeBefore = originalCreator.balance;
        uint256 treasuryNativeBefore = treasury.balance;
        uint256 creatorTokenBefore = token.balanceOf(originalCreator);
        uint256 treasuryTokenBefore = token.balanceOf(treasury);
        (uint256 firstNativeFees, uint256 firstTokenFees) = adapter.collectFees(address(token));
        require(firstNativeFees != 0 && firstTokenFees != 0, "first fees missing");

        uint256 expectedCreatorNative = firstNativeFees * 7_000 / 10_000;
        uint256 expectedCreatorToken = firstTokenFees * 7_000 / 10_000;
        require(originalCreator.balance - creatorNativeBefore == expectedCreatorNative, "first native creator split");
        require(
            treasury.balance - treasuryNativeBefore == firstNativeFees - expectedCreatorNative,
            "first native treasury split"
        );
        require(
            token.balanceOf(originalCreator) - creatorTokenBefore == expectedCreatorToken, "first token creator split"
        );
        require(
            token.balanceOf(treasury) - treasuryTokenBefore == firstTokenFees - expectedCreatorToken,
            "first token treasury split"
        );

        _accrueBothFeeCurrencies(key);
        splitter.setCreatorWallet(treasury, keccak256("redirect future creator fees"), 0);
        creatorNativeBefore = originalCreator.balance;
        treasuryNativeBefore = treasury.balance;
        creatorTokenBefore = token.balanceOf(originalCreator);
        treasuryTokenBefore = token.balanceOf(treasury);
        (uint256 redirectedNativeFees, uint256 redirectedTokenFees) = adapter.collectFees(address(token));
        require(redirectedNativeFees != 0 && redirectedTokenFees != 0, "redirected fees missing");

        require(originalCreator.balance == creatorNativeBefore, "old creator received later native fees");
        require(token.balanceOf(originalCreator) == creatorTokenBefore, "old creator received later token fees");
        require(treasury.balance - treasuryNativeBefore == redirectedNativeFees, "redirected native total");
        require(token.balanceOf(treasury) - treasuryTokenBefore == redirectedTokenFees, "redirected token total");
        require(adapter.lockedLiquidity(address(token)) == liquidityBefore, "locked liquidity record changed");
        _requireAdapterLiquidity(poolIdValue, liquidityBefore);
    }

    function testDirectPoolManagerDonationToCanonicalPoolIsRejected() public {
        bytes32 poolIdValue = adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));
        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);

        uint128 liquidityBefore = adapter.lockedLiquidity(address(token));
        ExternalPoolDonor donor = new ExternalPoolDonor(IPoolManager(address(manager)), token);
        vm.deal(address(donor), 1);
        require(token.transfer(address(donor), 1), "donor token funding failed");
        require(!donor.attempt(_poolKey()), "direct pool donation succeeded");
        _requireAdapterLiquidity(poolIdValue, liquidityBefore);
    }

    function testUnsolicitedNativeAndTokenPreloadsSurviveGraduationAndFeeCollection() public {
        bytes32 poolIdValue = adapter.prepare(address(token));
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(this)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(adapter)
        );
        adapter.configureFeeRouting(address(token), address(splitter), 50);
        adapter.bindMarket(address(token), address(this));

        uint256 nativePreload = 123_456 wei;
        uint256 tokenPreload = 654_321 wei;
        (bool nativePreloaded,) = payable(address(adapter)).call{value: nativePreload}("");
        require(nativePreloaded, "native preload failed");
        require(token.transfer(address(adapter), tokenPreload), "token preload failed");

        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);
        uint256 expectedNativeBalance = nativePreload + adapter.lockedNativeDust(address(token));
        uint256 expectedTokenBalance = tokenPreload + adapter.lockedTokenDust(address(token));
        require(address(adapter).balance == expectedNativeBalance, "graduation spent native preload");
        require(token.balanceOf(address(adapter)) == expectedTokenBalance, "graduation spent token preload");
        require(splitter.totalReceived() == 0, "native preload accounted as fee");
        require(splitter.totalTokenReceived(address(token)) == 0, "token preload accounted as fee");

        _accrueBothFeeCurrencies(_poolKey());
        uint128 liquidityBefore = adapter.lockedLiquidity(address(token));
        (uint256 nativeFees, uint256 tokenFees) = adapter.collectFees(address(token));
        require(nativeFees != 0 && tokenFees != 0, "fees missing");
        require(splitter.totalReceived() == nativeFees, "native preload included in fees");
        require(splitter.totalTokenReceived(address(token)) == tokenFees, "token preload included in fees");
        require(address(adapter).balance == expectedNativeBalance, "collection spent native preload");
        require(token.balanceOf(address(adapter)) == expectedTokenBalance, "collection spent token preload");
        _requireAdapterLiquidity(poolIdValue, liquidityBefore);
    }

    function testRecipientCallbackCannotReenterCollectionOrAlterPrincipal() public {
        bytes32 poolIdValue = adapter.prepare(address(token));
        ReentrantFeeRecipient creator = new ReentrantFeeRecipient(adapter, address(token));
        DirectLaunchFeeSplitter splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(address(creator)),
            payable(address(0xBEEF)),
            address(token),
            7_000,
            address(this),
            address(this),
            address(adapter)
        );
        adapter.configureFeeRouting(address(token), address(splitter), 50);
        adapter.bindMarket(address(token), address(this));

        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);
        _accrueBothFeeCurrencies(_poolKey());
        uint128 liquidityBefore = adapter.lockedLiquidity(address(token));

        (uint256 nativeFees, uint256 tokenFees) = adapter.collectFees(address(token));
        require(nativeFees != 0 && tokenFees != 0, "fees missing");
        require(creator.callbackStatus() == 2, "reentrant collection did not fail");
        require(splitter.totalReceived() == nativeFees, "native fees double accounted");
        require(splitter.totalTokenReceived(address(token)) == tokenFees, "token fees double accounted");
        (uint256 secondNativeFees, uint256 secondTokenFees) = adapter.collectFees(address(token));
        require(secondNativeFees == 0 && secondTokenFees == 0, "fees double collected");
        require(adapter.lockedLiquidity(address(token)) == liquidityBefore, "locked liquidity record changed");
        _requireAdapterLiquidity(poolIdValue, liquidityBefore);
    }

    function testFactoryOperatorAndExternalCallerCannotRemoveAdapterLiquidity() public {
        bytes32 poolIdValue = adapter.prepare(address(token));
        adapter.bindMarket(address(token), address(this));
        uint256 tokenAmount = 200_000_000 ether;
        require(token.approve(address(adapter), tokenAmount), "adapter approval");
        adapter.graduate{value: 85 ether}(address(token), tokenAmount);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: adapter.poolFee(),
            tickSpacing: adapter.tickSpacing(),
            hooks: IHooks(address(hook))
        });
        int24 tickLower = TickMath.minUsableTick(adapter.tickSpacing());
        int24 tickUpper = TickMath.maxUsableTick(adapter.tickSpacing());
        uint128 liquidityBefore = adapter.lockedLiquidity(address(token));
        ExternalLiquidityRemover remover = new ExternalLiquidityRemover(IPoolManager(address(manager)));

        (bool factoryRemoval,) = address(manager)
            .call(abi.encodeCall(manager.unlock, (abi.encode(key, tickLower, tickUpper, liquidityBefore))));
        require(!factoryRemoval, "factory operator removed principal");
        require(!remover.attempt(key, tickLower, tickUpper, liquidityBefore), "external principal removal succeeded");
        (uint128 liquidityAfter,,) = StateLibrary.getPositionInfo(
            IPoolManager(address(manager)), PoolId.wrap(poolIdValue), address(adapter), tickLower, tickUpper, bytes32(0)
        );
        require(liquidityAfter == liquidityBefore, "adapter principal changed");
    }

    function testBondingCurveMigratesEndToEndIntoRealV4Pool() public {
        bytes32 poolId = adapter.prepare(address(token));
        BondingCurveMarket market = new BondingCurveMarket(
            address(token),
            payable(address(this)),
            address(adapter),
            poolId,
            100,
            30 ether,
            1_073_000_000 ether,
            1 ether
        );
        adapter.bindMarket(address(token), address(market));
        require(token.transfer(address(market), token.totalSupply()), "inventory transfer failed");

        (uint256 tokensOut,) = market.quoteBuy(2 ether);
        market.buy{value: 2 ether}(address(this), tokensOut, block.timestamp);
        require(market.graduated(), "curve did not graduate");

        (address pool, uint256 liquidity) = market.migrateLiquidity();
        require(pool == address(manager), "wrong V4 manager");
        require(liquidity != 0, "zero migrated liquidity");
        require(market.liquidityMigrated(), "market migration not recorded");
        require(market.realEthReserve() == 0, "market retained reserve");
        require(token.balanceOf(address(market)) == 0, "market retained inventory");
        require(address(market).balance == 0, "market retained native currency");
        require(hook.isOpen(PoolId.wrap(poolId)), "migrated pool not open");
    }

    function _poolKey() private view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: adapter.poolFee(),
            tickSpacing: adapter.tickSpacing(),
            hooks: IHooks(address(hook))
        });
    }

    function _accrueBothFeeCurrencies(PoolKey memory key) private {
        PoolSwapTest swapRouter = new PoolSwapTest(IPoolManager(address(manager)));
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        uint256 tokenBalanceBeforeSwap = token.balanceOf(address(this));
        swapRouter.swap{value: 1 ether}(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );

        uint256 receivedTokens = token.balanceOf(address(this)) - tokenBalanceBeforeSwap;
        uint256 tokenSwapAmount = receivedTokens / 2;
        require(tokenSwapAmount != 0, "no token swap input");
        require(token.approve(address(swapRouter), tokenSwapAmount), "router approval");
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(tokenSwapAmount),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function _requireAdapterLiquidity(bytes32 poolIdValue, uint128 expectedLiquidity) private view {
        int24 tickLower = TickMath.minUsableTick(adapter.tickSpacing());
        int24 tickUpper = TickMath.maxUsableTick(adapter.tickSpacing());
        (uint128 liquidityAfter,,) = StateLibrary.getPositionInfo(
            IPoolManager(address(manager)), PoolId.wrap(poolIdValue), address(adapter), tickLower, tickUpper, bytes32(0)
        );
        require(liquidityAfter == expectedLiquidity, "adapter principal changed");
    }
}
