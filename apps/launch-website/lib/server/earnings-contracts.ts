import { encodeAbiParameters, erc20Abi, getAddress, getContractAddress, keccak256, parseAbi, parseEventLogs, zeroAddress,
  type Address, type Hex } from "viem";
import { launchTokenSupplyWei } from "../launch-terms";
import { testV4Pins } from "../test-v4";
import { fixtureAddress, fixtureHash, fixtureRpc, verifyCurveFixture, type CurveFixture } from "./curve-fixture";
import { curveProductionDeployment, curveProductionPins, productionReaders } from "./curve-production";

export type EarningsRpc = ReturnType<typeof fixtureRpc>;
export type EarningsPoint = { blockNumber: string; blockHash: Hex; timestamp: string };
export type EarningsRegistration = {
  chainId: number; factory: string; projectRegistry: string; token: string; initialCurve: string; revenueLedger: string;
  creator: string; treasury: string | null; treasuryShareBps: number; totalSupplyWei: string;
  creation: EarningsPoint & { transactionHash: Hex; logIndex: number };
};
export type EarningsReadContext = {
  chainId: 31337 | 4663; rpc: EarningsRpc; factory: Address; factoryRuntimeHash: Hex; registry: Address; registryRuntimeHash: Hex;
  deploymentBlock: bigint; deploymentBlockHash: Hex; checkpoint: EarningsPoint;
  graduation: { address: Address; runtimeHash: Hex; guard: Address; guardRuntimeHash: Hex };
  poolManager: { address: Address; runtimeHash: Hex }; positionManager: { address: Address; runtimeHash: Hex };
  // Internal receipt verification only. Public balance readers never set this.
  historicalReceipt?: true;
};
export type EarningsRole = "creator" | "treasury" | "operations" | "reserve";
export type EarningsContractSnapshot = {
  status: "ready"; chainId: 31337 | 4663; token: Address; beneficiary: Address; observed: EarningsPoint;
  originalCurve: Address; activeCurve: Address; engineVersion: number;
  rights: { creator: Address; treasury: Address | null; treasuryShareBps: number; operations: Address; reserve: Address;
    roles: EarningsRole[]; accountType: "eoa" | "contract" | "delegated-eoa" };
  curve: { ledger: Address; runtimeHash: Hex; claimableNativeWei: string; accruedNativeWei: string; claimedNativeWei: string;
    totalAccruedNativeWei: string; totalClaimedNativeWei: string; claimedSource: "contract-cumulative-credit-difference" };
  lp: { status: "not-graduated" } | { status: "ready"; ledger: Address; runtimeHash: Hex; collectionContract: Address; collectionRuntimeHash: Hex; claimableNativeWei: string; claimableTokenWei: string;
    accruedNativeWei: string; accruedTokenWei: string; claimedNativeWei: string; claimedTokenWei: string;
    uncollectedNativeWei: string; uncollectedTokenWei: string; uncollectedScope: "gross-original-position-not-claimable";
    positionTokenId: string; liquidityWei: string; poolId: Hex; poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
    custody: "original-position-permanently-locked"; claimedSource: "contract-cumulative-credit-difference" };
};
export type FactoryCreationFees = { status: "ready"; chainId: 31337 | 4663; factory: Address; beneficiary: Address; recipient: Address;
  availableNativeWei: string; scope: "factory-global"; permissionlessRelease: true; observed: EarningsPoint };
export const earningsUnavailable = { status: "unavailable" } as const;
export const earningsAbi = parseAbi([
  "function originCurveForToken(address token) view returns (address)", "function curveForToken(address token) view returns (address)",
  "function project(address token) view returns (address factory,address curve,uint32 version,address engine,uint64 migrations)",
  "function graduationEngine() view returns (address)", "function projectRegistry() view returns (address)",
  "function tokenSupply() view returns (uint256)", "function creationFeesAccrued() view returns (uint256)",
  "function operatingRecipient() view returns (address)", "function futureReserveRecipient() view returns (address)",
  "function revenueLedger() view returns (address)", "function factory() view returns (address)", "function token() view returns (address)",
  "function creator() view returns (address)", "function treasury() view returns (address)", "function treasuryShareBps() view returns (uint16)",
  "function curve() view returns (address)", "function activeCurve() view returns (address)", "function executionVersion() view returns (uint32)",
  "function totalAccrued() view returns (uint256)", "function totalClaimed() view returns (uint256)",
  "function claimable(address beneficiary) view returns (uint256)", "function bucketAccrued(uint256 index) view returns (uint256)",
]);
export const lpEarningsAbi = parseAbi([
  "function engine() view returns (address)", "function poolManager() view returns (address)", "function token() view returns (address)",
  "function creator() view returns (address)", "function treasury() view returns (address)", "function treasuryShareBps() view returns (uint16)",
  "function operatingRecipient() view returns (address)", "function futureReserveRecipient() view returns (address)",
  "function totalAccrued() view returns (uint256 nativeAmount,uint256 tokenAmount)", "function totalClaimed() view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function claimable(address beneficiary) view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function bucketAccrued(uint256 index) view returns (uint256 nativeAmount,uint256 tokenAmount)",
]);
const engineAbi = parseAbi([
  "function factory() view returns (address)", "function poolManager() view returns (address)", "function positionManager() view returns (address)",
  "function initializationGuard() view returns (address)", "function lpFeeLedger(address token) view returns (address)",
  "function positions(address token) view returns (uint256 tokenId,uint128 liquidity)",
  "function previewLpFees(address token) view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function canonicalPoolKey(address token) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
]);
const positionAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)", "function getApproved(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)",
]);
const createdAbi = parseAbi(["event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const addr = (a: string) => getAddress(a.toLowerCase());
function must(ok: unknown): asserts ok { if (!ok) throw new Error("Earnings contract evidence unavailable or conflicting"); }
const pair = (p: readonly [bigint, bigint]) => p.every(value => typeof value === "bigint" && value >= 0n && value < 2n ** 256n);
const point = (p: EarningsPoint) => /^[1-9][0-9]{0,15}$/.test(p.blockNumber) && fixtureHash(p.blockHash)
  && typeof p.timestamp === "string" && Number.isFinite(Date.parse(p.timestamp));
const keyHash = (key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }) => keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));

export function earningsContractReader(context: EarningsReadContext) {
  let active = 0, count = 0;
  const waiting: Array<() => void> = [];
  async function read<T>(address: Address, abi: unknown, functionName: string, args: readonly unknown[] = []): Promise<T> {
    if (++count > 128) throw new Error("Earnings read budget exhausted");
    if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try { return await context.rpc.readContract({ address, abi, functionName, args, blockNumber: BigInt(context.checkpoint.blockNumber) } as never) as T; }
    finally { active--; waiting.shift()?.(); }
  }
  return read;
}

export async function verifyEarningsContext(context: EarningsReadContext) {
  must(context.chainId === 31337 || context.chainId === 4663);
  must(point(context.checkpoint) && BigInt(context.checkpoint.blockNumber) >= context.deploymentBlock);
  const number = BigInt(context.checkpoint.blockNumber);
  const [chain, deployment, observed, latest, factoryAtDeployment, factory, registry, engine, guard] = await Promise.all([
    context.rpc.getChainId(), context.rpc.getBlock({ blockNumber: context.deploymentBlock }), context.rpc.getBlock({ blockNumber: number }),
    context.rpc.getBlock({ blockTag: "latest" }), context.rpc.getCode({ address: context.factory, blockNumber: context.deploymentBlock }),
    context.rpc.getCode({ address: context.factory, blockNumber: number }), context.rpc.getCode({ address: context.registry, blockNumber: number }),
    context.rpc.getCode({ address: context.graduation.address, blockNumber: number }), context.rpc.getCode({ address: context.graduation.guard, blockNumber: number }),
  ]);
  must(chain === context.chainId && same(deployment.hash!, context.deploymentBlockHash) && same(observed.hash!, context.checkpoint.blockHash)
    && observed.number === number && new Date(Number(observed.timestamp) * 1000).toISOString() === context.checkpoint.timestamp
    && latest.number >= number && (context.historicalReceipt || latest.number - number <= 256n));
  if (context.chainId === 4663 && !context.historicalReceipt) must(Date.now() - Date.parse(context.checkpoint.timestamp) <= 120000 && Date.parse(context.checkpoint.timestamp) <= Date.now() + 15000);
  must(factoryAtDeployment && factory && registry && engine && guard && same(keccak256(factoryAtDeployment), context.factoryRuntimeHash)
    && same(keccak256(factory), context.factoryRuntimeHash) && same(keccak256(registry), context.registryRuntimeHash)
    && same(keccak256(engine), context.graduation.runtimeHash) && same(keccak256(guard), context.graduation.guardRuntimeHash));
  const read = earningsContractReader(context);
  const [registryBinding, engineBinding, supply, engineFactory, manager, positions, guardBinding] = await Promise.all([
    read<string>(context.factory, earningsAbi, "projectRegistry"), read<string>(context.factory, earningsAbi, "graduationEngine"),
    read<bigint>(context.factory, earningsAbi, "tokenSupply"), read<string>(context.graduation.address, engineAbi, "factory"),
    read<string>(context.graduation.address, engineAbi, "poolManager"), read<string>(context.graduation.address, engineAbi, "positionManager"),
    read<string>(context.graduation.address, engineAbi, "initializationGuard"),
  ]);
  must(same(registryBinding, context.registry) && same(engineBinding, context.graduation.address) && supply === launchTokenSupplyWei
    && same(engineFactory, context.factory) && same(manager, context.poolManager.address) && same(positions, context.positionManager.address)
    && same(guardBinding, context.graduation.guard));
  return observed;
}

async function readUnchecked(context: EarningsReadContext, registration: EarningsRegistration, beneficiary: Address): Promise<EarningsContractSnapshot> {
  const observed = await verifyEarningsContext(context);
  must(registration.chainId === context.chainId && same(registration.factory, context.factory) && same(registration.projectRegistry, context.registry)
    && [registration.token, registration.initialCurve, registration.revenueLedger, registration.creator, beneficiary].every(fixtureAddress)
    && (registration.treasury === null || fixtureAddress(registration.treasury)) && Number.isInteger(registration.treasuryShareBps)
    && registration.treasuryShareBps >= 0 && registration.treasuryShareBps <= 9000 && registration.totalSupplyWei === launchTokenSupplyWei.toString()
    && point(registration.creation) && fixtureHash(registration.creation.transactionHash) && Number.isSafeInteger(registration.creation.logIndex)
    && registration.creation.logIndex >= 0 && BigInt(registration.creation.blockNumber) <= observed.number);
  const token = addr(registration.token), origin = addr(registration.initialCurve), ledger = addr(registration.revenueLedger);
  // The pinned factory constructs the initial curve, whose first CREATE is the
  // immutable revenue ledger. A migration changes activeCurve, not this address.
  must(same(getContractAddress({ from: origin, nonce: 1n }), ledger));
  const number = BigInt(context.checkpoint.blockNumber), read = earningsContractReader(context);
  const [receipt, creationBlock, originInFactory, active, project, originalLedger, asset, originCreator, ledgerCurve, activeAccrual,
    operations, reserve, policyCreator, treasury, share, accrued, claimed, credit, buckets, tokenSupply, tokenNow, tokenAtCreation,
    ledgerNow, ledgerAtCreation, beneficiaryCode, nativeHeld] = await Promise.all([
    context.rpc.getTransactionReceipt({ hash: registration.creation.transactionHash }), context.rpc.getBlock({ blockNumber: BigInt(registration.creation.blockNumber) }),
    read<string>(context.factory, earningsAbi, "originCurveForToken", [token]), read<string>(context.factory, earningsAbi, "curveForToken", [token]),
    read<readonly [string, string, number, string, bigint]>(context.registry, earningsAbi, "project", [token]),
    read<string>(origin, earningsAbi, "revenueLedger"), read<string>(origin, earningsAbi, "token"), read<string>(origin, earningsAbi, "creator"),
    read<string>(ledger, earningsAbi, "curve"), read<string>(ledger, earningsAbi, "activeCurve"),
    read<string>(context.factory, earningsAbi, "operatingRecipient"), read<string>(context.factory, earningsAbi, "futureReserveRecipient"),
    read<string>(ledger, earningsAbi, "creator"), read<string>(ledger, earningsAbi, "treasury"), read<number>(ledger, earningsAbi, "treasuryShareBps"),
    read<bigint>(ledger, earningsAbi, "totalAccrued"), read<bigint>(ledger, earningsAbi, "totalClaimed"), read<bigint>(ledger, earningsAbi, "claimable", [beneficiary]),
    Promise.all([0n, 1n, 2n, 3n].map(index => read<bigint>(ledger, earningsAbi, "bucketAccrued", [index]))),
    read<bigint>(token, erc20Abi, "totalSupply"), context.rpc.getCode({ address: token, blockNumber: number }),
    context.rpc.getCode({ address: token, blockNumber: BigInt(registration.creation.blockNumber) }), context.rpc.getCode({ address: ledger, blockNumber: number }),
    context.rpc.getCode({ address: ledger, blockNumber: BigInt(registration.creation.blockNumber) }), context.rpc.getCode({ address: beneficiary, blockNumber: number }),
    context.rpc.getBalance({ address: ledger, blockNumber: number }),
  ]);
  must(receipt.status === "success" && same(receipt.transactionHash, registration.creation.transactionHash)
    && receipt.blockNumber === BigInt(registration.creation.blockNumber) && same(receipt.blockHash, registration.creation.blockHash)
    && same(creationBlock.hash!, registration.creation.blockHash) && receipt.logs.length <= 128
    && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0
    && same(creationBlock.transactions[receipt.transactionIndex] as string, registration.creation.transactionHash)
    && new Set(receipt.logs.map(log => log.logIndex)).size === receipt.logs.length
    && receipt.logs.every(log => !log.removed && log.logIndex !== null && log.logIndex >= 0 && log.blockNumber === receipt.blockNumber
      && same(log.blockHash!, receipt.blockHash) && same(log.transactionHash!, receipt.transactionHash)
      && log.transactionIndex === receipt.transactionIndex && log.data.length <= 8194));
  const created = parseEventLogs({ abi: createdAbi, eventName: "CurveCreated", strict: true,
    logs: receipt.logs.filter(log => same(log.address, context.factory) && log.logIndex === registration.creation.logIndex && !log.removed) });
  must(created.length === 1 && same(created[0].args.token, token) && same(created[0].args.curve, origin)
    && same(created[0].args.creator, registration.creator) && same(created[0].args.revenueLedger, ledger)
    && created[0].args.supply === launchTokenSupplyWei && same(created[0].args.treasury, registration.treasury ?? zeroAddress)
    && created[0].args.treasuryShareBps === registration.treasuryShareBps);
  must(same(originInFactory, origin) && same(originalLedger, ledger) && same(asset, token) && same(originCreator, registration.creator)
    && same(ledgerCurve, origin) && same(project[0], context.factory) && same(project[1], active) && same(activeAccrual, active)
    && project[2] >= 1 && project[2] <= 0xffffffff && same(policyCreator, registration.creator) && same(treasury, registration.treasury ?? zeroAddress)
    && share === registration.treasuryShareBps && tokenSupply === launchTokenSupplyWei && tokenNow && tokenAtCreation && ledgerNow && ledgerAtCreation
    && same(keccak256(tokenNow), keccak256(tokenAtCreation)) && same(keccak256(ledgerNow), keccak256(ledgerAtCreation)));
  const activeLedger = await read<string>(addr(active), earningsAbi, "revenueLedger");
  const [ledgerOperations, ledgerReserve] = await Promise.all([read<string>(ledger, earningsAbi, "operatingRecipient"), read<string>(ledger, earningsAbi, "futureReserveRecipient")]);
  must(same(activeLedger, ledger) && same(ledgerOperations, operations) && same(ledgerReserve, reserve)
    && [operations, reserve].every(fixtureAddress) && !same(operations, reserve)
    && accrued >= claimed && nativeHeld >= accrued - claimed && buckets.reduce((a, b) => a + b, 0n) === accrued && credit >= 0n && credit <= accrued - claimed);
  const recipients = [registration.creator, registration.treasury ?? zeroAddress, operations, reserve];
  const allRoles = ["creator", "treasury", "operations", "reserve"] as const;
  const indices = recipients.flatMap((recipient, index) => same(recipient, beneficiary) ? [index] : []);
  const beneficiaryAccrued = indices.reduce((sum, index) => sum + buckets[index], 0n);
  must(beneficiaryAccrued >= credit);
  const result: EarningsContractSnapshot = { status: "ready", chainId: context.chainId, token, beneficiary, observed: context.checkpoint,
    originalCurve: origin, activeCurve: addr(active), engineVersion: project[2],
    rights: { creator: addr(registration.creator), treasury: registration.treasury ? addr(registration.treasury) : null, treasuryShareBps: share,
      operations: addr(operations), reserve: addr(reserve), roles: indices.map(index => allRoles[index]),
      accountType: beneficiaryCode && /^0xef0100[0-9a-f]{40}$/i.test(beneficiaryCode) ? "delegated-eoa" : beneficiaryCode && beneficiaryCode !== "0x" ? "contract" : "eoa" },
    curve: { ledger, runtimeHash: keccak256(ledgerNow!), claimableNativeWei: credit.toString(), accruedNativeWei: beneficiaryAccrued.toString(),
      claimedNativeWei: (beneficiaryAccrued - credit).toString(), totalAccruedNativeWei: accrued.toString(), totalClaimedNativeWei: claimed.toString(),
      claimedSource: "contract-cumulative-credit-difference" }, lp: { status: "not-graduated" } };
  const [position, lpLedger] = await Promise.all([
    read<readonly [bigint, bigint]>(context.graduation.address, engineAbi, "positions", [token]),
    read<string>(context.graduation.address, engineAbi, "lpFeeLedger", [token]),
  ]);
  if (position[0] === 0n || position[1] === 0n) must(position[0] === 0n && position[1] === 0n && same(lpLedger, zeroAddress));
  else {
    must(fixtureAddress(lpLedger));
    const l = addr(lpLedger);
    const [poolKey, owner, approval, liquidity, positionInfo, preview, managerCode, positionCode, lpCode, lpEngine, lpManager, lpToken,
      lpCreator, lpTreasury, lpShare, lpOperations, lpReserve, lpAccrued, lpClaimed, lpCredit, lpBuckets, lpNativeHeld, lpTokenHeld] = await Promise.all([
      read<{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }>(context.graduation.address, engineAbi, "canonicalPoolKey", [token]),
      read<string>(context.positionManager.address, positionAbi, "ownerOf", [position[0]]), read<string>(context.positionManager.address, positionAbi, "getApproved", [position[0]]),
      read<bigint>(context.positionManager.address, positionAbi, "getPositionLiquidity", [position[0]]),
      read<readonly [{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }, bigint]>(context.positionManager.address, positionAbi, "getPoolAndPositionInfo", [position[0]]),
      read<readonly [bigint, bigint]>(context.graduation.address, engineAbi, "previewLpFees", [token]),
      context.rpc.getCode({ address: context.poolManager.address, blockNumber: number }), context.rpc.getCode({ address: context.positionManager.address, blockNumber: number }),
      context.rpc.getCode({ address: l, blockNumber: number }), read<string>(l, lpEarningsAbi, "engine"), read<string>(l, lpEarningsAbi, "poolManager"),
      read<string>(l, lpEarningsAbi, "token"), read<string>(l, lpEarningsAbi, "creator"), read<string>(l, lpEarningsAbi, "treasury"),
      read<number>(l, lpEarningsAbi, "treasuryShareBps"), read<string>(l, lpEarningsAbi, "operatingRecipient"), read<string>(l, lpEarningsAbi, "futureReserveRecipient"),
      read<readonly [bigint, bigint]>(l, lpEarningsAbi, "totalAccrued"), read<readonly [bigint, bigint]>(l, lpEarningsAbi, "totalClaimed"),
      read<readonly [bigint, bigint]>(l, lpEarningsAbi, "claimable", [beneficiary]),
      Promise.all([0n, 1n, 2n, 3n].map(index => read<readonly [bigint, bigint]>(l, lpEarningsAbi, "bucketAccrued", [index]))),
      context.rpc.getBalance({ address: l, blockNumber: number }), read<bigint>(token, erc20Abi, "balanceOf", [l]),
    ]);
    must(same(owner, context.graduation.address) && same(approval, zeroAddress) && liquidity === position[1]
      && poolKey.currency0 === zeroAddress && same(poolKey.currency1, token) && poolKey.fee === 3000 && poolKey.tickSpacing === 60
      && same(poolKey.hooks, context.graduation.guard) && same(keyHash(poolKey), keyHash(positionInfo[0]))
      && BigInt.asIntN(24, positionInfo[1] >> 8n) === -887220n && BigInt.asIntN(24, positionInfo[1] >> 32n) === 887220n
      && managerCode && positionCode && lpCode && same(keccak256(managerCode), context.poolManager.runtimeHash)
      && same(keccak256(positionCode), context.positionManager.runtimeHash) && same(lpEngine, context.graduation.address)
      && same(lpManager, context.poolManager.address) && same(lpToken, token) && same(lpCreator, registration.creator)
      && same(lpTreasury, registration.treasury ?? zeroAddress) && lpShare === share && same(lpOperations, operations) && same(lpReserve, reserve)
      && [preview, lpAccrued, lpClaimed, lpCredit, ...lpBuckets].every(pair)
      && lpNativeHeld >= lpAccrued[0] - lpClaimed[0] && lpTokenHeld >= lpAccrued[1] - lpClaimed[1]);
    const beneficiaryLp = [0, 1].map(asset => indices.reduce((sum, index) => sum + lpBuckets[index][asset], 0n));
    for (const asset of [0, 1]) must(lpAccrued[asset] >= lpClaimed[asset] && lpCredit[asset] <= lpAccrued[asset] - lpClaimed[asset]
      && lpBuckets.reduce((sum, amounts) => sum + amounts[asset], 0n) === lpAccrued[asset] && beneficiaryLp[asset] >= lpCredit[asset]);
    result.lp = { status: "ready", ledger: l, runtimeHash: keccak256(lpCode!), collectionContract: context.graduation.address,
      collectionRuntimeHash: context.graduation.runtimeHash, claimableNativeWei: lpCredit[0].toString(), claimableTokenWei: lpCredit[1].toString(),
      accruedNativeWei: beneficiaryLp[0].toString(), accruedTokenWei: beneficiaryLp[1].toString(),
      claimedNativeWei: (beneficiaryLp[0] - lpCredit[0]).toString(), claimedTokenWei: (beneficiaryLp[1] - lpCredit[1]).toString(),
      uncollectedNativeWei: preview[0].toString(), uncollectedTokenWei: preview[1].toString(), uncollectedScope: "gross-original-position-not-claimable",
      positionTokenId: position[0].toString(), liquidityWei: position[1].toString(), poolId: keyHash(poolKey), poolKey,
      custody: "original-position-permanently-locked", claimedSource: "contract-cumulative-credit-difference" };
  }
  must(same((await context.rpc.getBlock({ blockNumber: number })).hash!, context.checkpoint.blockHash));
  return result;
}

export async function readEarningsContracts(context: EarningsReadContext, registration: EarningsRegistration, beneficiary: Address) {
  try { return await readUnchecked(context, registration, beneficiary); } catch { return earningsUnavailable; }
}

export async function readFactoryCreationFees(context: EarningsReadContext, beneficiary: Address): Promise<FactoryCreationFees | typeof earningsUnavailable> {
  try {
    await verifyEarningsContext(context);
    const read = earningsContractReader(context);
    const [recipient, amount, held] = await Promise.all([read<string>(context.factory, earningsAbi, "operatingRecipient"),
      read<bigint>(context.factory, earningsAbi, "creationFeesAccrued"), context.rpc.getBalance({ address: context.factory, blockNumber: BigInt(context.checkpoint.blockNumber) })]);
    must(fixtureAddress(recipient) && amount >= 0n && held >= amount && same((await context.rpc.getBlock({ blockNumber: BigInt(context.checkpoint.blockNumber) })).hash!, context.checkpoint.blockHash));
    return { status: "ready", chainId: context.chainId, factory: context.factory, beneficiary, recipient: addr(recipient), availableNativeWei: amount.toString(),
      scope: "factory-global", permissionlessRelease: true, observed: context.checkpoint };
  } catch { return earningsUnavailable; }
}

export async function fixtureEarningsContext(fixture: CurveFixture, checkpoint?: EarningsPoint): Promise<EarningsReadContext> {
  const rpc = fixtureRpc(fixture), head = await verifyCurveFixture(fixture, rpc);
  if (!fixture.graduation || !head.hash) throw new Error("Pinned fixture graduation binding required");
  return { chainId: 31337, rpc, factory: fixture.factory, factoryRuntimeHash: fixture.factoryRuntimeHash,
    registry: fixture.registry, registryRuntimeHash: fixture.registryRuntimeHash, deploymentBlock: fixture.deploymentBlock, deploymentBlockHash: fixture.deploymentBlockHash,
    checkpoint: checkpoint ?? { blockNumber: head.number.toString(), blockHash: head.hash, timestamp: new Date(Number(head.timestamp) * 1000).toISOString() },
    graduation: { address: fixture.graduation.engine, runtimeHash: fixture.graduation.engineRuntimeHash, guard: fixture.graduation.guard, guardRuntimeHash: fixture.graduation.guardRuntimeHash },
    poolManager: { address: testV4Pins.poolManager.address, runtimeHash: testV4Pins.poolManager.hash },
    positionManager: { address: testV4Pins.positionManager.address, runtimeHash: testV4Pins.positionManager.hash } };
}

export async function readFixtureEarningsContracts(fixture: CurveFixture, registration: EarningsRegistration, beneficiary: Address, checkpoint?: EarningsPoint) {
  try { return await readEarningsContracts(await fixtureEarningsContext(fixture, checkpoint), registration, beneficiary); } catch { return earningsUnavailable; }
}

export function productionEarningsContext(rpc: EarningsRpc, checkpoint: EarningsPoint): EarningsReadContext {
  return { chainId: 4663, rpc, factory: curveProductionPins.factory[0], factoryRuntimeHash: curveProductionPins.factory[1], registry: curveProductionPins.registry[0],
    registryRuntimeHash: curveProductionPins.registry[1], deploymentBlock: curveProductionDeployment.blockNumber, deploymentBlockHash: curveProductionDeployment.blockHash, checkpoint,
    graduation: { address: curveProductionPins.engine[0], runtimeHash: curveProductionPins.engine[1], guard: curveProductionPins.guard[0], guardRuntimeHash: curveProductionPins.guard[1] },
    poolManager: { address: curveProductionPins.poolManager[0], runtimeHash: curveProductionPins.poolManager[1] },
    positionManager: { address: curveProductionPins.positionManager[0], runtimeHash: curveProductionPins.positionManager[1] } };
}

export async function readProductionEarningsContracts(registration: EarningsRegistration, beneficiary: Address, checkpoint: EarningsPoint) {
  const results = await Promise.all(productionReaders().map(rpc => readEarningsContracts(productionEarningsContext(rpc, checkpoint), registration, beneficiary)));
  return results[0].status === "ready" && JSON.stringify(results[0]) === JSON.stringify(results[1]) ? results[0] : earningsUnavailable;
}
