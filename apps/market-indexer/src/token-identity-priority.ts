import type { Pool } from "pg";
import { createHash } from "node:crypto";

export const MAX_PRIORITY_CANDIDATES = 2_000;
const REFRESH_MS = 15 * 60_000;
const PRIORITY_BATCHES_BEFORE_BACKGROUND = 4;

// Bound the input before deduplication/sorting. The existing event-key index
// supports this same newest-first ordering used by canonical browse pages.
export const PRIORITY_CANDIDATE_SQL = `
  WITH recent_pools AS MATERIALIZED (
    SELECT token0, token1, block_number, log_index
    FROM market_pools
    ORDER BY block_number DESC, log_index DESC
    LIMIT 2000
  ), latest_tokens AS (
    SELECT DISTINCT ON (token) token, block_number, log_index
    FROM recent_pools
    CROSS JOIN LATERAL (VALUES (token0), (token1)) AS tokens(token)
    WHERE token <> decode(repeat('00', 20), 'hex')
    ORDER BY token, block_number DESC, log_index DESC
  )
  SELECT encode(token, 'hex') AS token
  FROM latest_tokens
  ORDER BY block_number DESC, log_index DESC, token ASC
  LIMIT 2000
`;

interface PriorityState {
  addresses: string[];
  membership: Set<string>;
  refreshedAt: number | null;
  consecutivePriorityBatches: number;
  selectionMs: number;
  queryCount: number;
  status: "not_requested" | "ready" | "unavailable";
}

const priorities = new WeakMap<Pool, PriorityState>();

// Database bytea projection and external candidate spelling end here. All
// scheduler state uses the existing worker's lowercase, 0x-prefixed key.
function canonicalCandidate(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0x)?[0-9a-f]{40}$/i.test(value)) return null;
  const address = `0x${value.replace(/^0x/i, "").toLowerCase()}`;
  return /^0x0{40}$/.test(address) ? null : address;
}

function stateFor(pool: Pool): PriorityState {
  let state = priorities.get(pool);
  if (!state) {
    state = {
      addresses: [], membership: new Set(), refreshedAt: null,
      consecutivePriorityBatches: 0, selectionMs: 0, queryCount: 0,
      status: "not_requested",
    };
    priorities.set(pool, state);
  }
  return state;
}

export async function refreshIdentityPriority(pool: Pool, now: number): Promise<void> {
  const state = stateFor(pool);
  if (state.refreshedAt !== null && now - state.refreshedAt < REFRESH_MS) return;
  const started = performance.now();
  state.refreshedAt = now;
  state.queryCount++;
  try {
    const result = await pool.query<{ token: string }>(PRIORITY_CANDIDATE_SQL);
    const addresses = [...new Set(result.rows.map((row) => canonicalCandidate(row.token)))]
      .filter((address): address is string => address !== null)
      .slice(0, MAX_PRIORITY_CANDIDATES);
    state.addresses = addresses;
    state.membership = new Set(addresses);
    state.status = "ready";
  } catch {
    // Retain the last selection and ordinary background progress. Never log
    // database transport errors, which can include connection credentials.
    state.status = "unavailable";
  } finally {
    state.selectionMs = performance.now() - started;
  }
}

interface PendingIdentityState {
  pendingByShard: Map<number, string[]>;
  readyIdentities: ReadonlyMap<string, unknown>;
  retryAfter: ReadonlyMap<string, number>;
}

export function selectIdentityBatch(
  pool: Pool,
  pendingState: PendingIdentityState,
  batchSize: number,
  now: number,
): { addresses: string[]; shard: number | null; lane: "priority" | "background" | "idle" } {
  const priority = stateFor(pool);
  const eligible = (address: string) => /^0x[0-9a-f]{40}$/.test(address)
    && !/^0x0{40}$/.test(address) && !pendingState.readyIdentities.has(address)
    && (pendingState.retryAfter.get(address) ?? 0) <= now;
  const priorityShard = () => {
    for (const address of priority.addresses) {
      const shard = Number.parseInt(address.slice(2, 4), 16);
      if (eligible(address) && pendingState.pendingByShard.get(shard)?.includes(address)) return shard;
    }
    return null;
  };
  const backgroundShard = () => {
    for (let shard = 0; shard < 256; shard++) {
      if (pendingState.pendingByShard.get(shard)?.some((address) =>
        !priority.membership.has(address) && eligible(address))) return shard;
    }
    return null;
  };

  let lane: "priority" | "background" = "priority";
  let shard: number | null = null;
  if (priority.consecutivePriorityBatches >= PRIORITY_BATCHES_BEFORE_BACKGROUND) {
    shard = backgroundShard();
    if (shard !== null) lane = "background";
  }
  if (shard === null) shard = priorityShard();
  if (shard === null) { shard = backgroundShard(); lane = "background"; }
  if (shard === null) return { addresses: [], shard: null, lane: "idle" };

  const pending = pendingState.pendingByShard.get(shard) ?? [];
  const pendingSet = new Set(pending);
  const ordered = lane === "priority" ? priority.addresses : [...pendingSet];
  const addresses = ordered.filter((address) => pendingSet.has(address)
    && Number.parseInt(address.slice(2, 4), 16) === shard
    && eligible(address) && (lane === "priority" || !priority.membership.has(address)))
    .slice(0, Math.max(1, Math.floor(batchSize)));
  const selected = new Set(addresses);
  pendingState.pendingByShard.set(shard, pending.filter((address) => !selected.has(address)
    && !pendingState.readyIdentities.has(address)));
  priority.consecutivePriorityBatches = lane === "priority"
    ? priority.consecutivePriorityBatches + 1 : 0;
  return { addresses, shard, lane };
}

export function readIdentityPriorityDiagnostics(pool: Pool, ready: ReadonlyMap<string, unknown>) {
  const state = priorities.get(pool);
  const addresses = state?.addresses ?? [];
  const readyCount = addresses.filter((address) => ready.has(address)).length;
  return {
    source: "canonical-browse-newest-pools" as const,
    status: state?.status ?? "not_requested",
    maxPriorityCandidates: MAX_PRIORITY_CANDIDATES,
    priorityCandidateCount: addresses.length,
    priorityAlreadyReadyCount: readyCount,
    priorityPendingCount: addresses.length - readyCount,
    prioritySetDigest: createHash("sha256").update(addresses.join("\n")).digest("hex"),
    selectionMs: state?.selectionMs ?? null,
    selectionQueryCount: state?.queryCount ?? 0,
    backgroundFairness: "one-background-batch-after-four-priority-batches" as const,
  };
}
