import { encodeFunctionData, erc20Abi, getAddress, keccak256, parseEventLogs, toHex, zeroAddress, type Address, type Hex } from "viem";
import { configuredProjectTreasuryFixture, projectTreasuryControllerKind, readProjectTreasuryProof, readProjectTreasurySnapshot,
  treasuryAbi, treasuryFactoryAbi, treasuryPoint, treasuryRead, treasuryRequire, verifyProjectTreasuryContext,
  type ProjectTreasuryFixture, type TreasuryHead, type TreasuryRpc } from "./project-treasury-fixture";
import { projectTreasuryOperations, projectTreasuryProfile, projectTreasuryReviewHash, treasuryAddress, treasuryHash, isProjectTreasuryReview,
  type ProjectTreasuryOperation, type ProjectTreasuryPreview, type ProjectTreasuryReview, type ProjectTreasuryVerification } from "../project-treasury";
import { sameHex as same } from "./curve-fixture";
import { claimDelegatePin } from "../claim-profiles";
import { claimProfileDigest } from "../claim-profiles";
import { encodeEarningsClaim, type EarningsClaimOperation, type EarningsClaimRequest } from "../earnings-claims";
import { fixtureEarningsContext, readEarningsContracts } from "./earnings-contracts";
import { readFixtureBirth, readFixtureClaimIndexed, verifyProfiledEarningsClaim } from "./earnings-claims";
import { assertNativeTransferProof } from "../../../../packages/launchpad-common/native-proof.mjs";

const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff" };
const reply = (body: object, status = 200) => Response.json(body, { status, headers });
const quantity = (v: unknown) => typeof v === "string" && /^(?:0|[1-9][0-9]{0,77}|0x[0-9a-f]{1,64})$/i.test(v) && BigInt(v) < 2n ** 256n;
const normalized = (v: string) => getAddress(v.toLowerCase());
const knownOwnerAddresses = new Set(["0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca", "0xc447a378cfd8460febc2eef67501d7a5473b9001",
  "0xc3600f2df60929d2ab9ab294cff42eedcb984f51", "0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697"]);
const synthetic = (v: unknown): v is Address => treasuryAddress(v) && !knownOwnerAddresses.has(v.toLowerCase());
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k))
  && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const argsObject = (v: unknown): v is Record<string, string | number | boolean> => !!v && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).length <= 12 && Object.values(v).every(x => typeof x === "string" && x.length <= 128 || typeof x === "boolean" || Number.isSafeInteger(x));
const stripState = (args: Record<string, string | number | boolean>) => Object.fromEntries(Object.entries(args).filter(([name]) => !["controllerEpoch", "purchasePolicyEpoch"].includes(name)));
const calldata = (factory: boolean, name: string, args: readonly unknown[]) => encodeFunctionData({ abi: factory ? treasuryFactoryAbi : treasuryAbi, functionName: name, args } as never);

const earningsOperation = (operation: ProjectTreasuryOperation): EarningsClaimOperation | undefined => ({
  "claim-curve": "curve-claim", "collect-lp": "lp-collect", "claim-lp": "lp-claim", "claim-lp-native": "lp-claim-native", "claim-lp-token": "lp-claim-token",
} as Partial<Record<ProjectTreasuryOperation, EarningsClaimOperation>>)[operation];
async function treasuryEarningsRequest(config: ProjectTreasuryFixture, rpc: TreasuryRpc, head: TreasuryHead, treasury: Address,
  operation: ProjectTreasuryOperation, args: Record<string, string | number | boolean>, prior?: EarningsClaimRequest): Promise<EarningsClaimRequest | undefined> {
  const op = earningsOperation(operation); if (!op) return;
  const token = await treasuryRead<Address>(rpc, config.module.coreFactory, parseAbiForProject(), "tokenForIntent", [
    await treasuryRead<Address>(rpc, treasury, treasuryAbi, "creator", [], head.number),
    await treasuryRead<Hex>(rpc, treasury, treasuryAbi, "intentId", [], head.number),
  ], head.number);
  const birth = await readFixtureBirth(config.curve, token, treasury), context = await fixtureEarningsContext(config.curve, treasuryPoint(head));
  const state = await readEarningsContracts(context, birth.registration, treasury); treasuryRequire(state.status === "ready");
  let ledger = state.curve.ledger, target = ledger, targetHash = state.curve.runtimeHash, beneficiary = treasury;
  let native = state.curve.claimableNativeWei, tokens = "0", positionTokenId: string | null = null, principalLiquidityWei: string | null = null;
  if (op !== "curve-claim") {
    treasuryRequire(state.lp.status === "ready"); const lp = state.lp;
    ledger = lp.ledger; target = ledger; targetHash = lp.runtimeHash; positionTokenId = lp.positionTokenId; principalLiquidityWei = lp.liquidityWei;
    native = op === "lp-claim-token" ? "0" : lp.claimableNativeWei; tokens = op === "lp-claim-native" ? "0" : lp.claimableTokenWei;
    if (op === "lp-collect") { target = lp.collectionContract; targetHash = lp.collectionRuntimeHash; beneficiary = ledger;
      native = lp.uncollectedNativeWei; tokens = lp.uncollectedTokenWei; }
  }
  treasuryRequire(BigInt(native) > 0n || BigInt(tokens) > 0n, "No verified fee credits are currently available");
  const anchor = prior ? { number: BigInt(prior.reviewBlockNumber), hash: prior.reviewBlockHash, timestamp: BigInt(prior.reviewTimestamp) } : head;
  const request: EarningsClaimRequest = { schemaVersion: 1, operation: op, chainId: "0x7a69", from: treasury, to: target,
    data: await encodeEarningsClaim(op, token, op === "lp-collect" ? String(args.deadline) : null), value: "0x0",
    nonce: prior?.nonce ?? toHex(await rpc.getTransactionCount({ address: treasury, blockNumber: head.number })), factory: config.curve.factory,
    token, originCurve: state.originalCurve, ledger, beneficiary, discoveryRecipient: treasury,
    factoryRuntimeHash: config.curve.factoryRuntimeHash, targetRuntimeHash: targetHash, deploymentBlockNumber: toHex(config.curve.deploymentBlock),
    deploymentBlockHash: config.curve.deploymentBlockHash, reviewBlockNumber: toHex(anchor.number), reviewBlockHash: anchor.hash!,
    reviewTimestamp: Number(anchor.timestamp), reviewExpiresAt: Number(anchor.timestamp) + 180,
    deadline: op === "lp-collect" ? String(args.deadline) : null, expectedNativeWei: prior?.expectedNativeWei ?? native,
    expectedTokenWei: prior?.expectedTokenWei ?? tokens, positionTokenId, principalLiquidityWei };
  treasuryRequire(BigInt(native) >= BigInt(request.expectedNativeWei) && BigInt(tokens) >= BigInt(request.expectedTokenWei));
  return request;
}
function parseAbiForProject() { return [{ type: "function", name: "tokenForIntent", stateMutability: "view", inputs: [{ name: "creator", type: "address" },
  { name: "intentId", type: "bytes32" }], outputs: [{ name: "", type: "address" }] }] as const; }

function reviewedCalldata(config: ProjectTreasuryFixture, review: ProjectTreasuryReview): Hex {
  const a = stripState(review.args), op = review.operation;
  if (op === "create-treasury") return calldata(true, "create", [review.intentId, review.controller, Number(a.treasuryShareBps), config.module.treasuryCreationCode]);
  if (op === "bind-project") return calldata(false, "bindProject", []);
  if (op === "claim-curve") return calldata(false, "claimCurve", []);
  if (op === "collect-lp") return calldata(false, "collectLpFees", [BigInt(a.deadline as string)]);
  if (["claim-lp", "claim-lp-native", "claim-lp-token"].includes(op)) return calldata(false, "claimLp", [op === "claim-lp" ? 0 : op === "claim-lp-native" ? 1 : 2]);
  if (op === "set-purchases") return !a.enabled ? calldata(false, "disablePurchases", []) : calldata(false, "setPurchasePolicy", [{
    perTransactionWei: BigInt(a.perTransactionWei as string), perPeriodWei: BigInt(a.perPeriodWei as string), minimumWei: BigInt(a.minimumWei as string),
    cooldownSeconds: Number(a.cooldownSeconds), periodSeconds: Number(a.periodSeconds), maxSlippageBps: Number(a.maxSlippageBps), maxImpactBps: Number(a.maxImpactBps),
  }, true]);
  if (op === "schedule-controller") return calldata(false, "proposeController", [a.incoming, BigInt(a.expiresAt as string)]);
  if (op === "cancel-controller") return calldata(false, "cancelControllerChange", []);
  if (op === "accept-controller") return calldata(false, "acceptController", []);
  if (op === "schedule-withdrawal") return calldata(false, "queueWithdrawal", [a.asset, a.recipient, BigInt(a.amountWei as string), BigInt(a.expiresAt as string)]);
  if (op === "cancel-withdrawal") return calldata(false, "cancelWithdrawal", [BigInt(a.id as string)]);
  if (op === "execute-withdrawal") return calldata(false, "executeWithdrawal", [BigInt(a.id as string)]);
  throw Error("Unsupported treasury operation");
}

export async function readTreasuryBody(stream: ReadableStream<Uint8Array>, limit = 160 * 1024) {
  const reader = stream.getReader(), buffer = new Uint8Array(limit);
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Treasury body timed out")), 3000); });
  try {
    for (;;) { const item = await Promise.race([reader.read(), timeout]); if (item.done) break;
      treasuryRequire(size + item.value.length <= buffer.length); buffer.set(item.value, size); size += item.value.length; }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))) as unknown;
    treasuryRequire(value && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>;
  } finally { if (timer) clearTimeout(timer); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function previewProjectTreasury(config: ProjectTreasuryFixture, body: Record<string, unknown>): Promise<ProjectTreasuryPreview> {
  treasuryRequire(synthetic(body.account) && treasuryAddress(body.controller) && treasuryHash(body.intentId)
    && Number.isInteger(body.treasuryShareBps) && Number(body.treasuryShareBps) >= 0 && Number(body.treasuryShareBps) <= 9000);
  const { rpc, head } = await verifyProjectTreasuryContext(config), m = config.module;
  const creator = normalized(body.account), controller = normalized(body.controller as string), intentId = body.intentId as Hex, share = Number(body.treasuryShareBps);
  treasuryRequire(await projectTreasuryControllerKind(rpc, controller, head.number) !== "unsupported");
  const [treasury, existing] = await Promise.all([
    treasuryRead<Address>(rpc, m.treasuryFactory, treasuryFactoryAbi, "predict", [creator, intentId, controller, share, m.treasuryCreationCode], head.number),
    treasuryRead<Address>(rpc, m.treasuryFactory, treasuryFactoryAbi, "treasuryForIntent", [creator, intentId], head.number),
  ]);
  treasuryRequire(same(existing, zeroAddress) || same(existing, treasury), "This creator intent already belongs to a different treasury configuration");
  const deployed = !same(existing, zeroAddress), proof = deployed ? await readProjectTreasuryProof(config, rpc, treasury, head) : undefined;
  return { status: "preview", schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, executionEnabled: false,
    treasury, creator, controller, intentId, treasuryShareBps: share, treasuryFactory: m.treasuryFactory, coreFactory: m.coreFactory,
    deployed, ...(proof && { proof }), observed: treasuryPoint(head), purchasesEnabled: false };
}

export async function prepareProjectTreasury(config: ProjectTreasuryFixture, body: Record<string, unknown>, prior?: ProjectTreasuryReview): Promise<ProjectTreasuryReview> {
  treasuryRequire(synthetic(body.account) && typeof body.operation === "string" && projectTreasuryOperations.includes(body.operation as ProjectTreasuryOperation));
  const operation = body.operation as ProjectTreasuryOperation, actor = normalized(body.account), { rpc, head } = await verifyProjectTreasuryContext(config), m = config.module;
  const supplied = body.args ?? {}; treasuryRequire(argsObject(supplied));
  const input = stripState(supplied);
  let creator: Address, controller: Address, intentId: Hex, treasury: Address, target: Address, data: Hex;
  let args: Record<string, string | number | boolean> = {}, targetRuntimeHash = m.factoryRuntimeHash;
  if (operation === "create-treasury") {
    const p = await previewProjectTreasury(config, body);
    treasuryRequire(!p.deployed && !(await rpc.getCode({ address: p.treasury, blockNumber: head.number })), "The predicted treasury is occupied; recover its original creation");
    creator = p.creator; controller = p.controller; intentId = p.intentId; treasury = p.treasury; target = m.treasuryFactory;
    args = { intentId, controller, treasuryShareBps: p.treasuryShareBps };
    data = calldata(true, "create", [intentId, controller, p.treasuryShareBps, m.treasuryCreationCode]);
  } else {
    treasuryRequire(treasuryAddress(body.treasury)); treasury = normalized(body.treasury);
    const proof = await readProjectTreasuryProof(config, rpc, treasury, head); creator = proof.creator; intentId = proof.intentId;
    controller = await treasuryRead<Address>(rpc, treasury, treasuryAbi, "controller", [], head.number);
    const [epoch, policyEpoch] = await Promise.all([
      treasuryRead<bigint>(rpc, treasury, treasuryAbi, "controllerEpoch", [], head.number),
      treasuryRead<bigint>(rpc, treasury, treasuryAbi, "purchasePolicyEpoch", [], head.number),
    ]);
    const permissionless = ["bind-project", "execute-withdrawal", "cancel-withdrawal"].includes(operation);
    treasuryRequire(permissionless || operation === "accept-controller" || same(actor, controller), "Only the treasury controller may authorize this operation");
    target = treasury; targetRuntimeHash = proof.runtimeHash;
    const noArgs = () => treasuryRequire(keys(input, []), "Unexpected treasury operation terms");
    if (operation === "bind-project") { noArgs(); data = calldata(false, "bindProject", []); }
    else if (operation === "claim-curve") { noArgs(); data = calldata(false, "claimCurve", []); }
    else if (["claim-lp", "claim-lp-native", "claim-lp-token"].includes(operation)) {
      noArgs(); data = calldata(false, "claimLp", [operation === "claim-lp" ? 0 : operation === "claim-lp-native" ? 1 : 2]);
    } else if (operation === "collect-lp") {
      treasuryRequire(keys(input, [], ["deadline"])); const deadline = input.deadline ?? (head.timestamp + 180n).toString();
      treasuryRequire(quantity(deadline) && BigInt(deadline as string) > head.timestamp && BigInt(deadline as string) <= head.timestamp + 180n);
      args.deadline = String(deadline); data = calldata(false, "collectLpFees", [BigInt(deadline as string)]);
    } else if (operation === "set-purchases") {
      treasuryRequire(keys(input, ["enabled"], ["perTransactionWei", "perPeriodWei", "minimumWei", "cooldownSeconds", "periodSeconds", "maxSlippageBps", "maxImpactBps"])
        && typeof input.enabled === "boolean");
      if (!input.enabled) { args.enabled = false; data = calldata(false, "disablePurchases", []); }
      else {
        const p = { perTransactionWei: String(input.perTransactionWei ?? "10000000000000000"), perPeriodWei: String(input.perPeriodWei ?? "20000000000000000"),
          minimumWei: String(input.minimumWei ?? "1000000000000000"), cooldownSeconds: Number(input.cooldownSeconds ?? 3600), periodSeconds: Number(input.periodSeconds ?? 86400),
          maxSlippageBps: Number(input.maxSlippageBps ?? 100), maxImpactBps: Number(input.maxImpactBps ?? 100) };
        treasuryRequire([p.perTransactionWei, p.perPeriodWei, p.minimumWei].every(quantity)
          && [p.cooldownSeconds, p.periodSeconds, p.maxSlippageBps, p.maxImpactBps].every(Number.isSafeInteger));
        args = { enabled: true, ...p }; data = calldata(false, "setPurchasePolicy", [{ ...p, perTransactionWei: BigInt(p.perTransactionWei), perPeriodWei: BigInt(p.perPeriodWei), minimumWei: BigInt(p.minimumWei) }, true]);
      }
    } else if (operation === "schedule-controller") {
      treasuryRequire(keys(input, ["incoming"], ["expiresAt"]) && treasuryAddress(input.incoming));
      const expiresAt = String(input.expiresAt ?? head.timestamp + 9n * 86400n);
      treasuryRequire(quantity(expiresAt)); args = { incoming: normalized(input.incoming), expiresAt };
      data = calldata(false, "proposeController", [args.incoming, BigInt(expiresAt)]);
    } else if (operation === "cancel-controller") { noArgs(); data = calldata(false, "cancelControllerChange", []); }
    else if (operation === "accept-controller") { noArgs(); data = calldata(false, "acceptController", []); }
    else if (operation === "schedule-withdrawal") {
      treasuryRequire(keys(input, ["asset", "recipient", "amountWei"], ["expiresAt"])
        && typeof input.asset === "string" && (same(input.asset, zeroAddress) || treasuryAddress(input.asset)) && treasuryAddress(input.recipient)
        && quantity(input.amountWei) && BigInt(input.amountWei as string) > 0n);
      const expiresAt = String(input.expiresAt ?? head.timestamp + 9n * 86400n); treasuryRequire(quantity(expiresAt));
      args = { asset: normalized(input.asset), recipient: normalized(input.recipient), amountWei: String(input.amountWei), expiresAt };
      data = calldata(false, "queueWithdrawal", [args.asset, args.recipient, BigInt(args.amountWei as string), BigInt(expiresAt)]);
    } else if (operation === "cancel-withdrawal" || operation === "execute-withdrawal") {
      treasuryRequire(keys(input, ["id"]) && quantity(input.id) && BigInt(input.id as string) > 0n && BigInt(input.id as string) < 2n ** 64n);
      args.id = BigInt(input.id as string).toString(); data = calldata(false, operation === "cancel-withdrawal" ? "cancelWithdrawal" : "executeWithdrawal", [BigInt(args.id)]);
    } else throw Error("Unsupported treasury operation");
    args.controllerEpoch = epoch.toString(); args.purchasePolicyEpoch = policyEpoch.toString();
  }
  const kind = await projectTreasuryControllerKind(rpc, actor, head.number), actorCode = await rpc.getCode({ address: actor, blockNumber: head.number });
  treasuryRequire(kind !== "unsupported");
  const earningsRequest = operation === "create-treasury" ? undefined : await treasuryEarningsRequest(config, rpc, head, treasury, operation, args, prior?.earningsRequest);
  const innerCall = { from: actor, to: target, data, value: "0x0" as Hex };
  const observed = prior?.observed ?? treasuryPoint(head), expiresAt = prior?.expiresAt ?? Number(head.timestamp) + 180;
  treasuryRequire(head.timestamp < BigInt(expiresAt) && same((await rpc.getBlock({ blockNumber: BigInt(observed.blockNumber) })).hash!, observed.blockHash));
  if (prior) treasuryRequire(prior.operation === operation && same(prior.actor, actor) && same(prior.treasury, treasury)
    && same(prior.targetRuntimeHash, targetRuntimeHash) && claimProfileDigest(prior.args) === claimProfileDigest(args));
  let request: ProjectTreasuryReview["request"] = null, maximumNetworkFeeWei = "0";
  if (kind !== "safe-1.4.1") {
    const [nonce, pendingCode, estimate, latest, priority] = await Promise.all([
      rpc.getTransactionCount({ address: actor, blockTag: "pending" }), rpc.getCode({ address: actor, blockTag: "pending" }),
      rpc.estimateGas({ account: actor, to: target, data, value: 0n, blockNumber: head.number }), rpc.getBlock({ blockTag: "latest" }), rpc.estimateMaxPriorityFeePerGas(),
    ]);
    treasuryRequire(same(pendingCode ?? "0x", actorCode ?? "0x"));
    const gas = estimate * 125n / 100n, fee = (latest.baseFeePerGas ?? 0n) * 2n + priority;
    treasuryRequire(gas > 0n && gas <= 20_000_000n && fee > 0n && nonce < Number.MAX_SAFE_INTEGER);
    request = { type: "0x2", chainId: "0x7a69", ...innerCall, nonce: toHex(nonce), gas: toHex(gas), maxFeePerGas: toHex(fee), maxPriorityFeePerGas: toHex(priority) };
    if (prior?.request) {
      treasuryRequire(BigInt(prior.request.nonce) === BigInt(nonce) && estimate <= BigInt(prior.request.gas)
        && (latest.baseFeePerGas ?? 0n) + priority <= BigInt(prior.request.maxFeePerGas));
      request = prior.request;
    }
    maximumNetworkFeeWei = (BigInt(request.gas) * BigInt(request.maxFeePerGas)).toString();
    treasuryRequire(await rpc.getBalance({ address: actor, blockTag: "pending" }) >= BigInt(maximumNetworkFeeWei), "Insufficient synthetic network funds");
  } else await rpc.call({ account: actor, to: target, data, value: 0n, blockNumber: head.number });
  const bodyReview: Omit<ProjectTreasuryReview, "reviewHash"> = { status: request ? "prepared" : "needs-safe-approvals", schemaVersion: 1,
    profile: projectTreasuryProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false, operation,
    actor, controller, creator, kind: kind === "safe-1.4.1" ? "safe-inner" : kind, intentId, treasury,
    treasuryFactory: m.treasuryFactory, coreFactory: m.coreFactory, targetRuntimeHash, actorCodeHash: keccak256(actorCode ?? "0x"), args,
    request, innerCall, observed, expiresAt, maximumNetworkFeeWei, ...(earningsRequest && { earningsRequest }),
    notices: ["Synthetic chain31337 only; every transaction needs separate explicit test-wallet confirmation.",
      "Network estimates are local-only and contain no production L1 fee quote.",
      "Purchase policy ON is controller intent only. V1 cannot execute purchases without an admitted independent reference; no automatic spend occurs.",
      ...(kind === "safe-1.4.1" ? ["Unsigned Safe inner CALL only. Its owners must approve through the Safe; an EOA owner cannot impersonate the controller. Outer gas is unavailable until that separate execution is prepared."] : [])] };
  const result = { ...bodyReview, reviewHash: projectTreasuryReviewHash(bodyReview) };
  treasuryRequire(isProjectTreasuryReview(result)); return result;
}

export async function verifyProjectTreasuryTransaction(config: ProjectTreasuryFixture, review: ProjectTreasuryReview, hash?: Hex): Promise<ProjectTreasuryVerification> {
  const base = { schemaVersion: 1 as const, profile: projectTreasuryProfile, chainId: 31337 as const, executionEnabled: false as const,
    reviewHash: review.reviewHash, finality: "synthetic-local-not-production" as const } as const;
  try {
    treasuryRequire(isProjectTreasuryReview(review) && review.request && same(review.coreFactory, config.module.coreFactory)
      && same(review.treasuryFactory, config.module.treasuryFactory) && same(review.innerCall.data, reviewedCalldata(config, review)));
    const { rpc, head } = await verifyProjectTreasuryContext(config), q = review.request;
    treasuryRequire(same((await rpc.getBlock({ blockNumber: BigInt(review.observed.blockNumber) })).hash!, review.observed.blockHash));
    let found = hash;
    if (!found) {
      const lower = BigInt(review.observed.blockNumber), upper = head.number;
      treasuryRequire(upper >= lower && upper - lower <= 256n, "Original nonce recovery exceeds its bounded window");
      const nonce = BigInt(q.nonce), latestNonce = await rpc.getTransactionCount({ address: q.from, blockNumber: upper });
      if (BigInt(latestNonce) <= nonce) return { ...base, status: "pending" };
      let lo = lower, hi = upper;
      while (lo < hi) { const middle = (lo + hi) / 2n;
        if (BigInt(await rpc.getTransactionCount({ address: q.from, blockNumber: middle })) > nonce) hi = middle; else lo = middle + 1n; }
      const block = await rpc.getBlock({ blockNumber: lo, includeTransactions: true }); treasuryRequire(block.transactions.length <= 32);
      const matching = block.transactions.filter(tx => same(tx.from, q.from) && BigInt(tx.nonce) === nonce);
      treasuryRequire(matching.length === 1); found = matching[0].hash;
    }
    const tx = await rpc.getTransaction({ hash: found });
    treasuryRequire(same(tx.hash, found) && same(tx.from, q.from) && same(tx.to!, q.to) && same(tx.input, q.data) && tx.value === BigInt(q.value)
      && BigInt(tx.nonce) === BigInt(q.nonce) && tx.chainId === 31337 && tx.type === "eip1559" && !tx.authorizationList
      && !tx.accessList?.length && tx.gas === BigInt(q.gas) && tx.maxFeePerGas === BigInt(q.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(q.maxPriorityFeePerGas));
    if (tx.blockNumber === null) return { ...base, status: "pending", transactionHash: found };
    const receipt = await rpc.getTransactionReceipt({ hash: found }), block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
    treasuryRequire(receipt.blockNumber > BigInt(review.observed.blockNumber) && receipt.blockNumber === tx.blockNumber && receipt.transactionIndex === tx.transactionIndex
      && same(receipt.transactionHash, found) && same(receipt.blockHash, tx.blockHash!) && same(block.hash!, receipt.blockHash)
      && same(block.transactions[receipt.transactionIndex] as Hex, found) && same(receipt.from, q.from) && same(receipt.to!, q.to)
      && receipt.logs.length <= 128 && new Set(receipt.logs.map(l => l.logIndex)).size === receipt.logs.length
      && receipt.logs.every(l => !l.removed && same(l.transactionHash, found!) && same(l.blockHash, receipt.blockHash) && l.blockNumber === receipt.blockNumber));
    const canonical = treasuryPoint(block as TreasuryHead);
    if (receipt.status === "reverted") return { ...base, status: "reverted", transactionHash: found, canonical };
    treasuryRequire(receipt.status === "success");
    if (head.number - receipt.blockNumber < 2n) return { ...base, status: "pending", transactionHash: found };
    const proof = await readProjectTreasuryProof(config, rpc, review.treasury, head);
    treasuryRequire(same(proof.creator, review.creator) && same(proof.intentId, review.intentId)
      && same(review.targetRuntimeHash, review.operation === "create-treasury" ? config.module.factoryRuntimeHash : proof.runtimeHash));
    if (review.operation === "create-treasury") treasuryRequire(same(proof.deployment.transactionHash, found) && same(proof.controller, review.controller)
      && proof.treasuryShareBps === review.args.treasuryShareBps);
    const actorCode = await rpc.getCode({ address: review.actor, blockNumber: receipt.blockNumber });
    treasuryRequire(same(keccak256(actorCode ?? "0x"), review.actorCodeHash));
    if (review.kind === "metamask-7702") {
      const delegate = await rpc.getCode({ address: claimDelegatePin.address, blockNumber: receipt.blockNumber });
      treasuryRequire(delegate && same(actorCode!, claimDelegatePin.designator) && same(keccak256(delegate), claimDelegatePin.runtimeHash));
    }
    let indexedClaim: boolean | undefined;
    if (earningsOperation(review.operation)) {
      const inner = review.earningsRequest;
      treasuryRequire(inner && inner.operation === earningsOperation(review.operation) && same(inner.from, review.treasury)
        && same(inner.discoveryRecipient, review.treasury) && same(inner.factory, config.module.coreFactory));
      const birth = await readFixtureBirth(config.curve, inner.token, review.treasury);
      const context = await fixtureEarningsContext(config.curve, treasuryPoint(head));
      const settled = await verifyProfiledEarningsClaim({ context, registration: birth.registration, request: inner, transactionHash: found,
        outer: { from: q.from, to: q.to, data: q.data, value: "0x0", nonce: q.nonce, type: "0x2", chainId: 31337 },
        indexed: (hash, blockHash, logIndex, amounts) => readFixtureClaimIndexed(config.curve, context, inner, hash, blockHash, logIndex, amounts) });
      if (settled.status === "pending") return { ...base, status: "pending", transactionHash: found, canonical, reason: "Treasury claim payment evidence is incomplete" };
      treasuryRequire(settled.status === "confirmed"); indexedClaim = settled.indexed;
    } else if (review.operation === "execute-withdrawal") {
      const w = await treasuryRead<readonly [Address, Address, bigint, number, number, bigint, number]>(rpc, review.treasury, treasuryAbi, "withdrawals", [BigInt(review.args.id as string)], receipt.blockNumber);
      treasuryRequire(w[6] === 3 && w[2] > 0n);
      if (same(w[0], zeroAddress)) {
        try {
          const trace = await rpc.request({ method: "debug_traceTransaction", params: [found, { tracer: "callTracer" }] } as never, { retryCount: 0 });
          assertNativeTransferProof(trace, { from: q.from, to: q.to, input: q.data, value: 0n }, [{ from: review.treasury, to: w[1], amount: w[2] }]);
        } catch { return { ...base, status: "pending", transactionHash: found, canonical, reason: "Native withdrawal settlement is not independently proven" }; }
      } else {
        const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs.filter(l => same(l.address, w[0])), strict: true });
        treasuryRequire(transfers.length === 1 && same(transfers[0].args.from, review.treasury)
          && same(transfers[0].args.to, w[1]) && transfers[0].args.value === w[2]);
        // A canonical event alone is insufficient settlement evidence. A single
        // transaction block lets independent historical balances prove both sides.
        treasuryRequire(block.transactions.length === 1, "Token withdrawal needs isolated historical balance evidence");
        const balance = (account: Address, at: bigint) => rpc.readContract({ address: w[0], abi: erc20Abi, functionName: "balanceOf", args: [account], blockNumber: at });
        const [heldBefore, heldAfter, recipientBefore, recipientAfter] = await Promise.all([
          balance(review.treasury, receipt.blockNumber - 1n), balance(review.treasury, receipt.blockNumber),
          balance(w[1], receipt.blockNumber - 1n), balance(w[1], receipt.blockNumber),
        ]);
        treasuryRequire(heldBefore >= heldAfter && heldBefore - heldAfter === w[2]
          && recipientAfter >= recipientBefore && recipientAfter - recipientBefore === w[2]);
      }
    }
    const snapshot = await readProjectTreasurySnapshot(config, review.treasury, { rpc, head });
    const indexed = indexedClaim ?? (snapshot.history.indexed && (review.operation === "create-treasury"
      || snapshot.events.some(event => same(event.transactionHash, found!) && same(event.blockHash, receipt.blockHash))));
    return { ...base, status: "confirmed", transactionHash: found, canonical, indexed, proof, snapshot };
  } catch { return { ...base, status: "unavailable", reason: "Canonical treasury transaction, runtime, transfer or indexing evidence unavailable; preserve the original request" }; }
}

let active = 0, minute = -1, calls = 0;
function acquire() { const window = Math.floor(Date.now() / 60000); if (minute !== window) { minute = window; calls = 0; }
  if (active >= 2 || calls >= 60) return null; active++; calls++; return () => { active--; }; }
export async function handleProjectTreasuryRead(request: Request) {
  const config = configuredProjectTreasuryFixture(request.headers);
  if (!config || !["GET", "HEAD"].includes(request.method)) return reply({ status: "unavailable", executionEnabled: false, reason: "Project treasury production discovery is not activated" });
  const url = new URL(request.url), address = url.searchParams.get("address");
  if (url.searchParams.size !== 1 || !treasuryAddress(address)) return reply({ status: "invalid", executionEnabled: false }, 400);
  const release = acquire(); if (!release) return reply({ status: "unavailable", executionEnabled: false }, 429);
  try { return reply(await readProjectTreasurySnapshot(config, normalized(address))); }
  catch { return reply({ status: "unavailable", executionEnabled: false }); } finally { release(); }
}
export async function handleProjectTreasuryTest(request: Request) {
  const config = configuredProjectTreasuryFixture(request.headers);
  if (!config || request.method !== "POST") return reply({ status: "unavailable", executionEnabled: false }, 404);
  const url = new URL(request.url), expected = new URL(config.curve.origin);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== expected.port || url.search || url.hash
    || request.headers.get("origin") !== config.curve.origin || request.headers.has("forwarded")) return reply({ status: "invalid", executionEnabled: false }, 403);
  const length = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json"
    || length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 160 * 1024)) return reply({ status: "invalid", executionEnabled: false }, 400);
  const release = acquire(); if (!release) return reply({ status: "unavailable", executionEnabled: false }, 429);
  let review: ProjectTreasuryReview | undefined;
  try {
    treasuryRequire(request.body); const body = await readTreasuryBody(request.body);
    treasuryRequire(JSON.stringify(body).length <= 32768 || isProjectTreasuryReview(body.review) && body.review.operation === "create-treasury");
    if (body.action === "preview" && keys(body, ["action", "account", "controller", "intentId", "treasuryShareBps"])) return reply(await previewProjectTreasury(config, body));
    if (body.action === "prepare" && keys(body, ["action", "account", "operation"], ["controller", "intentId", "treasuryShareBps", "treasury", "args"])) return reply(await prepareProjectTreasury(config, body));
    if (["verify", "revalidate"].includes(String(body.action)) && keys(body, ["action", "review"], ["transactionHash"]) && isProjectTreasuryReview(body.review)) {
      review = body.review;
      if (body.action === "verify") {
        treasuryRequire(body.transactionHash === undefined || treasuryHash(body.transactionHash));
        return reply(await verifyProjectTreasuryTransaction(config, review, body.transactionHash as Hex | undefined));
      }
      treasuryRequire(body.transactionHash === undefined);
      const checked = await prepareProjectTreasury(config, { account: review.actor, operation: review.operation, treasury: review.treasury,
        controller: review.controller, intentId: review.intentId, treasuryShareBps: review.args.treasuryShareBps, args: review.args }, review);
      return reply({ status: checked.reviewHash === review.reviewHash ? "unchanged" : "unavailable", reviewHash: review.reviewHash, executionEnabled: false });
    }
    return reply({ status: "invalid", executionEnabled: false }, 400);
  } catch {
    return reply(review ? { schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, executionEnabled: false, reviewHash: review.reviewHash,
      status: "unavailable", finality: "synthetic-local-not-production", reason: "Treasury review or canonical evidence unavailable" }
      : { status: "unavailable", executionEnabled: false, reason: "Treasury deployment, identity, balance, authority or simulation unavailable" });
  } finally { release(); }
}
