import assert from "node:assert/strict";
import type { Client } from "pg";
import { isAddress, parseAbi, type PublicClient } from "viem";
import { blockEvidence, curveCreationAbi, readCurveLaunchRegistration, verifyCurveDeployment,
  type BlockEvidence, type CurveLaunchRegistration } from "./curve-launch-evidence.js";
import { readWithArchive } from "./historical-launches.js";
import { classifySyncFailure } from "./rpc-resilience.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import { commitProductionCurveRange, initializeProductionCurveStore, productionCurveCheckpoints,
  productionCurveCursor, productionCurveScope, readProductionCurveLaunches, readProductionCurveEarnings, rollbackProductionCurve } from "./curve-production-store.js";
import { creatorEarningsProfile, decodeEarningsDiscoveryCursor, earningsBeneficiaryRoles, encodeEarningsDiscoveryCursor,
  type EarningsDiscoveryQuery } from "./creator-earnings.js";
import { createProductionActivityIndexer, productionActivityProfile, readProductionActivity,
  type ActivityQuery } from "./curve-production-activity.js";
import { productionCurveBirthRpc } from "./curve-production-birth.js";

type Database = Pick<Client, "query">;
const maximumRange = 2_000n;
const maximumEvents = 128;
const maximumCheckpointAgeMs = 120_000;
const reserveAbi = parseAbi(["function futureReserveRecipient() view returns(address)"]);

export function parseProductionCurveQuery(url: URL) {
  const match = /^\/curve-launches(?:\/(0x[0-9a-fA-F]{40}))?$/.exec(url.pathname);
  if (!match || Array.from(url.searchParams.keys()).some((key) => !["after", "limit"].includes(key))
      || new Set(url.searchParams.keys()).size !== Array.from(url.searchParams.keys()).length) return null;
  const token = match[1];
  const after = url.searchParams.get("after") ?? undefined;
  const requested = url.searchParams.get("limit") ?? "25";
  if ((token && !isAddress(token, { strict: false })) || (after && !isAddress(after, { strict: false }))
      || (token && url.search) || !/^[1-9][0-9]?$/.test(requested) || Number(requested) > 50) return null;
  return { token: token?.toLowerCase(), after: after?.toLowerCase(), limit: token ? 1 : Number(requested) };
}

/** One bounded pass inside the original process and its existing leased writer. */
export function createProductionCurveIndexer(config: CurveProductionConfig, writer: Database,
  primary: PublicClient, archive: PublicClient | undefined, now: () => number = Date.now) {
  const { binding } = config;
  const scope = productionCurveScope(config);
  let initialized = false;
  let checkpoint: BlockEvidence | null = null;
  let verifiedAt: number | null = null;
  let failed = false;
  let failureInvalidatesEvidence = false;
  let caughtUp = false;
  let busy = false;
  let revision = 0;
  const activity = createProductionActivityIndexer(config, writer, primary, archive);

  async function canonicalBlock(height: bigint) {
    if (!archive) throw new Error("Production curve indexing requires a distinct corroborating RPC");
    const checked = await Promise.all([primary, archive].map(async (rpc) =>
      blockEvidence(await rpc.getBlock({ blockNumber: height, includeTransactions: false }), height)));
    assert.deepEqual(checked[0], checked[1], "Production curve providers disagree on the canonical block");
    return checked[0]!;
  }

  async function verifyDeployment(readers: PublicClient[]) {
    if (!archive) throw new Error("Production curve indexing requires a distinct corroborating RPC");
    for (const rpc of readers) {
      await verifyCurveDeployment(binding, rpc);
      const [receipt, reserve] = await Promise.all([
        rpc.getTransactionReceipt({ hash: config.deploymentTransactionHash }),
        rpc.readContract({ address: binding.factory, abi: reserveAbi, functionName: "futureReserveRecipient",
          blockNumber: binding.deploymentBlock }),
      ]);
      if (receipt.status !== "success" || receipt.blockNumber !== binding.deploymentBlock
          || receipt.blockHash.toLowerCase() !== binding.deploymentBlockHash.toLowerCase()
          || reserve.toLowerCase() !== config.reserveRecipient.toLowerCase()) {
        throw new Error("Production deployment receipt or immutable reserve recipient mismatch");
      }
    }
  }

  async function reconcile() {
    const saved = await productionCurveCheckpoints(writer, scope);
    const latest = saved[0];
    if (!latest) return;
    for (const [index, point] of saved.slice(0, 24).entries()) {
      const observed = await canonicalBlock(BigInt(point.blockNumber));
      if (observed.blockHash.toLowerCase() !== point.blockHash.toLowerCase()) continue;
      if (index > 0) await rollbackProductionCurve(writer, scope, BigInt(point.blockNumber));
      return;
    }
    if (saved.length > 24) throw new Error("Production curve reorg exceeds bounded automatic recovery");
    await canonicalBlock(binding.deploymentBlock);
    await rollbackProductionCurve(writer, scope, binding.deploymentBlock - 1n);
  }

  async function syncOnce() {
    if (busy) throw new Error("Production curve writer pass is already running");
    busy = true;
    revision++;
    try {
      if (!archive) throw new Error("Production curve indexing requires a distinct corroborating RPC");
      const heads = await Promise.all([primary, archive].map((rpc) => rpc.getBlockNumber({ cacheTime: 0 })));
      const safeHead = (heads[0]! < heads[1]! ? heads[0]! : heads[1]!) - BigInt(binding.confirmations);
      if (safeHead < binding.deploymentBlock) throw new Error("Production deployment confirmations are pending");
      const readers = [primary, archive].map(rpc => productionCurveBirthRpc(config, rpc, safeHead));
      if (!initialized) {
        await verifyDeployment(readers);
        await initializeProductionCurveStore(writer, config);
        initialized = true;
      }
      const deployment = await canonicalBlock(binding.deploymentBlock);
      if (deployment.blockHash.toLowerCase() !== binding.deploymentBlockHash.toLowerCase()) {
        throw new Error("Production curve deployment was invalidated by a reorg");
      }
      await reconcile();
      const cursor = await productionCurveCursor(writer, scope);
      if (cursor - 1n > safeHead) throw new Error("Production checkpoint is ahead of corroborated state");
      if (cursor <= safeHead) {
        const end = cursor + maximumRange - 1n < safeHead ? cursor + maximumRange - 1n : safeHead;
        const endBlock = await canonicalBlock(end);
        const references = await Promise.all([primary, archive!].map(async (rpc) => {
          const logs = await rpc.getLogs({ address: binding.factory, event: curveCreationAbi[5],
            fromBlock: cursor, toBlock: end, strict: true });
          if (logs.length > maximumEvents) throw new Error("Production registration range exceeds its event bound");
          const identities = new Map<string, { blockNumber: bigint; blockHash: `0x${string}`; transactionHash: `0x${string}`; logIndex: number }>();
          for (const log of logs) {
            if (log.removed || log.blockNumber === null || log.blockHash === null || log.transactionHash === null || log.logIndex === null) {
              throw new Error("Production registration log identity is incomplete");
            }
            identities.set([log.blockHash, log.transactionHash, log.logIndex].join(":"), {
              blockNumber: log.blockNumber, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex,
            });
          }
          return [...identities.values()].sort((first, second) => first.blockNumber === second.blockNumber
            ? first.logIndex - second.logIndex : first.blockNumber < second.blockNumber ? -1 : 1);
        }));
        assert.deepEqual(references[0], references[1], "Production providers disagree on factory registration logs");
        const launches: CurveLaunchRegistration[] = [];
        for (const ref of references[0]!) {
          const registration = await readWithArchive(() => readCurveLaunchRegistration(binding, readers[0]!, ref),
            () => readCurveLaunchRegistration(binding, readers[1]!, ref));
          if (!registration) throw new Error("Production registration evidence unavailable");
          launches.push(registration);
        }
        assert.deepEqual(await canonicalBlock(end), endBlock, "Production range changed during receipt verification");
        await commitProductionCurveRange(writer, config, cursor, endBlock, launches);
      }
      checkpoint = (await productionCurveCheckpoints(writer, scope, 1))[0] ?? null;
      if (!checkpoint) throw new Error("Production canonical checkpoint unavailable");
      caughtUp = BigInt(checkpoint.blockNumber) === safeHead;
      // Optional explicitly installed activity schema backfills independently.
      // Missing/invalid activity never makes creation-only evidence unavailable.
      try { await activity.sync(checkpoint, safeHead); } catch { activity.invalidate(); }
      verifiedAt = now();
      failed = false;
      failureInvalidatesEvidence = false;
    } catch (error) {
      failed = true;
      failureInvalidatesEvidence = classifySyncFailure(error) !== "upstream";
      throw error;
    } finally {
      busy = false;
      revision++;
    }
  }

  function state() {
    const currentTime = now();
    const blockTime = checkpoint ? Date.parse(checkpoint.timestamp) : Number.NaN;
    const fresh = verifiedAt !== null && currentTime >= verifiedAt && currentTime - verifiedAt <= maximumCheckpointAgeMs
      && Number.isFinite(blockTime) && blockTime <= currentTime + 30_000 && currentTime - blockTime <= maximumCheckpointAgeMs;
    return { status: busy || !checkpoint || failureInvalidatesEvidence || !caughtUp ? "unavailable"
      : failed || !fresh ? "stale" : "ready", checkpoint, revision, verifiedAt, caughtUp };
  }

  async function read(db: Database, query: NonNullable<ReturnType<typeof parseProductionCurveQuery>>) {
    const before = state();
    if (before.status === "unavailable" || !before.checkpoint) throw new Error("Production curve evidence unavailable");
    const launches = await readProductionCurveLaunches(db, scope, before.checkpoint, query);
    const after = state();
    if (after.revision !== before.revision || after.status === "unavailable") throw new Error("Production evidence changed during read");
    return {
      chainId: 4663, profile: binding.profile, status: after.status, observedAt: new Date(now()).toISOString(),
      deployment: { factory: binding.factory, registry: binding.projectRegistry, blockNumber: binding.deploymentBlock.toString(),
        blockHash: binding.deploymentBlockHash },
      checkpoint: { ...before.checkpoint, confirmations: binding.confirmations, finality: "l2-confirmed", l1Finality: "unverified" },
      launches: launches.map((launch) => ({ ...launch, lifecycleObservation: "creation-only",
        paymentSettlement: launch.creationFee.refundWei === "0" ? "exact-value-registration" : "refund-trace-pending" })),
      nextCursor: !query.token && launches.length === query.limit ? launches.at(-1)!.token.toLowerCase() : null,
    };
  }

  async function readEarnings(db: Database, query: EarningsDiscoveryQuery) {
    if (!isAddress(query.recipient, { strict: false }) || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
      throw new Error("Invalid bounded earnings discovery query");
    }
    const before = state();
    if (before.status === "unavailable" || !before.checkpoint) throw new Error("Production earnings evidence unavailable");
    const cursor = query.after ? decodeEarningsDiscoveryCursor(query.after) : undefined;
    if (query.after && (!cursor || cursor.scope !== scope || cursor.recipient !== query.recipient.toLowerCase())) {
      throw new Error("Earnings cursor belongs to another deployment or beneficiary");
    }
    const data = await readProductionCurveEarnings(db, scope, before.checkpoint, {
      recipient: query.recipient, operatingRecipient: binding.creationFeeRecipient, reserveRecipient: config.reserveRecipient,
      cursor: cursor ?? undefined, limit: query.limit + 1, token: query.token,
    });
    const after = state();
    if (after.revision !== before.revision || after.status === "unavailable") throw new Error("Earnings evidence changed during read");
    const launches = data.launches.slice(0, query.limit).map(launch => ({ ...launch,
      beneficiaryRoles: earningsBeneficiaryRoles(launch, query.recipient, config), feeEvidence: "contract-read-required" as const }));
    const last = launches.at(-1);
    const stale = after.status === "stale" || now() - Date.parse(data.checkpoint.timestamp) > maximumCheckpointAgeMs;
    return {
      schemaVersion: 1 as const, chainId: 4663 as const, profile: creatorEarningsProfile,
      status: stale ? "stale" as const : "ready" as const, recipient: query.recipient, observedAt: new Date(now()).toISOString(),
      deployment: { factory: binding.factory, registry: binding.projectRegistry, blockNumber: binding.deploymentBlock.toString(),
        blockHash: binding.deploymentBlockHash },
      checkpoint: { ...data.checkpoint, confirmations: binding.confirmations, finality: "l2-confirmed" as const, l1Finality: "unverified" as const },
      launches, nextCursor: !query.token && data.launches.length > query.limit && last ? encodeEarningsDiscoveryCursor({ scope,
        recipient: query.recipient, blockNumber: data.checkpoint.blockNumber, blockHash: data.checkpoint.blockHash, after: last.token }) : null,
      history: { status: "unsupported" as const, source: "historical-v4-v6", feeEvidence: "No verified compatible legacy fee adapter; historical registrations remain separate" },
    };
  }

  async function readActivity(db: Database, query: ActivityQuery) {
    const before = state();
    if (before.status !== "ready" || !before.checkpoint || !activity.ready(before.checkpoint)) throw new Error("Canonical activity evidence unavailable");
    const events = await readProductionActivity(db, scope, before.checkpoint, query);
    const after = state();
    if (after.revision !== before.revision || after.status !== "ready" || !activity.ready(before.checkpoint)) throw new Error("Canonical activity changed during read");
    return { schemaVersion: 1 as const, chainId: 4663 as const, profile: productionActivityProfile, status: "ready" as const,
      token: query.token ?? null, transactionHash: query.transactionHash, observedAt: new Date(now()).toISOString(),
      deployment: { factory: binding.factory, registry: binding.projectRegistry, blockNumber: binding.deploymentBlock.toString(), blockHash: binding.deploymentBlockHash },
      checkpoint: { ...before.checkpoint, confirmations: binding.confirmations, finality: "l2-confirmed" as const, l1Finality: "unverified" as const }, events };
  }

  return { syncOnce, state, read, readEarnings, readActivity };
}
