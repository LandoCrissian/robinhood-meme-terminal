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

const addressEqual = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
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
  private verified = new Map<string, number>();
  private lensVerifiedAt = 0;
  constructor(
    private pool: Pool,
    private rpc: PublicClient,
    private batchSize: number,
  ) {}
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
  async tick(head: bigint, headHash: Hex) {
    const client = await this.pool.connect();
    let locked = false;
    try {
      locked = (
        await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(4663,78191) AS locked",
        )
      ).rows[0]!.locked;
      if (!locked) return;
      if ((await this.rpc.getChainId()) !== 4663)
        throw new Error("launch RPC wrong chain");
      const active: LaunchSourceManifest[] = [];
      // Fixed small concurrency; runtime proofs are shared for an hour, never requested by browsers.
      for (let i = 0; i < launchSourceManifest.sources.length; i += 3) {
        const checked = await Promise.allSettled(
          launchSourceManifest.sources.slice(i, i + 3).map(async (source) => {
            await this.verify(source, head);
            return source;
          }),
        );
        for (const result of checked)
          if (result.status === "fulfilled") active.push(result.value);
      }
      if (this.lensVerifiedAt <= Date.now() - 3_600_000) {
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
        if (!active.includes(source))
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
          await this.rpc.getBlock({
            blockNumber: BigInt(points[0]!.block_number),
          })
        ).hash !== points[0]!.block_hash
      ) {
        const ancestor = await findReorgAncestor(
          points.slice(1).map((p) => ({
            blockNumber: BigInt(p.block_number),
            blockHash: p.block_hash,
          })),
          async (n) => (await this.rpc.getBlock({ blockNumber: n })).hash,
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
      for (const lane of ["live", "history"] as const) {
        const pending = states.filter((s) =>
          lane === "live"
            ? BigInt(s.next_block) <= head
            : BigInt(s.historical_next) >=
              BigInt(active.find((a) => a.id === s.source_id)!.startBlock),
        );
        if (!pending.length) continue;
        const coordinate =
          lane === "live"
            ? BigInt(pending[0]!.next_block)
            : pending.reduce(
                (max, s) =>
                  BigInt(s.historical_next) > max
                    ? BigInt(s.historical_next)
                    : max,
                -1n,
              );
        const group = pending.filter(
          (s) =>
            BigInt(lane === "live" ? s.next_block : s.historical_next) ===
            coordinate,
        );
        const sources = active.filter((s) =>
          group.some((g) => g.source_id === s.id),
        );
        const from =
          lane === "live"
            ? coordinate
            : coordinate >= BigInt(this.batchSize - 1)
              ? coordinate - BigInt(this.batchSize - 1)
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
        const logs = await this.rpc.getLogs({
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
        for (let i = 0; i < numbers.length; i += 3)
          for (const b of await Promise.all(
            numbers
              .slice(i, i + 3)
              .map((blockNumber) => this.rpc.getBlock({ blockNumber })),
          ))
            blocks.set(String(b.number), b);
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
          (await this.rpc.getBlock({ blockNumber: to })).hash !==
          checkpoint.hash
        )
          throw new Error("launch checkpoint changed during read");
        await client.query("BEGIN");
        for (const event of events) await insertLaunchEvent(client, event);
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
      }
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
      await client.query("ROLLBACK");
      await client.query(
        "UPDATE rmt_launch_sources SET status='unavailable',last_error=$1",
        [error instanceof Error ? error.name : "Error"],
      );
      console.warn(
        JSON.stringify({
          event: "launch_indexer_unavailable",
          operation: "bounded_launch_cycle",
          errorClass: error instanceof Error ? error.name : "Error",
        }),
      );
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(4663,78191)");
      client.release();
    }
  }
}
