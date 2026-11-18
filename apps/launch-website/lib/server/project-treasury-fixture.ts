import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, parseEventLogs, zeroAddress,
  type Address, type Hex } from "viem";
import { materializeProjectTreasuryRuntime, projectTreasuryFactorySignatures, projectTreasurySignatures }
  from "../../../../packages/launchpad-common/project-treasury-runtime.mjs";
import { projectTreasuryFixtureFlag, projectTreasuryProfile, treasuryAddress, treasuryHash,
  type ProjectTreasuryPoint, type ProjectTreasuryProof, type ProjectTreasurySnapshot, type ProjectTreasuryEvent } from "../project-treasury";
import { claimDelegatePin } from "../claim-profiles";
import { configuredCurveFixture, fixtureRpc, sameHex as same, verifyCurveFixture, type CurveFixture } from "./curve-fixture";
import { classifyFixtureTreasury } from "./fixture-treasury";

export const treasuryFactoryAbi = parseAbi(projectTreasuryFactorySignatures);
export const treasuryAbi = parseAbi(projectTreasurySignatures);
const protocolAbi = parseAbi(["function tokenForIntent(address creator,bytes32 intent) view returns(address)",
  "function originCurveForToken(address token) view returns(address)", "function curveForToken(address token) view returns(address)",
  "function creator() view returns(address)", "function treasury() view returns(address)", "function treasuryShareBps() view returns(uint16)",
  "function revenueLedger() view returns(address)", "function token() view returns(address)",
  "function lpFeeLedger(address token) view returns(address)", "function positions(address token) view returns(uint256 tokenId,uint128 liquidity)",
  "function positionManager() view returns(address)", "function ownerOf(uint256 tokenId) view returns(address)",
  "function getApproved(uint256 tokenId) view returns(address)", "function getPositionLiquidity(uint256 tokenId) view returns(uint128)",
  "function claimable(address beneficiary) view returns(uint256)"]);
const lpAbi = parseAbi(["function claimable(address beneficiary) view returns(uint256,uint256)",
  "function creator() view returns(address)", "function treasury() view returns(address)", "function treasuryShareBps() view returns(uint16)",
  "function engine() view returns(address)", "function token() view returns(address)"]);
export type ProjectTreasuryDeployment = {
  schemaVersion: 1; profile: typeof projectTreasuryProfile; chainId: 31337;
  treasuryFactory: Address; factoryRuntimeHash: Hex; coreFactory: Address; coreFactoryRuntimeHash: Hex;
  graduationEngine: Address; graduationRuntimeHash: Hex; tokenRuntimeHash: Hex;
  treasuryCreationCode: Hex; treasuryCreationCodeHash: Hex;
  treasuryRuntimeTemplate: Hex; treasuryImmutableReferences: Record<string, { start: number; length: number }[]>;
  treasuryImmutableNames: Record<string, string>; deployment: ProjectTreasuryPoint & { transactionHash: Hex };
  compilerInputSha256: string;
};
export type ProjectTreasuryFixture = { curve: CurveFixture; module: ProjectTreasuryDeployment };
export type TreasuryRpc = ReturnType<typeof fixtureRpc>;
export type TreasuryHead = Awaited<ReturnType<TreasuryRpc["getBlock"]>> & { number: bigint; hash: Hex };
const normalized = (v: string) => getAddress(v.toLowerCase());
const zero = (v: string) => same(v, zeroAddress);
const fixedSupply = 1_000_000_000n * 10n ** 18n;
export function treasuryRequire(value: unknown, reason = "Project treasury evidence unavailable or conflicting"): asserts value {
  if (!value) throw Error(reason);
}
export function configuredProjectTreasuryFixture(headers: Headers): ProjectTreasuryFixture | null {
  const curve = configuredCurveFixture(headers);
  if (!curve || headers.has("forwarded") || process.env.RMT_PROJECT_TREASURY_FIXTURE !== projectTreasuryFixtureFlag) return null;
  try {
    const path = process.env.RMT_PROJECT_TREASURY_DEPLOYMENT;
    if (!path || !isAbsolute(path) || statSync(path).size > 160_000) return null;
    const m = JSON.parse(readFileSync(path, "utf8")) as ProjectTreasuryDeployment;
    if (m.schemaVersion !== 1 || m.profile !== projectTreasuryProfile || m.chainId !== 31337
      || ![m.treasuryFactory, m.coreFactory, m.graduationEngine].every(treasuryAddress)
      || ![m.factoryRuntimeHash, m.coreFactoryRuntimeHash, m.graduationRuntimeHash, m.tokenRuntimeHash, m.deployment.blockHash, m.deployment.transactionHash].every(treasuryHash)
      || !same(m.coreFactory, curve.factory) || !same(m.coreFactoryRuntimeHash, curve.factoryRuntimeHash)
      || !curve.graduation || !same(m.graduationEngine, curve.graduation.engine) || !same(m.graduationRuntimeHash, curve.graduation.engineRuntimeHash)
      || !/^[1-9][0-9]{0,15}$/.test(m.deployment.blockNumber) || BigInt(m.deployment.blockNumber) < curve.deploymentBlock
      || !/^[0-9a-f]{64}$/.test(m.compilerInputSha256) || !/^0x(?:[0-9a-f]{2}){1,32768}$/i.test(m.treasuryCreationCode)
      || !treasuryHash(m.treasuryCreationCodeHash) || !same(keccak256(m.treasuryCreationCode), m.treasuryCreationCodeHash)) return null;
    materializeProjectTreasuryRuntime(m.treasuryRuntimeTemplate, m.treasuryImmutableReferences, m.treasuryImmutableNames,
      { creator: m.coreFactory, deploymentFactory: m.treasuryFactory, intentId: m.deployment.transactionHash, treasuryShareBps: 0, deploymentChainId: 31337 });
    return { curve, module: m };
  } catch { return null; }
}
export function treasuryPoint(head: TreasuryHead): ProjectTreasuryPoint {
  return { blockNumber: head.number.toString(), blockHash: head.hash, timestamp: new Date(Number(head.timestamp) * 1000).toISOString() };
}
export async function treasuryRead<T>(rpc: TreasuryRpc, target: Address, abi: readonly unknown[], name: string, args: readonly unknown[], block: bigint): Promise<T> {
  return rpc.readContract({ address: target, abi, functionName: name, args, blockNumber: block } as never) as Promise<T>;
}
export async function verifyProjectTreasuryContext(config: ProjectTreasuryFixture) {
  const rpc = fixtureRpc(config.curve), rawHead = await verifyCurveFixture(config.curve, rpc);
  treasuryRequire(rawHead.number !== null && rawHead.hash);
  const head = rawHead as TreasuryHead, m = config.module;
  const [code, birthCode, chain, pins, receipt, block, creationHash] = await Promise.all([
    rpc.getCode({ address: m.treasuryFactory, blockNumber: head.number }),
    rpc.getCode({ address: m.treasuryFactory, blockNumber: BigInt(m.deployment.blockNumber) }),
    treasuryRead<bigint>(rpc, m.treasuryFactory, treasuryFactoryAbi, "deploymentChainId", [], head.number),
    treasuryRead<readonly [Address, Hex, Address, Hex, Hex]>(rpc, m.treasuryFactory, treasuryFactoryAbi, "pins", [], head.number),
    rpc.getTransactionReceipt({ hash: m.deployment.transactionHash }), rpc.getBlock({ blockNumber: BigInt(m.deployment.blockNumber) }),
    treasuryRead<Hex>(rpc, m.treasuryFactory, treasuryFactoryAbi, "treasuryCreationCodeHash", [], head.number),
  ]);
  treasuryRequire(code && birthCode && same(keccak256(code), m.factoryRuntimeHash) && same(keccak256(birthCode), m.factoryRuntimeHash)
    && chain === 31337n && same(creationHash, m.treasuryCreationCodeHash) && same(pins[0], m.coreFactory) && same(pins[1], m.coreFactoryRuntimeHash)
    && same(pins[2], m.graduationEngine) && same(pins[3], m.graduationRuntimeHash) && same(pins[4], m.tokenRuntimeHash)
    && receipt.status === "success" && receipt.to === null && same(receipt.contractAddress!, m.treasuryFactory)
    && receipt.blockNumber === BigInt(m.deployment.blockNumber) && same(receipt.blockHash, m.deployment.blockHash)
    && same(block.hash!, receipt.blockHash) && same(block.transactions[receipt.transactionIndex] as Hex, receipt.transactionHash));
  return { rpc, head };
}
export async function readProjectTreasuryProof(config: ProjectTreasuryFixture, rpc: TreasuryRpc, treasury: Address, head: TreasuryHead): Promise<ProjectTreasuryProof> {
  const m = config.module, from = BigInt(m.deployment.blockNumber);
  treasuryRequire(head.number >= from && head.number - from <= 4096n);
  const logs = await rpc.getLogs({ address: m.treasuryFactory, events: treasuryFactoryAbi.filter(v => v.type === "event"), fromBlock: from, toBlock: head.number });
  treasuryRequire(logs.length <= 128);
  const decoded = parseEventLogs({ abi: treasuryFactoryAbi, eventName: "TreasuryCreated", logs, strict: true })
    .filter(log => same((log.args as { treasury: Address }).treasury, treasury));
  treasuryRequire(decoded.length === 1);
  const log = decoded[0], args = log.args as { creator: Address; intentId: Hex; treasury: Address; controller: Address; treasuryShareBps: number };
  treasuryRequire(!log.removed && log.blockNumber !== null && log.blockHash && log.transactionHash && log.logIndex !== null);
  const [transaction, receipt, block, code, initialController, currentCreator, intent, share, deploymentFactory, initialized, pins, mapped, predicted] = await Promise.all([
    rpc.getTransaction({ hash: log.transactionHash }), rpc.getTransactionReceipt({ hash: log.transactionHash }), rpc.getBlock({ blockNumber: log.blockNumber }),
    rpc.getCode({ address: treasury, blockNumber: head.number }),
    treasuryRead<Address>(rpc, treasury, treasuryAbi, "controller", [], log.blockNumber),
    treasuryRead<Address>(rpc, treasury, treasuryAbi, "creator", [], head.number),
    treasuryRead<Hex>(rpc, treasury, treasuryAbi, "intentId", [], head.number),
    treasuryRead<number>(rpc, treasury, treasuryAbi, "treasuryShareBps", [], head.number),
    treasuryRead<Address>(rpc, treasury, treasuryAbi, "deploymentFactory", [], head.number),
    treasuryRead<boolean>(rpc, treasury, treasuryAbi, "controllerInitialized", [], head.number),
    treasuryRead<readonly [Address, Hex, Address, Hex, Hex]>(rpc, treasury, treasuryAbi, "pins", [], head.number),
    treasuryRead<Address>(rpc, m.treasuryFactory, treasuryFactoryAbi, "treasuryForIntent", [args.creator, args.intentId], head.number),
    treasuryRead<Address>(rpc, m.treasuryFactory, treasuryFactoryAbi, "predict", [args.creator, args.intentId, args.controller, args.treasuryShareBps, m.treasuryCreationCode], head.number),
  ]);
  const expectedRuntime = materializeProjectTreasuryRuntime(m.treasuryRuntimeTemplate, m.treasuryImmutableReferences, m.treasuryImmutableNames,
    { creator: args.creator, deploymentFactory: m.treasuryFactory, intentId: args.intentId, treasuryShareBps: args.treasuryShareBps, deploymentChainId: 31337 });
  const input = decodeFunctionData({ abi: treasuryFactoryAbi, data: transaction.input });
  treasuryRequire(receipt.status === "success" && receipt.logs.length <= 128 && same(transaction.to!, m.treasuryFactory)
    && same(transaction.from, args.creator) && transaction.value === 0n && transaction.chainId === 31337
    && input.functionName === "create" && same((input.args as readonly Hex[])[0], args.intentId)
    && same((input.args as readonly string[])[1], args.controller) && Number((input.args as readonly unknown[])[2]) === args.treasuryShareBps
    && same((input.args as readonly Hex[])[3], m.treasuryCreationCode)
    && same(encodeFunctionData({ abi: treasuryFactoryAbi, functionName: "create", args: input.args }), transaction.input)
    && same(receipt.blockHash, log.blockHash) && same(block.hash!, log.blockHash)
    && same(block.transactions[receipt.transactionIndex] as Hex, receipt.transactionHash) && transaction.transactionIndex === receipt.transactionIndex
    && same(transaction.blockHash!, receipt.blockHash) && same(transaction.hash, log.transactionHash)
    && same(receipt.transactionHash, log.transactionHash) && receipt.blockNumber === log.blockNumber && block.number === log.blockNumber
    && receipt.logs.every(l => !l.removed && same(l.transactionHash, receipt.transactionHash) && same(l.blockHash, receipt.blockHash) && l.blockNumber === receipt.blockNumber)
    && receipt.logs.some(l => l.logIndex === log.logIndex && same(l.address, m.treasuryFactory) && same(l.data, log.data)
      && l.topics.length === log.topics.length && l.topics.every((topic, index) => same(topic, log.topics[index])))
    && same(initialController, args.controller) && same(currentCreator, args.creator) && same(intent, args.intentId) && share === args.treasuryShareBps
    && same(deploymentFactory, m.treasuryFactory) && initialized && same(mapped, treasury) && same(predicted, treasury)
    && code && same(code, expectedRuntime) && same(pins[0], m.coreFactory) && same(pins[1], m.coreFactoryRuntimeHash)
    && same(pins[2], m.graduationEngine) && same(pins[3], m.graduationRuntimeHash) && same(pins[4], m.tokenRuntimeHash));
  return { schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, creator: normalized(args.creator), controller: normalized(args.controller),
    intentId: args.intentId, treasuryShareBps: args.treasuryShareBps, treasury: normalized(treasury), treasuryFactory: m.treasuryFactory, coreFactory: m.coreFactory,
    factoryRuntimeHash: m.factoryRuntimeHash, runtimeHash: keccak256(code),
    deployment: { ...treasuryPoint(block as TreasuryHead), transactionHash: receipt.transactionHash, logIndex: log.logIndex } };
}

export async function projectTreasuryControllerKind(rpc: TreasuryRpc, controller: Address, block: bigint): Promise<ProjectTreasurySnapshot["controllerKind"]> {
  const code = await rpc.getCode({ address: controller, blockNumber: block });
  if (!code || code === "0x") return "eoa";
  if (same(code, claimDelegatePin.designator)) {
    const delegate = await rpc.getCode({ address: claimDelegatePin.address, blockNumber: block });
    return delegate && same(keccak256(delegate), claimDelegatePin.runtimeHash) ? "metamask-7702" : "unsupported";
  }
  return await classifyFixtureTreasury(rpc, controller, block) === "safe-1.4.1" ? "safe-1.4.1" : "unsupported";
}

async function indexedTreasuryHistory(config: ProjectTreasuryFixture, treasury: Address) {
  try {
    const url = new URL("/project-treasuries", config.curve.indexerUrl); url.searchParams.set("address", treasury);
    const key = process.env.RMT_CURVE_FIXTURE_READ_KEY;
    treasuryRequire(key && /^[0-9a-f]{64}$/.test(key) && !/^0+$/.test(key));
    const response = await fetch(url, { headers: { "X-RMT-Fixture-Key": key }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3000) });
    treasuryRequire(response.ok && response.body);
    const reader = response.body.getReader(), bytes = new Uint8Array(65536); let length = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break;
        treasuryRequire(length + chunk.value.length <= bytes.length); bytes.set(chunk.value, length); length += chunk.value.length; }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) as {
      chainId: number; profile: string; treasuryFactory: string; checkpoint: ProjectTreasuryPoint;
      treasuries: Array<{ treasury: string }>; events: ProjectTreasuryEvent[];
    };
    treasuryRequire(data.chainId === 31337 && data.profile === projectTreasuryProfile && same(data.treasuryFactory, config.module.treasuryFactory)
      && data.treasuries.length === 1 && same(data.treasuries[0].treasury, treasury) && data.events.length <= 100);
    return { events: data.events, history: { indexed: true, status: "ready" as const, checkpoint: data.checkpoint } };
  } catch { return { events: [], history: { indexed: false, status: "pending" as const } }; }
}

export async function readProjectTreasurySnapshot(config: ProjectTreasuryFixture, treasury: Address, known?: { rpc: TreasuryRpc; head: TreasuryHead }): Promise<ProjectTreasurySnapshot> {
  const { rpc, head } = known ?? await verifyProjectTreasuryContext(config);
  const proof = await readProjectTreasuryProof(config, rpc, treasury, head), m = config.module;
  const read = <T>(fn: string, args: readonly unknown[] = []) => treasuryRead<T>(rpc, treasury, treasuryAbi, fn, args, head.number);
  const [controller, epoch, storedToken, storedOrigin, storedLedger, storedLp, assets, rotation, pendingIds, enabled, available, policy, last, token] = await Promise.all([
    read<Address>("controller"), read<bigint>("controllerEpoch"), read<Address>("projectToken"), read<Address>("originCurve"), read<Address>("curveLedger"), read<Address>("lpLedger"),
    read<Address[]>("assets"), read<readonly [Address, number, number, bigint]>("pendingController"), read<bigint[]>("withdrawalIds"),
    read<boolean>("purchasesEnabled"), read<boolean>("purchaseExecutionAvailable"),
    read<readonly [bigint, bigint, bigint, number, number, number, number]>("purchasePolicy"), read<number>("lastPurchaseAt"),
    treasuryRead<Address>(rpc, m.coreFactory, protocolAbi, "tokenForIntent", [proof.creator, proof.intentId], head.number),
  ]);
  treasuryRequire(assets.length <= 8 && new Set(assets.map(a => a.toLowerCase())).size === assets.length
    && pendingIds.length <= 16 && new Set(pendingIds.map(String)).size === pendingIds.length && available === false);
  let original: Address | null = null, active: Address | null = null, ledger: Address | null = null, lp: Address | null = null;
  let curveNative: string | null = null, lpNative: string | null = null, lpToken: string | null = null;
  if (!zero(token)) {
    [original, active] = await Promise.all([
      treasuryRead<Address>(rpc, m.coreFactory, protocolAbi, "originCurveForToken", [token], head.number),
      treasuryRead<Address>(rpc, m.coreFactory, protocolAbi, "curveForToken", [token], head.number),
    ]);
    const [creator, recipient, share, originLedger, balanceSupply, code] = await Promise.all([
      treasuryRead<Address>(rpc, original, protocolAbi, "creator", [], head.number), treasuryRead<Address>(rpc, original, protocolAbi, "treasury", [], head.number),
      treasuryRead<number>(rpc, original, protocolAbi, "treasuryShareBps", [], head.number), treasuryRead<Address>(rpc, original, protocolAbi, "revenueLedger", [], head.number),
      rpc.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply", blockNumber: head.number }), rpc.getCode({ address: token, blockNumber: head.number }),
    ]);
    treasuryRequire(same(creator, proof.creator) && same(recipient, proof.treasuryShareBps ? treasury : zeroAddress)
      && share === proof.treasuryShareBps && balanceSupply === fixedSupply && code && same(keccak256(code), m.tokenRuntimeHash));
    ledger = originLedger;
    curveNative = (await treasuryRead<bigint>(rpc, ledger, protocolAbi, "claimable", [treasury], head.number)).toString();
    const candidateLp = await treasuryRead<Address>(rpc, m.graduationEngine, protocolAbi, "lpFeeLedger", [token], head.number);
    if (!zero(candidateLp)) {
      const [credit, lpCreator, lpTreasury, lpShare, lpEngine, lpAsset, position, manager] = await Promise.all([
        treasuryRead<readonly [bigint, bigint]>(rpc, candidateLp, lpAbi, "claimable", [treasury], head.number),
        treasuryRead<Address>(rpc, candidateLp, lpAbi, "creator", [], head.number), treasuryRead<Address>(rpc, candidateLp, lpAbi, "treasury", [], head.number),
        treasuryRead<number>(rpc, candidateLp, lpAbi, "treasuryShareBps", [], head.number), treasuryRead<Address>(rpc, candidateLp, lpAbi, "engine", [], head.number),
        treasuryRead<Address>(rpc, candidateLp, lpAbi, "token", [], head.number), treasuryRead<readonly [bigint, bigint]>(rpc, m.graduationEngine, protocolAbi, "positions", [token], head.number),
        treasuryRead<Address>(rpc, m.graduationEngine, protocolAbi, "positionManager", [], head.number),
      ]);
      const [owner, approved, liquidity] = await Promise.all([
        treasuryRead<Address>(rpc, manager, protocolAbi, "ownerOf", [position[0]], head.number),
        treasuryRead<Address>(rpc, manager, protocolAbi, "getApproved", [position[0]], head.number),
        treasuryRead<bigint>(rpc, manager, protocolAbi, "getPositionLiquidity", [position[0]], head.number),
      ]);
      treasuryRequire(same(lpCreator, proof.creator) && same(lpTreasury, proof.treasuryShareBps ? treasury : zeroAddress)
        && lpShare === proof.treasuryShareBps && same(lpEngine, m.graduationEngine) && same(lpAsset, token)
        && same(owner, m.graduationEngine) && zero(approved) && liquidity === position[1] && liquidity > 0n);
      lp = candidateLp; lpNative = credit[0].toString(); lpToken = credit[1].toString();
    }
    treasuryRequire(zero(storedToken) || same(storedToken, token) && same(storedOrigin, original) && same(storedLedger, ledger));
    treasuryRequire(zero(storedLp) || lp && same(storedLp, lp));
  } else treasuryRequire(zero(storedToken) && zero(storedOrigin) && zero(storedLedger) && zero(storedLp));
  const assetRows: ProjectTreasurySnapshot["assets"] = [];
  for (const asset of [zeroAddress, ...assets]) {
    const [actual, accounted, reserved, totals, symbol] = await Promise.all([
      zero(asset) ? rpc.getBalance({ address: treasury, blockNumber: head.number }) : rpc.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [treasury], blockNumber: head.number }),
      read<bigint>("accountedHeld", [asset]), read<bigint>("reserved", [asset]),
      read<readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint]>("totals", [asset]),
      zero(asset) ? "ETH" : rpc.readContract({ address: asset, abi: erc20Abi, functionName: "symbol", blockNumber: head.number }),
    ]);
    treasuryRequire(actual >= accounted && accounted >= reserved && symbol.length <= 32 && totals[6] === 0n);
    treasuryRequire(totals[0] + totals[1] + totals[2] + totals[3] + totals[4] - totals[5] === accounted);
    if (!zero(asset)) {
      const [code, pin] = await Promise.all([rpc.getCode({ address: asset, blockNumber: head.number }), read<readonly [Hex, boolean]>("assetPolicy", [asset])]);
      treasuryRequire(code && same(keccak256(code), m.tokenRuntimeHash) && same(pin[0], m.tokenRuntimeHash));
    }
    assetRows.push({ address: zero(asset) ? null : asset, symbol, heldWei: actual.toString(), availableWei: (accounted - reserved).toString(),
      unclassifiedWei: (actual - accounted).toString(), manualWei: totals[0].toString(), declaredFundingWei: totals[1].toString(), unsolicitedWei: totals[2].toString(),
      feesReceivedWei: (totals[3] + totals[4]).toString(), withdrawnWei: totals[5].toString(), purchasedWei: totals[6].toString(),
      reservedWei: reserved.toString(), support: zero(asset) ? "native" : "reviewed-standard" });
  }
  const withdrawals: ProjectTreasurySnapshot["withdrawals"] = [];
  for (const id of pendingIds) {
    const w = await read<readonly [Address, Address, bigint, number, number, bigint, number]>("withdrawals", [id]);
    if (w[6] === 1) withdrawals.push({ id: "0x" + id.toString(16).padStart(64, "0") as Hex, asset: w[0], recipient: w[1], amountWei: w[2].toString(),
      readyAt: String(w[3]), expiresAt: String(w[4]), epoch: w[5].toString() });
  }
  treasuryRequire(withdrawals.length <= 16);
  const history = await indexedTreasuryHistory(config, treasury);
  const canonical = await rpc.getBlock({ blockNumber: head.number }); treasuryRequire(same(canonical.hash!, head.hash));
  return { status: "ready", schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false,
    proof, treasury, creator: proof.creator, controller, controllerEpoch: epoch.toString(), intentId: proof.intentId, treasuryShareBps: proof.treasuryShareBps,
    controllerKind: await projectTreasuryControllerKind(rpc, controller, head.number),
    project: { status: zero(token) ? "unbound" : zero(storedToken) ? "verified-unbound" : "bound", token: zero(token) ? null : token,
      originalCurve: original, activeCurve: active, curveLedger: ledger, lpLedger: lp, graduated: lp !== null },
    assets: assetRows, earnings: { status: zero(token) ? "not-bound" : "ready", curveNativeWei: curveNative, lpNativeWei: lpNative, lpTokenWei: lpToken },
    purchases: { enabled, available: false, reason: "V1 has no admitted independent price reference or purchase route. No purchases can execute.",
      pendingAuthorization: "controller-review-required", rules: { perTransactionWei: policy[0].toString(), perPeriodWei: policy[1].toString(), minimumWei: policy[2].toString(),
        cooldownSeconds: String(policy[3]), periodSeconds: String(policy[4]), maxSlippageBps: policy[5], maxImpactBps: policy[6], lastPurchaseAt: String(last) } },
    rotation: zero(rotation[0]) ? null : { incoming: rotation[0], readyAt: String(rotation[1]), expiresAt: String(rotation[2]), epoch: rotation[3].toString() },
    withdrawals, ...history, observed: treasuryPoint(head), notices: [
      "Local synthetic contracts and assets only. Public execution remains disabled.",
      "Declared royalties are payer-provided labels, not marketplace enforcement or independently proven collection revenue.",
      "Manual funds, earned fees, unclassified transfers and queued withdrawals are separate. Disabling purchase intent does not stop deposits or authorized withdrawals.",
      "V1 admits ETH and explicitly reviewed fixed-supply TokenV2 assets only; arbitrary, fee-on-transfer and rebasing tokens are unsupported.",
    ] };
}
