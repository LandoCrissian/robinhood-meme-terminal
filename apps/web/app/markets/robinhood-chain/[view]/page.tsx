import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  PUBLIC_VNEXT_MARKET_INVENTORY_VIEWS,
  publicVNextMarketInventoryView,
  type PublicVNextMarketInventoryView
} from "../../../../lib/server/public-vnext-market-inventory";
import { RMT_SITE_NAME } from "../../../../lib/site-identity";
import { MarketInventory } from "../market-inventory";

const metadataByView: Record<Exclude<PublicVNextMarketInventoryView, "all">, { title: string; description: string }> = {
  trending: {
    title: "Trending Robinhood Chain Markets | RMT",
    description: "Browse Robinhood Chain markets currently classified as moving or early by RMT's canonical VNext market directory."
  },
  new: {
    title: "New Robinhood Chain Markets & Tokens | RMT",
    description: "Browse qualified Robinhood Chain markets created within the last 24 hours, with exact contracts, liquidity and trading activity."
  },
  active: {
    title: "Active Robinhood Chain Markets by 24h Volume | RMT",
    description: "Browse active Robinhood Chain markets with non-zero 24-hour volume from RMT's canonical VNext market directory."
  }
};

export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_VNEXT_MARKET_INVENTORY_VIEWS
    .filter((view) => view.id !== "all")
    .map((view) => ({ view: view.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ view: string }> }): Promise<Metadata> {
  const { view } = await params;
  const definition = publicVNextMarketInventoryView(view);
  if (!definition || definition.id === "all") return { robots: { index: false, follow: false } };
  const copy = metadataByView[definition.id];
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical: definition.path },
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
      title: copy.title,
      description: copy.description,
      url: definition.path,
      images: ["/brand/rmt-master-logo.png"]
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: ["/brand/rmt-master-logo.png"]
    }
  };
}

export default async function RobinhoodChainMarketViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const definition = publicVNextMarketInventoryView(view);
  if (!definition || definition.id === "all") notFound();
  const copy = metadataByView[definition.id];
  return <MarketInventory view={definition.id} title={copy.title} description={copy.description} />;
}
