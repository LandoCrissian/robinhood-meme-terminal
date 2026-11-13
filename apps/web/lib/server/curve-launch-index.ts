import { DatabaseSync } from "node:sqlite";
import { erc20Abi, isHash, parseAbi, parseEventLogs, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { projectCurveReceipt } from "../launchpad/curve-receipt";
import { curveAbi, curveCreatedEvent, curveFactoryAbi, curveGraduatedEvent, curveLedgerAbi, curveRegistryAbi, graduationEngineEvent,
  sameCurveAddress, type CurveLaunch, type CurveState } from "../launchpad/curve-v1";
import { launchPoolId } from "../launchpad/launch-record";
import { boundedReceiptLogs } from "../launchpad/receipt-logs";
import { canonicalLaunchpadBlock, readLaunchpadBlock, type LaunchpadObservedBlock } from "./new-launchpad-finality";
import type { readCurveRuntime, verifiedCurveRuntime } from "./curve-launch-config";

type Runtime = NonNullable<ReturnType<typeof readCurveRuntime>>;
type Ready = Awaited<ReturnType<typeof verifiedCurveRuntime>>;
type EventIdentity = { transactionHash: Hash; blockHash: Hash; blockNumber: string; logIndex: number };
const maxRange = 128n;
const maxLogs = 80;
const retainedCheckpoints = 24;
const checkedPositionAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)", "function getPositionLiquidity(uint256 tokenId) view returns (uint128)"]);

function eventIdentity(log: { transactionHash: Hash | null; blockHash: Hash | null; blockNumber: bigint | null; logIndex: number | null; removed?: boolean }): EventIdentity {
  if (!log.transactionHash || !isHash(log.transactionHash) || !log.blockHash || !isHash(log.blockHash) || log.blockNumber === null
    || log.logIndex === null || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || log.removed) throw new Error("Curve event is outside canonical bounds.");
  return { transactionHash: log.transactionHash, blockHash: log.blockHash, blockNumber: log.blockNumber.toString(), logIndex: log.logIndex };
}

async function verifiedCreation(rpc: PublicClient, factory: Address, hash: Hash, head: bigint) {
  const receipt = await rpc.getTransactionReceipt({ hash });
  const launch = projectCurveReceipt(factory, receipt);
  if (!sameCurveAddress(launch.transactionHash, hash)) throw new Error("Curve receipt hash mismatch.");
  const block = await readLaunchpadBlock(rpc, receipt.blockNumber, head);
  if (block.hash !== launch.blockHash) throw new Error("Curve creation is no longer canonical.");
  const canonical = canonicalLaunchpadBlock(block);
  const curve = { address: launch.curve, abi: curveAbi, ...canonical } as const;
  const [registered, curveFactory, token, creator, ledger, supply, ledgerCurve, treasury, treasuryShareBps] = await Promise.all([
    rpc.readContract({ address: factory, abi: curveFactoryAbi, functionName: "curveForToken", args: [launch.token], ...canonical }),
    rpc.readContract({ ...curve, functionName: "factory" }),
    rpc.readContract({ ...curve, functionName: "token" }),
    rpc.readContract({ ...curve, functionName: "creator" }),
    rpc.readContract({ ...curve, functionName: "revenueLedger" }),
    rpc.readContract({ address: launch.token, abi: erc20Abi, functionName: "totalSupply", ...canonical }),
    rpc.readContract({ address: launch.ledger, abi: curveLedgerAbi, functionName: "curve", ...canonical }),
    rpc.readContract({ ...curve, functionName: "treasury" }),
    rpc.readContract({ ...curve, functionName: "treasuryShareBps" }),
  ]);
  if (!sameCurveAddress(registered, launch.curve) || !sameCurveAddress(curveFactory, factory) || !sameCurveAddress(token, launch.token)
    || !sameCurveAddress(creator, launch.creator) || !sameCurveAddress(ledger, launch.ledger) || !sameCurveAddress(ledgerCurve, launch.curve)
    || !sameCurveAddress(treasury, launch.treasury) || treasuryShareBps !== launch.treasuryShareBps || supply.toString() !== launch.totalSupply) {
    throw new Error("Curve launch factory or token binding mismatch.");
  }
  return launch;
}

export class CurveLaunchIndex {
  private readonly db: DatabaseSync;
  constructor(private readonly config: Runtime) {
    this.db = new DatabaseSync(config.databasePath);
    try {
      this.db.exec(`PRAGMA busy_timeout=2500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
        CREATE TABLE IF NOT EXISTS curve_checkpoints(scope TEXT NOT NULL,height INTEGER NOT NULL,hash TEXT NOT NULL,
          PRIMARY KEY(scope,height));
        CREATE TABLE IF NOT EXISTS curve_anchors(scope TEXT PRIMARY KEY,height INTEGER NOT NULL,hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS curve_launches(scope TEXT NOT NULL,token TEXT NOT NULL,creator TEXT NOT NULL,height INTEGER NOT NULL,
          tx TEXT NOT NULL,idx INTEGER NOT NULL,payload TEXT NOT NULL, PRIMARY KEY(scope,token),UNIQUE(scope,tx,idx),UNIQUE(scope,height,idx));
        CREATE TABLE IF NOT EXISTS curve_graduations(scope TEXT NOT NULL,token TEXT NOT NULL,height INTEGER NOT NULL,tx TEXT NOT NULL,
          idx INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,token),UNIQUE(scope,tx,idx),UNIQUE(scope,height,idx));
        CREATE TABLE IF NOT EXISTS curve_quota(scope TEXT PRIMARY KEY,window INTEGER NOT NULL,requests INTEGER NOT NULL);`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() { this.db.close(); }
  consume(now = Date.now()) {
    const window = Math.floor(now / 60_000);
    return Boolean(this.db.prepare(`INSERT INTO curve_quota(scope,window,requests) VALUES (?, ?,1)
      ON CONFLICT(scope) DO UPDATE SET window=excluded.window,requests=CASE WHEN window=excluded.window THEN requests+1 ELSE 1 END
      WHERE window<>excluded.window OR requests<60 RETURNING requests`).get(this.config.scope, window));
  }
  private checkpoints() {
    return this.db.prepare("SELECT height,hash FROM curve_checkpoints WHERE scope=? ORDER BY height DESC LIMIT ?")
      .all(this.config.scope, retainedCheckpoints).map((row) => ({ number: BigInt(String(row.height)), hash: row.hash as Hash }));
  }
  private writeLaunch(record: CurveLaunch) {
    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload) > 4_096) throw new Error("Curve record exceeds storage limit.");
    const existing = this.db.prepare("SELECT payload FROM curve_launches WHERE scope=? AND token=?").get(this.config.scope, record.token.toLowerCase());
    if (existing && existing.payload !== payload) throw new Error("Conflicting curve creation evidence.");
    if (!existing) this.db.prepare("INSERT INTO curve_launches(scope,token,creator,height,tx,idx,payload) VALUES(?,?,?,?,?,?,?)")
      .run(this.config.scope, record.token.toLowerCase(), record.creator.toLowerCase(), BigInt(record.blockNumber),
        record.transactionHash.toLowerCase(), record.logIndex, payload);
  }
  private writeGraduation(token: Address, evidence: EventIdentity) {
    const payload = JSON.stringify(evidence);
    const existing = this.db.prepare("SELECT payload FROM curve_graduations WHERE scope=? AND token=?").get(this.config.scope, token.toLowerCase());
    if (existing && existing.payload !== payload) throw new Error("Conflicting curve graduation evidence.");
    if (!existing) this.db.prepare("INSERT INTO curve_graduations(scope,token,height,tx,idx,payload) VALUES(?,?,?,?,?,?)")
      .run(this.config.scope, token.toLowerCase(), BigInt(evidence.blockNumber), evidence.transactionHash.toLowerCase(), evidence.logIndex, payload);
  }
  list(filter: { token?: Address; creator?: Address } = {}) {
    const token = filter.token?.toLowerCase() ?? null;
    const creator = filter.creator?.toLowerCase() ?? null;
    return this.db.prepare(`SELECT payload FROM curve_launches WHERE scope=? AND (? IS NULL OR token=?) AND (? IS NULL OR creator=?)
      ORDER BY height DESC,idx DESC LIMIT 20`).all(this.config.scope, token, token, creator, creator)
      .map(({ payload }) => JSON.parse(String(payload)) as CurveLaunch);
  }
  graduation(token: Address): EventIdentity | undefined {
    const row = this.db.prepare("SELECT payload FROM curve_graduations WHERE scope=? AND token=?").get(this.config.scope, token.toLowerCase());
    return row ? JSON.parse(String(row.payload)) as EventIdentity : undefined;
  }
  async sync({ rpc, browser }: Ready, observed: LaunchpadObservedBlock) {
    const { factory, startBlock, scope } = this.config;
    const checkpoints = this.checkpoints();
    const previous = checkpoints[0];
    if (previous && observed.blockNumber < previous.number) throw new Error("Curve archive is behind the durable cursor.");
    const anchor = await readLaunchpadBlock(rpc, startBlock - 1n, observed.blockNumber);
    const existingAnchor = this.db.prepare("SELECT height,hash FROM curve_anchors WHERE scope=?").get(scope);
    if (existingAnchor && (String(existingAnchor.height) !== anchor.blockNumber.toString() || existingAnchor.hash !== anchor.hash)) {
      throw new Error("Curve deployment ancestry changed.");
    }
    let common: typeof previous | undefined;
    for (const checkpoint of checkpoints) {
      const canonical = await readLaunchpadBlock(rpc, checkpoint.number, observed.blockNumber);
      if (canonical.hash === checkpoint.hash) { common = checkpoint; break; }
    }
    if (previous && !common && (!existingAnchor || previous.number - anchor.blockNumber > maxRange)) {
      throw new Error("Curve reorganization exceeds retained checkpoints.");
    }
    const fromBlock = common ? common.number + 1n : startBlock;
    if (fromBlock > observed.blockNumber) return true;
    const toBlock = fromBlock + maxRange - 1n < observed.blockNumber ? fromBlock + maxRange - 1n : observed.blockNumber;
    const ending = await readLaunchpadBlock(rpc, toBlock, observed.blockNumber);
    const engine = browser.curve!.graduationEngine;
    const [creations, graduations] = await Promise.all([
      rpc.getLogs({ address: factory, event: curveCreatedEvent, fromBlock, toBlock, strict: true }),
      rpc.getLogs({ address: engine, event: graduationEngineEvent, fromBlock, toBlock, strict: true }),
    ]);
    if (creations.length + graduations.length > maxLogs) throw new Error("Curve event range exceeds processing limits.");
    const records: CurveLaunch[] = [];
    for (const log of creations) {
      const event = eventIdentity(log);
      if (BigInt(event.blockNumber) < fromBlock || BigInt(event.blockNumber) > toBlock || !sameCurveAddress(log.address, factory)) {
        throw new Error("Curve creation is outside its indexed range.");
      }
      const launch = await verifiedCreation(rpc, factory, event.transactionHash, observed.blockNumber);
      if (launch.logIndex !== event.logIndex || launch.blockHash !== event.blockHash || launch.blockNumber !== event.blockNumber
        || !sameCurveAddress(launch.token, log.args.token) || !sameCurveAddress(launch.curve, log.args.curve)
        || !sameCurveAddress(launch.creator, log.args.creator) || !sameCurveAddress(launch.intentId, log.args.intentId)) {
        throw new Error("Curve receipt and index log disagree.");
      }
      records.push(launch);
    }
    const transitions: { token: Address; event: EventIdentity }[] = [];
    for (const log of graduations) {
      const event = eventIdentity(log);
      if (BigInt(event.blockNumber) < fromBlock || BigInt(event.blockNumber) > toBlock || !sameCurveAddress(log.address, engine)) {
        throw new Error("Curve graduation is outside its indexed range.");
      }
      const receipt = await rpc.getTransactionReceipt({ hash: event.transactionHash });
      const graduation = projectGraduation(receipt, engine, event, log.args.token);
      const canonical = await readLaunchpadBlock(rpc, receipt.blockNumber, observed.blockNumber);
      if (canonical.hash !== event.blockHash || !sameCurveAddress(graduation.curve, log.args.curve)) {
        throw new Error("Curve graduation receipt and index log disagree.");
      }
      transitions.push({ token: log.args.token, event });
    }
    if ((common && (await readLaunchpadBlock(rpc, common.number, observed.blockNumber)).hash !== common.hash)
      || (await readLaunchpadBlock(rpc, ending.blockNumber, observed.blockNumber)).hash !== ending.hash
      || (await readLaunchpadBlock(rpc, observed.blockNumber, observed.blockNumber)).hash !== observed.hash
      || (await readLaunchpadBlock(rpc, anchor.blockNumber, observed.blockNumber)).hash !== anchor.hash) throw new Error("Curve index range changed branches.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.checkpoints()[0];
      if (current?.number !== previous?.number || current?.hash !== previous?.hash) throw new Error("Curve cursor changed during synchronization.");
      if (!existingAnchor) this.db.prepare("INSERT INTO curve_anchors(scope,height,hash) VALUES(?,?,?)").run(scope, anchor.blockNumber, anchor.hash);
      if (previous && common?.number !== previous.number) {
        for (const table of ["curve_launches", "curve_graduations", "curve_checkpoints"]) {
          this.db.prepare(`DELETE FROM ${table} WHERE scope=? AND height>?`).run(scope, common?.number ?? anchor.blockNumber);
        }
      }
      for (const record of records) this.writeLaunch(record);
      for (const { token, event } of transitions) this.writeGraduation(token, event);
      this.db.prepare("INSERT INTO curve_checkpoints(scope,height,hash) VALUES(?,?,?)").run(scope, ending.blockNumber, ending.hash);
      this.db.prepare(`DELETE FROM curve_checkpoints WHERE scope=? AND height IN
        (SELECT height FROM curve_checkpoints WHERE scope=? ORDER BY height DESC LIMIT -1 OFFSET ?)`).run(scope, scope, retainedCheckpoints);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return toBlock === observed.blockNumber;
  }
}

function projectGraduation(receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>, engine: Address, expected: EventIdentity, token: Address) {
  const { transactionHash, blockHash, blockNumber } = receipt;
  if (receipt.status !== "success" || transactionHash !== expected.transactionHash || blockHash !== expected.blockHash
    || blockNumber.toString() !== expected.blockNumber) throw new Error("Curve graduation transaction does not match the index.");
  const events = parseEventLogs({ abi: [graduationEngineEvent], logs: boundedReceiptLogs(receipt)
    .filter((log) => sameCurveAddress(log.address, engine)) });
  if (events.length !== 1 || events[0].logIndex !== expected.logIndex || !sameCurveAddress(events[0].args.token, token)) {
    throw new Error("Expected one verified graduation event for this token.");
  }
  return events[0].args;
}

async function readProjectHistory(ready: Ready, launch: CurveLaunch, observed: LaunchpadObservedBlock): Promise<CurveState["project"]> {
  const registry = ready.browser.curve?.projectRegistry;
  if (!registry) return;
  const { rpc } = ready;
  const read = { address: registry, abi: curveRegistryAbi, ...canonicalLaunchpadBlock(observed) } as const;
  const curveContract = { address: launch.curve, abi: curveAbi, ...canonicalLaunchpadBlock(observed) } as const;
  const [[factory, curve, currentVersion, currentEngine, count], localVersion, localEngine, localRuntimeHash, economicRules,
    localRegistry, [nextEngine, runtimeHash, deadline, executableAt, expiresAt]] = await Promise.all([
    rpc.readContract({ ...read, functionName: "project", args: [launch.token] }),
    rpc.readContract({ ...curveContract, functionName: "executionVersion" }),
    rpc.readContract({ ...curveContract, functionName: "executionEngine" }),
    rpc.readContract({ ...curveContract, functionName: "executionEngineRuntimeHash" }),
    rpc.readContract({ ...curveContract, functionName: "economicRules" }),
    rpc.readContract({ ...curveContract, functionName: "projectRegistry" }),
    rpc.readContract({ ...read, functionName: "proposal", args: [launch.token] }),
  ]);
  if (!sameCurveAddress(factory, launch.factory) || !sameCurveAddress(curve, launch.curve) || currentVersion < 1
    || sameCurveAddress(currentEngine, zeroAddress) || !sameCurveAddress(localRegistry, registry)
    || currentVersion !== localVersion || !sameCurveAddress(currentEngine, localEngine)
    || (!count && (currentVersion !== 1 || !sameCurveAddress(currentEngine, launch.curve)))) {
    throw new Error("Permanent project identity does not match the curve.");
  }
  const migrations = await Promise.all(Array.from({ length: Number(count < 10n ? count : 10n) }, async (_, offset) => {
    const index = count - BigInt(offset);
    const [fromVersion, toVersion, previousEngine, nextEngine, runtimeHash, effectiveBlock, timestamp] =
      await rpc.readContract({ ...read, functionName: "migration", args: [launch.token, index] });
    if (toVersion <= fromVersion || !isHash(runtimeHash) || effectiveBlock > observed.blockNumber || BigInt(timestamp) > observed.timestamp) {
      throw new Error("Project migration evidence is inconsistent.");
    }
    return { index: index.toString(), fromVersion, toVersion, previousEngine, nextEngine, runtimeHash, blockNumber: effectiveBlock.toString(), timestamp };
  }));
  if (migrations.some((entry, index) => index === 0
    ? entry.toVersion !== currentVersion || !sameCurveAddress(entry.nextEngine, currentEngine) || entry.runtimeHash !== localRuntimeHash
    : entry.toVersion !== migrations[index - 1].fromVersion || !sameCurveAddress(entry.nextEngine, migrations[index - 1].previousEngine))) {
    throw new Error("Project migration history does not resolve to the current version.");
  }
  const pending = sameCurveAddress(nextEngine, zeroAddress) ? undefined : { nextEngine, runtimeHash, deadline, executableAt, expiresAt };
  return { registry, currentVersion, currentEngine, economicRules, count: count.toString(), migrations, pending };
}

export async function readCurveState(ready: Ready, launch: CurveLaunch, observed: LaunchpadObservedBlock, graduation: EventIdentity | undefined, account?: Address) {
  const { rpc, browser } = ready;
  const canonical = canonicalLaunchpadBlock(observed);
  const opening = await readLaunchpadBlock(rpc, BigInt(launch.blockNumber), observed.blockNumber);
  if (opening.hash !== launch.blockHash) throw new Error("Curve creation is no longer canonical.");
  const curve = { address: launch.curve, abi: curveAbi, ...canonical } as const;
  const ledger = { address: launch.ledger, abi: curveLedgerAbi, ...canonical } as const;
  const [sold, backingReserve, graduationSold, graduated, operatingRecipient, futureReserveRecipient, claimable, registered,
    totalAccrued, totalClaimed, buckets, project] = await Promise.all([
    rpc.readContract({ ...curve, functionName: "sold" }),
    rpc.readContract({ ...curve, functionName: "backingReserve" }),
    rpc.readContract({ ...curve, functionName: "graduationSold" }),
    rpc.readContract({ ...curve, functionName: "graduated" }),
    rpc.readContract({ ...curve, functionName: "operatingRecipient" }),
    rpc.readContract({ ...curve, functionName: "futureReserveRecipient" }),
    account ? rpc.readContract({ ...ledger, functionName: "claimable", args: [account] }) : null,
    rpc.readContract({ address: launch.factory, abi: curveFactoryAbi, functionName: "curveForToken", args: [launch.token], ...canonical }),
    rpc.readContract({ ...ledger, functionName: "totalAccrued" }),
    rpc.readContract({ ...ledger, functionName: "totalClaimed" }),
    Promise.all([0n, 1n, 2n, 3n].map((bucket) => rpc.readContract({ ...ledger, functionName: "bucketAccrued", args: [bucket] }))),
    readProjectHistory(ready, launch, observed),
  ]);
  if (!sameCurveAddress(registered, launch.curve) || !graduationSold || sold > graduationSold
    || totalAccrued !== buckets.reduce((total, entry) => total + entry, 0n) || totalClaimed > totalAccrued
    || (claimable !== null && claimable > totalAccrued - totalClaimed)) throw new Error("Curve registry or revenue binding unavailable.");
  const result: CurveState = { sold: sold.toString(), backingReserve: backingReserve.toString(), graduationSold: graduationSold.toString(),
    graduated, operatingRecipient, futureReserveRecipient, claimable: claimable?.toString() ?? null, blockHash: observed.hash,
    blockNumber: observed.blockNumber.toString(), totalAccrued: totalAccrued.toString(), totalClaimed: totalClaimed.toString(),
    bucketAccrued: [buckets[0].toString(), buckets[1].toString(), buckets[2].toString(), buckets[3].toString()], project };
  if (graduated && graduation) {
    const engine = browser.curve!.graduationEngine;
    const receipt = await rpc.getTransactionReceipt({ hash: graduation.transactionHash });
    const event = projectGraduation(receipt, engine, graduation, launch.token);
    const block = await readLaunchpadBlock(rpc, receipt.blockNumber, observed.blockNumber);
    const confirmations = parseEventLogs({ abi: [curveGraduatedEvent], logs: boundedReceiptLogs(receipt)
      .filter((log) => sameCurveAddress(log.address, launch.curve)) });
    const { poolKey, poolId, positionTokenId, sqrtPriceX96, liquidity, nativeUsed, tokenUsed } = event;
    const position = { address: browser.deployment.positionManager, abi: checkedPositionAbi, args: [positionTokenId], ...canonical } as const;
    const [recordedPool, recordedPosition, owner, currentLiquidity] = await Promise.all([
      rpc.readContract({ ...curve, functionName: "poolId" }),
      rpc.readContract({ ...curve, functionName: "positionTokenId" }),
      rpc.readContract({ ...position, functionName: "ownerOf" }),
      rpc.readContract({ ...position, functionName: "getPositionLiquidity" }),
    ]);
    if (block.hash !== receipt.blockHash || !sameCurveAddress(event.curve, launch.curve) || poolKey.currency0 !== zeroAddress
      || !sameCurveAddress(poolKey.currency1, launch.token) || !sameCurveAddress(poolKey.hooks, browser.deployment.initializationGuard)
      || poolKey.fee !== 3_000 || poolKey.tickSpacing !== 60 || launchPoolId(poolKey) !== poolId || recordedPool !== poolId
      || positionTokenId !== recordedPosition || !sameCurveAddress(owner, engine) || currentLiquidity !== liquidity
      || confirmations.length !== 1 || confirmations[0].args.poolId !== poolId
      || confirmations[0].args.positionTokenId !== positionTokenId || confirmations[0].args.nativeUsed !== nativeUsed
      || confirmations[0].args.tokenUsed !== tokenUsed || !liquidity || !nativeUsed || !tokenUsed) {
      throw new Error("Graduation funding and permanent position custody could not be verified.");
    }
    result.position = { ...launch, engineVersion: 2, poolManager: browser.deployment.poolManager, poolId, poolKey,
      positionTokenId: positionTokenId.toString(), sqrtPriceX96: sqrtPriceX96.toString(), tickLower: -887220, tickUpper: 887220,
      liquidity: liquidity.toString(), amount0: nativeUsed.toString(), amount1: tokenUsed.toString(), indexing: "indexed",
      blockTimestamp: block.timestamp.toString(), ...graduation };
    result.positionOwner = owner;
  }
  if ((await readLaunchpadBlock(rpc, observed.blockNumber, observed.blockNumber)).hash !== observed.hash
    || (await readLaunchpadBlock(rpc, opening.blockNumber, observed.blockNumber)).hash !== opening.hash) {
    throw new Error("Curve state changed branches during verification.");
  }
  return result;
}
