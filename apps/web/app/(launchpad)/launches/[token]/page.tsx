import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { LaunchTokenDetail } from "../../_components/launch-token";

export default async function LaunchTokenPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const [{ token }, { side }] = await Promise.all([params, searchParams]);
  if (!isAddress(token)) notFound();
  return <LaunchTokenDetail token={getAddress(token)} side={side === "sell" ? "sell" : "buy"} />;
}
