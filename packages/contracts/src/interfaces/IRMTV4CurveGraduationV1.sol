// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IRMTV4CurveGraduationV1 {
    function factory() external view returns (address);

    function graduate(
        address token,
        uint256 nativeReserve,
        uint256 tokenReserve,
        uint256 priceNumerator,
        uint256 priceDenominator,
        uint256 deadline
    ) external payable returns (bytes32 poolId, uint256 positionTokenId, uint256 nativeUsed, uint256 tokenUsed);
}
