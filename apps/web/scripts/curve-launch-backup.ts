import { resolve } from "node:path";
import { backupCurveIndex, restoreCurveIndex } from "../lib/server/curve-launch-backup";
import { readCurveRuntime } from "../lib/server/curve-launch-config";

async function main() {
  const [command, first, second, digest, ...extra] = process.argv.slice(2);
  if (!first || extra.length || (command === "backup" ? !!second : command !== "restore" || !second || !digest)) {
    throw new Error("Use backup <new-snapshot> or restore <snapshot> <new-database> <recorded-sha256>.");
  }
  const config = readCurveRuntime();
  if (!config) throw new Error("The local curve configuration is required to bind the backup scope.");
  const result = command === "backup" ? await backupCurveIndex(config, resolve(first))
    : await restoreCurveIndex(config, resolve(first), resolve(second), digest);
  console.log(JSON.stringify({ command, scope: config.scope, ...result }));
}

void main().catch(() => {
  console.error("Curve backup operation failed. Check arguments, the local curve scope, destination and recorded SHA-256.");
  process.exitCode = 1;
});
