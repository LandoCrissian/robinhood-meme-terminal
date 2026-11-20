import { hasCurveRegistration, type CurveRegistration, type NewEngineDirectory } from "../curve-lifecycle";
import { fixtureHash } from "./curve-fixture";
import { curveProductionDeployment, curveProductionPins, curveProductionProfile } from "./curve-production";
import { indexerOrigin } from "./indexer-origin";

export type ProductionRegistration = CurveRegistration & {
  projectURI: string; treasury: string | null; treasuryShareBps: number; revenueLedger: string;
  creationFee: { amountWei: string; refundWei: string; recipient: string; logIndex: number };
  opening?: { inventoryWei: string; backingWei: string; soldWei: string };
};
export type ProductionDiscovery = { status: "unavailable"; launches: [] } | {
  status: "ready" | "stale"; launches: ProductionRegistration[]; checkpoint: CurveRegistration["checkpoint"];
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-f]{40}$/i.test(a) && BigInt(a) > 0xffffn;
const unavailable: ProductionDiscovery = { status: "unavailable", launches: [] };

export function parseProductionDiscovery(raw: unknown, token?: string, now = Date.now()): ProductionDiscovery {
  try {
    if (!raw || typeof raw !== "object") return unavailable;
    const data = raw as { chainId: unknown; profile: unknown; status: unknown; deployment: Record<string, string>;
      checkpoint: CurveRegistration["checkpoint"]; launches: ProductionRegistration[]; nextCursor: unknown };
    if (data.chainId !== 4663 || data.profile !== "rmt-curve-fixed-supply-security-v2" || !["ready", "stale"].includes(String(data.status))
        || !same(data.deployment.factory, curveProductionPins.factory[0]) || !same(data.deployment.registry, curveProductionPins.registry[0])
        || data.deployment.blockNumber !== String(curveProductionDeployment.blockNumber)
        || !same(data.deployment.blockHash, curveProductionDeployment.blockHash) || !Array.isArray(data.launches)
        || data.launches.length > (token ? 1 : 25) || (data.nextCursor !== null && (token || !address(data.nextCursor)))) return unavailable;
    const point = data.checkpoint;
    if (!point || point.finality !== "l2-confirmed" || point.l1Finality !== "unverified" || !fixtureHash(point.blockHash)
        || !/^[1-9][0-9]{0,15}$/.test(point.blockNumber) || BigInt(point.blockNumber) < curveProductionDeployment.blockNumber
        || !Number.isInteger(point.confirmations) || point.confirmations < 20 || point.confirmations > 256
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(point.timestamp)
        || !Number.isFinite(Date.parse(point.timestamp)) || Date.parse(point.timestamp) > now + 15_000) return unavailable;
    const seen = new Set<string>();
    const cleanPoint = { blockNumber: point.blockNumber, blockHash: point.blockHash, timestamp: point.timestamp,
      confirmations: point.confirmations, finality: point.finality, l1Finality: point.l1Finality };
    const clean: ProductionRegistration[] = [];
    for (const row of data.launches) {
      if (!hasCurveRegistration(row) || !same(row.factory, curveProductionPins.factory[0])
          || !same(row.projectRegistry, curveProductionPins.registry[0]) || !hasCurveRegistration({ ...row, checkpoint: cleanPoint })
          || !address(row.revenueLedger) || typeof row.projectURI !== "string" || row.projectURI.length > 196
          || (row.treasury !== null && !address(row.treasury)) || !Number.isInteger(row.treasuryShareBps)
          || row.treasuryShareBps < 0 || row.treasuryShareBps > 9000 || (row.treasury === null) !== (row.treasuryShareBps === 0)
          || row.creationFee.amountWei !== String(curveProductionDeployment.creationFeeWei) || row.creationFee.refundWei !== "0"
          || !same(row.creationFee.recipient, curveProductionDeployment.operating)
          || !Number.isSafeInteger(row.creationFee.logIndex) || row.creationFee.logIndex <= row.creation.logIndex
          || typeof row.name !== "string" || typeof row.symbol !== "string" || row.name.length > 48 || row.symbol.length > 12
          || (token && !same(row.token, token)) || seen.has(row.token.toLowerCase())) return unavailable;
      seen.add(row.token.toLowerCase());
      // Only known public fields leave the server. Never forward unknown backend
      // properties, private drafts, credentials or an asserted trading lifecycle.
      clean.push({ kind: row.kind, status: row.status, chainId: row.chainId, engineVersion: row.engineVersion,
        factory: row.factory, projectRegistry: row.projectRegistry, token: row.token, initialCurve: row.initialCurve,
        creator: row.creator, revenueLedger: row.revenueLedger, name: row.name, symbol: row.symbol,
        totalSupplyWei: row.totalSupplyWei, tokenDecimals: row.tokenDecimals, projectURI: row.projectURI,
        treasury: row.treasury, treasuryShareBps: row.treasuryShareBps,
        creation: { blockNumber: row.creation.blockNumber, blockHash: row.creation.blockHash, timestamp: row.creation.timestamp,
          transactionHash: row.creation.transactionHash, logIndex: row.creation.logIndex },
        creationFee: { amountWei: row.creationFee.amountWei, refundWei: row.creationFee.refundWei,
          recipient: row.creationFee.recipient, logIndex: row.creationFee.logIndex }, checkpoint: cleanPoint });
    }
    return { status: data.status === "stale" || now - Date.parse(point.timestamp) >= 120_000 ? "stale" : "ready",
      launches: clean, checkpoint: cleanPoint };
  } catch { return unavailable; }
}

// Diagnostics contain fixed categories and HTTP status only. Neither raw upstream
// bodies, exception messages, origins nor credentials may cross this boundary.
export type ProductionReadDiagnostic = {
  reason: "config_missing" | "credential_invalid" | "origin_rejected" | "token_invalid"
    | "unauthorized" | "forbidden" | "rate_limited" | "upstream_http" | "network"
    | "response_body" | "response_schema" | "stale_checkpoint" | "stale_upstream";
  status?: number;
};
type ProductionReadOptions = {
  env?: Record<string, string | undefined>; fetch?: typeof fetch; now?: number;
  onDiagnostic?: (diagnostic: ProductionReadDiagnostic) => void;
};
let lastDiagnosticAt = -Infinity;

// Reuses the existing Railway origin and bearer credential; neither is returned
// to the browser. This feed is never merged with historical V4/V6 registrations.
export async function readProductionDiscovery(token?: string, options: ProductionReadOptions = {}): Promise<ProductionDiscovery> {
  const env = options.env ?? process.env;
  const report = (reason: ProductionReadDiagnostic["reason"], status?: number) => {
    const diagnostic = { reason, ...(status === undefined ? {} : { status }) };
    if (options.onDiagnostic) options.onDiagnostic(diagnostic);
    else if (Date.now() - lastDiagnosticAt >= 60_000) {
      lastDiagnosticAt = Date.now();
      console.warn(JSON.stringify({ event: "production_discovery_degraded", ...diagnostic }));
    }
    return unavailable;
  };
  const endpoint = env.RMT_LAUNCH_HISTORY_INDEXER_URL;
  const credential = env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN;
  if (!endpoint || !credential) return report("config_missing");
  if (!/^[\x21-\x7e]{1,512}$/.test(credential)) return report("credential_invalid");
  if (token && !address(token)) return report("token_invalid");
  const origin = indexerOrigin(endpoint, env);
  if (!origin) return report("origin_rejected");
  const url = new URL(token ? "/curve-launches/" + token.toLowerCase() : "/curve-launches?limit=25", origin);
  let stage: "network" | "response_body" = "network";
  try {
    const response = await (options.fetch ?? fetch)(url, { headers: { Accept: "application/json", Authorization: "Bearer " + credential },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(4_000) });
    if (!response.ok) {
      await response.body?.cancel();
      return report(response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden"
        : response.status === 429 ? "rate_limited" : "upstream_http", response.status);
    }
    stage = "response_body";
    if (response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body
        || Number(response.headers.get("content-length")) > 65_536) {
      await response.body?.cancel();
      return report("response_body");
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(65_536);
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (size + chunk.value.byteLength > bytes.length) return report("response_body");
        bytes.set(chunk.value, size); size += chunk.value.byteLength;
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    const data = parseProductionDiscovery(raw, token, options.now);
    if (data.status === "unavailable") return report("response_schema");
    if (data.status === "stale") report(raw.status === "stale" ? "stale_upstream" : "stale_checkpoint");
    return data;
  } catch { return report(stage); }
}

export function productionDirectory(data: ProductionDiscovery): NewEngineDirectory {
  if (data.status === "unavailable") return { status: "unavailable" };
  if (data.status === "stale") return { status: "stale",
    history: data.launches.map((registration) => ({ registration, state: "unknown" })) };
  return { status: "ready", freshUntil: Date.parse(data.checkpoint.timestamp) + 120_000, launches: data.launches.map((registration) => ({ registration, state: "created" })) };
}

export function configuredProductionDiscovery(headers: Headers, env: Record<string, string | undefined> = process.env) {
  return env.RMT_CURVE_PRODUCTION_DISCOVERY === curveProductionProfile && !env.RMT_CURVE_FIXTURE
    && headers.get("host") === "www.rmtlaunch.fun" && headers.get("x-forwarded-proto") === "https" && !headers.has("forwarded")
    && (!headers.has("x-forwarded-host") || headers.get("x-forwarded-host") === "www.rmtlaunch.fun");
}

export function createProductionDiscoveryHandler(options: {
  env?: Record<string, string | undefined>;
  read?: typeof readProductionDiscovery;
  now?: () => number;
} = {}) {
  const env = options.env ?? process.env;
  const read = options.read ?? readProductionDiscovery;
  const now = options.now ?? Date.now;
  return async function productionDiscoveryResponse(request: Request, token?: string) {
    const headers = new Headers({ "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "Netlify-Vary": "query" });
    if (!configuredProductionDiscovery(request.headers, env) || (request.method !== "GET" && request.method !== "HEAD")) return Response.json({ status: "unavailable" }, { status: 404, headers });
    if (new URL(request.url).search || (token && !address(token))) return Response.json({ status: "invalid" }, { status: 400, headers });
    const observed = await read(token, { env, now: now() });
    // A response may cross the freshness boundary while reading its body.
    const data = observed.status === "ready" && now() - Date.parse(observed.checkpoint.timestamp) >= 120_000
      ? { ...observed, status: "stale" as const } : observed;
    const status = data.status === "unavailable" || data.status === "stale" ? 503 : token && !data.launches.length ? 404 : 200;
    if (status === 200 && request.method === "GET" && data.status === "ready" && (!token || token === token.toLowerCase())) {
      const seconds = Math.max(0, Math.min(15, Math.floor((Date.parse(data.checkpoint.timestamp) + 120_000 - now() - 5_000) / 1_000)));
      if (seconds > 0) headers.set("Netlify-CDN-Cache-Control", `public, durable, s-maxage=${seconds}, must-revalidate`);
    }
    return request.method === "HEAD" ? new Response(null, { status, headers }) : Response.json(data, { status, headers });
  };
}

export const productionDiscoveryResponse = createProductionDiscoveryHandler();
