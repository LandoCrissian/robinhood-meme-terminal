import {seaportAdvancedOrderTuple,seaportOrderComponentsTuple,seaportSignatures} from "./seaport-order-verifier.mjs";
export const seaportVaultProfile="rmt-seaport-acquisition-local-v2";
export const seaportVaultFlag="local-reviewed-seaport-acquisition-v2";
export const seaportVaultRequestTuple="(bytes32 signedOrderHash,uint256 counter,uint64 policyEpoch,uint64 controllerEpoch,uint48 deadline)";
export const seaportVaultSignatures=[
 `function purchase(${seaportAdvancedOrderTuple} advancedOrder,${seaportVaultRequestTuple} request)`,
 "function configurePolicy((address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds) policy,bool enabled)",
 "function disablePurchases()","function fundNative(bytes32 source) payable",
 "function controller() view returns(address)","function controllerEpoch() view returns(uint64)","function policyEpoch() view returns(uint64)",
 "function purchasesEnabled() view returns(bool)","function productionExecutionAvailable() view returns(bool)","function deploymentChainId() view returns(uint256)",
 "function creator() view returns(address)","function projectToken() view returns(address)","function coreFactory() view returns(address)","function coreFactoryHash() view returns(bytes32)",
 "function seaport() view returns(address)","function seaportHash() view returns(bytes32)","function paymentToken() view returns(address)","function paymentTokenHash() view returns(bytes32)",
 "function checks() view returns(address)","function checksHash() view returns(bytes32)",
 "function policy() view returns(address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds)",
 "function available(address) view returns(uint256)","function nftHeld(address,uint256) view returns(uint256)","function orderConsumed(bytes32) view returns(bool)",
 "function collections(address) view returns(bytes32 runtimeHash,uint8 standard,bool enabled,bool anyTokenId)","function allowedTokenId(address,uint256) view returns(bool)",
 "event PurchaseExecuted(bytes32 indexed orderHash,address indexed seller,address indexed collection,uint256 tokenId,uint256 quantity,address currency,uint256 totalCost,bytes32 considerationHash,uint256 counter,uint64 controllerEpoch,uint64 policyEpoch)",
 "event FundingReceived(address indexed currency,address indexed sender,uint256 amount,bytes32 source)",
];
export const seaportVaultSeaportSignatures=[...seaportSignatures,
 "event OrderFulfilled(bytes32 orderHash,address indexed offerer,address indexed zone,address recipient,(uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer,(uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)",
];
export const seaportVaultNftSignatures=["function ownerOf(uint256) view returns(address)","function balanceOf(address,uint256) view returns(uint256)","function transferFrom(address,address,uint256)","function safeTransferFrom(address,address,uint256,uint256,bytes)","event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)","event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)"];
export {seaportOrderComponentsTuple};
