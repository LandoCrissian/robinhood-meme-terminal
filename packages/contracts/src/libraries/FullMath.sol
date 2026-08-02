// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice 512-bit multiply/divide math adapted from Uniswap V3 Core's FullMath library.
/// @dev Computes floor(a * b / denominator) with full precision and reverts on overflow or zero denominator.
library FullMath {
    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 product0;
            uint256 product1;
            assembly ("memory-safe") {
                let mm := mulmod(a, b, not(0))
                product0 := mul(a, b)
                product1 := sub(sub(mm, product0), lt(mm, product0))
            }

            if (product1 == 0) return product0 / denominator;
            require(denominator > product1);

            uint256 remainder;
            assembly ("memory-safe") {
                remainder := mulmod(a, b, denominator)
                product1 := sub(product1, gt(remainder, product0))
                product0 := sub(product0, remainder)
            }

            uint256 twos = denominator & (~denominator + 1);
            assembly ("memory-safe") {
                denominator := div(denominator, twos)
                product0 := div(product0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            product0 |= product1 * twos;

            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            result = product0 * inverse;
        }
    }
}
