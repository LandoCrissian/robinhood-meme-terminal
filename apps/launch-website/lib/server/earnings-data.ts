import { getAddress, type Hex } from "viem";
import historicalSnapshot from "../../data/historical-launches-4663.json";
import { earningsAddress, earningsHash, earningsPageSize, parseEarningsDirectory, sameEarningsAddress as same,
  type EarningsBinding, type EarningsDirectory, type EarningsHistory, type EarningsResponse } from "../earnings";
import { configuredCurveFixture, fixtureRpc, type CurveFixture } from "./curve-fixture";
import { curveProductionDeployment, curveProductionPins, productionReaders } from "./curve-production";
import { indexerOrigin } from "./indexer-origin";
import { fixtureEarningsContext, productionEarningsContext, readFactoryCreationFees, readFixtureEarningsContracts,
  readProductionEarningsContracts, type EarningsPoint } from "./earnings-contracts";

type Environment = Record<string, string | undefined>;
type Options = { env?: Environment; fetch?: typeof fetch; now?: () => number; fixture?: CurveFixture | null };
const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const unavailable = { status: "unavailable", reason: "Verified earnings evidence is unavailable. No zero balance is inferred.", execution: "disabled" } as const;
const maxBytes = 196_608;
const emptyHistory: EarningsHistory = { status: "unavailable", records: [], nextCursor: null, feeEvidence: "unsupported-historical-adapter" };
const recipientOf = (request: Request) => {
  const value = new URL(request.url).searchParams.get("recipient");
  return earningsAddress(value) ? value.toLowerCase() : null;
};
const publicBinding: EarningsBinding = { chainId: 4663, factory: curveProductionPins.factory[0], registry: curveProductionPins.registry[0],
  deploymentBlock: String(curveProductionDeployment.blockNumber), deploymentBlockHash: curveProductionDeployment.blockHash,
  operations: curveProductionDeployment.operating, reserve: curveProductionDeployment.reserve };

/** Single-instance upstream budget. Public reads need no authentication session;
 * all data is public, but expensive contract checks remain bounded. */
export function createEarningsReadBudget(now = Date.now) {
  let minute = -1, reads = 0, inFlight = 0;
  return { acquire() {
    const current = Math.floor(now() / 60_000);
    if (current !== minute) { minute = current; reads = 0; }
    if (reads >= 30 || inFlight >= 2) return null;
    reads++; inFlight++;
    let released = false;
    return () => { if (!released) { released = true; inFlight--; } };
  } };
}
const readBudget = createEarningsReadBudget();

async function boundedJson(response: Response) {
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body
    || Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Earnings feed unavailable"); }
  const reader = response.body.getReader(), bytes = new Uint8Array(maxBytes);
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      if (size + chunk.value.length > maxBytes) throw new Error("Earnings feed too large");
      bytes.set(chunk.value, size); size += chunk.value.length;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
}

async function configuration(request: Request, options: Options) {
  const env = options.env ?? process.env;
  const fixture = options.fixture === undefined ? configuredCurveFixture(request.headers) : options.fixture;
  if (fixture) {
    const rpc = fixtureRpc(fixture);
    const reserve = await rpc.readContract({ address: fixture.factory,
      abi: [{ type: "function", name: "futureReserveRecipient", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }], functionName: "futureReserveRecipient" });
    return { fixture, binding: { chainId: 31337, factory: fixture.factory, registry: fixture.registry,
      deploymentBlock: String(fixture.deploymentBlock), deploymentBlockHash: fixture.deploymentBlockHash, operations: fixture.feeRecipient, reserve } as EarningsBinding,
      origin: new URL(fixture.indexerUrl), credential: env.RMT_CURVE_FIXTURE_READ_KEY, path: "/earnings", fetch: options.fetch ?? fetch };
  }
  const origin = indexerOrigin(env.RMT_LAUNCH_HISTORY_INDEXER_URL, env);
  if (!origin) return null;
  return { fixture: null, binding: publicBinding, origin, credential: env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN,
    path: "/curve-earnings", fetch: options.fetch ?? fetch };
}

async function readDirectory(config: NonNullable<Awaited<ReturnType<typeof configuration>>>, recipient: string,
  after: string | undefined, token: string | undefined, now: number) {
  if (!config.credential || !/^[\x21-\x7e]{1,512}$/.test(config.credential)) return null;
  const url = new URL(config.path, config.origin);
  url.searchParams.set("recipient", recipient); url.searchParams.set("limit", String(token ? 1 : earningsPageSize));
  if (after) url.searchParams.set("after", after);
  if (token) url.searchParams.set("token", token);
  const response = await config.fetch(url, { headers: { Accept: "application/json",
    ...(config.fixture ? { "X-RMT-Fixture-Key": config.credential } : { Authorization: "Bearer " + config.credential }) },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(4_000) });
  return parseEarningsDirectory(await boundedJson(response), config.binding, recipient, now);
}

function snapshotHistory(recipient: string): EarningsHistory["records"] {
  return historicalSnapshot.launches.filter(row => row.creator && same(row.creator, recipient)).map(row => ({
    token: row.token, name: row.name, symbol: row.symbol, version: row.version as 4 | 6,
    roles: ["creator"], transactionHash: row.receipt.transactionHash,
  }));
}

async function readHistory(config: NonNullable<Awaited<ReturnType<typeof configuration>>>, recipient: string, after?: string, now = Date.now()): Promise<EarningsHistory> {
  if (config.fixture) return { ...emptyHistory, status: "ready" };
  const archive = after ? [] : snapshotHistory(recipient);
  try {
    if (!config.credential) throw new Error("Missing history credential");
    const url = new URL("/historical-launches", config.origin);
    url.searchParams.set("recipient", recipient); url.searchParams.set("limit", "10");
    if (after) url.searchParams.set("cursor", after);
    const d = await boundedJson(await config.fetch(url, { headers: { Accept: "application/json", Authorization: "Bearer " + config.credential },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4_000) })) as {
      schemaVersion: number; chainId: number; recipient: string; factory: string; launches: Array<{ token: string; name: string; symbol: string;
        historicalRelationRoles: string[]; registration: { transactionHash: string; blockNumber: number; blockHash: string; timestamp: string; logIndex: number } }>;
      checkpoint: { blockNumber: number; blockHash: string; timestamp: string; observedAt: string; stale: boolean; finality: string };
      nextCursor: string | null; earnings: { status: string };
    };
    const p = d.checkpoint;
    const time = (value: unknown): value is string => typeof value === "string"
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
    if (d.schemaVersion !== 1 || d.chainId !== 4663 || !same(d.recipient, recipient)
      || d.factory !== "0x8e75c57079a01ce2094bc4187b78710887547651" || d.earnings.status !== "unsupported"
      || !p || !Number.isSafeInteger(p.blockNumber) || p.blockNumber < 10_248_855 || !earningsHash(p.blockHash)
      || !time(p.timestamp) || !time(p.observedAt) || typeof p.stale !== "boolean" || p.finality !== "l2-confirmed"
      || Date.parse(p.observedAt) > now + 15_000 || now - Date.parse(p.observedAt) > 120_000
      || Date.parse(p.timestamp) > Date.parse(p.observedAt) + 30_000
      || !Array.isArray(d.launches) || d.launches.length > 10 || (d.nextCursor !== null && (typeof d.nextCursor !== "string" || !/^[0-9]{1,16}\.[0-9]{1,10}$/.test(d.nextCursor)))) throw new Error("Unverified historical relation");
    const rows = d.launches.map(row => {
      if (!earningsAddress(row.token) || !earningsHash(row.registration.transactionHash) || typeof row.name !== "string" || row.name.length > 100
        || !Number.isSafeInteger(row.registration.blockNumber) || row.registration.blockNumber < 10_248_855 || row.registration.blockNumber > p.blockNumber
        || !earningsHash(row.registration.blockHash) || !time(row.registration.timestamp) || Date.parse(row.registration.timestamp) > Date.parse(p.timestamp)
        || (row.registration.blockNumber === p.blockNumber && !same(row.registration.blockHash, p.blockHash))
        || !Number.isSafeInteger(row.registration.logIndex) || row.registration.logIndex < 0
        || typeof row.symbol !== "string" || row.symbol.length > 100 || !Array.isArray(row.historicalRelationRoles)
        || !row.historicalRelationRoles.length || row.historicalRelationRoles.some(role => !["creator", "current-creator-fee-recipient", "protocol-treasury"].includes(role))) throw new Error("Invalid historical row");
      return { token: row.token, name: row.name, symbol: row.symbol, version: 6 as const, roles: row.historicalRelationRoles, transactionHash: row.registration.transactionHash };
    });
    return { status: p.stale || now - Date.parse(p.timestamp) > 300_000 || archive.some(row => row.version === 4) ? "stale" : "ready",
      records: [...rows, ...archive.filter(a => !rows.some(b => same(a.token, b.token)))], nextCursor: d.nextCursor,
      feeEvidence: "unsupported-historical-adapter" };
  } catch { return { ...emptyHistory, status: archive.length ? "stale" : "unavailable", records: archive }; }
}

/** No signing API is reachable here. A failed read is unavailable, never a zero
 * earning or proof that an address has no entitlement. */
export async function earningsResponse(request: Request, options: Options = {}, token?: string, historyOnly = false, factoryOnly = false) {
  if (!["GET", "HEAD"].includes(request.method)) return Response.json({ status: "disabled" }, { status: 404, headers });
  const url = new URL(request.url), recipient = recipientOf(request), after = url.searchParams.get("after") ?? undefined;
  const keys = [...url.searchParams.keys()];
  if (!recipient || keys.some(key => !["recipient", "after"].includes(key)) || new Set(keys).size !== keys.length
    || (after && (after.length > 768 || !(historyOnly ? /^[0-9]{1,16}\.[0-9]{1,10}$/ : /^[A-Za-z0-9_-]+$/).test(after)))
    || (token && !earningsAddress(token)) || ((token || factoryOnly) && after)) return Response.json({ status: "invalid" }, { status: 400, headers });
  const release = readBudget.acquire();
  if (!release) return Response.json({ status: "unavailable", reason: "Earnings reads are temporarily limited." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  try {
    const config = await configuration(request, options);
    if (!config) return Response.json(unavailable, { status: 503, headers });
    if (historyOnly) return Response.json(await readHistory(config, recipient, after, (options.now ?? Date.now)()), { headers });
    const directory = await readDirectory(config, recipient, after, token, (options.now ?? Date.now)());
    if (!directory) return Response.json(unavailable, { status: 503, headers });
    if (factoryOnly) {
      const point = directory.checkpoint as EarningsPoint;
      const result = config.fixture
        ? await readFactoryCreationFees(await fixtureEarningsContext(config.fixture, point), getAddress(recipient))
        : await Promise.all(productionReaders().map(rpc => readFactoryCreationFees(productionEarningsContext(rpc, point), getAddress(recipient))))
          .then(results => results.every(r => r.status === "ready") && JSON.stringify(results[0]) === JSON.stringify(results[1]) ? results[0] : { status: "unavailable" as const });
      return Response.json(result.status === "ready" ? { status: "ready", factoryFees: result, execution: config.fixture ? "isolated-test" : "disabled" } : unavailable,
        { status: result.status === "ready" ? 200 : 503, headers });
    }
    if (token) {
      if (directory.status !== "ready" || directory.launches.length !== 1 || !same(directory.launches[0].token, token)) return Response.json(unavailable, { status: 503, headers });
      const registration = directory.launches[0];
      const point = directory.checkpoint as EarningsPoint;
      const result = config.fixture
        ? await readFixtureEarningsContracts(config.fixture, { ...registration, creation: registration.creation as typeof registration.creation & { blockHash: Hex; transactionHash: Hex } }, getAddress(recipient), point)
        : await readProductionEarningsContracts({ ...registration, creation: registration.creation as typeof registration.creation & { blockHash: Hex; transactionHash: Hex } }, getAddress(recipient), point);
      return Response.json(result.status === "ready" ? { status: "ready", snapshot: result, execution: config.fixture ? "isolated-test" : "disabled" } : unavailable,
        { status: result.status === "ready" ? 200 : 503, headers });
    }
    const result: EarningsResponse = { ...directory, mode: config.fixture ? "isolated-test" : "read-only", execution: config.fixture ? "isolated-test" : "disabled",
      historical: after ? emptyHistory : await readHistory(config, recipient, undefined, (options.now ?? Date.now)()) };
    return request.method === "HEAD" ? new Response(null, { headers }) : Response.json(result, { headers });
  } catch { return Response.json(unavailable, { status: 503, headers }); }
  finally { release(); }
}
