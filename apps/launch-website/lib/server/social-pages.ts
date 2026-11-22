import { reviewOrigin, readPublicReview, reviewAvatarPath } from "./public-review";
import { cache } from "react";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { profileConfig } from "./profiles/config";
import { accountHandler } from "./profiles/controller";
import type { PublicCreatorProfile } from "../profiles";
import { creatorCard, socialMetadata, tokenCard, type ShareCard } from "../social";
import { configuredProductionDiscovery, readProductionDiscovery } from "./production-discovery";

// Public navigation can come from another website. Build an anonymous internal GET,
// retaining the actual host/proxy checks and consuming the existing public-read budgets.
export function anonymousReadHeaders(incoming: Headers) {
  const result = new Headers();
  for (const name of ["host", "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port"]) {
    const value = incoming.get(name);
    if (value !== null) result.set(name, value);
  }
  return result;
}

async function publicRead(path: string, action: "public-username" | "public-wallet" | "public-avatar", key: string) {
  const config = profileConfig();
  if (!config) return null;
  return accountHandler(new Request(config.origin + path, { headers: anonymousReadHeaders(await headers()) }), action, key);
}

export const readCreator = cache(async (kind: "u" | "creator", key: string): Promise<{ status: "ready"; profile: PublicCreatorProfile } | { status: "missing" | "unavailable" }> => {
  try {
    const origin = reviewOrigin(await headers());
    if (origin) {
      const { profiles } = await readPublicReview(origin);
      const profile = profiles.find(p => kind === "u" ? p.username === key : p.walletAddress.toLowerCase() === key.toLowerCase());
      return profile ? {status:"ready",profile} : {status:"missing"};
    }
    const lookup = kind === "u" ? "public" : "creator";
    const response = await publicRead("/api/account/" + lookup + "/" + key, kind === "u" ? "public-username" : "public-wallet", key);
    if (!response) return { status: "unavailable" };
    const body = await response.json();
    if (response.status === 404 && body.availability === "available") return { status: "missing" };
    const p: PublicCreatorProfile = body.profile;
    if (!response.ok || !p || p.chainId !== 4663 || !/^0x[0-9a-f]{40}$/i.test(p.walletAddress) ||
        (kind === "u" ? p.username !== key : p.walletAddress.toLowerCase() !== key.toLowerCase())) return { status: "unavailable" };
    return { status: "ready", profile: p };
  } catch { return { status: "unavailable" }; }
});

export async function publicAvatar(profile: PublicCreatorProfile) {
  if (profile.avatarUrl && reviewAvatarPath.test(profile.avatarUrl)) {
    const origin = reviewOrigin(await headers());
    if (!origin) return null;
    const response = await fetch(origin + profile.avatarUrl, {redirect:"error",signal:AbortSignal.timeout(5000)});
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/webp")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= 65536 ? bytes : null;
  }
  if (!profile.avatarUrl?.startsWith("/api/account/avatar/" + profile.walletAddress + "?v=")) return null;
  const response = await publicRead(profile.avatarUrl, "public-avatar", profile.walletAddress);
  return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
}

export const tokenDiscovery = cache(readProductionDiscovery);
export const readShareToken = cache(async (address: string) => {
  if (!configuredProductionDiscovery(await headers())) return null;
  const result = await tokenDiscovery(address);
  return result.status === "ready" ? result.launches[0] ?? null : null;
});

export function shareImagePath(card: ShareCard) {
  const version = createHash("sha256").update(JSON.stringify(["rmt-card-v1",card.kind,card.name,card.identity,card.path,card.artwork])).digest("hex").slice(0,24);
  return "/share" + card.path + "/" + version + ".png";
}

export async function creatorMetadata(kind: "u" | "creator", key: string) {
  const found = await readCreator(kind, key);
  if (found.status !== "ready") return socialMetadata("/" + kind + "/" + key, "Creator profile | RMT Launch", "Discover creators building on Robinhood Chain.");
  const p = found.profile, card = creatorCard(p);
  return socialMetadata(card.path, card.name + " | RMT Launch", p.bio || "Explore " + card.identity + "’s creator profile and projects on Robinhood Chain.",
    shareImagePath(card), card.name + " · " + card.identity + " on RMT Launch", true, reviewOrigin(await headers()) ?? undefined);
}

export async function launchMetadata(address: string) {
  const row = await readShareToken(address);
  if (!row) return socialMetadata("/launches/" + address, "Token details | RMT Launch", "Check the registration status of this Robinhood Chain token on RMT Launch.");
  const card = tokenCard(row);
  return socialMetadata(card.path, card.name + " (" + card.identity + ") | RMT Launch",
    "Explore " + card.name + " on Robinhood Chain. View the token contract, creator and indexed launch details.", shareImagePath(card), card.name + " · " + card.identity + " on RMT Launch");
}
