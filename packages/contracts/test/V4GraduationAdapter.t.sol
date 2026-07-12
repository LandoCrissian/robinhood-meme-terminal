// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {V4GraduationHook} from "../src/V4GraduationHook.sol";
import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

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

    receive() external payable {}
}

contract V4GraduationAdapterTest {
    V4AdapterTestVm private constant vm = V4AdapterTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint160 private constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 11) | (1 << 7);

    PoolManager private manager;
    V4GraduationHook private hook;
    V4GraduationAdapter private adapter;
    FixedSupplyMemeToken private token;

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 100 ether);
        manager = new PoolManager(address(this));

        TestableV4GraduationHook implementation = new TestableV4GraduationHook(IPoolManager(address(manager)));
        address flaggedHook = address(uint160(0x4444000000000000000000000000000000000000) | REQUIRED_HOOK_FLAGS);
        vm.etch(flaggedHook, address(implementation).code);
        hook = V4GraduationHook(flaggedHook);

        adapter = new V4GraduationAdapter(IPoolManager(address(manager)), hook, 10_000, 200);
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
        require(address(adapter).balance == 0, "adapter retained native currency");
        require(token.balanceOf(address(adapter)) == 0, "adapter retained tokens");
        require(address(manager).balance == nativeAmount, "manager native settlement mismatch");
        require(token.balanceOf(address(manager)) == tokenAmount, "manager token settlement mismatch");
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
}
