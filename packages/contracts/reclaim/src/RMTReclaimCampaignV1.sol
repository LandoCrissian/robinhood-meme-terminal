// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IReclaimERC20,IReclaimERC165,IReclaimERC721,IReclaimERC1155,ReclaimEligibility} from "./ReclaimInterfaces.sol";

/// @notice Segregated manually funded fixed-token-unit NFT trade-in escrow.
/// @dev NOT a burn, sink, marketplace or USD oracle. Original claimants may
/// return EXACT original rewards to recover their own NFTs; eligibility/caps
/// remain consumed. No controller can withdraw, redirect or burn accepted NFTs.
contract RMTReclaimCampaignV1 {
    uint48 public constant NOTICE=2 days;
    uint48 public constant WINDOW=7 days;
    uint256 public constant MAX_ITEMS=8;
    uint256 public constant MAX_UNITS=20;
    uint256 public constant outstandingLiability=0;
    uint256 private constant SUPPLY=1_000_000_000 ether;
    address public immutable creator;
    address public immutable rewardToken;
    bytes32 public immutable rewardRuntimeHash;
    uint256 public immutable deploymentChainId;
    address public immutable deploymentFactory;
    address public controller;
    uint64 public controllerEpoch=1;
    uint64 public policyEpoch=1;
    uint128 public rewardPerUnit;
    uint32 public walletCap;
    bool public paused=true;
    bool public closed;
    uint256 public reserve;
    uint256 public funded;
    uint256 public paid;
    uint256 public repaid;
    uint256 public recovered;
    uint256 public unsolicited;
    uint64 public tradeInNonce;
    uint32 public eligibleCollections;
    uint256 private entered=1;

    struct Collection { bytes32 runtimeHash; bytes32 eligibilityRoot; uint32 collectionCap; uint32 walletCap; uint8 standard; bool enabled; }
    struct CollectionNotice { address collection; bytes32 runtimeHash; bytes32 eligibilityRoot; uint32 collectionCap; uint32 walletCap; uint8 standard; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct ValueNotice { uint256 value; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct ControllerNotice { address next; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct TradeIn { address claimant; address collection; uint8 standard; uint64 policyEpoch; uint256 reward; uint32 units; uint8 state; }
    struct ReceiptContext { address collection; address from; bytes32 itemsHash; bytes32 dataHash; uint256 id; uint8 standard; bool received; }
    mapping(address=>Collection) public collections;
    mapping(address=>uint32) public walletClaimed;
    mapping(address=>uint32) public collectionClaimed;
    mapping(address=>mapping(address=>uint32)) public collectionWalletClaimed;
    mapping(address=>mapping(uint256=>uint256)) public claimedUnits;
    mapping(address=>uint64) public claimantNonces;
    mapping(uint64=>TradeIn) public tradeIns;
    mapping(uint64=>bytes32) public receiptCollectionHash;
    mapping(uint64=>uint256[]) private itemIds;
    mapping(uint64=>uint256[]) private itemQuantities;
    CollectionNotice public pendingCollection;
    ValueNotice public pendingRate;
    ValueNotice public pendingClose;
    ValueNotice public pendingRecovery;
    ControllerNotice public pendingController;
    ReceiptContext private receiving;

    error Unauthorized();error ReentrantCall();error InvalidConfiguration();error InvalidAsset();
    error InvalidEligibility();error InvalidAmount();error InvalidQuote();error NotAvailable();error NoticeUnavailable();
    error TransferFailed();error UnsupportedAssetBehavior();error UnsupportedUsdReference();error UnexpectedNFT();
    event Funded(address indexed controller,uint256 amount);
    event SurplusReconciled(uint256 amount);
    event ReserveRecovered(address indexed controller,uint256 amount);
    event CollectionScheduled(address indexed collection,bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch);
    event CollectionConfigured(address indexed collection,bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint64 policyEpoch);
    event CollectionDisabled(address indexed collection,uint64 policyEpoch);
    event RateScheduled(uint128 rewardPerUnit,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch);
    event RateChanged(uint128 rewardPerUnit,uint64 policyEpoch);
    event CloseScheduled(uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch);
    event CampaignClosed(uint64 policyEpoch);
    event RecoveryScheduled(uint256 amount,address indexed recipient,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch);
    event ControllerScheduled(address indexed previous,address indexed next,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch);
    event ControllerChanged(address indexed previous,address indexed next,uint64 controllerEpoch,uint64 policyEpoch);
    event NoticeCancelled(uint8 indexed kind);
    event PauseChanged(bool paused,uint64 policyEpoch);
    event TradeInAccepted(uint64 indexed receiptId,address indexed claimant,address indexed collection,uint8 standard,uint256[] ids,uint256[] quantities,uint256 reward,uint64 policyEpoch,uint64 claimantNonce);
    event TradeInReturned(uint64 indexed receiptId,address indexed claimant,uint256 rewardRepaid);
    modifier nonReentrant(){if(entered!=1)revert ReentrantCall();_token();entered=2;_;entered=1;}
    modifier onlyController(){if(msg.sender!=controller)revert Unauthorized();_;}

    constructor(address creator_,address controller_,address token_,bytes32 tokenHash_,uint128 rate_,uint32 cap_) {
        if((block.chainid!=31337&&block.chainid!=4663)||creator_==address(0)||controller_==address(0)||controller_==address(this)||controller_==token_||rate_==0||cap_==0
            ||token_==address(0)||tokenHash_==bytes32(0)||token_.code.length==0||token_.codehash!=tokenHash_
            ||IReclaimERC20(token_).decimals()!=18||IReclaimERC20(token_).totalSupply()!=SUPPLY)revert InvalidConfiguration();
        creator=creator_;controller=controller_;rewardToken=token_;rewardRuntimeHash=tokenHash_;
        deploymentChainId=block.chainid;deploymentFactory=msg.sender;rewardPerUnit=rate_;walletCap=cap_;
    }
    function _token() private view {if(block.chainid!=deploymentChainId||rewardToken.codehash!=rewardRuntimeHash)revert InvalidAsset();}
    function _sync() private {
        _token();uint256 actual=IReclaimERC20(rewardToken).balanceOf(address(this));if(actual<reserve)revert UnsupportedAssetBehavior();
        uint256 delta=actual-reserve;if(delta!=0){reserve+=delta;unsolicited+=delta;emit SurplusReconciled(delta);}
    }
    function reconcileSurplus() external nonReentrant {_sync();}
    function _pull(address from,uint256 amount) private {
        _token();uint256 a=IReclaimERC20(rewardToken).balanceOf(address(this));uint256 b=IReclaimERC20(rewardToken).balanceOf(from);
        _call(abi.encodeCall(IReclaimERC20.transferFrom,(from,address(this),amount)));
        if(IReclaimERC20(rewardToken).balanceOf(address(this))!=a+amount||IReclaimERC20(rewardToken).balanceOf(from)+amount!=b)revert UnsupportedAssetBehavior();
    }
    function _pay(address to,uint256 amount) private {
        _token();uint256 a=IReclaimERC20(rewardToken).balanceOf(address(this));uint256 b=IReclaimERC20(rewardToken).balanceOf(to);
        _call(abi.encodeCall(IReclaimERC20.transfer,(to,amount)));
        if(IReclaimERC20(rewardToken).balanceOf(address(this))+amount!=a||IReclaimERC20(rewardToken).balanceOf(to)!=b+amount)revert UnsupportedAssetBehavior();
    }
    function _call(bytes memory data) private {
        (bool ok,bytes memory result)=rewardToken.call(data);
        if(!ok||(result.length!=0&&(result.length!=32||!abi.decode(result,(bool)))))revert TransferFailed();
    }
    function fund(uint256 amount) external onlyController nonReentrant {
        if(closed||amount==0)revert NotAvailable();_sync();funded+=amount;reserve+=amount;_pull(msg.sender,amount);emit Funded(msg.sender,amount);
    }
    function quoteUsd(uint256,uint256,uint48) external pure returns(uint256){revert UnsupportedUsdReference();}
    function pause() external onlyController nonReentrant {if(closed)revert NotAvailable();paused=true;policyEpoch++;emit PauseChanged(true,policyEpoch);}
    function resume() external onlyController nonReentrant {
        if(closed||eligibleCollections==0||reserve<rewardPerUnit)revert NotAvailable();_token();paused=false;policyEpoch++;emit PauseChanged(false,policyEpoch);
    }
    function _notice(uint48 expiresAt) private view returns(uint48 after_) {
        after_=uint48(block.timestamp)+NOTICE;if(expiresAt<=after_||expiresAt>after_+WINDOW)revert NoticeUnavailable();
    }
    function _mature(uint48 after_,uint48 expiry,uint64 epoch) private view {
        if(after_==0||epoch!=controllerEpoch||block.timestamp<after_||block.timestamp>expiry)revert NoticeUnavailable();
    }
    function _cancel(uint48 after_,uint48 expiry,uint64 epoch) private view {
        if(after_==0||(msg.sender!=controller&&epoch==controllerEpoch&&block.timestamp<=expiry))revert Unauthorized();
    }
    function _collection(address asset,bytes32 hash,uint8 standard) private view {
        if(asset==address(0)||asset==rewardToken||asset==address(this)||asset.code.length==0||asset.codehash!=hash
            ||(standard!=1&&standard!=2)||!IReclaimERC165(asset).supportsInterface(0x01ffc9a7)
            ||IReclaimERC165(asset).supportsInterface(0xffffffff)
            ||!IReclaimERC165(asset).supportsInterface(standard==1?bytes4(0x80ac58cd):bytes4(0xd9b67a26)))revert InvalidAsset();
    }
    function proposeCollection(address asset,uint8 standard,bytes32 hash,bytes32 root,uint32 cap,uint32 walletCap_,uint48 expiresAt) external onlyController nonReentrant {
        if(closed||pendingCollection.collection!=address(0)||root==bytes32(0)||cap==0||walletCap_==0||walletCap_>cap||cap<collectionClaimed[asset])revert InvalidConfiguration();
        _collection(asset,hash,standard);uint48 after_=_notice(expiresAt);
        pendingCollection=CollectionNotice(asset,hash,root,cap,walletCap_,standard,after_,expiresAt,controllerEpoch);
        emit CollectionScheduled(asset,hash,root,cap,walletCap_,standard,after_,expiresAt,controllerEpoch);
    }
    function executeCollection() external nonReentrant {
        CollectionNotice memory n=pendingCollection;_mature(n.validAfter,n.expiresAt,n.epoch);if(closed)revert NotAvailable();
        _collection(n.collection,n.runtimeHash,n.standard);if(n.collectionCap<collectionClaimed[n.collection])revert InvalidConfiguration();delete pendingCollection;
        if(!collections[n.collection].enabled)eligibleCollections++;
        collections[n.collection]=Collection(n.runtimeHash,n.eligibilityRoot,n.collectionCap,n.walletCap,n.standard,true);policyEpoch++;
        emit CollectionConfigured(n.collection,n.runtimeHash,n.eligibilityRoot,n.collectionCap,n.walletCap,n.standard,policyEpoch);
    }
    function cancelCollection() external nonReentrant {CollectionNotice memory n=pendingCollection;_cancel(n.validAfter,n.expiresAt,n.epoch);delete pendingCollection;emit NoticeCancelled(1);}
    function disableCollection(address asset) external onlyController nonReentrant {if(!collections[asset].enabled)revert InvalidAsset();collections[asset].enabled=false;eligibleCollections--;policyEpoch++;emit CollectionDisabled(asset,policyEpoch);}
    function proposeRate(uint128 rate,uint48 expiresAt) external onlyController nonReentrant {
        if(closed||rate==0||pendingRate.validAfter!=0)revert InvalidConfiguration();uint48 after_=_notice(expiresAt);
        pendingRate=ValueNotice(rate,after_,expiresAt,controllerEpoch);emit RateScheduled(rate,after_,expiresAt,controllerEpoch);
    }
    function executeRate() external nonReentrant {ValueNotice memory n=pendingRate;_mature(n.validAfter,n.expiresAt,n.epoch);if(closed)revert NotAvailable();delete pendingRate;rewardPerUnit=uint128(n.value);policyEpoch++;emit RateChanged(rewardPerUnit,policyEpoch);}
    function cancelRate() external nonReentrant {ValueNotice memory n=pendingRate;_cancel(n.validAfter,n.expiresAt,n.epoch);delete pendingRate;emit NoticeCancelled(2);}
    function proposeClose(uint48 expiresAt) external onlyController nonReentrant {
        if(closed||pendingClose.validAfter!=0)revert InvalidConfiguration();uint48 after_=_notice(expiresAt);
        pendingClose=ValueNotice(1,after_,expiresAt,controllerEpoch);emit CloseScheduled(after_,expiresAt,controllerEpoch);
    }
    function executeClose() external nonReentrant {ValueNotice memory n=pendingClose;_mature(n.validAfter,n.expiresAt,n.epoch);if(closed)revert NotAvailable();delete pendingClose;closed=true;paused=true;policyEpoch++;emit CampaignClosed(policyEpoch);}
    function cancelClose() external nonReentrant {ValueNotice memory n=pendingClose;_cancel(n.validAfter,n.expiresAt,n.epoch);delete pendingClose;emit NoticeCancelled(3);}
    function proposeRecovery(uint256 amount,uint48 expiresAt) external onlyController nonReentrant {
        if(!closed||amount==0||amount>reserve||pendingRecovery.validAfter!=0)revert NotAvailable();uint48 after_=_notice(expiresAt);
        pendingRecovery=ValueNotice(amount,after_,expiresAt,controllerEpoch);emit RecoveryScheduled(amount,controller,after_,expiresAt,controllerEpoch);
    }
    function executeRecovery() external nonReentrant {
        ValueNotice memory n=pendingRecovery;_mature(n.validAfter,n.expiresAt,n.epoch);if(!closed)revert NotAvailable();_sync();if(n.value>reserve)revert InvalidAmount();
        delete pendingRecovery;reserve-=n.value;recovered+=n.value;_pay(controller,n.value);emit ReserveRecovered(controller,n.value);
    }
    function cancelRecovery() external nonReentrant {ValueNotice memory n=pendingRecovery;_cancel(n.validAfter,n.expiresAt,n.epoch);delete pendingRecovery;emit NoticeCancelled(4);}
    function proposeController(address next,uint48 expiresAt) external onlyController nonReentrant {
        if(next==address(0)||next==address(this)||next==controller||pendingController.next!=address(0))revert InvalidConfiguration();uint48 after_=_notice(expiresAt);
        pendingController=ControllerNotice(next,after_,expiresAt,controllerEpoch);emit ControllerScheduled(controller,next,after_,expiresAt,controllerEpoch);
    }
    function acceptController() external nonReentrant {
        ControllerNotice memory n=pendingController;_mature(n.validAfter,n.expiresAt,n.epoch);if(msg.sender!=n.next)revert Unauthorized();
        address previous=controller;delete pendingController;controller=msg.sender;controllerEpoch++;policyEpoch++;paused=true;
        emit ControllerChanged(previous,msg.sender,controllerEpoch,policyEpoch);emit PauseChanged(true,policyEpoch);
    }
    function cancelController() external nonReentrant {ControllerNotice memory n=pendingController;_cancel(n.validAfter,n.expiresAt,n.epoch);delete pendingController;emit NoticeCancelled(5);}

    function eligibilityLeaf(address asset,uint256 id,uint256 maximum) public view returns(bytes32) {
        Collection memory c=collections[asset];return ReclaimEligibility.leaf(deploymentChainId,address(this),asset,c.runtimeHash,c.standard,id,maximum);
    }
    function receiptItems(uint64 id) external view returns(uint256[] memory ids,uint256[] memory quantities){return(itemIds[id],itemQuantities[id]);}
    function quote(address asset,uint256[] calldata ids,uint256[] calldata quantities,uint256[] calldata maximum,bytes32[][] calldata proofs,address claimant) public view returns(uint256 reward,uint32 units) {
        if(closed||paused||claimant==address(0)||ids.length==0||ids.length>MAX_ITEMS||ids.length!=quantities.length||ids.length!=maximum.length||ids.length!=proofs.length)revert NotAvailable();
        _token();Collection memory c=collections[asset];if(!c.enabled)revert InvalidEligibility();_collection(asset,c.runtimeHash,c.standard);
        for(uint256 i;i<ids.length;i++){
            if((i!=0&&ids[i]<=ids[i-1])||quantities[i]==0||quantities[i]>MAX_UNITS||maximum[i]==0
                ||(c.standard==1&&(quantities[i]!=1||maximum[i]!=1))||claimedUnits[asset][ids[i]]+quantities[i]>maximum[i]
                ||!ReclaimEligibility.verify(c.eligibilityRoot,eligibilityLeaf(asset,ids[i],maximum[i]),proofs[i]))revert InvalidEligibility();
            units+=uint32(quantities[i]);
        }
        if(units>MAX_UNITS||uint256(walletClaimed[claimant])+units>walletCap||uint256(collectionClaimed[asset])+units>c.collectionCap
            ||uint256(collectionWalletClaimed[asset][claimant])+units>c.walletCap)revert InvalidEligibility();
        reward=uint256(rewardPerUnit)*units;if(reward==0||reward>reserve||IReclaimERC20(rewardToken).balanceOf(address(this))<reserve)revert InvalidAmount();
    }
    function redeem(address asset,uint256[] calldata ids,uint256[] calldata quantities,uint256[] calldata maximum,bytes32[][] calldata proofs,
        uint64 expectedPolicyEpoch,uint256 expectedReward,uint64 nonce,uint48 deadline) external nonReentrant returns(uint64 receiptId) {
        if(deadline<block.timestamp||deadline>block.timestamp+5 minutes||expectedPolicyEpoch!=policyEpoch||nonce!=claimantNonces[msg.sender])revert InvalidQuote();
        _sync();(uint256 reward,uint32 units)=quote(asset,ids,quantities,maximum,proofs,msg.sender);if(reward!=expectedReward)revert InvalidQuote();
        uint8 standard=collections[asset].standard;receiptId=++tradeInNonce;claimantNonces[msg.sender]++;
        walletClaimed[msg.sender]+=units;collectionClaimed[asset]+=units;collectionWalletClaimed[asset][msg.sender]+=units;
        for(uint256 i;i<ids.length;i++)claimedUnits[asset][ids[i]]+=quantities[i];
        tradeIns[receiptId]=TradeIn(msg.sender,asset,standard,policyEpoch,reward,units,1);receiptCollectionHash[receiptId]=collections[asset].runtimeHash;itemIds[receiptId]=ids;itemQuantities[receiptId]=quantities;
        reserve-=reward;paid+=reward;
        _takeNFT(asset,standard,ids,quantities,receiptId);_pay(msg.sender,reward);
        emit TradeInAccepted(receiptId,msg.sender,asset,standard,ids,quantities,reward,policyEpoch,nonce);
    }
    function _takeNFT(address asset,uint8 standard,uint256[] calldata ids,uint256[] calldata quantities,uint64 receiptId) private {
        bytes memory data=abi.encode(receiptId);
        if(standard==1){
            for(uint256 i;i<ids.length;i++){
                if(IReclaimERC721(asset).ownerOf(ids[i])!=msg.sender)revert Unauthorized();
                receiving=ReceiptContext(asset,msg.sender,bytes32(0),keccak256(data),ids[i],1,false);
                IReclaimERC721(asset).safeTransferFrom(msg.sender,address(this),ids[i],data);
                if(!receiving.received||IReclaimERC721(asset).ownerOf(ids[i])!=address(this))revert UnsupportedAssetBehavior();delete receiving;
            }
        }else{
            uint256[] memory beforeVault=new uint256[](ids.length);uint256[] memory beforeSender=new uint256[](ids.length);
            for(uint256 i;i<ids.length;i++){beforeVault[i]=IReclaimERC1155(asset).balanceOf(address(this),ids[i]);beforeSender[i]=IReclaimERC1155(asset).balanceOf(msg.sender,ids[i]);}
            receiving=ReceiptContext(asset,msg.sender,keccak256(abi.encode(ids,quantities)),keccak256(data),0,2,false);
            IReclaimERC1155(asset).safeBatchTransferFrom(msg.sender,address(this),ids,quantities,data);
            if(!receiving.received)revert UnsupportedAssetBehavior();delete receiving;
            for(uint256 i;i<ids.length;i++)if(IReclaimERC1155(asset).balanceOf(address(this),ids[i])!=beforeVault[i]+quantities[i]
                ||IReclaimERC1155(asset).balanceOf(msg.sender,ids[i])+quantities[i]!=beforeSender[i])revert UnsupportedAssetBehavior();
        }
    }
    function returnTradeIn(uint64 receiptId,uint48 deadline) external nonReentrant {
        TradeIn storage t=tradeIns[receiptId];if(t.state!=1||t.claimant!=msg.sender||deadline<block.timestamp||deadline>block.timestamp+5 minutes)revert Unauthorized();
        _sync();_collection(t.collection,receiptCollectionHash[receiptId],t.standard);t.state=2;reserve+=t.reward;repaid+=t.reward;_pull(msg.sender,t.reward);
        uint256[] memory ids=itemIds[receiptId];uint256[] memory amounts=itemQuantities[receiptId];
        if(t.standard==1){for(uint256 i;i<ids.length;i++){if(IReclaimERC721(t.collection).ownerOf(ids[i])!=address(this))revert UnsupportedAssetBehavior();
            IReclaimERC721(t.collection).safeTransferFrom(address(this),msg.sender,ids[i],abi.encode(receiptId));if(IReclaimERC721(t.collection).ownerOf(ids[i])!=msg.sender)revert UnsupportedAssetBehavior();}}
        else{
            uint256[] memory beforeVault=new uint256[](ids.length);uint256[] memory beforeReceiver=new uint256[](ids.length);
            for(uint256 i;i<ids.length;i++){beforeVault[i]=IReclaimERC1155(t.collection).balanceOf(address(this),ids[i]);beforeReceiver[i]=IReclaimERC1155(t.collection).balanceOf(msg.sender,ids[i]);}
            IReclaimERC1155(t.collection).safeBatchTransferFrom(address(this),msg.sender,ids,amounts,abi.encode(receiptId));
            for(uint256 i;i<ids.length;i++)if(IReclaimERC1155(t.collection).balanceOf(address(this),ids[i])+amounts[i]!=beforeVault[i]
                ||IReclaimERC1155(t.collection).balanceOf(msg.sender,ids[i])!=beforeReceiver[i]+amounts[i])revert UnsupportedAssetBehavior();
        }
        emit TradeInReturned(receiptId,msg.sender,t.reward);
    }
    function onERC721Received(address operator,address from,uint256 id,bytes calldata data) external returns(bytes4) {
        ReceiptContext storage r=receiving;
        if(entered!=2||r.standard!=1||r.received||msg.sender!=r.collection||operator!=address(this)||from!=r.from||id!=r.id||keccak256(data)!=r.dataHash)revert UnexpectedNFT();
        r.received=true;return 0x150b7a02;
    }
    function onERC1155Received(address,address,uint256,uint256,bytes calldata) external pure returns(bytes4){revert UnexpectedNFT();}
    function onERC1155BatchReceived(address operator,address from,uint256[] calldata ids,uint256[] calldata amounts,bytes calldata data) external returns(bytes4){
        ReceiptContext storage r=receiving;
        if(entered!=2||r.standard!=2||r.received||msg.sender!=r.collection||operator!=address(this)||from!=r.from||keccak256(abi.encode(ids,amounts))!=r.itemsHash||keccak256(data)!=r.dataHash)revert UnexpectedNFT();
        r.received=true;return 0xbc197c81;
    }
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0x150b7a02||id==0x4e2312e0;}
}
