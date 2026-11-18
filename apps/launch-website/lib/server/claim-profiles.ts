import { decodeFunctionResult, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, recoverAddress, toHex, zeroAddress,
  type Address, type Hex } from "viem";
import { claimDelegatePin, claimExecutionIdentity, claimExecutionProfile, claimExecutionReviewHash, isClaimExecutionReview,
  type ClaimExecutionReview, type ClaimFeeEvidence, type ClaimOuterTransaction, type ClaimSafeTransaction,
  type ClaimWalletEvidence, type ClaimWalletKind } from "../claim-profiles";
import { encodeEarningsClaim, isEarningsClaimOperation, isEarningsClaimRequest, sameEarningsClaimRequest,
  type EarningsClaimOperation, type EarningsClaimRequest } from "../earnings-claims";
import { earningsClaimReadiness } from "./earnings-claims";
import { readEarningsContracts, readFactoryCreationFees, verifyEarningsContext, productionEarningsContext,
  type EarningsReadContext, type EarningsRegistration } from "./earnings-contracts";
import { productionReaders } from "./curve-production";

export { claimDelegatePin } from "../claim-profiles";
export const claimSafePins = Object.freeze({ singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" as Address,
  singletonRuntimeHash: "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff" as Hex,
  proxyRuntimeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c" as Hex,
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" as Address,
  fallbackRuntimeHash: "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9" as Hex });
const guardSlot = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" as Hex;
const handlerSlot = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5" as Hex;
const sentinel = "0x0000000000000000000000000000000000000001" as Address;
const ownerCountSlot = "0x3" as Hex;
const safeAbi = parseAbi(["function VERSION() view returns(string)", "function masterCopy() view returns(address)",
  "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)", "function nonce() view returns(uint256)",
  "function getModulesPaginated(address start,uint256 size) view returns(address[] array,address next)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns(bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)"]);
const nitroAbi = parseAbi(["function gasEstimateComponents(address to,bool contractCreation,bytes data) payable returns(uint64 gasEstimate,uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)"]);
const nitro = "0x00000000000000000000000000000000000000c8" as Address;
const safeTypes = { SafeTx: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" }] } as const;
const lowS = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (a: unknown): a is Address => typeof a === "string" && /^0x[0-9a-f]{40}$/i.test(a) && BigInt(a) > 0xffffn;
const hash = (a: unknown): a is Hex => typeof a === "string" && /^0x[0-9a-f]{64}$/i.test(a);
const decimal = (a: unknown): a is string => typeof a === "string" && /^(0|[1-9][0-9]{0,77})$/.test(a) && BigInt(a) < 2n ** 256n;
const normalize = (a: string): Address => getAddress(a.toLowerCase());
function must(value: unknown, reason = "Wallet profile evidence unavailable or changed"): asserts value { if (!value) throw Error(reason); }
const uintNonce = (n: number) => { must(Number.isSafeInteger(n) && n >= 0); return BigInt(n); };

export function claimContextIsAllowed(context: EarningsReadContext, receipt = false) {
  if (context.chainId === 31337) return receipt || !context.historicalReceipt;
  if (context.chainId !== 4663 || (!receipt && context.historicalReceipt)) return false;
  const expected = productionEarningsContext(context.rpc, context.checkpoint);
  const pairs = [[context.factory, expected.factory], [context.factoryRuntimeHash, expected.factoryRuntimeHash],
    [context.registry, expected.registry], [context.registryRuntimeHash, expected.registryRuntimeHash],
    [context.deploymentBlockHash, expected.deploymentBlockHash], [context.graduation.address, expected.graduation.address],
    [context.graduation.runtimeHash, expected.graduation.runtimeHash], [context.graduation.guard, expected.graduation.guard],
    [context.graduation.guardRuntimeHash, expected.graduation.guardRuntimeHash], [context.poolManager.address, expected.poolManager.address],
    [context.poolManager.runtimeHash, expected.poolManager.runtimeHash], [context.positionManager.address, expected.positionManager.address],
    [context.positionManager.runtimeHash, expected.positionManager.runtimeHash]];
  return context.deploymentBlock === expected.deploymentBlock && pairs.every(([a, b]) => typeof a === "string" && same(a, b));
}
async function directWallet(context: EarningsReadContext, actor: Address, at: bigint, pending: boolean) {
  const rpc = context.rpc;
  const [rawCode, nonce] = await Promise.all([rpc.getCode({ address: actor, blockNumber: at }), rpc.getTransactionCount({ address: actor, blockNumber: at })]);
  // viem represents a successful eth_getCode "0x" result as undefined. RPC
  // failures throw; malformed/null responses are never treated as empty code.
  must(rawCode === undefined || typeof rawCode === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(rawCode));
  const code = rawCode === undefined ? "0x" : rawCode;
  const actorNonce = uintNonce(nonce).toString();
  let kind: "eoa" | "metamask-7702";
  if (code === "0x") kind = "eoa";
  else {
    must(same(code, claimDelegatePin.designator), "Unsupported or replaced EIP-7702 delegation");
    const runtime = await rpc.getCode({ address: claimDelegatePin.address, blockNumber: at });
    must(runtime && same(keccak256(runtime), claimDelegatePin.runtimeHash), "Delegated implementation runtime mismatch"); kind = "metamask-7702";
    if (pending) must(same(await rpc.getCode({ address: claimDelegatePin.address, blockTag: "pending" }) ?? "", runtime), "Pending delegation changed");
  }
  if (pending) {
    const [pendingCode, pendingNonce] = await Promise.all([rpc.getCode({ address: actor, blockTag: "pending" }), rpc.getTransactionCount({ address: actor, blockTag: "pending" })]);
    must((pendingCode === undefined ? code === "0x" : typeof pendingCode === "string" && same(pendingCode, code)) && uintNonce(pendingNonce).toString() === actorNonce, "Pending account identity or nonce changed");
  }
  return { kind, codeHash: keccak256(code), nonce: actorNonce };
}
const safeArgs = (tx: ClaimSafeTransaction) => [tx.to, 0n, tx.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, BigInt(tx.nonce)] as const;
export function claimSafeTypedData(chainId: number, safe: Address, tx: ClaimSafeTransaction) {
  return { domain: { chainId, verifyingContract: safe }, types: safeTypes, primaryType: "SafeTx" as const,
    message: { to: tx.to, value: 0n, data: tx.data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
      gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: BigInt(tx.nonce) } };
}
async function verifySafeSignatures(owners: readonly Address[], transactionHash: Hex, signatures: Hex) {
  must(/^0x[0-9a-f]{260}$/i.test(signatures), "Exactly two supported Safe owner signatures required");
  let previous = 0n;
  for (let i = 0; i < 2; i++) {
    const signature = ("0x" + signatures.slice(2 + i * 130, 2 + (i + 1) * 130)) as Hex;
    const v = BigInt("0x" + signature.slice(-2)), s = BigInt("0x" + signature.slice(66, 130));
    must((v === 27n || v === 28n) && s > 0n && s <= lowS, "Only canonical EIP-712 Safe EOA signatures supported");
    const recovered = await recoverAddress({ hash: transactionHash, signature });
    must(owners.some(a => same(a, recovered)) && BigInt(recovered) > previous, "Wrong, duplicate or unordered Safe signatures"); previous = BigInt(recovered);
  }
}
async function safeWallet(context: EarningsReadContext, actor: Address, at: bigint, inner: EarningsClaimRequest, signatures?: Hex) {
  const rpc = context.rpc, base = { address: actor, blockNumber: at } as const;
  const [code, count, guard, handler, singletonCode, handlerCode, evmNonce] = await Promise.all([
    rpc.getCode(base), rpc.getStorageAt({ ...base, slot: ownerCountSlot }), rpc.getStorageAt({ ...base, slot: guardSlot }),
    rpc.getStorageAt({ ...base, slot: handlerSlot }), rpc.getCode({ address: claimSafePins.singleton, blockNumber: at }),
    rpc.getCode({ address: claimSafePins.fallbackHandler, blockNumber: at }), rpc.getTransactionCount(base),
  ]);
  must(code && same(keccak256(code), claimSafePins.proxyRuntimeHash) && count && BigInt(count) === 3n
    && guard && /^0x0{64}$/i.test(guard) && handler && /^0x0{24}[0-9a-f]{40}$/i.test(handler)
    && same("0x" + handler.slice(-40), claimSafePins.fallbackHandler)
    && singletonCode && same(keccak256(singletonCode), claimSafePins.singletonRuntimeHash)
    && handlerCode && same(keccak256(handlerCode), claimSafePins.fallbackRuntimeHash), "Unsupported Safe runtime, owners, handler, modules or guard");
  const read = { ...base, abi: safeAbi } as const;
  const [version, singleton, owners, threshold, nonce, [modules, next]] = await Promise.all([
    rpc.readContract({ ...read, functionName: "VERSION" }), rpc.readContract({ ...read, functionName: "masterCopy" }),
    rpc.readContract({ ...read, functionName: "getOwners" }), rpc.readContract({ ...read, functionName: "getThreshold" }),
    rpc.readContract({ ...read, functionName: "nonce" }), rpc.readContract({ ...read, functionName: "getModulesPaginated", args: [sentinel, 1n] }),
  ]);
  must(version === "1.4.1" && same(singleton, claimSafePins.singleton) && threshold === 2n && owners.length === 3
    && owners.every(address) && new Set(owners.map(a => a.toLowerCase())).size === 3 && !owners.some(a => same(a, actor))
    && modules.length === 0 && same(next, sentinel), "Safe must retain three distinct EOA owners, 2-of-3 and no modules");
  const ownerCodes = await Promise.all(owners.map(owner => rpc.getCode({ address: owner, blockNumber: at })));
  must(ownerCodes.every(code => code === "0x" || code === undefined), "Unsupported Safe owner account type");
  const tx: ClaimSafeTransaction = { to: normalize(inner.to), value: "0", data: inner.data, operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0",
    gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: nonce.toString() };
  const transactionHash = hashTypedData(claimSafeTypedData(context.chainId, actor, tx));
  const onchainHash = await rpc.readContract({ ...read, functionName: "getTransactionHash", args: safeArgs(tx) });
  must(same(onchainHash, transactionHash), "Safe chain/domain/transaction digest mismatch");
  let approvalsCollected: 0 | 2 = 0;
  if (signatures !== undefined) {
    await verifySafeSignatures(owners, transactionHash, signatures);
    approvalsCollected = 2;
  }
  return { kind: "safe-1.4.1" as const, actorCodeHash: keccak256(code), actorNonce: uintNonce(evmNonce).toString(), delegation: null,
    safe: { address: actor, version: "1.4.1" as const, ...claimSafePins, owners: owners.map(normalize), threshold: 2 as const,
      nonce: nonce.toString(), evmNonce: uintNonce(evmNonce).toString(), transaction: tx, transactionHash, signatures: signatures ?? null,
      approvalsCollected, expiryEnforcement: inner.deadline ? "inner-contract-deadline" as const : "safe-nonce-only" as const } };
}

export async function estimateClaimExecutionFees(context: EarningsReadContext, outer: ClaimOuterTransaction, kind: ClaimWalletKind = "eoa"): Promise<ClaimFeeEvidence> {
  try {
    const at = BigInt(context.checkpoint.blockNumber), rpc = context.rpc;
    const request = { account: outer.from, to: outer.to, data: outer.data, value: 0n, blockNumber: at } as const;
    const [execution, price, header, balance, simulation] = await Promise.all([rpc.estimateGas(request), rpc.getGasPrice(), rpc.getBlock({ blockNumber: at }), rpc.getBalance({ address: outer.from, blockNumber: at }), rpc.call(request)]);
    must(header.hash && same(header.hash, context.checkpoint.blockHash) && execution >= 21000n && execution <= 30_000_000n && price > 0n);
    if (kind === "safe-1.4.1") must(simulation.data && decodeFunctionResult({ abi: safeAbi, functionName: "execTransaction", data: simulation.data }) === true, "Safe simulation did not prove successful inner execution");
    let total = execution, poster = 0n, base = price, l1Base = 0n;
    if (context.chainId === 4663) {
      const raw = await rpc.call({ account: outer.from, to: nitro, data: encodeFunctionData({ abi: nitroAbi, functionName: "gasEstimateComponents", args: [outer.to, false, outer.data] }), value: 0n, blockNumber: at });
      must(raw.data); const values = decodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents", data: raw.data });
      [total, poster, base, l1Base] = values;
      must(total >= 21000n && total <= 30_000_000n && poster > 0n && poster < total && base > 0n && l1Base > 0n, "Nitro L1 data fee unavailable");
    }
    const tip = context.chainId === 4663 ? await rpc.estimateMaxPriorityFeePerGas() : 0n;
    must(tip >= 0n && tip <= 10n ** 12n);
    const gas = ((total > execution ? total : execution) * 125n + 99n) / 100n;
    const maxFee = price > base * 2n + tip ? price : base * 2n + tip;
    must(gas <= 30_000_000n && balance >= gas * maxFee && same((await rpc.getBlock({ blockNumber: at })).hash!, header.hash));
    return { status: context.chainId === 4663 ? "verified-nitro" : "synthetic-local", gasUnits: total.toString(), gasLimit: gas.toString(),
      l2GasUnits: (total - poster).toString(), l1PosterGasUnits: poster.toString(), baseFeeWei: base.toString(), l1BaseFeeWei: l1Base.toString(),
      estimatedL2Wei: ((total - poster) * base).toString(), estimatedL1Wei: (poster * base).toString(), estimatedTotalWei: (total * base).toString(),
      maxFeePerGasWei: maxFee.toString(), maxPriorityFeePerGasWei: tip.toString(), proposedMaximumWei: (gas * maxFee).toString(),
      observedBlockNumber: at.toString(), observedBlockHash: header.hash, includesL1Data: context.chainId === 4663 };
  } catch { return { status: "unavailable", reason: context.chainId === 4663 ? "Verified transaction-specific L2/L1 gas evidence or funds unavailable" : "Synthetic execution simulation, gas or funds unavailable" }; }
}

export type ClaimPreparationInput = { context: EarningsReadContext; registration?: EarningsRegistration; operation: EarningsClaimOperation;
  beneficiary: Address; account: Address; kind: ClaimWalletKind; safeAddress?: Address; safeSignatures?: Hex; prior?: ClaimExecutionReview };
export type ClaimPreparationResult = ClaimExecutionReview | { status: "unavailable"; reason: string; executionEnabled: false };
/** Corroboration uses two separately configured read-only providers and exact
 * checkpoint equality. Conflict is unavailable, never an average or fallback.
 * Local fault-injection tests can use distinct local clients; production admits
 * only the two existing public endpoint identities. */
export async function prepareCorroboratedClaimExecutionReview(inputs: readonly [ClaimPreparationInput, ClaimPreparationInput]) {
  try {
    const [a, b] = inputs;
    must(a.context.rpc !== b.context.rpc && a.context.chainId === b.context.chainId
      && JSON.stringify(a.context.checkpoint) === JSON.stringify(b.context.checkpoint), "Distinct providers at one canonical checkpoint required");
    if (a.context.chainId === 4663) {
      const urls = [a.context.rpc.transport.url, b.context.rpc.transport.url];
      must(new Set(urls).size === 2 && urls.includes("https://rpc.mainnet.chain.robinhood.com") && urls.includes("https://robinhood.api.pocket.network"), "Unapproved or duplicate production provider");
    }
    const results = await Promise.all(inputs.map(prepareClaimExecutionReview));
    must(results.every(isClaimExecutionReview) && results[0].reviewHash === results[1].reviewHash, "Provider profile, simulation, fee or nonce disagreement");
    return { schemaVersion: 1 as const, status: "corroborated-unsigned-review" as const, executionEnabled: false as const,
      review: results[0] as ClaimExecutionReview, providers: a.context.chainId === 4663 ? ["official-robinhood", "pocket-public"] : ["isolated-provider-a", "isolated-provider-b"],
      conflictPolicy: "Any missing or differing identity, state, simulation or fee evidence is unavailable; no fallback or majority override" };
  } catch (e) { return { schemaVersion: 1 as const, status: "unavailable" as const, executionEnabled: false as const, reason: e instanceof Error ? e.message : "Provider corroboration unavailable" }; }
}
export async function prepareProductionClaimExecutionReview(input: Omit<ClaimPreparationInput, "context"> & { checkpoint: EarningsReadContext["checkpoint"] }) {
  const { checkpoint, ...request } = input;
  const clients = productionReaders();
  return prepareCorroboratedClaimExecutionReview([
    { ...request, context: productionEarningsContext(clients[0], checkpoint) },
    { ...request, context: productionEarningsContext(clients[1], checkpoint) },
  ]);
}
export async function prepareClaimExecutionReview(input: ClaimPreparationInput): Promise<ClaimPreparationResult> {
  try {
    const { context, kind, operation } = input;
    must(claimContextIsAllowed(context) && isEarningsClaimOperation(operation) && address(input.account) && address(input.beneficiary));
    must(["eoa", "metamask-7702", "safe-1.4.1"].includes(kind));
    if (kind !== "safe-1.4.1") must(input.safeAddress === undefined && input.safeSignatures === undefined, "Safe authorization fields cannot broaden a direct account profile");
    const head = await verifyEarningsContext(context), payer = normalize(input.account);
    const actor = kind === "safe-1.4.1" ? normalize(input.safeAddress ?? input.beneficiary) : payer;
    const payerEvidence = await directWallet(context, payer, head.number, true);
    if (kind !== "safe-1.4.1") must(payerEvidence.kind === kind, "Selected direct account profile differs from observed code");
    let token: Address = zeroAddress, origin: Address = zeroAddress, ledger = context.factory, to = context.factory, targetHash = context.factoryRuntimeHash;
    let beneficiary = normalize(input.beneficiary), native = 0n, erc20 = 0n, positionTokenId: string | null = null, principalLiquidityWei: string | null = null;
    if (operation === "creation-fees") {
      const fees = await readFactoryCreationFees(context, beneficiary); must(fees.status === "ready"); beneficiary = fees.recipient; native = BigInt(fees.availableNativeWei);
    } else {
      must(input.registration); const s = await readEarningsContracts(context, input.registration, beneficiary); must(s.status === "ready" && s.rights.roles.length > 0);
      token = s.token; origin = s.originalCurve;
      if (operation === "curve-claim") { ledger = s.curve.ledger; to = ledger; targetHash = s.curve.runtimeHash; native = BigInt(s.curve.claimableNativeWei); }
      else {
        must(s.lp.status === "ready"); ledger = s.lp.ledger; to = ledger; targetHash = s.lp.runtimeHash; positionTokenId = s.lp.positionTokenId; principalLiquidityWei = s.lp.liquidityWei;
        if (operation === "lp-collect") { to = s.lp.collectionContract; targetHash = s.lp.collectionRuntimeHash; beneficiary = ledger; native = BigInt(s.lp.uncollectedNativeWei); erc20 = BigInt(s.lp.uncollectedTokenWei); }
        else { native = operation === "lp-claim-token" ? 0n : BigInt(s.lp.claimableNativeWei); erc20 = operation === "lp-claim-native" ? 0n : BigInt(s.lp.claimableTokenWei); }
      }
      if (operation !== "lp-collect") must(same(actor, input.beneficiary), "The ledger caller must be the entitled beneficiary");
    }
    must(native > 0n || erc20 > 0n, "No verified fee credits");
    const prior = input.prior;
    if (prior) {
      must(isClaimExecutionReview(prior) && prior.chainId === context.chainId && prior.kind === kind && same(prior.gasPayer, payer) && same(prior.actor, actor)
        && prior.inner.operation === operation && Number(head.timestamp) < prior.expiresAt && native >= BigInt(prior.inner.expectedNativeWei) && erc20 >= BigInt(prior.inner.expectedTokenWei));
      must(same((await context.rpc.getBlock({ blockNumber: BigInt(prior.inner.reviewBlockNumber) })).hash!, prior.inner.reviewBlockHash), "Prior review was reorged");
    }
    const anchor = prior ? { number: BigInt(prior.inner.reviewBlockNumber), hash: prior.inner.reviewBlockHash, timestamp: BigInt(prior.inner.reviewTimestamp) } : head;
    const deadline = operation === "lp-collect" ? (anchor.timestamp + 180n).toString() : null;
    const inner: EarningsClaimRequest = { schemaVersion: 1, operation, chainId: context.chainId === 31337 ? "0x7a69" : "0x1237", from: actor, to,
      data: await encodeEarningsClaim(operation, token, deadline), value: "0x0", nonce: toHex(BigInt(payerEvidence.nonce)), factory: context.factory, token,
      originCurve: origin, ledger, beneficiary, discoveryRecipient: operation === "creation-fees" ? beneficiary : input.beneficiary,
      factoryRuntimeHash: context.factoryRuntimeHash, targetRuntimeHash: targetHash, deploymentBlockNumber: toHex(context.deploymentBlock), deploymentBlockHash: context.deploymentBlockHash,
      reviewBlockNumber: toHex(anchor.number), reviewBlockHash: anchor.hash!, reviewTimestamp: Number(anchor.timestamp), reviewExpiresAt: Number(anchor.timestamp) + 180,
      deadline, expectedNativeWei: prior?.inner.expectedNativeWei ?? native.toString(), expectedTokenWei: prior?.inner.expectedTokenWei ?? erc20.toString(), positionTokenId, principalLiquidityWei };
    let wallet: ClaimWalletEvidence;
    if (kind === "safe-1.4.1") {
      wallet = await safeWallet(context, actor, head.number, inner, input.safeSignatures);
      inner.nonce = toHex(BigInt(wallet.safe!.nonce));
    } else wallet = { kind, actorCodeHash: payerEvidence.codeHash, actorNonce: payerEvidence.nonce, delegation: kind === "metamask-7702" ? { ...claimDelegatePin } : null, safe: null };
    must(isEarningsClaimRequest(inner) && (!prior || sameEarningsClaimRequest(prior.inner, inner)), "Original claim identity changed");
    let outer: ClaimOuterTransaction | null = { type: "0x2", chainId: inner.chainId, from: payer, to: inner.to, data: inner.data, value: "0x0", nonce: toHex(BigInt(payerEvidence.nonce)) };
    if (wallet.safe) outer = wallet.safe.approvalsCollected === 2 ? { ...outer, to: actor,
      data: encodeFunctionData({ abi: safeAbi, functionName: "execTransaction", args: [...safeArgs(wallet.safe.transaction).slice(0, 9), wallet.safe.signatures!] as [Address, bigint, Hex, number, bigint, bigint, bigint, Address, Address, Hex] }) } : null;
    const fees = outer ? await estimateClaimExecutionFees(context, outer, kind) : { status: "unavailable" as const, reason: "Two owner approvals are required before exact outer execution can be simulated" };
    if (outer && fees.status !== "unavailable") outer = { ...outer, gas: toHex(BigInt(fees.gasLimit)), maxFeePerGas: toHex(BigInt(fees.maxFeePerGasWei)), maxPriorityFeePerGas: toHex(BigInt(fees.maxPriorityFeePerGasWei)) };
    const body: Omit<ClaimExecutionReview, "intentHash" | "reviewHash"> = { schemaVersion: 1, profile: claimExecutionProfile, chainId: context.chainId,
      scope: context.chainId === 31337 ? "isolated-local" : "production-unsigned", status: !outer ? "awaiting-safe-approvals" : fees.status === "unavailable" ? "fee-unavailable" : "review-only",
      executionEnabled: false, kind, actor, beneficiary, gasPayer: payer, inner, outer, wallet, fees, gasPayerEvidence: payerEvidence,
      authorizations: { ownerApprovalsRequired: wallet.safe ? 2 : 0, ownerApprovalsCollected: wallet.safe?.approvalsCollected ?? 0, walletTransactionConfirmations: 1 },
      observed: { blockNumber: head.number.toString(), blockHash: head.hash!, timestamp: new Date(Number(head.timestamp) * 1000).toISOString() }, expiresAt: inner.reviewExpiresAt,
      holds: [...earningsClaimReadiness().holds], notices: ["Unsigned preparation only; public financial execution is disabled.",
        "Collection credits the ledger; claims pay only the immutable beneficiary. Each execution is a separate transaction.",
        ...(wallet.safe ? ["Safe owner signatures do not authorize a direct EOA claim. Two owner approvals and an external payer transaction are distinct.",
          "Safe signatures have no encoded expiry for ordinary claims. Off-chain review expiry is not revocation; only Safe nonce consumption or an inner contract deadline bounds existing signatures."]
          : kind === "metamask-7702" ? ["Direct owner-controlled type-2 transaction only. No delegation authorization, session key, UserOperation or relayer execution is prepared."] : [])] };
    const r = { ...body, intentHash: claimExecutionIdentity(body), reviewHash: "0x" as Hex };
    r.reviewHash = claimExecutionReviewHash(r); must(isClaimExecutionReview(r));
    return r;
  } catch (e) { return { status: "unavailable", reason: e instanceof Error ? e.message : "Claim profile unavailable", executionEnabled: false }; }
}

/** Re-read wallet authority at the exact observation/receipt block. This never
 * sends or signs, and does not substitute a latest state for historical proof. */
export async function verifyClaimExecutionProfileAt(context: EarningsReadContext, review: ClaimExecutionReview, blockNumber: bigint, phase: "review" | "receipt" | "reverted-receipt") {
  try {
    must(claimContextIsAllowed(context, true) && isClaimExecutionReview(review) && context.chainId === review.chainId);
    // This API proves historical identity at a specific block. Pending/latest
    // checks belong to fresh preparation/revalidation, never receipt recovery.
    const payer = await directWallet(context, review.gasPayer, blockNumber, false);
    must(payer.kind === review.gasPayerEvidence.kind && same(payer.codeHash, review.gasPayerEvidence.codeHash));
    must(phase === "review" ? payer.nonce === review.gasPayerEvidence.nonce : BigInt(payer.nonce) >= BigInt(review.gasPayerEvidence.nonce) + 1n);
    if (review.wallet.safe) {
      const observed = await safeWallet(context, review.actor, blockNumber, review.inner);
      const before = review.wallet.safe, after = observed.safe!;
      must(same(observed.actorCodeHash, review.wallet.actorCodeHash) && observed.actorNonce === review.wallet.actorNonce
        && JSON.stringify(after.owners) === JSON.stringify(before.owners) && after.threshold === before.threshold);
      must(phase === "receipt" ? BigInt(after.nonce) >= BigInt(before.nonce) + 1n : after.nonce === before.nonce);
      must(same(hashTypedData(claimSafeTypedData(context.chainId, review.actor, before.transaction)), before.transactionHash));
      if (before.approvalsCollected === 2) { must(before.signatures); await verifySafeSignatures(after.owners, before.transactionHash, before.signatures); }
      // safeWallet's observed digest uses its current nonce. Existing signed
      // authority remains bound to the original proposal and original owners.
      if (phase === "review") must(same(after.transactionHash, before.transactionHash));
    } else {
      must(review.kind === payer.kind && same(review.wallet.actorCodeHash, payer.codeHash));
      if (review.kind === "metamask-7702") must(review.wallet.delegation && same(review.wallet.delegation.address, claimDelegatePin.address)
        && same(review.wallet.delegation.designator, claimDelegatePin.designator) && same(review.wallet.delegation.runtimeHash, claimDelegatePin.runtimeHash));
    }
    return true;
  } catch { return false; }
}

/** Refresh evidence without silently replacing the user's reviewed envelope,
 * nonce, amounts, fee ceiling or canonical review anchor. */
export async function revalidateClaimExecutionReview(context: EarningsReadContext, registration: EarningsRegistration | undefined, review: ClaimExecutionReview): Promise<ClaimPreparationResult> {
  try {
    must(isClaimExecutionReview(review) && review.status === "review-only" && review.outer && review.fees.status !== "unavailable");
    const latest = await prepareClaimExecutionReview({ context, registration, operation: review.inner.operation,
      beneficiary: normalize(review.inner.discoveryRecipient), account: review.gasPayer, kind: review.kind,
      ...(review.wallet.safe && { safeAddress: review.actor, safeSignatures: review.wallet.safe.signatures! }), prior: review });
    must(isClaimExecutionReview(latest) && latest.status === "review-only" && latest.fees.status !== "unavailable" && latest.intentHash === review.intentHash
      && claimProfileWalletDigest(latest.wallet) === claimProfileWalletDigest(review.wallet)
      && BigInt(latest.fees.gasUnits) <= BigInt(review.fees.gasLimit) && BigInt(latest.fees.baseFeeWei) + BigInt(latest.fees.maxPriorityFeePerGasWei) <= BigInt(review.fees.maxFeePerGasWei)
      && await verifyClaimExecutionProfileAt(context, review, BigInt(context.checkpoint.blockNumber), "review"));
    must(await context.rpc.getBalance({ address: review.gasPayer, blockNumber: BigInt(context.checkpoint.blockNumber) }) >= BigInt(review.fees.proposedMaximumWei));
    return review;
  } catch { return { status: "unavailable", reason: "Original review invalidated; obtain a fresh explicit review", executionEnabled: false }; }
}
const claimProfileWalletDigest = (wallet: ClaimWalletEvidence) => JSON.stringify(wallet);
