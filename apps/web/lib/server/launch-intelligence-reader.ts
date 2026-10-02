import { z } from "zod";
import type {
  LaunchDirectory,
  LaunchEvidence,
} from "@rmt/shared/launch-intelligence";
import { RMT_LAUNCH_AUTHORITIES } from "@rmt/shared/launch-intelligence";
import { projectsForContract } from "@rmt/shared/project-identity";
import { resolveVNextMarketIndexerConfiguration } from "./vnext-market-indexer";
const address = z.string().regex(/^0x[\da-f]{40}$/),
  nonzero = address.refine((v) => !/^0x0{40}$/.test(v));
const hash = z.string().regex(/^0x[\da-f]{64}$/),
  integer = z.string().regex(/^(0|[1-9]\d{0,77})$/),
  date = z.string().datetime();
export const launchEvidenceSchema = z
  .object({
    chainId: z.literal(4663),
    launchId: z.string().max(160),
    sourceId: z
      .string()
      .regex(/^(pons-v[12](?:-legacy)?|stonk-v2-(?:r2-)?[a-z]+)$/),
    source: z.enum(["PONS", "STONKBROKERS"]),
    sourceVersion: z.enum(["V1", "V2", "V2_R2"]),
    sourceContract: nonzero,
    token: nonzero,
    quoteAsset: address.nullable(),
    creator: nonzero,
    curve: nonzero.nullable(),
    initialMarket: nonzero.nullable(),
    liquidityDestination: nonzero.nullable(),
    relationship: z.enum(["TOKEN_CREATED", "TOKEN_ENROLLED"]),
    launchTransaction: hash,
    launchBlock: integer,
    launchBlockHash: hash,
    logIndex: z.number().int().nonnegative(),
    launchTime: date,
    state: z.enum([
      "LAUNCHED",
      "BONDING",
      "GRADUATING",
      "GRADUATED",
      "ABORTED",
      "RESCUED",
    ]),
    sourcePhase: z.string().max(100),
    progressBps: z.number().int().min(0).max(10000).nullable(),
    creatorTaxBps: z.number().int().min(0).max(10000).nullable(),
    graduatedMarkets: z
      .array(z.string().regex(/^0x(?:[\da-f]{40}|[\da-f]{64})$/))
      .max(64),
    graduationTransaction: hash.nullable(),
    graduationBlock: integer.nullable(),
    observedBlock: integer,
    observedBlockHash: hash,
    observedAt: date,
    identity: z.object({
      name: z.string().trim().min(1).max(80).nullable(),
      symbol: z.string().trim().min(1).max(20).nullable(),
      decimals: z.number().int().min(0).max(36).nullable(),
      artwork: z.string().max(2048).nullable(),
    }),
    evidenceClass: z.literal("ONCHAIN_VERIFIED"),
    marketCapUsd8: integer.nullable().optional(),
    identityObservations: z
      .object({
        name: z
          .object({ block: integer, blockHash: hash, observedAt: date })
          .optional(),
        symbol: z
          .object({ block: integer, blockHash: hash, observedAt: date })
          .optional(),
        decimals: z
          .object({ block: integer, blockHash: hash, observedAt: date })
          .optional(),
        artwork: z
          .object({ block: integer, blockHash: hash, observedAt: date })
          .optional(),
      })
      .optional(),
  })
  .superRefine((e, ctx) => {
    const authority = RMT_LAUNCH_AUTHORITIES.find(
      (source) => source.id === e.sourceId,
    );
    if (
      !authority ||
      authority.contract !== e.sourceContract ||
      authority.source !== e.source ||
      authority.version !== e.sourceVersion
    )
      ctx.addIssue({
        code: "custom",
        message: "Unknown or conflicting launch authority",
      });
    const expected = e.source === "PONS" ? e.token : e.launchId.split(":")[1];
    const sourceConsistent =
      e.source === "PONS"
        ? e.sourceId.startsWith(`pons-${e.sourceVersion.toLowerCase()}`)
        : e.sourceId.startsWith(
            e.sourceVersion === "V2_R2" ? "stonk-v2-r2-" : "stonk-v2-",
          ) && e.sourceVersion !== "V1";
    if (
      !sourceConsistent ||
      e.launchId !== `${e.sourceContract}:${expected}` ||
      (e.source === "STONKBROKERS" && !/^[1-9]\d*$/.test(expected ?? "")) ||
      (e.source === "PONS" && e.sourceVersion === "V2_R2") ||
      BigInt(e.observedBlock) < BigInt(e.launchBlock) ||
      (e.source === "PONS" && e.relationship !== "TOKEN_CREATED") ||
      (e.graduationBlock !== null &&
        BigInt(e.graduationBlock) < BigInt(e.launchBlock))
    )
      ctx.addIssue({
        code: "custom",
        message: "Contradictory launch provenance",
      });
    for (const proof of Object.values(e.identityObservations ?? {}))
      if (
        e.relationship === "TOKEN_CREATED" &&
        BigInt(proof.block) < BigInt(e.launchBlock)
      )
        ctx.addIssue({
          code: "custom",
          message: "Identity observation precedes launch",
        });
  });
const directorySchema = z.object({
  chainId: z.literal(4663),
  status: z.enum(["ready", "partial", "unavailable"]),
  entries: z.array(launchEvidenceSchema).max(50),
  nextCursor: z.string().max(1024).nullable(),
  sources: z
    .array(
      z.object({
        sourceId: z.string().max(64),
        indexedThrough: integer.nullable(),
        historicalFrom: integer.nullable(),
        status: z.enum(["indexing", "ready", "unavailable"]),
      }),
    )
    .max(32),
});
export const unavailableLaunchDirectory = (): LaunchDirectory => ({
  chainId: 4663,
  status: "unavailable",
  entries: [],
  nextCursor: null,
  sources: [],
});
export type LaunchQuery = {
  token?: string;
  q?: string;
  source?: string;
  cursor?: string;
  limit?: number;
};
export async function readLaunchIntelligence(
  query: LaunchQuery = {},
  deps: {
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<LaunchDirectory> {
  const configuration = resolveVNextMarketIndexerConfiguration(
    deps.env ?? process.env,
    deps.timeoutMs ?? 1200,
  );
  if ("status" in configuration) return unavailableLaunchDirectory();
  if (
    (query.token && !/^0x[\da-f]{40}$/i.test(query.token)) ||
    (query.q && query.q.length > 160) ||
    (query.source && !["PONS", "STONKBROKERS"].includes(query.source)) ||
    (query.cursor &&
      (query.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(query.cursor))) ||
    (query.limit !== undefined &&
      (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50))
  )
    return unavailableLaunchDirectory();
  const url = new URL(configuration.baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/launches`;
  for (const [key, value] of Object.entries(query))
    if (value !== undefined)
      url.searchParams.set(
        key,
        key === "token" ? String(value).toLowerCase() : String(value),
      );
  try {
    const response = await (deps.fetch ?? fetch)(url, {
      headers: { Authorization: `Bearer ${configuration.readCredential}` },
      signal: AbortSignal.timeout(configuration.timeoutMs),
      next: { revalidate: 15 },
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > 1_000_000
    )
      return unavailableLaunchDirectory();
    const text = await response.text();
    if (text.length > 1_000_000 || text.includes(configuration.readCredential))
      return unavailableLaunchDirectory();
    const result = directorySchema.safeParse(JSON.parse(text));
    if (!result.success) return unavailableLaunchDirectory();
    if (
      new Set(result.data.entries.map((e) => e.launchId)).size !==
        result.data.entries.length ||
      result.data.entries.some(
        (e) =>
          (query.token && e.token !== query.token.toLowerCase()) ||
          (query.source && e.source !== query.source),
      )
    )
      return unavailableLaunchDirectory();
    return {
      ...result.data,
      entries: result.data.entries.map((entry) => ({
        ...entry,
        projectId: projectsForContract(entry.token)[0]?.projectId ?? null,
      })),
    } as LaunchDirectory;
  } catch {
    return unavailableLaunchDirectory();
  }
}
