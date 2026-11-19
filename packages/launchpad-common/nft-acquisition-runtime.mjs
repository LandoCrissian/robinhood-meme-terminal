export const nftAcquisitionProfile = "rmt-nft-acquisition-local-v1";
export const nftAcquisitionVenueDomainName = "RMT Synthetic NFT Listing Venue";
export const nftAcquisitionOrder = "(address seller,address vault,address collection,uint8 standard,uint256 tokenId,uint256 quantity,address currency,uint256 sellerAmount,address feeRecipient,uint256 feeAmount,address royaltyRecipient,uint256 royaltyAmount,uint48 startTime,uint48 endTime,uint64 sellerNonce,bytes32 salt)";
export const nftAcquisitionPolicy = "(address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds)";
export const nftAcquisitionFactorySignatures = [
  "function coreFactory() view returns(address)", "function coreFactoryHash() view returns(bytes32)",
  "function tokenRuntimeHash() view returns(bytes32)", "function venue() view returns(address)", "function venueHash() view returns(bytes32)",
  "function paymentToken() view returns(address)", "function paymentTokenHash() view returns(bytes32)", "function vaultDeployer() view returns(address)",
  "function deploymentChainId() view returns(uint256)", "function vaultForIntent(address,bytes32) view returns(address)",
  "function creationPart1() view returns(address)", "function creationPart2() view returns(address)", "function vaultCreationCodeHash() view returns(bytes32)",
  "function create(address projectToken,address controller,bytes32 intent) returns(address)",
  "function predict(address creator,address projectToken,address controller,bytes32 intent) view returns(address)",
  "event VaultCreated(address indexed creator,address indexed projectToken,address indexed vault,address controller,bytes32 intent)",
];
export const nftAcquisitionVaultSignatures = [
  "function creator() view returns(address)", "function projectToken() view returns(address)", "function controller() view returns(address)",
  "function originCurve() view returns(address)",
  "function controllerEpoch() view returns(uint64)", "function policyEpoch() view returns(uint64)", "function intentId() view returns(bytes32)",
  "function deploymentFactory() view returns(address)", "function coreFactory() view returns(address)", "function coreFactoryHash() view returns(bytes32)",
  "function tokenRuntimeHash() view returns(bytes32)", "function venue() view returns(address)", "function venueHash() view returns(bytes32)",
  "function paymentToken() view returns(address)", "function paymentTokenHash() view returns(bytes32)", "function deploymentChainId() view returns(uint256)",
  "function periodSeconds() view returns(uint32)", "function purchasesEnabled() view returns(bool)", "function productionExecutionAvailable() pure returns(bool)",
  "function policy() view returns(address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds)",
  "function collections(address) view returns(bytes32 runtimeHash,uint8 standard,bool enabled,bool anyTokenId)",
  "function collectionIds(address) view returns(uint256[])", "function allowedTokenId(address,uint256) view returns(bool)",
  "function accountedHeld(address) view returns(uint256)", "function reservedAsset(address) view returns(uint256)",
  "function funded(address) view returns(uint256)", "function withdrawn(address) view returns(uint256)", "function available(address) view returns(uint256)",
  "function totalSpent(address) view returns(uint256)", "function periodSpent(address,uint256) view returns(uint256)", "function lastPurchaseAt() view returns(uint48)",
  "function nftHeld(address,uint256) view returns(uint256)", "function nftReserved(address,uint256) view returns(uint256)",
  "function orderConsumed(bytes32) view returns(bool)", "function pendingController() view returns(address next,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "function withdrawalNonce() view returns(uint64)", "function pendingWithdrawals() view returns(uint256)",
  "function withdrawals(uint64) view returns(uint8 kind,address asset,uint256 tokenId,uint256 quantity,address recipient,uint48 validAfter,uint48 expiresAt,uint64 epoch,uint8 state)",
  "function fundNative(bytes32 source) payable", "function fundToken(uint256 amount,bytes32 source)",
  `function configurePolicy(${nftAcquisitionPolicy} next,bool enabled)`,
  "function configureCollection(address collection,uint8 standard,bytes32 runtimeHash,bool enabled,bool anyTokenId,uint256[] ids)",
  "function disablePurchases()", `function purchase(${nftAcquisitionOrder} order,bytes signature,uint64 expectedPolicyEpoch,uint64 expectedControllerEpoch,uint48 deadline)`,
  "function scheduleAssetWithdrawal(address currency,uint256 amount,address recipient,uint48 expiresAt) returns(uint64)",
  "function scheduleNftWithdrawal(address collection,uint256 tokenId,uint256 quantity,address recipient,uint48 expiresAt) returns(uint64)",
  "function executeWithdrawal(uint64 id)", "function cancelWithdrawal(uint64 id)",
  "function proposeController(address next,uint48 expiresAt)", "function acceptController()", "function cancelController()",
  "event FundingReceived(address indexed currency,address indexed sender,uint256 amount,bytes32 source)",
  "event CollectionConfigured(address indexed collection,bytes32 runtimeHash,uint8 standard,bool enabled,bool anyTokenId,uint256[] ids,uint64 policyEpoch)",
  "event PurchasePolicyChanged(uint64 indexed policyEpoch,uint64 controllerEpoch,bool enabled,address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds)",
  "event PurchaseExecuted(bytes32 indexed orderHash,address indexed seller,address indexed collection,uint256 tokenId,uint256 quantity,address currency,uint256 totalCost,uint256 sellerAmount,address feeRecipient,uint256 feeAmount,address royaltyRecipient,uint256 royaltyAmount,uint64 controllerEpoch,uint64 policyEpoch)",
  "event WithdrawalScheduled(uint64 indexed id,uint8 kind,address indexed asset,uint256 tokenId,uint256 quantity,address indexed recipient,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "event WithdrawalExecuted(uint64 indexed id,uint8 kind,address indexed asset,uint256 tokenId,uint256 quantity,address indexed recipient)",
  "event WithdrawalCancelled(uint64 indexed id)", "event ControllerProposed(address indexed next,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "event ControllerChanged(address indexed previous,address indexed next,uint64 epoch)", "event ControllerCancelled(address indexed next,uint64 epoch)",
];
export const nftAcquisitionVenueSignatures = [
  "function deploymentChainId() view returns(uint256)", "function feeRecipient() view returns(address)", "function feeBps() view returns(uint16)",
  "function sellerNonces(address) view returns(uint64)", "function orderState(bytes32) view returns(uint8)",
  `function orderHash(${nftAcquisitionOrder} order) view returns(bytes32)`, `function fill(${nftAcquisitionOrder} order,bytes signature) payable`,
  `function cancel(${nftAcquisitionOrder} order)`, "function bumpNonce()",
  "event OrderFilled(bytes32 indexed orderHash,address indexed vault,address indexed seller,address collection,uint256 tokenId,uint256 quantity,address currency,uint256 totalCost)",
  "event OrderCancelled(bytes32 indexed orderHash,address indexed seller)", "event SellerNonceChanged(address indexed seller,uint64 nonce)",
];
export const nftAcquisitionOrderTypes = { Order: [
  ["seller","address"],["vault","address"],["collection","address"],["standard","uint8"],["tokenId","uint256"],["quantity","uint256"],
  ["currency","address"],["sellerAmount","uint256"],["feeRecipient","address"],["feeAmount","uint256"],["royaltyRecipient","address"],["royaltyAmount","uint256"],
  ["startTime","uint48"],["endTime","uint48"],["sellerNonce","uint64"],["salt","bytes32"],
].map(([name,type])=>({name,type})) };
export function materializeNftAcquisitionRuntime(template,references,names,values){
  if(!/^0x(?:[0-9a-f]{2})+$/i.test(template)||!references||!names||!values)throw Error("Invalid acquisition runtime template");
  let code=template.slice(2);const used=new Set();
  for(const[id,offsets]of Object.entries(references)){
    const name=names[id];if(!name||!Object.hasOwn(values,name)||!Array.isArray(offsets)||offsets.length===0)throw Error("Missing acquisition immutable "+name);
    const value=values[name];let word;
    if(typeof value==="string"&&/^0x[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value))word=value.slice(2).padStart(64,"0");
    else if(typeof value==="number"||typeof value==="bigint"||typeof value==="string"&&/^[0-9]+$/.test(value)){const n=BigInt(value);if(n<0n||n>=1n<<256n)throw Error("Immutable integer bounds");word=n.toString(16).padStart(64,"0");}
    else throw Error("Unsupported acquisition immutable "+name);
    for(const offset of offsets){if(offset.length!==32||offset.start<0||(offset.start+32)*2>code.length||used.has(offset.start))throw Error("Invalid acquisition immutable offset");used.add(offset.start);code=code.slice(0,offset.start*2)+word+code.slice((offset.start+32)*2);}
  }
  return"0x"+code;
}
