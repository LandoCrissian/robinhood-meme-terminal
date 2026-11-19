// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {NftAcquisitionTypes as T,INftAcquisitionERC20,INftAcquisition721,INftAcquisition1155,INftAcquisition165,INftAcquisition2981} from "./NftAcquisitionTypes.sol";

/// @notice Synthetic, all-or-nothing local listing venue. NOT Seaport/OpenSea.
/// @dev No deployment or execution on 4663; no arbitrary calldata, conduit or
/// upgrade. A real venue requires a separately reviewed supported adapter.
contract SyntheticNftListingVenueV1 {
    uint256 public immutable deploymentChainId;
    address public immutable feeRecipient;uint16 public immutable feeBps;
    mapping(address=>uint64) public sellerNonces;mapping(bytes32=>uint8) public orderState;
    uint256 private entered=1;
    bytes32 private constant TYPEHASH=keccak256("Order(address seller,address vault,address collection,uint8 standard,uint256 tokenId,uint256 quantity,address currency,uint256 sellerAmount,address feeRecipient,uint256 feeAmount,address royaltyRecipient,uint256 royaltyAmount,uint48 startTime,uint48 endTime,uint64 sellerNonce,bytes32 salt)");
    error Unsupported();error InvalidOrder();error TransferFailed();error ReentrantCall();
    event OrderFilled(bytes32 indexed orderHash,address indexed vault,address indexed seller,address collection,uint256 tokenId,uint256 quantity,address currency,uint256 totalCost);
    event OrderCancelled(bytes32 indexed orderHash,address indexed seller);event SellerNonceChanged(address indexed seller,uint64 nonce);
    modifier guarded(){if(entered!=1)revert ReentrantCall();if(block.chainid!=31337)revert Unsupported();entered=2;_;entered=1;}
    constructor(address recipient,uint16 bps){if(block.chainid!=31337||recipient==address(0)||bps>1000)revert Unsupported();deploymentChainId=block.chainid;feeRecipient=recipient;feeBps=bps;}
    function orderHash(T.Order calldata o) public view returns(bytes32){
        bytes32 domain=keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("RMT Synthetic NFT Listing Venue"),keccak256("1"),block.chainid,address(this)));
        return keccak256(abi.encodePacked(hex"1901",domain,keccak256(abi.encode(TYPEHASH,o))));
    }
    function cancel(T.Order calldata o) external guarded {if(msg.sender!=o.seller)revert InvalidOrder();bytes32 id=orderHash(o);if(orderState[id]!=0)revert InvalidOrder();orderState[id]=2;emit OrderCancelled(id,msg.sender);}
    function bumpNonce() external guarded {sellerNonces[msg.sender]++;emit SellerNonceChanged(msg.sender,sellerNonces[msg.sender]);}
    function _signature(bytes32 id,address seller,bytes calldata signature) private pure {
        if(signature.length!=65)revert InvalidOrder();bytes32 r;bytes32 s;uint8 v;
        assembly("memory-safe"){r:=calldataload(signature.offset)s:=calldataload(add(signature.offset,32))v:=byte(0,calldataload(add(signature.offset,64)))}
        if((v!=27&&v!=28)||uint256(s)==0||uint256(s)>0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0||ecrecover(id,v,r,s)!=seller)revert InvalidOrder();
    }
    function _pay(address currency,address from,address to,uint256 amount) private {
        if(amount==0)return;if(to==address(0)||to==from||to==address(this))revert InvalidOrder();
        if(currency==address(0)){uint256 before_=to.balance;(bool ok,)=payable(to).call{value:amount}("");if(!ok||to.balance!=before_+amount)revert TransferFailed();}
        else{INftAcquisitionERC20 t=INftAcquisitionERC20(currency);uint256 a=t.balanceOf(from);uint256 b=t.balanceOf(to);if(!t.transferFrom(from,to,amount)||t.balanceOf(from)+amount!=a||t.balanceOf(to)!=b+amount)revert TransferFailed();}
    }
    function fill(T.Order calldata o,bytes calldata signature) external payable guarded {
        bytes32 id=orderHash(o);uint256 total=o.sellerAmount+o.feeAmount+o.royaltyAmount;
        if(msg.sender!=o.vault||o.seller==address(0)||o.seller==o.vault||o.collection.code.length==0||o.salt==bytes32(0)||o.sellerAmount==0||o.quantity==0||o.quantity>20
            ||(o.standard!=1&&o.standard!=2)||(o.standard==1&&o.quantity!=1)||o.startTime>block.timestamp||o.endTime<block.timestamp||o.endTime<=o.startTime
            ||o.sellerNonce!=sellerNonces[o.seller]||orderState[id]!=0||o.feeRecipient!=feeRecipient||o.feeAmount!=o.sellerAmount*feeBps/10000
            ||(o.currency==address(0)?msg.value!=total:msg.value!=0))revert InvalidOrder();
        _signature(id,o.seller,signature);
        if(INftAcquisition165(o.collection).supportsInterface(0x2a55205a)){
            (address recipient,uint256 amount)=INftAcquisition2981(o.collection).royaltyInfo(o.tokenId,o.sellerAmount);
            if(recipient!=o.royaltyRecipient||amount!=o.royaltyAmount)revert InvalidOrder();
        }else if(o.royaltyRecipient!=address(0)||o.royaltyAmount!=0)revert InvalidOrder();
        orderState[id]=1;
        _pay(o.currency,o.vault,o.seller,o.sellerAmount);_pay(o.currency,o.vault,o.feeRecipient,o.feeAmount);_pay(o.currency,o.vault,o.royaltyRecipient,o.royaltyAmount);
        if(o.standard==1)INftAcquisition721(o.collection).safeTransferFrom(o.seller,o.vault,o.tokenId);
        else INftAcquisition1155(o.collection).safeTransferFrom(o.seller,o.vault,o.tokenId,o.quantity,"");
        emit OrderFilled(id,o.vault,o.seller,o.collection,o.tokenId,o.quantity,o.currency,total);
    }
}
