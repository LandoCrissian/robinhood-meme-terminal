import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import { isLaunchAddress, launchDirectoryLimit, robinhoodChainId, type HistoricalLaunch, type LaunchBlock, type LaunchReceipt } from "../launch-data";

export const historicalSources = {
  4: {
    factory: "0x88b86f10d874c2e3c8cfe63161ffa969f3273cd4",
    runtimeHash: "0x98da08e97c0611954a18ecafe1a3638a0d88f8a274b472930d80735a1e4fc69d",
    registry: "0xfff3f69f473780ea5ea7f5525526986bb491e00e",
    registryHash: "0x6c4b7c4978075a73a87829c2367c520304d3eda17173f97a5d8710115b222c2e",
    versionHash: "0xdef50385924e38ff5aec5dc38e5e0215be1b43ba2d4d1d0bfbf6f3141e1b3426",
    marketImplementation: "0x6723276d2aecae0ab7a1c71898a01c8329ca8a0f",
    marketRuntimeHash: "0x205520656c57f0b74dfb4bc3aef32a6feb0cbbb23d57b2734bfa003f5a9c8098",
  },
  5: {
    factory: "0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd",
    runtimeHash: "0xf398d4dd1da1523ae38caac108e94374332e1df61caf5b7d87dd87e8d7ec842e",
    registry: "0x4b8b222b5caa7066c02a54e51ec1a674adf5b3a1",
    registryHash: "0x9acfd535fe96d32310ae0afb3fcf108a26ec4900fda2e8fe48ce1f234084846f",
    versionHash: "0xa31c264f9aebfa7156ccdcd5180bc3c073a84160bdb471b03f1e56e67fec751d",
  },
  6: {
    factory: "0x8e75c57079a01ce2094bc4187b78710887547651",
    runtimeHash: "0x274321493d48091b4443e007b8335a93a977e67dffe67d6147ff8557a1e58830",
    registry: "0x27c0269e16209eee149e2738d0819a2633f44246",
    registryHash: "0xf841ffa82a73f04e52e76a4074801b0a9f0793d720c2aa1e5c4c7fef899ded81",
    versionHash: "0xed6920a17ef2329c2af2fdcc7e5161caa6adc888a820cc1f04b540aab70a5c7f",
    marketImplementation: "0x7cfa54a82baee5bc3cf6177f76c20eab9afedf41",
    marketRuntimeHash: "0xf2bb6739d04de8dfd4db3cac070a46f08c42588804a8f9b516d8edfbc8b33225",
  },
} as const;

type Version = keyof typeof historicalSources;
type Anchor = {
  version: HistoricalLaunch["version"];
  launchId: string;
  token: Address;
  market: Address;
  classification: HistoricalLaunch["classification"];
  blockNumber: string;
  transactionHash: Hex;
};
export const historicalAnchors = [
  {
    version: 4, launchId: "0", classification: "deployment-test",
    token: "0xbde596366551aacae3e7c397b72f53f2a524582a",
    market: "0xe0ded88c6d2ab5831c64d57f4d4ed21c3512f6c4",
    blockNumber: "8886328",
    transactionHash: "0x5cd5a0300fb1a10f12a63b89ae6ae32dbaa25429db06a78a3b1b0c23adea3f6e",
  },
  {
    version: 4, launchId: "1", classification: "historical",
    token: "0xab374d24afbd943a134adb381d9646e71c6f6c0c",
    market: "0xfeee90288a7037fbdb4ec5b05dc7cc5e762d5fb7",
    blockNumber: "9156510",
    transactionHash: "0xe5cd6ed09a3cccae743b7c29c0ee0971f3797986bce171eadc3642de60b3410b",
  },
  {
    version: 6, launchId: "0", classification: "retired",
    token: "0xdba33be56c89cc9fc014c4459028d7e5c7878671",
    market: "0xb26fb775c0ac365d369bee9ac2e044c5d90ffbee",
    blockNumber: "10387857",
    transactionHash: "0x4eb7b596ccdf5d0aa5e4c8d0d50311df5108b44f47d9d39d09b1916524d825d5",
  },
  {
    version: 6, launchId: "1", classification: "historical",
    token: "0xfe7e1595c757ce5f034ba3e3e002c7184df6075e",
    market: "0x5cc52f3370b942e7c1414986ae97e41b319085b7",
    blockNumber: "15849639",
    transactionHash: "0x245491e8f8c370a66ff0355d5554bdfa933c8849adc4a86050fbc4469ae87a41",
  },
] as const satisfies readonly Anchor[];

const v4Event = parseAbi(["event TokenLaunched(uint256 indexed launchId,address indexed token,address indexed creator,address market,address rewardVault,bytes32 graduationPoolId,string name,string symbol,string metadataURI,uint16[5] rewardBps)"]);
const v6Event = parseAbi(["event TokenLaunchedV6(uint256 indexed launchId,address indexed token,address indexed creator,address market,address feeSplitter,bytes32 graduationPoolId,bytes32 policyId,uint32 policyVersion,uint16 curveFeeBps,uint16 creatorFeeShareBps,uint16 protocolFeeShareBps,uint16 postGraduationFeeBps,bool fairStartEnabled,uint64 fairStartDelayBlocks,uint64 fairStartDurationBlocks,uint16 fairStartMaxTxBps,uint16 fairStartMaxWalletBps,uint256 graduationTarget,bool officialMigration,string name,string symbol,string metadataURI)"]);
const migrationEvent = parseAbi(["event OfficialRMTMigrationLaunched(uint256 indexed launchId,address indexed token,address indexed creator,address migrationAuthority,address officialLegacyToken)"]);
const v4GetLaunch = parseAbi(["function getLaunch(uint256) view returns ((address token,address market,address rewardVault,bytes32 graduationPoolId,address creator,uint64 createdAt))"]);
const v6GetLaunch = parseAbi(["function getLaunch(uint256) view returns ((address token,address market,address rewardVault,bytes32 graduationPoolId,address creator,bytes32 policyId,uint32 policyVersion,uint64 createdAt,bool officialMigration))"]);
const views = parseAbi([
  "function launchCount() view returns (uint256)",
  "function activeFactory() view returns (address)",
  "function activeVersion() view returns (bytes32)",
  "function factoryRegistry() view returns (address)",
  "function token() view returns (address)",
  "function graduationPoolId() view returns (bytes32)",
  "function graduated() view returns (bool)",
  "function liquidityMigrated() view returns (bool)",
]);

type RpcMethod = "eth_chainId" | "eth_blockNumber" | "eth_getBlockByNumber" | "eth_getTransactionReceipt" | "eth_getCode" | "eth_call";
type RpcPeer = { host: string; read: (method: RpcMethod, params: unknown[]) => Promise<unknown> };
const providerUrls = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood.api.pocket.network",
  "https://robinhood-rpc.publicnode.com",
] as const;

class RpcUnavailable extends Error {}
class EvidenceMismatch extends Error {}

export function rpcPeer(url: (typeof providerUrls)[number], fetcher: typeof fetch = fetch): RpcPeer {
  return {
    host: new URL(url).hostname,
    async read(method, params) {
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new RpcUnavailable("RPC connection failed");
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new RpcUnavailable("RPC HTTP failure");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let body = "";
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 262_144) {
            await reader.cancel();
            throw new EvidenceMismatch("RPC response exceeded its size limit");
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } catch (error) {
        if (error instanceof EvidenceMismatch) throw error;
        throw new RpcUnavailable("RPC response did not complete");
      } finally {
        reader.releaseLock();
      }
      let result: unknown;
      try {
        result = JSON.parse(body);
      } catch {
        throw new EvidenceMismatch("Malformed RPC JSON");
      }
      const packet = record(result);
      if (packet.jsonrpc !== "2.0" || packet.id !== 1) throw new EvidenceMismatch("Invalid JSON-RPC envelope");
      if (packet.error) throw new RpcUnavailable("RPC returned an error");
      if (!Object.hasOwn(packet, "result")) throw new EvidenceMismatch("Missing JSON-RPC result");
      return packet.result;
    },
  };
}

function requireEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new EvidenceMismatch(message);
}

function record(value: unknown): Record<string, unknown> {
  requireEvidence(typeof value === "object" && value !== null && !Array.isArray(value), "Expected RPC object");
  return value as Record<string, unknown>;
}

function hash(value: unknown): Hex {
  requireEvidence(typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value), "Invalid evidence hash");
  return value.toLowerCase() as Hex;
}

function hexData(value: unknown): Hex {
  requireEvidence(typeof value === "string" && /^0x(?:[0-9a-f]{2})+$/i.test(value), "Missing or invalid bytecode or call data");
  return value.toLowerCase() as Hex;
}

function address(value: unknown): Address {
  requireEvidence(isLaunchAddress(value) && !/^0x0{40}$/i.test(value), "Invalid evidence address");
  return value.toLowerCase() as Address;
}

function quantity(value: unknown): bigint {
  requireEvidence(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value), "Invalid block or log number");
  return BigInt(value);
}

function blockTag(number: string): Hex {
  requireEvidence(/^[1-9][0-9]{0,14}$/.test(number), "Invalid checkpoint block");
  return ("0x" + BigInt(number).toString(16)) as Hex;
}

function canonicalBlock(value: unknown, blockNumber: string): LaunchBlock {
  if (value === null) throw new RpcUnavailable("Block unavailable");
  const block = record(value);
  requireEvidence(quantity(block.number).toString() === blockNumber, "Unexpected canonical block number");
  const timestamp = quantity(block.timestamp);
  requireEvidence(timestamp > 0 && timestamp <= 8_640_000_000_000n, "Invalid block timestamp");
  return { blockNumber, blockHash: hash(block.hash), timestamp: new Date(Number(timestamp) * 1000).toISOString() };
}

function confirmedLog(log: Record<string, unknown>, receipt: Omit<LaunchReceipt, "logIndex">) {
  requireEvidence(
    log.removed === false && quantity(log.blockNumber).toString() === receipt.blockNumber &&
    hash(log.blockHash) === receipt.blockHash && hash(log.transactionHash) === receipt.transactionHash,
    "Launch log is not bound to its successful receipt",
  );
  const index = quantity(log.logIndex);
  requireEvidence(index <= BigInt(Number.MAX_SAFE_INTEGER), "Invalid log index");
  requireEvidence(Array.isArray(log.topics) && log.topics.length === 4, "Invalid indexed launch topics");
  return { logIndex: Number(index), topics: log.topics.map(hash) as [Hex, ...Hex[]], data: hexData(log.data) };
}

export function verifyHistoricalReceipt(rawReceipt: unknown, rawBlock: unknown, anchor: Anchor) {
  if (rawReceipt === null) throw new RpcUnavailable("Launch receipt unavailable");
  const receipt = record(rawReceipt);
  const block = canonicalBlock(rawBlock, anchor.blockNumber);
  const pinned = historicalSources[anchor.version];
  requireEvidence(
    hash(receipt.transactionHash) === anchor.transactionHash && receipt.status === "0x1" &&
    address(receipt.to) === pinned.factory && quantity(receipt.blockNumber).toString() === anchor.blockNumber &&
    hash(receipt.blockHash) === block.blockHash, "Unexpected launch receipt identity or status",
  );
  requireEvidence(Array.isArray(receipt.logs) && receipt.logs.length <= 256, "Invalid launch receipt logs");
  const receiptIdentity = { ...block, transactionHash: anchor.transactionHash };
  const factoryLogs = receipt.logs.map(record).filter(log => address(log.address) === pinned.factory);
  const eventAbi = anchor.version === 4 ? v4Event : v6Event;
  const eventSelector = toEventSelector(eventAbi[0]);
  const matching = factoryLogs.filter(log => Array.isArray(log.topics) && (typeof log.topics[0] === "string" && log.topics[0].toLowerCase() === eventSelector));
  requireEvidence(matching.length === 1, "Expected exactly one registration from the canonical factory");
  const launchLog = confirmedLog(matching[0], receiptIdentity);
  const decoded = decodeEventLog({ abi: eventAbi, data: launchLog.data, topics: launchLog.topics, strict: true }).args;
  requireEvidence(
    decoded.launchId.toString() === anchor.launchId &&
    address(decoded.market) === anchor.market && address(decoded.token) === anchor.token,
    "Factory event does not match the pinned launch registration",
  );
  const creator = address(decoded.creator);
  const name = decoded.name;
  const symbol = decoded.symbol;
  requireEvidence(
    Buffer.byteLength(name) >= 1 && Buffer.byteLength(name) <= 32 &&
    !/[\p{Cc}\p{Cf}]/u.test(name) && /^[A-Z0-9]{2,10}$/.test(symbol),
    "Unsupported launch display metadata",
  );
  const designated = anchor.version === 6 && anchor.launchId === "0";
  requireEvidence(
    ("officialMigration" in decoded && decoded.officialMigration) === designated,
    "Unexpected historical identity designation",
  );
  let migrationLog: ReturnType<typeof confirmedLog> | null = null;
  if (designated) {
    const migrations = factoryLogs.filter(log => Array.isArray(log.topics) && log.topics[0] === toEventSelector(migrationEvent[0]));
    requireEvidence(migrations.length === 1 && anchor.version === 6 && anchor.launchId === "0", "Unexpected migration designation");
    migrationLog = confirmedLog(migrations[0], receiptIdentity);
    // This indexed event proves the historical identity designation only.
    const migration = decodeEventLog({ abi: migrationEvent, topics: migrationLog.topics, data: migrationLog.data, strict: true }).args;
    requireEvidence(
      migration.launchId === decoded.launchId && address(migration.token) === anchor.token &&
      address(migration.creator) === creator && address(migration.officialLegacyToken) === historicalAnchors[1].token,
      "Unexpected legacy identity designation",
    );
  }
  const launch: HistoricalLaunch = {
    kind: "historical-rmt", version: anchor.version, classification: anchor.classification, factory: pinned.factory,
    launchId: anchor.launchId, token: anchor.token, market: anchor.market, name, symbol, creator,
    receipt: { ...receiptIdentity, logIndex: launchLog.logIndex },
    lifecycle: "unknown", lifecycleAt: null, reservedPoolId: hash(decoded.graduationPoolId),
  };
  return {
    launch,
    launchLog,
    migrationLog,
    vault: address("feeSplitter" in decoded ? decoded.feeSplitter : decoded.rewardVault),
    policy: "policyId" in decoded ? {
      id: hash(decoded.policyId), version: decoded.policyVersion, identityDesignation: decoded.officialMigration,
    } : null,
  };
}

async function twoPeerEvidence<T>(peers: RpcPeer[], read: (peer: RpcPeer) => Promise<T>) {
  let agreed: { value: T; key: string; host: string } | undefined;

  for (const peer of peers) {
    try {
      const value = await read(peer);
      const serialized = JSON.stringify(value);
      if (agreed) {
        requireEvidence(agreed.key === serialized, "Independent RPC evidence disagrees");
        return { value, providers: [agreed.host, peer.host] };
      }
      agreed = { value, key: serialized, host: peer.host };
    } catch (error) {
      if (!(error instanceof RpcUnavailable)) throw error;
    }
  }
  throw new RpcUnavailable("Two independent RPC providers did not return usable evidence");
}

async function readAnchor(peer: RpcPeer, anchor: Anchor) {
  const [receipt, block] = await Promise.all([
    peer.read("eth_getTransactionReceipt", [anchor.transactionHash]),
    peer.read("eth_getBlockByNumber", [blockTag(anchor.blockNumber), false]),
  ]);
  return verifyHistoricalReceipt(receipt, block, anchor);
}

async function anchoredState(peer: RpcPeer, blockNumber: string, anchorEvidence: Awaited<ReturnType<typeof readAnchor>>[]) {
  const tag = blockTag(blockNumber);
  const checkpoint = canonicalBlock(await peer.read("eth_getBlockByNumber", [tag, false]), blockNumber);
  const stateAt = { blockHash: checkpoint.blockHash, requireCanonical: true };
  const readCode = async (to: Address) => hexData(await peer.read("eth_getCode", [to, stateAt]));
  const stateCall = async (to: Address, data: Hex) => {
    // No caller, value, overrides or dynamic method names are permitted.
    return hexData(await peer.read("eth_call", [{ to, data }, stateAt]));
  };
  const view = async (target: Address, functionName: (typeof views)[number]["name"]) => {
    const data = await stateCall(target, encodeFunctionData({ abi: views, functionName }));
    return decodeFunctionResult({ abi: views, functionName, data });
  };
  const verifyFactory = async (version: Version) => {
    const pin = historicalSources[version];
    const [factoryCode, registryCode, count, activeFactory, activeVersion] = await Promise.all([
      readCode(pin.factory), readCode(pin.registry), view(pin.factory, "launchCount"),
      view(pin.registry, "activeFactory"), view(pin.registry, "activeVersion"),
    ]);
    requireEvidence(
      keccak256(factoryCode) === pin.runtimeHash && keccak256(registryCode) === pin.registryHash &&
      address(activeFactory) === pin.factory && hash(activeVersion) === pin.versionHash,
      "Historical factory or registry bindings disagree with their pins",
    );
    requireEvidence(typeof count === "bigint" && count <= BigInt(launchDirectoryLimit), "Factory count exceeded bounded snapshot scope");
    if ("marketImplementation" in pin) {
      requireEvidence(
        keccak256(await readCode(pin.marketImplementation)) === pin.marketRuntimeHash,
        "Legacy market implementation runtime does not match its pin",
      );
    }
    if (version === 6) {
      requireEvidence(address(await view(pin.factory, "factoryRegistry")) === pin.registry, "V6 registry binding mismatch");
    }
    return { version, factory: pin.factory, runtimeHash: pin.runtimeHash, registry: pin.registry, registryHash: pin.registryHash, versionHash: pin.versionHash, launchCount: Number(count), ...("marketImplementation" in pin ? { marketImplementation: pin.marketImplementation, marketRuntimeHash: pin.marketRuntimeHash } : {}) };
  };
  const verifyRecord = async (evidence: (typeof anchorEvidence)[number]) => {
    const { launch, vault, policy } = evidence;
    const pin = historicalSources[launch.version];
    const abi = launch.version === 4 ? v4GetLaunch : v6GetLaunch;
    const data = await stateCall(pin.factory, encodeFunctionData({ abi, functionName: "getLaunch", args: [BigInt(launch.launchId)] }));
    const entry = decodeFunctionResult({ abi, functionName: "getLaunch", data });
    requireEvidence(
      address(entry.token) === launch.token && address(entry.market) === launch.market && address(entry.rewardVault) === vault &&
      address(entry.creator) === launch.creator && hash(entry.graduationPoolId) === launch.reservedPoolId &&
      new Date(Number(entry.createdAt) * 1000).toISOString() === launch.receipt.timestamp,
      "Factory's immutable registration disagrees with the receipt",
    );
    if (policy) {
      requireEvidence(
        "policyId" in entry && hash(entry.policyId) === policy.id && entry.policyVersion === policy.version &&
        entry.officialMigration === policy.identityDesignation, "Receipt policy disagrees with registry state",
      );
    }
    const [code, token, reservedPoolId, graduated, migrated] = await Promise.all([
      readCode(launch.market as Address), view(launch.market as Address, "token"),
      view(launch.market as Address, "graduationPoolId"), view(launch.market as Address, "graduated"),
      view(launch.market as Address, "liquidityMigrated"),
    ]);
    const expectedProxy = "0x363d3d373d3d3d363d73" + pin.marketImplementation.slice(2) + "5af43d82803e903d91602b57fd5bf3";
    requireEvidence(
      code === expectedProxy && address(token) === launch.token && hash(reservedPoolId) === launch.reservedPoolId,
      "Unexpected legacy market bindings",
    );
    // Graduation state alone says nothing about the funding or availability of a Uniswap position.
    return graduated === false && migrated === false ? "curve" as const : "unknown" as const;
  };
  const [factories, lifecycle] = await Promise.all([
    Promise.all([verifyFactory(4), verifyFactory(5), verifyFactory(6)]),
    Promise.all(anchorEvidence.map(verifyRecord)),
  ]);
  // Re-read after all state lookups so a replaced block cannot silently win a race.
  const checked = canonicalBlock(await peer.read("eth_getBlockByNumber", [tag, false]), blockNumber);
  requireEvidence(checked.blockHash === checkpoint.blockHash, "Checkpoint reorganized during verification");
  return { factories, lifecycle, checkpoint };
}

export async function verifyHistoricalLaunches(checkpointNumber?: string, peers = providerUrls.map(url => rpcPeer(url))) {
  requireEvidence(new Set(peers.map(peer => peer.host)).size === peers.length && peers.length >= 2, "Independent RPC hostnames are required");
  const confirmed: RpcPeer[] = [];
  for (const peer of peers) {
    try {
      requireEvidence(quantity(await peer.read("eth_chainId", [])) === BigInt(robinhoodChainId), "Unexpected RPC chain");
      confirmed.push(peer);
    } catch (error) {
      if (!(error instanceof RpcUnavailable)) throw error;
    }
  }
  const anchors = await twoPeerEvidence(confirmed, peer => Promise.all(historicalAnchors.map(anchor => readAnchor(peer, anchor))));
  let number = checkpointNumber;
  if (!number) {
    const heads = await Promise.all(confirmed.map(async peer => {
      try {
        return quantity(await peer.read("eth_blockNumber", []));
      } catch (error) {
        if (!(error instanceof RpcUnavailable)) throw error;
        return null;
      }
    }));
    const available = heads.filter(value => value !== null).sort((a, b) => a > b ? -1 : a === b ? 0 : 1);
    requireEvidence(available.length >= 2 && available[1] > 20n, "Two current RPC heads are required");
    number = (available[1] - 20n).toString();
  }
  const evidence = await twoPeerEvidence(confirmed, peer => anchoredState(peer, number, anchors.value));
  const { checkpoint, factories, lifecycle } = evidence.value;
  requireEvidence(anchors.value.every(({ launch }) => BigInt(launch.receipt.blockNumber) <= BigInt(checkpoint.blockNumber)), "Launch receipt is newer than the checkpoint");
  requireEvidence(factories.every(row => row.launchCount >= historicalAnchors.filter(anchor => anchor.version === row.version).length), "Factory count is lower than its verified history");
  const launches = anchors.value.map(({ launch }, index): HistoricalLaunch => ({
    ...launch, lifecycle: lifecycle[index], lifecycleAt: lifecycle[index] === "unknown" ? null : checkpoint,
  }));
  return {
    schemaVersion: 1,
    chainId: robinhoodChainId,
    observedAt: checkpoint.timestamp,
    verificationBlock: checkpoint,
    coverage: "reviewed-v4-and-v6-receipts",
    completeForPinnedFactories: factories.every(row => row.launchCount === historicalAnchors.filter(anchor => anchor.version === row.version).length),
    l1Finality: "unverified",
    receiptProviders: anchors.providers,
    stateProviders: evidence.providers,
    factories,
    launches,
  };
}
