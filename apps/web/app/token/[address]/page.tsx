import { redirect } from "next/navigation";
import { legacyTerminalMarketRedirect } from "../../../lib/vnext/legacy-terminal-routes";

type TokenRouteProps = {
  params: Promise<{ address: string }>;
};

export default async function LegacyTokenCompatibilityPage({ params }: TokenRouteProps) {
  const { address } = await params;
  redirect(legacyTerminalMarketRedirect(address));
}
