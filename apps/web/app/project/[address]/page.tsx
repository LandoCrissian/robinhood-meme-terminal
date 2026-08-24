import { redirect } from "next/navigation";
import { legacyTerminalMarketRedirect } from "../../../lib/vnext/legacy-terminal-routes";

type ProjectRouteProps = {
  params: Promise<{ address: string }>;
};

export default async function LegacyProjectCompatibilityPage({ params }: ProjectRouteProps) {
  const { address } = await params;
  redirect(legacyTerminalMarketRedirect(address));
}
