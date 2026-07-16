import { createPublicClient, getAddress, http, type Address, type Hash } from "viem";
import { z } from "zod";
import { publicMainnetV6FactoryAddress } from "../contracts";
import { activeChain, isMainnetRelease, publicMainnetV6FactoryStartBlock } from "../network";
import type { LaunchFeedItem } from "../launch-feed";
import { resolveTokenMetadata } from "../token-metadata";

const FIXED_TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const DEFAULT_INDEXER_TIMEOUT_MS = 5_000;

const tokenBalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }]
  }
] as const;

const decimalString = z.string().regex(/^\d+$/);
const addressString = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hashString = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const indexedLaunchSchema = z.object({
  launch_id: decimalString,
  token: addressString,
  creator: addressString,
  market: addressString,
  reward_vault: addressString,
  name: z.string(),
  symbol: z.string(),
  creator_bps: z.coerce.number().int().min(0).max(10_000),
  community_bps: z.coerce.number().int().min(0).max(10_000),
  protocol_version: z.literal(6),
  policy_id: hashString.nullable().optional(),
  policy_version: z.coerce.number().int().nullable().optional(),
  curve_fee_bps: z.coerce.number().int().nullable().optional(),
  protocol_fee_share_bps: z.coerce.number().int().nullable().optional(),
  post_graduation_fee_bps: z.coerce.number().int().nullable().optional(),
  graduation_target: decimalString.nullable().optional(),
  fair_start_enabled: z.boolean().nullable().optional(),
  official_migration: z.boolean().optional(),
  transaction_hash: hashString,
  block_number: decimalString,
  metadata_uri: z.string(),
  reserve_wei: decimalString,
  volume_wei: decimalString,
  trade_count: z.coerce.number().int().min(0),
  buy_count: z.coerce.number().int().min(0),
  sell_count: z.coerce.number().int().min(0),
  graduated: z.boolean(),
  creator_bought_tokens: decimalString.optional(),
  creator_sold_tokens: decimalString.optional(),
  creator_trade_count: z.coerce.number().int().min(0).optional()
}).passthrough();

const indexedLaunchResponseSchema = z.object({
  chainId: z.literal(4663).optional(),
  protocolVersion: z.literal(6).optional(),
  factory: addressString.optional(),
  factoryStartBlock: decimalString.optional(),
  launches: z.array(indexedLaunchSchema),
  indexedThrough: decimalString,
  syncedAt: z.string()
});

const indexedBindingSchema = z.object({
  chainId: z.literal(4663),
  protocolVersion: z.literal(6),
  factory: addressString,
  factoryStartBlock: decimalString
});

const indexedOriginResponseSchema = z.object({
  chainId: z.literal(4663),
  coverage: z.literal("complete"),
  factory: addressString,
  indexedThrough: decimalString,
  syncedAt: z.string(),
  claims: z.array(z.object({
    token: addressString,
    state: z.literal("rmt-verified"),
    claimKind: z.literal("token-created"),
    platform: z.literal("RMT"),
    protocolVersion: z.literal(6),
    factory: addressString,
    launchId: decimalString,
    creator: addressString,
    market: addressString,
    launchTransactionHash: hashString,
    launchBlock: decimalString
  }).passthrough())
});

function validatedIndexerBinding(value: z.infer<typeof indexedBindingSchema>) {
  const binding = indexedBindingSchema.parse(value);
  if (getAddress(binding.factory) !== publicMainnetV6FactoryAddress) {
    throw new Error("Indexer factory does not match the live V6 release.");
  }
  if (BigInt(binding.factoryStartBlock) !== publicMainnetV6FactoryStartBlock) {
    throw new Error("Indexer start block does not match the live V6 release.");
  }
  return binding;
}

const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(
    isMainnetRelease
      ? process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? activeChain.rpcUrls.default.http[0]
      : process.env.RMT_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_TESTNET_RPC_URL ?? activeChain.rpcUrls.default.http[0],
    { retryCount: 1, timeout: 8_000 }
  )
});

function configuredIndexerUrl() {
  return process.env.RMT_INDEXER_URL?.trim().replace(/\/+$/, "") ?? "";
}

function indexerTimeoutMs() {
  const configured = Number.parseInt(process.env.RMT_INDEXER_TIMEOUT_MS ?? "", 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_INDEXER_TIMEOUT_MS;
}

function creatorFlow(row: z.infer<typeof indexedLaunchSchema>): NonNullable<LaunchFeedItem["creatorFlow"]> {
  if (
    row.creator_trade_count === undefined
      || row.creator_bought_tokens === undefined
      || row.creator_sold_tokens === undefined
  ) return "unknown";
  if (row.creator_trade_count === 0) return "inactive";
  const net = BigInt(row.creator_bought_tokens) - BigInt(row.creator_sold_tokens);
  if (net > 0n) return "buying";
  if (net < 0n) return "selling";
  return "balanced";
}

function progressBps(reserveWei: string, graduationTarget: string | undefined, graduated: boolean) {
  if (graduated) return 10_000;
  if (!graduationTarget || BigInt(graduationTarget) === 0n) return 0;
  return Math.min(10_000, Number(BigInt(reserveWei) * 10_000n / BigInt(graduationTarget)));
}

function mapIndexedLaunch(row: z.infer<typeof indexedLaunchSchema>): LaunchFeedItem {
  const graduationTarget = row.graduation_target ?? undefined;
  return {
    launchId: row.launch_id,
    token: getAddress(row.token),
    creator: getAddress(row.creator),
    market: getAddress(row.market),
    rewardVault: getAddress(row.reward_vault),
    name: row.name,
    symbol: row.symbol,
    creatorBps: row.creator_bps,
    communityBps: row.community_bps,
    protocolVersion: row.protocol_version,
    policyId: row.policy_id ? row.policy_id as Hash : undefined,
    policyVersion: row.policy_version ?? undefined,
    curveFeeBps: row.curve_fee_bps ?? undefined,
    protocolFeeShareBps: row.protocol_fee_share_bps ?? undefined,
    postGraduationFeeBps: row.post_graduation_fee_bps ?? undefined,
    graduationTarget,
    fairStartEnabled: row.fair_start_enabled ?? undefined,
    officialMigration: row.official_migration,
    transactionHash: row.transaction_hash as Hash,
    blockNumber: row.block_number,
    metadataURI: row.metadata_uri,
    reserveWei: row.reserve_wei,
    volumeWei: row.volume_wei,
    tradeCount: row.trade_count,
    buyCount: row.buy_count,
    sellCount: row.sell_count,
    progressBps: progressBps(row.reserve_wei, graduationTarget, row.graduated),
    graduated: row.graduated,
    creatorFlow: creatorFlow(row)
  };
}

async function enrichCreatorConcentration(launches: LaunchFeedItem[], indexedThrough: string) {
  if (launches.length === 0) return launches;
  try {
    const balances = await publicClient.multicall({
      contracts: launches.flatMap((launch) => [
        { address: launch.token, abi: tokenBalanceAbi, functionName: "balanceOf", args: [launch.creator] },
        { address: launch.token, abi: tokenBalanceAbi, functionName: "balanceOf", args: [launch.market] }
      ] as const),
      allowFailure: true,
      batchSize: 0,
      deployless: true,
      blockNumber: BigInt(indexedThrough)
    });

    return launches.map((launch, index) => {
      const creatorRead = balances[index * 2];
      const inventoryRead = balances[index * 2 + 1];
      const creatorBalance = creatorRead?.status === "success" && typeof creatorRead.result === "bigint"
        ? creatorRead.result
        : null;
      const marketInventory = inventoryRead?.status === "success" && typeof inventoryRead.result === "bigint"
        ? inventoryRead.result
        : null;
      if (creatorBalance === null || marketInventory === null) return launch;

      const circulatingSupply = FIXED_TOKEN_SUPPLY > marketInventory
        ? FIXED_TOKEN_SUPPLY - marketInventory
        : 0n;
      const creatorOutsideCurveBps = creatorBalance === 0n
        ? 0
        : circulatingSupply > 0n
          ? Math.min(10_000, Number(creatorBalance * 10_000n / circulatingSupply))
          : undefined;
      return {
        ...launch,
        creatorBalanceWei: creatorBalance.toString(),
        creatorOutsideCurveBps
      };
    });
  } catch {
    return launches;
  }
}

export function hasConfiguredLaunchIndexer() {
  return Boolean(configuredIndexerUrl());
}

export async function readIndexedLaunches(limit = 25) {
  const baseUrl = configuredIndexerUrl();
  if (!baseUrl) throw new Error("The confirmed launch indexer is not configured.");

  const url = new URL(baseUrl + "/launches");
  url.searchParams.set("limit", String(limit));
  const headers: Record<string, string> = { Accept: "application/json" };
  const readToken = process.env.RMT_INDEXER_READ_TOKEN?.trim();
  if (readToken) headers.Authorization = "Bearer " + readToken;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), indexerTimeoutMs());
  try {
    const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("The confirmed launch indexer returned " + response.status + ".");
    const payload = indexedLaunchResponseSchema.parse(await response.json());
    const binding = payload.chainId !== undefined
      && payload.protocolVersion !== undefined
      && payload.factory !== undefined
      && payload.factoryStartBlock !== undefined
      ? validatedIndexerBinding({
          chainId: payload.chainId,
          protocolVersion: payload.protocolVersion,
          factory: payload.factory,
          factoryStartBlock: payload.factoryStartBlock
        })
      : await (async () => {
          // One-release compatibility bridge: the already-live indexer exposed
          // these exact bindings on /health before embedding them in /launches.
          const healthResponse = await fetch(baseUrl + "/health", { headers, cache: "no-store", signal: controller.signal });
          if (!healthResponse.ok) throw new Error("The confirmed launch indexer health binding is unavailable.");
          return validatedIndexerBinding(indexedBindingSchema.parse(await healthResponse.json()));
        })();
    const mapped = payload.launches.map(mapIndexedLaunch);
    const launches = await enrichCreatorConcentration(await Promise.all(mapped.map(async (launch) => ({
      ...launch,
      image: (await resolveTokenMetadata(launch.metadataURI))?.image
    }))), payload.indexedThrough);
    const creatorSafeguardsReady = launches.length > 0 && launches.every((launch) =>
      typeof launch.creatorOutsideCurveBps === "number" && launch.creatorFlow !== "unknown"
    );
    return {
      chainId: binding.chainId,
      protocolVersion: binding.protocolVersion,
      factory: getAddress(binding.factory),
      factoryStartBlock: binding.factoryStartBlock,
      launches,
      syncedAt: payload.syncedAt,
      indexedThrough: payload.indexedThrough,
      creatorSafeguardsReady
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function readIndexedLaunchOrigin(token: Address) {
  const baseUrl = configuredIndexerUrl();
  if (!baseUrl) throw new Error("The confirmed launch indexer is not configured.");

  const url = new URL(baseUrl + "/origins");
  url.searchParams.set("tokens", token);
  const headers: Record<string, string> = { Accept: "application/json" };
  const readToken = process.env.RMT_INDEXER_READ_TOKEN?.trim();
  if (readToken) headers.Authorization = "Bearer " + readToken;

  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(indexerTimeoutMs())
  });
  if (!response.ok) throw new Error("The confirmed launch indexer returned " + response.status + ".");
  const payload = indexedOriginResponseSchema.parse(await response.json());
  if (getAddress(payload.factory) !== publicMainnetV6FactoryAddress) {
    throw new Error("Indexer origin factory does not match the live V6 release.");
  }

  const claim = payload.claims.find((candidate) => getAddress(candidate.token) === token);
  if (claim && getAddress(claim.factory) !== publicMainnetV6FactoryAddress) {
    throw new Error("Indexer origin claim does not match the live V6 release.");
  }
  return {
    origin: claim ? {
      launchId: claim.launchId,
      token: getAddress(claim.token),
      blockNumber: claim.launchBlock,
      transactionHash: claim.launchTransactionHash as Hash
    } : null,
    indexedThrough: payload.indexedThrough,
    syncedAt: payload.syncedAt
  };
}
