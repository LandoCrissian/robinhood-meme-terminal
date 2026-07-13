import Link from "next/link";
import { readSystemHealth } from "../../lib/server/system-health";
import { SystemStatus } from "./system-status";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const report = await readSystemHealth();
  return (
    <main className="statusPage">
      <nav className="statusNav">
        <Link className="brandLockup" href="/" aria-label="Back to Robinhood Meme Terminal">
          <img className="brandLogo" src="/brand/rmt-master-logo.png" alt="" /><strong>RMT</strong>
        </Link>
        <Link href="/">Back to terminal</Link>
      </nav>
      <SystemStatus initialReport={report} />
    </main>
  );
}
