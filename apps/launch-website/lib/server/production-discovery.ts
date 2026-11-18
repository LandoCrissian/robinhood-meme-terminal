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
    return { status: data.status === "stale" || now - Date.parse(point.timestamp) > 120_000 ? "stale" : "ready",
      launches: clean, checkpoint: cleanPoint };
  } catch { return unavailable; }
}

// Reuses the existing Railway origin and bearer credential; neither is returned
// to the browser. This feed is never merged with historical V4/V6 registrations.
export async function readProductionDiscovery(token?: string, options: { env?: Record<string, string | undefined>; fetch?: typeof fetch; now?: number } = {}): Promise<ProductionDiscovery> {
  const env = options.env ?? process.env;
  const endpoint = env.RMT_LAUNCH_HISTORY_INDEXER_URL;
  const credential = env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN;
  if (!endpoint || !credential || !/^[\x21-\x7e]{1,512}$/.test(credential) || (token && !address(token))) return unavailable;
  try {
    const origin = indexerOrigin(endpoint, env);
    if (!origin) return unavailable;
    const url = new URL(token ? "/curve-launches/" + token.toLowerCase() : "/curve-launches?limit=25", origin);
    const response = await (options.fetch ?? fetch)(url, { headers: { Accept: "application/json", Authorization: "Bearer " + credential },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(4_000) });
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body
        || Number(response.headers.get("content-length")) > 65_536) { await response.body?.cancel(); return unavailable; }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(65_536);
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (size + chunk.value.byteLength > bytes.length) return unavailable;
        bytes.set(chunk.value, size); size += chunk.value.byteLength;
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    return parseProductionDiscovery(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))), token, options.now);
  } catch { return unavailable; }
}

export function productionDirectory(data: ProductionDiscovery): NewEngineDirectory {
  return data.status !== "unavailable" ? { status: "ready", launches: data.launches.map((registration) => ({ registration, state: "created" })) }
    : { status: "unavailable" };
}

export function configuredProductionDiscovery(headers: Headers, env: Record<string, string | undefined> = process.env) {
  return env.RMT_CURVE_PRODUCTION_DISCOVERY === curveProductionProfile && !env.RMT_CURVE_FIXTURE
    && headers.get("host") === "www.rmtlaunch.fun" && headers.get("x-forwarded-proto") === "https" && !headers.has("forwarded")
    && (!headers.has("x-forwarded-host") || headers.get("x-forwarded-host") === "www.rmtlaunch.fun");
}

export async function productionDiscoveryResponse(request: Request, token?: string) {
  const headers = new Headers({ "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "Netlify-Vary": "query" });
  if (!configuredProductionDiscovery(request.headers) || (request.method !== "GET" && request.method !== "HEAD")) return Response.json({ status: "unavailable" }, { status: 404, headers });
  if (new URL(request.url).search || (token && !address(token))) return Response.json({ status: "invalid" }, { status: 400, headers });
  const data = await readProductionDiscovery(token);
  const status = data.status === "unavailable" ? 503 : token && !data.launches.length ? (data.status === "stale" ? 503 : 404) : 200;
  if (status === 200 && request.method === "GET" && data.status === "ready" && (!token || token === token.toLowerCase())) {
    const seconds = Math.max(0, Math.min(15, Math.floor((Date.parse(data.checkpoint.timestamp) + 120_000 - Date.now() - 5_000) / 1_000)));
    if (seconds > 0) headers.set("Netlify-CDN-Cache-Control", `public, durable, s-maxage=${seconds}, must-revalidate`);
  }
  return request.method === "HEAD" ? new Response(null, { status, headers }) : Response.json(data, { status, headers });
}
