// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {KittensFeeVault} from "../src/KittensFeeVault.sol";

interface KittensVaultVm {
    function deal(address account, uint256 balance) external;
    function prank(address caller) external;
}

contract KittensNativeRecipient {
    receive() external payable {}
}

contract KittensVaultHookSource {
    function credit(KittensFeeVault vault, uint256 amount) external {
        vault.creditFee(amount);
    }
}

contract KittensVaultExecutor {
    receive() external payable {}

    function withdrawBurn(KittensFeeVault vault, uint256 maxAmount) external returns (uint256) {
        return vault.withdrawBurnBudget(maxAmount);
    }

    function withdrawLiquidity(KittensFeeVault vault, uint256 maxAmount) external returns (uint256) {
        return vault.withdrawLiquidityBudget(maxAmount);
    }
}

contract KittensFeeVaultTest {
    KittensVaultVm private constant vm =
        KittensVaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _configuredVault()
        private
        returns (
            KittensFeeVault vault,
            KittensVaultHookSource hook,
            KittensVaultExecutor burnExecutor,
            KittensVaultExecutor liquidityExecutor,
            KittensNativeRecipient paymaster,
            KittensNativeRecipient operations
        )
    {
        paymaster = new KittensNativeRecipient();
        operations = new KittensNativeRecipient();
        vault = new KittensFeeVault(payable(address(paymaster)), payable(address(operations)));
        hook = new KittensVaultHookSource();
        burnExecutor = new KittensVaultExecutor();
        liquidityExecutor = new KittensVaultExecutor();
        vault.bindHook(address(hook));
        vault.bindBurnExecutor(payable(address(burnExecutor)));
        vault.bindLiquidityExecutor(payable(address(liquidityExecutor)));
        vault.finalizeBindings();
    }

    function testOnePercentFeeValueSplitsIntoExactEconomicLanes() public {
        (
            KittensFeeVault vault,
            KittensVaultHookSource hook,
            ,
            ,
            ,
        ) = _configuredVault();
        vm.deal(address(vault), 1 ether);
        hook.credit(vault, 1 ether);

        require(vault.burnReserve() == 0.7 ether, "burn lane");
        require(vault.paymasterReserve() == 0.1 ether, "paymaster lane");
        require(vault.liquidityReserve() == 0.1 ether, "liquidity lane");
        require(vault.operationsReserve() == 0.1 ether, "operations lane");
        require(vault.totalOutstanding() == 1 ether, "lane conservation");
        require(vault.totalCredited() == 1 ether, "credit total");
    }

    function testRoundingDustNeverEscapesAccounting() public {
        (
            KittensFeeVault vault,
            KittensVaultHookSource hook,
            ,
            ,
            ,
        ) = _configuredVault();
        vm.deal(address(vault), 7 wei);
        hook.credit(vault, 7 wei);
        require(vault.burnReserve() == 7 wei, "dust not assigned to burn lane");
        require(vault.totalOutstanding() == 7 wei, "dust conservation");
    }

    function testOnlyBoundHookCanCreditAndBackingMustExist() public {
        (
            KittensFeeVault vault,
            KittensVaultHookSource hook,
            ,
            ,
            ,
        ) = _configuredVault();

        (bool unauthorized,) = address(vault).call(abi.encodeCall(vault.creditFee, (1 ether)));
        require(!unauthorized, "unauthorized credit accepted");

        (bool unbacked,) = address(hook).call(abi.encodeCall(hook.credit, (vault, 1 ether)));
        require(!unbacked, "unbacked accounting accepted");

        vm.deal(address(vault), 1 ether);
        hook.credit(vault, 1 ether);
        require(vault.totalCredited() == 1 ether, "backed credit rejected");
    }

    function testBurnAndLiquidityBudgetsOnlyReachBoundExecutors() public {
        (
            KittensFeeVault vault,
            KittensVaultHookSource hook,
            KittensVaultExecutor burnExecutor,
            KittensVaultExecutor liquidityExecutor,
            ,
        ) = _configuredVault();
        vm.deal(address(vault), 1 ether);
        hook.credit(vault, 1 ether);

        (bool unauthorizedBurn,) = address(vault).call(abi.encodeCall(vault.withdrawBurnBudget, (1 ether)));
        require(!unauthorizedBurn, "burn budget exposed");
        (bool unauthorizedLiquidity,) = address(vault).call(abi.encodeCall(vault.withdrawLiquidityBudget, (1 ether)));
        require(!unauthorizedLiquidity, "liquidity budget exposed");

        uint256 burnedBudget = burnExecutor.withdrawBurn(vault, type(uint256).max);
        uint256 liquidityBudget = liquidityExecutor.withdrawLiquidity(vault, type(uint256).max);
        require(burnedBudget == 0.7 ether, "burn withdrawal");
        require(liquidityBudget == 0.1 ether, "liquidity withdrawal");
        require(address(burnExecutor).balance == 0.7 ether, "burn executor not funded");
        require(address(liquidityExecutor).balance == 0.1 ether, "liquidity executor not funded");
    }

    function testPaymasterAndOperationsReleasesArePermissionlessButRecipientsAreImmutable() public {
        (
            KittensFeeVault vault,
            KittensVaultHookSource hook,
            ,
            ,
            KittensNativeRecipient paymaster,
            KittensNativeRecipient operations
        ) = _configuredVault();
        vm.deal(address(vault), 1 ether);
        hook.credit(vault, 1 ether);

        address relayer = address(0xBEEF);
        vm.prank(relayer);
        uint256 paymasterAmount = vault.releasePaymaster(type(uint256).max);
        vm.prank(relayer);
        uint256 operationsAmount = vault.releaseOperations(type(uint256).max);

        require(paymasterAmount == 0.1 ether, "paymaster release");
        require(operationsAmount == 0.1 ether, "operations release");
        require(address(paymaster).balance == 0.1 ether, "wrong paymaster recipient");
        require(address(operations).balance == 0.1 ether, "wrong operations recipient");
    }

    function testBindingsAreOneTimeAndFinalizationIsIrreversible() public {
        KittensNativeRecipient paymaster = new KittensNativeRecipient();
        KittensNativeRecipient operations = new KittensNativeRecipient();
        KittensFeeVault vault = new KittensFeeVault(payable(address(paymaster)), payable(address(operations)));
        KittensVaultHookSource hook = new KittensVaultHookSource();
        KittensVaultExecutor burnExecutor = new KittensVaultExecutor();
        KittensVaultExecutor liquidityExecutor = new KittensVaultExecutor();

        vault.bindHook(address(hook));
        (bool reboundHook,) = address(vault).call(abi.encodeCall(vault.bindHook, (address(hook))));
        require(!reboundHook, "hook rebound");

        (bool prematureFinalize,) = address(vault).call(abi.encodeCall(vault.finalizeBindings, ()));
        require(!prematureFinalize, "incomplete topology finalized");

        vault.bindBurnExecutor(payable(address(burnExecutor)));
        vault.bindLiquidityExecutor(payable(address(liquidityExecutor)));
        vault.finalizeBindings();

        (bool secondFinalize,) = address(vault).call(abi.encodeCall(vault.finalizeBindings, ()));
        require(!secondFinalize, "topology finalized twice");
        require(vault.bindingsFinalized(), "topology not frozen");
    }

    function testForcedOrAccidentalNativeBalanceIsNotInventedAsProtocolFees() public {
        (
            KittensFeeVault vault,
            KittensVaultHookSource hook,
            ,
            ,
            ,
        ) = _configuredVault();
        vm.deal(address(vault), 2 ether);
        require(vault.unaccountedBalance() == 2 ether, "forced balance accounted");
        hook.credit(vault, 1 ether);
        require(vault.totalCredited() == 1 ether, "credit mismatch");
        require(vault.unaccountedBalance() == 1 ether, "forced balance consumed");
    }
}
