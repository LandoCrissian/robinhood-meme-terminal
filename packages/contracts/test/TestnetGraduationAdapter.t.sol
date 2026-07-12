// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestnetGraduationAdapter} from "../src/TestnetGraduationAdapter.sol";

contract AdapterCaller {
    function prepare(TestnetGraduationAdapter adapter, address token) external returns (bytes32) {
        return adapter.prepare(token);
    }

    function bindMarket(TestnetGraduationAdapter adapter, address token, address market) external {
        adapter.bindMarket(token, market);
    }
}

contract TestnetGraduationAdapterTest {
    function testFactoryCanReserveAndBindExactlyOnce() public {
        TestnetGraduationAdapter adapter = new TestnetGraduationAdapter(address(this));
        AdapterCaller factory = new AdapterCaller();
        adapter.bindFactory(address(factory));

        address token = address(0xCAFE);
        address market = address(0xBEEF);
        bytes32 poolId = factory.prepare(adapter, token);
        factory.bindMarket(adapter, token, market);

        require(poolId != bytes32(0), "missing reservation");
        require(adapter.poolIdForToken(token) == poolId, "reservation mismatch");
        require(adapter.marketForToken(token) == market, "market mismatch");

        (bool rebound,) = address(adapter).call(abi.encodeCall(adapter.bindFactory, (address(0xD00D))));
        require(!rebound, "factory rebound");
    }

    function testGraduationIsExplicitlyDisabled() public {
        TestnetGraduationAdapter adapter = new TestnetGraduationAdapter(address(this));
        (bool graduated,) = address(adapter).call(abi.encodeCall(adapter.graduate, (address(1), 1)));
        require(!graduated, "graduation unexpectedly enabled");
    }
}
