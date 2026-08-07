// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTSushiDeadlineGuard} from "../src/RMTSushiDeadlineGuard.sol";

interface SushiGuardVm {
    function chainId(uint256 chainId) external;
    function deal(address account, uint256 amount) external;
    function etch(address target, bytes calldata code) external;
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function warp(uint256 timestamp) external;
}

contract SushiGuardToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    bool public chargeTransferFee;
    address public reentryTarget;
    bytes public reentryData;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function setChargeTransferFee(bool value) external {
        chargeTransferFee = value;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool) {
        uint256 approved = allowance[owner][msg.sender];
        require(approved >= amount, "allowance");
        allowance[owner][msg.sender] = approved - amount;
        if (reentryTarget != address(0)) {
            address target = reentryTarget;
            bytes memory data = reentryData;
            reentryTarget = address(0);
            (bool success,) = target.call(data);
            require(!success, "reentry succeeded");
        }
        _transfer(owner, recipient, amount);
        return true;
    }

    function _transfer(address owner, address recipient, uint256 amount) private {
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += chargeTransferFee ? amount - 1 : amount;
    }
}

contract SushiGuardRouteExecutor {
    function route(bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract SushiGuardRedSnwapper {
    address private constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 public outputBps = 10_000;

    function setOutputBps(uint256 value) external {
        outputBps = value;
    }

    function snwap(
        IERC20 tokenIn,
        uint256 amountIn,
        address recipient,
        IERC20 tokenOut,
        uint256 amountOutMin,
        address executor,
        bytes calldata executorData
    ) external payable returns (uint256 amountOut) {
        require(executorData.length >= 4, "data");
        (bool routed,) = executor.call(executorData);
        require(routed, "route");

        if (address(tokenIn) == NATIVE) {
            require(msg.value == amountIn, "native input");
        } else {
            require(msg.value == 0, "token value");
            require(tokenIn.transferFrom(msg.sender, executor, amountIn), "input");
        }

        amountOut = amountIn * outputBps / 10_000;
        require(amountOut >= amountOutMin, "minimum");
        if (address(tokenOut) == NATIVE) {
            (bool sent,) = payable(recipient).call{value: amountOut}("");
            require(sent, "native output");
        } else {
            SushiGuardToken(address(tokenOut)).mint(recipient, amountOut);
        }
    }

    receive() external payable {}
}

contract RMTSushiDeadlineGuardTest {
    SushiGuardVm private constant vm = SushiGuardVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant WALLET = address(0xA11CE);
    bytes4 private constant ENTRYPOINT = SushiGuardRouteExecutor.route.selector;

    SushiGuardToken private token;
    SushiGuardRouteExecutor private routeExecutor;
    SushiGuardRedSnwapper private redSnwapper;
    RMTSushiDeadlineGuard private guard;

    function setUp() public {
        vm.chainId(4_663);
        vm.warp(1_000_000);
        vm.deal(WALLET, 1_000 ether);

        token = new SushiGuardToken();
        routeExecutor = new SushiGuardRouteExecutor();
        redSnwapper = new SushiGuardRedSnwapper();
        vm.deal(address(redSnwapper), 1_000 ether);
        guard = new RMTSushiDeadlineGuard(
            address(redSnwapper),
            address(routeExecutor),
            address(redSnwapper).codehash,
            address(routeExecutor).codehash,
            ENTRYPOINT
        );

        token.mint(WALLET, 1_000 ether);
        vm.prank(WALLET);
        token.approve(address(guard), 1_000 ether);
    }

    function testNativeBuySendsOutputDirectlyToCallingWallet() public {
        RMTSushiDeadlineGuard.Swap memory swap = _buy(10 ether, 9 ether, keccak256("native-buy"));
        uint256 ethBefore = WALLET.balance;

        vm.prank(WALLET);
        uint256 amountOut = guard.execute{value: 10 ether}(swap);

        require(amountOut == 10 ether, "output");
        require(WALLET.balance == ethBefore - 10 ether, "wallet native input");
        require(token.balanceOf(WALLET) == 1_010 ether, "wallet token output");
        require(address(guard).balance == 0, "guard retained native");
        require(token.balanceOf(address(guard)) == 0, "guard retained output");
        require(guard.orderConsumed(WALLET, swap.orderId), "order not consumed");
    }

    function testTokenSellClearsApprovalAndReturnsNativeDirectly() public {
        RMTSushiDeadlineGuard.Swap memory swap = _sell(100 ether, 99 ether, keccak256("token-sell"));
        uint256 ethBefore = WALLET.balance;

        vm.prank(WALLET);
        uint256 amountOut = guard.execute(swap);

        require(amountOut == 100 ether, "output");
        require(token.balanceOf(WALLET) == 900 ether, "wallet input");
        require(WALLET.balance == ethBefore + 100 ether, "wallet native output");
        require(token.balanceOf(address(guard)) == 0, "guard custody");
        require(token.allowance(address(guard), address(redSnwapper)) == 0, "approval retained");
    }

    function testRejectsExpiredAndLongDeadlines() public {
        RMTSushiDeadlineGuard.Swap memory expired = _buy(1 ether, 1, keccak256("expired"));
        expired.deadline = block.timestamp - 1;
        vm.expectRevert(RMTSushiDeadlineGuard.InvalidSwap.selector);
        vm.prank(WALLET);
        guard.execute{value: 1 ether}(expired);

        RMTSushiDeadlineGuard.Swap memory long = _buy(1 ether, 1, keccak256("long"));
        long.deadline = block.timestamp + 10 minutes + 1;
        vm.expectRevert(RMTSushiDeadlineGuard.InvalidSwap.selector);
        vm.prank(WALLET);
        guard.execute{value: 1 ether}(long);
    }

    function testRejectsWrongNativeValueAndEntrypoint() public {
        RMTSushiDeadlineGuard.Swap memory wrongValue = _buy(1 ether, 1, keccak256("value"));
        vm.expectRevert(RMTSushiDeadlineGuard.InvalidSwap.selector);
        vm.prank(WALLET);
        guard.execute{value: 2 ether}(wrongValue);

        RMTSushiDeadlineGuard.Swap memory wrongEntrypoint = _buy(1 ether, 1, keccak256("entrypoint"));
        wrongEntrypoint.executorData = hex"deadbeef00";
        vm.expectRevert(RMTSushiDeadlineGuard.InvalidSwap.selector);
        vm.prank(WALLET);
        guard.execute{value: 1 ether}(wrongEntrypoint);
    }

    function testRejectsSameAssetAndTokenToTokenSwaps() public {
        RMTSushiDeadlineGuard.Swap memory same = _buy(1 ether, 1, keccak256("same"));
        same.tokenOut = guard.NATIVE_TOKEN();
        vm.expectRevert(RMTSushiDeadlineGuard.InvalidSwap.selector);
        vm.prank(WALLET);
        guard.execute{value: 1 ether}(same);

        SushiGuardToken second = new SushiGuardToken();
        RMTSushiDeadlineGuard.Swap memory tokenToToken = _sell(1 ether, 1, keccak256("token-token"));
        tokenToToken.tokenOut = address(second);
        vm.expectRevert(RMTSushiDeadlineGuard.InvalidSwap.selector);
        vm.prank(WALLET);
        guard.execute(tokenToToken);
    }

    function testCannotReplayAnExecutedOrder() public {
        RMTSushiDeadlineGuard.Swap memory swap = _buy(1 ether, 1, keccak256("replay"));
        vm.prank(WALLET);
        guard.execute{value: 1 ether}(swap);

        vm.expectRevert(RMTSushiDeadlineGuard.OrderAlreadyConsumed.selector);
        vm.prank(WALLET);
        guard.execute{value: 1 ether}(swap);
    }

    function testFeeOnTransferInputRevertsWithoutLeavingCustody() public {
        token.setChargeTransferFee(true);
        RMTSushiDeadlineGuard.Swap memory swap = _sell(100 ether, 90 ether, keccak256("fee-token"));
        vm.expectRevert(RMTSushiDeadlineGuard.UnsupportedTransferBehavior.selector);
        vm.prank(WALLET);
        guard.execute(swap);

        require(token.balanceOf(WALLET) == 1_000 ether, "wallet balance changed");
        require(token.balanceOf(address(guard)) == 0, "guard retained token");
        require(!guard.orderConsumed(WALLET, swap.orderId), "reverted order consumed");
    }

    function testTokenCallbackCannotReenter() public {
        RMTSushiDeadlineGuard.Swap memory nested = _sell(1 ether, 1, keccak256("nested"));
        RMTSushiDeadlineGuard.Swap memory outer = _sell(10 ether, 9 ether, keccak256("outer"));
        token.setReentry(address(guard), abi.encodeCall(guard.execute, (nested)));

        vm.prank(WALLET);
        guard.execute(outer);

        require(token.balanceOf(WALLET) == 990 ether, "outer input");
        require(!guard.orderConsumed(address(token), nested.orderId), "nested consumed");
    }

    function testRouteFailureDoesNotConsumeOrderOrMoveFunds() public {
        redSnwapper.setOutputBps(9_000);
        RMTSushiDeadlineGuard.Swap memory swap = _sell(100 ether, 99 ether, keccak256("route-failure"));
        vm.prank(WALLET);
        (bool success,) = address(guard).call(abi.encodeCall(guard.execute, (swap)));

        require(!success, "unsafe route succeeded");
        require(token.balanceOf(WALLET) == 1_000 ether, "wallet token moved");
        require(token.balanceOf(address(guard)) == 0, "guard retained token");
        require(!guard.orderConsumed(WALLET, swap.orderId), "reverted order consumed");
    }

    function testConfigurationCodeDriftFailsClosed() public {
        vm.etch(address(routeExecutor), hex"00");
        RMTSushiDeadlineGuard.Swap memory swap = _buy(1 ether, 1, keccak256("code-drift"));
        vm.expectRevert(RMTSushiDeadlineGuard.ConfigurationIntegrityFailed.selector);
        vm.prank(WALLET);
        guard.execute{value: 1 ether}(swap);
    }

    function testConstructorRejectsWrongChainAndHashes() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(RMTSushiDeadlineGuard.WrongChain.selector, 1));
        new RMTSushiDeadlineGuard(
            address(redSnwapper),
            address(routeExecutor),
            address(redSnwapper).codehash,
            address(routeExecutor).codehash,
            ENTRYPOINT
        );

        vm.chainId(4_663);
        vm.expectRevert(RMTSushiDeadlineGuard.InvalidConfiguration.selector);
        new RMTSushiDeadlineGuard(
            address(redSnwapper),
            address(routeExecutor),
            bytes32(uint256(1)),
            address(routeExecutor).codehash,
            ENTRYPOINT
        );
    }

    function testRejectsUnsolicitedNativeCurrency() public {
        vm.prank(WALLET);
        (bool success,) = address(guard).call{value: 1 ether}("");
        require(!success, "native transfer accepted");
        require(address(guard).balance == 0, "native retained");
    }

    function _buy(uint256 amountIn, uint256 minimumOut, bytes32 orderId)
        private
        view
        returns (RMTSushiDeadlineGuard.Swap memory)
    {
        return RMTSushiDeadlineGuard.Swap({
            tokenIn: guard.NATIVE_TOKEN(),
            tokenOut: address(token),
            amountIn: amountIn,
            amountOutMinimum: minimumOut,
            deadline: block.timestamp + 90 seconds,
            orderId: orderId,
            executorData: abi.encodeWithSelector(ENTRYPOINT, bytes("route"))
        });
    }

    function _sell(uint256 amountIn, uint256 minimumOut, bytes32 orderId)
        private
        view
        returns (RMTSushiDeadlineGuard.Swap memory)
    {
        return RMTSushiDeadlineGuard.Swap({
            tokenIn: address(token),
            tokenOut: guard.NATIVE_TOKEN(),
            amountIn: amountIn,
            amountOutMinimum: minimumOut,
            deadline: block.timestamp + 90 seconds,
            orderId: orderId,
            executorData: abi.encodeWithSelector(ENTRYPOINT, bytes("route"))
        });
    }
}
