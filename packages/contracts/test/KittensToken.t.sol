// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {KittensToken} from "../src/KittensToken.sol";

contract KittensSpender {
    function pull(KittensToken token, address from, address to, uint256 amount) external returns (bool) {
        return token.transferFrom(from, to, amount);
    }
}

contract KittensTokenTest {
    function testSupplyIsFixedAndFullyAssignedAtConstruction() public {
        KittensToken token = new KittensToken(address(this));
        require(token.INITIAL_SUPPLY() == 1_000_000_000 ether, "wrong initial supply");
        require(token.totalSupply() == token.INITIAL_SUPPLY(), "wrong total supply");
        require(token.balanceOf(address(this)) == token.INITIAL_SUPPLY(), "initial recipient not fully funded");
    }

    function testTransfersAndAllowancesAreStandardAndUntaxed() public {
        KittensToken token = new KittensToken(address(this));
        KittensSpender spender = new KittensSpender();
        address recipient = address(0xBEEF);

        require(token.transfer(recipient, 100 ether), "transfer failed");
        require(token.balanceOf(recipient) == 100 ether, "recipient taxed");
        require(token.balanceOf(address(this)) == token.INITIAL_SUPPLY() - 100 ether, "sender balance mismatch");

        require(token.approve(address(spender), 25 ether), "approval failed");
        require(spender.pull(token, address(this), recipient, 25 ether), "transferFrom failed");
        require(token.allowance(address(this), address(spender)) == 0, "allowance not consumed");
        require(token.balanceOf(recipient) == 125 ether, "transferFrom taxed");
    }

    function testBurnCanOnlyDestroyCallerBalanceAndReducesSupply() public {
        KittensToken token = new KittensToken(address(this));
        uint256 supplyBefore = token.totalSupply();
        token.burn(10 ether);
        require(token.totalSupply() == supplyBefore - 10 ether, "supply not burned");
        require(token.balanceOf(address(this)) == supplyBefore - 10 ether, "caller balance not burned");

        (bool arbitraryBurn,) = address(token).call(abi.encodeWithSignature("burnFrom(address,uint256)", address(0xBEEF), 1));
        require(!arbitraryBurn, "unexpected privileged burn surface");
    }

    function testZeroAddressCannotReceiveSupplyOrTransfers() public {
        bool constructorRejected;
        try new KittensToken(address(0)) returns (KittensToken) {
            constructorRejected = false;
        } catch {
            constructorRejected = true;
        }
        require(constructorRejected, "zero initial recipient accepted");

        KittensToken token = new KittensToken(address(this));
        (bool zeroTransfer,) = address(token).call(abi.encodeCall(token.transfer, (address(0), 1)));
        require(!zeroTransfer, "zero transfer accepted");
    }
}
