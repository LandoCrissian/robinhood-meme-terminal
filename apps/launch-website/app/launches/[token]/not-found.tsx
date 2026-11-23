import Link from "next/link";

import { headers } from "next/headers";
import { configuredProductionDiscovery } from "../../../lib/server/production-discovery";

export default async function LaunchNotFound() {
  const production = configuredProductionDiscovery(await headers());
  return <>
    <Link className="lpBack" href="/" prefetch={false}>← Launches</Link>
    <div className="lpEmpty">
      <h2>{production ? "Token not found" : "Launch unavailable"}</h2>
      <p>{production ? "Check the token address or browse the launch directory." : "RMT Launch is in prelaunch. Public token details will be available after launch creation opens and registrations are verified."}</p>
    </div>
  </>;
}
