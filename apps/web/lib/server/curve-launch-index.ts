import { DatabaseSync } from "node:sqlite";
import { erc20Abi, isHash, keccak256, parseAbi, parseEventLogs, toHex, zeroAddress, type Address, type Hash, type PublicClient, type TransactionReceipt } from "viem";
import { assertCurveCreationTransaction, projectCurveReceipt, verifyCurveCreationRefund } from "../launchpad/curve-receipt";
import { curveAbi, curveAssetsMigratedEvent, curveCreatedEvent, curveDirectoryAbi, curveFactoryAbi, curveGraduatedEvent,
  curveGraduationAbi, curveLedgerAbi, curveLpCollectedEvent, curveLpLedgerAbi, curveMaxVersion, curveRegistryAbi, graduationEngineEvent,
  projectMigratedEvent, sameCurveAddress, type CurveCreationFeePolicy, type CurveFeeAmounts, type CurveLaunch, type CurveState } from "../launchpad/curve-v1";
import { launchPoolId } from "../launchpad/launch-record";
import { boundedReceiptLogs } from "../launchpad/receipt-logs";
import { canonicalLaunchpadBlock, readLaunchpadBlock, type LaunchpadObservedBlock } from "./new-launchpad-finality";
import type { readCurveRuntime, verifiedCurveRuntime } from "./curve-launch-config";

type Runtime = NonNullable<ReturnType<typeof readCurveRuntime>>;
type Ready = Awaited<ReturnType<typeof verifiedCurveRuntime>>;
type EventIdentity = { transactionHash: Hash; blockHash: Hash; blockNumber: string; logIndex: number };
type IndexedMigration = EventIdentity & {
  transactionIndex: number; fromCurve: Address; toCurve: Address; version: number;
  backing: string; inventory: string; sold: string; ledger: Address;
};
type IndexedCollection = EventIdentity & { positionTokenId: string; ledger: Address; amounts: CurveFeeAmounts };
const maxRange = 128n;
const maxLogs = 80;
const retainedCheckpoints = 24;
const checkedPositionAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)", "function getPositionLiquidity(uint256 tokenId) view returns (uint128)"]);

function eventIdentity(log: { transactionHash: Hash | null; blockHash: Hash | null; blockNumber: bigint | null; logIndex: number | null; removed?: boolean }): EventIdentity {
  if (!log.transactionHash || !isHash(log.transactionHash) || !log.blockHash || !isHash(log.blockHash) || log.blockNumber === null
    || log.logIndex === null || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || log.removed) throw new Error("Curve event is outside canonical bounds.");
  return { transactionHash: log.transactionHash, blockHash: log.blockHash, blockNumber: log.blockNumber.toString(), logIndex: log.logIndex };
}

async function verifiedCreation(rpc: PublicClient, factory: Address, policy: CurveCreationFeePolicy,
  event: EventIdentity, originLog: { data: `0x${string}`; topics: readonly `0x${string}`[] }, head: bigint) {
  const hash = event.transactionHash;
  const [receipt, transaction] = await Promise.all([rpc.getTransactionReceipt({ hash }), rpc.getTransaction({ hash })]);
  assertEventReceipt(receipt, event);
  if (!sameCurveAddress(transaction.hash, hash) || transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber
    || transaction.transactionIndex !== receipt.transactionIndex || transaction.to?.toLowerCase() !== receipt.to?.toLowerCase()
    || !sameCurveAddress(transaction.from, receipt.from)) throw new Error("Curve creation transaction and receipt disagree.");
  if (!sameCurveAddress(receipt.to, factory)) {
    // Nested smart-account calls have no direct wallet request in this profile. Canonical nested events must not stall direct-launch discovery.
    const nested = boundedReceiptLogs(receipt).find((entry) => entry.logIndex === event.logIndex && sameCurveAddress(entry.address, factory));
    if (!nested || nested.data !== originLog.data || nested.topics.length !== originLog.topics.length
      || nested.topics.some((topic, index) => topic !== originLog.topics[index])
      || (await readLaunchpadBlock(rpc, receipt.blockNumber, head)).hash !== event.blockHash) {
      throw new Error("Nested curve creation does not match its canonical event.");
    }
    return undefined;
  }
  const launch = projectCurveReceipt(factory, receipt, policy);
  assertCurveCreationTransaction(launch, transaction.input, transaction.value);
  await verifyCurveCreationRefund(rpc, receipt, launch, transaction.input, toHex(transaction.value));
  const block = await readLaunchpadBlock(rpc, receipt.blockNumber, head);
  if (block.hash !== launch.blockHash) throw new Error("Curve creation is no longer canonical.");
  const canonical = canonicalLaunchpadBlock(block);
  const curve = { address: launch.curve, abi: curveAbi, ...canonical } as const;
  const [registered, curveFactory, token, creator, ledger, supply, ledgerCurve, treasury, treasuryShareBps, amount, recipient] = await Promise.all([
    rpc.readContract({ address: factory, abi: curveFactoryAbi, functionName: "originCurveForToken", args: [launch.token], ...canonical }),
    rpc.readContract({ ...curve, functionName: "factory" }),
    rpc.readContract({ ...curve, functionName: "token" }),
    rpc.readContract({ ...curve, functionName: "creator" }),
    rpc.readContract({ ...curve, functionName: "revenueLedger" }),
    rpc.readContract({ address: launch.token, abi: erc20Abi, functionName: "totalSupply", ...canonical }),
    rpc.readContract({ address: launch.ledger, abi: curveLedgerAbi, functionName: "curve", ...canonical }),
    rpc.readContract({ ...curve, functionName: "treasury" }),
    rpc.readContract({ ...curve, functionName: "treasuryShareBps" }),
    rpc.readContract({ address: factory, abi: curveFactoryAbi, functionName: "creationFeeWei", ...canonical }),
    rpc.readContract({ address: factory, abi: curveFactoryAbi, functionName: "operatingRecipient", ...canonical }),
  ]);
  if (!sameCurveAddress(registered, launch.curve) || !sameCurveAddress(curveFactory, factory) || !sameCurveAddress(token, launch.token)
    || !sameCurveAddress(creator, launch.creator) || !sameCurveAddress(ledger, launch.ledger) || !sameCurveAddress(ledgerCurve, launch.curve)
    || !sameCurveAddress(treasury, launch.treasury) || treasuryShareBps !== launch.treasuryShareBps || supply.toString() !== launch.totalSupply
    || amount.toString() !== policy.amountWei || !sameCurveAddress(recipient, policy.recipient)) {
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
        CREATE TABLE IF NOT EXISTS curve_migrations(scope TEXT NOT NULL,token TEXT NOT NULL,version INTEGER NOT NULL,height INTEGER NOT NULL,
          tx TEXT NOT NULL,idx INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,token,version),UNIQUE(scope,tx,idx),UNIQUE(scope,height,idx));
        CREATE TABLE IF NOT EXISTS curve_lp_collections(scope TEXT NOT NULL,token TEXT NOT NULL,height INTEGER NOT NULL,tx TEXT NOT NULL,
          idx INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,tx,idx),UNIQUE(scope,height,idx));
        CREATE INDEX IF NOT EXISTS curve_lp_latest ON curve_lp_collections(scope,token,height DESC,idx DESC);
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
  previewTarget(target: Address, creator: Address): CurveLaunch | undefined {
    const scope = this.config.scope;
    const address = target.toLowerCase();
    const matches = this.db.prepare(`SELECT l.payload FROM curve_launches l WHERE l.scope=? AND l.creator=? AND (
      l.token=? OR lower(json_extract(l.payload,'$.curve'))=? OR lower(json_extract(l.payload,'$.ledger'))=?
      OR EXISTS (SELECT 1 FROM curve_migrations m WHERE m.scope=l.scope AND m.token=l.token AND lower(json_extract(m.payload,'$.toCurve'))=?)
      OR EXISTS (SELECT 1 FROM curve_lp_collections c WHERE c.scope=l.scope AND c.token=l.token AND lower(json_extract(c.payload,'$.ledger'))=?)
    ) LIMIT 2`).all(scope, creator.toLowerCase(), address, address, address, address, address);
    return matches.length === 1 ? JSON.parse(String(matches[0].payload)) as CurveLaunch : undefined;
  }
  graduation(token: Address): EventIdentity | undefined {
    const row = this.db.prepare("SELECT payload FROM curve_graduations WHERE scope=? AND token=?").get(this.config.scope, token.toLowerCase());
    return row ? JSON.parse(String(row.payload)) as EventIdentity : undefined;
  }
  migration(token: Address, version: number): IndexedMigration | undefined {
    const row = this.db.prepare("SELECT payload FROM curve_migrations WHERE scope=? AND token=? AND version=?").get(this.config.scope, token.toLowerCase(), version);
    return row ? JSON.parse(String(row.payload)) as IndexedMigration : undefined;
  }
  collection(token: Address): IndexedCollection | undefined {
    const row = this.db.prepare("SELECT payload FROM curve_lp_collections WHERE scope=? AND token=? ORDER BY height DESC,idx DESC LIMIT 1")
      .get(this.config.scope, token.toLowerCase());
    return row ? JSON.parse(String(row.payload)) as IndexedCollection : undefined;
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
    if (!browser.curve) throw new Error("The curve index requires the verified project registry.");
    const { graduationEngine: engine, projectRegistry: registry, creationFee } = browser.curve;
    const logsInRange = (toBlock: bigint) => Promise.all([
      rpc.getLogs({ address: factory, event: curveCreatedEvent, fromBlock, toBlock, strict: true }),
      rpc.getLogs({ address: engine, event: graduationEngineEvent, fromBlock, toBlock, strict: true }),
      rpc.getLogs({ address: factory, event: curveAssetsMigratedEvent, fromBlock, toBlock, strict: true }),
      rpc.getLogs({ address: engine, event: curveLpCollectedEvent, fromBlock, toBlock, strict: true }),
    ]);
    let toBlock = fromBlock + maxRange - 1n < observed.blockNumber ? fromBlock + maxRange - 1n : observed.blockNumber;
    let ending = await readLaunchpadBlock(rpc, toBlock, observed.blockNumber);
    let logs = await logsInRange(toBlock);
    while (logs.reduce((count, batch) => count + batch.length, 0) > maxLogs) {
      if (toBlock === fromBlock) throw new Error("Single curve block exceeds event processing limits.");
      toBlock = fromBlock + (toBlock - fromBlock) / 2n;
      ending = await readLaunchpadBlock(rpc, toBlock, observed.blockNumber);
      logs = await logsInRange(toBlock);
    }
    const [creations, graduations, migrations, collections] = logs;
    const records: CurveLaunch[] = [];
    for (const log of creations) {
      const event = eventIdentity(log);
      if (BigInt(event.blockNumber) < fromBlock || BigInt(event.blockNumber) > toBlock || !sameCurveAddress(log.address, factory)) {
        throw new Error("Curve creation is outside its indexed range.");
      }
      const launch = await verifiedCreation(rpc, factory, creationFee, event, log, observed.blockNumber);
      if (!launch) continue;
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
    const eventReceipt = async (log: Parameters<typeof eventIdentity>[0] & { address: Address }, emitter: Address) => {
      const event = eventIdentity(log);
      if (BigInt(event.blockNumber) < fromBlock || BigInt(event.blockNumber) > toBlock || !sameCurveAddress(log.address, emitter)) {
        throw new Error("Curve lifecycle event is outside its indexed range.");
      }
      const receipt = await rpc.getTransactionReceipt({ hash: event.transactionHash });
      assertEventReceipt(receipt, event);
      const canonical = await readLaunchpadBlock(rpc, receipt.blockNumber, observed.blockNumber);
      if (canonical.hash !== event.blockHash) throw new Error("Curve lifecycle receipt is no longer canonical.");
      return { event, receipt };
    };
    const moves: { token: Address; record: IndexedMigration }[] = [];
    for (const log of migrations) {
      const { event, receipt } = await eventReceipt(log, factory);
      const token = log.args.token;
      const record = projectMigration(receipt, event, factory, registry, token, log.args.version);
      if (!sameCurveAddress(record.fromCurve, log.args.fromCurve) || !sameCurveAddress(record.toCurve, log.args.toCurve)
        || !sameCurveAddress(record.ledger, log.args.ledger) || record.sold !== log.args.sold.toString()
        || record.backing !== log.args.backing.toString() || record.inventory !== log.args.inventory.toString()) {
        throw new Error("Curve migration receipt and index log disagree.");
      }
      moves.push({ token, record });
    }
    const fees: { token: Address; record: IndexedCollection }[] = [];
    for (const log of collections) {
      const { event, receipt } = await eventReceipt(log, engine);
      const token = log.args.token;
      const record = projectCollection(receipt, event, engine, token);
      if (record.positionTokenId !== log.args.positionTokenId.toString() || !sameCurveAddress(record.ledger, log.args.ledger)
        || record.amounts.native !== log.args.nativeAmount.toString() || record.amounts.token !== log.args.tokenAmount.toString()) {
        throw new Error("LP collection receipt and index log disagree.");
      }
      fees.push({ token, record });
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
        for (const table of ["curve_launches", "curve_graduations", "curve_migrations", "curve_lp_collections", "curve_checkpoints"]) {
          this.db.prepare(`DELETE FROM ${table} WHERE scope=? AND height>?`).run(scope, common?.number ?? anchor.blockNumber);
        }
      }
      for (const record of records) this.writeLaunch(record);
      for (const { token, event } of transitions) this.writeGraduation(token, event);
      for (const { token, record } of moves) {
        const existing = this.migration(token, record.version);
        if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("Conflicting indexed migration.");
        if (!existing) this.db.prepare("INSERT INTO curve_migrations(scope,token,version,height,tx,idx,payload) VALUES(?,?,?,?,?,?,?)")
          .run(scope, token.toLowerCase(), record.version, BigInt(record.blockNumber), record.transactionHash, record.logIndex, JSON.stringify(record));
      }
      for (const { token, record } of fees) {
        const payload = JSON.stringify(record);
        const existing = this.db.prepare("SELECT token,payload FROM curve_lp_collections WHERE scope=? AND tx=? AND idx=?")
          .get(scope, record.transactionHash, record.logIndex);
        if (existing && (existing.token !== token.toLowerCase() || existing.payload !== payload)) throw new Error("Conflicting indexed LP collection.");
        if (!existing) this.db.prepare("INSERT INTO curve_lp_collections(scope,token,height,tx,idx,payload) VALUES(?,?,?,?,?,?)")
          .run(scope, token.toLowerCase(), BigInt(record.blockNumber), record.transactionHash, record.logIndex, payload);
      }
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

function assertEventReceipt(receipt: TransactionReceipt, expected: EventIdentity) {
  const { transactionHash, blockHash, blockNumber } = receipt;
  if (receipt.status !== "success" || transactionHash !== expected.transactionHash || blockHash !== expected.blockHash
    || blockNumber.toString() !== expected.blockNumber) throw new Error("Curve lifecycle transaction does not match the index.");
}

function projectMigration(receipt: TransactionReceipt, expected: EventIdentity, factory: Address, registry: Address, token: Address, version: number): IndexedMigration {
  assertEventReceipt(receipt, expected);
  const logs = boundedReceiptLogs(receipt);
  const assets = parseEventLogs({ abi: [curveAssetsMigratedEvent], logs: logs.filter((log) => sameCurveAddress(log.address, factory)) });
  const history = parseEventLogs({ abi: [projectMigratedEvent], logs: logs.filter((log) => sameCurveAddress(log.address, registry)) });
  if (version < 2 || version > curveMaxVersion || assets.length !== 1 || history.length !== 1 || assets[0].logIndex !== expected.logIndex
    || !sameCurveAddress(assets[0].args.token, token) || !sameCurveAddress(history[0].args.token, token)
    || !sameCurveAddress(assets[0].args.toCurve, history[0].args.nextEngine)
    || assets[0].args.version !== version || history[0].args.toVersion !== version
    || history[0].args.index !== BigInt(version - 1)) throw new Error("Missing paired canonical migration events.");
  const { fromCurve, toCurve, sold, backing, inventory, ledger } = assets[0].args;
  return { ...expected, transactionIndex: receipt.transactionIndex, fromCurve, toCurve, version, sold: sold.toString(),
    backing: backing.toString(), inventory: inventory.toString(), ledger };
}

function projectCollection(receipt: TransactionReceipt, expected: EventIdentity, engine: Address, token: Address): IndexedCollection {
  assertEventReceipt(receipt, expected);
  const events = parseEventLogs({ abi: [curveLpCollectedEvent], logs: boundedReceiptLogs(receipt).filter((log) => sameCurveAddress(log.address, engine)) });
  if (events.length !== 1 || events[0].logIndex !== expected.logIndex || !sameCurveAddress(events[0].args.token, token)) {
    throw new Error("Missing canonical LP fee collection event.");
  }
  const { positionTokenId, ledger, nativeAmount, tokenAmount } = events[0].args;
  return { ...expected, positionTokenId: positionTokenId.toString(), ledger, amounts: feeAmounts([nativeAmount, tokenAmount]) };
}

function projectGraduation(receipt: TransactionReceipt, engine: Address, expected: EventIdentity, token: Address) {
  assertEventReceipt(receipt, expected);
  const events = parseEventLogs({ abi: [graduationEngineEvent], logs: boundedReceiptLogs(receipt)
    .filter((log) => sameCurveAddress(log.address, engine)) });
  if (events.length !== 1 || events[0].logIndex !== expected.logIndex || !sameCurveAddress(events[0].args.token, token)) {
    throw new Error("Expected one verified graduation event for this token.");
  }
  return events[0].args;
}

function feeAmounts(pair: readonly [bigint, bigint]): CurveFeeAmounts {
  return { native: pair[0].toString(), token: pair[1].toString() };
}

async function readLpFees(ready: Ready, launch: CurveLaunch, observed: LaunchpadObservedBlock, positionTokenId: bigint,
  originalLiquidity: bigint, operatingRecipient: Address, futureReserveRecipient: Address,
  collection: IndexedCollection | undefined, account?: Address): Promise<CurveState["lpFees"]> {
  const { rpc, browser } = ready;
  const engine = browser.curve!.graduationEngine;
  const canonical = canonicalLaunchpadBlock(observed);
  const manager = { address: engine, abi: curveGraduationAbi, args: [launch.token], ...canonical } as const;
  const [ledger, [registeredPosition, registeredLiquidity]] = await Promise.all([
    rpc.readContract({ ...manager, functionName: "lpFeeLedger" }), rpc.readContract({ ...manager, functionName: "positions" }),
  ]);
  if (ledger === zeroAddress || registeredPosition !== positionTokenId || registeredLiquidity !== originalLiquidity) {
    throw new Error("The locked position has no verified LP fee ledger.");
  }
  const read = { address: ledger, abi: curveLpLedgerAbi, ...canonical } as const;
  const [collected, claimed, buckets, claimable, uncollected, ledgerEngine, managerAddress, token, creator, treasury,
    treasuryShareBps, operating, reserve] = await Promise.all([
    rpc.readContract({ ...read, functionName: "totalAccrued" }),
    rpc.readContract({ ...read, functionName: "totalClaimed" }),
    Promise.all([0n, 1n, 2n, 3n].map((bucket) => rpc.readContract({ ...read, functionName: "bucketAccrued", args: [bucket] }))),
    account ? rpc.readContract({ ...read, functionName: "claimable", args: [account] }) : null,
    rpc.readContract({ ...manager, functionName: "previewLpFees" }).catch(() => null),
    rpc.readContract({ ...read, functionName: "engine" }),
    rpc.readContract({ ...read, functionName: "poolManager" }),
    rpc.readContract({ ...read, functionName: "token" }),
    rpc.readContract({ ...read, functionName: "creator" }),
    rpc.readContract({ ...read, functionName: "treasury" }),
    rpc.readContract({ ...read, functionName: "treasuryShareBps" }),
    rpc.readContract({ ...read, functionName: "operatingRecipient" }),
    rpc.readContract({ ...read, functionName: "futureReserveRecipient" }),
  ]);
  if (!sameCurveAddress(ledgerEngine, engine) || !sameCurveAddress(managerAddress, browser.deployment.poolManager)
    || !sameCurveAddress(token, launch.token) || !sameCurveAddress(creator, launch.creator) || !sameCurveAddress(treasury, launch.treasury)
    || treasuryShareBps !== launch.treasuryShareBps || !sameCurveAddress(operating, operatingRecipient)
    || !sameCurveAddress(reserve, futureReserveRecipient)) throw new Error("LP fee ledger policy does not match the original launch.");
  if ([0, 1].some((asset) => buckets.reduce((total, bucket) => total + bucket[asset], 0n) !== collected[asset]
    || claimed[asset] > collected[asset] || (claimable !== null && claimable[asset] > collected[asset] - claimed[asset]))) {
    throw new Error("LP fee ledger totals are inconsistent.");
  }
  let latestCollection: NonNullable<CurveState["lpFees"]>["latestCollection"];
  if (collection) {
    const receipt = await rpc.getTransactionReceipt({ hash: collection.transactionHash });
    const projected = projectCollection(receipt, collection, engine, launch.token);
    const block = await readLaunchpadBlock(rpc, receipt.blockNumber, observed.blockNumber);
    if (block.hash !== collection.blockHash || !sameCurveAddress(collection.ledger, ledger) || collection.positionTokenId !== positionTokenId.toString()
      || JSON.stringify(projected) !== JSON.stringify(collection) || BigInt(collection.amounts.native) > collected[0]
      || BigInt(collection.amounts.token) > collected[1]) throw new Error("Indexed LP fee collection is inconsistent.");
    const { transactionHash, blockHash, blockNumber, logIndex, amounts } = collection;
    latestCollection = { transactionHash, blockHash, blockNumber, logIndex, amounts };
  } else if (collected[0] || collected[1]) throw new Error("The LP fee ledger has no canonical collection receipt.");
  return { ledger, collected: feeAmounts(collected), claimed: feeAmounts(claimed), bucketAccrued: buckets.map(feeAmounts),
    claimable: claimable ? feeAmounts(claimable) : null, uncollected: uncollected ? feeAmounts(uncollected) : null, latestCollection };
}

type Lifecycle = { graduation?: EventIdentity; migration(version: number): IndexedMigration | undefined; collection?: IndexedCollection };

async function readProjectHistory(ready: Ready, launch: CurveLaunch, observed: LaunchpadObservedBlock, lifecycle: Lifecycle) {
  const registry = ready.browser.curve?.projectRegistry;
  if (!registry) throw new Error("No verified project registry.");
  const { rpc } = ready;
  const canonical = canonicalLaunchpadBlock(observed);
  const read = { address: registry, abi: curveRegistryAbi, ...canonical } as const;
  const factoryRead = { address: launch.factory, abi: curveFactoryAbi, args: [launch.token], ...canonical } as const;
  const [[factory, activeCurve, currentVersion, currentEngine, count], origin, factoryOrigin, factoryActive, directory, nonce, nextVersion,
    [nextEngine, runtimeHash, deadline, executableAt, expiresAt]] = await Promise.all([
    rpc.readContract({ ...read, functionName: "project", args: [launch.token] }),
    rpc.readContract({ ...read, functionName: "originCurve", args: [launch.token] }),
    rpc.readContract({ ...factoryRead, functionName: "originCurveForToken" }),
    rpc.readContract({ ...factoryRead, functionName: "curveForToken" }),
    rpc.readContract({ ...read, functionName: "directory" }),
    rpc.readContract({ ...read, functionName: "migrationNonce", args: [launch.token] }),
    rpc.readContract({ ...read, functionName: "nextMigrationVersion", args: [launch.token] }),
    rpc.readContract({ ...read, functionName: "proposal", args: [launch.token] }),
  ]);
  if (!sameCurveAddress(factory, launch.factory) || !sameCurveAddress(origin, launch.curve)
    || !sameCurveAddress(factoryOrigin, launch.curve) || !sameCurveAddress(activeCurve, currentEngine)
    || !sameCurveAddress(activeCurve, factoryActive) || sameCurveAddress(activeCurve, zeroAddress)
    || currentVersion < 1 || currentVersion > curveMaxVersion || count !== BigInt(currentVersion - 1)
    || (nextVersion !== 0 && (nextVersion > curveMaxVersion || nextVersion !== currentVersion + 1))) {
    throw new Error("Permanent project identity does not match the active curve.");
  }
  const curveContract = { address: activeCurve, abi: curveAbi, ...canonical } as const;
  const pendingNotice = !sameCurveAddress(nextEngine, zeroAddress);
  const [localVersion, localEngine, localRuntimeHash, economicRules, localRegistry, localSource, active, graduated, commitment,
    curveToken, curveFactory, curveLedger, suspended, runtime, candidate, pendingRuntime] = await Promise.all([
    rpc.readContract({ ...curveContract, functionName: "executionVersion" }),
    rpc.readContract({ ...curveContract, functionName: "executionEngine" }),
    rpc.readContract({ ...curveContract, functionName: "executionEngineRuntimeHash" }),
    rpc.readContract({ ...curveContract, functionName: "economicRules" }),
    rpc.readContract({ ...curveContract, functionName: "projectRegistry" }),
    rpc.readContract({ ...curveContract, functionName: "migrationSource" }),
    rpc.readContract({ ...curveContract, functionName: "active" }),
    rpc.readContract({ ...curveContract, functionName: "graduated" }),
    rpc.readContract({ ...curveContract, functionName: "migrationCommitment" }),
    rpc.readContract({ ...curveContract, functionName: "token" }),
    rpc.readContract({ ...curveContract, functionName: "factory" }),
    rpc.readContract({ ...curveContract, functionName: "revenueLedger" }),
    rpc.readContract({ address: directory, abi: curveDirectoryAbi, functionName: "suspended", ...canonical }),
    rpc.getCode({ address: activeCurve, ...canonical }),
    currentVersion < curveMaxVersion && (nextVersion || pendingNotice)
      ? rpc.readContract({ address: launch.factory, abi: curveFactoryAbi, functionName: "migrationCandidate", args: [launch.token, currentVersion + 1], ...canonical })
      : zeroAddress,
    pendingNotice ? rpc.getCode({ address: nextEngine, ...canonical }) : undefined,
  ]);
  if (!sameCurveAddress(localRegistry, registry) || !sameCurveAddress(curveToken, launch.token)
    || !sameCurveAddress(curveFactory, launch.factory) || !sameCurveAddress(curveLedger, launch.ledger)
    || currentVersion !== localVersion || !sameCurveAddress(currentEngine, localEngine) || !runtime || runtime === "0x"
    || localRuntimeHash !== keccak256(runtime) || economicRules !== ready.economicRules
    || (!count && (!sameCurveAddress(currentEngine, launch.curve) || !sameCurveAddress(localSource, zeroAddress)))) {
    throw new Error("Permanent project identity does not match the curve.");
  }
  if ((nextVersion && (!active || graduated || suspended))
    || (pendingNotice && (!sameCurveAddress(candidate, nextEngine) || !pendingRuntime || pendingRuntime === "0x"
      || keccak256(pendingRuntime) !== runtimeHash || currentVersion >= curveMaxVersion))) {
    throw new Error("The proposed successor does not match the pinned project route.");
  }
  const migrations: NonNullable<CurveState["project"]>["migrations"] = [];
  const totalSupply = BigInt(launch.totalSupply);
  // The contract caps history at 31 transitions. Small batches bound concurrent RPC work while retaining every recovery boundary.
  for (let first = count; first > 0n; first -= 4n) {
    migrations.push(...await Promise.all(Array.from({ length: Number(first < 4n ? first : 4n) }, async (_, offset) => {
      const index = first - BigInt(offset);
      const [fromVersion, toVersion, previousEngine, nextEngine, runtimeHash, effectiveBlock, timestamp] =
        await rpc.readContract({ ...read, functionName: "migration", args: [launch.token, index] });
      const evidence = lifecycle.migration(toVersion);
      if (fromVersion !== Number(index) || toVersion !== fromVersion + 1 || !isHash(runtimeHash)
        || effectiveBlock < BigInt(launch.blockNumber) || effectiveBlock > observed.blockNumber || BigInt(timestamp) > observed.timestamp
        || !evidence || evidence.version !== toVersion || evidence.blockNumber !== effectiveBlock.toString()
        || !sameCurveAddress(evidence.fromCurve, previousEngine) || !sameCurveAddress(evidence.toCurve, nextEngine)
        || !sameCurveAddress(evidence.ledger, launch.ledger) || BigInt(evidence.sold) > totalSupply * 3n / 5n
        || BigInt(evidence.inventory) !== totalSupply - BigInt(evidence.sold)) {
        throw new Error("Project migration evidence is inconsistent.");
      }
      const block = await readLaunchpadBlock(rpc, effectiveBlock, observed.blockNumber);
      if (block.hash !== evidence.blockHash || block.timestamp !== BigInt(timestamp)) throw new Error("Project migration is no longer canonical.");
      const { transactionHash, transactionIndex, logIndex, blockHash, backing, inventory, sold } = evidence;
      return { index: index.toString(), fromVersion, toVersion, previousEngine, nextEngine, runtimeHash, blockNumber: effectiveBlock.toString(),
        timestamp, transactionHash, transactionIndex, logIndex, blockHash, backing, inventory, sold };
    })));
  }
  if (migrations.some((entry, index) => index === 0
    ? entry.toVersion !== currentVersion || !sameCurveAddress(entry.nextEngine, currentEngine)
      || entry.runtimeHash !== localRuntimeHash || !sameCurveAddress(localSource, entry.previousEngine)
    : entry.toVersion !== migrations[index - 1].fromVersion || !sameCurveAddress(entry.nextEngine, migrations[index - 1].previousEngine)
      || BigInt(entry.blockNumber) > BigInt(migrations[index - 1].blockNumber)
      || (entry.blockNumber === migrations[index - 1].blockNumber && entry.transactionIndex >= migrations[index - 1].transactionIndex))
    || (migrations.length > 0 && !sameCurveAddress(migrations.at(-1)?.previousEngine, launch.curve))) {
    throw new Error("Project migration history does not resolve to the current version.");
  }
  for (let offset = 0; offset < migrations.length; offset += 4) {
    await Promise.all(migrations.slice(offset, offset + 4).map(async (migration, index) => {
      const previous = { address: migration.previousEngine, abi: curveAbi, ...canonical } as const;
      const priorMigration = migrations[offset + index + 1];
      const [previousActive, migratedTo, previousCommitment, previousVersion, previousSource, previousBacking] = await Promise.all([
        rpc.readContract({ ...previous, functionName: "active" }),
        rpc.readContract({ ...previous, functionName: "migratedTo" }),
        rpc.readContract({ ...previous, functionName: "migrationCommitment" }),
        rpc.readContract({ ...previous, functionName: "executionVersion" }),
        rpc.readContract({ ...previous, functionName: "migrationSource" }),
        rpc.readContract({ ...previous, functionName: "backingReserve" }),
      ]);
      if (previousActive || !sameCurveAddress(migratedTo, migration.nextEngine) || previousCommitment !== commitment
        || previousVersion !== migration.fromVersion || previousBacking !== 0n
        || !sameCurveAddress(previousSource, priorMigration?.previousEngine ?? zeroAddress)) {
        throw new Error("A predecessor curve's closure and successor do not match the migration.");
      }
    }));
  }
  const pendingStatus = observed.timestamp > BigInt(expiresAt || deadline) ? "expired" : !active || graduated || suspended ? "blocked"
    : !executableAt ? "awaiting_approvals" : observed.timestamp < BigInt(executableAt) ? "timelocked" : "executable";
  const pending: NonNullable<CurveState["project"]>["pending"] = pendingNotice
    ? { nextEngine, runtimeHash, deadline, executableAt, expiresAt, status: pendingStatus } : undefined;
  const eligibility = graduated ? "graduated" : !active ? "inactive" : suspended ? "suspended"
    : pending ? "proposal_pending" : nextVersion ? "eligible" : "version_unsupported";
  const project: NonNullable<CurveState["project"]> = { registry, currentVersion, currentEngine, economicRules, count: count.toString(),
    eligibility, migrationNonce: nonce.toString(), migrations, pending,
    ...(nextVersion ? { nextVersion } : {}), ...(candidate === zeroAddress ? {} : { candidate }) };
  return { activeCurve, project, graduated };
}

export async function readCurveState(ready: Ready, launch: CurveLaunch, observed: LaunchpadObservedBlock, lifecycle: Lifecycle, account?: Address) {
  const { rpc, browser } = ready;
  const { graduation } = lifecycle;
  const canonical = canonicalLaunchpadBlock(observed);
  const [opening, { activeCurve, project, graduated }] = await Promise.all([
    readLaunchpadBlock(rpc, BigInt(launch.blockNumber), observed.blockNumber),
    readProjectHistory(ready, launch, observed, lifecycle),
  ]);
  if (opening.hash !== launch.blockHash) throw new Error("Curve creation is no longer canonical.");
  const curve = { address: activeCurve, abi: curveAbi, ...canonical } as const;
  const ledger = { address: launch.ledger, abi: curveLedgerAbi, ...canonical } as const;
  const [sold, backingReserve, graduationSold, graduationBacking, operatingRecipient, futureReserveRecipient, claimable, ledgerOrigin, ledgerActive,
    totalAccrued, totalClaimed, buckets] = await Promise.all([
    rpc.readContract({ ...curve, functionName: "sold" }),
    rpc.readContract({ ...curve, functionName: "backingReserve" }),
    rpc.readContract({ ...curve, functionName: "graduationSold" }),
    rpc.readContract({ ...curve, functionName: "GRADUATION_BACKING" }),
    rpc.readContract({ ...curve, functionName: "operatingRecipient" }),
    rpc.readContract({ ...curve, functionName: "futureReserveRecipient" }),
    account ? rpc.readContract({ ...ledger, functionName: "claimable", args: [account] }) : null,
    rpc.readContract({ ...ledger, functionName: "curve" }),
    rpc.readContract({ ...ledger, functionName: "activeCurve" }),
    rpc.readContract({ ...ledger, functionName: "totalAccrued" }),
    rpc.readContract({ ...ledger, functionName: "totalClaimed" }),
    Promise.all([0n, 1n, 2n, 3n].map((bucket) => rpc.readContract({ ...ledger, functionName: "bucketAccrued", args: [bucket] }))),
  ]);
  if (!sameCurveAddress(ledgerOrigin, launch.curve) || !sameCurveAddress(ledgerActive, activeCurve)
    || graduationSold !== BigInt(launch.totalSupply) * 3n / 5n || sold > graduationSold
    || graduationBacking.toString() !== browser.curve?.graduationBackingWei || backingReserve > graduationBacking
    || totalAccrued !== buckets.reduce((total, entry) => total + entry, 0n) || totalClaimed > totalAccrued
    || (claimable !== null && claimable > totalAccrued - totalClaimed)) throw new Error("Curve registry or revenue binding unavailable.");
  const result: CurveState = { activeCurve, sold: sold.toString(), backingReserve: backingReserve.toString(),
    graduationSold: graduationSold.toString(), graduationBackingWei: graduationBacking.toString(),
    graduated, operatingRecipient, futureReserveRecipient, claimable: claimable?.toString() ?? null, blockHash: observed.hash,
    blockNumber: observed.blockNumber.toString(), totalAccrued: totalAccrued.toString(), totalClaimed: totalClaimed.toString(),
    bucketAccrued: [buckets[0].toString(), buckets[1].toString(), buckets[2].toString(), buckets[3].toString()], project };
  if (graduated && graduation) {
    const engine = browser.curve!.graduationEngine;
    const receipt = await rpc.getTransactionReceipt({ hash: graduation.transactionHash });
    const event = projectGraduation(receipt, engine, graduation, launch.token);
    const block = await readLaunchpadBlock(rpc, receipt.blockNumber, observed.blockNumber);
    const confirmations = parseEventLogs({ abi: [curveGraduatedEvent], logs: boundedReceiptLogs(receipt)
      .filter((log) => sameCurveAddress(log.address, activeCurve)) });
    const { poolKey, poolId, positionTokenId, sqrtPriceX96, liquidity, nativeUsed, tokenUsed } = event;
    const position = { address: browser.deployment.positionManager, abi: checkedPositionAbi, args: [positionTokenId], ...canonical } as const;
    const [recordedPool, recordedPosition, owner, currentLiquidity, lpFees] = await Promise.all([
      rpc.readContract({ ...curve, functionName: "poolId" }),
      rpc.readContract({ ...curve, functionName: "positionTokenId" }),
      rpc.readContract({ ...position, functionName: "ownerOf" }),
      rpc.readContract({ ...position, functionName: "getPositionLiquidity" }),
      readLpFees(ready, launch, observed, positionTokenId, liquidity, operatingRecipient, futureReserveRecipient, lifecycle.collection, account),
    ]);
    if (block.hash !== receipt.blockHash || !sameCurveAddress(event.curve, activeCurve) || poolKey.currency0 !== zeroAddress
      || !sameCurveAddress(poolKey.currency1, launch.token) || !sameCurveAddress(poolKey.hooks, browser.deployment.initializationGuard)
      || poolKey.fee !== 3_000 || poolKey.tickSpacing !== 60 || launchPoolId(poolKey) !== poolId || recordedPool !== poolId
      || positionTokenId !== recordedPosition || !sameCurveAddress(owner, engine) || currentLiquidity !== liquidity
      || confirmations.length !== 1 || confirmations[0].args.poolId !== poolId
      || confirmations[0].args.positionTokenId !== positionTokenId || confirmations[0].args.nativeUsed !== nativeUsed
      || confirmations[0].args.tokenUsed !== tokenUsed || confirmations[0].args.nativeDust !== event.nativeDust
      || confirmations[0].args.tokenDust !== event.tokenDust || nativeUsed + event.nativeDust !== graduationBacking
      || tokenUsed + event.tokenDust !== BigInt(launch.totalSupply) - graduationSold
      || !liquidity || !nativeUsed || !tokenUsed) {
      throw new Error("Graduation funding and permanent position custody could not be verified.");
    }
    result.position = { ...launch, engineVersion: 2, poolManager: browser.deployment.poolManager, poolId, poolKey,
      positionTokenId: positionTokenId.toString(), sqrtPriceX96: sqrtPriceX96.toString(), tickLower: -887220, tickUpper: 887220,
      liquidity: liquidity.toString(), amount0: nativeUsed.toString(), amount1: tokenUsed.toString(), indexing: "indexed",
      blockTimestamp: block.timestamp.toString(), ...graduation };
    result.positionOwner = owner;
    result.lpFees = lpFees;
  }
  if ((await readLaunchpadBlock(rpc, observed.blockNumber, observed.blockNumber)).hash !== observed.hash
    || (await readLaunchpadBlock(rpc, opening.blockNumber, observed.blockNumber)).hash !== opening.hash) {
    throw new Error("Curve state changed branches during verification.");
  }
  return result;
}
