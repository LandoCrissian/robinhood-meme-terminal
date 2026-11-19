// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Exact Seaport 1.6 ABI, with only the FULL_OPEN static direct-sell subset admitted.
library SeaportAcquisitionTypes {
    struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }
    struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address payable recipient; }
    struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }
    struct OrderComponents { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 counter; }
    struct AdvancedOrder { OrderParameters parameters; uint120 numerator; uint120 denominator; bytes signature; bytes extraData; }
    struct CriteriaResolver { uint256 orderIndex; uint8 side; uint256 index; uint256 identifier; bytes32[] criteriaProof; }
    struct Pins { address coreFactory; bytes32 coreFactoryHash; bytes32 tokenRuntimeHash; address seaport; bytes32 seaportHash; address paymentToken; bytes32 paymentTokenHash; }
    struct Policy { address currency; uint128 perNftCap; uint128 totalBudget; uint128 periodBudget; uint32 cooldownSeconds; }
    struct Request { bytes32 signedOrderHash; uint256 counter; uint64 policyEpoch; uint64 controllerEpoch; uint48 deadline; }
}
interface IAcquisitionSeaport {
    function information() external view returns (string memory, bytes32, address);
    function getOrderHash(SeaportAcquisitionTypes.OrderComponents calldata) external view returns (bytes32);
    function getOrderStatus(bytes32) external view returns (bool, bool, uint256, uint256);
    function getCounter(address) external view returns (uint256);
    function fulfillAdvancedOrder(SeaportAcquisitionTypes.AdvancedOrder calldata, SeaportAcquisitionTypes.CriteriaResolver[] calldata, bytes32, address) external payable returns (bool);
}
interface IAcquisitionSignature { function isValidSignature(bytes32, bytes calldata) external view returns (bytes4); }
interface IAcquisitionToken {
    function balanceOf(address) external view returns (uint256);
    function allowance(address,address) external view returns (uint256);
    function approve(address,uint256) external returns (bool);
    function transfer(address,uint256) external returns (bool);
    function transferFrom(address,address,uint256) external returns (bool);
}
interface IAcquisition721 {
    function ownerOf(uint256) external view returns (address);
    function balanceOf(address) external view returns (uint256);
    function safeTransferFrom(address,address,uint256) external;
}
interface IAcquisition1155 {
    function balanceOf(address,uint256) external view returns (uint256);
    function safeTransferFrom(address,address,uint256,uint256,bytes calldata) external;
}
interface IAcquisition165 { function supportsInterface(bytes4) external view returns (bool); }
interface IAcquisition2981 { function royaltyInfo(uint256,uint256) external view returns (address,uint256); }
interface IAcquisitionCore { function originCurveForToken(address) external view returns (address); }
interface IAcquisitionCurve {
    function creator() external view returns (address);
    function token() external view returns (address);
    function factory() external view returns (address);
}
