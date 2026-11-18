// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct ProtocolPins {
    address factory;
    bytes32 factoryRuntimeHash;
    address graduationEngine;
    bytes32 graduationRuntimeHash;
    bytes32 tokenRuntimeHash;
}

interface ITreasuryFactoryCore {
    function tokenForIntent(address creator, bytes32 intentId) external view returns (address);
    function originCurveForToken(address token) external view returns (address);
    function graduationEngine() external view returns (address);
    function operatingRecipient() external view returns (address);
    function futureReserveRecipient() external view returns (address);
}

interface ITreasuryCurve {
    function creator() external view returns (address);
    function token() external view returns (address);
    function treasury() external view returns (address);
    function treasuryShareBps() external view returns (uint16);
    function revenueLedger() external view returns (address);
    function factory() external view returns (address);
    function graduationEngine() external view returns (address);
}

interface ITreasuryLedger {
    function creator() external view returns (address);
    function treasury() external view returns (address);
    function treasuryShareBps() external view returns (uint16);
    function operatingRecipient() external view returns (address);
    function futureReserveRecipient() external view returns (address);
    function claim() external returns (uint256);
}

interface ITreasuryLpLedger {
    function creator() external view returns (address);
    function treasury() external view returns (address);
    function treasuryShareBps() external view returns (uint16);
    function operatingRecipient() external view returns (address);
    function futureReserveRecipient() external view returns (address);
    function engine() external view returns (address);
    function token() external view returns (address);
    function claim() external returns (uint256, uint256);
    function claimAsset(bool native) external returns (uint256, uint256);
}

interface ITreasuryGraduation {
    function factory() external view returns (address);
    function lpFeeLedger(address token) external view returns (address);
    function positionManager() external view returns (address);
    function positions(address token) external view returns (uint256, uint128);
    function collectLpFees(address token, uint256 deadline) external returns (uint256, uint256);
}

interface ITreasuryPositionManager {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}

interface ITreasuryERC20 {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface ITreasurySafe {
    function masterCopy() external view returns (address);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function getModulesPaginated(address start, uint256 pageSize) external view returns (address[] memory, address);
    function getStorageAt(uint256 offset, uint256 length) external view returns (bytes memory);
}
