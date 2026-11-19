// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// Synthetic-only configurable failure fixtures. These are not production NFT
// admissions or evidence that an arbitrary collection has safe admin semantics.
interface IAcqReceiver721 {function onERC721Received(address,address,uint256,bytes calldata)external returns(bytes4);}
interface IAcqReceiver1155 {function onERC1155Received(address,address,uint256,uint256,bytes calldata)external returns(bytes4);function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata)external returns(bytes4);}
contract Acquisition721Fixture {
    string public constant name="Synthetic Acquisition 721";string public constant symbol="aNFT";
    address public royaltyRecipient;uint16 public royaltyBps;uint8 public fault;address public callbackTarget;bool public callbackSucceeded;bytes4 public callbackError;
    mapping(uint256=>address)private owners;mapping(address=>uint256)public balanceOf;mapping(uint256=>address)public getApproved;
    mapping(address=>mapping(address=>bool))public isApprovedForAll;mapping(uint256=>bool)public everMinted;
    event Transfer(address indexed from,address indexed to,uint256 indexed tokenId);event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId);event ApprovalForAll(address indexed owner,address indexed operator,bool approved);
    constructor(address recipient,uint16 bps){require(bps<=1000);royaltyRecipient=recipient;royaltyBps=bps;}
    function supportsInterface(bytes4 id)external pure returns(bool){return id==0x01ffc9a7||id==0x80ac58cd||id==0x5b5e139f||id==0x2a55205a;}
    function contractURI()external pure returns(string memory){return"ipfs://synthetic-local-acquisition721";}
    function tokenURI(uint256)external pure returns(string memory){return"ipfs://synthetic-local-acquisition721/item";}
    function royaltyInfo(uint256,uint256 amount)external view returns(address,uint256){return(royaltyRecipient,amount*royaltyBps/10000);}
    function configureRoyalty(address to,uint16 bps)external{require(bps<=1000);royaltyRecipient=to;royaltyBps=bps;}
    function configureFault(uint8 next,address target)external{fault=next;callbackTarget=target;}
    function ownerOf(uint256 id)public view returns(address){require(owners[id]!=address(0),"ABSENT");return owners[id];}
    function mint(address to,uint256 id)external{require(to!=address(0)&&!everMinted[id]);everMinted[id]=true;owners[id]=to;balanceOf[to]++;emit Transfer(address(0),to,id);}
    function approve(address to,uint256 id)external{address owner=ownerOf(id);require(msg.sender==owner||isApprovedForAll[owner][msg.sender]);getApproved[id]=to;emit Approval(owner,to,id);}
    function setApprovalForAll(address to,bool allowed)external{require(to!=msg.sender);isApprovedForAll[msg.sender][to]=allowed;emit ApprovalForAll(msg.sender,to,allowed);}
    function transferFrom(address from,address to,uint256 id)public{require(ownerOf(id)==from&&to!=address(0)&&(msg.sender==from||getApproved[id]==msg.sender||isApprovedForAll[from][msg.sender]));delete getApproved[id];owners[id]=to;if(fault!=5)balanceOf[from]--;if(fault!=6)balanceOf[to]++;emit Transfer(from,to,id);}
    function safeTransferFrom(address from,address to,uint256 id)external{safeTransferFrom(from,to,id,"");}
    function safeTransferFrom(address from,address to,uint256 id,bytes memory data)public{
        address actual=fault==1?callbackTarget:to;transferFrom(from,actual,id);
        if(actual.code.length!=0)require(IAcqReceiver721(actual).onERC721Received(msg.sender,from,id,data)==0x150b7a02);
        if(fault==2||fault==4){bytes memory reason;bytes memory data_=fault==2?abi.encodeWithSignature("disablePurchases()"):abi.encodeWithSignature("executeWithdrawal(uint64)",uint64(0));(callbackSucceeded,reason)=callbackTarget.call(data_);if(reason.length>=4){bytes4 e;assembly("memory-safe"){e:=mload(add(reason,32))}callbackError=e;}}
        if(fault==3)revert("INTERRUPTED_NFT");
    }
}
contract Acquisition1155Fixture {
    address public royaltyRecipient;uint16 public royaltyBps;uint8 public fault;address public callbackTarget;
    mapping(uint256=>mapping(address=>uint256))private balances;mapping(address=>mapping(address=>bool))public isApprovedForAll;mapping(uint256=>bool)public everMinted;
    event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value);event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values);event ApprovalForAll(address indexed owner,address indexed operator,bool approved);
    constructor(address recipient,uint16 bps){require(bps<=1000);royaltyRecipient=recipient;royaltyBps=bps;}
    function supportsInterface(bytes4 id)external pure returns(bool){return id==0x01ffc9a7||id==0xd9b67a26||id==0x0e89341c||id==0x2a55205a;}
    function uri(uint256)external pure returns(string memory){return"ipfs://synthetic-local-acquisition1155/{id}";}
    function contractURI()external pure returns(string memory){return"ipfs://synthetic-local-acquisition1155";}
    function royaltyInfo(uint256,uint256 amount)external view returns(address,uint256){return(royaltyRecipient,amount*royaltyBps/10000);}
    function configureRoyalty(address to,uint16 bps)external{require(bps<=1000);royaltyRecipient=to;royaltyBps=bps;}
    function configureFault(uint8 next,address target)external{fault=next;callbackTarget=target;}
    function balanceOf(address who,uint256 id)public view returns(uint256){return balances[id][who];}
    function mint(address to,uint256 id,uint256 quantity)external{require(to!=address(0)&&quantity>0&&!everMinted[id]);everMinted[id]=true;balances[id][to]=quantity;emit TransferSingle(msg.sender,address(0),to,id,quantity);if(to.code.length!=0)require(IAcqReceiver1155(to).onERC1155Received(msg.sender,address(0),id,quantity,"")==0xf23a6e61);}
    function setApprovalForAll(address to,bool allowed)external{require(to!=msg.sender);isApprovedForAll[msg.sender][to]=allowed;emit ApprovalForAll(msg.sender,to,allowed);}
    function safeTransferFrom(address from,address to,uint256 id,uint256 quantity,bytes calldata data)external{require(to!=address(0)&&(msg.sender==from||isApprovedForAll[from][msg.sender]));address actual=fault==1?callbackTarget:to;balances[id][from]-=quantity;balances[id][actual]+=quantity;emit TransferSingle(msg.sender,from,actual,id,quantity);if(actual.code.length!=0)require(IAcqReceiver1155(actual).onERC1155Received(msg.sender,from,id,quantity,data)==0xf23a6e61);if(fault==3)revert("INTERRUPTED_NFT");}
    function safeBatchTransferFrom(address from,address to,uint256[] calldata ids,uint256[] calldata amounts,bytes calldata data)external{require(to!=address(0)&&ids.length==amounts.length&&(msg.sender==from||isApprovedForAll[from][msg.sender]));for(uint256 i;i<ids.length;i++){balances[ids[i]][from]-=amounts[i];balances[ids[i]][to]+=amounts[i];}emit TransferBatch(msg.sender,from,to,ids,amounts);if(to.code.length!=0)require(IAcqReceiver1155(to).onERC1155BatchReceived(msg.sender,from,ids,amounts,data)==0xbc197c81);}
}
contract AcquisitionCurrencyFixture {
    string public constant name="Synthetic settlement token";string public constant symbol="tPAY";uint8 public constant decimals=18;uint256 public constant totalSupply=1_000_000_000 ether;
    mapping(address=>uint256)public balanceOf;mapping(address=>mapping(address=>uint256))public allowance;uint8 public fault;
    event Transfer(address indexed from,address indexed to,uint256 value);event Approval(address indexed owner,address indexed spender,uint256 value);
    constructor(){balanceOf[msg.sender]=totalSupply;}
    function configureFault(uint8 next)external{fault=next;}
    function approve(address to,uint256 amount)external returns(bool){allowance[msg.sender][to]=amount;emit Approval(msg.sender,to,amount);return true;}
    function transfer(address to,uint256 amount)external returns(bool){_move(msg.sender,to,amount);return fault!=1;}
    function transferFrom(address from,address to,uint256 amount)external returns(bool){allowance[from][msg.sender]-=amount;_move(from,to,amount);return fault!=1;}
    function _move(address from,address to,uint256 amount)private{require(to!=address(0));balanceOf[from]-=amount+(fault==3?1:0);uint256 credit=amount-(fault==2?1:0);balanceOf[to]+=credit;emit Transfer(from,to,credit);}
}
contract AcquisitionMockCurve {address public immutable creator;address public immutable token;address public immutable factory;constructor(address a,address t,address f){creator=a;token=t;factory=f;}}
contract AcquisitionMockCore {mapping(address=>address)public originCurveForToken;function register(address t,address creator)external{require(originCurveForToken[t]==address(0));originCurveForToken[t]=address(new AcquisitionMockCurve(creator,t,address(this)));}}
contract AcquisitionRejectRecipient {receive()external payable{revert("NO_ETH");}}
