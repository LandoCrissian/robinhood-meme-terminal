// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Minimal exact ABI declarations from the public Seaport 1.6 interface. This is
// synthetic test custody, NOT an approved budget vault or production adapter.
library SeaportFixtureTypes {
    struct OfferItem {uint8 itemType;address token;uint256 identifierOrCriteria;uint256 startAmount;uint256 endAmount;}
    struct ConsiderationItem {uint8 itemType;address token;uint256 identifierOrCriteria;uint256 startAmount;uint256 endAmount;address payable recipient;}
    struct OrderParameters {address offerer;address zone;OfferItem[] offer;ConsiderationItem[] consideration;uint8 orderType;uint256 startTime;uint256 endTime;bytes32 zoneHash;uint256 salt;bytes32 conduitKey;uint256 totalOriginalConsiderationItems;}
    struct OrderComponents {address offerer;address zone;OfferItem[] offer;ConsiderationItem[] consideration;uint8 orderType;uint256 startTime;uint256 endTime;bytes32 zoneHash;uint256 salt;bytes32 conduitKey;uint256 counter;}
    struct AdvancedOrder {OrderParameters parameters;uint120 numerator;uint120 denominator;bytes signature;bytes extraData;}
    struct CriteriaResolver {uint256 orderIndex;uint8 side;uint256 index;uint256 identifier;bytes32[] criteriaProof;}
}
interface IFixtureSeaport {
    function information() external view returns(string memory,bytes32,address);
    function getOrderHash(SeaportFixtureTypes.OrderComponents calldata) external view returns(bytes32);
    function getOrderStatus(bytes32) external view returns(bool,bool,uint256,uint256);
    function getCounter(address) external view returns(uint256);
    function cancel(SeaportFixtureTypes.OrderComponents[] calldata) external returns(bool);
    function incrementCounter() external returns(uint256);
    function fulfillAdvancedOrder(SeaportFixtureTypes.AdvancedOrder calldata,SeaportFixtureTypes.CriteriaResolver[] calldata,bytes32,address) external payable returns(bool);
}
interface IFixtureToken {function approve(address,uint256)external returns(bool);function balanceOf(address)external view returns(uint256);}
interface IFixture721 {function ownerOf(uint256)external view returns(address);function approve(address,uint256)external;}
interface IFixture1155 {function balanceOf(address,uint256)external view returns(uint256);}
contract SeaportFixtureReceiver {
    address public immutable owner;IFixtureSeaport public immutable seaport;
    bool private entered;address private expectedCollection;address private expectedSeller;uint256 private expectedId;uint256 private expectedQuantity;
    uint256 public safe721Callbacks;uint256 public safe1155Callbacks;
    constructor(address venue){require(block.chainid==31337,"LOCAL_ONLY");owner=msg.sender;seaport=IFixtureSeaport(venue);}
    function fulfill(SeaportFixtureTypes.AdvancedOrder calldata order,address paymentToken,uint256 exactSpend) external payable {
        require(block.chainid==31337&&msg.sender==owner&&!entered,"OWNER_OR_REENTRY");require(order.parameters.offer.length==1&&order.parameters.zone==address(0)&&order.parameters.orderType==0,"SUBSET");
        require(order.numerator==1&&order.denominator==1&&order.parameters.conduitKey==bytes32(0),"FULL_DIRECT_ONLY");
        uint256 total;for(uint256 i;i<order.parameters.consideration.length;i++){SeaportFixtureTypes.ConsiderationItem calldata c=order.parameters.consideration[i];require(c.token==paymentToken&&c.startAmount==c.endAmount&&c.itemType==(paymentToken==address(0)?0:1),"PAYMENT");total+=c.startAmount;}
        require(total==exactSpend&&(paymentToken==address(0)?(msg.value==0||msg.value==total)&&address(this).balance>=total:msg.value==0),"EXACT_VALUE");entered=true;
        uint256 nativeBefore=address(this).balance;uint256 paymentBefore=paymentToken==address(0)?0:IFixtureToken(paymentToken).balanceOf(address(this));
        SeaportFixtureTypes.OfferItem calldata item=order.parameters.offer[0];expectedCollection=item.token;expectedSeller=order.parameters.offerer;expectedId=item.identifierOrCriteria;expectedQuantity=item.startAmount;
        uint256 beforeHeld=item.itemType==3?IFixture1155(item.token).balanceOf(address(this),item.identifierOrCriteria):0;
        if(paymentToken!=address(0))require(IFixtureToken(paymentToken).approve(address(seaport),total));
        require(seaport.fulfillAdvancedOrder{value:paymentToken==address(0)?total:0}(order,new SeaportFixtureTypes.CriteriaResolver[](0),bytes32(0),address(this)),"FILL");
        if(paymentToken!=address(0))require(IFixtureToken(paymentToken).approve(address(seaport),0));
        if(paymentToken==address(0))require(address(this).balance+total==nativeBefore,"EXACT_NATIVE_SETTLEMENT");
        else require(IFixtureToken(paymentToken).balanceOf(address(this))+total==paymentBefore,"EXACT_TOKEN_SETTLEMENT");
        if(item.itemType==2)require(IFixture721(item.token).ownerOf(item.identifierOrCriteria)==address(this),"NFT_CUSTODY");
        else require(item.itemType==3&&IFixture1155(item.token).balanceOf(address(this),item.identifierOrCriteria)==beforeHeld+item.startAmount,"NFT_QUANTITY");
        entered=false;expectedCollection=address(0);
    }
    // Seaport 1.6 uses transferFrom for ERC721, so this callback is NOT expected
    // during its ERC721 fill. Real ownerOf/Transfer evidence is mandatory.
    function onERC721Received(address operator,address from,uint256 id,bytes calldata)external returns(bytes4){require(entered&&msg.sender==expectedCollection&&operator==address(seaport)&&from==expectedSeller&&id==expectedId);safe721Callbacks++;return this.onERC721Received.selector;}
    function onERC1155Received(address operator,address from,uint256 id,uint256 quantity,bytes calldata)external returns(bytes4){require(entered&&msg.sender==expectedCollection&&operator==address(seaport)&&from==expectedSeller&&id==expectedId&&quantity==expectedQuantity);safe1155Callbacks++;return this.onERC1155Received.selector;}
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata)external pure returns(bytes4){revert("NO_BATCH");}
    function supportsInterface(bytes4 id)external pure returns(bool){return id==0x01ffc9a7||id==0x150b7a02||id==0x4e2312e0;}
    receive()external payable {require(block.chainid==31337&&msg.sender==owner&&!entered,"OWNER_FUNDING_ONLY");}
}
contract SeaportFixtureSeller1271 {
    address public immutable owner;IFixtureSeaport public immutable seaport;bool public reject;bool public tryReentry;bool public reentrySucceeded;
    constructor(address owner_,address venue){require(block.chainid==31337);owner=owner_;seaport=IFixtureSeaport(venue);}
    function configure(bool reject_,bool reenter_)external{require(msg.sender==owner);reject=reject_;tryReentry=reenter_;}
    function approve721(address token,uint256 id)external{require(msg.sender==owner);IFixture721(token).approve(address(seaport),id);}
    function isValidSignature(bytes32 digest,bytes calldata signature)external view returns(bytes4){if(reject||signature.length!=65)return 0xffffffff;bytes32 r;bytes32 s;uint8 v;assembly("memory-safe"){r:=calldataload(signature.offset)s:=calldataload(add(signature.offset,32))v:=byte(0,calldataload(add(signature.offset,64)))}if((v!=27&&v!=28)||uint256(s)>0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0)return 0xffffffff;return ecrecover(digest,v,r,s)==owner?bytes4(0x1626ba7e):bytes4(0xffffffff);}
    receive()external payable {if(tryReentry)(reentrySucceeded,)=address(seaport).call(abi.encodeCall(IFixtureSeaport.incrementCounter,()));}
}
