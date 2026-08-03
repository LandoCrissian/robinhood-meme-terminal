// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {RMTLaunchFactoryV6} from "../src/RMTLaunchFactoryV6.sol";
import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";
import {V4GraduationAdapter} from "../src/V4GraduationAdapter.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IUniversalRouterForkVm {
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function deal(address account, uint256 balance) external;
    function prank(address caller) external;
    function roll(uint256 newHeight) external;
    function warp(uint256 newTimestamp) external;
}

interface IERC20RouterProbe {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IUniversalRouterProbe {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2RouterProbe {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IV4QuoterProbe {
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

/// @notice Proves RMT's production Universal Router command shape against a newly graduated V6 pool on a
///         Robinhood Chain mainnet fork. No transaction is ever broadcast to mainnet.
contract V6UniversalRouterForkTest {
    IUniversalRouterForkVm private constant vm =
        IUniversalRouterForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    RMTLaunchFactoryV6 private constant FACTORY = RMTLaunchFactoryV6(0x8E75C57079a01ce2094bc4187B78710887547651);
    IUniversalRouterProbe private constant ROUTER = IUniversalRouterProbe(0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99);
    IV4QuoterProbe private constant QUOTER = IV4QuoterProbe(0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94);
    IPermit2RouterProbe private constant PERMIT2 = IPermit2RouterProbe(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address private constant ROUTER_AS_RECIPIENT = address(2);

    receive() external payable {}

    function testCanonicalGraduatedPoolBuysAndSellsThroughOfficialUniversalRouter() public {
        string memory rpcUrl = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        vm.deal(address(this), 100 ether);

        require(address(FACTORY).code.length != 0, "V6 factory missing");
        require(address(ROUTER).code.length != 0, "official router missing");
        require(address(QUOTER).code.length != 0, "official quoter missing");
        require(address(PERMIT2).code.length != 0, "Permit2 missing");

        RMTLaunchGate gate = RMTLaunchGate(address(FACTORY.launchGate()));
        if (gate.launchesPaused()) {
            vm.prank(gate.governance());
            uint64 executableAt = gate.scheduleUnpause();
            vm.warp(executableAt);
            vm.prank(gate.guardian());
            gate.executeUnpause();
        }
        require(!gate.launchesPaused(), "fork launch gate remained paused");

        (address tokenAddress, address marketAddress,) = FACTORY.launchSimple(
            "RMT Router Fork Probe",
            "RMTRF7",
            "data:application/json,%7B%22name%22%3A%22RMT%20Router%20Fork%20Probe%22%7D"
        );
        CloneBondingCurveMarketV6 curve = CloneBondingCurveMarketV6(payable(marketAddress));
        vm.roll(curve.fairStartEndsAtBlock());
        (uint256 tokensOut,,,) = curve.quoteBuyExecution(2.1 ether);
        curve.buy{value: 2.1 ether}(address(this), tokensOut, block.timestamp + 10 minutes);
        require(curve.graduated(), "fork launch did not graduate");
        curve.migrateLiquidity();

        V4GraduationAdapter adapter = V4GraduationAdapter(payable(address(curve.graduationAdapter())));
        require(adapter.isGraduated(tokenAddress), "canonical pool did not open");
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(tokenAddress),
            fee: adapter.poolFee(),
            tickSpacing: adapter.tickSpacing(),
            hooks: IHooks(address(adapter.hook()))
        });

        IERC20RouterProbe token = IERC20RouterProbe(tokenAddress);
        uint128 nativeAmountIn = uint128(0.01 ether);
        uint256 quotedTokenOut = _quote(key, true, nativeAmountIn);
        uint256 minimumTokenOut = (quotedTokenOut * 99) / 100;
        uint256 tokenBalanceBefore = token.balanceOf(address(this));
        _executeExactInput(key, true, nativeAmountIn, minimumTokenOut);
        uint256 boughtTokens = token.balanceOf(address(this)) - tokenBalanceBefore;
        require(boughtTokens >= minimumTokenOut, "official router buy missed minimum");

        uint128 tokenAmountIn = uint128(boughtTokens / 2);
        require(token.approve(address(PERMIT2), tokenAmountIn), "Permit2 token approval failed");
        PERMIT2.approve(tokenAddress, address(ROUTER), tokenAmountIn, uint48(block.timestamp + 20 minutes));
        uint256 quotedNativeOut = _quote(key, false, tokenAmountIn);
        uint256 minimumNativeOut = (quotedNativeOut * 99) / 100;
        uint256 nativeBalanceBefore = address(this).balance;
        _executeExactInput(key, false, tokenAmountIn, minimumNativeOut);
        require(address(this).balance - nativeBalanceBefore >= minimumNativeOut, "official router sell missed minimum");
    }

    function _quote(PoolKey memory key, bool zeroForOne, uint128 amountIn) private returns (uint256 amountOut) {
        (amountOut,) = QUOTER.quoteExactInputSingle(
            IV4QuoterProbe.QuoteExactInputSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: amountIn, hookData: bytes("")
            })
        );
        require(amountOut != 0 && amountOut <= type(uint128).max, "invalid official quote");
    }

    function _executeExactInput(PoolKey memory key, bool zeroForOne, uint128 amountIn, uint256 minimumOut) private {
        address inputCurrency = zeroForOne ? address(0) : Currency.unwrap(key.currency1);
        address outputCurrency = zeroForOne ? Currency.unwrap(key.currency1) : address(0);
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(key, zeroForOne, amountIn, uint128(minimumOut), uint256(0), bytes(""));
        actionParams[1] = abi.encode(inputCurrency, uint256(amountIn), false);
        actionParams[2] = abi.encode(outputCurrency, ROUTER_AS_RECIPIENT, uint256(0));
        bytes memory v4Swap = abi.encode(hex"060b0e", actionParams);
        uint256 deadline = block.timestamp + 10 minutes;

        if (zeroForOne) {
            bytes[] memory inputs = new bytes[](3);
            inputs[0] = v4Swap;
            inputs[1] = abi.encode(outputCurrency, address(this), minimumOut);
            inputs[2] = abi.encode(address(0), address(this), uint256(0));
            ROUTER.execute{value: amountIn}(hex"100404", inputs, deadline);
        } else {
            bytes[] memory inputs = new bytes[](4);
            inputs[0] = abi.encode(inputCurrency, ROUTER_AS_RECIPIENT, uint160(amountIn));
            inputs[1] = v4Swap;
            inputs[2] = abi.encode(outputCurrency, address(this), minimumOut);
            inputs[3] = abi.encode(address(0), address(this), uint256(0));
            ROUTER.execute(hex"02100404", inputs, deadline);
        }
    }
}
