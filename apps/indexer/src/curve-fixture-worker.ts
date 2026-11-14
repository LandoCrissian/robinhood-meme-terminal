import { createServer } from "node:http";
import { setTimeout as wait } from "node:timers/promises";
import pg from "pg";
import { createPublicClient, erc20Abi, http, isAddress, parseAbi, toEventSelector, toFunctionSelector, toHex, zeroAddress,
  type Hash, type PublicClient } from "viem";
import { curveFixtureConfig } from "./curve-fixture-config.js";
import { blockEvidence, curveCreationAbi, fixtureChainId, fixtureConfirmations, readCurveLaunchRegistration,
  verifyCurveDeployment, type BlockEvidence, type CurveFixtureBinding, type CurveLaunchRegistration } from "./curve-launch-evidence.js";
import { commitCurveFixtureRange, curveScope, fixtureCheckpoint, initializeCurveFixtureStore,
  readCurveFixtureRows, rollbackCurveFixture, storedCurveCheckpoints } from "./curve-fixture-store.js";

const maxBlocks = 32n;
const maxFixtureSpan = 4096n;
const maxEvents = 25;
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
  const [inventory, supply, nativeBalance, name, symbol, sold, backing, targetSold, targetBacking,
    creator, treasury, share, factory, curveToken, origin] = await Promise.all([
    rpc.readContract({ ...erc20, functionName: "balanceOf", args: [address] }),
    rpc.readContract({ ...erc20, functionName: "totalSupply" }),
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
  if (inventory !== supply || supply.toString() !== totalSupplyWei || name !== registration.name || symbol !== registration.symbol
      || sold !== 0n || backing !== 0n || nativeBalance !== 0n || targetSold !== supply * 3n / 5n
      || targetBacking !== 2n * 10n ** 18n || !same(creator, registration.creator) || !same(curveToken, token)
      || !same(factory, registration.factory) || !same(origin, address) || share !== registration.treasuryShareBps
      || !same(treasury, registration.treasury ?? zeroAddress)) {
    throw new Error("Fixture opening state mismatches recorded creation");
  }
  return { inventoryWei: inventory.toString(), backingWei: backing.toString(), soldWei: sold.toString() };
}

async function readSegment(rpc: PublicClient, binding: CurveFixtureBinding, from: bigint, to: bigint, parent?: BlockEvidence) {
  const blocks: BlockEvidence[] = [];
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
    launches.push({ ...record, opening: await openingState(rpc, record), checkpoint: fixtureCheckpoint(blocks.at(-1)!) });
  }
  const end = blocks.at(-1)!;
  const current = blockEvidence(await rpc.getBlock({ blockNumber: to, includeTransactions: false }), to);
  if (!same(end.blockHash, current.blockHash)) throw new Error("Fixture range endpoint was replaced");
  return { blocks, launches };
}

async function main() {
  const config = curveFixtureConfig(process.env);
  const { binding } = config;
  const scope = curveScope(binding);
  const rpc = createPublicClient({ transport: http(config.rpcUrl, {
    timeout: 2_000, retryCount: 0, fetchOptions: { redirect: "error" },
  }), cacheTime: 0 });
  const anchor = await verifyCurveDeployment(binding, rpc);
  const writer = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3_000,
    query_timeout: 5_000, options: "-c search_path=pg_catalog,public" });
  const reader = new pg.Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 3_000,
    query_timeout: 5_000, options: "-c default_transaction_read_only=on -c search_path=public,pg_catalog" });
  const stop = new AbortController();
  let verified: BlockEvidence | null = null;
  let inflightReads = 0;
  let storeFailed = false;
  const server = createServer({ requestTimeout: 3_000, headersTimeout: 3_000, maxHeaderSize: 4_096 }, async (req, res) => {
    const send = (code: number, body: object) => {
      res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    };
    const unavailable = { status: "unavailable", chainId: fixtureChainId, launches: [] };
    if (req.headers.host !== `127.0.0.1:${config.port}`) return send(404, unavailable);
    const path = req.url ?? "";
    const token = path.startsWith("/curve-launches/") ? path.slice("/curve-launches/".length).toLowerCase() : undefined;
    if (path !== "/ready" && path !== "/curve-launches" && !(token && isAddress(token, { strict: false }))) {
      return send(404, unavailable);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, unavailable);
    const checkpoint = verified;
    if (!checkpoint || storeFailed || inflightReads >= 4) return send(503, unavailable);
    inflightReads++;
    try {
      const launches = path === "/ready" ? [] : await readCurveFixtureRows(reader, scope, checkpoint, token);
      const height = BigInt(checkpoint.blockNumber);
      const [canonical, head] = await Promise.all([
        rpc.getBlock({ blockNumber: height, includeTransactions: false }), rpc.getBlockNumber({ cacheTime: 0 }),
      ]);
      const block = blockEvidence(canonical, height);
      if (!same(block.blockHash, checkpoint.blockHash) || head - BigInt(fixtureConfirmations) !== height
          || !verified || !same(verified.blockHash, checkpoint.blockHash) || storeFailed) return send(503, unavailable);
      return send(token && launches.length === 0 ? 404 : 200,
        { status: "ready", chainId: fixtureChainId, launches, checkpoint: fixtureCheckpoint(checkpoint) });
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
    await initializeCurveFixtureStore(writer, config.databaseName, binding);
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
          const { launches, blocks } = await readSegment(rpc, binding, next, end, latest);
          await commitCurveFixtureRange(writer, scope, blocks, launches);
          latest = blocks.at(-1);
        }
        verified = latest && BigInt(latest.blockNumber) === safe && !stop.signal.aborted ? latest : null;
      } catch {
        verified = null;
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
