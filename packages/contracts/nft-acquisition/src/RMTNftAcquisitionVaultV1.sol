// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {NftAcquisitionTypes as T,INftAcquisitionCore,INftAcquisitionCurve,INftAcquisitionVenue,INftAcquisitionERC20,INftAcquisition721,INftAcquisition1155,INftAcquisition165} from "./NftAcquisitionTypes.sol";
import {NftAcquisitionAccounts} from "./NftAcquisitionAccounts.sol";
interface IAcquisitionDeploymentFactory {function vaultDeployer()external view returns(address);}

/// @notice Segregated settled-fund custody, synthetic chain 31337 ONLY.
/// No V1 ledger entitlement, fungible buyback, arbitrary call or upgrade exists.
contract RMTNftAcquisitionVaultV1 {
    address public immutable creator;address public immutable projectToken;bytes32 public immutable intentId;
    address public immutable deploymentFactory;uint256 public immutable deploymentChainId;
    address public immutable coreFactory;bytes32 public immutable coreFactoryHash;bytes32 public immutable tokenRuntimeHash;
    address public immutable venue;bytes32 public immutable venueHash;address public immutable paymentToken;bytes32 public immutable paymentTokenHash;
    address public immutable originCurve;
    uint32 public constant periodSeconds=1 days;uint48 public constant NOTICE=2 days;uint48 public constant WINDOW=7 days;
    address public controller;uint64 public controllerEpoch=1;uint64 public policyEpoch=1;
    bool public purchasesEnabled;T.Policy public policy;uint48 public lastPurchaseAt;uint256 private entered=1;
    struct Collection {bytes32 runtimeHash;uint8 standard;bool enabled;bool anyTokenId;}
    struct ControllerNotice {address next;uint48 validAfter;uint48 expiresAt;uint64 epoch;}
    struct Withdrawal {uint8 kind;address asset;uint256 tokenId;uint256 quantity;address recipient;uint48 validAfter;uint48 expiresAt;uint64 epoch;uint8 state;}
    mapping(address=>Collection) public collections;mapping(address=>uint256[]) private ids;mapping(address=>mapping(uint256=>bool)) public allowedTokenId;
    address[] private admittedCollections;
    mapping(address=>uint256) public accountedHeld;mapping(address=>uint256) public reservedAsset;mapping(address=>uint256) public funded;mapping(address=>uint256) public withdrawn;
    mapping(address=>uint256) public totalSpent;mapping(address=>mapping(uint256=>uint256)) public periodSpent;
    mapping(address=>mapping(uint256=>uint256)) public nftHeld;mapping(address=>mapping(uint256=>uint256)) public nftReserved;
    mapping(address=>bytes32) private custodyHash;mapping(address=>uint8) private custodyStandard;
    mapping(bytes32=>bool) public orderConsumed;ControllerNotice public pendingController;
    mapping(uint64=>Withdrawal) public withdrawals;uint64 public withdrawalNonce;uint256 public pendingWithdrawals;
    bool private receiving;bool private received;address private expectedCollection;address private expectedSeller;uint256 private expectedId;uint256 private expectedQuantity;uint8 private expectedStandard;
    error Unauthorized();error InvalidBinding();error InvalidPolicy();error InvalidOrder();error TransferFailed();error ReentrantCall();error InvalidNotice();error UnexpectedNFT();
    event FundingReceived(address indexed currency,address indexed sender,uint256 amount,bytes32 source);
    event CollectionConfigured(address indexed collection,bytes32 runtimeHash,uint8 standard,bool enabled,bool anyTokenId,uint256[] ids,uint64 policyEpoch);
    event PurchasePolicyChanged(uint64 indexed policyEpoch,uint64 controllerEpoch,bool enabled,address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds);
    event PurchaseExecuted(bytes32 indexed orderHash,address indexed seller,address indexed collection,uint256 tokenId,uint256 quantity,address currency,uint256 totalCost,uint256 sellerAmount,address feeRecipient,uint256 feeAmount,address royaltyRecipient,uint256 royaltyAmount,uint64 controllerEpoch,uint64 policyEpoch);
    event WithdrawalScheduled(uint64 indexed id,uint8 kind,address indexed asset,uint256 tokenId,uint256 quantity,address indexed recipient,uint48 validAfter,uint48 expiresAt,uint64 epoch);
    event WithdrawalExecuted(uint64 indexed id,uint8 kind,address indexed asset,uint256 tokenId,uint256 quantity,address indexed recipient);event WithdrawalCancelled(uint64 indexed id);
    event ControllerProposed(address indexed next,uint48 validAfter,uint48 expiresAt,uint64 epoch);event ControllerChanged(address indexed previous,address indexed next,uint64 epoch);event ControllerCancelled(address indexed next,uint64 epoch);
    modifier guarded(){if(entered!=1)revert ReentrantCall();_binding();entered=2;_;entered=1;}
    modifier onlyController(){if(msg.sender!=controller||!NftAcquisitionAccounts.supported(controller))revert Unauthorized();_;}
    constructor(address creator_,address token,address controller_,bytes32 intent,address factory,T.Pins memory p){
        if(block.chainid!=31337||creator_==address(0)||intent==bytes32(0)||!NftAcquisitionAccounts.supported(controller_)||factory.code.length==0
            ||IAcquisitionDeploymentFactory(factory).vaultDeployer()!=msg.sender||p.coreFactory.codehash!=p.coreFactoryHash||p.coreFactoryHash==bytes32(0)
            ||p.venue.codehash!=p.venueHash||p.venueHash==bytes32(0)||p.paymentToken.codehash!=p.paymentTokenHash||p.paymentTokenHash==bytes32(0)
            ||token.codehash!=p.tokenRuntimeHash||p.tokenRuntimeHash==bytes32(0))revert InvalidBinding();
        address curve=INftAcquisitionCore(p.coreFactory).originCurveForToken(token);
        if(curve.code.length==0||INftAcquisitionCurve(curve).creator()!=creator_||INftAcquisitionCurve(curve).token()!=token||INftAcquisitionCurve(curve).factory()!=p.coreFactory)revert InvalidBinding();
        creator=creator_;projectToken=token;controller=controller_;intentId=intent;deploymentFactory=factory;deploymentChainId=block.chainid;
        coreFactory=p.coreFactory;coreFactoryHash=p.coreFactoryHash;tokenRuntimeHash=p.tokenRuntimeHash;venue=p.venue;venueHash=p.venueHash;paymentToken=p.paymentToken;paymentTokenHash=p.paymentTokenHash;originCurve=curve;
    }
    function productionExecutionAvailable() external pure returns(bool){return false;}
    function _binding() private view {
        if(block.chainid!=31337||coreFactory.codehash!=coreFactoryHash||projectToken.codehash!=tokenRuntimeHash||venue.codehash!=venueHash||paymentToken.codehash!=paymentTokenHash
            ||INftAcquisitionCore(coreFactory).originCurveForToken(projectToken)!=originCurve||INftAcquisitionCurve(originCurve).creator()!=creator)revert InvalidBinding();
    }
    function _currency(address asset) private view {if(asset!=address(0)&&asset!=paymentToken)revert InvalidPolicy();}
    function _balance(address asset,address who) private view returns(uint256){return asset==address(0)?who.balance:INftAcquisitionERC20(asset).balanceOf(who);}
    function available(address asset) public view returns(uint256){return accountedHeld[asset]-reservedAsset[asset];}
    function collectionIds(address asset) external view returns(uint256[] memory){return ids[asset];}
    function fundNative(bytes32 source) external payable onlyController guarded {
        if(msg.value==0||source==bytes32(0))revert InvalidPolicy();accountedHeld[address(0)]+=msg.value;funded[address(0)]+=msg.value;emit FundingReceived(address(0),msg.sender,msg.value,source);
    }
    function fundToken(uint256 amount,bytes32 source) external onlyController guarded {
        if(amount==0||source==bytes32(0))revert InvalidPolicy();INftAcquisitionERC20 t=INftAcquisitionERC20(paymentToken);uint256 a=t.balanceOf(address(this));uint256 b=t.balanceOf(msg.sender);
        accountedHeld[paymentToken]+=amount;funded[paymentToken]+=amount;
        if(!t.transferFrom(msg.sender,address(this),amount)||t.balanceOf(address(this))!=a+amount||t.balanceOf(msg.sender)+amount!=b)revert TransferFailed();emit FundingReceived(paymentToken,msg.sender,amount,source);
    }
    function configurePolicy(T.Policy calldata p,bool enabled) external onlyController guarded {
        _currency(p.currency);if(p.perNftCap==0||p.totalBudget<p.perNftCap||p.periodBudget<p.perNftCap||p.periodBudget>p.totalBudget||p.cooldownSeconds<1||p.cooldownSeconds>30 days
            ||p.totalBudget<totalSpent[p.currency]||p.periodBudget<periodSpent[p.currency][block.timestamp/periodSeconds])revert InvalidPolicy();
        policy=p;purchasesEnabled=enabled;policyEpoch++;emit PurchasePolicyChanged(policyEpoch,controllerEpoch,enabled,p.currency,p.perNftCap,p.totalBudget,p.periodBudget,p.cooldownSeconds);
    }
    function disablePurchases() external onlyController guarded {purchasesEnabled=false;policyEpoch++;T.Policy memory p=policy;emit PurchasePolicyChanged(policyEpoch,controllerEpoch,false,p.currency,p.perNftCap,p.totalBudget,p.periodBudget,p.cooldownSeconds);}
    function configureCollection(address asset,uint8 standard,bytes32 hash,bool enabled,bool any,uint256[] calldata selected) external onlyController guarded {
        if(purchasesEnabled||asset.code.length==0||asset.codehash!=hash||hash==bytes32(0)||(standard!=1&&standard!=2)||selected.length>32||(!any&&enabled&&selected.length==0)
            ||!INftAcquisition165(asset).supportsInterface(0x01ffc9a7)||INftAcquisition165(asset).supportsInterface(0xffffffff)
            ||!INftAcquisition165(asset).supportsInterface(standard==1?bytes4(0x80ac58cd):bytes4(0xd9b67a26))
            ||(custodyHash[asset]!=bytes32(0)&&(custodyHash[asset]!=hash||custodyStandard[asset]!=standard)))revert InvalidPolicy();
        if(collections[asset].runtimeHash==bytes32(0)){if(admittedCollections.length>=8)revert InvalidPolicy();admittedCollections.push(asset);}
        uint256[] memory old=ids[asset];for(uint256 i;i<old.length;i++)delete allowedTokenId[asset][old[i]];delete ids[asset];
        for(uint256 i;i<selected.length;i++){if(i>0&&selected[i]<=selected[i-1])revert InvalidPolicy();ids[asset].push(selected[i]);allowedTokenId[asset][selected[i]]=true;}
        collections[asset]=Collection(hash,standard,enabled,any);policyEpoch++;emit CollectionConfigured(asset,hash,standard,enabled,any,selected,policyEpoch);
    }
    function _nftBalance(address collection,uint8 standard,address who,uint256 tokenId) private view returns(uint256){return standard==1?INftAcquisition721(collection).balanceOf(who):INftAcquisition1155(collection).balanceOf(who,tokenId);}
    function purchase(T.Order calldata o,bytes calldata signature,uint64 expectedPolicyEpoch,uint64 expectedControllerEpoch,uint48 deadline) external guarded {
        T.Policy memory p=policy;Collection memory c=collections[o.collection];uint256 total=o.sellerAmount+o.feeAmount+o.royaltyAmount;
        if(!purchasesEnabled||!NftAcquisitionAccounts.supported(controller)||expectedPolicyEpoch!=policyEpoch||expectedControllerEpoch!=controllerEpoch||deadline<block.timestamp||deadline>block.timestamp+5 minutes
            ||o.vault!=address(this)||o.seller==address(this)||!c.enabled||c.standard!=o.standard||o.collection.codehash!=c.runtimeHash||(!c.anyTokenId&&!allowedTokenId[o.collection][o.tokenId])
            ||o.currency!=p.currency||o.quantity==0||o.quantity>20||(o.standard==1&&o.quantity!=1)||total==0||total>uint256(p.perNftCap)*o.quantity
            ||totalSpent[o.currency]+total>p.totalBudget||periodSpent[o.currency][block.timestamp/periodSeconds]+total>p.periodBudget||total>available(o.currency)
            ||(lastPurchaseAt!=0&&block.timestamp<uint256(lastPurchaseAt)+p.cooldownSeconds))revert InvalidOrder();
        bytes32 id=INftAcquisitionVenue(venue).orderHash(o);if(orderConsumed[id])revert InvalidOrder();
        uint256 oldCurrency=_balance(o.currency,address(this));uint256 oldSeller=_nftBalance(o.collection,o.standard,o.seller,o.tokenId);uint256 oldHeld=_nftBalance(o.collection,o.standard,address(this),o.tokenId);
        if(oldCurrency<accountedHeld[o.currency]||oldSeller<o.quantity||(o.standard==1&&INftAcquisition721(o.collection).ownerOf(o.tokenId)!=o.seller))revert InvalidOrder();
        orderConsumed[id]=true;accountedHeld[o.currency]-=total;totalSpent[o.currency]+=total;periodSpent[o.currency][block.timestamp/periodSeconds]+=total;lastPurchaseAt=uint48(block.timestamp);
        receiving=true;received=false;expectedCollection=o.collection;expectedSeller=o.seller;expectedId=o.tokenId;expectedQuantity=o.quantity;expectedStandard=o.standard;
        if(o.currency==address(0))INftAcquisitionVenue(venue).fill{value:total}(o,signature);
        else {INftAcquisitionERC20 t=INftAcquisitionERC20(o.currency);if(t.allowance(address(this),venue)!=0||!t.approve(venue,total)||t.allowance(address(this),venue)!=total)revert TransferFailed();INftAcquisitionVenue(venue).fill(o,signature);if(t.allowance(address(this),venue)!=0)revert TransferFailed();}
        receiving=false;
        if(!received||INftAcquisitionVenue(venue).orderState(id)!=1||_balance(o.currency,address(this))+total!=oldCurrency||o.collection.codehash!=c.runtimeHash||venue.codehash!=venueHash
            ||_nftBalance(o.collection,o.standard,o.seller,o.tokenId)+o.quantity!=oldSeller||_nftBalance(o.collection,o.standard,address(this),o.tokenId)!=oldHeld+o.quantity
            ||(o.standard==1&&INftAcquisition721(o.collection).ownerOf(o.tokenId)!=address(this)))revert TransferFailed();
        nftHeld[o.collection][o.tokenId]+=o.quantity;custodyHash[o.collection]=c.runtimeHash;custodyStandard[o.collection]=c.standard;
        emit PurchaseExecuted(id,o.seller,o.collection,o.tokenId,o.quantity,o.currency,total,o.sellerAmount,o.feeRecipient,o.feeAmount,o.royaltyRecipient,o.royaltyAmount,controllerEpoch,policyEpoch);
    }
    function _notice(uint48 expiry) private view returns(uint48 after_){after_=uint48(block.timestamp)+NOTICE;if(expiry<=after_||expiry>after_+WINDOW)revert InvalidNotice();}
    function _queue(uint8 kind,address asset,uint256 tokenId,uint256 quantity,address recipient,uint48 expiry) private returns(uint64 id){
        if(quantity==0||recipient==address(0)||recipient==address(this)||recipient==venue||pendingWithdrawals>=16)revert InvalidNotice();uint48 after_=_notice(expiry);
        id=++withdrawalNonce;pendingWithdrawals++;withdrawals[id]=Withdrawal(kind,asset,tokenId,quantity,recipient,after_,expiry,controllerEpoch,1);emit WithdrawalScheduled(id,kind,asset,tokenId,quantity,recipient,after_,expiry,controllerEpoch);
    }
    function scheduleAssetWithdrawal(address currency,uint256 amount,address recipient,uint48 expiry) external onlyController guarded returns(uint64 id){_currency(currency);if(amount>available(currency))revert InvalidNotice();id=_queue(0,currency,0,amount,recipient,expiry);reservedAsset[currency]+=amount;}
    function scheduleNftWithdrawal(address asset,uint256 tokenId,uint256 quantity,address recipient,uint48 expiry) external onlyController guarded returns(uint64 id){if(quantity>nftHeld[asset][tokenId]-nftReserved[asset][tokenId]||custodyHash[asset]!=asset.codehash)revert InvalidNotice();id=_queue(custodyStandard[asset],asset,tokenId,quantity,recipient,expiry);nftReserved[asset][tokenId]+=quantity;}
    function _release(Withdrawal memory w) private {if(w.kind==0)reservedAsset[w.asset]-=w.quantity;else nftReserved[w.asset][w.tokenId]-=w.quantity;pendingWithdrawals--;}
    function cancelWithdrawal(uint64 id) external guarded {Withdrawal memory w=withdrawals[id];if(w.state!=1||(msg.sender!=controller&&w.epoch==controllerEpoch&&block.timestamp<=w.expiresAt))revert InvalidNotice();withdrawals[id].state=3;_release(w);emit WithdrawalCancelled(id);}
    function executeWithdrawal(uint64 id) external guarded {
        Withdrawal memory w=withdrawals[id];if(w.state!=1||w.epoch!=controllerEpoch||block.timestamp<w.validAfter||block.timestamp>w.expiresAt)revert InvalidNotice();withdrawals[id].state=2;_release(w);
        if(w.kind==0){accountedHeld[w.asset]-=w.quantity;withdrawn[w.asset]+=w.quantity;uint256 a=_balance(w.asset,address(this));uint256 b=_balance(w.asset,w.recipient);
            if(w.asset==address(0)){(bool ok,)=payable(w.recipient).call{value:w.quantity}("");if(!ok)revert TransferFailed();}else if(!INftAcquisitionERC20(w.asset).transfer(w.recipient,w.quantity))revert TransferFailed();
            if(_balance(w.asset,address(this))+w.quantity!=a||_balance(w.asset,w.recipient)!=b+w.quantity)revert TransferFailed();
        }else{if(w.asset.codehash!=custodyHash[w.asset])revert InvalidBinding();uint256 a=_nftBalance(w.asset,w.kind,address(this),w.tokenId);uint256 b=_nftBalance(w.asset,w.kind,w.recipient,w.tokenId);nftHeld[w.asset][w.tokenId]-=w.quantity;
            if(w.kind==1)INftAcquisition721(w.asset).safeTransferFrom(address(this),w.recipient,w.tokenId);else INftAcquisition1155(w.asset).safeTransferFrom(address(this),w.recipient,w.tokenId,w.quantity,"");
            if(_nftBalance(w.asset,w.kind,address(this),w.tokenId)+w.quantity!=a||_nftBalance(w.asset,w.kind,w.recipient,w.tokenId)!=b+w.quantity||(w.kind==1&&INftAcquisition721(w.asset).ownerOf(w.tokenId)!=w.recipient))revert TransferFailed();}
        emit WithdrawalExecuted(id,w.kind,w.asset,w.tokenId,w.quantity,w.recipient);
    }
    function proposeController(address next,uint48 expiry) external onlyController guarded {if(pendingController.next!=address(0)||next==controller||next==address(this)||!NftAcquisitionAccounts.supported(next))revert InvalidNotice();uint48 after_=_notice(expiry);pendingController=ControllerNotice(next,after_,expiry,controllerEpoch);emit ControllerProposed(next,after_,expiry,controllerEpoch);}
    function acceptController() external guarded {ControllerNotice memory n=pendingController;if(msg.sender!=n.next||n.epoch!=controllerEpoch||n.validAfter==0||block.timestamp<n.validAfter||block.timestamp>n.expiresAt||!NftAcquisitionAccounts.supported(msg.sender))revert InvalidNotice();address previous=controller;controller=msg.sender;controllerEpoch++;policyEpoch++;purchasesEnabled=false;delete pendingController;emit ControllerChanged(previous,msg.sender,controllerEpoch);}
    function cancelController() external guarded {ControllerNotice memory n=pendingController;if(n.next==address(0)||(msg.sender!=controller&&n.epoch==controllerEpoch&&block.timestamp<=n.expiresAt))revert InvalidNotice();delete pendingController;emit ControllerCancelled(n.next,n.epoch);}
    function onERC721Received(address operator,address from,uint256 id,bytes calldata) external returns(bytes4){if(!receiving||received||msg.sender!=expectedCollection||operator!=venue||from!=expectedSeller||id!=expectedId||expectedStandard!=1||expectedQuantity!=1)revert UnexpectedNFT();received=true;return 0x150b7a02;}
    function onERC1155Received(address operator,address from,uint256 id,uint256 quantity,bytes calldata) external returns(bytes4){if(!receiving||received||msg.sender!=expectedCollection||operator!=venue||from!=expectedSeller||id!=expectedId||quantity!=expectedQuantity||expectedStandard!=2)revert UnexpectedNFT();received=true;return 0xf23a6e61;}
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external pure returns(bytes4){revert UnexpectedNFT();}
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0x150b7a02||id==0x4e2312e0;}
}
