import type { Pool, PoolClient } from "pg";
import type {
  LaunchDirectory,
  LaunchEvidence,
} from "@rmt/shared/launch-intelligence";
import { applyLaunchEvent, type DecodedLaunchEvent } from "./launch-domain.js";
import { launchSourceManifest } from "./launch-sources.js";

/** Durable even when the separate pool inventory is configured as rebuildable. */
export async function migrateLaunchStore(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS rmt_launch_sources (
    source_id text PRIMARY KEY, fingerprint text NOT NULL,
    next_block bigint NOT NULL, historical_next bigint NOT NULL, historical_end bigint NOT NULL,
    status text NOT NULL DEFAULT 'indexing', last_error text, scanned_at timestamptz,
    CHECK(next_block >= 0 AND historical_next >= -1));
    CREATE TABLE IF NOT EXISTS rmt_launch_events (
      source_id text NOT NULL REFERENCES rmt_launch_sources(source_id), event_key text NOT NULL,
      launch_id text NOT NULL, block_number bigint NOT NULL, log_index integer NOT NULL,
      payload jsonb NOT NULL, PRIMARY KEY(source_id,event_key));
    CREATE INDEX IF NOT EXISTS rmt_launch_events_identity ON rmt_launch_events(launch_id,block_number,log_index);
    CREATE TABLE IF NOT EXISTS rmt_launch_checkpoints (
      source_id text NOT NULL REFERENCES rmt_launch_sources(source_id), lane text NOT NULL,
      block_number bigint NOT NULL, from_block bigint NOT NULL, block_hash text NOT NULL, PRIMARY KEY(source_id,lane,block_number));
    CREATE TABLE IF NOT EXISTS rmt_launch_observations (
      launch_id text PRIMARY KEY, source_id text NOT NULL REFERENCES rmt_launch_sources(source_id),
      block_number bigint NOT NULL, payload jsonb NOT NULL, refreshed_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS rmt_launch_identities (
      token text PRIMARY KEY,block_number bigint NOT NULL,payload jsonb NOT NULL,refreshed_at timestamptz NOT NULL DEFAULT NOW(),retry_after timestamptz);
    CREATE TABLE IF NOT EXISTS rmt_launch_refresh_attempts (
      launch_id text PRIMARY KEY, attempted_at timestamptz NOT NULL DEFAULT NOW(), retry_after timestamptz NOT NULL);`);
}
export async function insertLaunchEvent(
  client: PoolClient,
  event: DecodedLaunchEvent,
) {
  const result = await client.query(
    `INSERT INTO rmt_launch_events(source_id,event_key,launch_id,block_number,log_index,payload)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_id,event_key) DO UPDATE SET event_key=EXCLUDED.event_key
    WHERE rmt_launch_events.payload=EXCLUDED.payload`,
    [
      event.sourceId,
      event.key,
      event.launchId,
      event.block,
      event.logIndex,
      JSON.stringify(event),
    ],
  );
  if (result.rowCount !== 1) throw new Error("conflicting launch event replay");
}
export async function rollbackLaunchSource(
  client: PoolClient,
  sourceId: string,
  ancestor: bigint,
) {
  // Remove all observations on an orphaned branch, independently of ingestion lane.
  await client.query(
    "DELETE FROM rmt_launch_observations WHERE source_id=$1 AND block_number>$2",
    [sourceId, String(ancestor)],
  );
  await client.query(
    "DELETE FROM rmt_launch_identities WHERE block_number>$1",
    [String(ancestor)],
  );
  await client.query(
    "DELETE FROM rmt_launch_events WHERE source_id=$1 AND block_number>$2",
    [sourceId, String(ancestor)],
  );
  await client.query(
    "DELETE FROM rmt_launch_checkpoints WHERE source_id=$1 AND block_number>$2",
    [sourceId, String(ancestor)],
  );
  await client.query(
    `UPDATE rmt_launch_sources SET next_block=LEAST(next_block,$2),historical_next=LEAST(historical_next,$3),status='indexing' WHERE source_id=$1`,
    [sourceId, String(ancestor + 1n), String(ancestor)],
  );
}
export function replayLaunchHistory(
  events: DecodedLaunchEvent[],
  observation: LaunchEvidence | null = null,
) {
  const sorted = [...events].sort((a, b) =>
    BigInt(a.block) < BigInt(b.block)
      ? -1
      : BigInt(a.block) > BigInt(b.block)
        ? 1
        : a.logIndex - b.logIndex,
  );
  const creation = sorted.find((event) => event.creation)?.creation;
  if (!creation) return null;
  for (const event of sorted) {
    if (
      event.launchId !== creation.launchId ||
      event.sourceId !== creation.sourceId
    )
      throw new Error("launch history relationship conflict");
    if (
      event.creation &&
      JSON.stringify(event.creation) !== JSON.stringify(creation)
    )
      throw new Error("conflicting launch creation history");
  }
  let launch = creation;
  for (const event of sorted) {
    if (observation && BigInt(observation.observedBlock) >= BigInt(event.block))
      continue;
    if (event.creation) continue;
    launch = applyLaunchEvent(launch, event);
  }
  if (observation) {
    if (
      observation.launchId !== creation.launchId ||
      observation.token !== creation.token ||
      observation.launchTransaction !== creation.launchTransaction ||
      observation.sourceContract !== creation.sourceContract ||
      observation.quoteAsset !== creation.quoteAsset ||
      observation.creator !== creation.creator ||
      observation.relationship !== creation.relationship ||
      observation.sourceVersion !== creation.sourceVersion ||
      observation.source !== creation.source ||
      observation.chainId !== creation.chainId ||
      BigInt(observation.observedBlock) < BigInt(creation.launchBlock)
    )
      throw new Error("launch observation identity conflict");
    launch = observation;
    // A later historical backfill can reveal the exact graduation transaction
    // after a source view already observed the graduated state.
    const graduation = [...sorted]
      .reverse()
      .find(
        (e) =>
          ["LaunchBonded", "PoolGraduated"].includes(e.name) &&
          BigInt(e.block) <= BigInt(observation.observedBlock),
      );
    if (graduation)
      launch = {
        ...launch,
        graduationTransaction: graduation.transaction,
        graduationBlock: graduation.block,
      };
    for (const event of sorted.filter(
      (e) => BigInt(e.block) > BigInt(observation.observedBlock),
    ))
      launch = applyLaunchEvent(launch, event);
  }
  return launch;
}
type Query = {
  q?: string;
  token?: string;
  source?: string;
  cursor?: string;
  limit?: number;
};
export class InvalidLaunchCursor extends Error {}
export async function readLaunchDirectory(
  pool: Pool | PoolClient,
  query: Query = {},
): Promise<LaunchDirectory> {
  const limit = Math.min(50, Math.max(1, query.limit ?? 30));
  let after: {
    block: string;
    id: string;
    q: string;
    source: string;
    token: string;
  } | null = null;
  if (query.cursor) {
    try {
      after = JSON.parse(
        Buffer.from(query.cursor, "base64url").toString("utf8"),
      );
    } catch {
      throw new InvalidLaunchCursor("invalid launch cursor");
    }
    if (
      !after ||
      typeof after.block !== "string" ||
      typeof after.id !== "string" ||
      !/^\d{1,20}$/.test(after.block) ||
      !/^0x[\da-f]{40}:(?:0x[\da-f]{40}|[1-9]\d{0,77})$/.test(after.id) ||
      after.q !== (query.q ?? "") ||
      after.source !== (query.source ?? "") ||
      after.token !== (query.token ?? "")
    )
      throw new InvalidLaunchCursor("invalid launch cursor");
  }
  const result = await pool.query<{
    events: DecodedLaunchEvent[];
    observation: LaunchEvidence | null;
    identity: {
      identity: LaunchEvidence["identity"];
      identityObservations: LaunchEvidence["identityObservations"];
    } | null;
  }>(
    `WITH creations AS (
      SELECT launch_id,source_id,block_number,payload FROM rmt_launch_events WHERE payload->'creation' IS NOT NULL AND payload->'creation' <> 'null'::jsonb
    ) SELECT (SELECT jsonb_agg(e.payload ORDER BY e.block_number,e.log_index) FROM rmt_launch_events e WHERE e.launch_id=c.launch_id) AS events,
      o.payload AS observation,i.payload AS identity FROM creations c LEFT JOIN rmt_launch_observations o ON o.launch_id=c.launch_id
      LEFT JOIN rmt_launch_identities i ON i.token=c.payload->'creation'->>'token'
    WHERE ($1::text IS NULL OR c.payload->'creation'->>'token'=$1)
      AND ($2::text IS NULL OR c.payload->'creation'->>'source'=$2)
      AND ($3::bigint IS NULL OR (c.block_number,c.launch_id)<($3,$4))
      AND ($5::text IS NULL OR position(lower($5) in lower(concat(c.payload->'creation'->>'token',' ',i.payload->'identity'->>'name',' ',i.payload->'identity'->>'symbol')))>0)
    ORDER BY c.block_number DESC,c.launch_id DESC LIMIT $6`,
    [
      query.token ?? null,
      query.source ?? null,
      after?.block ?? null,
      after?.id ?? null,
      query.q ?? null,
      limit + 1,
    ],
  );
  const entries = result.rows
    .map((row) => {
      const launch = replayLaunchHistory(row.events, row.observation);
      return launch && row.identity ? { ...launch, ...row.identity } : launch;
    })
    .filter((x): x is LaunchEvidence => x !== null);
  const sources = (
    await pool.query<{
      source_id: string;
      next_block: string;
      historical_next: string;
      historical_end: string;
      status: string;
    }>(
      "SELECT source_id,next_block::text,historical_next::text,historical_end::text,status FROM rmt_launch_sources ORDER BY source_id",
    )
  ).rows;
  const last = entries[limit - 1];
  return {
    chainId: 4663,
    status:
      sources.length === launchSourceManifest.sources.length &&
      sources.every((s) => s.status === "ready")
        ? "ready"
        : sources.some((s) => s.status !== "unavailable")
          ? "partial"
          : "unavailable",
    entries: entries.slice(0, limit),
    nextCursor:
      result.rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              block: last.launchBlock,
              id: last.launchId,
              q: query.q ?? "",
              source: query.source ?? "",
              token: query.token ?? "",
            }),
          ).toString("base64url")
        : null,
    sources: sources.map((s) => ({
      sourceId: s.source_id,
      indexedThrough:
        BigInt(s.next_block) > 0n ? String(BigInt(s.next_block) - 1n) : null,
      historicalFrom:
        BigInt(s.historical_next) < BigInt(s.historical_end)
          ? String(BigInt(s.historical_next) + 1n)
          : null,
      status:
        s.status === "ready"
          ? "ready"
          : s.status === "unavailable"
            ? "unavailable"
            : "indexing",
    })),
  };
}
