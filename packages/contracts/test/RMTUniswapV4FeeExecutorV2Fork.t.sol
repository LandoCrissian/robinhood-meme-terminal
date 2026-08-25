// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RMTUniswapV4FeeExecutorV2} from "../src/RMTUniswapV4FeeExecutorV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IV4FeeExecutorQuoterProbe {
    struct QuoteExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut, uint256 gasEstimate);
}

/// @notice Mandatory read-only Terminal execution proof. Forge simulates locally; no transaction is broadcast.
contract RMTUniswapV4FeeExecutorV2ForkTest is Test {
    using PoolIdLibrary for PoolKey;

    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    IV4FeeExecutorQuoterProbe private constant QUOTER =
        IV4FeeExecutorQuoterProbe(0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94);
    bytes32 private constant POOL_MANAGER_RUNTIME_HASH =
        0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    bytes32 private constant QUOTER_RUNTIME_HASH = 0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6;
    address private constant CONTROL_TOKEN = 0x1139d423C1706BDeaD91f03507F521635591eD92;
    address private constant CONTROL_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    bytes32 private constant CONTROL_POOL_ID = 0x5f5ec0e1016bae2f04c122bbcd2c141a4177cc681d7c2e4463a1d172ed8430b3;
    address private constant TREASURY = address(0xBEEF);
    bytes32 private constant POLICY_HASH = keccak256("fork-only-rmt-execution-v2-policy");

    PoolKey private controlKey;
    RMTUniswapV4FeeExecutorV2 private executor;

    receive() external payable {}

    function setUp() public {
        vm.skip(!vm.envOr("RMT_RUN_TERMINAL_V4_FORK", false), "run through the mandatory Terminal V4 fork check");
        string memory rpcUrl = vm.envString("ROBINHOOD_MAINNET_RPC_URL");
        vm.createSelectFork(rpcUrl);
        assertEq(block.chainid, 4_663, "wrong fork chain");
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_RUNTIME_HASH, "official PoolManager runtime changed");
        assertEq(address(QUOTER).codehash, QUOTER_RUNTIME_HASH, "official V4 Quoter runtime changed");

        controlKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(CONTROL_TOKEN),
            fee: 0,
            tickSpacing: 200,
            hooks: IHooks(CONTROL_HOOK)
        });
        assertEq(PoolId.unwrap(controlKey.toId()), CONTROL_POOL_ID, "canonical CannaCat PoolId changed");
        executor = new RMTUniswapV4FeeExecutorV2(
            POOL_MANAGER, POOL_MANAGER.codehash, TREASURY, keccak256("RMT_EXECUTION_V2"), 2, POLICY_HASH, 25, 1, 0
        );
    }

    function testCanonicalCannaCatNativeBuyOnFork() public {
        uint256 grossNative = 0.001 ether;
        uint256 quotedToken = _quoteProviderOutput(grossNative, true);
        uint256 tokenBefore = IERC20(CONTROL_TOKEN).balanceOf(address(this));
        uint256 nativeTreasuryBefore = TREASURY.balance;
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory buy = _authorization(
            executor, controlKey, address(0), CONTROL_TOKEN, grossNative, quotedToken, keccak256("fork-native-buy")
        );
        executor.execute{value: grossNative}(buy, controlKey);
        uint256 bought = IERC20(CONTROL_TOKEN).balanceOf(address(this)) - tokenBefore;
        assertGe(bought, buy.protectedOutput);
        assertEq(TREASURY.balance - nativeTreasuryBefore, executor.calculateFee(grossNative));
        assertEq(address(executor).balance, 0);
    }

    function testCanonicalCannaCatNativeSellOnFork() public {
        uint256 bought = _buyControlToken(0.001 ether);
        uint256 grossToken = bought / 2;
        uint256 tokenFee = executor.calculateFee(grossToken);
        uint256 quotedNative = _quoteProviderOutput(grossToken, false);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory sell = _authorization(
            executor, controlKey, CONTROL_TOKEN, address(0), grossToken, quotedNative, keccak256("fork-token-sell")
        );
        uint256 tokenTreasuryBefore = IERC20(CONTROL_TOKEN).balanceOf(TREASURY);
        IERC20(CONTROL_TOKEN).approve(address(executor), grossToken);
        uint256 nativeBefore = address(this).balance;
        executor.execute(sell, controlKey);
        assertGe(address(this).balance - nativeBefore, sell.protectedOutput);
        assertEq(IERC20(CONTROL_TOKEN).balanceOf(TREASURY) - tokenTreasuryBefore, tokenFee);
        assertEq(IERC20(CONTROL_TOKEN).balanceOf(address(executor)), 0);
        assertEq(IERC20(CONTROL_TOKEN).allowance(address(this), address(executor)), 0);
    }

    function _buyControlToken(uint256 grossNative) private returns (uint256 bought) {
        uint256 quotedToken = _quoteProviderOutput(grossNative, true);
        RMTUniswapV4FeeExecutorV2.FeeAuthorization memory buy = _authorization(
            executor,
            controlKey,
            address(0),
            CONTROL_TOKEN,
            grossNative,
            quotedToken,
            keccak256("fork-sell-funding-buy")
        );
        uint256 tokenBefore = IERC20(CONTROL_TOKEN).balanceOf(address(this));
        executor.execute{value: grossNative}(buy, controlKey);
        bought = IERC20(CONTROL_TOKEN).balanceOf(address(this)) - tokenBefore;
        assertGe(bought, buy.protectedOutput);
    }

    function _quoteProviderOutput(uint256 grossInput, bool zeroForOne) private returns (uint256) {
        uint256 providerInput = grossInput - executor.calculateFee(grossInput);
        return _quote(controlKey, zeroForOne, uint128(providerInput));
    }

    function _quote(PoolKey memory key, bool zeroForOne, uint128 amountIn) private returns (uint256 amountOut) {
        (amountOut,) = QUOTER.quoteExactInputSingle(
            IV4FeeExecutorQuoterProbe.QuoteExactInputSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: amountIn, hookData: bytes("")
            })
        );
        require(amountOut != 0 && amountOut <= type(uint128).max, "invalid V4 quote");
    }

    function _authorization(
        RMTUniswapV4FeeExecutorV2 targetExecutor,
        PoolKey memory key,
        address inputAsset,
        address outputAsset,
        uint256 gross,
        uint256 expectedOutput,
        bytes32 executionId
    ) private view returns (RMTUniswapV4FeeExecutorV2.FeeAuthorization memory authorization) {
        uint256 fee = targetExecutor.calculateFee(gross);
        authorization = RMTUniswapV4FeeExecutorV2.FeeAuthorization({
            executionId: executionId,
            policyIdHash: keccak256("RMT_EXECUTION_V2"),
            policyVersion: 2,
            policyHash: POLICY_HASH,
            feeBps: 25,
            feeSide: RMTUniswapV4FeeExecutorV2.FeeSide.INPUT,
            feeAsset: inputAsset,
            treasury: TREASURY,
            trader: address(this),
            recipient: address(this),
            requestedInputAsset: inputAsset,
            requestedOutputAsset: outputAsset,
            userGrossInput: gross,
            expectedFeeAtomic: fee,
            maximumFeeAtomic: fee,
            providerInput: gross - fee,
            expectedProviderOutput: expectedOutput,
            protectedOutput: expectedOutput * 99 / 100,
            deadline: block.timestamp + 4 minutes,
            poolId: PoolId.unwrap(key.toId()),
            hookDataHash: keccak256(""),
            requestIdentity: bytes32(0)
        });
        authorization.requestIdentity = targetExecutor.deriveRequestIdentity(authorization, key);
    }
}
