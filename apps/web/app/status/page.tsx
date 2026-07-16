import { readSystemHealth } from "../../lib/server/system-health";
import { SystemStatus } from "./system-status";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const report = await readSystemHealth();
  return (
    <main className="statusPage">
      <SystemStatus initialReport={report} />
    </main>
  );
}
