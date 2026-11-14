import { isLaunchAddress } from "../launch-data";
import { fixtureAddress, fixtureChainId, fixtureCreationFee, fixtureHash, sameHex, type CurveFixture } from "./curve-fixture";

type EvidenceBlock = { blockNumber: string; blockHash: string; timestamp: string };
type Checkpoint = EvidenceBlock & { confirmations: 2; finality: "fixture-confirmed"; l1Finality: "unverified" };
export type FixtureLaunch = {
  chainId: 31337; kind: "curve-launch-v1"; status: "created"; engineVersion: 1;
  factory: string; projectRegistry: string; token: string; initialCurve: string; creator: string; name: string; symbol: string;
  projectURI: string; totalSupplyWei: string; treasury: string | null; treasuryShareBps: number;
  creation: EvidenceBlock & { transactionHash: string; logIndex: number };
  creationFee: { amountWei: string; refundWei: string; recipient: string; logIndex: number };
  opening: { inventoryWei: string; backingWei: string; soldWei: string };
  checkpoint: Checkpoint;
};
export type FixtureDiscovery = { status: "unavailable" } | { status: "ready"; launches: FixtureLaunch[]; checkpoint: Checkpoint };
const unavailable = { status: "unavailable" } as const;
const maxBytes = 65_536;
const maxLaunches = 25;
const word = /^(0|[1-9][0-9]{0,15})$/;
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const index = (value: number) => Number.isSafeInteger(value) && value >= 0;

function block(value: EvidenceBlock | undefined): value is EvidenceBlock {
  return !!value && typeof value.blockNumber === "string" && word.test(value.blockNumber) && fixtureHash(value.blockHash)
    && typeof value.timestamp === "string" && timestamp.test(value.timestamp) && Number.isFinite(Date.parse(value.timestamp));
}

function checkpoint(value: Checkpoint | undefined): value is Checkpoint {
  return !!value && block(value) && value.confirmations === 2 && value.finality === "fixture-confirmed" && value.l1Finality === "unverified";
}

function confirmLaunch(fixture: CurveFixture, data: FixtureLaunch, current: Checkpoint, token?: string) {
  const f = data.creationFee;
  const event = data.creation;
  const check = data.checkpoint;
  return data.chainId === fixtureChainId && data.kind === "curve-launch-v1" && data.status === "created" && data.engineVersion === 1
    && [data.token, data.initialCurve, data.creator, data.factory, data.projectRegistry].every(fixtureAddress)
    && (!token || sameHex(data.token, token)) && sameHex(data.factory, fixture.factory) && sameHex(data.projectRegistry, fixture.registry)
    && typeof data.name === "string" && data.name.length > 0 && data.name.length <= 48 && typeof data.symbol === "string" && data.symbol.length > 0 && data.symbol.length <= 12
    && typeof data.projectURI === "string" && data.projectURI.length <= 196 && /^1(?:0{24}|0{25}|0{26})$/.test(data.totalSupplyWei)
    && (data.treasury === null || fixtureAddress(data.treasury)) && index(data.treasuryShareBps) && data.treasuryShareBps <= 9000
    && (data.treasury === null) === (data.treasuryShareBps === 0) && block(event)
    && fixtureHash(event.transactionHash) && index(event.logIndex) && BigInt(event.blockNumber) >= fixture.deploymentBlock
    && checkpoint(check) && BigInt(event.blockNumber) <= BigInt(check.blockNumber) && BigInt(check.blockNumber) <= BigInt(current.blockNumber)
    && Date.parse(event.timestamp) <= Date.parse(check.timestamp) && Date.parse(check.timestamp) <= Date.parse(current.timestamp)
    && (event.blockNumber !== check.blockNumber || sameHex(event.blockHash, check.blockHash))
    && (check.blockNumber !== current.blockNumber || sameHex(check.blockHash, current.blockHash))
    && f?.amountWei === fixtureCreationFee.toString() && typeof f.refundWei === "string" && /^(?:0|[1-9][0-9]{0,77})$/.test(f.refundWei)
    && sameHex(f.recipient, fixture.feeRecipient) && index(f.logIndex) && f.logIndex > event.logIndex
    && data.opening?.inventoryWei === data.totalSupplyWei && data.opening.backingWei === "0" && data.opening.soldWei === "0";
}

/** The local indexer is the only source for the fixture discovery pages. No public fallback. */
export async function readFixtureLaunches(fixture: CurveFixture, token?: string): Promise<FixtureDiscovery> {
  if (token && !isLaunchAddress(token)) return unavailable;
  try {
    const response = await fetch(fixture.indexerUrl + "/curve-launches" + (token ? `/${token.toLowerCase()}` : ""), {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2300),
    });
    if ((response.status !== 200 && !(token && response.status === 404)) || !response.body
        || response.headers.get("content-type")?.split(";")[0] !== "application/json") return unavailable;
    const reader = response.body.getReader();
    const buffer = new Uint8Array(maxBytes);
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (bytes + chunk.value.length > maxBytes) return unavailable;
        buffer.set(chunk.value, bytes);
        bytes += chunk.value.length;
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const feed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes))) as { chainId: number; status: string; launches: FixtureLaunch[]; checkpoint: Checkpoint };
    if (feed?.chainId !== fixtureChainId || feed.status !== "ready" || !checkpoint(feed.checkpoint) || !Array.isArray(feed.launches)
        || feed.launches.length > (token ? 1 : maxLaunches) || (token && (response.status === 200) !== (feed.launches.length === 1))
        || new Set(feed.launches.map((row) => row.token.toLowerCase())).size !== feed.launches.length
        || !feed.launches.every((row) => confirmLaunch(fixture, row, feed.checkpoint, token))) return unavailable;
    return { status: "ready", launches: feed.launches, checkpoint: feed.checkpoint };
  } catch {
    return unavailable;
  }
}

export async function fixtureDiscoveryResponse(request: Request, fixture: CurveFixture | null, token?: string) {
  const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store" };
  if (!fixture) return Response.json(unavailable, { status: 404, headers });
  if (new URL(request.url).search || (token !== undefined && !fixtureAddress(token))) return Response.json(unavailable, { status: 400, headers });
  const directory = await readFixtureLaunches(fixture, token);
  const status = directory.status === "unavailable" ? 503 : token && directory.launches.length === 0 ? 404 : 200;
  return request.method === "HEAD" ? new Response(null, { status, headers }) : Response.json(directory, { status, headers });
}
