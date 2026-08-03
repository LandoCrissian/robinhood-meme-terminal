import { isNonzeroEvmAddress } from "../external-market-identity";
import type { ExternalMarketSocials } from "../external-market";
import { externalMarketSocialsFromPairInfo } from "../external-market-socials";
import { safeDexImageUri } from "./external-market-media";

type RawDiscoveryToken = {
  chainId?: unknown;
  tokenAddress?: unknown;
  icon?: unknown;
  links?: unknown;
};

type RawDiscoveryLink = {
  type?: unknown;
  label?: unknown;
  url?: unknown;
};

export type PublicDiscoveryMetadata = {
  imageUri?: string;
  socials?: ExternalMarketSocials;
};

export type PublicDiscoverySnapshot = {
  tokenAddresses: string[];
  metadata: Map<string, PublicDiscoveryMetadata>;
};

function text(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function parseDexDiscoveryMetadata(payloads: unknown[]): PublicDiscoverySnapshot {
  const metadata = new Map<string, PublicDiscoveryMetadata>();
  const tokenAddresses: string[] = [];
  const seen = new Set<string>();

  for (const payload of payloads) {
    if (!Array.isArray(payload)) continue;
    for (const raw of payload as RawDiscoveryToken[]) {
      const address = text(raw.tokenAddress, 42);
      if (raw.chainId !== "robinhood" || !isNonzeroEvmAddress(address)) continue;
      const key = address.toLowerCase();
      const links = Array.isArray(raw.links) ? raw.links as RawDiscoveryLink[] : [];
      const pairInfo = {
        websites: links
          .filter((link) => ["website", "homepage"].includes(text(link.type ?? link.label, 40).toLowerCase()))
          .map((link) => ({ url: link.url })),
        socials: links.map((link) => ({
          type: text(link.type ?? link.label, 40),
          url: link.url
        }))
      };
      const previous = metadata.get(key);
      metadata.set(key, {
        imageUri: previous?.imageUri ?? safeDexImageUri(raw.icon),
        socials: previous?.socials ?? externalMarketSocialsFromPairInfo(pairInfo)
      });
      if (!seen.has(key)) {
        seen.add(key);
        tokenAddresses.push(key);
      }
    }
  }
  return { tokenAddresses, metadata };
}
