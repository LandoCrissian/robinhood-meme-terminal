import { getAddress, isAddress } from "viem";
import type { ExternalProjectMetadata } from "../external-market";

const LEMON_BASE_URL = "https://lemon.fun";
const LEMON_CHAIN_ID = 4663;
const LEMON_TIMEOUT_MS = 7_000;
const MAX_CANDIDATES = 30;

type RawLemonToken = {
  address?: unknown;
  token_address?: unknown;
  poolAddress?: unknown;
  graduated_pool_address?: unknown;
  name?: unknown;
  symbol?: unknown;
  ticker?: unknown;
  image?: unknown;
  image_url?: unknown;
  description?: unknown;
  deployer?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  last_trade_ts?: unknown;
  volume_24h_eth?: unknown;
  chain_id?: unknown;
  socials?: {
    twitter?: unknown;
    telegram?: unknown;
    website?: unknown;
  };
};

type LemonTokenListPayload = {
  tokens?: unknown;
};

type LemonHomePayload = {
  tokens?: unknown;
};

export type LemonProjectSnapshot = {
  projects: Map<string, ExternalProjectMetadata>;
  candidateAddresses: string[];
  delayed: boolean;
};

function text(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value, 64));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeResource(value: unknown) {
  const candidate = text(value, 1_000);
  if (!candidate) return null;
  if (candidate.startsWith("ipfs://")) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeSocial(value: unknown, kind: "x" | "telegram" | "website") {
  const candidate = text(value, 300);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    const handle = candidate.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,64}$/.test(handle)) return null;
    if (kind === "x") return `https://x.com/${handle}`;
    if (kind === "telegram") return `https://t.me/${handle}`;
    return null;
  }
}

function rawTokens(payload: LemonTokenListPayload | LemonHomePayload) {
  return Array.isArray(payload.tokens) ? payload.tokens as RawLemonToken[] : [];
}

function tokenAddress(token: RawLemonToken) {
  const candidate = text(token.address ?? token.token_address, 42);
  return isAddress(candidate) ? getAddress(candidate) : null;
}

function poolAddress(token: RawLemonToken) {
  const candidate = text(token.poolAddress ?? token.graduated_pool_address, 42);
  return isAddress(candidate) ? getAddress(candidate) : null;
}

export function parseLemonProjects(payload: unknown) {
  const parsed = payload && typeof payload === "object" ? payload as LemonTokenListPayload : {};
  const projects = new Map<string, ExternalProjectMetadata>();
  for (const token of rawTokens(parsed)) {
    const address = tokenAddress(token);
    const pool = poolAddress(token);
    const creatorCandidate = text(token.deployer, 42);
    const name = text(token.name, 80);
    const symbol = text(token.symbol ?? token.ticker, 20);
    if (!address || !pool || !isAddress(creatorCandidate) || !name || !symbol) continue;

    const project: ExternalProjectMetadata = Object.freeze({
      sourceId: "lemon",
      sourceName: "Lemon",
      provenance: "public-api-and-dex-pool-cross-checked",
      creator: getAddress(creatorCandidate),
      launchPool: pool,
      name,
      symbol,
      description: text(token.description, 1_000),
      imageUri: safeResource(token.image ?? token.image_url),
      socials: Object.freeze({
        x: safeSocial(token.socials?.twitter, "x"),
        telegram: safeSocial(token.socials?.telegram, "telegram"),
        discord: null,
        website: safeSocial(token.socials?.website, "website"),
        farcaster: null
      })
    });
    projects.set(address.toLowerCase(), project);
  }
  return projects;
}

export function selectLemonCandidates(homePayload: unknown, listPayload: unknown) {
  const home = homePayload && typeof homePayload === "object" ? homePayload as LemonHomePayload : {};
  const list = listPayload && typeof listPayload === "object" ? listPayload as LemonTokenListPayload : {};
  const eligibleHome = rawTokens(home).filter((token) =>
    number(token.chain_id) === LEMON_CHAIN_ID && tokenAddress(token) && poolAddress(token)
  );
  const active = [...eligibleHome]
    .sort((a, b) => number(b.volume_24h_eth) - number(a.volume_24h_eth))
    .slice(0, 18);
  const recent = [...eligibleHome]
    .sort((a, b) =>
      Math.max(timestamp(b.last_trade_ts), timestamp(b.created_at))
      - Math.max(timestamp(a.last_trade_ts), timestamp(a.created_at))
    )
    .slice(0, 18);
  const fallback = rawTokens(list).filter((token) => tokenAddress(token) && poolAddress(token));
  const addresses: string[] = [];
  const seen = new Set<string>();
  for (const token of [...active, ...recent, ...fallback]) {
    const address = tokenAddress(token);
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    addresses.push(address);
    if (addresses.length === MAX_CANDIDATES) break;
  }
  return addresses;
}

async function fetchJson(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LEMON_TIMEOUT_MS);
  try {
    const response = await fetch(LEMON_BASE_URL + path, {
      headers: { Accept: "application/json" },
      next: { revalidate: 15 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Lemon request failed with ${response.status}.`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLemonProjectSnapshot(): Promise<LemonProjectSnapshot> {
  const [homeResult, listResult] = await Promise.allSettled([
    fetchJson("/api/public/launchpad/home"),
    fetchJson("/api/public/launchpad/tokens?limit=200&offset=0&sort=created")
  ]);
  const homePayload = homeResult.status === "fulfilled" ? homeResult.value : {};
  const listPayload = listResult.status === "fulfilled" ? listResult.value : {};
  return {
    projects: parseLemonProjects(listPayload),
    candidateAddresses: selectLemonCandidates(homePayload, listPayload),
    delayed: homeResult.status === "rejected" || listResult.status === "rejected"
  };
}
