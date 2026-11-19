// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface Fixture721Receiver {function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4);}
interface Fixture1155Receiver {
    function onERC1155Received(address,address,uint256,uint256,bytes calldata) external returns(bytes4);
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external returns(bytes4);
}
/// @dev Synthetic fixtures only: public minting is NOT an admitted live policy.
contract Reclaim721Fixture {
    mapping(uint256=>address) internal owners;
    mapping(address=>uint256) internal ownerBalances;
    mapping(uint256=>address) public getApproved;
    mapping(address=>mapping(address=>bool)) public isApprovedForAll;
    event Transfer(address indexed from,address indexed to,uint256 indexed tokenId);
    event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner,address indexed operator,bool approved);
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0x80ac58cd;}
    function ownerOf(uint256 id) public view returns(address){require(owners[id]!=address(0),"nonexistent");return owners[id];}
    function balanceOf(address owner)external view returns(uint256){require(owner!=address(0));return ownerBalances[owner];}
    function mint(address to,uint256 id) external {require(to!=address(0)&&owners[id]==address(0),"mint");owners[id]=to;ownerBalances[to]++;emit Transfer(address(0),to,id);}
    function approve(address to,uint256 id) external {address owner=ownerOf(id);require(msg.sender==owner||isApprovedForAll[owner][msg.sender],"owner");getApproved[id]=to;emit Approval(owner,to,id);}
    function setApprovalForAll(address to,bool enabled) external {require(to!=msg.sender);isApprovedForAll[msg.sender][to]=enabled;emit ApprovalForAll(msg.sender,to,enabled);}
    function transferFrom(address from,address to,uint256 id) public virtual {
        require(ownerOf(id)==from&&to!=address(0)&&(msg.sender==from||getApproved[id]==msg.sender||isApprovedForAll[from][msg.sender]),"approval");
        owners[id]=to;ownerBalances[from]--;ownerBalances[to]++;delete getApproved[id];emit Transfer(from,to,id);
    }
    function safeTransferFrom(address from,address to,uint256 id) external {safeTransferFrom(from,to,id,"");}
    function safeTransferFrom(address from,address to,uint256 id,bytes memory data) public virtual {
        transferFrom(from,to,id);
        if(to.code.length!=0)require(Fixture721Receiver(to).onERC721Received(msg.sender,from,id,data)==0x150b7a02,"receiver");
    }
}
contract Reclaim1155Fixture {
    mapping(address=>mapping(uint256=>uint256)) internal balances;
    mapping(address=>mapping(address=>bool)) public isApprovedForAll;
    event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value);
    event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values);
    event ApprovalForAll(address indexed owner,address indexed operator,bool approved);
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0xd9b67a26;}
    function balanceOf(address account,uint256 id) external view returns(uint256){require(account!=address(0));return balances[account][id];}
    function balanceOfBatch(address[]calldata accounts,uint256[]calldata ids)external view returns(uint256[]memory result){require(accounts.length==ids.length);result=new uint256[](ids.length);for(uint256 i;i<ids.length;i++){require(accounts[i]!=address(0));result[i]=balances[accounts[i]][ids[i]];}}
    function mint(address to,uint256 id,uint256 amount) external {require(to!=address(0));balances[to][id]+=amount;emit TransferSingle(msg.sender,address(0),to,id,amount);if(to.code.length!=0)require(Fixture1155Receiver(to).onERC1155Received(msg.sender,address(0),id,amount,"")==0xf23a6e61,"receiver");}
    function setApprovalForAll(address to,bool enabled) external {require(to!=msg.sender);isApprovedForAll[msg.sender][to]=enabled;emit ApprovalForAll(msg.sender,to,enabled);}
    function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes calldata data) external {
        require(to!=address(0)&&(msg.sender==from||isApprovedForAll[from][msg.sender]),"approval");balances[from][id]-=amount;balances[to][id]+=amount;
        emit TransferSingle(msg.sender,from,to,id,amount);
        if(to.code.length!=0)require(Fixture1155Receiver(to).onERC1155Received(msg.sender,from,id,amount,data)==0xf23a6e61,"receiver");
    }
    function safeBatchTransferFrom(address from,address to,uint256[] memory ids,uint256[] memory amounts,bytes memory data) public virtual {
        require(to!=address(0)&&ids.length==amounts.length&&(msg.sender==from||isApprovedForAll[from][msg.sender]),"approval");
        for(uint256 i;i<ids.length;i++){balances[from][ids[i]]-=amounts[i];balances[to][ids[i]]+=amounts[i];}
        emit TransferBatch(msg.sender,from,to,ids,amounts);
        if(to.code.length!=0)require(Fixture1155Receiver(to).onERC1155BatchReceived(msg.sender,from,ids,amounts,data)==0xbc197c81,"receiver");
    }
}
contract ReclaimRewardFixture {
    uint256 public constant totalSupply=1_000_000_000 ether;
    uint8 public constant decimals=18;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 value);
    event Approval(address indexed owner,address indexed spender,uint256 value);
    constructor(){balanceOf[msg.sender]=totalSupply;emit Transfer(address(0),msg.sender,totalSupply);}
    function approve(address to,uint256 amount) external returns(bool){allowance[msg.sender][to]=amount;emit Approval(msg.sender,to,amount);return true;}
    function transfer(address to,uint256 amount) external virtual returns(bool){_move(msg.sender,to,amount);return true;}
    function transferFrom(address from,address to,uint256 amount) external virtual returns(bool){allowance[from][msg.sender]-=amount;_move(from,to,amount);return true;}
    function _move(address from,address to,uint256 amount) internal virtual {require(to!=address(0));balanceOf[from]-=amount;balanceOf[to]+=amount;emit Transfer(from,to,amount);}
}
/// @dev Explicitly counterfactual hostile implementations, NOT the real token.
contract ReclaimHostileReward is ReclaimRewardFixture {
    uint8 public mode;address public callbackTarget;bytes public callbackData;bool public callbackSucceeded;
    function configure(uint8 m,address target,bytes calldata data) external {mode=m;callbackTarget=target;callbackData=data;}
    function _move(address from,address to,uint256 amount) internal override {
        uint256 debit=amount+(mode==4?1:0);uint256 credit=amount-(mode==3&&amount>0?1:0);
        balanceOf[from]-=debit;balanceOf[to]+=credit;emit Transfer(from,to,credit);
        if(mode==5)(callbackSucceeded,)=callbackTarget.call(callbackData);
    }
    function transfer(address to,uint256 amount) external override returns(bool){_move(msg.sender,to,amount);return _result();}
    function transferFrom(address from,address to,uint256 amount) external override returns(bool){allowance[from][msg.sender]-=amount;_move(from,to,amount);return _result();}
    function _result() private view returns(bool){if(mode==2){assembly{mstore(0,1)return(31,1)}}return mode!=1;}
}
contract ReclaimHostile721 is Reclaim721Fixture {
    uint8 public mode;address public target;bool public callbackSucceeded;
    function configure(uint8 m,address t) external{mode=m;target=t;}
    function safeTransferFrom(address from,address to,uint256 id,bytes memory data) public override {
        if(mode==1)revert("interrupted");
        transferFrom(from,to,id);
        if(mode==4)owners[id]=address(0x400001);
        if(mode==5)(callbackSucceeded,)=target.call(abi.encodeWithSignature("reconcileSurplus()"));
        if(to.code.length!=0&&mode!=3)require(Fixture721Receiver(to).onERC721Received(msg.sender,mode==2?address(0x500001):from,id,data)==0x150b7a02);
    }
}
contract ReclaimHostile1155 is Reclaim1155Fixture {
    uint8 public mode;address public target;bool public callbackSucceeded;
    function configure(uint8 m,address t) external{mode=m;target=t;}
    function safeBatchTransferFrom(address from,address to,uint256[] memory ids,uint256[] memory amounts,bytes memory data) public override {
        if(mode==1)revert("interrupted");require(msg.sender==from||isApprovedForAll[from][msg.sender]);
        for(uint256 i;i<ids.length;i++){balances[from][ids[i]]-=amounts[i]+(mode==4?1:0);balances[to][ids[i]]+=amounts[i]-(mode==3?1:0);}
        emit TransferBatch(msg.sender,from,to,ids,amounts);
        if(mode==5)(callbackSucceeded,)=target.call(abi.encodeWithSignature("reconcileSurplus()"));
        if(to.code.length!=0)require(Fixture1155Receiver(to).onERC1155BatchReceived(msg.sender,mode==2?address(0x500001):from,ids,amounts,data)==0xbc197c81);
    }
}
contract ReclaimRejectNFTReceiver {
    function onERC721Received(address,address,uint256,bytes calldata)external pure returns(bytes4){revert("reject");}
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata)external pure returns(bytes4){revert("reject");}
    function run(address target,bytes calldata data) external returns(bytes memory){(bool ok,bytes memory result)=target.call(data);require(ok);return result;}
}
