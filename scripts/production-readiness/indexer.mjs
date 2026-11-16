import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "./rpc.mjs";

const website = new URL("../../apps/launch-website/", import.meta.url);
const requireWebsite = createRequire(new URL("package.json", website));
const { decodeEventLog, parseAbi, toEventSelector } = requireWebsite("viem");

export const netlifyOrigin = "https://www.rmtlaunch.fun";
export const railwayOrigin = "https://robinhood-meme-terminal-production.up.railway.app";
const historyPath = "/api/launchpad/launches";
const snapshot = JSON.parse(readFileSync(new URL("data/historical-launches-4663.json", website)));
const previous = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-release/l1-batches.json", import.meta.url)))
  .l2.initialHostedCheckpoint;
const v6Factory = snapshot.factories.find(({ version }) => version === 6).factory;
const v6Asset = snapshot.launches.find(({ version, launchId }) => version === 6 && launchId === "0").token;
const absentAsset = "0x0000000000000000000000000000000000000000";
const registrationAbi = {
  4: parseAbi(["event TokenLaunched(uint256 indexed launchId,address indexed token,address indexed creator,address market,address rewardVault,bytes32 graduationPoolId,string name,string symbol,string metadataURI,uint16[5] rewardBps)"]),
  6: parseAbi(["event TokenLaunchedV6(uint256 indexed launchId,address indexed token,address indexed creator,address market,address feeSplitter,bytes32 graduationPoolId,bytes32 policyId,uint32 policyVersion,uint16 curveFeeBps,uint16 creatorFeeShareBps,uint16 protocolFeeShareBps,uint16 postGraduationFeeBps,bool fairStartEnabled,uint64 fairStartDelayBlocks,uint64 fairStartDurationBlocks,uint16 fairStartMaxTxBps,uint16 fairStartMaxWalletBps,uint256 graduationTarget,bool officialMigration,string name,string symbol,string metadataURI)"]),
};
const registrationTopics = Object.fromEntries(Object.entries(registrationAbi).map(([version, [event]]) => [version, toEventSelector(event)]));
const maxResponseBytes = 64 * 1024; // Matches the website's authenticated history-reader limit.
const requestTimeoutMs = 8_000;
const maxAgeMs = 300_000;
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const isHash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0+$/.test(value);
const isAddress = (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const decimal = (value) => typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value);
const hexQuantity = (value) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,19})$/i.test(value);
const toQuantity = (value) => "0x" + BigInt(value).toString(16);
const millis = (value) => typeof value === "string" ? Date.parse(value) : NaN;

async function readHttp(fetchImpl, origin, path, now, headers) {
  const observedAt = new Date(now()).toISOString();
  try {
    const response = await fetchImpl(origin + path, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { accept: "application/json", ...headers },
    });
    const entry = { path, observedAt, httpStatus: response.status };
    if (response.status !== 200) {
      // Never echo an error body or request Authorization into the report.
      await response.body?.cancel();
      return { ...entry, bearerChallenge: /^Bearer(?:\s|$)/i.test(response.headers.get("www-authenticate") ?? "") };
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      return { ...entry, unavailable: "unexpected-content-type" };
    }
    const length = response.headers.get("content-length");
    if (!response.body || (length && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes))) {
      await response.body?.cancel();
      return { ...entry, unavailable: "response-size" };
    }
    const stream = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await stream.cancel();
        return { ...entry, unavailable: "response-size" };
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks, size);
    try {
      return { ...entry, bodySha256: createHash("sha256").update(bytes).digest("hex"),
        body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
    } catch {
      return { ...entry, unavailable: "invalid-json" };
    }
  } catch (error) {
    return { path, observedAt, unavailable: error?.name === "TimeoutError" ? "timeout" : "transport" };
  }
}

function summarizeDirectory(body, now) {
  const { coverage, status, chainId, future, finality, checkpoint, launches, observedAt } = body ?? {};
  if (!["v6-indexed", "verified-snapshot"].includes(coverage) || !["ready", "stale"].includes(status)
      || chainId !== 4663 || future !== "prelaunch" || finality !== "l1-unverified" || !Array.isArray(launches) || launches.length > 25
      || !decimal(checkpoint?.blockNumber) || !isHash(checkpoint?.blockHash) || !Number.isFinite(millis(checkpoint?.timestamp))
      || !Number.isFinite(millis(observedAt)) || millis(observedAt) < millis(checkpoint.timestamp)
      || millis(observedAt) > now + 60_000) return null;
  const rows = new Map();
  for (const row of launches) {
    const factory = snapshot.factories.find(({ version }) => version === row?.version)?.factory;
    if (!row || !isAddress(row.token) || !isAddress(row.market) || !isAddress(row.creator)
        || !factory || ![4, 6].includes(row.version) || !same(row.factory, factory) || row.kind !== "historical-rmt"
        || !decimal(row.launchId) || !decimal(row.receipt?.blockNumber)
        || BigInt(row.receipt.blockNumber) > BigInt(checkpoint.blockNumber)
        || !isHash(row.receipt.blockHash) || !isHash(row.receipt.transactionHash)
        || !Number.isSafeInteger(row.receipt.logIndex) || row.receipt.logIndex < 0
        || !Number.isFinite(millis(row.receipt.timestamp)) || millis(row.receipt.timestamp) > millis(checkpoint.timestamp)
        || rows.has(row.token.toLowerCase())) return null;
    rows.set(row.token.toLowerCase(), row);
  }

  const bound = snapshot.launches.filter((pinned) => matchesPinned(rows.get(pinned.token), pinned));
  const fresh = now - millis(checkpoint.timestamp) <= maxAgeMs;
  return { coverage, status, future, finality, chainId, observedAt,
    checkpoint: { blockNumber: checkpoint.blockNumber, blockHash: checkpoint.blockHash.toLowerCase(), timestamp: checkpoint.timestamp },
    counts: { total: launches.length, v4: launches.filter(({ version }) => version === 4).length,
      v6: launches.filter(({ version }) => version === 6).length, exactPinnedRegistrations: bound.length },
    independentlyFresh: fresh, staleLabelConsistent: status === "stale" || (coverage === "v6-indexed" && fresh),
  };
}

function matchesPinned(candidate, pinned) {
  return !!candidate && candidate.version === pinned.version && candidate.classification === pinned.classification
    && candidate.launchId === pinned.launchId && candidate.name === pinned.name && candidate.symbol === pinned.symbol
    && same(candidate.token, pinned.token) && same(candidate.factory, pinned.factory)
    && same(candidate.market, pinned.market) && same(candidate.creator, pinned.creator)
    && candidate.receipt.blockNumber === pinned.receipt.blockNumber && same(candidate.receipt.blockHash, pinned.receipt.blockHash)
    && same(candidate.receipt.transactionHash, pinned.receipt.transactionHash)
    && candidate.receipt.logIndex === pinned.receipt.logIndex && millis(candidate.receipt.timestamp) === millis(pinned.receipt.timestamp);
}

function headerEvidence(block, matches) {
  const result = { matches };
  if (hexQuantity(block?.number)) result.blockNumber = BigInt(block.number).toString();
  if (isHash(block?.hash)) result.blockHash = block.hash.toLowerCase();
  if (hexQuantity(block?.timestamp) && BigInt(block.timestamp) <= 8_640_000_000_000n) {
    result.timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
  }
  return result;
}

function headerMatches(block, blockNumber, blockHash, timestamp) {
  return hexQuantity(block?.number) && BigInt(block.number) === BigInt(blockNumber) && same(block.hash, blockHash)
    && hexQuantity(block.timestamp) && Number(block.timestamp) * 1000 === millis(timestamp);
}

function summarizeRegistration(receipt, block, registration) {
  const expected = registration.receipt;
  if (!receipt || receipt.status !== "0x1" || !same(receipt.to, registration.factory)
      || !same(receipt.transactionHash, expected.transactionHash) || !same(receipt.blockHash, expected.blockHash)
      || !hexQuantity(receipt.blockNumber) || BigInt(receipt.blockNumber) !== BigInt(expected.blockNumber)
      || !hexQuantity(receipt.transactionIndex) || !Array.isArray(block?.transactions)
      || !headerMatches(block, expected.blockNumber, expected.blockHash, expected.timestamp)
      || !same(block.transactions[Number(receipt.transactionIndex)], expected.transactionHash)
      || !Array.isArray(receipt.logs) || receipt.logs.length > 256) return false;
  const logs = receipt.logs.filter((log) => same(log?.address, registration.factory)
    && same(log?.topics?.[0], registrationTopics[registration.version]));
  if (logs.length !== 1) return false;
  const [log] = logs;
  const bound = log.removed === false && same(log.transactionHash, expected.transactionHash) && same(log.blockHash, expected.blockHash)
    && log.blockNumber === receipt.blockNumber && log.transactionIndex === receipt.transactionIndex
    && hexQuantity(log.logIndex) && Number(log.logIndex) === expected.logIndex
    && Array.isArray(log.topics) && log.topics.length === 4 && log.topics.every((topic) => typeof topic === "string" && /^0x[0-9a-f]{64}$/i.test(topic))
    && typeof log.data === "string" && /^0x(?:[0-9a-f]{64})+$/i.test(log.data);
  if (!bound) return false;
  try {
    const { args } = decodeEventLog({ abi: registrationAbi[registration.version], data: log.data, topics: log.topics, strict: true });
    return args.launchId.toString() === registration.launchId && same(args.token, registration.token)
      && same(args.creator, registration.creator) && same(args.market, registration.market)
      && args.name === registration.name && args.symbol === registration.symbol;
  } catch {
    return false;
  }
}

async function verifyChainPeer(read, checkpoint) {
  const chain = await read("eth_chainId");
  if (chain.status !== "observed" || chain.value !== "0x1237") return { chain, status: "unverified-chain" };
  const directHeader = (height, check) => read("eth_getBlockByNumber", [toQuantity(height), false], check);
  const currentHeader = () => directHeader(checkpoint.blockNumber,
    (block) => headerEvidence(block, headerMatches(block, checkpoint.blockNumber, checkpoint.blockHash, checkpoint.timestamp)));
  const current = await currentHeader();
  const replay = await directHeader(previous.block, (block) => headerEvidence(block, hexQuantity(block?.number)
    && BigInt(block.number) === BigInt(previous.block) && same(block.hash, previous.blockHash)));
  const registrations = [];
  for (const row of snapshot.launches) {
    const receipt = await read("eth_getTransactionReceipt", [row.receipt.transactionHash], (value) => value);
    if (receipt.status !== "observed") {
      registrations.push({ token: row.token, receipt: { ...receipt, value: undefined } });
      continue;
    }
    const identity = await directHeader(row.receipt.blockNumber, (block) => {
      const proof = headerEvidence(block, summarizeRegistration(receipt.value, block, row));
      return proof.matches ? { ...proof, factory: row.factory, version: row.version, transactionHash: row.receipt.transactionHash,
        logIndex: row.receipt.logIndex } : proof;
    });
    registrations.push({ token: row.token, receipt: { status: receipt.status, observedAt: receipt.observedAt }, identity });
  }
  const rechecked = await currentHeader();
  const observations = [current, replay, rechecked, ...registrations.map(({ receipt, identity }) => identity ?? receipt)];
  const status = observations.some(({ status, value }) => status === "observed" && value?.matches === false) ? "conflict"
    : observations.every(({ status, value }) => status === "observed" && value?.matches === true) ? "matched" : "unavailable";
  return { chain, status, current, rechecked, replay, registrations };
}

function summarizeWorker(body) {
  const { ok, chainId, protocolVersion, factory, indexedThrough, latestBlock, confirmationDepth, initialSyncComplete, lastSyncAt } = body ?? {};
  return { ok: ok === true, ...(chainId === 4663 && { chainId }),
    ...(protocolVersion === 6 && { protocolVersion }),
    ...(isAddress(factory) && { factory: factory.toLowerCase() }),
    ...(decimal(indexedThrough) && { indexedThrough }), ...(decimal(latestBlock) && { latestBlock }),
    ...(Number.isSafeInteger(confirmationDepth) && { confirmationDepth }), initialSyncComplete: initialSyncComplete === true,
    ...(Number.isFinite(millis(lastSyncAt)) && { lastSyncAt }) };
}

export async function runIndexerProbe({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const report = { observedAt: new Date(now()).toISOString(), scope: "BOUNDED_PUBLIC_READ_ONLY" };
  const site = (path) => readHttp(fetchImpl, netlifyOrigin, path, now);
  const worker = (path, headers) => readHttp(fetchImpl, railwayOrigin, path, now, headers);
  const checks = {
    directory: site(historyPath), exact: site(historyPath + "/" + v6Asset), absent: site(historyPath + "/" + absentAsset),
    execution: site("/api/launchpad/config"), newEngine: site("/api/launchpad/new-engine"),
    historicalInNewEngine: site("/api/launchpad/new-engine/" + v6Asset),
    fixtureCreation: site("/api/launchpad/test-creation"), fixtureLifecycle: site("/api/launchpad/test-lifecycle"),
    authMissing: worker("/historical-launches"), authInvalid: worker("/historical-launches", { authorization: "Bearer rmt-readiness-invalid-probe" }),
    ready: worker("/ready"),
  };
  const entries = Object.fromEntries(await Promise.all(Object.entries(checks).map(async ([name, check]) => [name, await check])));
  // Use a later worker observation to avoid mistaking ordinary concurrent indexing for a replay.
  entries.health = await worker("/health");
  const directory = summarizeDirectory(entries.directory.body, now());
  const exact = summarizeDirectory(entries.exact.body, now());
  const exactLookup = exact?.counts.total === 1 && matchesPinned(entries.exact.body.launches[0], snapshot.launches.find(({ token }) => token === v6Asset));
  const workerHealth = summarizeWorker(entries.health.body);
  const workerReadiness = summarizeWorker(entries.ready.body);
  const historyAuth = ["authMissing", "authInvalid"].every((name) => (
    entries[name].httpStatus === 401 && entries[name].bearerChallenge === true
  ));
  const executionDisabled = entries.execution.httpStatus === 200 && entries.execution.body?.status === "disabled";
  const newEngineBoundary = ["newEngine", "historicalInNewEngine", "fixtureCreation", "fixtureLifecycle"]
    .every((name) => entries[name].httpStatus === 404);
  const exactHistoricalSet = directory?.counts.total === snapshot.launches.length &&
    directory.counts.exactPinnedRegistrations === snapshot.launches.length;
  const chainChecks = exactHistoricalSet
    ? Object.fromEntries(await Promise.all(Object.entries(ROBINHOOD_SOURCES).map(async ([name, url]) => [
      name, await verifyChainPeer(makeReadOnlyRpc({ name, url }, { fetcher: fetchImpl }), directory.checkpoint),
    ]))) : {};
  const peerStatuses = Object.values(chainChecks).map(({ status }) => status);
  const canonicalHistory = peerStatuses.includes("conflict") ? "CONFLICT"
    : peerStatuses.filter((status) => status === "matched").length >= 2 ? "VERIFIED_L2" : "UNVERIFIED";
  const workerHealthy = entries.health.httpStatus === 200 && entries.ready.httpStatus === 200
    && workerReadiness.ok && workerReadiness.initialSyncComplete && workerHealth.ok && workerHealth.initialSyncComplete
    && workerHealth.chainId === 4663 && workerHealth.protocolVersion === 6 && workerHealth.factory === v6Factory
    && workerHealth.confirmationDepth >= 20 && decimal(workerHealth.indexedThrough) && decimal(workerHealth.latestBlock)
    && BigInt(workerHealth.latestBlock) - BigInt(workerHealth.indexedThrough) >= BigInt(workerHealth.confirmationDepth)
    && now() - millis(workerHealth.lastSyncAt) <= maxAgeMs && millis(workerHealth.lastSyncAt) <= now() + 60_000;
  const checkpointAdvanced = !!directory && BigInt(directory.checkpoint.blockNumber) >= BigInt(previous.block);
  const workerSupportsCheckpoint = workerHealthy && !!directory && checkpointAdvanced
    && BigInt(workerHealth.indexedThrough) >= BigInt(directory.checkpoint.blockNumber);
  const authenticatedV6ThroughNetlify = executionDisabled && historyAuth && workerSupportsCheckpoint
    && canonicalHistory === "VERIFIED_L2" && directory.coverage === "v6-indexed" && directory.status === "ready"
    && directory.independentlyFresh && directory.staleLabelConsistent && exactLookup && entries.absent.httpStatus === 404;
  const releases = {
    historicalRegistrationWitnesses: canonicalHistory,
    historicalCheckpointReplay: canonicalHistory === "VERIFIED_L2" ? "PREVIOUS_AND_CURRENT_L2_HEADERS_MATCHED" : canonicalHistory,
    v6ThroughNetlify: authenticatedV6ThroughNetlify ? "FRESH_VERIFIED" : "UNVERIFIED",
    authorizedBackendRead: authenticatedV6ThroughNetlify ? "OBSERVED_VIA_NETLIFY_PROXY" : "UNVERIFIED",
    directAuthorizedBackendRead: "UNVERIFIED_NO_PROBE_CREDENTIAL",
    newEngineHostedIngestion: newEngineBoundary ? "DEPLOYMENT_DEPENDENT" : "UNEXPECTED_ROUTE_STATUS",
    productionReorgRecovery: "UNVERIFIED_NO_MUTATION",
  };
  const requests = Object.fromEntries(Object.entries(entries).map(([name, { body, ...entry }]) => [name, entry]));
  return { ...report, netlifyOrigin, railwayOrigin, requests, directory, exact, workerReadiness, workerHealth, chainChecks, releases,
    checks: { exactLookup, absent404: entries.absent.httpStatus === 404, executionDisabled, historyAuth, newEngineBoundary,
      workerHealthy, workerSupportsCheckpoint } };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await runIndexerProbe(), null, 2));
}
