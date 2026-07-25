// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function expectRevert(bytes4 revertData) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        require(condition, "ASSERT_TRUE_FAILED");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "ASSERT_EQ_UINT_FAILED");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "ASSERT_EQ_ADDRESS_FAILED");
    }

    function assertLe(uint256 actual, uint256 maximum) internal pure {
        require(actual <= maximum, "ASSERT_LE_FAILED");
    }

    function assertGe(uint256 actual, uint256 minimum) internal pure {
        require(actual >= minimum, "ASSERT_GE_FAILED");
    }
}
