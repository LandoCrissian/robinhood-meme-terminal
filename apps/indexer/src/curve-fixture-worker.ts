import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import pg from "pg";
import { createPublicClient, decodeEventLog, erc20Abi, http, isAddress, parseAbi, toEventSelector, toFunctionSelector, toHex, zeroAddress,
  type Hash, type PublicClient } from "viem";
import { curveFixtureConfig } from "./curve-fixture-config.js";
import { blockEvidence, curveCreationAbi, curveFixedSupplyWei, curveGraduationSoldWei, fixtureChainId, fixtureConfirmations, readCurveLaunchRegistration,
  verifyCurveDeployment, type BlockEvidence, type CurveFixtureBinding, type CurveLaunchRegistration } from "./curve-launch-evidence.js";
import { commitCurveFixtureRange, curveScope, fixtureCheckpoint, initializeCurveFixtureStore,
  loadCurveFixtureCursors, readCurveFixtureRows, readCurveFixtureEarnings, readCurveFixtureFeeActivity, rollbackCurveFixture, storedCurveCheckpoints,
  type CurveFixtureRange } from "./curve-fixture-store.js";
import { fixtureLifecycleState, indexFixtureCurveTransaction, poolManager, verifyFixtureGraduationDeployment, verifyFixtureLifecycleRuntime,
  type FixtureGraduationBinding } from "./curve-fixture-lifecycle.js";
import { fixturePostEventTopics, indexFixturePostTransaction, loadFixtureLpLedger, readFixturePostState, type FixturePostCursor } from "./curve-fixture-post-graduation.js";
import { creatorEarningsProfile, decodeEarningsDiscoveryCursor, earningsBeneficiaryRoles, encodeEarningsDiscoveryCursor,
  parseFixtureEarningsDiscoveryQuery } from "./creator-earnings.js";
import { fixtureMigratedRegistration } from "./curve-fixture-migration.js";
import { fixtureFeeActivityEventAbi, fixtureFeeActivityTopics, fixtureLpFeeActivity, indexFixtureFeeActivity,
  type FixtureFeeActivity } from "./curve-fixture-fee-activity.js";

const maxBlocks = 32n;
const maxFixtureSpan = 4096n;
const maxEvents = 128;
const maxTransactionsPerBlock = 32;
const maxReorgProbe = 24;
const pollMs = 250;
const fixtureCurveAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function sold() view returns (uint256)",
  "function backingReserve() view returns (uint256)",
  "function graduationSold() view returns (uint256)",
  "function GRADUATION_BACKING() view returns (uint256)",
  "function treasury() view returns (address)",
  "function treasuryShareBps() view returns (uint16)",
  "function creator() view returns (address)",
  "function token() view returns (address)",
  "function factory() view returns (address)",
]);
const originCurveAbi = parseAbi(["function originCurveForToken(address token) view returns (address)"]);
const created = curveCreationAbi[5];
const createdTopic = toEventSelector(created);
const createSelector = toFunctionSelector(curveCreationAbi[0]);
const hexHash = (value: unknown): value is Hash => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const hexQuantity = (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(value);
const same = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();

async function openingState(rpc: PublicClient, registration: CurveLaunchRegistration) {
  const { initialCurve: address, token, creation, totalSupplyWei } = registration;
  const blockNumber = BigInt(creation.blockNumber);
  const curve = { address, abi: fixtureCurveAbi, blockNumber } as const;
  const erc20 = { address: token, abi: erc20Abi, blockNumber } as const;
  const [inventory, supply, curveSupply, creatorInventory, factoryInventory, nativeBalance, name, symbol, sold, backing, targetSold, targetBacking,
    creator, treasury, share, factory, curveToken, origin] = await Promise.all([
    rpc.readContract({ ...erc20, functionName: "balanceOf", args: [address] }),
    rpc.readContract({ ...erc20, functionName: "totalSupply" }),
    rpc.readContract({ ...curve, functionName: "totalSupply" }),
    rpc.readContract({ ...erc20, functionName: "balanceOf", args: [registration.creator] }),
    rpc.readContract({ ...erc20, functionName: "balanceOf", args: [registration.factory] }),
    rpc.getBalance({ address, blockNumber }),
    rpc.readContract({ ...erc20, functionName: "name" }),
    rpc.readContract({ ...erc20, functionName: "symbol" }),
    rpc.readContract({ ...curve, functionName: "sold" }),
    rpc.readContract({ ...curve, functionName: "backingReserve" }),
    rpc.readContract({ ...curve, functionName: "graduationSold" }),
    rpc.readContract({ ...curve, functionName: "GRADUATION_BACKING" }),
    rpc.readContract({ ...curve, functionName: "creator" }),
    rpc.readContract({ ...curve, functionName: "treasury" }),
    rpc.readContract({ ...curve, functionName: "treasuryShareBps" }),
    rpc.readContract({ ...curve, functionName: "factory" }),
    rpc.readContract({ ...curve, functionName: "token" }),
    rpc.readContract({ address: registration.factory, abi: originCurveAbi, functionName: "originCurveForToken", args: [token], blockNumber }),
  ]);
  if (inventory !== curveFixedSupplyWei || supply !== curveFixedSupplyWei || curveSupply !== curveFixedSupplyWei
      || supply.toString() !== totalSupplyWei || creatorInventory !== 0n || factoryInventory !== 0n
      || name !== registration.name || symbol !== registration.symbol
      || sold !== 0n || backing !== 0n || nativeBalance !== 0n || targetSold !== curveGraduationSoldWei
      || targetBacking !== 2n * 10n ** 18n || !same(creator, registration.creator) || !same(curveToken, token)
      || !same(factory, registration.factory) || !same(origin, address) || share !== registration.treasuryShareBps
      || !same(treasury, registration.treasury ?? zeroAddress)) {
    throw new Error("Fixture opening state mismatches recorded creation");
  }
  return { inventoryWei: inventory.toString(), backingWei: backing.toString(), soldWei: sold.toString() };
}

async function readSegment(rpc: PublicClient, binding: CurveFixtureBinding, graduation: FixtureGraduationBinding,
  cursors: FixturePostCursor[], from: bigint, to: bigint, parent?: BlockEvidence,
  unsupportedSuccessors = new Set<string>()): Promise<CurveFixtureRange> {
  const blocks: BlockEvidence[] = [];
  const transactions: { block: BlockEvidence; transaction: Parameters<typeof indexFixtureCurveTransaction>[3]; index: number }[] = [];
  const expectedLogs = new Set<string>();
  for (let height = from; height <= to; height++) {
    const block = await rpc.getBlock({ blockNumber: height, includeTransactions: true });
    const previousHash = (blocks.at(-1) ?? parent)?.blockHash;
    if (previousHash && !same(block.parentHash, previousHash)) throw new Error("Fixture range crosses a chain replacement");
    const checked = blockEvidence(block, height);
    if (height === binding.deploymentBlock && !same(checked.blockHash, binding.deploymentBlockHash)) {
      throw new Error("Fixture deployment block was replaced");
    }
    if (!Array.isArray(block.transactions) || block.transactions.length > maxTransactionsPerBlock) {
      throw new Error("Fixture cannot prove complete block receipt coverage");
    }
    for (const [index, transaction] of block.transactions.entries()) {
      if (!transaction || typeof transaction !== "object" || !hexHash(transaction.hash)) {
        throw new Error("Fixture block omitted its full transactions");
      }
      transactions.push({ block: checked, transaction, index });
      if (!transaction.to || !same(transaction.to, binding.factory) || typeof transaction.input !== "string"
          || !same(transaction.input.slice(0, 10), createSelector)) continue;
      const receipt = await rpc.getTransactionReceipt({ hash: transaction.hash });
      if (!receipt.blockHash || !same(receipt.blockHash, checked.blockHash) || receipt.blockNumber !== height
          || !same(receipt.transactionHash, transaction.hash) || receipt.transactionIndex !== index
          || !receipt.to || !same(receipt.to, binding.factory) || !Array.isArray(receipt.logs) || receipt.logs.length > 256) {
        throw new Error("Fixture factory transaction receipt is incomplete");
      }
      let creations = 0;
      for (const log of receipt.logs) {
        if (!same(log.address, binding.factory) || !log.topics[0] || !same(log.topics[0], createdTopic)) continue;
        const identity = `${transaction.hash.toLowerCase()}:${log.logIndex}`;
        if (receipt.status !== "success" || expectedLogs.has(identity)) throw new Error("Fixture receipt has invalid creation evidence");
        expectedLogs.add(identity);
        creations++;
      }
      if ((receipt.status === "success" && creations !== 1) || (receipt.status !== "success" && creations !== 0)) {
        throw new Error("Fixture creation receipt does not match its execution result");
      }
    }
    blocks.push(checked);
  }
  const logs = await rpc.request({ method: "eth_getLogs", params: [{ address: binding.factory, fromBlock: toHex(from),
    toBlock: toHex(to), topics: [createdTopic] }] });
  if (!Array.isArray(logs) || logs.length > maxEvents || logs.length !== expectedLogs.size) {
    throw new Error("Fixture range omitted or duplicated creation logs");
  }
  const launches: CurveLaunchRegistration[] = [];
  for (const log of logs) {
    if (!same(log.address, binding.factory) || log.removed !== false || !hexQuantity(log.blockNumber) || !hexHash(log.blockHash)
        || !hexQuantity(log.logIndex) || !hexHash(log.transactionHash)) throw new Error("Invalid fixture range event reference");
    if (!expectedLogs.delete(`${log.transactionHash.toLowerCase()}:${Number(log.logIndex)}`)) {
      throw new Error("Fixture range log does not match a canonical direct factory transaction");
    }
    const at = BigInt(log.blockNumber);
    const indexedBlock = blocks.find(({ blockNumber, blockHash }) => BigInt(blockNumber) === at && same(blockHash, log.blockHash!));
    if (!indexedBlock) throw new Error("Fixture range event is outside its canonical block");
    const record = await readCurveLaunchRegistration(binding, rpc, {
      blockNumber: at, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: Number(log.logIndex),
    });
    if (!record) throw new Error("Fixture registration proof unavailable");
    // The local creation path accepts the exact fee only. Its fee event cannot stand in for refund settlement.
    if (record.creationFee.refundWei !== "0") throw new Error("Fixture registration has an unsupported creation refund");
    launches.push({ ...record, opening: await openingState(rpc, record), checkpoint: fixtureCheckpoint(blocks.at(-1)!) });
  }
  const end = blocks.at(-1)!;
  const combined: FixturePostCursor[] = [...cursors, ...launches.map((launch) => ({ launch, grossFees: 0n }))];
  await Promise.all(combined.map(cursor => loadFixtureLpLedger(rpc, graduation, cursor)));
  const byCurve = new Map(combined.map((cursor) => [cursor.launch.initialCurve.toLowerCase(), cursor]));
  if (combined.length > maxEvents || byCurve.size !== combined.length) throw new Error("Fixture lifecycle launch bound exceeded");
  const trades: CurveFixtureRange["trades"] = [];
  const graduations: CurveFixtureRange["graduations"] = [];
  const postEvents: CurveFixtureRange["postEvents"] = [];
  const feeActivity: FixtureFeeActivity[] = [];
  for (const { transaction, block, index } of transactions) {
    const cursor = transaction.to ? byCurve.get(transaction.to.toLowerCase()) : undefined;
    if (cursor && BigInt(block.blockNumber) > BigInt(cursor.launch.creation.blockNumber)) {
      const result = await indexFixtureCurveTransaction(rpc, graduation, cursor, transaction, block, index);
      if (result.trade) trades.push({ token: cursor.launch.token, evidence: result.trade });
      if (result.graduation) {
        await loadFixtureLpLedger(rpc, graduation, cursor);
        graduations.push({ token: cursor.launch.token, evidence: result.graduation });
      }
    }
    const post = await indexFixturePostTransaction(rpc, graduation, combined, transaction, block, index);
    if (post) postEvents.push(post);
    const fee = post ? fixtureLpFeeActivity(post, combined)
      : await indexFixtureFeeActivity(rpc, binding, combined, transaction, block, index);
    if (fee) feeActivity.push(fee);
  }
  await verifyPostEventCoverage(rpc, graduation, combined, blocks, postEvents);
  await verifyFeeActivityCoverage(rpc, binding, combined, blocks, feeActivity);
  const states = await readLifecycleStates(rpc, binding, graduation, combined, end, unsupportedSuccessors);
  const current = blockEvidence(await rpc.getBlock({ blockNumber: to, includeTransactions: false }), to);
  if (!same(end.blockHash, current.blockHash)) throw new Error("Fixture range endpoint was replaced");
  return { blocks, launches, trades, graduations, postEvents, feeActivity, states };
}

async function verifyFeeActivityCoverage(rpc: PublicClient, binding: CurveFixtureBinding, cursors: FixturePostCursor[],
  blocks: BlockEvidence[], events: FixtureFeeActivity[]) {
  const fromBlock = toHex(BigInt(blocks[0]!.blockNumber)), toBlock = toHex(BigInt(blocks.at(-1)!.blockNumber));
  const known = events.filter(event => event.kind === "curve-claim" || event.kind === "creation-payout");
  const expected = new Map(known.map(event => [`${event.transactionHash.toLowerCase()}:${event.logIndex}`, event]));
  if (expected.size !== known.length) throw new Error("Fixture fee activity has duplicate receipt identities");
  const ledgers = [...new Set(cursors.map(cursor => cursor.launch.revenueLedger))];
  const groups = await Promise.all([
    ledgers.length ? rpc.request({ method: "eth_getLogs", params: [{ address: ledgers, topics: [fixtureFeeActivityTopics.curve], fromBlock, toBlock }] }) : [],
    rpc.request({ method: "eth_getLogs", params: [{ address: binding.factory, topics: [fixtureFeeActivityTopics.factory], fromBlock, toBlock }] }),
  ]);
  for (const logs of groups) {
    if (!Array.isArray(logs) || logs.length > Number(maxBlocks) * maxTransactionsPerBlock) throw new Error("Fixture fee activity log bound exceeded");
    for (const log of logs) {
      if (log.removed !== false || !hexHash(log.transactionHash) || !hexHash(log.blockHash) || !hexQuantity(log.blockNumber) || !hexQuantity(log.logIndex)) {
        throw new Error("Fixture fee activity log identity is invalid");
      }
      const key = `${log.transactionHash.toLowerCase()}:${Number(log.logIndex)}`;
      const event = expected.get(key);
      const decoded = decodeEventLog({ abi: fixtureFeeActivityEventAbi, data: log.data, topics: log.topics });
      if (!event || !same(event.ledger, log.address) || !same(event.blockHash, log.blockHash)
          || event.blockNumber !== BigInt(log.blockNumber).toString() || !same(event.recipient, decoded.args.recipient)
          || event.nativeWei !== decoded.args.amount.toString()
          || (event.kind === "curve-claim") !== (decoded.eventName === "CurveFeeClaimed")) {
        throw new Error("Fixture fee activity log lacks its exact canonical settlement proof");
      }
      expected.delete(key);
    }
  }
  if (expected.size) throw new Error("Fixture fee activity logs omitted a proven receipt");
}

// Compare direct verified receipts with protocol logs. A different execution path touching
// an admitted pool or ledger is unavailable instead of being silently left out of history.
async function verifyPostEventCoverage(rpc: PublicClient, graduation: FixtureGraduationBinding,
  cursors: FixturePostCursor[], blocks: BlockEvidence[], events: CurveFixtureRange["postEvents"]) {
  const graduated = cursors.filter(cursor => cursor.graduation && cursor.lpLedger);
  if (graduated.length === 0) return;
  const fromBlock = toHex(BigInt(blocks[0]!.blockNumber)), toBlock = toHex(BigInt(blocks.at(-1)!.blockNumber));
  const poolIds = graduated.map(cursor => cursor.graduation!.poolId);
  const ledgers = graduated.map(cursor => cursor.lpLedger!);
  const tokens = graduated.map(cursor => toHex(BigInt(cursor.launch.token), { size: 32 }));
  const { swap, collect, claim } = fixturePostEventTopics;
  const query = (address: `0x${string}` | `0x${string}`[], topics: [Hash, ...Hash[][]]) =>
    rpc.request({ method: "eth_getLogs", params: [{ address, topics, fromBlock, toBlock }] });
  const groups = await Promise.all([
    query(poolManager, [swap, poolIds]), query(graduation.graduationEngine, [collect, tokens]), query(ledgers, [claim]),
  ]);
  const byToken = new Map(graduated.map(cursor => [cursor.launch.token.toLowerCase(), cursor]));
  const expected = new Map(events.map(({ token, evidence }) => [`${evidence.transactionHash.toLowerCase()}:${evidence.logIndex}`, { token, evidence }]));
  if (expected.size !== events.length) throw new Error("Fixture post-graduation duplicate receipt identity");
  for (const [group, logs] of groups.entries()) {
    if (!Array.isArray(logs) || logs.length > maxBlocks * BigInt(maxTransactionsPerBlock)) throw new Error("Fixture post-graduation log bounds invalid");
    for (const log of logs) {
      if (!hexHash(log.transactionHash) || !hexHash(log.blockHash) || !hexQuantity(log.blockNumber) || !hexQuantity(log.logIndex)
          || log.removed !== false) throw new Error("Fixture post-graduation log identity invalid");
      const key = `${log.transactionHash.toLowerCase()}:${Number(log.logIndex)}`;
      const match = expected.get(key);
      const event = match?.evidence;
      const cursor = match && byToken.get(match.token.toLowerCase());
      const topic = [swap, collect, claim][group];
      const emitter = group === 0 ? poolManager : group === 1 ? graduation.graduationEngine : cursor?.lpLedger;
      const identity = group === 0 ? cursor?.graduation?.poolId : group === 1 && match ? toHex(BigInt(match.token), { size: 32 })
        : event && toHex(BigInt(event.account), { size: 32 });
      if (!event || !topic || !emitter || !identity || !same(log.address, emitter) || !same(log.topics[0] ?? "", topic)
          || !same(log.topics[1] ?? "", identity) || event.blockNumber !== BigInt(log.blockNumber).toString()
          || !same(event.blockHash, log.blockHash)
          || (group === 0 && event.kind !== "v4-buy" && event.kind !== "v4-sell")
          || (group === 1 && event.kind !== "lp-collect") || (group === 2 && event.kind !== "lp-claim")) {
        throw new Error("Fixture post-graduation log has no verified direct receipt");
      }
      expected.delete(key);
    }
  }
  if (expected.size !== 0) throw new Error("Fixture post-graduation logs omitted a verified receipt");
}

async function readLifecycleStates(rpc: PublicClient, binding: CurveFixtureBinding, graduation: FixtureGraduationBinding,
  cursors: FixturePostCursor[], at: BlockEvidence, unsupportedSuccessors = new Set<string>()): Promise<CurveFixtureRange["states"]> {
  const states: CurveFixtureRange["states"] = [];
  await verifyFixtureLifecycleRuntime(rpc, binding, graduation, BigInt(at.blockNumber));
  for (const cursor of cursors) {
    const migrated = await fixtureMigratedRegistration(rpc, binding, graduation, cursor.launch, at);
    if (migrated) {
      // Preserve the verified birth registration and original ledger. No V1
      // trading state is invented for an unmodeled successor event stream.
      unsupportedSuccessors.add(cursor.launch.token.toLowerCase());
      continue;
    }
    const evidence = await fixtureLifecycleState(rpc, graduation, cursor, at);
    if (cursor.graduation && !cursor.lpLedger) await loadFixtureLpLedger(rpc, graduation, cursor);
    const postGraduation = await readFixturePostState(rpc, graduation, cursor, BigInt(at.blockNumber));
    states.push({ token: cursor.launch.token, evidence: { ...evidence, ...(postGraduation && { postGraduation }) } });
  }
  return states;
}

async function main() {
  const config = curveFixtureConfig(process.env);
  const { binding, graduation } = config;
  const scope = curveScope(binding);
  const rpc = createPublicClient({ transport: http(config.rpcUrl, {
    timeout: 2_000, retryCount: 0, fetchOptions: { redirect: "error" },
  }), cacheTime: 0 });
  const anchor = await verifyCurveDeployment(binding, rpc);
  await verifyFixtureGraduationDeployment(rpc, binding, graduation);
  const reserveRecipient = await rpc.readContract({ address: binding.factory,
    abi: parseAbi(["function futureReserveRecipient() view returns (address)"]), functionName: "futureReserveRecipient",
    blockNumber: binding.deploymentBlock });
  if (!isAddress(reserveRecipient) || BigInt(reserveRecipient) <= 0xffffn || same(reserveRecipient, binding.creationFeeRecipient)) {
    throw new Error("Fixture earnings reserve binding is invalid");
  }
  const writer = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3_000,
    query_timeout: 5_000, options: "-c search_path=pg_catalog,public" });
  const reader = new pg.Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 3_000,
    query_timeout: 5_000, options: "-c default_transaction_read_only=on -c search_path=public,pg_catalog" });
  const stop = new AbortController();
  let verified: BlockEvidence | null = null;
  let inflightReads = 0;
  let storeFailed = false;
  let previousIssue = "";
  let unsupportedSuccessors = new Set<string>();
  const server = createServer({ requestTimeout: 3_000, headersTimeout: 3_000, maxHeaderSize: 4_096 }, async (req, res) => {
    const send = (code: number, body: object) => {
      res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    };
    const unavailable = { status: "unavailable", chainId: fixtureChainId, launches: [] };
    if (req.headers.host !== `127.0.0.1:${config.port}`) return send(404, unavailable);
    const path = req.url ?? "";
    if (!path.startsWith("/") || path.startsWith("//")) return send(404, unavailable);
    let url: URL;
    try { url = new URL(path, `http://127.0.0.1:${config.port}`); } catch { return send(404, unavailable); }
    if (url.hash) return send(404, unavailable);
    const isEarnings = url.pathname === "/earnings";
    const isActivity = url.pathname === "/earnings/activity";
    const token = path.startsWith("/curve-launches/") ? path.slice("/curve-launches/".length).toLowerCase() : undefined;
    if (path !== "/ready" && path !== "/curve-launches" && !isEarnings && !isActivity && !(token && isAddress(token, { strict: false }))) {
      return send(404, unavailable);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, unavailable);
    if (path !== "/ready") {
      const key = req.headers["x-rmt-fixture-key"];
      if (typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key)
          || !timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(config.readKey, "hex"))) return send(404, unavailable);
    }
    const checkpoint = verified;
    if (!checkpoint || storeFailed || inflightReads >= 4) return send(503, unavailable);
    inflightReads++;
    try {
      const earnings = isEarnings ? parseFixtureEarningsDiscoveryQuery(url) : null;
      if (isEarnings && !earnings) return send(400, unavailable);
      const activityHash = isActivity ? url.searchParams.get("transaction") : undefined;
      if (isActivity && (url.searchParams.size !== 1 || !hexHash(activityHash))) return send(400, unavailable);
      const cursor = earnings?.after ? decodeEarningsDiscoveryCursor(earnings.after, 31337) : undefined;
      if (earnings?.after && (!cursor || cursor.scope !== scope.join(":") || cursor.recipient !== earnings.recipient)) return send(503, unavailable);
      const earningsRows = earnings ? await readCurveFixtureEarnings(reader, scope, checkpoint, {
        recipient: earnings.recipient, operatingRecipient: binding.creationFeeRecipient, reserveRecipient,
        limit: earnings.limit + 1, cursor: cursor ?? undefined, token: earnings.token,
      }) : undefined;
      const activities = activityHash ? await readCurveFixtureFeeActivity(reader, scope, checkpoint, activityHash) : undefined;
      const launches = path === "/ready" || isEarnings || isActivity ? [] : await readCurveFixtureRows(reader, scope, checkpoint, token);
      const height = BigInt(checkpoint.blockNumber);
      const [canonical, head] = await Promise.all([
        rpc.getBlock({ blockNumber: height, includeTransactions: false }), rpc.getBlockNumber({ cacheTime: 0 }),
      ]);
      const block = blockEvidence(canonical, height);
      if (!same(block.blockHash, checkpoint.blockHash) || head - BigInt(fixtureConfirmations) !== height
          || !verified || !same(verified.blockHash, checkpoint.blockHash) || storeFailed) return send(503, unavailable);
      if (activities) return send(200, { schemaVersion: 1, profile: creatorEarningsProfile, status: "ready", chainId: 31337,
        transactionHash: activityHash, activities, checkpoint: { ...checkpoint, confirmations: fixtureConfirmations,
          finality: "local-synthetic", l1Finality: "not-applicable" } });
      if (earnings && earningsRows) {
        const page = earningsRows.launches.slice(0, earnings.limit).map(launch => ({ ...launch,
          beneficiaryRoles: earningsBeneficiaryRoles(launch, earnings.recipient, { binding, reserveRecipient }),
          feeEvidence: "contract-read-required" as const }));
        const last = page.at(-1);
        return send(200, { schemaVersion: 1, chainId: 31337, profile: creatorEarningsProfile,
          status: earningsRows.checkpoint.blockHash === checkpoint.blockHash ? "ready" : "stale", recipient: earnings.recipient,
          observedAt: new Date().toISOString(), deployment: { factory: binding.factory, registry: binding.projectRegistry,
            blockNumber: binding.deploymentBlock.toString(), blockHash: binding.deploymentBlockHash },
          checkpoint: { ...earningsRows.checkpoint, confirmations: fixtureConfirmations, finality: "local-synthetic", l1Finality: "not-applicable" },
          launches: page, nextCursor: !earnings.token && earningsRows.launches.length > earnings.limit && last ? encodeEarningsDiscoveryCursor({
            scope: scope.join(":"), recipient: earnings.recipient, blockNumber: earningsRows.checkpoint.blockNumber,
            blockHash: earningsRows.checkpoint.blockHash, after: last.token }) : null,
          history: { status: "unsupported", source: "historical-v4-v6", feeEvidence: "No historical product records are admitted to the synthetic fixture" },
        });
      }
      return send(token && launches.length === 0 ? 404 : 200,
        { status: "ready", chainId: fixtureChainId, launches, checkpoint: fixtureCheckpoint(checkpoint),
          ...(path === "/ready" ? { readiness: { registration: "ready", earningsDiscovery: "ready",
            successorLifecycle: unsupportedSuccessors.size ? "partially-unavailable" : "ready", unsupportedSuccessorCount: unsupportedSuccessors.size } } : {}) });
    } catch {
      return send(503, unavailable);
    } finally {
      inflightReads--;
    }
  });
  function stopping() {
    verified = null;
    stop.abort();
    server.close();
  }
  writer.on("error", () => { storeFailed = true; stopping(); });
  reader.on("error", () => { /* The next read either reconnects or returns unavailable. */ });
  process.once("SIGINT", stopping);
  process.once("SIGTERM", stopping);
  try {
    await writer.connect();
    await initializeCurveFixtureStore(writer, config.databaseName, binding, graduation);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "127.0.0.1", resolve);
    });
    while (!stop.signal.aborted) {
      try {
        const tip = await rpc.getBlockNumber({ cacheTime: 0 });
        const safe = tip - BigInt(fixtureConfirmations);
        if (await rpc.getChainId() !== fixtureChainId || safe < binding.deploymentBlock || safe - binding.deploymentBlock > maxFixtureSpan) {
          throw new Error("Fixture head is outside the reviewed chain bounds");
        }
        const disk = await storedCurveCheckpoints(writer, scope, maxReorgProbe);
        let latest = disk[0];
        if (latest) {
          let ancestor: BlockEvidence | undefined;
          for (const point of disk) {
            const height = BigInt(point.blockNumber);
            if (height > safe) continue;
            const onchain = blockEvidence(await rpc.getBlock({ blockNumber: height, includeTransactions: false }), height);
            if (same(onchain.blockHash, point.blockHash)) { ancestor = point; break; }
            verified = null;
          }
          if (!ancestor || BigInt(ancestor.blockNumber) < BigInt(latest.blockNumber)) {
            verified = null;
            const currentAnchor = blockEvidence(await rpc.getBlock({ blockNumber: binding.deploymentBlock, includeTransactions: false }), binding.deploymentBlock);
            if (!same(currentAnchor.blockHash, anchor.blockHash)) throw new Error("Fixture deployment block was replaced");
            await rollbackCurveFixture(writer, scope, ancestor ? BigInt(ancestor.blockNumber) : binding.deploymentBlock - 1n);
            latest = ancestor;
          }
        }
        const next = latest ? BigInt(latest.blockNumber) + 1n : binding.deploymentBlock;
        if (next <= safe) {
          verified = null;
          const end = next + maxBlocks - 1n <= safe ? next + maxBlocks - 1n : safe;
          const cursors = await loadCurveFixtureCursors(writer, scope);
          const nextUnsupported = new Set<string>();
          const range = await readSegment(rpc, binding, graduation, cursors, next, end, latest, nextUnsupported);
          await commitCurveFixtureRange(writer, scope, range);
          unsupportedSuccessors = nextUnsupported;
          latest = range.blocks.at(-1);
        } else if (latest && (!verified || !same(latest.blockHash, verified.blockHash))) {
          // A shared reorg ancestor can land inside a range that has no stored state at that height.
          const cursors = await loadCurveFixtureCursors(writer, scope);
          const nextUnsupported = new Set<string>();
          const states = await readLifecycleStates(rpc, binding, graduation, cursors, latest, nextUnsupported);
          const stillCanonical = blockEvidence(await rpc.getBlock({ blockNumber: BigInt(latest.blockNumber) }), BigInt(latest.blockNumber));
          if (!same(stillCanonical.blockHash, latest.blockHash)) throw new Error("Fixture checkpoint changed during state recovery");
          await commitCurveFixtureRange(writer, scope, { blocks: [], launches: [], trades: [], graduations: [], postEvents: [], states });
          unsupportedSuccessors = nextUnsupported;
        }
        verified = latest && BigInt(latest.blockNumber) === safe && !stop.signal.aborted ? latest : null;
        previousIssue = "";
      } catch (error) {
        verified = null;
        const issue = error instanceof Error && /^[Ff]ixture [\w ,.-]+(?::[\w ,.-]+)?$/.test(error.message)
          ? error.message : "Fixture evidence read or persistence unavailable";
        if (issue !== previousIssue) console.error(issue);
        previousIssue = issue;
      }
      await wait(pollMs, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  } finally {
    stopping();
    await Promise.allSettled([reader.end(), writer.end()]);
  }
  if (storeFailed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // No upstream errors are printed because connection credentials must stay local.
  console.error(error instanceof Error && error.message.startsWith("Fixture ") ? error.message : "Curve fixture indexer startup refused");
  process.exitCode = 1;
});
