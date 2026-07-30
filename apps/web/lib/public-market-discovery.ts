import type { Metadata } from "next";
import { getAddress, isAddress } from "viem";
import type { ExternalMarket } from "./external-market";
import {
  RMT_SITE_NAME,
  RMT_SITE_URL
} from "./site-identity";

export const PUBLIC_MARKET_MINIMUM_LIQUIDITY_USD = 5_000;
export const PUBLIC_MARKET_MINIMUM_VOLUME_24H_USD = 100;

const SEARCH_BLOCKING_RISK_FLAGS = new Set([
  "extreme-price-spike",
  "high-volume-low-trades",
  "very-new-low-activity",
  "one-sided-activity"
]);

function cleanSymbol(symbol: string) {
  return symbol.replaceAll("$", "").trim().slice(0, 20);
}

function compactUsd(value: number) {
  return "$" + value.toLocaleString("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 0
  });
}

export function canonicalMarketAddress(address: string) {
  return isAddress(address) ? getAddress(address) : null;
}

export function publicMarketPath(address: string) {
  const canonical = canonicalMarketAddress(address);
  return canonical ? `/market/${canonical}` : null;
}

export function publicMarketSitemapPaths(markets: readonly ExternalMarket[]) {
  return markets
    .filter(isPublicSearchMarket)
    .flatMap((market) => {
      const path = publicMarketPath(market.address);
      return path ? [path] : [];
    });
}

export function isPublicSearchMarket(market: ExternalMarket) {
  return Boolean(
    canonicalMarketAddress(market.address)
    && canonicalMarketAddress(market.pairAddress)
    && market.project
    && market.project.launchPool.toLowerCase() === market.pairAddress.toLowerCase()
    && market.liquidityUsd >= PUBLIC_MARKET_MINIMUM_LIQUIDITY_USD
    && market.volume24h >= PUBLIC_MARKET_MINIMUM_VOLUME_24H_USD
    && !market.riskFlags.some((flag) => SEARCH_BLOCKING_RISK_FLAGS.has(flag))
  );
}

export function publicMarketDescription(market: ExternalMarket) {
  const symbol = cleanSymbol(market.symbol);
  const source = market.project?.sourceName ?? "Robinhood Chain";
  return [
    `Review ${market.name}${symbol ? ` ($${symbol})` : ""} on ${source}.`,
    `${compactUsd(market.liquidityUsd)} liquidity and ${compactUsd(market.volume24h)} 24h volume at the latest verified snapshot.`,
    "Inspect origin, activity, holder concentration, risk evidence, and self-custodial execution routes on RMT."
  ].join(" ");
}

export function publicMarketImageVersion(market: ExternalMarket) {
  return [
    Math.round(market.liquidityUsd / 1_000),
    Math.round(market.volume24h / 1_000),
    Math.round((market.marketCapUsd || market.fdvUsd) / 1_000)
  ].map((value) => Math.max(0, value).toString(36)).join("-");
}

export function buildPublicMarketMetadata(
  address: string,
  market: ExternalMarket | null
): Metadata {
  const path = publicMarketPath(address);
  if (!path || !market || !isPublicSearchMarket(market)) {
    return {
      title: `Market review | ${RMT_SITE_NAME}`,
      description: "This market is not currently eligible for RMT public search discovery.",
      robots: { index: false, follow: false }
    };
  }

  const symbol = cleanSymbol(market.symbol);
  const title = `${market.name}${symbol ? ` ($${symbol})` : ""} | RMT Market`;
  const description = publicMarketDescription(market);
  const image = `${path}/opengraph-image?v=${publicMarketImageVersion(market)}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1
      }
    },
    openGraph: {
      type: "website",
      siteName: RMT_SITE_NAME,
      title,
      description,
      url: path,
      images: [{ url: image, width: 1200, height: 630, alt: `${market.name} market on RMT` }]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image]
    }
  };
}

export function publicMarketStructuredData(market: ExternalMarket) {
  const path = publicMarketPath(market.address);
  if (!path || !isPublicSearchMarket(market)) return null;
  const description = publicMarketDescription(market);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${RMT_SITE_URL}${path}#webpage`,
    url: `${RMT_SITE_URL}${path}`,
    name: `${market.name} ($${cleanSymbol(market.symbol)}) market review`,
    description,
    isPartOf: { "@id": `${RMT_SITE_URL}/#website` },
    about: {
      "@type": "Thing",
      name: market.name,
      identifier: canonicalMarketAddress(market.address)
    },
    inLanguage: "en-US"
  } as const;
}
