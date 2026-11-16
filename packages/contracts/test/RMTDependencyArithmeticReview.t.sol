// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {BitMath} from "@uniswap/v4-core/src/libraries/BitMath.sol";

contract RMTDependencyArithmeticReviewTest is Test {
    function testExactWideQuotientsForAllOddDenominatorClasses() external pure {
        uint256 a = (uint256(1) << 230) + 0x1972E8;
        uint256 b = (uint256(1) << 240) + 0x487AC2;
        for (uint256 odd = 1; odd < 16; odd += 2) {
            uint256 denominator = (uint256(1) << 240) + odd;
            _checkQuotients(a, b, denominator);
            _checkQuotients(a, b, denominator << 8);
        }
        _checkQuotients(type(uint256).max, type(uint256).max, type(uint256).max);
        _checkQuotients(type(uint128).max, uint256(1) << 128, uint256(1) << 128);
    }

    function testFuzzExactQuotientAgainstIndependentWideProduct(uint256 a, uint256 b, uint256 selector) external pure {
        (uint256 high,) = _wideProduct(a, b);
        uint256 denominator = high + 1 + selector % (type(uint256).max - high);
        _checkQuotients(a, b, denominator);
    }

    function testDivisorAndQuotientBoundariesRevert() external {
        uint256 max = type(uint256).max;
        vm.expectRevert();
        this.uniswapQuotient(1, 1, 0);
        vm.expectRevert();
        this.openZeppelinQuotient(1, 1, 0);
        vm.expectRevert();
        this.uniswapQuotient(max, max, max - 1);
        vm.expectRevert();
        this.openZeppelinQuotient(max, max, max - 1);
        vm.expectRevert();
        this.uniswapRoundedUp(max - 1, max - 1, max - 2);
        vm.expectRevert();
        this.openZeppelinRoundedUp(max - 1, max - 1, max - 2);
    }

    function testBitIndicesCoverEveryOneHotAndDenseBoundary() external pure {
        for (uint256 index; index < 256; ++index) {
            uint256 one = uint256(1) << index;
            assertEq(BitMath.mostSignificantBit(one), index);
            assertEq(BitMath.leastSignificantBit(one), index);
            assertEq(BitMath.mostSignificantBit(one | (one - 1)), index);
            assertEq(BitMath.leastSignificantBit(~(one - 1)), index);
        }
    }

    function testFuzzBitIndicesAgainstSimpleScan(uint256 value) external pure {
        if (value == 0) return;
        uint256 high;
        uint256 low;
        uint256 x = value;
        while (x > 1) {
            x >>= 1;
            ++high;
        }
        x = value;
        while ((x & 1) == 0) {
            x >>= 1;
            ++low;
        }
        assertEq(BitMath.mostSignificantBit(value), high);
        assertEq(BitMath.leastSignificantBit(value), low);
    }

    function testZeroInputIsOutsideBitIndexDomain() external {
        vm.expectRevert();
        this.mostSignificantBit(0);
        vm.expectRevert();
        this.leastSignificantBit(0);
    }

    function uniswapQuotient(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return FullMath.mulDiv(a, b, denominator);
    }

    function openZeppelinQuotient(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return Math.mulDiv(a, b, denominator);
    }

    function uniswapRoundedUp(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return FullMath.mulDivRoundingUp(a, b, denominator);
    }

    function openZeppelinRoundedUp(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return Math.mulDiv(a, b, denominator, Math.Rounding.Ceil);
    }

    function mostSignificantBit(uint256 value) external pure returns (uint8) {
        return BitMath.mostSignificantBit(value);
    }

    function leastSignificantBit(uint256 value) external pure returns (uint8) {
        return BitMath.leastSignificantBit(value);
    }

    function _checkQuotients(uint256 a, uint256 b, uint256 denominator) private pure {
        (uint256 productHigh, uint256 productLow) = _wideProduct(a, b);
        uint256 quotient = FullMath.mulDiv(a, b, denominator);
        assertEq(Math.mulDiv(a, b, denominator), quotient);
        (uint256 paidHigh, uint256 paidLow) = _wideProduct(quotient, denominator);
        uint256 borrow = productLow < paidLow ? 1 : 0;
        assertEq(productHigh, paidHigh + borrow);
        uint256 remainder;
        unchecked {
            remainder = productLow - paidLow;
        }
        assertLt(remainder, denominator);
        if (quotient < type(uint256).max || remainder == 0) {
            uint256 ceil = quotient + (remainder == 0 ? 0 : 1);
            assertEq(FullMath.mulDivRoundingUp(a, b, denominator), ceil);
            assertEq(Math.mulDiv(a, b, denominator, Math.Rounding.Ceil), ceil);
        }
    }

    // Multiplication by independent 128-bit limbs and explicit carries.
    // The oracle uses no modular inverse, bit lookup or FullMath routine.
    function _wideProduct(uint256 a, uint256 b) private pure returns (uint256 high, uint256 low) {
        uint256 aLow = uint128(a);
        uint256 aHigh = a >> 128;
        uint256 bLow = uint128(b);
        uint256 bHigh = b >> 128;
        uint256 lowProduct = aLow * bLow;
        uint256 crossA = aLow * bHigh;
        uint256 crossB = aHigh * bLow;
        uint256 carryWord = (lowProduct >> 128) + uint128(crossA) + uint128(crossB);
        low = (carryWord << 128) | uint128(lowProduct);
        high = aHigh * bHigh + (crossA >> 128) + (crossB >> 128) + (carryWord >> 128);
    }
}
