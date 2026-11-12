import { redirect } from "next/navigation";
import { getAddress, isAddress } from "viem";
import "./vnext/vnext-terminal.css";
import "./(launchpad)/launchpad.css";
import { LaunchDirectory } from "./(launchpad)/_components/launch-directory";
import { legacyRmtAddress } from "../lib/launchpad/legacy-rmt";

export const metadata = { title: "RMT Launch | Token Launchpad", robots: { index: false, follow: false } };

export default async function Home({ searchParams }: { searchParams: Promise<{ market?: string; side?: string; panel?: string }> }) {
  const { market, side, panel } = await searchParams;
  if (panel === "portfolio") redirect("/wallet");
  if (typeof market === "string" && isAddress(market)) {
    const address = getAddress(market);
    if (legacyRmtAddress(address)) redirect("/rmt#legacy-token");
    redirect(`/launches/${address}${side === "buy" || side === "sell" ? `?side=${side}` : ""}`);
  }
  return <LaunchDirectory />;
}
