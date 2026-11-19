// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SeaportAcquisitionBase} from "./SeaportAcquisition.t.sol";
import {RMTSeaportAcquisitionVaultV2 as Vault} from "../src/RMTSeaportAcquisitionVaultV2.sol";
import {SeaportAcquisitionTypes as T} from "../src/SeaportAcquisitionTypes.sol";

contract V2NativeCallback {
    address private target; bytes private payload; address payable private forward;
    uint256 public attempts; uint256 public successes; bytes4 public errorSelector;
    function configure(address next,bytes calldata data,address payable forward_) external { target=next; payload=data; forward=forward_; }
    receive() external payable {
        attempts++; (bool ok,bytes memory reason)=target.call(payload); if(ok)successes++;
        if(reason.length>=4){bytes4 selector;assembly("memory-safe"){selector:=mload(add(reason,32))}errorSelector=selector;}
        if(forward!=address(0)) { (bool sent,)=forward.call{value:msg.value}(""); require(sent); }
    }
}
contract V2CallbackCurrency {
    mapping(address=>uint256)public balanceOf; mapping(address=>mapping(address=>uint256))public allowance;
    address private target; bytes private payload; uint256 public attempts; uint256 public successes;
    event Transfer(address indexed from,address indexed to,uint256 amount); event Approval(address indexed owner,address indexed spender,uint256 amount);
    constructor(){balanceOf[msg.sender]=100 ether;}
    function configure(address next,bytes calldata data) external { target=next;payload=data; }
    function _callback() private { if(target==address(0))return; attempts++;(bool ok,)=target.call(payload);if(ok)successes++; }
    function approve(address to,uint256 amount) external returns(bool){_callback(); allowance[msg.sender][to]=amount;emit Approval(msg.sender,to,amount);return true;}
    function transfer(address to,uint256 amount) external returns(bool){_callback();_move(msg.sender,to,amount);return true;}
    function transferFrom(address from,address to,uint256 amount) external returns(bool){_callback();allowance[from][msg.sender]-=amount;_move(from,to,amount);return true;}
    function _move(address from,address to,uint256 amount) private {balanceOf[from]-=amount;balanceOf[to]+=amount;emit Transfer(from,to,amount);}
}
interface IV2Receive {function onERC1155Received(address,address,uint256,uint256,bytes calldata)external returns(bytes4);}
contract V2Hostile1155 {
    mapping(uint256=>mapping(address=>uint256)) private balances; mapping(address=>mapping(address=>bool))public isApprovedForAll;
    address public royaltyRecipient; address private target; bytes private payload; uint8 private fault;
    uint256 public attempts;uint256 public successes;
    event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 amount);
    constructor(address recipient){royaltyRecipient=recipient;}
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0xd9b67a26||id==0x2a55205a;}
    function royaltyInfo(uint256,uint256 amount)external view returns(address,uint256){return(royaltyRecipient,amount*500/10000);}
    function balanceOf(address who,uint256 id)external view returns(uint256){return balances[id][who];}
    function mint(address who,uint256 id,uint256 amount)external{balances[id][who]+=amount;}
    function setApprovalForAll(address to,bool enabled)external{isApprovedForAll[msg.sender][to]=enabled;}
    function configure(uint8 mode,address next,bytes calldata data)external{fault=mode;target=next;payload=data;}
    function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes calldata data)external{
        require(msg.sender==from||isApprovedForAll[from][msg.sender]);balances[id][from]-=amount;balances[id][to]+=amount;emit TransferSingle(msg.sender,from,to,id,amount);
        require(IV2Receive(to).onERC1155Received(msg.sender,from,id,amount,data)==0xf23a6e61);
        if(fault==1){attempts++;(bool ok,)=target.call(payload);if(ok)successes++;}
        if(fault==2)royaltyRecipient=target;
        if(fault==3)require(IV2Receive(to).onERC1155Received(msg.sender,from,id,amount,data)==0xf23a6e61);
    }
}
contract SeaportAcquisitionHostileTest is SeaportAcquisitionBase {
    function testNativeFeeCallbackCannotExecuteMatureWithdrawal() public {
        V2NativeCallback recipient=new V2NativeCallback(); vm.startPrank(CREATOR);
        vault.configureFeeRecipient(address(recipient),250); uint64 id=vault.scheduleAssetWithdrawal(address(0),1 ether,OTHER,uint48(_now()+3 days));vm.stopPrank();
        vm.warp(_now()+2 days);recipient.configure(address(vault),abi.encodeWithSignature("executeWithdrawal(uint64)",id),payable(address(0)));
        _policy(false);T.AdvancedOrder memory a=_order(false,false,1);a.parameters.consideration[1].recipient=payable(address(recipient));_buy(_sign(a));
        require(recipient.attempts()==1&&recipient.successes()==0&&OTHER.balance==0&&vault.reservedAsset(address(0))==1 ether);
        vault.executeWithdrawal(id);require(OTHER.balance==1 ether);_conserved(address(0));
    }
    function testNativeForwardingFeeRecipientIsExplicitlyRejectedAtomically() public {
        V2NativeCallback recipient=new V2NativeCallback();vm.prank(CREATOR);vault.configureFeeRecipient(address(recipient),250);
        recipient.configure(address(vault),abi.encodeWithSignature("disablePurchases()"),payable(OTHER));_policy(false);
        T.AdvancedOrder memory a=_order(false,false,1);a.parameters.consideration[1].recipient=payable(address(recipient));_reject(_sign(a));
        require(nft.ownerOf(1)==seller&&seller.balance==0&&OTHER.balance==0&&vault.totalSpent(address(0))==0&&recipient.attempts()==0);
    }
    function testTokenApprovalAndEveryPaymentCallbackCannotExecuteMatureWithdrawal() public {
        V2CallbackCurrency token=new V2CallbackCurrency();pins.paymentToken=address(token);pins.paymentTokenHash=address(token).codehash;
        vm.prank(CREATOR);vault=new Vault(CREATOR,address(cash),CREATOR,keccak256("callback token separate vault"),pins);
        token.transfer(CREATOR,10 ether);vm.startPrank(CREATOR);token.approve(address(vault),10 ether);vault.fundToken(10 ether,keccak256("settled callbacks"));
        vault.configureCollection(address(nft),1,address(nft).codehash,true,true,new uint256[](0));vault.configureFeeRecipient(FEE,250);
        uint64 id=vault.scheduleAssetWithdrawal(address(token),1 ether,OTHER,uint48(_now()+3 days));vm.stopPrank();vm.warp(_now()+2 days);
        token.configure(address(vault),abi.encodeWithSignature("executeWithdrawal(uint64)",id));
        vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(token),1 ether,10 ether,5 ether,1),true);
        T.AdvancedOrder memory a=_order(false,true,1);for(uint256 i;i<3;i++)a.parameters.consideration[i].token=address(token);_buy(_sign(a));
        require(token.attempts()>=5&&token.successes()==0&&token.allowance(address(vault),address(seaport))==0&&token.balanceOf(OTHER)==0);_conserved(address(token));
    }
    function _hostile(uint8 fault)private returns(V2Hostile1155 asset,T.AdvancedOrder memory a){
        asset=new V2Hostile1155(ROYALTY);asset.mint(seller,1,10);vm.prank(seller);asset.setApprovalForAll(address(seaport),true);
        vm.prank(CREATOR);vault.configureCollection(address(asset),2,address(asset).codehash,true,true,new uint256[](0));
        asset.configure(fault,OTHER,"");_policy(false);a=_order(true,false,1);a.parameters.offer[0].token=address(asset);a=_sign(a);
    }
    function testNftCallbackCannotExecuteMatureWithdrawalOrReenter() public {
        vm.prank(CREATOR);uint64 id=vault.scheduleAssetWithdrawal(address(0),1 ether,OTHER,uint48(_now()+3 days));vm.warp(_now()+2 days);
        (V2Hostile1155 asset,T.AdvancedOrder memory a)=_hostile(1);asset.configure(1,address(vault),abi.encodeWithSignature("executeWithdrawal(uint64)",id));_buy(a);
        require(asset.attempts()==1&&asset.successes()==0&&vault.nftHeld(address(asset),1)==2&&OTHER.balance==0);_conserved(address(0));
    }
    function testNftMutatingRoyaltyAfterTransferRollsBackEveryAssetAndState() public {
        (V2Hostile1155 asset,T.AdvancedOrder memory a)=_hostile(2);_reject(a);require(asset.royaltyRecipient()==ROYALTY&&asset.balanceOf(seller,1)==10&&seller.balance==0&&FEE.balance==0&&vault.totalSpent(address(0))==0);
    }
    function testDuplicateExpectedReceiveCallbackRollsBack() public {
        (V2Hostile1155 asset,T.AdvancedOrder memory a)=_hostile(3);_reject(a);require(asset.balanceOf(seller,1)==10&&asset.balanceOf(address(vault),1)==0&&vault.nftHeld(address(asset),1)==0);
    }
    function testLifetimeDayBudgetAndNoticeBoundRemainIndependent() public {
        vm.prank(CREATOR);vault.configurePolicy(T.Policy(address(0),.1 ether,.2 ether,.1 ether,1),true);_buy(_order(false,false,1));vm.warp(_now()+1);_reject(_order(false,false,2));
        vm.warp((_now()/1 days+1)*1 days);_buy(_order(false,false,2));vm.warp((_now()/1 days+1)*1 days);_reject(_order(false,false,3));
        vm.startPrank(CREATOR);vm.expectRevert();vault.scheduleAssetWithdrawal(address(0),1,OTHER,uint48(_now()+2 days));vm.expectRevert();vault.scheduleAssetWithdrawal(address(0),1,OTHER,uint48(_now()+10 days));vm.stopPrank();_conserved(address(0));
    }
    function testWithdrawalQueueCannotExceedSixteenOrDrainAnotherVault() public {
        for(uint256 i;i<16;i++){vm.prank(CREATOR);vault.scheduleAssetWithdrawal(address(0),1,OTHER,uint48(_now()+3 days));}
        vm.prank(CREATOR);vm.expectRevert();vault.scheduleAssetWithdrawal(address(0),1,OTHER,uint48(_now()+3 days));
        vm.prank(CREATOR);Vault other=new Vault(CREATOR,address(cash),OTHER,keccak256("segregated other project authority"),pins);
        require(other.accountedHeld(address(0))==0&&vault.accountedHeld(address(0))==10 ether);
        vm.prank(OTHER);vm.expectRevert();other.scheduleAssetWithdrawal(address(0),1,OTHER,uint48(_now()+3 days));_conserved(address(0));
    }
}
