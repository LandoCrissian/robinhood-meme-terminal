const address=value=>typeof value==="string"&&/^0x[0-9a-f]{40}$/i.test(value)&&BigInt(value)>0xffffn;
const hash=value=>typeof value==="string"&&/^0x[0-9a-f]{64}$/i.test(value)&&BigInt(value)>0n;

/** Source-bound constructor materialization. This function does not discover,
 * deploy, authorize, fetch metadata, or declare any NFT collection trustworthy. */
export function materializeReclaimRuntime(template,references,names,fields){
  if(typeof template!=="string"||!/^0x(?:[0-9a-f]{2}){1,24576}$/i.test(template)
    ||!references||typeof references!=="object"||Array.isArray(references)||!names||typeof names!=="object"||Array.isArray(names)
    ||!fields||!address(fields.creator)||!address(fields.rewardToken)||!address(fields.deploymentFactory)||!hash(fields.rewardRuntimeHash)
    ||!address(fields.permanentSink)||!hash(fields.sinkRuntimeHash)
    ||![31337,4663].includes(fields.deploymentChainId)||Object.keys(fields).length!==7)throw Error("Permanent Reclaim runtime inputs unavailable");
  const values={creator:BigInt(fields.creator),rewardToken:BigInt(fields.rewardToken),rewardRuntimeHash:BigInt(fields.rewardRuntimeHash),
    deploymentChainId:BigInt(fields.deploymentChainId),deploymentFactory:BigInt(fields.deploymentFactory),permanentSink:BigInt(fields.permanentSink),sinkRuntimeHash:BigInt(fields.sinkRuntimeHash)};
  const entries=Object.entries(references),spans=[],seen=new Set();
  if(entries.length!==7||new Set(entries.map(([id])=>names[id])).size!==7)throw Error("Permanent Reclaim immutable coverage changed");
  for(const[id,offsets]of entries){
    if(!/^\d+$/.test(id)||!Object.hasOwn(values,names[id])||!Array.isArray(offsets)||offsets.length<1||offsets.length>64)throw Error("Reclaim immutable layout unavailable");
    for(const offset of offsets){
      if(!offset||!Number.isSafeInteger(offset.start)||offset.start<0||offset.length!==32||2*(offset.start+32)>template.length-2)throw Error("Reclaim immutable offset invalid");
      for(let i=offset.start;i<offset.start+32;i++){if(seen.has(i))throw Error("Reclaim immutable overlap");seen.add(i);}
      spans.push({start:offset.start*2,word:values[names[id]].toString(16).padStart(64,"0")});
    }
  }
  let code=template.slice(2).toLowerCase();for(const{start,word}of spans.sort((a,b)=>b.start-a.start))code=code.slice(0,start)+word+code.slice(start+64);
  return"0x"+code;
}

/** Finite allowlist proofs, never eligibility discovery. Cryptographic codecs
 * come from the caller's already-pinned viem dependency; no new package/network
 * or Node-only import enters the shared browser-compatible module. */
export function buildReclaimEligibility(fields,codecs){
  if(!fields||![31337,4663].includes(fields.chainId)||!address(fields.campaign)||!address(fields.collection)||!hash(fields.runtimeHash)
    ||![1,2].includes(fields.standard)||![1,2].includes(fields.retirementMode)||!hash(fields.policyHash)||!Array.isArray(fields.items)||fields.items.length<1||fields.items.length>256
    ||typeof codecs?.keccak256!=="function"||typeof codecs?.encodeAbiParameters!=="function")throw Error("Reclaim eligibility inputs invalid");
  const integer=v=>{if(typeof v!=="string"||! /^(0|[1-9][0-9]{0,77})$/.test(v)||BigInt(v)>=1n<<256n)throw Error("Reclaim eligibility integer invalid");return BigInt(v);};
  const items=fields.items.map(item=>{const id=integer(item?.tokenId),max=integer(item?.maxQuantity);
    if(max===0n||fields.standard===1&&max!==1n)throw Error("Reclaim eligibility quantity invalid");
    return{tokenId:id.toString(),maxQuantity:max.toString()};}).sort((a,b)=>BigInt(a.tokenId)<BigInt(b.tokenId)?-1:BigInt(a.tokenId)>BigInt(b.tokenId)?1:0);
  if(new Set(items.map(item=>item.tokenId)).size!==items.length)throw Error("Reclaim eligibility duplicate token ID");
  const leaves=items.map(item=>codecs.keccak256(codecs.encodeAbiParameters([
    {type:"uint256"},{type:"address"},{type:"address"},{type:"bytes32"},{type:"uint8"},{type:"uint8"},{type:"bytes32"},{type:"uint256"},{type:"uint256"}],
    [BigInt(fields.chainId),fields.campaign,fields.collection,fields.runtimeHash,fields.standard,fields.retirementMode,fields.policyHash,BigInt(item.tokenId),BigInt(item.maxQuantity)])));
  if(!leaves.every(hash))throw Error("Reclaim eligibility leaf encoding invalid");
  const pair=(a,b)=>codecs.keccak256("0x"+(BigInt(a)<BigInt(b)?a.slice(2)+b.slice(2):b.slice(2)+a.slice(2)));
  const levels=[leaves];while(levels.at(-1).length>1){const old=levels.at(-1),next=[];for(let i=0;i<old.length;i+=2)next.push(i+1<old.length?pair(old[i],old[i+1]):old[i]);levels.push(next);}
  return{root:levels.at(-1)[0],items:items.map((item,leafIndex)=>{const proof=[];let index=leafIndex;
    for(let layer=0;layer<levels.length-1;layer++){const sibling=index^1;if(sibling<levels[layer].length)proof.push(levels[layer][sibling]);index=Math.floor(index/2);}
    if(proof.length>32)throw Error("Reclaim eligibility proof bound exceeded");return{...item,proof};})};
}

export const reclaimFactorySignatures=[
  "error InvalidConfiguration()",
  "function rewardToken() view returns(address)","function rewardRuntimeHash() view returns(bytes32)","function deploymentChainId() view returns(uint256)",
  "function campaignCreationCodeHash() view returns(bytes32)","function campaignForIntent(address creator,bytes32 intent) view returns(address)",
  "function campaignDeployer() view returns(address)","function permanentSink() view returns(address)","function sinkRuntimeHash() view returns(bytes32)",
  "function creationPart1() view returns(address)","function creationPart2() view returns(address)",
  "function retirementProfilesHash() view returns(bytes32)","function retirementPolicy(bytes32 runtimeHash,uint8 standard,uint8 mode) view returns(bytes32)",
  "function saltFor(address creator,bytes32 intent) view returns(bytes32)",
  "function predict(address creator,bytes32 intent,address controller,uint128 rate,uint32 cap) view returns(address)",
  "function create(bytes32 intent,address controller,uint128 rate,uint32 cap) returns(address)",
  "event CampaignCreated(address indexed creator,address indexed campaign,bytes32 indexed intent,address controller,uint128 rewardPerUnit,uint32 walletCap)",
  "event RetirementProfileCommitted(bytes32 indexed runtimeHash,uint8 standard,uint8 mode,bytes32 policyHash)",
];
export const reclaimCampaignSignatures=[
  "error Unauthorized()","error ReentrantCall()","error InvalidConfiguration()","error InvalidAsset()","error InvalidEligibility()","error InvalidAmount()",
  "error InvalidQuote()","error NotAvailable()","error NoticeUnavailable()","error TransferFailed()","error UnsupportedAssetBehavior()","error UnsupportedUsdReference()","error UnexpectedNFT()",
  "function creator() view returns(address)","function controller() view returns(address)","function deploymentFactory() view returns(address)",
  "function deploymentChainId() view returns(uint256)","function rewardToken() view returns(address)","function rewardRuntimeHash() view returns(bytes32)",
  "function permanentSink() view returns(address)","function sinkRuntimeHash() view returns(bytes32)",
  "function controllerEpoch() view returns(uint64)","function policyEpoch() view returns(uint64)","function rewardPerUnit() view returns(uint128)",
  "function walletCap() view returns(uint32)","function paused() view returns(bool)","function closed() view returns(bool)",
  "function reserve() view returns(uint256)","function funded() view returns(uint256)","function paid() view returns(uint256)",
  "function recovered() view returns(uint256)","function unsolicited() view returns(uint256)",
  "function outstandingLiability() view returns(uint256)","function tradeInNonce() view returns(uint64)","function eligibleCollections() view returns(uint32)",
  "function claimantNonces(address claimant) view returns(uint64)","function walletClaimed(address claimant) view returns(uint32)",
  "function collectionClaimed(address collection) view returns(uint32)","function collectionWalletClaimed(address collection,address claimant) view returns(uint32)",
  "function claimedUnits(address collection,uint256 tokenId) view returns(uint256)",
  "function collections(address collection) view returns(bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint8 retirementMode,bytes32 policyHash,bool enabled)",
  "function tradeIns(uint64 receiptId) view returns(address claimant,address collection,uint8 standard,uint64 policyEpoch,uint256 reward,uint32 units,uint8 state,uint8 retirementMode,address destination)",
  "function receiptItems(uint64 receiptId) view returns(uint256[] ids,uint256[] quantities)","function receiptCollectionHash(uint64 receiptId) view returns(bytes32)",
  "function pendingCollection() view returns(address collection,bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint8 retirementMode,bytes32 policyHash,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "function pendingRate() view returns(uint256 value,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "function pendingClose() view returns(uint256 value,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "function pendingRecovery() view returns(uint256 value,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "function pendingController() view returns(address next,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "function fund(uint256 amount)","function reconcileSurplus()","function quoteUsd(uint256,uint256,uint48) pure returns(uint256)",
  "function pause()","function resume()","function proposeCollection(address asset,uint8 standard,bytes32 hash,bytes32 root,uint32 cap,uint32 walletCap,uint8 retirementMode,bytes32 policyHash,uint48 expiresAt)",
  "function executeCollection()","function cancelCollection()","function disableCollection(address asset)",
  "function proposeRate(uint128 rewardPerUnit,uint48 expiresAt)","function executeRate()","function cancelRate()",
  "function proposeClose(uint48 expiresAt)","function executeClose()","function cancelClose()",
  "function proposeRecovery(uint256 amount,uint48 expiresAt)","function executeRecovery()","function cancelRecovery()",
  "function proposeController(address next,uint48 expiresAt)","function acceptController()","function cancelController()",
  "function eligibilityLeaf(address asset,uint256 id,uint256 maximum) view returns(bytes32)",
  "function quote(address asset,uint256[] ids,uint256[] quantities,uint256[] maximum,bytes32[][] proofs,address claimant) view returns(uint256 reward,uint32 units)",
  "function redeem(address asset,uint256[] ids,uint256[] quantities,uint256[] maximum,bytes32[][] proofs,uint64 expectedPolicyEpoch,uint256 expectedReward,uint64 nonce,uint48 deadline) returns(uint64 receiptId)",
  "event Funded(address indexed controller,uint256 amount)","event SurplusReconciled(uint256 amount)","event ReserveRecovered(address indexed controller,uint256 amount)",
  "event CollectionScheduled(address indexed collection,bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint8 retirementMode,bytes32 policyHash,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch)",
  "event CollectionConfigured(address indexed collection,bytes32 runtimeHash,bytes32 eligibilityRoot,uint32 collectionCap,uint32 walletCap,uint8 standard,uint8 retirementMode,bytes32 policyHash,uint64 policyEpoch)",
  "event CollectionDisabled(address indexed collection,uint64 policyEpoch)","event RateScheduled(uint128 rewardPerUnit,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch)",
  "event RateChanged(uint128 rewardPerUnit,uint64 policyEpoch)","event CloseScheduled(uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch)",
  "event CampaignClosed(uint64 policyEpoch)","event RecoveryScheduled(uint256 amount,address indexed recipient,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch)",
  "event ControllerScheduled(address indexed previous,address indexed next,uint48 validAfter,uint48 expiresAt,uint64 controllerEpoch)",
  "event ControllerChanged(address indexed previous,address indexed next,uint64 controllerEpoch,uint64 policyEpoch)",
  "event NoticeCancelled(uint8 indexed kind)","event PauseChanged(bool paused,uint64 policyEpoch)",
  "event TradeInAccepted(uint64 indexed receiptId,address indexed claimant,address indexed collection,uint8 standard,uint256[] ids,uint256[] quantities,uint256 reward,uint64 policyEpoch,uint64 claimantNonce,uint8 retirementMode,address destination)",
  "event NFTPermanentlyRetired(uint64 indexed receiptId,address indexed collection,uint8 standard,uint8 retirementMode,address destination,uint256[] ids,uint256[] quantities,uint256[] supplyBefore,uint256[] supplyAfter)",
];
