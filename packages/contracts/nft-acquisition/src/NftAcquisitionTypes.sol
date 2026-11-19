// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
library NftAcquisitionTypes {
    struct Order {address seller;address vault;address collection;uint8 standard;uint256 tokenId;uint256 quantity;address currency;uint256 sellerAmount;address feeRecipient;uint256 feeAmount;address royaltyRecipient;uint256 royaltyAmount;uint48 startTime;uint48 endTime;uint64 sellerNonce;bytes32 salt;}
    struct Policy {address currency;uint128 perNftCap;uint128 totalBudget;uint128 periodBudget;uint32 cooldownSeconds;}
    struct Pins {address coreFactory;bytes32 coreFactoryHash;bytes32 tokenRuntimeHash;address venue;bytes32 venueHash;address paymentToken;bytes32 paymentTokenHash;}
}
interface INftAcquisitionERC20 {function balanceOf(address)external view returns(uint256);function allowance(address,address)external view returns(uint256);function approve(address,uint256)external returns(bool);function transfer(address,uint256)external returns(bool);function transferFrom(address,address,uint256)external returns(bool);}
interface INftAcquisition721 {function ownerOf(uint256)external view returns(address);function balanceOf(address)external view returns(uint256);function safeTransferFrom(address,address,uint256)external;}
interface INftAcquisition1155 {function balanceOf(address,uint256)external view returns(uint256);function safeTransferFrom(address,address,uint256,uint256,bytes calldata)external;}
interface INftAcquisition165 {function supportsInterface(bytes4)external view returns(bool);}
interface INftAcquisition2981 {function royaltyInfo(uint256,uint256)external view returns(address,uint256);}
interface INftAcquisitionCore {function originCurveForToken(address)external view returns(address);}
interface INftAcquisitionCurve {function creator()external view returns(address);function token()external view returns(address);function factory()external view returns(address);}
interface INftAcquisitionVenue {function orderHash(NftAcquisitionTypes.Order calldata)external view returns(bytes32);function fill(NftAcquisitionTypes.Order calldata,bytes calldata)external payable;function orderState(bytes32)external view returns(uint8);}
