import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ProductToken } from "../../_components/launch-product";

export default async function LaunchTokenPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const [{ token }, { side }] = await Promise.all([params, searchParams]);
  if (!isAddress(token)) notFound();
  return <ProductToken token={getAddress(token)} side={side === "sell" ? "sell" : "buy"} />;
}
