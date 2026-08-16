// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {RMTRetirementSinkV1} from "../src/RMTRetirementSinkV1.sol";
import {DistributionERC20Mock} from "./mocks/RMTDistributionEngineV1Mocks.sol";

contract RMTRetirementSinkV1Test is Test {
    RMTRetirementSinkV1 private sink;
    DistributionERC20Mock private token;

    function setUp() external {
        sink = new RMTRetirementSinkV1();
        token = new DistributionERC20Mock();
        token.mint(address(this), 100 ether);
    }

    function testSinkAcceptsERC20WithoutExposingWithdrawal() external {
        assertTrue(token.transfer(address(sink), 25 ether));
        assertEq(token.balanceOf(address(sink)), 25 ether);

        (bool ownerSuccess,) = address(sink).call(abi.encodeWithSignature("owner()"));
        (bool withdrawSuccess,) =
            address(sink).call(abi.encodeWithSignature("withdraw(address,uint256)", token, 25 ether));
        (bool sweepSuccess,) =
            address(sink).call(abi.encodeWithSignature("sweep(address,address)", token, address(this)));
        (bool arbitraryCallSuccess,) = address(sink)
            .call(
                abi.encodeWithSignature(
                    "execute(address,bytes)",
                    token,
                    abi.encodeWithSignature("transfer(address,uint256)", address(this), 25 ether)
                )
            );

        assertFalse(ownerSuccess);
        assertFalse(withdrawSuccess);
        assertFalse(sweepSuccess);
        assertFalse(arbitraryCallSuccess);
        assertEq(token.balanceOf(address(sink)), 25 ether);
    }

    function testSinkRejectsNativeValueAndUnknownCalldata() external {
        vm.deal(address(this), 1 ether);
        (bool valueSuccess,) = address(sink).call{value: 1 wei}("");
        (bool calldataSuccess,) = address(sink).call(hex"12345678");
        assertFalse(valueSuccess);
        assertFalse(calldataSuccess);
        assertEq(address(sink).balance, 0);
    }
}
