import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { decodeFunctionData, encodeFunctionData, erc20Abi, hashTypedData, keccak256, parseAbi, parseEventLogs, recoverTypedDataAddress, zeroAddress,
  type Abi, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { nftAcquisitionFactorySignatures, nftAcquisitionVaultSignatures, nftAcquisitionVenueSignatures, nftAcquisitionOrderTypes } from "../../../packages/launchpad-common/nft-acquisition-runtime.mjs";
import { assertNftAcquisitionTrace } from "../../../packages/launchpad-common/nft-acquisition-proof.mjs";
import { assertNativeTransferProof } from "../../../packages/launchpad-common/native-proof.mjs";
import { assertFixtureTreasuryReceiptLog } from "./project-treasury-fixture-store.js";
import { reclaimCallerPins, verifyReclaimExactOrigin } from "./reclaim-fixture-origin.js";
import type { BlockEvidence, CurveFixtureBinding } from "./curve-launch-evidence.js";
import { nftAcquisitionProfile, type NftAcquisitionModule, type NftAcquisitionRange } from "./nft-acquisition-fixture-types.js";

const factoryAbi = parseAbi(nftAcquisitionFactorySignatures) as Abi, vaultAbi = parseAbi(nftAcquisitionVaultSignatures) as Abi, venueAbi = parseAbi(nftAcquisitionVenueSignatures) as Abi;
type Order = {seller:Address;vault:Address;collection:Address;standard:number;tokenId:bigint;quantity:bigint;currency:Address;sellerAmount:bigint;feeRecipient:Address;feeAmount:bigint;royaltyRecipient:Address;royaltyAmount:bigint;startTime:number;endTime:number;sellerNonce:bigint;salt:Hash};
const nftAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function balanceOf(address,uint256) view returns(uint256)",
  "function safeTransferFrom(address,address,uint256)", "function safeTransferFrom(address,address,uint256,uint256,bytes)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)"]);
const coreAbi = parseAbi(["function originCurveForToken(address) view returns(address)", "function creator() view returns(address)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (x: unknown): x is Address => typeof x === "string" && /^0x[0-9a-f]{40}$/i.test(x) && BigInt(x) > 0xffffn;
const hash = (x: unknown): x is Hash => typeof x === "string" && /^0x[0-9a-f]{64}$/i.test(x) && BigInt(x) > 0n;
export function requireNftAcquisitionEvidence(ok: unknown): asserts ok { if (!ok) throw Error("Fixture NFT acquisition evidence unavailable or conflicting"); }

export function configuredNftAcquisitionModule(env: NodeJS.ProcessEnv, binding: CurveFixtureBinding): NftAcquisitionModule | null {
  if (!env.RMT_NFT_ACQUISITION_FIXTURE && !env.RMT_NFT_ACQUISITION_DEPLOYMENT) return null;
  requireNftAcquisitionEvidence(env.RMT_NFT_ACQUISITION_FIXTURE === "local-reviewed-nft-acquisition-v1"
    && !env.NETLIFY && !env.VERCEL && !env.RAILWAY_ENVIRONMENT_ID && !env.DEPLOY_ID && !env.CONTEXT
    && env.RMT_NFT_ACQUISITION_DEPLOYMENT && isAbsolute(env.RMT_NFT_ACQUISITION_DEPLOYMENT));
  const path = env.RMT_NFT_ACQUISITION_DEPLOYMENT; requireNftAcquisitionEvidence(statSync(path).size <= 131072);
  const value = JSON.parse(readFileSync(path, "utf8")) as NftAcquisitionModule;
  requireNftAcquisitionEvidence(value.schemaVersion === 1 && value.profile === nftAcquisitionProfile && value.chainId === 31337
    && binding.chainId === 31337 && same(value.coreFactory, binding.factory) && same(value.coreFactoryRuntimeHash, binding.factoryRuntimeHash));
  for (const key of ["factory", "venue", "paymentToken", "projectToken", "creator", "vault"] as const) requireNftAcquisitionEvidence(address(value[key]));
  for (const key of ["factoryRuntimeHash", "venueRuntimeHash", "paymentTokenRuntimeHash", "vaultRuntimeHash"] as const) requireNftAcquisitionEvidence(hash(value[key]));
  requireNftAcquisitionEvidence(Array.isArray(value.collections) && value.collections.length >= 1 && value.collections.length <= 8
    && new Set(value.collections.map(c => c.address.toLowerCase())).size === value.collections.length
    && value.collections.every(c => address(c.address) && hash(c.runtimeHash) && [721, 1155].includes(c.standard)
      && /^0x[0-9a-f]{64}$/i.test(c.sourceInputSha256)) && /^[0-9a-f]{64}$/i.test(value.compilerInputSha256)
    && hash(value.deployment.transactionHash) && hash(value.deployment.blockHash) && /^\d+$/.test(value.deployment.blockNumber));
  return value;
}

async function call<T>(rpc: PublicClient, module: NftAcquisitionModule, name: string, height: bigint, args: readonly unknown[] = []): Promise<T> {
  return rpc.readContract({ address: module.vault, abi: vaultAbi, functionName: name, args, blockNumber: height } as never) as Promise<T>;
}
export async function verifyNftAcquisitionModule(rpc: PublicClient, module: NftAcquisitionModule) {
  requireNftAcquisitionEvidence(await rpc.getChainId() === 31337);
  const height = BigInt(module.deployment.blockNumber), header = await rpc.getBlock({ blockNumber: height }), receipt = await rpc.getTransactionReceipt({ hash: module.deployment.transactionHash });
  requireNftAcquisitionEvidence(header.hash && same(header.hash, module.deployment.blockHash) && receipt.status === "success"
    && same(receipt.transactionHash,module.deployment.transactionHash) && receipt.blockNumber === height && same(receipt.blockHash, header.hash));
  for (const [who, expected] of [[module.coreFactory, module.coreFactoryRuntimeHash], [module.factory, module.factoryRuntimeHash],
    [module.venue, module.venueRuntimeHash], [module.vault, module.vaultRuntimeHash], [module.paymentToken, module.paymentTokenRuntimeHash],
    ...module.collections.map(c => [c.address, c.runtimeHash])] as [Address, Hash][]) {
    const code = await rpc.getCode({ address: who, blockNumber: height }); requireNftAcquisitionEvidence(code && same(keccak256(code), expected));
  }
  const born = parseEventLogs({ abi: factoryAbi, eventName: "VaultCreated", strict: true, logs: receipt.logs.filter(l => same(l.address, module.factory)) }) as unknown as {args:{vault:Address;projectToken:Address;creator:Address;controller:Address;intent:Hash}}[];
  requireNftAcquisitionEvidence(born.length === 1 && same(born[0]!.args.vault, module.vault)
    && same(born[0]!.args.projectToken, module.projectToken) && same(born[0]!.args.creator, module.creator));
  const rawBirth = receipt.logs.find(log => same(log.address,module.factory)); requireNftAcquisitionEvidence(rawBirth);
  assertFixtureTreasuryReceiptLog(receipt,header,module.deployment,rawBirth);
  await verifyReclaimExactOrigin(rpc,receipt,header,module.factory,module.creator,
    encodeFunctionData({abi:factoryAbi,functionName:"create",args:[module.projectToken,born[0]!.args.controller,born[0]!.args.intent]}));
  const expected = { coreFactory: module.coreFactory, coreFactoryHash: module.coreFactoryRuntimeHash, venue: module.venue,
    venueHash: module.venueRuntimeHash, paymentToken: module.paymentToken, paymentTokenHash: module.paymentTokenRuntimeHash };
  for (const [name, value] of Object.entries(expected)) {
    requireNftAcquisitionEvidence(same(String(await rpc.readContract({ address: module.factory, abi: factoryAbi, functionName: name, blockNumber: height } as never)), value));
    requireNftAcquisitionEvidence(same(String(await call(rpc, module, name, height)), value));
  }
  requireNftAcquisitionEvidence(await call(rpc, module, "deploymentChainId", height) === 31337n
    && await call(rpc, module, "productionExecutionAvailable", height) === false
    && same(await call(rpc, module, "projectToken", height), module.projectToken)
    && same(await call(rpc, module, "creator", height), module.creator)
    && same(await call(rpc, module, "deploymentFactory", height), module.factory));
  const curve = await rpc.readContract({ address: module.coreFactory, abi: coreAbi, functionName: "originCurveForToken", args: [module.projectToken], blockNumber: height });
  requireNftAcquisitionEvidence(address(curve) && same(await rpc.readContract({ address: curve, abi: coreAbi, functionName: "creator", blockNumber: height }), module.creator)
    && await rpc.readContract({ address: module.projectToken, abi: erc20Abi, functionName: "totalSupply", blockNumber: height }) === 1_000_000_000n * 10n ** 18n);
}

/** Exact canonical transaction membership plus bounded caller admission. Safe
 * proof retains the existing single-transaction restriction. Direct ordinary
 * EOAs/known7702 may share a block only if no type4 authorization occurs there. */
async function originFor(rpc: PublicClient, module: NftAcquisitionModule, receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>, header: Awaited<ReturnType<PublicClient["getBlock"]>>, input: Hex, explicit?:{actor:Address;value:bigint}) {
  const tx = await rpc.getTransaction({ hash: receipt.transactionHash }), before = receipt.blockNumber - 1n;
  requireNftAcquisitionEvidence(before>=0n&&tx.type === "eip1559" && tx.chainId === 31337 && tx.authorizationList == null && (tx.accessList==null||Array.isArray(tx.accessList)&&tx.accessList.length===0)
    && tx.to && receipt.to && same(tx.to, receipt.to) && same(tx.hash, receipt.transactionHash) && tx.blockHash && same(tx.blockHash, receipt.blockHash)
    && tx.blockNumber === receipt.blockNumber && tx.transactionIndex === receipt.transactionIndex && receipt.from&&same(tx.from,receipt.from)
    && tx.value === (explicit?.value??0n));
  const actor = explicit?.actor??await call<Address>(rpc, module, "controller", before);
  if (!same(tx.to, module.vault)) {
    // The inherited Safe profile admits only zero-value inner calls. A native
    // Safe funding path stays unavailable; no account validation is weakened.
    requireNftAcquisitionEvidence((explicit?.value??0n)===0n);
    return verifyReclaimExactOrigin(rpc, receipt, header, module.vault, actor, input);
  }
  requireNftAcquisitionEvidence(same(tx.from, actor) && same(tx.input, input) && header.transactions.length <= 32);
  let preceding = 0;
  for (let i = 0; i < header.transactions.length; i++) {
    const item = header.transactions[i]!, other = await rpc.getTransaction({ hash: typeof item === "string" ? item : item.hash });
    requireNftAcquisitionEvidence(other.type === "eip1559" && other.chainId===31337&&other.authorizationList == null
      &&(other.accessList==null||Array.isArray(other.accessList)&&other.accessList.length===0)&&other.blockHash&&same(other.blockHash,receipt.blockHash)
      &&other.blockNumber===receipt.blockNumber&&other.transactionIndex===i&&same(other.hash,typeof item==="string"?item:item.hash));
    if (i < receipt.transactionIndex && same(other.from, tx.from)) preceding++;
  }
  requireNftAcquisitionEvidence(tx.nonce === await rpc.getTransactionCount({ address: tx.from, blockNumber: before }) + preceding);
  const code = await rpc.getCode({ address: actor, blockNumber: before }), after = await rpc.getCode({ address: actor, blockNumber: receipt.blockNumber });
  requireNftAcquisitionEvidence((code ?? "0x") === (after ?? "0x"));
  if (code && code !== "0x") {
    requireNftAcquisitionEvidence(same(code, reclaimCallerPins.designator));
    for (const blockNumber of [before, receipt.blockNumber]) { const delegate = await rpc.getCode({ address: reclaimCallerPins.delegate, blockNumber }); requireNftAcquisitionEvidence(delegate && same(keccak256(delegate), reclaimCallerPins.delegateHash)); }
  }
  return { profile: code && code !== "0x" ? "metamask-7702" : "eoa", actor, gasPayer: tx.from };
}

type TraceCall={type:string;from:Address;to:Address;input:Hex;output?:Hex;value:bigint};
/** Complete bounded local call traces are required even for ERC20 funding and
 * noticed withdrawals. Receipt events alone never establish asset delivery. */
function exactTrace(raw:unknown,tx:{from:Address;to:Address;input:Hex;value:bigint},vault:Address){
 const nodes:TraceCall[]=[];
 const traceAddress=(value:unknown):value is Address=>typeof value==="string"&&/^0x[0-9a-f]{40}$/i.test(value);
 function visit(value:unknown,depth:number):TraceCall{
  requireNftAcquisitionEvidence(nodes.length<512&&depth<=32&&value&&typeof value==="object"&&!Array.isArray(value));
  const n=value as Record<string,unknown>,v=n.value??(["STATICCALL","DELEGATECALL"].includes(String(n.type))?"0x0":null);
  // Safe's real ECDSA verification uses the ecrecover precompile. Trace nodes
  // admit its address; actor/config admission remains separately restricted.
  requireNftAcquisitionEvidence(["CALL","STATICCALL","DELEGATECALL"].includes(String(n.type))&&n.error===undefined&&traceAddress(n.from)&&traceAddress(n.to)
    &&typeof n.input==="string"&&/^0x(?:[a-f0-9]{2}){0,70000}$/i.test(n.input)&&typeof v==="string"&&/^0x[0-9a-f]{1,64}$/i.test(v)
    &&(n.output===undefined||typeof n.output==="string"&&/^0x(?:[a-f0-9]{2}){0,70000}$/i.test(n.output))&&(n.calls===undefined||Array.isArray(n.calls)));
  const node={type:String(n.type),from:n.from,to:n.to,input:n.input as Hex,...(typeof n.output==="string"&&{output:n.output as Hex}),value:BigInt(v)};nodes.push(node);
  requireNftAcquisitionEvidence(!(node.type==="DELEGATECALL"&&same(node.from,vault)));
  for(const child of n.calls as unknown[]??[])visit(child,depth+1);return node;
 }
 const root=visit(raw,0);requireNftAcquisitionEvidence(root.type==="CALL"&&same(root.from,tx.from)&&same(root.to,tx.to)&&same(root.input,tx.input)&&root.value===tx.value);
 return nodes;
}
function exactInnerCall(nodes:TraceCall[],actor:Address,vault:Address,input:Hex,value:bigint){
 const matches=nodes.filter(n=>n.type==="CALL"&&same(n.from,actor)&&same(n.to,vault));requireNftAcquisitionEvidence(matches.length===1&&same(matches[0]!.input,input)&&matches[0]!.value===value);
}
function exactAssetCall(nodes:TraceCall[],vault:Address,asset:Address,input:Hex,tokenReturn=false){
 const matches=nodes.filter(n=>n.type==="CALL"&&same(n.from,vault)&&same(n.to,asset));
 requireNftAcquisitionEvidence(matches.length===1&&same(matches[0]!.input,input)&&matches[0]!.value===0n&&(!tokenReturn||matches[0]!.output==="0x"+"0".repeat(63)+"1"));
 requireNftAcquisitionEvidence(nodes.every(n=>n.type!=="CALL"||!same(n.from,vault)||n.value===0n));
}

export async function readNftAcquisitionRange(rpc: PublicClient, module: NftAcquisitionModule, blocks: BlockEvidence[]): Promise<NftAcquisitionRange> {
  requireNftAcquisitionEvidence(module.chainId===31337&&await rpc.getChainId()===31337&&blocks.length<=384);
  const events: NftAcquisitionRange["events"] = [], states: NftAcquisitionRange["states"] = [];
  for (const point of blocks) {
    const height = BigInt(point.blockNumber); if (height < BigInt(module.deployment.blockNumber)) continue;
    const code = await rpc.getCode({ address: module.vault, blockNumber: height }); requireNftAcquisitionEvidence(code && same(keccak256(code), module.vaultRuntimeHash));
    const header = await rpc.getBlock({ blockNumber: height }); requireNftAcquisitionEvidence(header.hash && same(header.hash, point.blockHash));
    const logs = await rpc.getLogs({ address: module.vault, fromBlock: height, toBlock: height }); requireNftAcquisitionEvidence(logs.length <= 128);
    for (const log of logs) {
      const receipt = await rpc.getTransactionReceipt({ hash: log.transactionHash }); assertFixtureTreasuryReceiptLog(receipt, header, point, log);
      const parsed = parseEventLogs({ abi: vaultAbi, strict: true, logs: [log] }); requireNftAcquisitionEvidence(parsed.length === 1);
      const event = parsed[0]!, args = event.args as unknown as Record<string, unknown>;
      const row: NftAcquisitionRange["events"][number] = { ...point, vault: module.vault, projectToken: module.projectToken,
        transactionHash: log.transactionHash, logIndex: log.logIndex, eventName: event.eventName, args };
      if (event.eventName === "PurchaseExecuted") {
        const tx = await rpc.getTransaction({ hash: receipt.transactionHash });
        let data = tx.input;
        if (!tx.to || !same(tx.to, module.vault)) {
          const safeAbi = parseAbi(["function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)"]);
          const outer = decodeFunctionData({ abi: safeAbi, data }); requireNftAcquisitionEvidence(outer.functionName === "execTransaction"); data = outer.args[2];
        }
        const decoded = decodeFunctionData({ abi: vaultAbi, data }); requireNftAcquisitionEvidence(decoded.functionName === "purchase");
        requireNftAcquisitionEvidence(decoded.args && decoded.args.length === 5);
        const [order, signature, policyEpoch, controllerEpoch, deadline] = decoded.args as unknown as readonly [Order,Hex,bigint,bigint,number];
        requireNftAcquisitionEvidence(same(encodeFunctionData({ abi: vaultAbi, functionName: "purchase", args: decoded.args }), data)
          && same(order.vault, module.vault) && same(order.collection, String(args.collection)) && same(order.seller, String(args.seller))
          && order.tokenId === args.tokenId && order.quantity === args.quantity && order.currency === args.currency
          && order.sellerAmount === args.sellerAmount && order.feeAmount === args.feeAmount && order.royaltyAmount === args.royaltyAmount
          && same(order.feeRecipient, String(args.feeRecipient)) && same(order.royaltyRecipient, String(args.royaltyRecipient))
          && policyEpoch === args.policyEpoch && controllerEpoch === args.controllerEpoch && BigInt(deadline) >= header.timestamp);
        const identity = module.collections.find(c => same(c.address, order.collection)); requireNftAcquisitionEvidence(identity && order.standard === (identity.standard === 721 ? 1 : 2));
        const collectionCode = await rpc.getCode({ address: order.collection, blockNumber: height }); requireNftAcquisitionEvidence(collectionCode && same(keccak256(collectionCode), identity.runtimeHash));
        const venueCode = await rpc.getCode({ address: module.venue, blockNumber: height }); requireNftAcquisitionEvidence(venueCode && same(keccak256(venueCode), module.venueRuntimeHash));
        const typed = { domain: { name: "RMT Synthetic NFT Listing Venue", version: "1", chainId: 31337, verifyingContract: module.venue },
          types: nftAcquisitionOrderTypes, primaryType: "Order" as const, message: order };
        requireNftAcquisitionEvidence(same(hashTypedData(typed), String(args.orderHash)) && same(await recoverTypedDataAddress({ ...typed, signature }), order.seller));
        const origin = await originFor(rpc, module, receipt, header, data), totalCost = order.sellerAmount + order.feeAmount + order.royaltyAmount;
        requireNftAcquisitionEvidence(totalCost === args.totalCost && (same(order.currency, zeroAddress) || same(order.currency, module.paymentToken)));
        const filled = parseEventLogs({ abi: venueAbi, eventName: "OrderFilled", strict: true, logs: receipt.logs.filter(l => same(l.address, module.venue)) }) as unknown as {args:{orderHash:Hash;vault:Address;totalCost:bigint}}[];
        requireNftAcquisitionEvidence(filled.length === 1 && same(filled[0]!.args.orderHash, String(args.orderHash)) && same(filled[0]!.args.vault, module.vault) && filled[0]!.args.totalCost === totalCost);
        const nft = parseEventLogs({ abi: nftAbi, strict: true, logs: receipt.logs.filter(l => same(l.address, order.collection)) });
        requireNftAcquisitionEvidence(nft.length === 1);
        const transfer = nft[0]!;
        if (order.standard === 1) requireNftAcquisitionEvidence(transfer.eventName === "Transfer" && same(transfer.args.from, order.seller) && same(transfer.args.to, module.vault) && transfer.args.tokenId === order.tokenId && order.quantity === 1n);
        else requireNftAcquisitionEvidence(transfer.eventName === "TransferSingle" && same(transfer.args.from, order.seller) && same(transfer.args.to, module.vault)
          && same(transfer.args.operator, module.venue) && transfer.args.id === order.tokenId && transfer.args.value === order.quantity);
        const trace = await rpc.request({ method: "debug_traceTransaction" as never, params: [receipt.transactionHash, { tracer: "callTracer" }] as never });
        const nftTransferInput = order.standard === 1 ? encodeFunctionData({ abi: nftAbi, functionName: "safeTransferFrom", args: [order.seller, module.vault, order.tokenId] })
          : encodeFunctionData({ abi: nftAbi, functionName: "safeTransferFrom", args: [order.seller, module.vault, order.tokenId, order.quantity, "0x"] });
        const payments = [{ recipient: order.seller, amount: order.sellerAmount }, { recipient: order.feeRecipient, amount: order.feeAmount }, { recipient: order.royaltyRecipient, amount: order.royaltyAmount }];
        assertNftAcquisitionTrace(trace, { from: tx.from, to: tx.to!, input: tx.input, value: tx.value }, { vault: module.vault, venue: module.venue,
          collection: order.collection, purchaseInput: data, fillInput: encodeFunctionData({ abi: venueAbi, functionName: "fill", args: [order, signature] }), nftTransferInput,
          totalCost, native: same(order.currency, zeroAddress), payments, ...(origin.profile === "safe-1.4.1" && { safeSingleton: reclaimCallerPins.singleton }) });
        if (!same(order.currency, zeroAddress)) {
          const payouts = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", strict: true, logs: receipt.logs.filter(l => same(l.address, order.currency)) });
          const expected = payments.filter(p => p.amount > 0n); requireNftAcquisitionEvidence(payouts.length === expected.length);
          for (let i = 0; i < expected.length; i++) requireNftAcquisitionEvidence(same(payouts[i]!.args.from, module.vault) && same(payouts[i]!.args.to, expected[i]!.recipient) && payouts[i]!.args.value === expected[i]!.amount);
        }
        row.settlement = { kind: "purchase", evidence: "canonical-receipt-and-exact-local-call-trace", orderHash: args.orderHash as Hash,
          collection: order.collection, tokenId: order.tokenId.toString(), quantity: order.quantity.toString(), currency: order.currency, totalCost: totalCost.toString(), custody: module.vault, origin };
      } else if (event.eventName === "FundingReceived") {
        const tx = await rpc.getTransaction({ hash: receipt.transactionHash });
        const native=same(String(args.currency),zeroAddress);requireNftAcquisitionEvidence(address(args.sender)&&typeof args.source==="string"&&/^0x[0-9a-f]{64}$/i.test(args.source)&&typeof args.amount==="bigint"&&args.amount>0n);
        const input=encodeFunctionData({abi:vaultAbi,functionName:native?"fundNative":"fundToken",args:native?[args.source]:[args.amount,args.source]});
        const origin=await originFor(rpc,module,receipt,header,input,{actor:args.sender,value:native?args.amount:0n});
        const trace = await rpc.request({ method: "debug_traceTransaction" as never, params: [receipt.transactionHash, { tracer: "callTracer" }] as never });
        requireNftAcquisitionEvidence(tx.to);const nodes=exactTrace(trace,{from:tx.from,to:tx.to,input:tx.input,value:tx.value},module.vault);exactInnerCall(nodes,args.sender,module.vault,input,native?args.amount:0n);
        if (native) {
          assertNativeTransferProof(trace, { from: tx.from, to: module.vault, input: tx.input, value: tx.value }, [{ from: tx.from, to: module.vault, amount: tx.value }]);
          requireNftAcquisitionEvidence(nodes.every(n=>n.type!=="CALL"||!same(n.from,module.vault)||n.value===0n));
        } else {
          requireNftAcquisitionEvidence(same(String(args.currency), module.paymentToken) && tx.value === 0n);
          const code=await rpc.getCode({address:module.paymentToken,blockNumber:height});requireNftAcquisitionEvidence(code&&same(keccak256(code),module.paymentTokenRuntimeHash));
          exactAssetCall(nodes,module.vault,module.paymentToken,encodeFunctionData({abi:erc20Abi,functionName:"transferFrom",args:[args.sender,module.vault,args.amount]}),true);
          const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", strict: true, logs: receipt.logs.filter(l => same(l.address, module.paymentToken)) });
          requireNftAcquisitionEvidence(transfers.length === 1 && same(transfers[0]!.args.from, args.sender) && same(transfers[0]!.args.to, module.vault) && transfers[0]!.args.value === args.amount);
        }
        row.settlement = { kind: "funding", evidence: "canonical-receipt-and-exact-local-call-trace", currency: args.currency as Address, totalCost: String(args.amount),origin };
      } else if(event.eventName==="WithdrawalExecuted"){
        requireNftAcquisitionEvidence(typeof args.id==="bigint"&&args.id>0n&&height>0n);
        type Notice=readonly[number,Address,bigint,bigint,Address,number,number,bigint,number];
        const before=await call<Notice>(rpc,module,"withdrawals",height-1n,[args.id]),after=await call<Notice>(rpc,module,"withdrawals",height,[args.id]),epoch=await call<bigint>(rpc,module,"controllerEpoch",height-1n);
        const[kind,asset,tokenId,quantity,recipient,validAfter,expiresAt,noticeEpoch,state]=before;
        requireNftAcquisitionEvidence([0,1,2].includes(kind)&&address(recipient)&&!same(recipient,module.vault)&&quantity>0n&&state===1&&after[8]===2&&noticeEpoch===epoch&&validAfter>0&&header.timestamp>=BigInt(validAfter)&&header.timestamp<=BigInt(expiresAt)
          &&same(asset,String(args.asset))&&kind===args.kind&&tokenId===args.tokenId&&quantity===args.quantity&&same(recipient,String(args.recipient))
          &&before.slice(0,8).every((value,index)=>String(value).toLowerCase()===String(after[index]).toLowerCase()));
        const tx=await rpc.getTransaction({hash:receipt.transactionHash});requireNftAcquisitionEvidence(tx.to);
        const input=encodeFunctionData({abi:vaultAbi,functionName:"executeWithdrawal",args:[args.id]}),actor=same(tx.to,module.vault)?tx.from:tx.to;
        // Execution is permissionless once the controller-authorized notice is
        // current. Its caller must still match a supported, canonical origin.
        const origin=await originFor(rpc,module,receipt,header,input,{actor,value:0n});
        const trace=await rpc.request({method:"debug_traceTransaction"as never,params:[receipt.transactionHash,{tracer:"callTracer"}]as never}),nodes=exactTrace(trace,{from:tx.from,to:tx.to,input:tx.input,value:tx.value},module.vault);exactInnerCall(nodes,actor,module.vault,input,0n);
        if(kind===0&&same(asset,zeroAddress)){
          const payments=nodes.filter(n=>n.type==="CALL"&&same(n.from,module.vault)&&n.value>0n);requireNftAcquisitionEvidence(tokenId===0n&&payments.length===1&&same(payments[0]!.to,recipient)&&payments[0]!.value===quantity);
          assertNativeTransferProof(trace,{from:tx.from,to:tx.to,input:tx.input,value:tx.value},[{from:module.vault,to:recipient,amount:quantity}]);
        }else{
          const identity=kind===0?{address:module.paymentToken,runtimeHash:module.paymentTokenRuntimeHash}:module.collections.find(c=>same(c.address,asset));
          requireNftAcquisitionEvidence(identity&&same(identity.address,asset)&&(kind===0||("standard"in identity&&identity.standard===(kind===1?721:1155))));
          const code=await rpc.getCode({address:asset,blockNumber:height});requireNftAcquisitionEvidence(code&&same(keccak256(code),identity.runtimeHash));
          if(kind===0){
            exactAssetCall(nodes,module.vault,asset,encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[recipient,quantity]}),true);
            const transfers=parseEventLogs({abi:erc20Abi,eventName:"Transfer",strict:true,logs:receipt.logs.filter(l=>same(l.address,asset))});requireNftAcquisitionEvidence(tokenId===0n&&transfers.length===1&&same(transfers[0]!.args.from,module.vault)&&same(transfers[0]!.args.to,recipient)&&transfers[0]!.args.value===quantity);
          }else{
            const data=kind===1?encodeFunctionData({abi:nftAbi,functionName:"safeTransferFrom",args:[module.vault,recipient,tokenId]}):encodeFunctionData({abi:nftAbi,functionName:"safeTransferFrom",args:[module.vault,recipient,tokenId,quantity,"0x"]});exactAssetCall(nodes,module.vault,asset,data);
            const transfers=parseEventLogs({abi:nftAbi,strict:true,logs:receipt.logs.filter(l=>same(l.address,asset))});requireNftAcquisitionEvidence(transfers.length===1);const t=transfers[0]!;
            if(kind===1)requireNftAcquisitionEvidence(quantity===1n&&t.eventName==="Transfer"&&same(t.args.from,module.vault)&&same(t.args.to,recipient)&&t.args.tokenId===tokenId);
            else requireNftAcquisitionEvidence(t.eventName==="TransferSingle"&&same(t.args.from,module.vault)&&same(t.args.to,recipient)&&same(t.args.operator,module.vault)&&t.args.id===tokenId&&t.args.value===quantity);
          }
        }
        row.settlement={kind:"withdrawal",evidence:"canonical-receipt-and-exact-local-call-trace",withdrawalId:args.id.toString(),assetKind:kind,currency:asset,tokenId:tokenId.toString(),quantity:quantity.toString(),totalCost:quantity.toString(),recipient,origin};
      }
      events.push(row);
    }
  }
  const end = blocks.at(-1);
  if (end && BigInt(end.blockNumber) >= BigInt(module.deployment.blockNumber)) {
    const height = BigInt(end.blockNumber), names = ["controller", "controllerEpoch", "policyEpoch", "purchasesEnabled", "policy"];
    const values = await Promise.all(names.map(name => call<unknown>(rpc, module, name, height)));
    const policy = values[4] as readonly [Address, bigint, bigint, bigint, number];
    states.push({ ...end, vault: module.vault, projectToken: module.projectToken, controller: values[0] as Address,
      controllerEpoch: String(values[1]), policyEpoch: String(values[2]), enabled: values[3] as boolean,
      policy: { currency: policy[0], perNftCap: String(policy[1]), totalBudget: String(policy[2]), periodBudget: String(policy[3]), cooldownSeconds: policy[4] },
      nativeBalance: (await rpc.getBalance({ address: module.vault, blockNumber: height })).toString(),
      paymentBalance: (await rpc.readContract({ address: module.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [module.vault], blockNumber: height })).toString() });
    const canonical = await rpc.getBlock({ blockNumber: height }); requireNftAcquisitionEvidence(canonical.hash && same(canonical.hash, end.blockHash));
  }
  return { events, states };
}
