import type {
  ExternalMarketSocials,
  ExternalSocialLinks
} from "./external-market";
import { safeExternalNavigationUrl } from "./vnext/external-navigation";

type SocialKind = keyof ExternalSocialLinks;

type RawWebsite = {
  url?: unknown;
};

type RawSocial = {
  type?: unknown;
  url?: unknown;
};

const SOCIAL_HOSTS: Record<Exclude<SocialKind, "website">, ReadonlySet<string>> = {
  x: new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]),
  telegram: new Set(["t.me", "telegram.me", "www.telegram.me"]),
  discord: new Set(["discord.gg", "discord.com", "www.discord.com"]),
  farcaster: new Set(["warpcast.com", "www.warpcast.com", "farcaster.xyz", "www.farcaster.xyz"])
};

function httpsUrl(value: unknown) {
  return safeExternalNavigationUrl(value);
}

function socialUrl(value: unknown, kind: Exclude<SocialKind, "website">) {
  const safe = httpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  return SOCIAL_HOSTS[kind].has(url.hostname.toLowerCase()) ? safe : null;
}

function socialKind(value: unknown): Exclude<SocialKind, "website"> | null {
  const kind = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (kind === "x" || kind === "twitter") return "x";
  if (kind === "telegram") return "telegram";
  if (kind === "discord") return "discord";
  if (kind === "farcaster" || kind === "warpcast") return "farcaster";
  return null;
}

export function externalMarketSocialsFromPairInfo(info: {
  websites?: unknown;
  socials?: unknown;
} | null | undefined): ExternalMarketSocials | undefined {
  const websites = Array.isArray(info?.websites) ? info.websites as RawWebsite[] : [];
  const rawSocials = Array.isArray(info?.socials) ? info.socials as RawSocial[] : [];
  const links: ExternalSocialLinks = {
    website: websites.map((entry) => httpsUrl(entry?.url)).find(Boolean) ?? null,
    x: null,
    telegram: null,
    discord: null,
    farcaster: null
  };

  for (const entry of rawSocials) {
    const kind = socialKind(entry?.type);
    if (!kind || links[kind]) continue;
    links[kind] = socialUrl(entry?.url, kind);
  }

  return Object.values(links).some(Boolean)
    ? { ...links, provenance: "dex-pair-metadata" }
    : undefined;
}

export function mergeExternalSocialLinks(
  verified: ExternalSocialLinks | null | undefined,
  discovered: ExternalMarketSocials | null | undefined
): ExternalSocialLinks {
  return {
    website: verified?.website ?? discovered?.website ?? null,
    x: verified?.x ?? discovered?.x ?? null,
    telegram: verified?.telegram ?? discovered?.telegram ?? null,
    discord: verified?.discord ?? discovered?.discord ?? null,
    farcaster: verified?.farcaster ?? discovered?.farcaster ?? null
  };
}

export function hasExternalSocialLinks(links: ExternalSocialLinks) {
  return Object.values(links).some(Boolean);
}
