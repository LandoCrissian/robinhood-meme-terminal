import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAddress, isAddress } from "viem";

type MarketRouteProps = {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ side?: string }>;
};

export const metadata: Metadata = {
  title: "Open market in RMT Terminal",
  description: "This compatibility URL opens the selected Robinhood Chain market in the canonical RMT terminal.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/" }
};

export default async function ExternalMarketPage({ params, searchParams }: MarketRouteProps) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) redirect("/");
  const query = new URLSearchParams({ market: getAddress(address) });
  const { side } = await searchParams;
  if (side === "buy" || side === "sell") query.set("side", side);
  redirect(`/?${query}`);
}
