import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ProductToken } from "../../_components/launch-product";
import { ShowcaseToken } from "../../_components/launch-showcase";
import { curveShowcaseExamples } from "../../../../lib/launchpad/curve-showcase";
import { isLaunchShowcase } from "../../../../lib/server/launchpad-site-mode";

export default async function LaunchTokenPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const [{ token }, { side }] = await Promise.all([params, searchParams]);
  if (isLaunchShowcase()) {
    const example = curveShowcaseExamples.find(({ slug }) => slug === token);
    if (!example) notFound();
    return <ShowcaseToken example={example} />;
  }
  if (!isAddress(token)) notFound();
  return <ProductToken token={getAddress(token)} side={side === "sell" ? "sell" : "buy"} />;
}
