import { isLaunchAddress } from "../launch-data";
import { encodeAbiParameters, getAddress, keccak256, zeroAddress } from "viem";
import { fixtureAddress, fixtureChainId, fixtureCreationFee, fixtureHash, sameHex, type CurveFixture } from "./curve-fixture";

type EvidenceBlock = { blockNumber: string; blockHash: string; timestamp: string };
type Checkpoint = EvidenceBlock & { confirmations: 2; finality: "fixture-confirmed"; l1Finality: "unverified" };
type ReceiptEvent = EvidenceBlock & { transactionHash: string; logIndex: number };
type CurveTrade = ReceiptEvent & {
  side: "buy" | "sell"; account: string; tokenWei: string; nativeWei: string; nativeRefundWei: string;
  feeWei: string; backingWei: string; soldWei: string;
};
type Graduation = ReceiptEvent & {
  poolId: string; poolKey: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
  positionTokenId: string; owner: string; liquidityWei: string; nativeUsedWei: string; tokenUsedWei: string;
  nativeDustWei: string; tokenDustWei: string; poolManager: string; positionManager: string; sqrtPriceX96: string;
  spotSqrtPriceX96: string; spotTick: number; poolLiquidityWei: string;
};
export type FixtureLifecycle = {
  phase: "curve" | "eligible" | "graduated"; activeCurve: string; observed: EvidenceBlock;
  backingWei: string; soldWei: string; inventoryWei: string; graduationBackingWei: string; graduationSoldWei: string;
  feeBps: number; trades: CurveTrade[]; graduation?: Graduation;
};
export type FixtureLaunch = {
  chainId: 31337; kind: "curve-launch-v1"; status: "created"; engineVersion: 1;
  factory: string; projectRegistry: string; token: string; initialCurve: string; creator: string; name: string; symbol: string;
  projectURI: string; totalSupplyWei: string; treasury: string | null; treasuryShareBps: number;
  creation: EvidenceBlock & { transactionHash: string; logIndex: number };
  creationFee: { amountWei: string; refundWei: string; recipient: string; logIndex: number };
  opening: { inventoryWei: string; backingWei: string; soldWei: string };
  checkpoint: Checkpoint;
  lifecycle: FixtureLifecycle;
};
export type FixtureDiscovery = { status: "unavailable" } | { status: "ready"; launches: FixtureLaunch[]; checkpoint: Checkpoint };
const unavailable = { status: "unavailable" } as const;
const maxBytes = 65_536;
const maxLaunches = 25;
const word = /^(0|[1-9][0-9]{0,15})$/;
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const index = (value: number) => Number.isSafeInteger(value) && value >= 0;
const wei = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]{0,77})$/.test(value)
  && BigInt(value) < 2n ** 256n;

function block(value: EvidenceBlock | undefined): value is EvidenceBlock {
  return !!value && typeof value.blockNumber === "string" && word.test(value.blockNumber) && fixtureHash(value.blockHash)
    && typeof value.timestamp === "string" && timestamp.test(value.timestamp) && Number.isFinite(Date.parse(value.timestamp));
}

function checkpoint(value: Checkpoint | undefined): value is Checkpoint {
  return !!value && block(value) && value.confirmations === 2 && value.finality === "fixture-confirmed" && value.l1Finality === "unverified";
}

function after(later: EvidenceBlock, earlier: EvidenceBlock) {
  return BigInt(later.blockNumber) >= BigInt(earlier.blockNumber) && Date.parse(later.timestamp) >= Date.parse(earlier.timestamp)
    && (later.blockNumber !== earlier.blockNumber || sameHex(later.blockHash, earlier.blockHash));
}

function confirmLifecycle(data: FixtureLaunch, current: Checkpoint, detailed: boolean) {
  const state = data.lifecycle;
  if (!state || !sameHex(state.activeCurve, data.initialCurve) || !block(state.observed) || !after(state.observed, data.checkpoint)
      || !after(current, state.observed) || state.observed.blockNumber !== current.blockNumber || state.feeBps !== 100
      || state.graduationBackingWei !== "2000000000000000000"
      || state.graduationSoldWei !== (BigInt(data.totalSupplyWei) * 3n / 5n).toString()
      || ![state.backingWei, state.soldWei, state.inventoryWei].every(wei)
      || BigInt(state.backingWei) > BigInt(state.graduationBackingWei) || BigInt(state.soldWei) > BigInt(state.graduationSoldWei)
      || !Array.isArray(state.trades) || state.trades.length > (detailed ? 25 : 0)) return false;
  const seen = new Set<string>();
  const eligible = state.backingWei === state.graduationBackingWei && state.soldWei === state.graduationSoldWei;
  const validEvent = (event: ReceiptEvent) => block(event) && fixtureHash(event.transactionHash) && index(event.logIndex)
    && after(event, data.creation) && after(state.observed, event);
  for (const trade of state.trades) {
    if (!validEvent(trade) || !fixtureAddress(trade.account) || (trade.side !== "buy" && trade.side !== "sell")
        || ![trade.tokenWei, trade.nativeWei, trade.nativeRefundWei, trade.feeWei, trade.backingWei, trade.soldWei].every(wei)
        || trade.tokenWei === "0" || trade.nativeWei === "0" || BigInt(trade.feeWei) > BigInt(trade.nativeWei)
        || (trade.side === "sell" && trade.nativeRefundWei !== "0")
        || BigInt(trade.backingWei) > BigInt(state.graduationBackingWei) || BigInt(trade.soldWei) > BigInt(state.graduationSoldWei)) return false;
    const identity = trade.transactionHash.toLowerCase() + ":" + trade.logIndex;
    if (seen.has(identity)) return false;
    seen.add(identity);
  }
  const graduation = state.graduation;
  if (state.phase === "curve" || state.phase === "eligible") return !graduation && (state.phase === "eligible") === eligible
    && BigInt(state.inventoryWei) + BigInt(state.soldWei) === BigInt(data.totalSupplyWei);
  if (state.phase !== "graduated" || !graduation || !validEvent(graduation) || state.backingWei !== "0"
      || state.soldWei !== state.graduationSoldWei || !fixtureHash(graduation.poolId)
      || ![graduation.owner, graduation.poolManager, graduation.positionManager, graduation.poolKey?.hooks].every(fixtureAddress)
      || graduation.poolKey.currency0 !== zeroAddress || !sameHex(graduation.poolKey.currency1, data.token)
      || graduation.poolKey.fee !== 3000 || graduation.poolKey.tickSpacing !== 60
      || ![graduation.positionTokenId, graduation.liquidityWei, graduation.nativeUsedWei, graduation.tokenUsedWei,
        graduation.nativeDustWei, graduation.tokenDustWei, graduation.sqrtPriceX96, graduation.spotSqrtPriceX96,
        graduation.poolLiquidityWei].every(wei)
      || [graduation.positionTokenId, graduation.liquidityWei, graduation.nativeUsedWei, graduation.tokenUsedWei, graduation.sqrtPriceX96].includes("0")
      || graduation.spotSqrtPriceX96 === "0" || BigInt(graduation.spotSqrtPriceX96) >= 2n ** 160n
      || BigInt(graduation.sqrtPriceX96) >= 2n ** 160n || BigInt(graduation.poolLiquidityWei) >= 2n ** 128n
      || !Number.isInteger(graduation.spotTick) || Math.abs(graduation.spotTick) > 887_272
      || BigInt(graduation.nativeUsedWei) + BigInt(graduation.nativeDustWei) !== BigInt(state.graduationBackingWei)
      || BigInt(graduation.tokenUsedWei) + BigInt(graduation.tokenDustWei) + BigInt(state.graduationSoldWei) !== BigInt(data.totalSupplyWei)
      || graduation.tokenDustWei !== state.inventoryWei || state.trades.some((trade) => !after(graduation, trade))) return false;
  const { currency1, fee, tickSpacing, hooks } = graduation.poolKey;
  const poolId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [zeroAddress, getAddress(currency1.toLowerCase()), fee, tickSpacing, getAddress(hooks.toLowerCase())]));
  return sameHex(graduation.poolId, poolId);
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
    && data.opening?.inventoryWei === data.totalSupplyWei && data.opening.backingWei === "0" && data.opening.soldWei === "0"
    && confirmLifecycle(data, current, !!token);
}

/** The local indexer is the only source for the fixture discovery pages. No public fallback. */
export async function readFixtureLaunches(fixture: CurveFixture, token?: string): Promise<FixtureDiscovery> {
  const key = process.env.RMT_CURVE_FIXTURE_READ_KEY;
  if (!key || !/^[0-9a-f]{64}$/.test(key) || /^0+$/.test(key) || (token && !isLaunchAddress(token))) return unavailable;
  try {
    const response = await fetch(fixture.indexerUrl + "/curve-launches" + (token ? `/${token.toLowerCase()}` : ""), {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2300), headers: { "X-RMT-Fixture-Key": key },
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
