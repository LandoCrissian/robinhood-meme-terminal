import assert from "node:assert/strict";
import type { Client } from "pg";
import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { blockEvidence, type BlockEvidence } from "./curve-launch-evidence.js";
import { productionCurveIdentity, productionCurveScope } from "./curve-production-store.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import {
  addMarketFill,
  backingTarget,
  graduationEvent,
  marketFill,
  marketIntervals,
  saleTarget,
  selectors,
  type Candle,
  type MarketLog,
} from "./market-candles.js";

const poolManager = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const guard = "0x998f3c0ce20cff92655d495a159b1ca37c162000";
const abi = parseAbi([
  "function curveForToken(address) view returns(address)",
  "function migrationCandidate(address,uint32) view returns(address)",
  "function token() view returns(address)",
  "function factory() view returns(address)",
  "function executionVersion() view returns(uint32)",
  "function graduated() view returns(bool)",
  "function sold() view returns(uint256)",
  "function backingReserve() view returns(uint256)",
  "function poolId() view returns(bytes32)",
  "function graduationSold() view returns(uint256)",
  "function GRADUATION_BACKING() view returns(uint256)",
]);
export type MarketQuery = { token: Address; interval: number; before?: number };
export function parseMarketQuery(url: URL): MarketQuery | null {
  const match = /^\/curve-market\/(0x[0-9a-f]{40})$/i.exec(url.pathname);
  const requestedInterval = url.searchParams.get("interval") ?? "300";
  const interval = Number(requestedInterval),
    end = url.searchParams.get("before");
  const keys = [...url.searchParams.keys()];
  if (
    !match ||
    String(interval) !== requestedInterval ||
    !marketIntervals.some((n) => n === interval) ||
    keys.some((k) => k !== "interval" && k !== "before") ||
    new Set(keys).size !== keys.length ||
    (end !== null &&
      (!/^[1-9][0-9]{0,10}$/.test(end) || Number(end) % interval !== 0))
  )
    return null;
  return {
    token: match[1]!.toLowerCase() as Address,
    interval,
    ...(end && { before: Number(end) }),
  };
}
type DB = Pick<Client, "query">;
type Row = {
  payload: MarketLog & { marketTime?: number };
  height: string;
  hash: Hex;
  ordinal: number;
};
export async function readCurveMarket(
  db: DB,
  scope: string,
  config: CurveProductionConfig,
  readers: [PublicClient, PublicClient],
  checkpoint: BlockEvidence,
  query: MarketQuery,
) {
  const { token, interval, before } = query,
    blockNumber = BigInt(checkpoint.blockNumber),
    factory = config.binding.factory;
  const deployment = config.binding;
  assert.ok(deployment.chainId === 4663 && scope === productionCurveScope(config) && blockNumber >= deployment.deploymentBlock);
  // The anchor must exist independently of the token. A missing anchor yields no row,
  // whereas an aligned anchor with no scoped registration yields a NULL token.
  const reg = await db.query<{ token: string | null; initial: string; valid_registration: boolean }>(
    `SELECT l.token, l.payload->>'initialCurve' AS initial,
      l.block_number BETWEEN $6::bigint AND $3::bigint AND lower(l.payload->>'token')=l.token
        AND l.payload->>'chainId'='4663' AND lower(l.payload->>'factory')=$7
        AND lower(l.payload->>'projectRegistry')=$8 AS valid_registration
    FROM rmt_curve_production_bindings b JOIN rmt_curve_activity_bindings a USING(scope)
    JOIN rmt_curve_production_checkpoints p ON p.scope=b.scope AND p.block_number=b.next_block-1
    JOIN rmt_curve_activity_checkpoints c ON c.scope=a.scope AND c.block_number=a.next_block-1
    LEFT JOIN rmt_curve_production_launches l ON l.scope=b.scope AND l.token=$2
    WHERE b.scope=$1 AND b.identity=$5::jsonb AND a.next_block=b.next_block AND p.block_number=$3
      AND p.block_hash=$4 AND c.block_hash=p.block_hash AND p.observed_at=$9::timestamptz AND c.observed_at=p.observed_at`,
    [scope, token, checkpoint.blockNumber, checkpoint.blockHash, productionCurveIdentity(config),
      deployment.deploymentBlock.toString(), factory.toLowerCase(), deployment.projectRegistry.toLowerCase(), checkpoint.timestamp],
  );
  assert.equal(reg.rows.length, 1, "Market checkpoints or deployment identity disagree");
  async function verifyCanonicalBlock() {
    const heads = await Promise.all(readers.map(r => r.getBlock({ blockNumber })));
    for (const head of heads) {
      const observed = blockEvidence(head, blockNumber);
      assert.ok(observed.blockHash === checkpoint.blockHash && Date.parse(observed.timestamp) === Date.parse(checkpoint.timestamp));
    }
  }
  if (reg.rows[0]!.token === null) {
    // Check the immutable factory at the same height on both providers. A missing
    // database registration must never hide a real on-chain curve or indexed events.
    const orphan = await db.query("SELECT 1 FROM rmt_curve_activity_events WHERE scope=$1 AND token=$2 LIMIT 1", [scope, token]);
    assert.equal(orphan.rows.length, 0);
    const curves = await Promise.all(readers.map(r => r.readContract({
      address: factory, abi, functionName: "curveForToken", args: [token], blockNumber,
    })));
    assert.ok(curves.every(curve => curve === zeroAddress), "Factory disagrees with registration absence");
    await verifyCanonicalBlock();
    return {
      status: "not_found" as const, schemaVersion: 1, chainId: deployment.chainId, token,
      deployment: { factory, registry: deployment.projectRegistry, blockNumber: deployment.deploymentBlock.toString(), blockHash: deployment.deploymentBlockHash },
      checkpoint: { ...checkpoint, confirmations: deployment.confirmations, finality: "l2-confirmed", l1Finality: "unverified" },
    };
  }
  assert.ok(reg.rows[0]!.valid_registration && reg.rows[0]!.token === token, "Invalid scoped registration");
  async function snapshot(rpc: PublicClient) {
    const read = (
      address: Address,
      functionName: (typeof abi)[number]["name"],
      args: readonly unknown[] = [],
    ) =>
      rpc.readContract({
        address,
        abi,
        functionName,
        args,
        blockNumber,
      } as never);
    const curve = String(
      await read(factory, "curveForToken", [token]),
    ).toLowerCase() as Address;
    const [
      asset,
      deployer,
      version,
      graduated,
      sold,
      backing,
      pool,
      soldGoal,
      ethGoal,
    ] = await Promise.all(
      (
        [
          "token",
          "factory",
          "executionVersion",
          "graduated",
          "sold",
          "backingReserve",
          "poolId",
          "graduationSold",
          "GRADUATION_BACKING",
        ] as const
      ).map((name) => read(curve, name)),
    );
    assert.ok(
      String(asset).toLowerCase() === token &&
        String(deployer).toLowerCase() === factory.toLowerCase() &&
        [1, 2, 3].includes(Number(version)),
    );
    assert.ok(
      soldGoal === saleTarget &&
        ethGoal === backingTarget &&
        typeof sold === "bigint" &&
        sold <= saleTarget &&
        typeof backing === "bigint" &&
        backing <= backingTarget &&
        typeof graduated === "boolean",
    );
    const curves = [reg.rows[0]!.initial.toLowerCase()];
    for (let v = 2; v <= Number(version); v++)
      curves.push(
        String(
          await read(factory, "migrationCandidate", [token, v]),
        ).toLowerCase(),
      );
    assert.ok(
      curves.at(-1) === curve &&
        curves.every((c) => /^0x[0-9a-f]{40}$/.test(c) && c !== zeroAddress),
    );
    const poolId = graduated
      ? keccak256(
          encodeAbiParameters(
            [
              { type: "address" },
              { type: "address" },
              { type: "uint24" },
              { type: "int24" },
              { type: "address" },
            ],
            [zeroAddress, token, 3000, 60, guard],
          ),
        )
      : null;
    assert.ok(
      graduated
        ? poolId === pool && sold === saleTarget && backing === 0n
        : BigInt(String(pool)) === 0n,
    );
    const potential =
      (4n * 10n ** 18n * 18n * 10n ** 26n + (18n * 10n ** 26n - sold) - 1n) /
        (18n * 10n ** 26n - sold) -
      4n * 10n ** 18n;
    assert.ok(graduated || backing === potential);
    return {
      curves,
      manager: poolManager,
      poolId,
      soldWei: sold.toString(),
      backingWei: backing.toString(),
      phase: graduated
        ? "graduated"
        : sold === saleTarget
          ? "eligible"
          : "curve",
    };
  }
  const [binding, other] = await Promise.all(readers.map(snapshot));
  assert.deepEqual(binding, other);
  assert.ok(binding);
  const checkedTimes = new Map<string, number>();
  async function time(row: Row) {
    if (row.payload.marketTime !== undefined) {
      assert.ok(
        Number.isSafeInteger(row.payload.marketTime) &&
          row.payload.marketTime > 0,
      );
      return row.payload.marketTime;
    }
    const cached = checkedTimes.get(row.hash);
    if (cached !== undefined) return cached;
    const headers = await Promise.all(
      readers.map((r) => r.getBlock({ blockNumber: BigInt(row.height) })),
    );
    assert.ok(
      headers.every(
        (h) => h.hash === row.hash && h.timestamp === headers[0]!.timestamp,
      ),
    );
    const value = Number(headers[0]!.timestamp);
    checkedTimes.set(row.hash, value);
    return value;
  }
  let graduation: null | {
    time: number;
    nativeUsedWei: string;
    poolId: string;
  } = null;
  const select =
    "SELECT payload, block_number::text AS height, block_hash AS hash, log_index AS ordinal FROM rmt_curve_activity_events";
  if (binding.poolId) {
    const result = await db.query<Row>(
      select +
        ` WHERE scope=$1 AND token=$2 AND block_number<=$3 AND payload->>'address'=ANY($4::text[])
      AND payload->'topics'->>0=$5 AND payload->'topics'->>1=$6 LIMIT 2`,
      [
        scope,
        token,
        checkpoint.blockNumber,
        binding.curves,
        selectors.graduation,
        binding.poolId,
      ],
    );
    assert.equal(result.rows.length, 1);
    const row = result.rows[0]!,
      { args: g } = decodeEventLog({
        abi: [graduationEvent],
        data: row.payload.data,
        topics: [...row.payload.topics] as [Hex, ...Hex[]],
      });
    assert.ok(
      g.positionTokenId > 0n &&
        g.nativeUsed + g.nativeDust === backingTarget &&
        g.tokenUsed + g.tokenDust === 400_000_000n * 10n ** 18n,
    );
    graduation = {
      time: await time(row),
      nativeUsedWei: g.nativeUsed.toString(),
      poolId: g.poolId,
    };
  }
  const buckets = new Map<number, Candle>();
  let height = checkpoint.blockNumber,
    ordinal = 2147483647,
    earlier = false;
  // Read complete occupied buckets. An older page ends strictly before the earliest displayed bucket.
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > 6000)
      throw new Error("Market history exceeded the read budget");
    const page = await db.query<Row>(
      select +
        ` WHERE scope=$1 AND token=$2 AND (block_number,log_index)<($3::bigint,$4::integer)
      AND ((payload->>'address'=ANY($5::text[]) AND payload->'topics'->>0=$6)
        OR (payload->>'address'=$7 AND payload->'topics'->>0=$8 AND payload->'topics'->>1=$9))
      AND ($10::bigint IS NULL OR NOT payload ? 'marketTime' OR (payload->>'marketTime')::bigint<$10)
      ORDER BY block_number DESC,log_index DESC LIMIT 256`,
      [
        scope,
        token,
        height,
        ordinal,
        binding.curves,
        selectors.curve,
        poolManager,
        selectors.swap,
        binding.poolId,
        before ?? null,
      ],
    );
    for (const row of page.rows) {
      const stamp = await time(row);
      if (before && stamp >= before) continue;
      const bucket = Math.floor(stamp / interval) * interval;
      if (!buckets.has(bucket) && buckets.size === 160) {
        earlier = true;
        break;
      }
      const fill = marketFill(row.payload, binding);
      assert.ok(fill);
      addMarketFill(buckets, stamp, interval, fill);
    }
    if (earlier || page.rows.length < 256) break;
    const last = page.rows.at(-1)!;
    height = last.height;
    ordinal = last.ordinal;
  }
  await verifyCanonicalBlock();
  return {
    status: "ready" as const,
    schemaVersion: 1,
    chainId: 4663,
    token,
    factory,
    interval,
    checkpoint,
    soldWei: binding.soldWei,
    backingWei: binding.backingWei,
    phase: binding.phase,
    graduation,
    candles: [...buckets.values()].reverse(),
    earlier,
  };
}
