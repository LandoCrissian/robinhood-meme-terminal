import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type PublicClient,
  type Hex,
} from "viem";
import type { Pool } from "pg";
import type { LaunchEvidence } from "@rmt/shared/launch-intelligence";
import { findReorgAncestor } from "./replay.js";
import {
  launchSourceManifest,
  type LaunchSourceManifest,
} from "./launch-sources.js";
import { stonkLensAbi, stonkPadAbi } from "./launch-abi.js";
import {
  boundedProgress,
  decodeLaunchEvent,
  launchAbi,
  launchTokenAbi,
  ponsCurveAbi,
  ponsV1Abi,
  ponsV2Abi,
  type LaunchLog,
} from "./launch-domain.js";
import {
  insertLaunchEvent,
  readLaunchDirectory,
  rollbackLaunchSource,
} from "./launch-store.js";
import { refreshLaunchIdentities } from "./launch-identity.js";
import { LAUNCH_HISTORY_BUDGET, historicalFailureDelay, nextHistoryGroup } from "./launch-history-budget.js";

const addressEqual = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
class HistoryYield extends Error {}
class HistorySplit extends Error {}
export async function observeLaunch(
  rpc: PublicClient,
  source: LaunchSourceManifest,
  launch: LaunchEvidence,
  block: bigint,
  blockHash: Hex,
): Promise<LaunchEvidence> {
  let result: LaunchEvidence = {
    ...launch,
    observedBlock: String(block),
    observedBlockHash: blockHash,
    observedAt: new Date().toISOString(),
  };
  if (source.source === "STONKBROKERS") {
    const view = await rpc.readContract({
      address: launchSourceManifest.lens.contract,
      abi: stonkLensAbi,
      functionName: "viewLaunch",
      args: [source.contract, BigInt(launch.launchId.split(":")[1]!)],
      blockNumber: block,
    });
    if (
      view.id !== BigInt(launch.launchId.split(":")[1]!) ||
      !addressEqual(view.core.token, launch.token) ||
      !addressEqual(view.core.creator, launch.creator) ||
      view.core.externalToken !== (launch.relationship === "TOKEN_ENROLLED")
    )
      throw new Error("Lens launch identity conflict");
    result = {
      ...result,
      state: view.core.aborted
        ? "ABORTED"
        : view.core.bonded
          ? "GRADUATED"
          : view.core.graduated
            ? "GRADUATING"
            : view.core.armed
              ? "BONDING"
              : "LAUNCHED",
      sourcePhase: view.core.aborted
        ? "aborted"
        : view.core.bonded
          ? "bonded"
          : view.core.graduated
            ? "closed"
            : view.core.armed
              ? "armed"
              : "created",
      progressBps: view.oracleFresh
        ? boundedProgress(
            view.mcapUsd8Now > view.core.startMcapUsd8
              ? view.mcapUsd8Now - view.core.startMcapUsd8
              : 0n,
            view.core.gradMcapUsd8 - view.core.startMcapUsd8,
          )
        : null,
      marketCapUsd8: view.oracleFresh ? String(view.mcapUsd8Now) : null,
      graduatedMarkets: view.pools
        .filter((p) => !/^0x0{40}$/i.test(p))
        .map((p) => p.toLowerCase() as Hex),
    };
  } else if (source.version === "V1") {
    const record = await rpc.readContract({
      address: source.contract,
      abi: ponsV1Abi,
      functionName: "getLaunchedToken",
      args: [launch.token],
      blockNumber: block,
    });
    if (
      !record.exists ||
      !addressEqual(record.token, launch.token) ||
      !addressEqual(record.deployer, launch.creator) ||
      !addressEqual(record.pairedToken, launch.quoteAsset!)
    )
      throw new Error("Pons V1 launch identity conflict");
    const [principal, threshold, graduated] = await rpc.readContract({
      address: source.contract,
      abi: ponsV1Abi,
      functionName: "graduationStatus",
      args: [launch.token],
      blockNumber: block,
    });
    const locker = await rpc.readContract({
      address: source.contract,
      abi: ponsV1Abi,
      functionName: "locker",
      blockNumber: block,
    });
    result = {
      ...result,
      state: graduated ? "GRADUATED" : "LAUNCHED",
      sourcePhase: graduated
        ? "V1 principal threshold reached"
        : "V1 locked V3 pool",
      progressBps: boundedProgress(principal, threshold),
      liquidityDestination: locker.toLowerCase() as Hex,
      graduatedMarkets:
        graduated && launch.initialMarket ? [launch.initialMarket] : [],
    };
  } else {
    const record = await rpc.readContract({
      address: source.contract,
      abi: ponsV2Abi,
      functionName: "getLaunchedToken",
      args: [launch.token],
      blockNumber: block,
    });
    if (
      !record.exists ||
      !addressEqual(record.token, launch.token) ||
      !addressEqual(record.deployer, launch.creator) ||
      !addressEqual(record.pairToken, launch.quoteAsset!) ||
      !addressEqual(record.curve, launch.curve!)
    )
      throw new Error("Pons V2 launch identity conflict");
    if (record.phase > 3) throw new Error("unsupported Pons V2 phase");
    const locker = await rpc.readContract({
      address: source.contract,
      abi: ponsV2Abi,
      functionName: "locker",
      blockNumber: block,
    });
    result = {
      ...result,
      state: (["BONDING", "GRADUATING", "GRADUATED", "RESCUED"] as const)[
        record.phase
      ]!,
      sourcePhase: `Pons V2 phase ${record.phase}`,
      creatorTaxBps: record.creatorTaxBps,
      progressBps: null,
      liquidityDestination: locker.toLowerCase() as Hex,
    };
    if (record.phase === 0) {
      const [reserve, threshold, ready] = await Promise.all([
        rpc.readContract({
          address: record.curve,
          abi: ponsCurveAbi,
          functionName: "realQuoteReserve",
          blockNumber: block,
        }),
        rpc.readContract({
          address: record.curve,
          abi: ponsCurveAbi,
          functionName: "graduationThreshold",
          blockNumber: block,
        }),
        rpc.readContract({
          address: record.curve,
          abi: ponsCurveAbi,
          functionName: "readyToGraduate",
          blockNumber: block,
        }),
      ]);
      if (threshold !== record.graduationThreshold)
        throw new Error("Pons V2 threshold conflict");
      result.progressBps = boundedProgress(reserve, threshold);
      if (ready) result.state = "GRADUATING";
    } else if (record.phase === 2) {
      const hook = await rpc.readContract({
        address: source.contract,
        abi: ponsV2Abi,
        functionName: "memeHook",
        blockNumber: block,
      });
      const [currency0, currency1] =
        BigInt(record.token) < BigInt(record.pairToken)
          ? [record.token, record.pairToken]
          : [record.pairToken, record.token];
      result.graduatedMarkets = [
        keccak256(
          encodeAbiParameters(
            parseAbiParameters("address,address,uint24,int24,address"),
            [currency0, currency1, record.poolFee, record.tickSpacing, hook],
          ),
        ),
      ];
    }
  }
  return result;
}

/** One coalesced launch stream inside the existing market worker. */
export class LaunchIndexer {
  lastCycleTiming = { setupMs: 0, liveMs: 0, historyMs: 0, enrichmentMs: 0, totalMs: 0 };
  private verified = new Map<string, number>();
  private lensVerifiedAt = 0;
  private activeRun: Promise<void> | null = null;
  private livePending = 0;
  private historyAfter: string | null = null;
  private historyFailures = 0;
  private historyRetryAt = 0;
  private stopped = false;
  private historyRangeSize: number;
  private wakeHistory: (() => void) | null = null;
  constructor(
    private pool: Pool,
    private rpc: PublicClient,
    private batchSize: number,
    private historyRpc: PublicClient = rpc,
  ) { this.historyRangeSize = batchSize; }
  private async verify(source: LaunchSourceManifest, block: bigint) {
    if ((this.verified.get(source.id) ?? 0) > Date.now() - 3_600_000) return;
    const code = await this.rpc.getBytecode({
      address: source.contract,
      blockNumber: block,
    });
    if (!code || keccak256(code) !== source.runtimeHash)
      throw new Error("launch source runtime conflict");
    if (source.source === "STONKBROKERS") {
      const quote = await this.rpc.readContract({
        address: source.contract,
        abi: stonkPadAbi,
        functionName: "quote",
        blockNumber: block,
      });
      if (!addressEqual(quote, source.quoteAsset!))
        throw new Error("launch quote conflict");
    }
    this.verified.set(source.id, Date.now());
  }
  stop() { this.stopped = true; this.wakeHistory?.(); }

  private async waitHistory(ms: number) {
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); this.wakeHistory = null; resolve(); };
      const timer = setTimeout(finish, ms);
      this.wakeHistory = finish;
    });
  }

  canBackfill() {
    return !this.stopped && !this.activeRun && !this.livePending && Date.now() >= this.historyRetryAt
      && [...this.verified.values()].some((at) => at > Date.now() - 3_600_000);
  }

  /** Live work has priority at every committed historical range boundary. */
  async tick(head: bigint, headHash: Hex) {
    this.livePending++;
    this.wakeHistory?.();
    try {
      while (this.activeRun) await this.activeRun;
      if (this.stopped) return;
      const run = this.run(head, headHash, false);
      this.activeRun = run;
      try { await run; } finally { this.activeRun = null; }
    } finally { this.livePending--; }
  }

  async backfill(head: bigint, headHash: Hex) {
    if (!this.canBackfill()) return;
    const run = this.run(head, headHash, true);
    this.activeRun = run;
    try { await run; } finally { this.activeRun = null; }
  }

  private async run(head: bigint, headHash: Hex, historyOnly: boolean) {
    const rpc = historyOnly ? this.historyRpc : this.rpc;
    const started = Date.now();
    let ranges = 0;
    let blocksScanned = 0n;
    let failed = false;
    let lastRangeStarted = 0;
    const timing = { setupMs: 0, liveMs: 0, historyMs: 0, enrichmentMs: 0, totalMs: 0 };
    let enrichmentStarted: number | null = null;
    let rangeTransaction = false;
    const client = await this.pool.connect();
    let locked = false;
    try {
      locked = (
        await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(4663,78191) AS locked",
        )
      ).rows[0]!.locked;
      if (!locked) return;
      if ((await rpc.getChainId()) !== 4663)
        throw new Error("launch RPC wrong chain");
      const active: LaunchSourceManifest[] = [];
      // Fixed small concurrency; runtime proofs are shared for an hour, never requested by browsers.
      if (historyOnly) {
        // Only the live cycle renews runtime authority. Background catch-up
        // cannot multiply cold/failed source verification requests.
        active.push(...launchSourceManifest.sources.filter((s) =>
          (this.verified.get(s.id) ?? 0) > Date.now() - 3_600_000));
        if (!active.length) return;
      }
      for (let i = 0; !historyOnly && i < launchSourceManifest.sources.length; i += 3) {
        const checked = await Promise.allSettled(
          launchSourceManifest.sources.slice(i, i + 3).map(async (source) => {
            await this.verify(source, head);
            return source;
          }),
        );
        for (const result of checked)
          if (result.status === "fulfilled") active.push(result.value);
      }
      if (!historyOnly && this.lensVerifiedAt <= Date.now() - 3_600_000) {
        const lens = await this.rpc
          .getBytecode({
            address: launchSourceManifest.lens.contract,
            blockNumber: head,
          })
          .catch(() => null);
        this.lensVerifiedAt =
          lens && keccak256(lens) === launchSourceManifest.lens.runtimeHash
            ? Date.now()
            : 0;
      }
      const lensReady = this.lensVerifiedAt > Date.now() - 3_600_000;
      // Grid alignment lets recovering sources rejoin shared bounded history reads.
      const liveStart =
        (head / BigInt(this.batchSize)) * BigInt(this.batchSize);
      for (const source of launchSourceManifest.sources) {
        const fingerprint = keccak256(
          new TextEncoder().encode(JSON.stringify(source)),
        );
        await client.query(
          `INSERT INTO rmt_launch_sources(source_id,fingerprint,next_block,historical_next,historical_end) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`,
          [source.id, fingerprint, String(liveStart), String(liveStart - 1n)],
        );
        const state = (
          await client.query<{ fingerprint: string }>(
            "SELECT fingerprint FROM rmt_launch_sources WHERE source_id=$1",
            [source.id],
          )
        ).rows[0]!;
        if (state.fingerprint !== fingerprint)
          throw new Error(
            "launch manifest changed; explicit migration required",
          );
        if (!historyOnly && !active.includes(source))
          await client.query(
            "UPDATE rmt_launch_sources SET status='unavailable',last_error='SOURCE_RUNTIME_UNAVAILABLE' WHERE source_id=$1",
            [source.id],
          );
      }
      type State = {
        source_id: string;
        next_block: string;
        historical_next: string;
        historical_end: string;
        scanned_at: Date | null;
      };
      const states = (
        await client.query<State>(
          "SELECT source_id,next_block::text,historical_next::text,historical_end::text,scanned_at FROM rmt_launch_sources ORDER BY scanned_at ASC NULLS FIRST,source_id",
        )
      ).rows.filter((s) => active.some((a) => a.id === s.source_id));
      // Reconcile the shared canonical branch before any write. Deep reorgs stop advancement.
      const points = (
        await client.query<{
          block_number: string;
          from_block: string;
          block_hash: Hex;
        }>(
          `SELECT * FROM (SELECT DISTINCT block_number,from_block,block_hash FROM rmt_launch_checkpoints) AS points ORDER BY block_number DESC LIMIT 64`,
        )
      ).rows;
      if (
        points.length &&
        (
          await rpc.getBlock({
            blockNumber: BigInt(points[0]!.block_number),
          })
        ).hash !== points[0]!.block_hash
      ) {
        const ancestor = await findReorgAncestor(
          points.slice(1).map((p) => ({
            blockNumber: BigInt(p.block_number),
            blockHash: p.block_hash,
          })),
          async (n) => (await rpc.getBlock({ blockNumber: n })).hash,
        );
        if (ancestor === null)
          throw new Error(
            "launch reorg exceeds retained checkpoints; advancement halted",
          );
        const rollback = ancestor;
        await client.query("BEGIN");
        for (const source of launchSourceManifest.sources)
          await rollbackLaunchSource(client, source.id, rollback);
        await client.query("COMMIT");
        return;
      }
      const lanes: ("live" | "history")[] = historyOnly
        ? Array.from({ length: LAUNCH_HISTORY_BUDGET.maxRanges }, () => "history")
        : ["live", "history"];
      timing.setupMs = Date.now() - started;
      for (const lane of lanes) {
        if (this.stopped || (historyOnly && this.livePending)) break;
        if (historyOnly) {
          const wait = Math.max(0, lastRangeStarted + LAUNCH_HISTORY_BUDGET.rangeIntervalMs - Date.now());
          if (Date.now() + wait >= started + LAUNCH_HISTORY_BUDGET.windowMs) break;
          if (wait) await this.waitHistory(wait);
          if (this.stopped || this.livePending) break;
          lastRangeStarted = Date.now();
        }
        const pending = states.filter((s) =>
          lane === "live"
            ? BigInt(s.next_block) <= head
            : BigInt(s.historical_next) >=
              BigInt(active.find((a) => a.id === s.source_id)!.startBlock),
        );
        if (!pending.length) {
          if (historyOnly) break;
          continue;
        }
        if (lane === "history" && Date.now() < this.historyRetryAt) continue;
        const group = lane === "history" ? nextHistoryGroup(pending, this.historyAfter) : pending.filter(
          (s) => s.next_block === pending[0]!.next_block,
        );
        const sources = active.filter((s) =>
          group.some((g) => g.source_id === s.id),
        );
        const coordinate = BigInt(lane === "history" ? group[0]!.historical_next : group[0]!.next_block);
        const rangeSize = historyOnly ? this.historyRangeSize : this.batchSize;
        const from =
          lane === "live"
            ? coordinate
            : coordinate >= BigInt(rangeSize - 1)
              ? coordinate - BigInt(rangeSize - 1)
              : 0n;
        const to =
          lane === "history"
            ? coordinate
            : coordinate + BigInt(this.batchSize - 1) < head
              ? coordinate + BigInt(this.batchSize - 1)
              : head;
        const eventAbis = sources.flatMap((s) =>
          launchAbi(s).filter((a) => a.type === "event"),
        );
        const uniqueEvents = [
          ...new Map(eventAbis.map((e) => [JSON.stringify(e), e])).values(),
        ];
        const rangeStarted = Date.now();
        const logs = await rpc.getLogs({
          address: sources.map((s) => s.contract),
          events: uniqueEvents,
          fromBlock: from,
          toBlock: to,
          strict: true,
        });
        const blocks = new Map<
          string,
          Awaited<ReturnType<PublicClient["getBlock"]>>
        >();
        const numbers = [...new Set([...logs.map((l) => l.blockNumber!), to])];
        if (historyOnly && numbers.length + 1 > LAUNCH_HISTORY_BUDGET.maxBlockReads && rangeSize > 1) {
          this.historyRangeSize = Math.max(1, Math.floor(rangeSize / 2));
          throw new HistorySplit(); // Retry a smaller contiguous range; no cursor advancement.
        }
        // Same three-block bound as the original producer. The background
        // transport coalesces these into one HTTP batch of at most three reads.
        const blockConcurrency = 3;
        for (let i = 0; i < numbers.length; i += blockConcurrency) {
          if (historyOnly && (this.stopped || this.livePending)) throw new HistoryYield();
          for (const b of await Promise.all(
            numbers
              .slice(i, i + blockConcurrency)
              .map((blockNumber) => rpc.getBlock({ blockNumber })),
          ))
            blocks.set(String(b.number), b);
        }
        const checkpoint = blocks.get(String(to))!;
        if (!checkpoint.hash) throw new Error("launch checkpoint missing hash");
        const events = logs.flatMap((log) => {
          if (
            log.blockNumber === null ||
            log.blockHash === null ||
            log.transactionHash === null ||
            log.logIndex === null
          )
            throw new Error("launch log unconfirmed");
          const source = sources.find(
            (s) => s.contract === log.address.toLowerCase(),
          );
          if (!source || log.blockNumber < BigInt(source.startBlock)) return [];
          const block = blocks.get(String(log.blockNumber))!;
          if (block.hash !== log.blockHash)
            throw new Error("launch range reorganized during read");
          return [
            decodeLaunchEvent(
              source,
              log as LaunchLog,
              new Date(Number(block.timestamp) * 1000).toISOString(),
            ),
          ];
        });
        if (
          (await rpc.getBlock({ blockNumber: to })).hash !==
          checkpoint.hash
        )
          throw new Error("launch checkpoint changed during read");
        if (historyOnly && (this.stopped || this.livePending)) throw new HistoryYield();
        await client.query("BEGIN");
        rangeTransaction = true;
        for (const event of events) {
          if (historyOnly && (this.stopped || this.livePending)) throw new HistoryYield();
          await insertLaunchEvent(client, event);
        }
        for (const source of sources) {
          await client.query(
            `INSERT INTO rmt_launch_checkpoints(source_id,lane,block_number,from_block,block_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [source.id, lane, String(to), String(from), checkpoint.hash],
          );
          await client.query(
            `DELETE FROM rmt_launch_checkpoints WHERE source_id=$1 AND lane=$2 AND block_number NOT IN (SELECT block_number FROM rmt_launch_checkpoints WHERE source_id=$1 AND lane=$2 ORDER BY block_number DESC LIMIT 64)`,
            [source.id, lane],
          );
          await client.query(
            `UPDATE rmt_launch_sources SET ${lane === "live" ? "next_block" : "historical_next"}=$2,status='indexing',scanned_at=NOW(),last_error=NULL WHERE source_id=$1`,
            [source.id, String(lane === "live" ? to + 1n : from - 1n)],
          );
        }
        await client.query("COMMIT");
        rangeTransaction = false;
        if (lane === "live") timing.liveMs += Date.now() - rangeStarted;
        else timing.historyMs += Date.now() - rangeStarted;
        // Advance the working selection only after the durable transaction commits.
        for (const state of group) {
          if (lane === "history") state.historical_next = String(from - 1n);
          else state.next_block = String(to + 1n);
        }
        if (lane === "history") {
          this.historyAfter = group[0]!.source_id;
          ranges++;
          blocksScanned += to - from + 1n;
          this.historyFailures = 0;
          this.historyRetryAt = 0;
          if (historyOnly && numbers.length < LAUNCH_HISTORY_BUDGET.maxBlockReads / 2)
            this.historyRangeSize = Math.min(this.batchSize, rangeSize * 2);
        }
      }
      if (historyOnly || this.stopped) return;
      enrichmentStarted = Date.now();
      await refreshLaunchIdentities(client, this.rpc, head, headHash);
      const candidate = (
        await client.query<{
          token: string;
          launch_id: string;
          source_id: string;
        }>(
          `SELECT c.launch_id,c.source_id,c.payload->'creation'->>'token' AS token FROM rmt_launch_events c
        LEFT JOIN rmt_launch_observations o ON o.launch_id=c.launch_id
        LEFT JOIN rmt_launch_refresh_attempts a ON a.launch_id=c.launch_id
        WHERE c.payload->'creation' IS NOT NULL AND c.payload->'creation'<>'null'::jsonb
          AND (a.retry_after IS NULL OR a.retry_after<NOW())
          AND c.source_id=ANY($1::text[])
        ORDER BY a.attempted_at ASC NULLS FIRST,c.block_number DESC LIMIT 1`,
          [
            active
              .filter((s) => s.source !== "STONKBROKERS" || lensReady)
              .map((s) => s.id),
          ],
        )
      ).rows[0];
      const launch = candidate
        ? (
            await readLaunchDirectory(client, {
              token: candidate.token,
              limit: 50,
            })
          ).entries.find((l) => l.launchId === candidate.launch_id)
        : null;
      const source = active.find((s) => s.id === candidate?.source_id);
      if (launch && source && (source.source !== "STONKBROKERS" || lensReady)) {
        await client.query(
          `INSERT INTO rmt_launch_refresh_attempts(launch_id,retry_after) VALUES($1,NOW()+INTERVAL '1 minute')
          ON CONFLICT(launch_id) DO UPDATE SET attempted_at=NOW(),retry_after=EXCLUDED.retry_after`,
          [launch.launchId],
        );
        try {
          const observation = await observeLaunch(
            this.rpc,
            source,
            launch,
            head,
            headHash,
          );
          if (
            (await this.rpc.getBlock({ blockNumber: head })).hash !== headHash
          )
            throw new Error("launch observation reorganized");
          await client.query(
            `INSERT INTO rmt_launch_observations(launch_id,source_id,block_number,payload) VALUES($1,$2,$3,$4) ON CONFLICT(launch_id) DO UPDATE SET block_number=EXCLUDED.block_number,payload=EXCLUDED.payload,refreshed_at=NOW()`,
            [
              launch.launchId,
              source.id,
              String(head),
              JSON.stringify(observation),
            ],
          );
          await client.query(
            "UPDATE rmt_launch_refresh_attempts SET retry_after=NOW()+INTERVAL '5 minutes' WHERE launch_id=$1",
            [launch.launchId],
          );
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: "launch_observation_delayed",
              sourceId: source.id,
              operation: "source_state_read",
              errorClass: error instanceof Error ? error.name : "Error",
            }),
          );
        }
      }
      for (const source of active)
        await client.query(
          `UPDATE rmt_launch_sources SET status=CASE WHEN next_block>$2 AND historical_next<$3 THEN 'ready' ELSE 'indexing' END,last_error=NULL WHERE source_id=$1`,
          [source.id, String(head), source.startBlock],
        );
    } catch (error) {
      if (error instanceof HistoryYield || error instanceof HistorySplit) {
        if (rangeTransaction) await client.query("ROLLBACK");
        return;
      }
      await client.query("ROLLBACK");
      failed = true;
      this.historyFailures++;
      this.historyRetryAt = Date.now() + historicalFailureDelay(this.historyFailures);
      await client.query(
        historyOnly
          ? "UPDATE rmt_launch_sources SET last_error=$1 WHERE status='indexing'"
          : "UPDATE rmt_launch_sources SET status='unavailable',last_error=$1",
        [error instanceof Error ? error.name : "Error"],
      );
      console.warn(
        JSON.stringify({
          event: historyOnly ? "launch_history_delayed" : "launch_indexer_unavailable",
          operation: "bounded_launch_cycle",
          errorClass: error instanceof Error ? error.name : "Error",
        }),
      );
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(4663,78191)");
      client.release();
      if (enrichmentStarted !== null) timing.enrichmentMs = Date.now() - enrichmentStarted;
      timing.totalMs = Date.now() - started;
      if (!historyOnly) this.lastCycleTiming = timing;
      if (historyOnly && locked) console.info(JSON.stringify({
        event: "launch_history_window", durationMs: Date.now() - started,
        ranges, blocksScanned: String(blocksScanned), concurrency: 1,
        yieldedToLive: this.livePending > 0, failed,
        retryAfterMs: Math.max(0, this.historyRetryAt - Date.now()),
        nextRangeSize: this.historyRangeSize,
      }));
    }
  }
}
