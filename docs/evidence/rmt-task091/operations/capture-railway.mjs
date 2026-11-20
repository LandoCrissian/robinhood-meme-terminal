import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Only existing provider control-plane reads. No variables, SQL, SSH sessions,
// backup creation/restoration, config writes, proxy creation or deployment calls.
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--railway" || args[2] !== "--output") {
  throw Error("Usage: node capture-railway.mjs --railway <existing-cli> --output <fresh-json>");
}
const binary = resolve(args[1]), output = resolve(args[3]);
const project = "19587a6e-6f02-4cfa-b7db-f308934f697b";
const environment = "539a42da-fb60-420f-b9fa-8c29af25ebbe";
const service = "a1ef7853-e21a-401e-87c9-c99002228507";
const volume = "bf6e7ddc-3be6-4ba7-ad53-8e7010e76c86";
const cli = (a) => {
  try { return execFileSync(binary, a, { encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { throw Error(`Read-only Railway command failed (exit ${e.status ?? "unknown"}); inspect securely in the existing owner session.`); }
};
const query = (document) => {
  const result = JSON.parse(cli(["api", document, "--compact"]));
  if (result.errors || !result.data) throw Error("Provider metadata unavailable; no control state changed");
  return result.data;
};
const startedAt = new Date().toISOString();
const inventory = query(`query { environment(id:"${environment}",projectId:"${project}") { id name volumeInstances { edges { node { id volumeId serviceId mountPath createdAt currentSizeMB sizeMB state } } } } }`);
const matched = inventory.environment.volumeInstances.edges.map(e => e.node).filter(v => v.volumeId === volume && v.serviceId === service);
if (matched.length !== 1) throw Error("Exact production volume identity unavailable; no query of another volume was attempted");
const instance = matched[0];
const backup = query(`query { backups:volumeInstanceBackupList(volumeInstanceId:"${instance.id}") { id createdAt expiresAt name referencedMB usedMB volumeInstanceSizeMB scheduleId } schedules:volumeInstanceBackupScheduleList(volumeInstanceId:"${instance.id}") { id kind cron retentionSeconds } }`);
const pitr = JSON.parse(cli(["postgres", "pitr", "status", "--service", service, "--environment", environment, "--project", project, "--json"]));
if (pitr.service?.id !== service || pitr.environment?.id !== environment) throw Error("PITR response identity mismatch");
const sshText = cli(["ssh", "keys", "list"]);
const noRegisteredSshKeys = /No SSH keys registered with Railway\./.test(sshText);
const report = { schemaVersion: 1, scope: "EXISTING_PRODUCTION_PROVIDER_METADATA_READ_ONLY", startedAt, finishedAt: new Date().toISOString(),
  cliVersion: cli(["--version"]).trim(), projectId: project, environmentId: environment, databaseServiceId: service,
  volume: instance, volumeUsagePercent: instance.currentSizeMB / instance.sizeMB * 100,
  backups: backup.backups, schedules: backup.schedules,
  backupCount: backup.backups.length, newestProviderBackupAt: backup.backups.length ? backup.backups.map(b => b.createdAt).sort().at(-1) : null,
  pitr: { enabled: pitr.enabled, bucketWired: pitr.bucketWired, isHaCluster: pitr.isHaCluster }, noRegisteredSshKeys,
  status: !backup.backups.length && !pitr.enabled ? "CURRENT_PROVIDER_BACKUPS_ABSENT" : "BACKUP_METADATA_ONLY_RESTORE_NOT_PROVEN",
  currentProductionBackupRestored: false, ownerControlledOffDeviceCopyAndKeyVerified: false,
  currentWriterLeaseDirectlyObserved: false,
  limitations: ["No backup was triggered or enabled; backup metadata is not a successful restore.",
    "The earlier Task066 encrypted owner-local backup is not proved absent; its current existence, readability, age and off-device recovery remain unverified.",
    "No SSH keys were added, no SSH session opened and no public database network path created.",
    "No secret values, database data, wallet signatures, token creation or financial configuration were read or changed."] };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, backupCount: report.backupCount, pitrEnabled: report.pitr.enabled,
  noRegisteredSshKeys, currentWriterLeaseDirectlyObserved: false, output }));
