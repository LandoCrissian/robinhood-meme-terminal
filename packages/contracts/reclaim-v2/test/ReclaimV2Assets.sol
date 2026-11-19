// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IV2Receiver721 {function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4);}
interface IV2Receiver1155 {
    function onERC1155Received(address,address,uint256,uint256,bytes calldata) external returns(bytes4);
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external returns(bytes4);
}
/// @dev Synthetic fixed-once IDs: no owner/admin, upgrade, seizure, remint,
/// delegated execution or policy mutation. A retired ID can never be minted again.
abstract contract ReclaimV2Base721 {
    mapping(uint256=>address) internal owners;
    mapping(address=>uint256) private balances;
    mapping(uint256=>bool) public everMinted;
    mapping(uint256=>address) public getApproved;
    mapping(address=>mapping(address=>bool)) public isApprovedForAll;
    uint256 public totalSupply;
    event Transfer(address indexed from,address indexed to,uint256 indexed tokenId);
    event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner,address indexed operator,bool approved);
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0x80ac58cd;}
    function balanceOf(address account) external view returns(uint256){require(account!=address(0));return balances[account];}
    function ownerOf(uint256 id) public view returns(address){address who=owners[id];require(who!=address(0),"NONEXISTENT");return who;}
    function exists(uint256 id) external view returns(bool){return owners[id]!=address(0);}
    function mint(address to,uint256 id) external {require(to!=address(0)&&!everMinted[id],"MINT_ONCE");everMinted[id]=true;owners[id]=to;balances[to]++;totalSupply++;emit Transfer(address(0),to,id);}
    function approve(address to,uint256 id) external {address from=ownerOf(id);require(msg.sender==from||isApprovedForAll[from][msg.sender]);getApproved[id]=to;emit Approval(from,to,id);}
    function setApprovalForAll(address to,bool value) external {require(to!=msg.sender);isApprovedForAll[msg.sender][to]=value;emit ApprovalForAll(msg.sender,to,value);}
    function _authorized(address from,uint256 id) internal view {require(ownerOf(id)==from&&(msg.sender==from||getApproved[id]==msg.sender||isApprovedForAll[from][msg.sender]),"AUTH");}
    function transferFrom(address from,address to,uint256 id) public {require(to!=address(0));_authorized(from,id);delete getApproved[id];owners[id]=to;balances[from]--;balances[to]++;emit Transfer(from,to,id);}
    function safeTransferFrom(address from,address to,uint256 id) external {safeTransferFrom(from,to,id,"");}
    function safeTransferFrom(address from,address to,uint256 id,bytes memory data) public {transferFrom(from,to,id);if(to.code.length!=0)require(IV2Receiver721(to).onERC721Received(msg.sender,from,id,data)==0x150b7a02);}
    function _burn(uint256 id) internal {address from=ownerOf(id);_authorized(from,id);delete getApproved[id];delete owners[id];balances[from]--;totalSupply--;emit Transfer(from,address(0),id);}
}
contract ReclaimBurn721Fixture is ReclaimV2Base721 {function burn(uint256 id) external {_burn(id);}}
contract ReclaimSink721Fixture is ReclaimV2Base721 {}

abstract contract ReclaimV2Base1155 {
    mapping(uint256=>mapping(address=>uint256)) internal balances;
    mapping(uint256=>bool) public everMinted;
    mapping(uint256=>uint256) public totalSupply;
    mapping(address=>mapping(address=>bool)) public isApprovedForAll;
    event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value);
    event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values);
    event ApprovalForAll(address indexed owner,address indexed operator,bool approved);
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0xd9b67a26;}
    function balanceOf(address account,uint256 id) public view returns(uint256){require(account!=address(0));return balances[id][account];}
    function balanceOfBatch(address[] calldata accounts,uint256[] calldata ids) external view returns(uint256[] memory result){require(accounts.length==ids.length);result=new uint256[](ids.length);for(uint256 i;i<ids.length;i++)result[i]=balanceOf(accounts[i],ids[i]);}
    function mint(address to,uint256 id,uint256 amount) external {require(to!=address(0)&&!everMinted[id]&&amount!=0&&amount<=20,"MINT_ONCE");everMinted[id]=true;balances[id][to]=amount;totalSupply[id]=amount;emit TransferSingle(msg.sender,address(0),to,id,amount);if(to.code.length!=0)require(IV2Receiver1155(to).onERC1155Received(msg.sender,address(0),id,amount,"")==0xf23a6e61);}
    function setApprovalForAll(address operator,bool approved) external {require(operator!=msg.sender);isApprovedForAll[msg.sender][operator]=approved;emit ApprovalForAll(msg.sender,operator,approved);}
    function _authorization(address from) internal view {require(from==msg.sender||isApprovedForAll[from][msg.sender],"AUTH");}
    function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes calldata data) external {require(to!=address(0));_authorization(from);balances[id][from]-=amount;balances[id][to]+=amount;emit TransferSingle(msg.sender,from,to,id,amount);if(to.code.length!=0)require(IV2Receiver1155(to).onERC1155Received(msg.sender,from,id,amount,data)==0xf23a6e61);}
    function safeBatchTransferFrom(address from,address to,uint256[] calldata ids,uint256[] calldata amounts,bytes calldata data) external {require(to!=address(0)&&ids.length==amounts.length);_authorization(from);for(uint256 i;i<ids.length;i++){balances[ids[i]][from]-=amounts[i];balances[ids[i]][to]+=amounts[i];}emit TransferBatch(msg.sender,from,to,ids,amounts);if(to.code.length!=0)require(IV2Receiver1155(to).onERC1155BatchReceived(msg.sender,from,ids,amounts,data)==0xbc197c81);}
    function _burn(address from,uint256 id,uint256 amount) internal {require(amount!=0);_authorization(from);balances[id][from]-=amount;totalSupply[id]-=amount;emit TransferSingle(msg.sender,from,address(0),id,amount);}
}
contract ReclaimBurn1155Fixture is ReclaimV2Base1155 {function burn(address from,uint256 id,uint256 amount) external {_burn(from,id,amount);}}
contract ReclaimSink1155Fixture is ReclaimV2Base1155 {}

/// @dev Negative fixtures are never admitted by the four honest runtime policies.
contract ReclaimFakeBurn721 is ReclaimV2Base721 {function burn(uint256) external pure {}}
contract ReclaimIssuerRecovery721 is ReclaimV2Base721 {function burn(uint256 id) external {_burn(id);}function issuerRestore(address to,uint256 id) external {owners[id]=to;}}
contract ReclaimFakeBurn1155 is ReclaimV2Base1155 {function burn(address,uint256,uint256) external pure {}}

contract ReclaimV2RewardFixture {
    string public constant name="Synthetic RMT V2";string public constant symbol="tRMT";uint8 public constant decimals=18;uint256 public constant totalSupply=1_000_000_000 ether;
    mapping(address=>uint256) public balanceOf;mapping(address=>mapping(address=>uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 value);event Approval(address indexed owner,address indexed spender,uint256 value);
    constructor(){balanceOf[msg.sender]=totalSupply;emit Transfer(address(0),msg.sender,totalSupply);}
    function approve(address spender,uint256 value) external returns(bool){allowance[msg.sender][spender]=value;emit Approval(msg.sender,spender,value);return true;}
    function transfer(address to,uint256 value) external virtual returns(bool){_move(msg.sender,to,value);return true;}
    function transferFrom(address from,address to,uint256 value) external virtual returns(bool){allowance[from][msg.sender]-=value;_move(from,to,value);return true;}
    function _move(address from,address to,uint256 value) internal virtual {require(to!=address(0));balanceOf[from]-=value;balanceOf[to]+=value;emit Transfer(from,to,value);}
}
contract ReclaimV2HostileReward is ReclaimV2RewardFixture {
    uint8 public mode;address public target;bytes public data;bool public reentered;
    function configure(uint8 next,address who,bytes calldata payload) external {mode=next;target=who;data=payload;}
    function _move(address from,address to,uint256 value) internal override {balanceOf[from]-=value+(mode==4?1:0);uint256 credit=value-(mode==3&&value>0?1:0);balanceOf[to]+=credit;emit Transfer(from,to,credit);if(mode==5)(reentered,)=target.call(data);}
    function _result() private view returns(bool){if(mode==2){assembly{mstore(0,1)return(31,1)}}return mode!=1;}
    function transfer(address to,uint256 value) external override returns(bool){_move(msg.sender,to,value);return _result();}
    function transferFrom(address from,address to,uint256 value) external override returns(bool){allowance[from][msg.sender]-=value;_move(from,to,value);return _result();}
}
contract ReclaimV2Callback721 is ReclaimV2Base721 {
    address public target;bool public reentered;bool public interrupted;
    function configure(address who,bool stop) external {target=who;interrupted=stop;}
    function burn(uint256 id) external {require(!interrupted,"INTERRUPTED");_burn(id);(reentered,)=target.call(abi.encodeWithSignature("reconcileSurplus()"));}
}
