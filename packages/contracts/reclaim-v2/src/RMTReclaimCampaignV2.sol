// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IReclaimV2ERC20,IReclaimV2ERC165,IReclaimV2ERC721,IReclaimV2ERC1155,IReclaimV2Factory,ReclaimV2Eligibility} from "./ReclaimV2Interfaces.sol";

/// @notice Manually funded permanent NFT surrender for fixed-token-unit rewards.
/// @dev Native burns and immutable sink transfers are distinct. Collection
/// source/runtime policy must establish irreversibility; unknown profiles reject.
/// No NFT return, repayment, withdrawal, upgrade or arbitrary execution exists.
contract RMTReclaimCampaignV2 {
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
    address public immutable permanentSink;
    bytes32 public immutable sinkRuntimeHash;
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
    uint256 public recovered;
    uint256 public unsolicited;
    uint64 public tradeInNonce;
    uint32 public eligibleCollections;
    uint256 private entered=1;

    struct Collection { bytes32 runtimeHash; bytes32 eligibilityRoot; uint32 collectionCap; uint32 walletCap; uint8 standard; uint8 retirementMode; bytes32 policyHash; bool enabled; }
    struct CollectionNotice { address collection; bytes32 runtimeHash; bytes32 eligibilityRoot; uint32 collectionCap; uint32 walletCap; uint8 standard; uint8 retirementMode; bytes32 policyHash; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct ValueNotice { uint256 value; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct ControllerNotice { address next; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct TradeIn { address claimant; address collection; uint8 standard; uint64 policyEpoch; uint256 reward; uint32 units; uint8 state; uint8 retirementMode; address destination; }
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

    error Unauthorized();error ReentrantCall();error InvalidConfiguration();error InvalidAsset();
    error InvalidEligibility();error InvalidAmount();error InvalidQuote();error NotAvailable();error NoticeUnavailable();
    error TransferFailed();error UnsupportedAssetBehavior();error UnsupportedUsdReference();error UnexpectedNFT();
    event Funded(address indexed controller,uint256 amount);
    event SurplusReconciled(uint256 amount);
    event ReserveRecovered(address indexed controller,uint256 amount);
    event CollectionScheduled(address indexed collection,bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint8 retirementMode,bytes32 policyHash,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch);
    event CollectionConfigured(address indexed collection,bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint8 retirementMode,bytes32 policyHash,uint64 policyEpoch);
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
    event TradeInAccepted(uint64 indexed receiptId,address indexed claimant,address indexed collection,uint8 standard,uint256[] ids,uint256[] quantities,uint256 reward,uint64 policyEpoch,uint64 claimantNonce,uint8 retirementMode,address destination);
    event NFTPermanentlyRetired(uint64 indexed receiptId,address indexed collection,uint8 standard,uint8 retirementMode,address destination,uint256[] ids,uint256[] quantities,uint256[] supplyBefore,uint256[] supplyAfter);
    modifier nonReentrant(){if(entered!=1)revert ReentrantCall();_token();entered=2;_;entered=1;}
    modifier onlyController(){if(msg.sender!=controller)revert Unauthorized();_;}

    constructor(address creator_,address controller_,address token_,bytes32 tokenHash_,uint128 rate_,uint32 cap_,address factory_,address sink_) {
        if((block.chainid!=31337&&block.chainid!=4663)||creator_==address(0)||controller_==address(0)||controller_==address(this)||controller_==token_||rate_==0||cap_==0
            ||token_==address(0)||tokenHash_==bytes32(0)||token_.code.length==0||token_.codehash!=tokenHash_
            ||IReclaimV2ERC20(token_).decimals()!=18||IReclaimV2ERC20(token_).totalSupply()!=SUPPLY)revert InvalidConfiguration();
        if(factory_.code.length==0||IReclaimV2Factory(factory_).campaignDeployer()!=msg.sender||sink_.code.length==0
            ||IReclaimV2Factory(factory_).permanentSink()!=sink_||IReclaimV2Factory(factory_).sinkRuntimeHash()!=sink_.codehash)revert InvalidConfiguration();
        creator=creator_;controller=controller_;rewardToken=token_;rewardRuntimeHash=tokenHash_;
        permanentSink=sink_;sinkRuntimeHash=sink_.codehash;
        deploymentChainId=block.chainid;deploymentFactory=factory_;rewardPerUnit=rate_;walletCap=cap_;
    }
    function _token() private view {if(block.chainid!=deploymentChainId||rewardToken.codehash!=rewardRuntimeHash)revert InvalidAsset();}
    function _sync() private {
        _token();uint256 actual=IReclaimV2ERC20(rewardToken).balanceOf(address(this));if(actual<reserve)revert UnsupportedAssetBehavior();
        uint256 delta=actual-reserve;if(delta!=0){reserve+=delta;unsolicited+=delta;emit SurplusReconciled(delta);}
    }
    function reconcileSurplus() external nonReentrant {_sync();}
    function _pull(address from,uint256 amount) private {
        _token();uint256 a=IReclaimV2ERC20(rewardToken).balanceOf(address(this));uint256 b=IReclaimV2ERC20(rewardToken).balanceOf(from);
        if(!IReclaimV2ERC20(rewardToken).transferFrom(from,address(this),amount))revert TransferFailed();
        if(IReclaimV2ERC20(rewardToken).balanceOf(address(this))!=a+amount||IReclaimV2ERC20(rewardToken).balanceOf(from)+amount!=b)revert UnsupportedAssetBehavior();
    }
    function _pay(address to,uint256 amount) private {
        _token();uint256 a=IReclaimV2ERC20(rewardToken).balanceOf(address(this));uint256 b=IReclaimV2ERC20(rewardToken).balanceOf(to);
        if(!IReclaimV2ERC20(rewardToken).transfer(to,amount))revert TransferFailed();
        if(IReclaimV2ERC20(rewardToken).balanceOf(address(this))+amount!=a||IReclaimV2ERC20(rewardToken).balanceOf(to)!=b+amount)revert UnsupportedAssetBehavior();
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
    function _collection(address asset,bytes32 hash,uint8 standard,uint8 mode,bytes32 policyHash) private view {
        if(asset==address(0)||asset==rewardToken||asset==address(this)||asset.code.length==0||asset.codehash!=hash
            ||(standard!=1&&standard!=2)||(mode!=1&&mode!=2)||policyHash==bytes32(0)
            ||IReclaimV2Factory(deploymentFactory).retirementPolicy(hash,standard,mode)!=policyHash
            ||permanentSink.codehash!=sinkRuntimeHash||!IReclaimV2ERC165(asset).supportsInterface(0x01ffc9a7)
            ||IReclaimV2ERC165(asset).supportsInterface(0xffffffff)
            ||!IReclaimV2ERC165(asset).supportsInterface(standard==1?bytes4(0x80ac58cd):bytes4(0xd9b67a26)))revert InvalidAsset();
    }
    function proposeCollection(address asset,uint8 standard,bytes32 hash,bytes32 root,uint32 cap,uint32 walletCap_,uint8 mode,bytes32 policyHash,uint48 expiresAt) external onlyController nonReentrant {
        if(closed||pendingCollection.collection!=address(0)||root==bytes32(0)||cap==0||walletCap_==0||walletCap_>cap||cap<collectionClaimed[asset])revert InvalidConfiguration();
        _collection(asset,hash,standard,mode,policyHash);uint48 after_=_notice(expiresAt);
        pendingCollection=CollectionNotice(asset,hash,root,cap,walletCap_,standard,mode,policyHash,after_,expiresAt,controllerEpoch);
        emit CollectionScheduled(asset,hash,root,cap,walletCap_,standard,mode,policyHash,after_,expiresAt,controllerEpoch);
    }
    function executeCollection() external nonReentrant {
        CollectionNotice memory n=pendingCollection;_mature(n.validAfter,n.expiresAt,n.epoch);if(closed)revert NotAvailable();
        _collection(n.collection,n.runtimeHash,n.standard,n.retirementMode,n.policyHash);if(n.collectionCap<collectionClaimed[n.collection])revert InvalidConfiguration();delete pendingCollection;
        if(!collections[n.collection].enabled)eligibleCollections++;
        collections[n.collection]=Collection(n.runtimeHash,n.eligibilityRoot,n.collectionCap,n.walletCap,n.standard,n.retirementMode,n.policyHash,true);policyEpoch++;
        emit CollectionConfigured(n.collection,n.runtimeHash,n.eligibilityRoot,n.collectionCap,n.walletCap,n.standard,n.retirementMode,n.policyHash,policyEpoch);
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
        Collection memory c=collections[asset];return ReclaimV2Eligibility.leaf(deploymentChainId,address(this),asset,c.runtimeHash,c.standard,c.retirementMode,c.policyHash,id,maximum);
    }
    function receiptItems(uint64 id) external view returns(uint256[] memory ids,uint256[] memory quantities){return(itemIds[id],itemQuantities[id]);}
    function quote(address asset,uint256[] calldata ids,uint256[] calldata quantities,uint256[] calldata maximum,bytes32[][] calldata proofs,address claimant) public view returns(uint256 reward,uint32 units) {
        if(closed||paused||claimant==address(0)||ids.length==0||ids.length>MAX_ITEMS||ids.length!=quantities.length||ids.length!=maximum.length||ids.length!=proofs.length)revert NotAvailable();
        _token();Collection memory c=collections[asset];if(!c.enabled)revert InvalidEligibility();_collection(asset,c.runtimeHash,c.standard,c.retirementMode,c.policyHash);
        for(uint256 i;i<ids.length;i++){
            if((i!=0&&ids[i]<=ids[i-1])||quantities[i]==0||quantities[i]>MAX_UNITS||maximum[i]==0
                ||(c.standard==1&&(quantities[i]!=1||maximum[i]!=1))||claimedUnits[asset][ids[i]]+quantities[i]>maximum[i]
                ||!ReclaimV2Eligibility.verify(c.eligibilityRoot,eligibilityLeaf(asset,ids[i],maximum[i]),proofs[i]))revert InvalidEligibility();
            units+=uint32(quantities[i]);
        }
        if(units>MAX_UNITS||uint256(walletClaimed[claimant])+units>walletCap||uint256(collectionClaimed[asset])+units>c.collectionCap
            ||uint256(collectionWalletClaimed[asset][claimant])+units>c.walletCap)revert InvalidEligibility();
        reward=uint256(rewardPerUnit)*units;if(reward==0||reward>reserve||IReclaimV2ERC20(rewardToken).balanceOf(address(this))<reserve)revert InvalidAmount();
    }
    function redeem(address asset,uint256[] calldata ids,uint256[] calldata quantities,uint256[] calldata maximum,bytes32[][] calldata proofs,
        uint64 expectedPolicyEpoch,uint256 expectedReward,uint64 nonce,uint48 deadline) external nonReentrant returns(uint64 receiptId) {
        if(deadline<block.timestamp||deadline>block.timestamp+5 minutes||expectedPolicyEpoch!=policyEpoch||nonce!=claimantNonces[msg.sender])revert InvalidQuote();
        _sync();(uint256 reward,uint32 units)=quote(asset,ids,quantities,maximum,proofs,msg.sender);if(reward!=expectedReward)revert InvalidQuote();
        uint8 standard=collections[asset].standard;receiptId=++tradeInNonce;claimantNonces[msg.sender]++;
        walletClaimed[msg.sender]+=units;collectionClaimed[asset]+=units;collectionWalletClaimed[asset][msg.sender]+=units;
        for(uint256 i;i<ids.length;i++)claimedUnits[asset][ids[i]]+=quantities[i];
        tradeIns[receiptId]=TradeIn(msg.sender,asset,standard,policyEpoch,reward,units,1,collections[asset].retirementMode,collections[asset].retirementMode==1?address(0):permanentSink);receiptCollectionHash[receiptId]=collections[asset].runtimeHash;itemIds[receiptId]=ids;itemQuantities[receiptId]=quantities;
        reserve-=reward;paid+=reward;
        _retireNFT(asset,standard,collections[asset].retirementMode,ids,quantities,receiptId);_pay(msg.sender,reward);
        emit TradeInAccepted(receiptId,msg.sender,asset,standard,ids,quantities,reward,policyEpoch,nonce,collections[asset].retirementMode,collections[asset].retirementMode==1?address(0):permanentSink);
    }
    function _retireNFT(address asset,uint8 standard,uint8 mode,uint256[] calldata ids,uint256[] calldata quantities,uint64 receiptId) private {
        uint256[] memory beforeSupply=new uint256[](ids.length);uint256[] memory afterSupply=new uint256[](ids.length);
        if(standard==1){
            for(uint256 i;i<ids.length;i++){
                if(mode==1)(beforeSupply[i],afterSupply[i])=_burn721(asset,ids[i]);
                else(beforeSupply[i],afterSupply[i])=_sink721(asset,ids[i],receiptId);
            }
        }else{
            uint256[] memory beforeActor=new uint256[](ids.length);uint256[] memory beforeSink=new uint256[](ids.length);
            for(uint256 i;i<ids.length;i++){
                beforeActor[i]=IReclaimV2ERC1155(asset).balanceOf(msg.sender,ids[i]);beforeSupply[i]=IReclaimV2ERC1155(asset).totalSupply(ids[i]);
                if(mode==2)beforeSink[i]=IReclaimV2ERC1155(asset).balanceOf(permanentSink,ids[i]);
            }
            if(mode==1){for(uint256 i;i<ids.length;i++)IReclaimV2ERC1155(asset).burn(msg.sender,ids[i],quantities[i]);}
            else IReclaimV2ERC1155(asset).safeBatchTransferFrom(msg.sender,permanentSink,ids,quantities,abi.encode(receiptId));
            for(uint256 i;i<ids.length;i++){
                afterSupply[i]=IReclaimV2ERC1155(asset).totalSupply(ids[i]);
                if(IReclaimV2ERC1155(asset).balanceOf(msg.sender,ids[i])+quantities[i]!=beforeActor[i]
                    ||(mode==1?afterSupply[i]+quantities[i]!=beforeSupply[i]:afterSupply[i]!=beforeSupply[i])
                    ||(mode==2&&IReclaimV2ERC1155(asset).balanceOf(permanentSink,ids[i])!=beforeSink[i]+quantities[i]))revert UnsupportedAssetBehavior();
            }
        }
        if(asset.codehash!=collections[asset].runtimeHash||permanentSink.codehash!=sinkRuntimeHash)revert InvalidAsset();
        emit NFTPermanentlyRetired(receiptId,asset,standard,mode,mode==1?address(0):permanentSink,ids,quantities,beforeSupply,afterSupply);
    }
    function _burn721(address asset,uint256 id) private returns(uint256 beforeSupply,uint256 afterSupply){
        if(IReclaimV2ERC721(asset).ownerOf(id)!=msg.sender)revert Unauthorized();
        uint256 fromBalance=IReclaimV2ERC721(asset).balanceOf(msg.sender);beforeSupply=IReclaimV2ERC721(asset).totalSupply();
        IReclaimV2ERC721(asset).burn(id);
        (bool exists,)=asset.staticcall(abi.encodeCall(IReclaimV2ERC721.ownerOf,(id)));
        if(exists||IReclaimV2ERC721(asset).exists(id))revert UnsupportedAssetBehavior();
        afterSupply=IReclaimV2ERC721(asset).totalSupply();
        if(IReclaimV2ERC721(asset).balanceOf(msg.sender)+1!=fromBalance||afterSupply+1!=beforeSupply)revert UnsupportedAssetBehavior();
    }
    function _sink721(address asset,uint256 id,uint64 receiptId) private returns(uint256 beforeSupply,uint256 afterSupply){
        if(IReclaimV2ERC721(asset).ownerOf(id)!=msg.sender)revert Unauthorized();
        uint256 fromBalance=IReclaimV2ERC721(asset).balanceOf(msg.sender);uint256 sinkBalance=IReclaimV2ERC721(asset).balanceOf(permanentSink);beforeSupply=IReclaimV2ERC721(asset).totalSupply();
        IReclaimV2ERC721(asset).safeTransferFrom(msg.sender,permanentSink,id,abi.encode(receiptId));
        afterSupply=IReclaimV2ERC721(asset).totalSupply();
        if(IReclaimV2ERC721(asset).ownerOf(id)!=permanentSink||IReclaimV2ERC721(asset).balanceOf(permanentSink)!=sinkBalance+1
            ||IReclaimV2ERC721(asset).balanceOf(msg.sender)+1!=fromBalance||afterSupply!=beforeSupply)revert UnsupportedAssetBehavior();
    }
    // The campaign never takes reversible custody. Unsolicited safe receipts
    // reject; a forced unsafe transfer is stranded and earns no reward.
    function onERC721Received(address,address,uint256,bytes calldata) external pure returns(bytes4){revert UnexpectedNFT();}
    function onERC1155Received(address,address,uint256,uint256,bytes calldata) external pure returns(bytes4){revert UnexpectedNFT();}
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external pure returns(bytes4){revert UnexpectedNFT();}
}
