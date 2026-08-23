import type {
  ExternalMarketSocials,
  ExternalSocialLinks
} from "./external-market";
import { safeExternalNavigationUrl, safeExternalSocialNavigationUrl } from "./vnext/external-navigation";

type SocialKind = keyof ExternalSocialLinks;

type RawWebsite = {
  url?: unknown;
};

type RawSocial = {
  type?: unknown;
  url?: unknown;
};

function httpsUrl(value: unknown) {
  return safeExternalNavigationUrl(value);
}

function socialUrl(value: unknown, kind: Exclude<SocialKind, "website">) {
  return safeExternalSocialNavigationUrl(value, kind);
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
