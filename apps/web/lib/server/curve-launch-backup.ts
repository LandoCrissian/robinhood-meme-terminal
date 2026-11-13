import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isHash, type Hash } from "viem";
import type { readCurveRuntime } from "./curve-launch-config";
import { copyLaunchSnapshot, copyVerifiedLaunchBackup, stageLaunchBackup } from "./launchpad-sqlite-backup";

type Runtime = NonNullable<ReturnType<typeof readCurveRuntime>>;

function checkSnapshot(path: string, config: Runtime) {
  const snapshot = new DatabaseSync(path);
  try {
    snapshot.exec("PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
    if (snapshot.prepare("PRAGMA quick_check(1)").get()?.quick_check !== "ok") throw new Error("Curve backup failed SQLite integrity check.");
    const anchor = snapshot.prepare("SELECT height,hash FROM curve_anchors WHERE scope=?").get(config.scope);
    const checkpoint = snapshot.prepare("SELECT height,hash FROM curve_checkpoints WHERE scope=? ORDER BY height DESC LIMIT 1").get(config.scope);
    if (!anchor || !checkpoint || String(anchor.height) !== String(config.startBlock - 1n)
      || typeof anchor.hash !== "string" || !isHash(anchor.hash) || typeof checkpoint.hash !== "string" || !isHash(checkpoint.hash)
      || typeof checkpoint.height !== "number" || !Number.isSafeInteger(checkpoint.height) || BigInt(checkpoint.height) < config.startBlock) {
      throw new Error("Curve backup does not contain the expected deployment scope and checkpoint.");
    }
    return { number: String(checkpoint.height), hash: checkpoint.hash as Hash, anchorHash: anchor.hash as Hash };
  } finally { snapshot.close(); }
}

export async function backupCurveIndex(config: Runtime, destination: string) {
  if (!isAbsolute(config.databasePath) || !(await lstat(config.databasePath)).isFile()) {
    throw new Error("Curve backup requires a regular, absolute database file.");
  }
  return stageLaunchBackup(destination, async (staged) => {
    await copyLaunchSnapshot(config.databasePath, staged);
    return checkSnapshot(staged, config);
  });
}

export function restoreCurveIndex(config: Runtime, source: string, destination: string, expectedSha256: string) {
  return stageLaunchBackup(destination, async (staged) => {
    await copyVerifiedLaunchBackup(source, staged, expectedSha256);
    return checkSnapshot(staged, config);
  });
}
